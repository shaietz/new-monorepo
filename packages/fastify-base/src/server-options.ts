import type { FastifyHttpOptions, FastifyServerOptions } from "fastify";
import type { Server } from "node:http";

import type { BaseConfig } from "./config.ts";
import { requestId } from "./request-id.ts";

/** `FastifyServerOptions` alone omits `http`, which is where Node's own socket timeouts live. */
export type ServerOptions = FastifyServerOptions & Pick<FastifyHttpOptions<Server>, "http">;

/** Anything logging `{ req }`, `{ res }` or an error carrying one would otherwise leak these. */
const REDACTED = ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'];

export function loggerOptions(
  config: BaseConfig,
  name: string,
): NonNullable<FastifyServerOptions["logger"]> {
  // Silent under test, so a failing assertion is not buried in request logs.
  if (config.NODE_ENV === "test") return false;

  return {
    level: config.LOG_LEVEL,
    // Labels every line, so one aggregator can hold the fleet and stay filterable.
    base: { service: name },
    redact: REDACTED,
    // Keyed on the terminal, not NODE_ENV: a container running without NODE_ENV set should still
    // emit JSON, and so should a dev server piped to a file.
    ...(process.stdout.isTTY && {
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss.l",
          ignore: "pid,hostname,service",
        },
      },
    }),
  };
}

/**
 * Must exceed the load balancer's idle timeout (60s on an AWS ALB). Node closes an idle connection
 * after 5s, and a request arriving on one the balancer still believes is open races that close —
 * which surfaces as sporadic, unreproducible 502s.
 */
const KEEP_ALIVE_TIMEOUT_MS = 72_000;

const REQUEST_TIMEOUT_MS = 30_000;

/** Bounds how long a client can hold a socket without committing to a request — slowloris. */
const CONNECTION_TIMEOUT_MS = 120_000;
const HEADERS_TIMEOUT_MS = 15_000;

/** Constructor-level defaults, shared so the fleet cannot drift one copy-paste at a time. */
export function serverOptions(config: BaseConfig, name: string): ServerOptions {
  return {
    logger: loggerOptions(config, name),
    trustProxy: config.TRUST_PROXY,
    bodyLimit: config.BODY_LIMIT,
    genReqId: requestId,
    keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
    requestTimeout: REQUEST_TIMEOUT_MS,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    http: { headersTimeout: HEADERS_TIMEOUT_MS },
  };
}
