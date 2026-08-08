import { z } from "zod";

const ConfigSchema = z.object({
  API_URL: z
    .union([z.literal(""), z.url(), z.string().startsWith("/")])
    .default("")
    .describe("Base URL of the API: https://api.example.com, or /api, or empty"),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let current: AppConfig = ConfigSchema.parse({});

export function setConfig(loaded: AppConfig): void {
  current = loaded;
}

export function getConfig(): AppConfig {
  return current;
}

export function resetConfig(): void {
  current = ConfigSchema.parse({});
}

export async function loadConfig(): Promise<AppConfig> {
  let raw: unknown;

  try {
    const response = await fetch("/config.json", { cache: "no-store" });
    if (!response.ok) return ConfigSchema.parse({});

    raw = await response.json();
  } catch {
    return ConfigSchema.parse({});
  }

  const result = ConfigSchema.safeParse(raw);

  if (!result.success) {
    throw new Error(`Invalid config.json:\n${z.prettifyError(result.error)}`);
  }

  return result.data;
}
