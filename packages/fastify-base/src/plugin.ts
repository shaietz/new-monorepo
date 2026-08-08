import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import fp from "fastify-plugin";
import metrics from "fastify-metrics";
import { serializerCompiler, validatorCompiler } from "@fastify/type-provider-zod";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { BaseConfig } from "./env.ts";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

export interface BasePluginOptions {
  readonly config: BaseConfig;
  readonly healthCheck?: () => Promise<void>;
}

export function requestId(req: IncomingMessage): string {
  const header = req.headers["x-request-id"];

  if (typeof header !== "string") {
    return randomUUID();
  }

  return header.split(",", 1)[0]?.trim() || randomUUID();
}

const HEALTH_PATHS = new Set(["/livez", "/readyz"]);
const METRICS_PATH = "/metrics";

const pathOf = (url: string) => new URL(url, "http://localhost").pathname;

const isRateLimitExempt = (request: FastifyRequest) =>
  HEALTH_PATHS.has(pathOf(request.url)) || pathOf(request.url) === METRICS_PATH;

const LiveSchema = z.object({
  status: z.literal("ok"),
});

const ReadySchema = z.object({
  status: z.literal("ok"),
});

const UnavailableSchema = z.object({
  status: z.literal("unavailable"),
});

async function base(server: FastifyInstance, { config, healthCheck }: BasePluginOptions) {
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);

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

  await server.register(metrics.default, {
    endpoint: METRICS_PATH,
    clearRegisterOnInit: true,
  });

  server.get(
    "/livez",
    {
      logLevel: "warn",
      schema: {
        response: {
          200: LiveSchema,
        },
      },
    },
    async () => ({ status: "ok" }) as const,
  );

  server.get(
    "/readyz",
    {
      logLevel: "warn",
      schema: {
        response: { 200: ReadySchema, 503: UnavailableSchema },
      },
    },
    async (_request, reply) => {
      if (healthCheck) {
        try {
          await healthCheck();
        } catch {
          return reply.code(503).send({
            status: "unavailable",
          });
        }
      }

      return { status: "ok" } as const;
    },
  );
}

export const basePlugin = fp(base, {
  name: "@repo/fastify-base",
  fastify: "5.x",
});
