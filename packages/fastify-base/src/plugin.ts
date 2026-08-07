import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import { serializerCompiler, validatorCompiler } from "@fastify/type-provider-zod";
import underPressure from "@fastify/under-pressure";
import fp from "fastify-plugin";
import metricsModule from "fastify-metrics";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { BaseConfig } from "./env.ts";

export interface BasePluginOptions {
  config: BaseConfig;
  healthCheck?: () => Promise<boolean>;
}

const RATE_LIMIT_EXEMPT = new Set(["/livez", "/readyz", "/metrics"]);

const isExempt = (req: FastifyRequest) =>
  RATE_LIMIT_EXEMPT.has(new URL(req.url, "http://localhost").pathname);

const StatusSchema = z.object({ status: z.literal("ok") });

const PRESSURE_EXEMPT = new Set(["/livez", "/metrics"]);

const pathOf = (url: string) => new URL(url, "http://localhost").pathname;

async function base(server: FastifyInstance, { config, healthCheck }: BasePluginOptions) {
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
    allowList: isExempt,
  });

  await server.register(metricsModule.default, {
    endpoint: "/metrics",
    clearRegisterOnInit: true,
  });

  await server.register(underPressure, {
    maxEventLoopDelay: 1000,
    maxEventLoopUtilization: 0.98,
    exposeStatusRoute: false,
    ...(healthCheck ? { healthCheck, healthCheckInterval: 5000 } : {}),
    pressureHandler: (req, reply) => {
      if (PRESSURE_EXEMPT.has(pathOf(req.url))) return;

      reply.code(503).header("Retry-After", "10").send({
        statusCode: 503,
        error: "Service Unavailable",
        message: "under pressure",
      });
    },
  });

  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);

  server.get(
    "/livez",
    { logLevel: "warn", schema: { response: { 200: StatusSchema } } },
    async () => ({ status: "ok" }) as const,
  );

  server.get(
    "/readyz",
    { logLevel: "warn", schema: { response: { 200: StatusSchema } } },
    async () => ({ status: "ok" }) as const,
  );
}

export const basePlugin = fp(base, {
  name: "@repo/fastify-base",
  fastify: "5.x",
});
