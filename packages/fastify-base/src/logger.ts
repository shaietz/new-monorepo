import type { FastifyServerOptions } from "fastify";
import type { BaseConfig } from "./env.ts";

/**
 * Header values that carry credentials. Fastify's default serialisers do not log headers at all,
 * but anything that logs `{ req }`, `{ res }` or an error carrying one would — and by then the
 * secret is in the aggregator forever.
 */
const REDACTED = ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'];

/**
 * Pino options for a service. `name` labels every line, so one aggregator can hold the whole fleet
 * and still be filterable; it is a compile-time fact, not deployment config, so it is an argument
 * rather than an environment variable.
 */
export function loggerOptions(
  config: BaseConfig,
  name: string,
): NonNullable<FastifyServerOptions["logger"]> {
  // Silent under test, so a failing assertion is not buried in request logs.
  if (config.NODE_ENV === "test") return false;

  return {
    level: config.LOG_LEVEL,
    base: { service: name },
    redact: REDACTED,
  };
}
