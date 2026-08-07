import { randomUUID } from "node:crypto";
import fastify from "fastify";
import { basePlugin, loadConfig, loggerOptions } from "@repo/fastify-base";

export const config = loadConfig();

export async function buildServer() {
  const server = fastify({
    logger: loggerOptions(config),
    trustProxy: config.TRUST_PROXY,
    bodyLimit: config.BODY_LIMIT,
    genReqId: (req) => {
      const header = req.headers["x-request-id"];
      if (typeof header !== "string") return randomUUID();
      // Node joins repeated headers with a comma; keep the upstream-most id.
      const first = header.split(",", 1).join("").trim();
      return first === "" ? randomUUID() : first;
    },
  });

  await server.register(basePlugin, { config });

  server.get("/ping", async () => {
    return "pong\n";
  });

  return server;
}
