import fp from "fastify-plugin";
import { z } from "zod";
import type { FastifyConfig } from "fastify";

const baseEnvShape = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().min(0).max(65535).default(8080),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  SHUTDOWN_GRACE_MS: z.coerce.number().min(0).default(10_000),
  HEALTH_TIMEOUT_MS: z.coerce.number().min(1).default(2_000),
  TRUST_PROXY: z.stringbool().default(false),
  CORS_ORIGIN: z.string().default(""),
  RATE_LIMIT_MAX: z.coerce.number().min(1).default(100),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  BODY_LIMIT: z.coerce.number().min(1).default(1_048_576),
  ENABLE_DOCS: z.stringbool().default(false),
};

const baseEnvSchema = z.object(baseEnvShape);

export type BaseConfig = z.infer<typeof baseEnvSchema>;

declare module "fastify" {
  /**
   * Everything reachable as `fastify.config`. A service merges its own variables in, derived from
   * the shape it passed to `loadConfig` so schema and type cannot drift:
   *
   * ```ts
   * type ExtraEnv = z.infer<z.ZodObject<typeof extraEnv>>;
   *
   * declare module "fastify" {
   *   interface FastifyConfig extends ExtraEnv {}
   * }
   * ```
   *
   * The alias is named rather than inlined because oxlint's `import/namespace` cannot follow
   * `z.infer` into a `declare module` block and reports it as missing from `zod`.
   */
  interface FastifyConfig extends BaseConfig {}

  interface FastifyInstance {
    readonly config: FastifyConfig;
    /** A compile-time fact, so it is a `basePlugin` argument rather than an environment var. */
    readonly serviceName: string;
  }
}

function loadDotEnv() {
  try {
    process.loadEnvFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function loadConfig<T extends z.ZodRawShape = Record<never, never>>(
  extra?: T,
): BaseConfig & z.infer<z.ZodObject<T>> {
  loadDotEnv();

  const schema = z.object({ ...baseEnvShape, ...extra });

  const result = schema.safeParse(process.env);

  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }

  return result.data as BaseConfig & z.infer<z.ZodObject<T>>;
}

export interface ConfigPluginOptions {
  readonly config: FastifyConfig;
  /** Labels log lines and titles the OpenAPI document. */
  readonly name: string;
}

/**
 * Publishes the parsed environment as `fastify.config`. Register first — everything downstream
 * reads it.
 *
 * `loadConfig` is not called here: a service needs its config before the instance exists, to build
 * the constructor options, so it is passed in rather than parsed twice.
 */
export const configPlugin = fp<ConfigPluginOptions>(
  async (fastify, { config, name }) => {
    fastify.decorate("config", config);
    fastify.decorate("serviceName", name);
  },
  { name: "config" },
);
