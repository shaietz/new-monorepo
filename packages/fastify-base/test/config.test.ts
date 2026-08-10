import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { loadConfig } from "../src/config.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("loadConfig", () => {
  it("applies defaults", () => {
    const config = loadConfig();

    expect(config.HOST).toBe("0.0.0.0");
    expect(config.PORT).toBe(8080);
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.SHUTDOWN_GRACE_MS).toBe(10_000);
    expect(config.HEALTH_TIMEOUT_MS).toBe(2_000);
    expect(config.TRUST_PROXY).toBe(false);
    expect(config.ENABLE_DOCS).toBe(false);
  });

  it("does not fail when no .env file exists", () => {
    expect(() => loadConfig()).not.toThrow();
  });

  it("rethrows .env read errors that are not ENOENT", () => {
    const failure = Object.assign(new Error("permission denied"), { code: "EACCES" });
    vi.spyOn(process, "loadEnvFile").mockImplementation(() => {
      throw failure;
    });

    expect(() => loadConfig()).toThrow(/permission denied/);

    vi.restoreAllMocks();
  });

  it("coerces numbers and booleans out of strings", () => {
    vi.stubEnv("PORT", "3000");
    vi.stubEnv("TRUST_PROXY", "true");

    const config = loadConfig();

    expect(config.PORT).toBe(3000);
    expect(typeof config.PORT).toBe("number");
    expect(config.TRUST_PROXY).toBe(true);
  });

  it("rejects a non-numeric PORT", () => {
    vi.stubEnv("PORT", "not-a-number");

    expect(() => loadConfig()).toThrow(/Invalid environment/);
    expect(() => loadConfig()).toThrow(/PORT/);
  });

  it("reports an unknown enum value readably", () => {
    vi.stubEnv("LOG_LEVEL", "verbose");

    expect(() => loadConfig()).toThrow(/LOG_LEVEL/);
  });

  it("merges service-specific properties", () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost/app");

    const config = loadConfig({ DATABASE_URL: z.url() });

    expect(config.DATABASE_URL).toBe("postgres://localhost/app");
    expect(config.PORT).toBe(8080);
  });

  it("rejects a missing required service property", () => {
    expect(() => loadConfig({ DATABASE_URL: z.string() })).toThrow(/DATABASE_URL/);
  });

  it("rejects an invalid service property", () => {
    vi.stubEnv("DATABASE_URL", "not-a-url");

    expect(() => loadConfig({ DATABASE_URL: z.url() })).toThrow(/DATABASE_URL/);
  });
});
