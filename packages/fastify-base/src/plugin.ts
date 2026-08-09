import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import fp from "fastify-plugin";
import metrics from "fastify-metrics";
import { serializerCompiler, validatorCompiler } from "@fastify/type-provider-zod";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { BaseConfig } from "./env.ts";
import { registerDocs } from "./docs.ts";
import { registerErrorHandlers } from "./errors.ts";
import { registerHealth } from "./health.ts";

export interface BasePluginOptions {
  readonly config: BaseConfig;
  /** Labels log lines and titles the OpenAPI document. */
  readonly name: string;
  /** Rejects when a dependency is unreachable. Gates `/readyz` and nothing else. */
  readonly healthCheck?: () => Promise<void>;
}

const METRICS_PATH = "/metrics";

/**
 * Probes and scrapes have to answer while the service is shedding load — that is exactly when they
 * matter. Matching on `routeOptions.url` gives the route pattern, already parsed by the router, so
 * a query string cannot smuggle a request past the check.
 */
const UNLIMITED_ROUTES = new Set(["/livez", "/readyz", METRICS_PATH]);

const isRateLimitExempt = (request: FastifyRequest) =>
  UNLIMITED_ROUTES.has(request.routeOptions.url ?? "");

async function base(server: FastifyInstance, { config, name, healthCheck }: BasePluginOptions) {
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);

  // First, so the header is set even when a later hook short-circuits the request — a 429 from
  // rate-limit still needs to be traceable back to its log lines.
  server.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  await registerDocs(server, config, name);
  registerErrorHandlers(server, config);

  await server.register(sensible);
  await server.register(helmet);

  if (config.CORS_ORIGIN) {
    await server.register(cors, {
      origin:
        config.CORS_ORIGIN === "*"
          ? "*"
          : config.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
    });
  }

  await server.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
    allowList: isRateLimitExempt,
  });

  // `.default` is deliberate: fastify-metrics is CJS, so Node's ESM interop makes the plain default
  // import the whole `module.exports`. Fastify's `register` unwraps it at runtime — `tsc` does not.
  await server.register(metrics.default, {
    endpoint: METRICS_PATH,
    // prom-client's registry is global; a second server in the same process throws without this.
    clearRegisterOnInit: true,
  });

  registerHealth(server, config, healthCheck);
}

export const basePlugin = fp(base, {
  name: "@repo/fastify-base",
  fastify: "5.x",
});
