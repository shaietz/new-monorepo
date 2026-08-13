export { basePlugin } from "./base.ts";

export { configPlugin, loadConfig } from "./config.ts";
export { serverOptions } from "./server-options.ts";
export { rateLimitOptions } from "./rate-limit.ts";

export { requestIdPlugin } from "./request-id.ts";
export { zodPlugin } from "./zod.ts";
export { corsPlugin } from "./cors.ts";
export { errorHandlerPlugin } from "./error-handler.ts";
export { swaggerPlugin } from "./swagger.ts";
export { healthPlugin, healthRegistryPlugin, LIVEZ_PATH, READYZ_PATH } from "./health.ts";
export { METRICS_PATH, metricsPlugin } from "./metrics.ts";

export type { BaseConfig, ConfigPluginOptions } from "./config.ts";
export type { ServerOptions } from "./server-options.ts";
export type { FastifyPluginAsyncZod, ZodTypeProvider } from "./zod.ts";
