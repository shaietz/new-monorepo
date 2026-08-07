import fastify from "fastify";

export function buildServer() {
  const server = fastify({ logger: process.env.NODE_ENV === "development" });

  server.get("/ping", async () => {
    return "pong\n";
  });

  return server;
}
