import { randomUUID } from "node:crypto";
import fp from "fastify-plugin";
import type { IncomingMessage } from "node:http";

/**
 * Propagates an upstream `x-request-id`, or mints one.
 *
 * Do not set `requestIdHeader` alongside this — it would handle the header twice. Fastify's
 * built-in also falls back to a per-process counter (`req-1`), which collides across replicas.
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
 * Echoes the request id back to the caller, so a client holding a failed response can quote an id
 * that appears in this service's logs. The value itself comes from `requestId` above, wired in as
 * `genReqId` by `serverOptions`.
 *
 * Registered early as a defensive default rather than a hard requirement: `onRequest` hooks run in
 * registration order *within a scope*, but @fastify/rate-limit attaches its hook per-route via
 * `onRoute`, and scope-level hooks always run before route-level ones. So a 429 keeps the header
 * either way today — registering first is what keeps that true if something else ever short-circuits
 * a request from a scope-level hook.
 */
export const requestIdPlugin = fp(
  async (fastify) => {
    fastify.addHook("onRequest", async (request, reply) => {
      reply.header("x-request-id", request.id);
    });
  },
  { name: "request-id" },
);
