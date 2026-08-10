import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.ts";
import { requestId } from "../src/request-id.ts";
import { loggerOptions, serverOptions } from "../src/server-options.ts";

const realIsTTY = process.stdout.isTTY;

beforeEach(() => {
  // Whether the suite itself runs in a terminal must not decide what these assertions see.
  process.stdout.isTTY = false;
});

afterEach(() => {
  process.stdout.isTTY = realIsTTY;
  vi.unstubAllEnvs();
});

describe("serverOptions", () => {
  it("carries the config values Fastify needs at construction", () => {
    vi.stubEnv("TRUST_PROXY", "true");
    vi.stubEnv("BODY_LIMIT", "2048");

    const options = serverOptions(loadConfig(), "orders");

    expect(options.trustProxy).toBe(true);
    expect(options.bodyLimit).toBe(2048);
    expect(options.genReqId).toBe(requestId);
  });

  /**
   * Node closes an idle connection after 5s. A load balancer that still believes the connection is
   * open sends the next request into that close, which surfaces as an unreproducible 502.
   */
  it("keeps connections alive longer than a load balancer's idle timeout", () => {
    const options = serverOptions(loadConfig(), "orders");

    expect(options.keepAliveTimeout).toBeGreaterThan(60_000);
    expect(options.requestTimeout).toBeGreaterThan(0);
  });

  it("takes its logger from loggerOptions", () => {
    expect(serverOptions(loadConfig(), "orders").logger).toBe(false);
  });
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

  /** Keyed on the terminal rather than NODE_ENV: pretty output is for a human watching a shell. */
  it("pretty-prints when attached to a terminal", () => {
    vi.stubEnv("NODE_ENV", "development");
    process.stdout.isTTY = true;

    expect(optionsFor("orders").transport?.target).toBe("pino-pretty");
  });

  /**
   * pino-pretty is a devDependency, so a production install has nothing to resolve — and a
   * container running without NODE_ENV set must still reach this branch.
   */
  it("stays on raw JSON when output is not a terminal", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(optionsFor("orders").transport).toBeUndefined();
  });

  it("stays on raw JSON in production", () => {
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
