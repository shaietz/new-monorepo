# `@repo/fastify-base`

The production baseline every Fastify service in this monorepo builds on: validated environment
config, one error shape, security middleware, health probes, Prometheus metrics, optional OpenAPI,
and a shutdown that does not drop traffic.

It ships as a **Fastify plugin**, not a factory. Your service owns its instance, so adding anything
this package didn't anticipate is a local `register` call rather than a change here.

## Usage

```ts
// src/app.ts
import fastify from "fastify";
import { basePlugin, loadConfig, serverOptions } from "@repo/fastify-base";
import { z } from "zod";

const SERVICE_NAME = "orders";

export const config = loadConfig({ DATABASE_URL: z.url() });

/** `cfg` is a parameter so tests can build a server without stubbing the environment first. */
export async function buildServer(cfg: typeof config = config) {
  const server = fastify(serverOptions(cfg, SERVICE_NAME));

  await server.register(basePlugin, { config: cfg, name: SERVICE_NAME });

  server.get("/ping", async () => "pong\n");
  return server;
}
```

```ts
// src/index.ts
import { startService } from "@repo/fastify-base";
import { buildServer, config } from "./app.ts";

await startService(await buildServer(), config);
```

`serverOptions` returns every constructor-level default — logger, `trustProxy`, `bodyLimit`,
`genReqId`, and the socket timeouts. Keeping them here rather than in each service's `fastify()` call
is what stops the fleet from drifting apart one copy-paste at a time.

Route schemas are Zod, with request and reply types inferred:

```ts
import { z } from "zod";
import type { ZodTypeProvider } from "@repo/fastify-base";

const CreateUser = z.object({ email: z.email(), displayName: z.string().min(1) });
const User = CreateUser.extend({ id: z.uuid() });

server
  .withTypeProvider<ZodTypeProvider>()
  .post("/users", { schema: { body: CreateUser, response: { 201: User } } }, async (req, reply) =>
    reply.code(201).send({ id: randomUUID(), ...req.body }),
  );
```

Schemas a client also needs belong in a shared workspace package rather than inline here, so both
sides agree on one definition.

## Exports

| Export                         | Purpose                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `loadConfig(extra?)`           | Validates `process.env` against the base schema plus your service's own properties. Throws at boot on bad input. |
| `serverOptions(config, name)`  | The whole `FastifyServerOptions` object. Pass it straight to `fastify()`.                                        |
| `basePlugin`                   | Registers everything below. Options: `{ config, name, healthCheck? }`.                                           |
| `startService(server, config)` | Listens, then drains and closes on a signal.                                                                     |
| `ZodTypeProvider`              | Type-only. Pass to `.withTypeProvider<…>()` for inferred request and reply types.                                |

`zod` is a **peer dependency**, not a re-export: services declare it themselves. Two copies of Zod in
one process produce schemas that silently fail each other's validation, and syncpack keeps the
versions aligned anyway.

## What `basePlugin` registers

`@fastify/sensible` (`httpErrors`), `@fastify/helmet`, `@fastify/cors` (only when `CORS_ORIGIN` is
set), `@fastify/rate-limit`, and `fastify-metrics` — plus the error handlers, health routes, and the
`x-request-id` response header described below.

## Errors

Every failure answers in one shape, including 404s:

```json
{ "statusCode": 500, "error": "Internal Server Error", "message": "…", "requestId": "…" }
```

Under `NODE_ENV=production` a 5xx `message` is replaced with a generic string. Fastify's default
handler sends `error.message` verbatim, so an unhandled driver error would otherwise put its own
text — connection strings included — on the wire. Outside production the real message is kept.

4xx messages pass through untouched: `httpErrors.gone("finished")` and rate-limit's 429 are
deliberate, client-facing text. Schema violations become a 400 carrying `details`.

`requestId` is the same value as the `x-request-id` response header and the `reqId` in the logs,
which is what makes a user-reported failure findable.

## Endpoints

