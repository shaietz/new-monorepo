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
  @repo/schemas             Zod schemas shared client <-> server     [isomorphic]
  @repo/typescript-config   base / node / react / library tsconfigs  [config]
```

`apps/client` and `apps/server` are deliberately bare. They are the sources the `turbo gen`
templates will be cut from, so anything added to them lands in every future app.

## Getting started

```sh
npm install
cp apps/server/.env.example apps/server/.env
npx turbo run dev
```

## Scripts

| Script                                  | What it does                                      |
| --------------------------------------- | ------------------------------------------------- |
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
80%. Every workspace defines `check-types`.

## Hooks

`pre-commit` runs lint-staged (oxlint `--fix`, then oxfmt). `pre-push` runs `turbo run check-types`.

## Adding an app

Generators are not built yet. Until they are, copy `apps/client` or `apps/server` and change:

| Seam                | Where                                                                              |
| ------------------- | ---------------------------------------------------------------------------------- |
| package name        | `package.json` → `name`                                                            |
| vitest project name | `test.name` — **must be unique**, or root runs collide                             |
| page title          | `apps/client/index.html` → `<title>`                                               |
| service port        | `apps/server/.env.example` → `PORT` — **8080 by default, so two services collide** |
| boundary tags       | `turbo.json` → `["app","browser"]` or `["app","node"]`                             |
