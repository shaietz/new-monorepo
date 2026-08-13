import type { FastifyRequest } from "fastify";
import type { RateLimitPluginOptions } from "@fastify/rate-limit";

import type { BaseConfig } from "./config.ts";
import { LIVEZ_PATH, READYZ_PATH } from "./health.ts";
import { METRICS_PATH } from "./metrics.ts";

/**
 * Probes and scrapes matter most while the service is shedding load. Matching `routeOptions.url`
 * uses the parsed route pattern, so a query string cannot smuggle a request past the check.
 */
const UNLIMITED_ROUTES = new Set([LIVEZ_PATH, READYZ_PATH, METRICS_PATH]);

const isExempt = (request: FastifyRequest) => UNLIMITED_ROUTES.has(request.routeOptions.url ?? "");

/**
 * In-memory and per-instance: the effective limit is `RATE_LIMIT_MAX × replicas`, and it resets on
 * every deploy. A crude abuse guard, not a quota — a real one needs a shared store.
 */
export function rateLimitOptions(config: BaseConfig): RateLimitPluginOptions {
  return {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
    allowList: isExempt,
  };
}
