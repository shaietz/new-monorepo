export { loadConfig } from "./env.ts";
export { serverOptions } from "./server-options.ts";
export { basePlugin } from "./plugin.ts";
export { startService } from "./start.ts";

/** @public — services type their own config with this; nothing in here references it. */
export type { BaseConfig } from "./env.ts";

/** @public — the options contract for services registering the plugin. */
export type { BasePluginOptions } from "./plugin.ts";

/** @public — services pass this to `.withTypeProvider<…>()` for inferred request and reply types. */
export type { ZodTypeProvider } from "@fastify/type-provider-zod";
