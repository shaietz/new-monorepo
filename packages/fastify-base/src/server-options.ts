import { randomUUID } from "node:crypto";
import type { FastifyServerOptions } from "fastify";
import type { IncomingMessage } from "node:http";

import type { BaseConfig } from "./env.ts";
import { loggerOptions } from "./logger.ts";

/**
 * Must exceed the load balancer's idle timeout (60s on an AWS ALB by default). Node closes an idle
 * connection after 5s, and a request arriving on a connection the balancer still believes is open
 * races that close — which surfaces as sporadic, unreproducible 502s.
 */
const KEEP_ALIVE_TIMEOUT_MS = 72_000;

/** A request still on the wire after this is not going to finish usefully. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Propagates an upstream `x-request-id`, or mints one.
 *
 * Fastify's built-in `requestIdHeader` does most of this, but falls back to a per-process counter
 * (`req-1`, `req-2`) that collides across replicas, and passes comma-joined duplicate headers
 * through unchanged. Do not set `requestIdHeader` alongside this — it would handle the header twice.
 */
export function requestId(req: IncomingMessage): string {
  const header = req.headers["x-request-id"];

  // Node hands over an array for headers it does not collapse, which is not a usable id.
  if (typeof header !== "string") {
    return randomUUID();
  }

  return header.split(",", 1)[0]?.trim() || randomUUID();
}

/**
 * Every constructor-level default a service needs. Keeping these here rather than in each service's
 * `fastify()` call is what stops the fleet from drifting apart one copy-paste at a time.
 */
export function serverOptions(config: BaseConfig, name: string): FastifyServerOptions {
  return {
    logger: loggerOptions(config, name),
    trustProxy: config.TRUST_PROXY,
    bodyLimit: config.BODY_LIMIT,
    genReqId: requestId,
    keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
    requestTimeout: REQUEST_TIMEOUT_MS,
  };
}
