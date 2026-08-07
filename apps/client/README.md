# client

A React 19 + Vite single-page app.

## Scripts

| Script          | What it does                                   |
| --------------- | ---------------------------------------------- |
| `dev`           | Vite dev server with HMR.                      |
| `build`         | `tsc -b` then `vite build`, output in `dist/`. |
| `preview`       | Serve the built `dist/` locally.               |
| `test`          | Vitest, once.                                  |
| `test:watch`    | Vitest in watch mode.                          |
| `test:coverage` | Vitest with v8 coverage.                       |
| `check-types`   | `tsc -b` across both project references.       |

Run them from the repo root with `npm run <script> -w client`, or through turbo
(`npx turbo run test --filter=client`).

## Tests

Config lives in the `test` block of `vite.config.ts`, not a separate `vitest.config.ts`, so tests
run through the same plugin pipeline as the app. Environment is `jsdom`; `src/test-setup.ts` wires
up `@testing-library/jest-dom` matchers and an `afterEach(cleanup)` — that cleanup is not automatic
here, because the root config does not enable Vitest globals.

**Coverage is gated at 80%** (lines, functions, branches, statements). `main.tsx` and the setup file
are excluded; everything else under `src/` counts.

Use `@testing-library/user-event` for anything involving clicks, typing, or focus — it is installed,
and `App.test.tsx` has a worked example. Prefer it over `fireEvent`: it dispatches the full sequence
of events a real interaction produces, so it catches things `fireEvent` walks straight past.

Note that `npm run knip` fails on unused dependencies, so a package added here and left unimported
will break the build rather than sit quietly.

## Types

Two tsconfigs, referenced from `tsconfig.json`:

- `tsconfig.app.json` — `src/`, extends `@repo/typescript-config/react.json` (`types: ["vite/client"]`)
- `tsconfig.node.json` — `vite.config.ts`, extends `@repo/typescript-config/node.json` (`types: ["node"]`)

The split is deliberate: it means `src/` cannot reach for Node APIs, while `vite.config.ts` still
can (`node:path` for `resolve.alias`, and so on).

## Boundaries

`turbo.json` tags this workspace `["app", "browser"]`. Nothing may depend on an app, and a `browser`
workspace may not depend on a `node` one — `npm run boundaries` enforces both.
