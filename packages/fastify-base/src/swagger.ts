import fp from "fastify-plugin";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { jsonSchemaTransform } from "@fastify/type-provider-zod";

const DOCS_PATH = "/docs";

/**
 * OpenAPI generated from the Zod schemas routes already carry, so docs cannot drift from validation.
 *
 * `@fastify/swagger` is always registered — it serves nothing, it only decorates `fastify.swagger()`
 * — so the spec is available to assert against even when docs are off. `ENABLE_DOCS` gates the UI,
 * which is the part that actually publishes the API surface.
 */
export const swaggerPlugin = fp(
  async (fastify) => {
    await fastify.register(swagger, {
      openapi: { info: { title: fastify.serviceName, version: "1.0.0" } },
      transform: jsonSchemaTransform,
    });

    if (!fastify.config.ENABLE_DOCS) return;

    await fastify.register(swaggerUi, { routePrefix: DOCS_PATH });
  },
  { name: "swagger" },
);
