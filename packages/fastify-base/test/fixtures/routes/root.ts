import type { FastifyPluginAsync } from "fastify";

/** A route the base package's own tests can aim at, autoloaded exactly as a real service's would be. */
const root: FastifyPluginAsync = async (fastify) => {
  fastify.get("/ping", async () => "pong\n");
};

export default root;
