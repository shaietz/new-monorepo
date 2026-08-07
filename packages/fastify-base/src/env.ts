import { z } from "zod";

const baseEnvShape = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().min(0).max(65535).default(8080),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  SHUTDOWN_GRACE_MS: z.coerce.number().min(0).default(10_000),
  TRUST_PROXY: z.stringbool().default(false),
  CORS_ORIGIN: z.string().default(""),
  RATE_LIMIT_MAX: z.coerce.number().min(1).default(100),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  BODY_LIMIT: z.coerce.number().min(1).default(1_048_576),
};

const baseEnvSchema = z.object(baseEnvShape);

export type BaseConfig = z.infer<typeof baseEnvSchema>;

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

export function loggerOptions(config: BaseConfig): { level: BaseConfig["LOG_LEVEL"] } | false {
  if (config.NODE_ENV === "test") return false;

  return { level: config.LOG_LEVEL };
}
