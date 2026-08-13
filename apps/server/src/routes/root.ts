import type { FastifyPluginAsyncZod } from "@repo/fastify-base";

/** Autoloaded. Position under `src/routes` is the URL: `routes/api/tasks/index.ts` → `/api/tasks`. */
const root: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get("/ping", async () => "pong\n");
};

export default root;
