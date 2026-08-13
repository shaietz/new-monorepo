import fp from "fastify-plugin";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";

import { configPlugin } from "./config.ts";
import type { ConfigPluginOptions } from "./config.ts";
import { corsPlugin } from "./cors.ts";
import { errorHandlerPlugin } from "./error-handler.ts";
import { healthPlugin, healthRegistryPlugin } from "./health.ts";
import { metricsPlugin } from "./metrics.ts";
import { rateLimitOptions } from "./rate-limit.ts";
import { requestIdPlugin } from "./request-id.ts";
import { swaggerPlugin } from "./swagger.ts";
import { zodPlugin } from "./zod.ts";

/**
 * The fixed part of the stack, in the one order that works. Every plugin below is also exported
 * individually — the day a service needs to change one of these, it inlines this list into its own
 * `app.ts` and edits it there. That is the whole escape hatch, and `test/fixtures/explicit-app.ts`
 * keeps it working.
 *
 * Deliberately does **not** register `@fastify/autoload` or any service plugin. Those are the parts
 * whose order actually varies, so they stay visible in the service.
 *
 * The order is load-bearing and mostly silent when broken. `expectBaseContract` asserts each
 * constraint; the comments say why it exists.
 */
export const basePlugin = fp<ConfigPluginOptions>(
  async (fastify, { config, name }) => {
    // Everything below reads `fastify.config`, and the compilers must precede any route.
    await fastify.register(configPlugin, { config, name });
    await fastify.register(zodPlugin);
    await fastify.register(requestIdPlugin);
    await fastify.register(healthRegistryPlugin);

    await fastify.register(sensible);
    await fastify.register(helmet);
    await fastify.register(corsPlugin);
    await fastify.register(rateLimit, rateLimitOptions(config));

    await fastify.register(metricsPlugin); // before swagger, to keep /metrics out of the spec
    await fastify.register(swaggerPlugin); // before routes, it only documents what follows

    // The 404 handler needs `fastify.rateLimit`; the probes need to reach the spec.
    await fastify.register(errorHandlerPlugin);
    await fastify.register(healthPlugin);
  },
  { name: "base" },
);
