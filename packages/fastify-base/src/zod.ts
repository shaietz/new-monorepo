import fp from "fastify-plugin";
import { serializerCompiler, validatorCompiler } from "@fastify/type-provider-zod";

/** Makes Zod the schema language for every route. Register before any route is declared. */
export const zodPlugin = fp(
  async (fastify) => {
    fastify.setValidatorCompiler(validatorCompiler);
    fastify.setSerializerCompiler(serializerCompiler);
  },
  { name: "zod" },
);

/** Pass to `.withTypeProvider<…>()` for inferred request and reply types. */
export type { ZodTypeProvider } from "@fastify/type-provider-zod";

/** The route plugin signature, with Zod wired into the schema types. */
export type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
