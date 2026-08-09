import { z } from "zod";

const baseEnvShape = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().min(0).max(65535).default(8080),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  SHUTDOWN_GRACE_MS: z.coerce.number().min(0).default(10_000),
  SHUTDOWN_DELAY_MS: z.coerce.number().min(0).default(5_000),
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

  const schema = z.object({ ...baseEnvShape, ...extra }).refine(
    // `startService` drains before closing, and close-with-grace force-exits at the grace deadline.
    // A drain at least as long as the grace period means the process is killed mid-drain and the
    // connections it was protecting are dropped anyway.
    (config) => config.SHUTDOWN_DELAY_MS < config.SHUTDOWN_GRACE_MS,
    {
      path: ["SHUTDOWN_DELAY_MS"],
      error: "SHUTDOWN_DELAY_MS must be less than SHUTDOWN_GRACE_MS, or the drain never completes",
    },
  );

  const result = schema.safeParse(process.env);

  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }

  return result.data as BaseConfig & z.infer<z.ZodObject<T>>;
}