| Route      | Meaning                                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/livez`   | Is the process wedged? Checks **no** dependencies on purpose, and keeps answering 200 while draining — otherwise one database blip restarts every pod at once. |
| `/readyz`  | Can it serve traffic? 503 when your `healthCheck` rejects or times out, or once shutdown has begun. This is the one the load balancer should poll.             |
| `/metrics` | Prometheus exposition, including `http_request_duration_seconds` per route.                                                                                    |
| `/docs`    | OpenAPI UI, only when `ENABLE_DOCS=true`.                                                                                                                      |

`/livez`, `/readyz`, and `/metrics` are exempt from rate limiting — probes and scrapes have to answer
while the service is shedding load.

The health check runs per request, under a `HEALTH_TIMEOUT_MS` deadline. A dependency that has
stopped answering usually hangs rather than refusing, and a probe that never settles reads as neither
healthy nor sick.

## Shutdown

`startService` does not close on SIGTERM. It fails readiness, waits `SHUTDOWN_DELAY_MS`, and only
then closes. Kubernetes removes a pod from its endpoints asynchronously, so an instance that stops
accepting connections the moment it sees the signal still receives traffic for a beat — which is how
an ordinary deploy produces 502s. `SHUTDOWN_DELAY_MS` must be less than `SHUTDOWN_GRACE_MS`, and
`loadConfig` rejects a configuration where it isn't.

## Environment

| Var                 | Type                                    | Default         |
| ------------------- | --------------------------------------- | --------------- |
| `NODE_ENV`          | `development` \| `test` \| `production` | `development`   |
| `HOST`              | string                                  | `0.0.0.0`       |
| `PORT`              | number                                  | `8080`          |
| `LOG_LEVEL`         | `fatal`…`trace`                         | `info`          |
| `SHUTDOWN_GRACE_MS` | number                                  | `10000`         |
| `SHUTDOWN_DELAY_MS` | number, less than the grace period      | `5000`          |
| `HEALTH_TIMEOUT_MS` | number                                  | `2000`          |
| `TRUST_PROXY`       | boolean                                 | `false`         |
| `CORS_ORIGIN`       | comma-separated origins, or `*`         | `""` (CORS off) |
| `RATE_LIMIT_MAX`    | number                                  | `100`           |
| `RATE_LIMIT_WINDOW` | string                                  | `1 minute`      |
| `BODY_LIMIT`        | bytes                                   | `1048576`       |
| `ENABLE_DOCS`       | boolean                                 | `false`         |

Set `TRUST_PROXY=true` behind a load balancer. Without it `req.ip` is the proxy's address, which
makes rate limiting treat your entire fleet as a single client.

## Notes for maintainers

- **Load shedding is deliberately out of scope.** There is no `@fastify/under-pressure` and no
  event-loop monitoring; bound saturation at the ingress instead. If that ever changes, note that
  under-pressure's built-in status route carries a plain JSON Schema response and the Zod serializer
  throws on non-Zod schemas rather than falling back — it would answer
  `500 FST_ERR_FAILED_ERROR_SERIALIZATION`. Register it with `exposeStatusRoute: false` and let this
  package keep owning `/livez` and `/readyz`.
- **Error responses must never carry a Zod response schema**, for the same reason. Routes here
  declare success schemas only, so an error body reaches the default JSON serializer. There are
  tests asserting the body is not `FST_ERR_FAILED_ERROR_SERIALIZATION`, because nothing else
  surfaces this.
- **`@fastify/swagger` must be registered before any route.** It collects them through an `onRoute`
  hook and only sees what comes after it, so `registerDocs` runs first inside the plugin. Because
  `basePlugin` is `fp`-wrapped and therefore unencapsulated, routes a service adds later are still
  picked up.
- **The `x-request-id` hook is registered before rate limiting on purpose**, so a shed 429 still
  carries the header. Hooks in a phase run in registration order, and an early rejection skips the
  rest.
- **`requestId` is not Fastify's `requestIdHeader`.** The built-in falls back to a per-process
  counter (`req-1`, `req-2`) that collides across replicas, and passes comma-joined duplicate headers
  through raw. Do not set `requestIdHeader` as well — it would handle the header twice.
- **Env coercion is explicit.** Zod does not coerce the way ajv did, so every non-string env var a
  service adds needs `z.coerce.number()`, `z.stringbool()`, or similar. A plain `z.number()` will
  always fail, because `process.env` values are strings.
- **Give an env var a default only when the fallback is safe everywhere.** A connection string is not:
  defaulting it to localhost turns "deployed without configuration" from a crash at boot into a
  service that starts and quietly fails readiness.
- `.env` loading uses Node's built-in `process.loadEnvFile()`, which throws `ENOENT` when the file
  is absent — the normal case in CI. `loadConfig` swallows exactly that error and nothing else.
- `fastify-metrics` is imported as `metricsModule.default` deliberately. It's CJS, so Node's ESM
  interop makes the plain default import the whole `module.exports`. Fastify's `register` unwraps
  it at runtime, which hides the problem — `tsc` does not.
- `clearRegisterOnInit: true` is required on the metrics plugin because prom-client's registry is
  global; a second server in the same process throws without it.
- `drainAndClose` is exported from `start.ts` for its own test: the signal path itself cannot be
  exercised, because close-with-grace exits the process and would take the test runner with it.
- Tests must close their servers.
