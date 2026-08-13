import { setTimeout as delay } from "node:timers/promises";
import fp from "fastify-plugin";
import { z } from "zod";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";

/** The endpoints an orchestrator polls. Rate limiting exempts both. */
export const LIVEZ_PATH = "/livez";
export const READYZ_PATH = "/readyz";

declare module "fastify" {
  interface FastifyInstance {
    /**
     * Registers a dependency probe for `/readyz`. The check reports an outage by rejecting; its
     * resolved value is ignored.
     *
     * ```ts
     * fastify.addHealthCheck("postgres", () => fastify.pg.query("SELECT 1"));
     * ```
     */
    addHealthCheck(name: string, check: () => Promise<unknown>): void;

    /** Runs every registered check under `HEALTH_TIMEOUT_MS`. Used by `/readyz`. */
    checkHealth(): Promise<boolean>;
  }
}

const TIMED_OUT = Symbol("health-check-timed-out");

/**
 * The readiness-probe registry. A registry rather than a single injected function because the
 * plugins that own a connection register later and contribute their own probe.
 *
 * Register before anything that calls `addHealthCheck`.
 */
export const healthRegistryPlugin = fp(
  async (fastify) => {
    const checks = new Map<string, () => Promise<unknown>>();

    fastify.decorate("addHealthCheck", (name, check) => {
      checks.set(name, check);
    });

    fastify.decorate("checkHealth", async () => {
      if (checks.size === 0) return true;

      // A dependency that has stopped answering usually hangs rather than rejecting, and a probe
      // that never settles reads as neither healthy nor sick.
      const controller = new AbortController();

      try {
        const outcome = await Promise.race([
          Promise.all(
            [...checks].map(async ([name, check]) => {
              try {
                await check();
              } catch (err) {
                // Named here because the caller only ever sees a single 503.
                fastify.log.error({ err, check: name }, "health check failed");
                throw err;
              }
            }),
          ).then(() => true as const),
          delay(fastify.config.HEALTH_TIMEOUT_MS, TIMED_OUT, { signal: controller.signal }),
        ]);

        if (outcome === TIMED_OUT) {
          fastify.log.error(
            { timeoutMs: fastify.config.HEALTH_TIMEOUT_MS },
            "health check timed out",
          );
        }

        return outcome === true;
      } catch {
        return false;
      } finally {
        // Releases the timer whichever side won, so it cannot hold the process open.
        controller.abort();
      }
    });
  },
  { name: "health-registry" },
);

const OkSchema = z.object({ status: z.literal("ok") });
const UnavailableSchema = z.object({ status: z.literal("unavailable") });

const OK = { status: "ok" } as const;
const UNAVAILABLE = { status: "unavailable" } as const;

/** The two probes an orchestrator polls. Checks come from the registry above. */
export const healthPlugin = fp(
  async (fastify) => {
    const server = fastify.withTypeProvider<ZodTypeProvider>();

    // Checks no dependencies on purpose: failing liveness restarts the pod, so a dependency blip
    // would restart the whole fleet.
    server.get(
      LIVEZ_PATH,
      { logLevel: "warn", schema: { response: { 200: OkSchema }, tags: ["health"] } },
      async () => OK,
    );

    // The one the load balancer should poll.
    server.get(
      READYZ_PATH,
      {
        logLevel: "warn",
        schema: { response: { 200: OkSchema, 503: UnavailableSchema }, tags: ["health"] },
      },
      async (_request, reply) => {
        if (!(await fastify.checkHealth())) {
          return reply.code(503).send(UNAVAILABLE);
        }

        return OK;
      },
    );
  },
  { name: "health" },
);
