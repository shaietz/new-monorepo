import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { jsonSchemaTransform } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";

import type { BaseConfig } from "./env.ts";

const DOCS_PATH = "/docs";

/**
 * OpenAPI generated from the Zod schemas routes already carry, so documentation cannot drift from
 * validation. Off by default: the spec describes the whole API surface, which is not something to
 * publish from a production instance without deciding to.
 *
 * Must run before any route is registered — `@fastify/swagger` collects routes through an `onRoute`
 * hook, and only sees the ones declared after it. `basePlugin` is unencapsulated, so routes a
 * service adds later are still picked up.
 */
export async function registerDocs(
  server: FastifyInstance,
  config: BaseConfig,
  name: string,
): Promise<void> {
  if (!config.ENABLE_DOCS) return;

  await server.register(swagger, {
    openapi: { info: { title: name, version: "1.0.0" } },
    transform: jsonSchemaTransform,
  });

  await server.register(swaggerUi, { routePrefix: DOCS_PATH });
}
