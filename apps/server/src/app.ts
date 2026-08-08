import fastify from "fastify";
import { basePlugin, loadConfig, loggerOptions, requestId } from "@repo/fastify-base";

export const config = loadConfig();

export async function buildServer() {
  const server = fastify({
    logger: loggerOptions(config),
    trustProxy: config.TRUST_PROXY,
    bodyLimit: config.BODY_LIMIT,
    genReqId: requestId,
  });

  await server.register(basePlugin, { config });

  server.get("/ping", async () => {
    return "pong\n";
  });

  return server;
}
