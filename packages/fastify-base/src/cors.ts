import cors from "@fastify/cors";
import fp from "fastify-plugin";

/**
 * Off unless `CORS_ORIGIN` is set. `*` allows any origin; anything else is a comma-separated
 * allow-list.
 *
 * "No CORS" has to mean the plugin is never registered: `@fastify/cors` with a falsy `origin` still
 * answers preflights and still adds `vary: Origin`.
 */
export const corsPlugin = fp(
  async (fastify) => {
    const configured = fastify.config.CORS_ORIGIN;
    if (!configured) return;

    await fastify.register(cors, {
      origin: configured === "*" ? "*" : configured.split(",").map((origin) => origin.trim()),
    });
  },
  { name: "cors" },
);
