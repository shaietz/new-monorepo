export { loadConfig, loggerOptions } from "./env.ts";
export { basePlugin } from "./plugin.ts";
export { startService } from "./start.ts";

/** @public — services type their own config with this; nothing in here references it. */
export type { BaseConfig } from "./env.ts";

/** @public — the options contract for services registering the plugin. */
export type { BasePluginOptions } from "./plugin.ts";

/** @public — so services declare env vars and route schemas without their own `zod` dependency. */
export { z } from "zod";

/** @public — services pass this to `.withTypeProvider<…>()` for inferred request and reply types. */
export type { ZodTypeProvider } from "@fastify/type-provider-zod";
