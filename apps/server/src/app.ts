import fastify from "fastify";
import { basePlugin, loadConfig, serverOptions } from "@repo/fastify-base";

const SERVICE_NAME = "server";

export const config = loadConfig();

/** `cfg` is a parameter so tests can build a server without stubbing the environment first. */
export async function buildServer(cfg: typeof config = config) {
  const server = fastify(serverOptions(cfg, SERVICE_NAME));

  await server.register(basePlugin, { config: cfg, name: SERVICE_NAME });

  server.get("/ping", async () => {
    return "pong\n";
  });

  return server;
}
