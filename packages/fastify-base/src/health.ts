import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { FastifyInstance } from "fastify";

import type { BaseConfig } from "./env.ts";

declare module "fastify" {
  interface FastifyInstance {
    /** True once `beginShutdown` has run. Read by `/readyz`, written only by `startService`. */
    shuttingDown: boolean;
  }
}

const OkSchema = z.object({ status: z.literal("ok") });
const UnavailableSchema = z.object({ status: z.literal("unavailable") });

const OK = { status: "ok" } as const;
const UNAVAILABLE = { status: "unavailable" } as const;

const TIMED_OUT = Symbol("health-check-timed-out");

/**
 * Stops `/readyz` answering 200 so the load balancer takes this instance out of rotation. Kubernetes
 * removes a pod from its endpoints asynchronously, so a process that closes the moment it sees
 * SIGTERM still receives traffic for a beat — which is how a routine deploy produces 502s.
 */
export function beginShutdown(server: FastifyInstance): void {
  server.shuttingDown = true;
}

/**
 * Runs the service's health check under a deadline. A dependency that has stopped answering usually
 * hangs rather than rejecting, and a probe that never settles reads as neither healthy nor sick.
 */
async function isHealthy(healthCheck: () => Promise<void>, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();

  try {
    const outcome = await Promise.race([
      healthCheck().then(() => true as const),
      delay(timeoutMs, TIMED_OUT, { signal: controller.signal }),
    ]);

    return outcome === true;
  } catch {
    // Rejecting is how a service reports an outage; `basePlugin` asks for nothing more.
    return false;
  } finally {
    // Releases the timer whichever side won, so it cannot hold the process open.
    controller.abort();
  }
}

export function registerHealth(
  server: FastifyInstance,
  config: BaseConfig,
  healthCheck?: () => Promise<void>,
): void {
  server.decorate("shuttingDown", false);

  /**
   * Is the process wedged? Checks no dependencies on purpose, and keeps answering 200 during
   * shutdown — failing liveness restarts pods, and a dependency blip would restart all of them.
   */
  server.get(
    "/livez",
    { logLevel: "warn", schema: { response: { 200: OkSchema } } },
    async () => OK,
  );

  /** Can it serve traffic? This is the one the load balancer should poll. */
  server.get(
    "/readyz",
    { logLevel: "warn", schema: { response: { 200: OkSchema, 503: UnavailableSchema } } },
    async (_request, reply) => {
      if (server.shuttingDown) {
        return reply.code(503).send(UNAVAILABLE);
      }

      if (healthCheck && !(await isHealthy(healthCheck, config.HEALTH_TIMEOUT_MS))) {
        return reply.code(503).send(UNAVAILABLE);
      }

      return OK;
    },
  );
}
