# `@repo/schemas`

```
this package will contain all the B2B & C2B schemas.  
```

## Usage

```ts
import { greeting } from "@repo/schemas";

greeting("world"); // "Hello, world!"
```

Add it to a workspace with `npm install @repo/schemas -w <that-workspace>`, which pins it at `*`
the way `npm run syncpack` requires for local packages.

## Scripts

| Script          | What it does                           |
| --------------- | -------------------------------------- |
| `test`          | Vitest, once.                          |
| `test:watch`    | Vitest in watch mode.                  |
| `test:coverage` | Vitest with v8 coverage, gated at 80%. |
| `check-types`   | `tsc`.                                 |

Run them from the repo root with `npm run <script> -w @repo/schemas`, or through turbo
(`npx turbo run test --filter=@repo/schemas`).

There is no `build`. The package ships TypeScript source — `exports` points straight at
`src/index.ts`, Node 24 strips the types at load, and Vite compiles it for the browser.

## Boundaries

`turbo.json` tags this workspace `["isomorphic"]`, and `npm run boundaries` enforces what that lets
it depend on.

An `isomorphic` workspace may depend on neither `node` nor `browser` — it has to run in both.
`tsconfig.json` extends `@repo/typescript-config/library.json`, so `types` is `[]` and `tsc` rejects
`process`, `node:fs` and `document` alike. This is where Zod schemas shared between a client and a
service belong.

## Exports

Everything public goes through `src/index.ts`. `npm run knip` runs with `includeEntryExports`, so an
export nothing imports is reported as dead code — tag a deliberate one `@public`, the way
[`@repo/fastify-base`](../fastify-base/src/index.ts) does.
