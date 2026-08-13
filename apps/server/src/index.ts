import Fastify from "fastify";
import closeWithGrace from "close-with-grace";
import app, { config, options } from "./app.ts";

const fastify = Fastify(options);
fastify.register(app);

closeWithGrace({ delay: config.SHUTDOWN_GRACE_MS }, async ({ err, signal }) => {
  if (err) fastify.log.error({ err }, "shutting down after error");
  else fastify.log.info({ signal }, "graceful shutdown started");

  // Fastify waits for in-flight requests before resolving.
  await fastify.close();
});

try {
  await fastify.listen({ port: config.PORT, host: config.HOST });
} catch (err) {
  // Without this a boot failure reaches close-with-grace as an uncaught error and exits through the
  // shutdown path instead of failing fast.
  fastify.log.error({ err }, "failed to start");
  process.exit(1);
}
