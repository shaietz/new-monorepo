import fp from "fastify-plugin";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";

import {
  configPlugin,
  corsPlugin,
  errorHandlerPlugin,
  healthPlugin,
  healthRegistryPlugin,
  metricsPlugin,
  rateLimitOptions,
  requestIdPlugin,
  swaggerPlugin,
  zodPlugin,
} from "../../src/index.ts";
import type { FixtureAppOptions } from "./app.ts";

/**
 * `basePlugin` expanded by hand — the escape hatch a service takes when it needs to change one of
 * the defaults. This exists so that path is tested rather than merely documented: if an individual
 * export stops composing, or the order in `basePlugin` drifts from what the individual plugins
 * require, `contract.test.ts` fails here.
 *
 * Keep in sync with `src/base.ts`.
 */
export default fp<FixtureAppOptions>(
  async (fastify, { config, name }) => {
    await fastify.register(configPlugin, { config, name });
    await fastify.register(zodPlugin);
    await fastify.register(requestIdPlugin);
    await fastify.register(healthRegistryPlugin);

    await fastify.register(sensible);
    await fastify.register(helmet);
    await fastify.register(corsPlugin);
    await fastify.register(rateLimit, rateLimitOptions(config));

    await fastify.register(metricsPlugin);
    await fastify.register(swaggerPlugin);

    await fastify.register(errorHandlerPlugin);
    await fastify.register(healthPlugin);
  },
  { name: "explicit-fixture-app" },
);
