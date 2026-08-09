# server

A Fastify 5 service built on [`@repo/fastify-base`](../../packages/fastify-base/README.md).

## Scripts

| Script          | What it does                                           |
| --------------- | ------------------------------------------------------ |
| `dev`           | `node --watch src/index.ts` — restarts on change.      |
| `start`         | `node src/index.ts` — production entry, no build step. |
| `test`          | Vitest, once.                                          |
| `test:watch`    | Vitest in watch mode.                                  |
| `test:coverage` | Vitest with v8 coverage, gated at 80%.                 |
| `check-types`   | `tsc`.                                                 |

There is no `build`. Node 24 strips TypeScript types at load, so `src/index.ts` runs directly —
including from a container.

## Environment

`loadConfig()` validates `process.env` at boot and throws on anything invalid, so a misconfigured
service fails immediately instead of at the first request. Every variable and its default is listed
in `.env.example`; copy it to `.env` to get started. `.env` is gitignored, and `process.loadEnvFile()`
tolerates it being absent, which is the normal case in CI.

To add a service-specific variable, pass it to `loadConfig`:

```ts
import { loadConfig } from "@repo/fastify-base";
import { z } from "zod";

export const config = loadConfig({
  DATABASE_URL: z.url(),
  MAX_RETRIES: z.coerce.number().default(3),
});
```

Add `zod` to this workspace's dependencies when you do — `@repo/fastify-base` declares it as a peer
rather than re-exporting it, so a service never ends up with a second copy.

`config` is fully typed from that call. **Coercion is explicit** — `process.env` values are always
strings, so a plain `z.number()` always fails; use `z.coerce.number()` or `z.stringbool()`.

Give a variable a default only when the fallback is safe everywhere. A connection string is not:
defaulting it to localhost turns "deployed without configuration" from a crash at boot into a
service that starts and quietly fails readiness.

## Endpoints

`GET /ping` is this service's own. The rest come from `basePlugin`:

| Route      | Purpose                                                                             |
| ---------- | ----------------------------------------------------------------------------------- |
| `/livez`   | Liveness. Checks no dependencies, and keeps answering 200 even while shutting down. |
| `/readyz`  | Readiness. 503 when the health check fails, times out, or the service is draining.  |
| `/metrics` | Prometheus exposition, including per-route request durations.                       |
| `/docs`    | OpenAPI UI, only when `ENABLE_DOCS=true`.                                           |

Point the load balancer at `/readyz`, not `/livez`.

## Routes

Route schemas are Zod, with request and reply types inferred from them:

```ts
import type { ZodTypeProvider } from "@repo/fastify-base";

server
  .withTypeProvider<ZodTypeProvider>()
  .post(
    "/things",
    { schema: { body: ThingSchema, response: { 201: ThingSchema } } },
    async (req, reply) => reply.code(201).send(await create(req.body)),
  );
```

A schema a client also needs belongs in a shared workspace package tagged `isomorphic`, so both
sides agree on one definition rather than drifting apart.

## Boundaries

`turbo.json` tags this workspace `["app", "node"]`. Nothing may depend on an app, and a `node`
workspace may not depend on a `browser` one — `npm run boundaries` enforces both.
