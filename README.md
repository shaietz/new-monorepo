# new-monorepo

A Turborepo housing multiple Fastify services and multiple React clients, with shared packages
between them.

Requires **Node >= 24** and **npm 11**. Node 24 strips TypeScript types at load, and Vite compiles
the browser side, so shared packages ship TypeScript source with **no build step**.

## Workspaces

```
apps/
  client                    React 19 + Vite SPA                      [app, browser]
  server                    Fastify 5 service                        [app, node]
packages/
  @repo/fastify-base        env validation, security, health,        [node]
                            metrics, graceful shutdown
  @repo/typescript-config   base / node / react / library tsconfigs  [config]
```

The `isomorphic` tag has no members yet. It is the slot for code shared between a client and a
service — Zod schemas being the obvious case — and `library.json` is the tsconfig to build it on.

`apps/client` and `apps/server` are deliberately bare. The [generators](#generators) were cut from
them, and `turbo/generators/templates/` still mirrors them file for file — so anything added here
should be added there too, and it then lands in every future app.

## Getting started

```sh
npm install
cp apps/server/.env.example apps/server/.env
npx turbo run dev
```

## Scripts

| Script                                  | What it does                                      |
| --------------------------------------- | ------------------------------------------------- |
| `npm run gen`                           | Scaffold a new app or package. See below.         |
| `npm run dev`                           | Every workspace's dev task, in parallel.          |
| `npm run build`                         | Build tasks, respecting the dependency graph.     |
| `npm test`                              | Vitest across every workspace.                    |
| `npm run check-types`                   | `tsc` across every workspace.                     |
| `npm run lint` / `lint:fix` / `lint:ci` | oxlint; `lint:ci` fails on warnings.              |
| `npm run format` / `format:fix`         | oxfmt.                                            |
| `npm run syncpack`                      | One version per dependency across all workspaces. |
| `npm run knip`                          | Unused files, exports and dependencies.           |
| `npm run boundaries`                    | Enforce the dependency rules below.               |

Run a single workspace with `npm run <script> -w <name>` or `npx turbo run <task> --filter=<name>`.

Tests can also be run from the root as one Vitest run — `vitest.config.ts` aggregates every
workspace via `projects: ["apps/*", "packages/*"]`, which is why each workspace's `test.name`
must be unique.

## Boundaries

`turbo.json` assigns each workspace tags, and `npm run boundaries` enforces them:

| Tag          | Rule                                           |
| ------------ | ---------------------------------------------- |
| `app`        | Nothing may depend on it — apps are leaves.    |
| `browser`    | May not depend on `node`.                      |
| `node`       | May not depend on `browser`.                   |
| `isomorphic` | May depend on neither — it has to run in both. |
| `config`     | No restrictions.                               |

`app` is stated as `dependents: { allow: [] }` rather than being listed in three separate denylists.
It covers app → app, package → app, and any tag added later, in one place.

Boundaries are about the dependency graph. **Environment is enforced separately, by tsconfig** —
`@repo/typescript-config/react.json` sets `types: ["vite/client"]`, `node.json` sets `types: ["node"]`,
and `library.json` sets `types: []`, so `tsc` rejects `process` or `node:fs` in browser and
isomorphic code.

## Conventions

Root configs name **zero packages**. `.oxlintrc.json`, `turbo.json` and `knip.json` match by glob
and convention, so a new workspace is picked up without editing anything at the root. Keep it that
way.

Every workspace with tests defines `test`, `test:watch` and `test:coverage`, and gates coverage at
80%. Every workspace defines `check-types`. Each workspace's Vitest `test.name` must stay unique —
the [generators](#generators) enforce that by refusing a name that already exists in either
workspace directory.

## Hooks

`pre-commit` runs lint-staged (oxlint `--fix`, then oxfmt). `pre-push` runs `turbo run check-types`.

## Generators

Three generators scaffold a complete workspace — Dockerfile, tests, coverage gates, boundary tags,
README — and run `npm install`, so the result passes the whole CI gate and is deployable from the
moment it exists.

```sh
npm run gen                      # pick from a list
npx turbo gen react-app          # or name one directly
npx turbo gen fastify-service
npx turbo gen package
```

| Generator         | Creates           | Tags                  | Prompts                                                |
| ----------------- | ----------------- | --------------------- | ------------------------------------------------------ |
| `react-app`       | `apps/<name>`     | `["app","browser"]`   | name                                                   |
| `fastify-service` | `apps/<name>`     | `["app","node"]`      | name, port (next free is suggested), redis?, postgres? |
| `package`         | `packages/<name>` | environment-dependent | name, environment                                      |

`package` asks where the code runs, which picks the tsconfig base and the boundary tag:

| Environment  | `tsconfig` extends                     | Tags             |
| ------------ | -------------------------------------- | ---------------- |
| `isomorphic` | `@repo/typescript-config/library.json` | `["isomorphic"]` |
| `node`       | `@repo/typescript-config/node.json`    | `["node"]`       |
| `browser`    | `@repo/typescript-config/react.json`   | `["browser"]`    |

Apps are unscoped and named after their directory; packages are imported as `@repo/<name>` — you
type the bare name and the scope is added for you. Names must be kebab-case and must not already
exist under `apps/` **or** `packages/`: the two share a namespace because a workspace's Vitest
`test.name` is the bare name either way, and the root run aggregates both.

`fastify-service` reads `PORT` out of every `apps/*/.env.example`, offers the lowest free port from
8080 up, and refuses one that is taken — naming the app that holds it. The port also becomes
`ENV PORT`, `EXPOSE` and the healthcheck target in the generated Dockerfile, so the image's declared
port is the one it actually listens on.

It also asks whether the service needs a Redis client or a Postgres client — independently, so you
can have neither, either, or both. Saying yes adds the dependency, the env vars, a `src/<store>.ts`
holding the connection options and a health probe, its tests, and a `healthCheck` wired into
`/readyz` through `basePlugin`. Saying no to both produces exactly what the generator produced
before the options existed.

| Answer     | Adds                                                                       |
| ---------- | -------------------------------------------------------------------------- |
| `redis`    | `@fastify/redis` + `REDIS_URL`, decorating the server with `server.redis`. |
| `postgres` | `@fastify/postgres` + `pg`, `DATABASE_URL`, `PG_POOL_MAX` → `server.pg`.   |

`buildServer` then takes a `ServerOverrides` argument so tests can inject stand-in clients — which
is what lets a generated service's suite run with no Redis or Postgres anywhere. Note that
`@fastify/redis` waits for its connection during registration, so a service with Redis enabled will
not start at all while Redis is down.

Answers can be passed positionally for scripting, in prompt order:
`npx turbo gen fastify-service --args orders 8082 no yes`. Confirmations take `yes`/`no` (or
`true`/`false`), and `_` in any position means "ask me for this one". Validation still runs.

Nothing at the root needs editing afterwards. `.oxlintrc.json`, `turbo.json`, `knip.json`, the root
`vitest.config.ts` and the `Jenkinsfile` all pick the new workspace up by glob and convention.

### Editing the generators

`turbo/generators/config.ts` wires up templates under `turbo/generators/templates/`.

- Template files are suffixed `.hbs`, which `addMany` strips. **`Dockerfile` is the exception** — it
  is stored unsuffixed, because plop only strips `.hbs` when the remaining name still has an
  extension. It is rendered through Handlebars all the same.
- The suffix is load-bearing: it is what hides templates from oxlint, knip, `tsc` and Vitest.
  `.oxfmtrc.json` has to exclude them explicitly, though — oxfmt formats by content, not extension,
  and will happily reflow a template into rubble.
- Content that needs a literal `{{` has to escape it as `\{{`, or sit inside a
  `{{{{raw}}}}…{{{{/raw}}}}` block.
- Optional files — `src/redis.ts.hbs` and friends — live in the same template directory as
  everything else and are dropped from `globOptions.ignore` when the answer is no. `addMany` writes
  everything it globs, so filtering the glob is what makes a file conditional.
- Handlebars sees the prompt answers directly, so a template can say `{{#if redis}}`. Anything
  derived has to come through an action's `data`, and plop **silently drops `data` keys that collide
  with an answer** and deletes the rest once the action finishes. There is no `or`/`and` helper
  registered, which is why `hasDataStore` is computed in `config.ts` rather than in the template.
- Generated output is checked by oxfmt even though templates are not, so a conditional block has to
  render the way oxfmt would format it — an array that fits on one line must be written on one line.
- Third-party dependency versions in `package.json.hbs` must match the rest of the repo or
  `npm run syncpack` fails on the next generated workspace. Bump them alongside the repo's.
- `config.ts` is bundled to CommonJS by esbuild before it runs, so it must avoid top-level `await`
  and may import `@turbo/gen` for types only. A bundling failure is swallowed and resurfaces as an
  unrelated-looking require error.
- Keep `turbo` and `@turbo/gen` on the same version; `turbo gen` execs the matching `@turbo/gen`,
  and a mismatch silently downloads a second copy through npx.
