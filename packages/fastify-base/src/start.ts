import { setTimeout as delay } from "node:timers/promises";
import closeWithGrace from "close-with-grace";
import type { FastifyInstance } from "fastify";

import type { BaseConfig } from "./env.ts";
import { beginShutdown } from "./health.ts";

/**
 * Fails readiness first, waits for the load balancer to notice, and only then stops accepting
 * connections. Closing the moment SIGTERM arrives drops whatever was routed here in the window
 * before the orchestrator removed this instance from its endpoints — which is how an ordinary
 * deploy produces 502s.
 *
 * Exported for its own test: the signal path cannot be exercised without killing the test runner.
 */
export async function drainAndClose(server: FastifyInstance, config: BaseConfig): Promise<void> {
  beginShutdown(server);
  server.log.info({ delayMs: config.SHUTDOWN_DELAY_MS }, "draining");
  await delay(config.SHUTDOWN_DELAY_MS);

  await server.close();
  server.log.info("graceful shutdown complete");
}

export async function startService(server: FastifyInstance, config: BaseConfig): Promise<void> {
  closeWithGrace({ delay: config.SHUTDOWN_GRACE_MS }, async ({ err, signal }) => {
    if (err) {
      server.log.error({ err }, "shutting down after error");
    } else {
      server.log.info({ signal }, "graceful shutdown started");
    }

    await drainAndClose(server, config);
  });

  await server.listen({ port: config.PORT, host: config.HOST });
}
