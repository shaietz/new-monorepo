# `@repo/fastify-base`

The production baseline every Fastify service in this monorepo builds on: validated environment
config, one error shape, security middleware, health probes, Prometheus metrics, optional OpenAPI,
and a shutdown that does not drop traffic.

This is a **library, not a framework**: it exports plugins and helpers, and the service constructs
its own Fastify instance and owns its lifecycle. `basePlugin` bundles the fixed part of the stack —
the twelve registrations whose order is load-bearing and identical in every service — but it is one
export among many, not a wrapper you have to go through. Every plugin it registers is also exported
individually, and swapping to that list is a documented, tested path.

Conventions follow [`fastify-cli`](https://github.com/fastify/fastify-cli) and the
[official demo](https://github.com/fastify/demo): `app.ts` is a plugin, `index.ts` constructs the
instance and owns the lifecycle.

## Usage

```ts
// src/app.ts
import { join } from "node:path";
import autoload from "@fastify/autoload";
import fp from "fastify-plugin";
import { z } from "zod";
import { basePlugin, loadConfig, serverOptions } from "@repo/fastify-base";

const NAME = "orders";

const extraEnv = { DATABASE_URL: z.url() };
export const config = loadConfig(extraEnv);
export const options = serverOptions(config, NAME);

type ExtraEnv = z.infer<z.ZodObject<typeof extraEnv>>;

declare module "fastify" {
  interface FastifyConfig extends ExtraEnv {}
}

export default fp(
  async function app(fastify) {
    await fastify.register(basePlugin, { config, name: NAME });

    await fastify.register(autoload, {
      dir: join(import.meta.dirname, "routes"),
      options: {}, // required — see Notes for maintainers
      autoHooks: true,
      cascadeHooks: true,
    });
  },
  { name: `${NAME}-app` },
);
```

### What `basePlugin` is

Exactly this, and nothing else. To change one of these defaults — helmet with a custom CSP, your own
error handler — paste this list into your `app.ts` in place of the `basePlugin` line and edit it
there. Nothing else changes, and no fork of this package is involved:

```ts
await fastify.register(configPlugin, { config, name: NAME });
await fastify.register(zodPlugin);
await fastify.register(requestIdPlugin);
await fastify.register(healthRegistryPlugin);

await fastify.register(sensible);
await fastify.register(helmet);
await fastify.register(corsPlugin);
await fastify.register(rateLimit, rateLimitOptions(config));

await fastify.register(metricsPlugin); // before swagger, to keep /metrics out of the spec
await fastify.register(swaggerPlugin); // before routes, it only documents what follows

await fastify.register(errorHandlerPlugin);
await fastify.register(healthPlugin);
```

`test/fixtures/explicit-app.ts` is that list, and `contract.test.ts` asserts it satisfies the same
contract as `basePlugin` — so this escape hatch is tested, not just promised.

`basePlugin` deliberately does **not** register `@fastify/autoload` or any service plugin. Those are
the parts whose order actually varies, so they stay visible in the service.

```ts
// src/index.ts — the lifecycle
import Fastify from "fastify";
import closeWithGrace from "close-with-grace";
import app, { config, options } from "./app.ts";

const fastify = Fastify(options);
fastify.register(app);

closeWithGrace({ delay: config.SHUTDOWN_GRACE_MS }, async ({ err, signal }) => {
  if (err) fastify.log.error({ err }, "shutting down after error");
  else fastify.log.info({ signal }, "graceful shutdown started");

  await fastify.close();
});

try {
  await fastify.listen({ port: config.PORT, host: config.HOST });
} catch (err) {
  fastify.log.error({ err }, "failed to start");
  process.exit(1);
}
```

`app.ts` wraps itself in `fastify-plugin`, so `register(app)` is correct at every call site — without
it the error handler and schema compilers would apply to a throwaway child scope instead of the root.

Add `await expectBaseContract(...)` to the service's tests; see [Testing](#testing).

## Layout

A **service** puts everything autoloadable under `src`, and its tests in a sibling `test/` that
mirrors it:

```
src/
  index.ts               entry point
  app.ts                 config + build()
  plugins/external/      third-party wiring
  plugins/app/           reusable support — repositories, decorators
  routes/                the API surface; directory names are URL prefixes
  schemas/               Zod schemas shared between routes
test/                    mirrors src/; never inside it
```

Tests stay out of `src`: autoload matches `foo.test.ts` as readily as `foo.ts`, so a colocated test
beside a route would be registered as a route.

**This package** is flat — one file per registerable unit, each named after what it exports:

```
src/
  base.ts                basePlugin — the twelve registrations above
  config.ts              loadConfig, the FastifyConfig augmentation, configPlugin
  server-options.ts      constructor options: logger, timeouts, genReqId
  request-id.ts          the genReqId function and the header-echo plugin
  zod.ts                 the schema compilers and the Zod type exports
  health.ts              the probe registry, /livez, /readyz
  metrics.ts             /metrics
  rate-limit.ts          rateLimitOptions and the exempt-route list
  cors.ts  swagger.ts  error-handler.ts
  index.ts               public API      testing.ts  public test harness
```

"Where does `swaggerPlugin` live?" is always `swagger.ts`. A file owns both halves of its concern —
`request-id.ts` has the id generator _and_ the plugin that echoes it; `health.ts` has the registry
_and_ the routes that read it — so nothing is half-findable. `rate-limit.ts` imports the three paths
it exempts from the files that own them.

A file exists when it holds a decision: `cors` parses `CORS_ORIGIN`, `swagger` gates the UI on
`ENABLE_DOCS`. `sensible` and `helmet` have none, so `base.ts` registers those packages directly
rather than through wrappers that add nothing.

## Load order

Steps 1-5 are what `basePlugin` does internally; 6 and 7 stay in the service. The constraints are
real and mostly silent when broken — `expectBaseContract` asserts each of them, so a reordering
fails a test rather than quietly changing behaviour:

| Order | What                                                                   | Why here                                                                   |
| ----- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1     | `configPlugin`, `zodPlugin`, `requestIdPlugin`, `healthRegistryPlugin` | Everything below reads `fastify.config`; compilers must precede any route. |
| 2     | `sensible`, `helmet`, `corsPlugin`, `rateLimit`                        | Third-party wiring. Rate limit decorates `fastify.rateLimit`.              |
| 3     | `metricsPlugin`                                                        | Above swagger on purpose, so `/metrics` stays out of the spec.             |
| 4     | `swaggerPlugin`                                                        | Only documents routes registered after it.                                 |
| 5     | `errorHandlerPlugin`, `healthPlugin`                                   | 404 handler needs `fastify.rateLimit`; probes need to reach the spec.      |
| 6     | the service's own plugins                                              | Registered explicitly, so they take ordinary options.                      |
| 7     | the service's `routes/`, with `autoHooks` and `cascadeHooks`           | Last, for the same reason swagger is early.                                |

Routes are autoloaded; plugins are not. Route files need no options and directory-as-prefix is
genuinely useful. Plugins need options — and autoload cannot pass any, which is the whole reason
they are registered by hand.

## Writing a plugin

This is about a **service's** plugins — the autoloaded ones. Export the plugin bare when the
upstream package is already `fp`-wrapped, and add `autoConfig` — an object, or a callback reading
`fastify.config`:

```ts
// plugins/external/rate-limit.ts
export const autoConfig = (fastify: FastifyInstance) => ({ max: fastify.config.RATE_LIMIT_MAX });
export default rateLimit;
```

Wrap in `fastify-plugin` instead when the file decorates something itself, and declare
`{ name, dependencies }` there so an unmet dependency fails at boot. Route plugins are **never**
wrapped — encapsulation is what keeps one route's hooks out of every other route.

A service cannot replace one of this package's plugins by adding a file of the same name; that
registers it twice rather than overriding it. To change one, expand `basePlugin` into its individual
registrations in your `app.ts` and edit the line you care about — see
[What `basePlugin` is](#what-baseplugin-is).

Route schemas are Zod, with request and reply types inferred:

```ts
// routes/users/index.ts  →  /users
import type { FastifyPluginAsyncZod } from "@repo/fastify-base";

const CreateUser = z.object({ email: z.email(), displayName: z.string().min(1) });
const User = CreateUser.extend({ id: z.uuid() });

const users: FastifyPluginAsyncZod = async (fastify) => {
  fastify.post("/", { schema: { body: CreateUser, response: { 201: User } } }, async (req, reply) =>
    reply.code(201).send({ id: randomUUID(), ...req.body }),
  );
};

export default users;
```

Schemas a client also needs belong in a shared workspace package rather than inline here, so both
sides agree on one definition.

## Exports

| Export                                                                               | Purpose                                                                                     |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `basePlugin`                                                                         | The whole fixed stack in one registration. What a service normally uses.                    |
| `loadConfig(extra?)`                                                                 | Validates `process.env` against the base schema plus your own. Throws at boot on bad input. |
| `serverOptions(config, name)`                                                        | Constructor options — logger, `trustProxy`, `bodyLimit`, `genReqId`, socket timeouts.       |
| `configPlugin`, `zodPlugin`, `requestIdPlugin`, `healthRegistryPlugin`               | The bootstrap layer. Register in that order, first.                                         |
| `corsPlugin`, `metricsPlugin`, `swaggerPlugin`, `errorHandlerPlugin`, `healthPlugin` | The rest of the stack.                                                                      |
| `rateLimitOptions(config)`                                                           | Options for `@fastify/rate-limit`, read off the parsed config.                              |
| `LIVEZ_PATH`, `READYZ_PATH`, `METRICS_PATH`                                          | The routes this package owns.                                                               |
| `ZodTypeProvider`, `FastifyPluginAsyncZod`                                           | Type-only. Zod wired into the request, reply and schema types.                              |

Everything from `configPlugin` down is what `basePlugin` registers — exported so a service can take
the list over when it needs to change one of them.

`@repo/fastify-base/testing` additionally exports `expectBaseContract` and `buildWithPlugin`.

`zod` is a **peer dependency**, not a re-export: services declare it themselves. Two copies of Zod in
one process produce schemas that silently fail each other's validation, and syncpack keeps the
versions aligned anyway.

## What this package registers

A service registering `basePlugin` gets `@fastify/sensible` (`httpErrors`), `@fastify/helmet`,
`@fastify/cors` (only when `CORS_ORIGIN` is set), `@fastify/rate-limit`, `@fastify/swagger` and
`fastify-metrics` — plus the error handlers, health routes and the `x-request-id` response header
described below. These are dependencies of this package, so a service does not declare them itself.

The instance is decorated with `config` (the parsed environment), `serviceName`, `addHealthCheck`
and `checkHealth`.

## What `serverOptions` sets

`Fastify(options)` hides these behind one call, so here they are. Override any of them at the call
site — `Fastify({ ...options, bodyLimit: 5_000_000 })` — which keeps the change visible in the
service rather than forking the defaults.

| Option                     | Value                    | Why                                                                                |
| -------------------------- | ------------------------ | ---------------------------------------------------------------------------------- |
| `logger`                   | pino, or `false` in test | Labelled with the service name; credential headers redacted; pretty only on a TTY. |
| `genReqId`                 | `requestId`              | Propagates an upstream `x-request-id`, or mints a UUID.                            |
| `trustProxy` / `bodyLimit` | from config              | `TRUST_PROXY`, `BODY_LIMIT`.                                                       |
| `keepAliveTimeout`         | 72s                      | Must exceed an ALB's 60s idle timeout, or you get sporadic unreproducible 502s.    |
| `requestTimeout`           | 30s                      | A request still on the wire after this will not finish usefully.                   |
| `connectionTimeout`        | 120s                     | Bounds how long a socket can be held without completing a request.                 |
| `http.headersTimeout`      | 15s                      | The other half of that bound — slowloris.                                          |

These live here rather than in each service because they are values with reasons, not composition:
duplicating them means duplicating the reasoning, and someone eventually "tidies" the 72s down to 30
and reintroduces the 502s.

## Health checks

`/readyz` runs a registry rather than a single injected function, because the plugin that owns a
connection is autoloaded long after the app was constructed. Whatever owns the client contributes
the probe:

```ts
// plugins/external/postgres.ts
fastify.addHealthCheck("postgres", () => fastify.pg.query("SELECT 1"));
```

Every registered probe runs per request under one shared `HEALTH_TIMEOUT_MS` deadline. Rejecting is
how a dependency reports an outage; the resolved value is ignored.

## Testing

Build the service the way production does and use `inject()` — no listening socket:

```ts
const fastify = Fastify(options);
await fastify.register(app, { pg: stubModule }); // ordinary plugin options
```

Awaiting `register` boots the plugin but leaves the instance open, so a test can still add routes.
To silence pino for a suite that provokes errors, construct with `Fastify({ ...options, logger: false })`.

**`expectBaseContract(fastify)`** is the important one. It asserts the behaviour that would otherwise
fail silently — and it matters most for a service that has expanded `basePlugin` into its own list,
where a missing or misordered plugin becomes possible again: the probes and their bodies, the shared error shape, `x-request-id` on a normal response
and on a shed one, helmet's headers, and that the OpenAPI spec contains the probes but not
`/metrics`. One line per service:

```ts
it("satisfies the base contract", async () => {
  const fastify = Fastify(options);
  await fastify.register(app);
  await expectBaseContract(fastify);
});
```

**`buildWithPlugin(plugin, { options })`** registers one plugin on top of the bootstrap layer and
nothing else, so an undeclared dependency fails there rather than as a boot error in the full app.

Every service's `vitest.config.ts` must carry:

```ts
server: { deps: { inline: [/@fastify\/autoload/] } },
```

Without it autoload imports each route outside Vitest's module graph, and coverage for every
autoloaded file is measured against a copy that never ran — 0% for code the tests do exercise. The
generator emits this; a hand-written service needs it too.

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

| Route      | Meaning                                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/livez`   | Is the process wedged? Checks **no** dependencies on purpose — otherwise one database blip restarts every pod at once.                                    |
| `/readyz`  | Can it serve traffic? 503 when a registered health check rejects or times out, or once shutdown has begun. This is the one the load balancer should poll. |
| `/metrics` | Prometheus exposition, including `http_request_duration_seconds` per route.                                                                               |
| `/docs`    | OpenAPI UI, only when `ENABLE_DOCS=true`.                                                                                                                 |

`/livez`, `/readyz`, and `/metrics` are exempt from rate limiting — probes and scrapes have to answer
while the service is shedding load.

The health check runs per request, under a `HEALTH_TIMEOUT_MS` deadline. A dependency that has
stopped answering usually hangs rather than refusing, and a probe that never settles reads as neither
healthy nor sick.

## Shutdown

A service owns its lifecycle in `index.ts` — `closeWithGrace` plus a `listen` — and calls
`fastify.close()` from the handler. Fastify stops accepting new connections and waits for in-flight
requests to finish before resolving, so nothing already in progress is dropped.

`SHUTDOWN_GRACE_MS` is close-with-grace's own deadline: if close hangs past it the process is
force-exited rather than left wedged.

There is deliberately **no pre-close delay**. Behind a load balancer there is a window where the
orchestrator still routes to a pod that has begun shutting down, and pausing before close would
cover it — but that belongs in a `preStop` hook or an app-level delay only once a deploy is
measurably dropping requests and the duration can be derived from the ingress. Wrap `listen` in a
try/catch that exits non-zero so a boot failure fails fast rather than leaving through the shutdown
path.

## Environment

| Var                 | Type                                    | Default         |
| ------------------- | --------------------------------------- | --------------- |
| `NODE_ENV`          | `development` \| `test` \| `production` | `development`   |
| `HOST`              | string                                  | `0.0.0.0`       |
| `PORT`              | number                                  | `8080`          |
| `LOG_LEVEL`         | `fatal`…`trace`                         | `info`          |
| `SHUTDOWN_GRACE_MS` | number                                  | `10000`         |
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

Most rationale lives next to the code it explains. These are the decisions that have no single
place in the source:

- **Load shedding is deliberately out of scope.** No `@fastify/under-pressure`, no event-loop
  monitoring — bound saturation at the ingress. If that changes, register it with
  `exposeStatusRoute: false`: its status route carries a plain JSON Schema response, and the Zod
  serializer throws on non-Zod schemas rather than falling back.
- **A route must never declare a response schema for an error status**, for the same reason. Declare
  success schemas only, so error bodies reach the default JSON serializer.
- **Env coercion is explicit.** `process.env` values are strings, so a plain `z.number()` always
  fails; use `z.coerce.number()` or `z.stringbool()`.
- **Give an env var a default only when the fallback is safe everywhere.** A connection string is
  not: defaulting it to localhost turns "deployed without configuration" from a crash at boot into a
  service that starts and quietly fails readiness.
- **Plugin order is asserted, not just commented.** A test checks that `/metrics` is absent from the
  OpenAPI spec while the probes are present, so reordering `base.ts` fails a test rather than quietly
  changing what you publish.
- **The escape hatch is tested, not just documented.** `test/fixtures/explicit-app.ts` wires the
  twelve plugins by hand and `contract.test.ts` holds it to the same contract as `basePlugin`. If an
  individual export stops composing on its own, that test fails. Keep the two in sync when changing
  `base.ts`.
