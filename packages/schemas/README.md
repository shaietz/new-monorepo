# `@repo/schemas`

Zod schemas shared between services and clients, so both sides agree on what valid data is.

```ts
import { CreateUserSchema, UserSchema, createUserErrors } from "@repo/schemas";
```

**Server** — drive route validation with them via `@repo/fastify-base`'s Zod type provider:

```ts
server
  .withTypeProvider<ZodTypeProvider>()
  .post(
    "/users",
    { schema: { body: CreateUserSchema, response: { 201: UserSchema } } },
    async (req, reply) => reply.code(201).send({ id: randomUUID(), ...req.body }),
  );
```

**Client** — validate form input with the same definition:

```ts
const errors = createUserErrors(values); // field-keyed, or undefined when valid
```

## Rules for this package

- **Stay isomorphic.** The tsconfig extends `@repo/typescript-config/library.json`, which sets
  `types: []`. Node built-ins won't compile here, and that's deliberate — everything in this package
  ends up in the browser bundle.
- **Keep it to schemas and pure helpers.** No HTTP clients, no environment access, no framework
  imports. Anything that can't run in both a browser and Node belongs in the consuming app.
- Ships TypeScript source with no build step. Node strips types for services; Vite resolves the
  source directly for the client.
