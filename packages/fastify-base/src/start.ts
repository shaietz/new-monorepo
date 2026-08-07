import closeWithGrace from "close-with-grace";
import type { FastifyInstance } from "fastify";
import type { BaseConfig } from "./env.ts";

export async function startService(server: FastifyInstance, config: BaseConfig): Promise<void> {
  closeWithGrace({ delay: config.SHUTDOWN_GRACE_MS }, async ({ err, signal }) => {
    if (err) {
      server.log.error({ err }, "shutting down after error");
    } else {
      server.log.info({ signal }, "graceful shutdown started");
    }

    await server.close();
    server.log.info("graceful shutdown complete");
  });

  await server.listen({ port: config.PORT, host: config.HOST });
}
