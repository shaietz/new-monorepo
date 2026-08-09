import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./env.ts";
import { loggerOptions } from "./logger.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Narrows away the `false` and `FastifyBaseLogger` arms so the options are assertable. */
function optionsFor(name: string) {
  const options = loggerOptions(loadConfig(), name);

  expect(options).toBeTypeOf("object");
  return options as {
    level: string;
    base: { service: string };
    redact: string[];
    transport?: { target: string };
  };
}

describe("loggerOptions", () => {
  it("disables logging under test, so assertions are not buried in request logs", () => {
    expect(loggerOptions(loadConfig(), "orders")).toBe(false);
  });

  it("uses LOG_LEVEL otherwise", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "warn");

    expect(optionsFor("orders").level).toBe("warn");
  });

  /** One aggregator holds the whole fleet; without this, lines cannot be told apart. */
  it("labels every line with the service name", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(optionsFor("orders").base).toEqual({ service: "orders" });
  });

  it("pretty-prints to the console in development", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(optionsFor("orders").transport?.target).toBe("pino-pretty");
  });

  /** pino-pretty is a devDependency, so a production install has nothing to resolve. */
  it("leaves production on raw JSON, which the aggregator parses", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(optionsFor("orders").transport).toBeUndefined();
  });

  it("redacts credential-bearing headers", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(optionsFor("orders").redact).toEqual([
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
    ]);
  });
});
