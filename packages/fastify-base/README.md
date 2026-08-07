# `@repo/fastify-base`

The production baseline every Fastify service in this monorepo builds on: validated environment
config, security middleware, health probes, Prometheus metrics, and graceful shutdown.

It ships as a **Fastify plugin**, not a factory. Your service owns its instance, so adding anything
this package didn't anticipate is a local `register` call rather than a change here.

## Usage

```ts
// src/app.ts
import { randomUUID } from "node:crypto";
import fastify from "fastify";
import { basePlugin, loadConfig, loggerOptions, z } from "@repo/fastify-base";

export const config = loadConfig({ DATABASE_URL: z.url() });

export async function buildServer() {
  const server = fastify({
    logger: loggerOptions(config),
    trustProxy: config.TRUST_PROXY,
    bodyLimit: config.BODY_LIMIT,
    genReqId: (req) => {
      const header = req.headers["x-request-id"];
      if (typeof header !== "string") return randomUUID();
      // Node joins repeated headers with a comma; keep the upstream-most id.
      const first = header.split(",", 1).join("").trim();
      return first === "" ? randomUUID() : first;
    },
  });

  await server.register(basePlugin, { config });

  server.get("/ping", async () => "pong\n");
  return server;
}
```

Route schemas are Zod, with request and reply types inferred:

```ts
import { CreateUserSchema, UserSchema } from "@repo/schemas";
import type { ZodTypeProvider } from "@repo/fastify-base";

server
  .withTypeProvider<ZodTypeProvider>()
  .post(
    "/users",
    { schema: { body: CreateUserSchema, response: { 201: UserSchema } } },
    async (req, reply) => reply.code(201).send({ id: randomUUID(), ...req.body }),
  );
```

```ts
// src/index.ts
import { startService } from "@repo/fastify-base";
import { buildServer, config } from "./app.ts";

await startService(await buildServer(), config);
```

## Exports

| Export                         | Purpose                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `loadConfig(extra?)`           | Validates `process.env` against the base schema plus your service's own properties. Throws at boot on bad input. |
| `loggerOptions(config)`        | Pino options, or `false` under `NODE_ENV=test` so test output stays readable.                                    |
| `basePlugin`                   | Registers everything below. Options: `{ config, healthCheck? }`.                                                 |
| `startService(server, config)` | Graceful shutdown + listen.                                                                                      |
| `z`                            | Re-exported from `zod`, so services don't need their own dependency.                                             |
| `ZodTypeProvider`              | Type-only. Pass to `.withTypeProvider<…>()` for inferred request and reply types.                                |

## What `basePlugin` registers

`@fastify/sensible` (`httpErrors`), `@fastify/helmet`, `@fastify/cors` (only when `CORS_ORIGIN` is
set), `@fastify/rate-limit`, `fastify-metrics`, and `@fastify/under-pressure`.

## Endpoints

| Route      | Meaning                                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/livez`   | Is the process wedged? Checks **no** dependencies on purpose, and keeps answering 200 under pressure — otherwise one database blip restarts every pod at once. |
| `/readyz`  | Can it serve traffic? Answers 503 when your `healthCheck` fails or the event loop saturates. This is the one the load balancer should poll.                    |
| `/metrics` | Prometheus exposition, including `http_request_duration_seconds` per route. Also answers under pressure, since that is when you most want to scrape it.        |

All three are exempt from rate limiting — probes have to answer while the service is shedding load.

When the service is unhealthy, ordinary routes answer `503` with a `Retry-After` header. The health
check runs on an interval (5s) rather than per request, so readiness can lag a dependency outage by
up to that long — the trade for not hammering dependencies on every probe.

## Environment

| Var                 | Type                                    | Default         |
| ------------------- | --------------------------------------- | --------------- |
| `NODE_ENV`          | `development` \| `test` \| `production` | `development`   |
| `HOST`              | string                                  | `0.0.0.0`       |
| `PORT`              | number                                  | `8080`          |
| `LOG_LEVEL`         | `fatal`…`trace`                         | `info`          |
| `SHUTDOWN_GRACE_MS` | number                                  | `10000`         |
| `TRUST_PROXY`       | boolean                                 | `false`         |
| `CORS_ORIGIN`       | comma-separated origins, or `*`         | `""` (CORS off) |
| `RATE_LIMIT_MAX`    | number                                  | `100`           |
| `RATE_LIMIT_WINDOW` | string                                  | `1 minute`      |
| `BODY_LIMIT`        | bytes                                   | `1048576`       |

Set `TRUST_PROXY=true` behind a load balancer. Without it `req.ip` is the proxy's address, which
makes rate limiting treat your entire fleet as a single client.

## Notes for maintainers

- **`exposeStatusRoute: false` on under-pressure is load-bearing.** Its built-in status route
  carries a plain JSON Schema response, and the Zod serializer throws on non-Zod schemas instead of
  falling back — it would answer `500 FST_ERR_FAILED_ERROR_SERIALIZATION`. This package owns
  `/readyz` and `/livez` instead, with Zod schemas.
- **under-pressure must stay on the service instance, never an encapsulated child.** Its
  `onRequest` hook is scoped to the context it is registered in. Registering it on a child fixes the
  serialization conflict but silently disables load shedding: service routes keep answering 200
  while the process is overloaded or a dependency is down. There is a test for this
  (`sheds load on service routes when unhealthy`) because nothing else surfaces it.
- **Probe exemption is deliberate.** `/livez` and `/metrics` bypass pressure shedding via
  `pressureHandler`. Failing liveness during a dependency outage restarts every pod at once, and
  metrics matter most while the service is struggling. `/readyz` is _not_ exempt — that is what
  makes it a readiness signal.
- **`@fastify/swagger` and `openapi-types` are installed but never registered.** They are hard peers
  of `@fastify/type-provider-zod` (it declares no `peerDependenciesMeta`). Every route this package
  registers now carries a Zod schema, so a future Swagger setup has no JSON-Schema routes to work
  around.
- **Env coercion is explicit.** Zod does not coerce the way ajv did, so every non-string env var a
  service adds needs `z.coerce.number()`, `z.stringbool()`, or similar. A plain `z.number()` will
  always fail, because `process.env` values are strings.
- `.env` loading uses Node's built-in `process.loadEnvFile()`, which throws `ENOENT` when the file
  is absent — the normal case in CI. `loadConfig` swallows exactly that error and nothing else.

- `fastify-metrics` is imported as `metricsModule.default` deliberately. It's CJS, so Node's ESM
  interop makes the plain default import the whole `module.exports`. Fastify's `register` unwraps
  it at runtime, which hides the problem — `tsc` does not.
- `clearRegisterOnInit: true` is required on the metrics plugin because prom-client's registry is
  global; a second server in the same process throws without it.
- Tests must close their servers. `under-pressure`'s `healthCheckInterval` holds a timer that keeps
  the process alive.
