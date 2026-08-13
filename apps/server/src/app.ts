import { join } from "node:path";
import autoload from "@fastify/autoload";
import fp from "fastify-plugin";
import { basePlugin, loadConfig, serverOptions } from "@repo/fastify-base";

const NAME = "server";

export const config = loadConfig();
export const options = serverOptions(config, NAME);

/**
 * `fp` so the error handler, schema compilers and decorators inside `basePlugin` apply to the root
 * instance rather than a throwaway child scope.
 */
export default fp(
  async function app(fastify) {
    await fastify.register(basePlugin, { config, name: NAME });

    await fastify.register(autoload, {
      dir: join(import.meta.dirname, "routes"),
      // Required: autoload reads `options.prefix` unguarded when a plugin exports `autoConfig` as a
      // function, and throws on `undefined`.
      options: {},
      autoHooks: true,
      cascadeHooks: true,
    });
  },
  { name: `${NAME}-app` },
);
