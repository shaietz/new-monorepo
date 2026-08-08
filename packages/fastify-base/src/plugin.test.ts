import fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import { loadConfig, loggerOptions } from "./env.ts";
import { basePlugin, requestId } from "./plugin.ts";
import type { IncomingMessage } from "node:http";

const started: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((server) => server.close()));
  vi.unstubAllEnvs();
});

/** Reports an outage the only way `basePlugin` recognises: by rejecting. */
const unhealthy = async () => {
  throw new Error("dependency down");
};

async function buildTestServer(healthCheck?: () => Promise<void>) {
  const config = loadConfig();
  const server = fastify({ logger: loggerOptions(config) });

  await server.register(basePlugin, { config, ...(healthCheck ? { healthCheck } : {}) });
  server.get("/ping", async () => "pong\n");

  started.push(server);
  return server;
}

describe("basePlugin", () => {
  it("exposes liveness, readiness and metrics", async () => {
    const server = await buildTestServer();

    const livez = await server.inject({ url: "/livez" });
    expect(livez.statusCode).toBe(200);
    expect(livez.json()).toEqual({ status: "ok" });

    await server.inject({ url: "/ping" });
    const metrics = await server.inject({ url: "/metrics" });

    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain("http_request_duration_seconds");
  });

  /**
   * Regression guard for the Zod serializer. Assert the body, not just the
   * status: a mis-wired serializer surfaces as
   * 500 FST_ERR_FAILED_ERROR_SERIALIZATION in the payload.
   */
  it("serialises /readyz without a schema conflict", async () => {
    const server = await buildTestServer();
    const res = await server.inject({ url: "/readyz" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    expect(res.body).not.toContain("FST_ERR_FAILED_ERROR_SERIALIZATION");
  });

  /** Readiness is the only thing the health check gates — nothing sheds ordinary traffic. */
  it("keeps service routes answering while unhealthy", async () => {
    const server = await buildTestServer(unhealthy);

    const ping = await server.inject({ url: "/ping" });

    expect(ping.statusCode).toBe(200);
    expect(ping.body).toBe("pong\n");
  });

  it("keeps liveness and metrics answering while unhealthy", async () => {
    const server = await buildTestServer(unhealthy);

    expect((await server.inject({ url: "/livez" })).statusCode).toBe(200);
    expect((await server.inject({ url: "/livez" })).json()).toEqual({ status: "ok" });
    expect((await server.inject({ url: "/metrics" })).statusCode).toBe(200);
  });

  it("validates and serialises routes with Zod schemas", async () => {
    const server = await buildTestServer();
    server.withTypeProvider<ZodTypeProvider>().post(
      "/echo",
      {
        schema: {
          body: z.object({ email: z.email() }),
          response: { 200: z.object({ email: z.string() }) },
        },
      },
      async (req) => ({ email: req.body.email }),
    );

    const good = await server.inject({
      method: "POST",
      url: "/echo",
      payload: { email: "user@example.dev" },
    });
    const bad = await server.inject({
      method: "POST",
      url: "/echo",
      payload: { email: "nope" },
    });

    expect(good.statusCode).toBe(200);
    expect(good.json()).toEqual({ email: "user@example.dev" });
    expect(bad.statusCode).toBe(400);
  });

  it("strips response fields not present in the Zod response schema", async () => {
    const server = await buildTestServer();
    server
      .withTypeProvider<ZodTypeProvider>()
      .get(
        "/secret",
        { schema: { response: { 200: z.object({ safe: z.string() }) } } },
        async () => ({ safe: "public", password: "leaked" }),
      );

    const res = await server.inject({ url: "/secret" });

    expect(res.json()).toEqual({ safe: "public" });
  });

  it("fails readiness when the health check fails", async () => {
    const server = await buildTestServer(unhealthy);
    const res = await server.inject({ url: "/readyz" });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "unavailable" });
  });

  it("sets security headers", async () => {
    const server = await buildTestServer();
    const res = await server.inject({ url: "/ping" });

    expect(res.headers["content-security-policy"]).toBeDefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("decorates httpErrors from sensible", async () => {
    const server = await buildTestServer();
    server.get("/gone", async () => {
      throw server.httpErrors.gone("finished");
    });

    const res = await server.inject({ url: "/gone" });

    expect(res.statusCode).toBe(410);
    expect(res.json()).toMatchObject({ message: "finished" });
  });

  it("leaves CORS disabled when no origin is configured", async () => {
    const server = await buildTestServer();
    const res = await server.inject({
      method: "OPTIONS",
      url: "/ping",
      headers: { origin: "https://elsewhere.dev", "access-control-request-method": "GET" },
    });

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("honours a configured CORS origin", async () => {
    vi.stubEnv("CORS_ORIGIN", "https://allowed.dev");
    const server = await buildTestServer();

    const allowed = await server.inject({
      method: "OPTIONS",
      url: "/ping",
      headers: { origin: "https://allowed.dev", "access-control-request-method": "GET" },
    });
    const denied = await server.inject({
      method: "OPTIONS",
      url: "/ping",
      headers: { origin: "https://denied.dev", "access-control-request-method": "GET" },
    });

    expect(allowed.headers["access-control-allow-origin"]).toBe("https://allowed.dev");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows a wildcard CORS origin", async () => {
    vi.stubEnv("CORS_ORIGIN", "*");
    const server = await buildTestServer();

    const res = await server.inject({
      method: "OPTIONS",
      url: "/ping",
      headers: { origin: "https://anywhere.dev", "access-control-request-method": "GET" },
    });

    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("rate limits ordinary routes", async () => {
    vi.stubEnv("RATE_LIMIT_MAX", "2");
    const server = await buildTestServer();

    expect((await server.inject({ url: "/ping" })).statusCode).toBe(200);
    expect((await server.inject({ url: "/ping" })).statusCode).toBe(200);
    expect((await server.inject({ url: "/ping" })).statusCode).toBe(429);
  });

  it("exempts probes and metrics from rate limiting", async () => {
    vi.stubEnv("RATE_LIMIT_MAX", "2");
    const server = await buildTestServer();

    await Promise.all(Array.from({ length: 5 }, () => server.inject({ url: "/livez" })));

    expect((await server.inject({ url: "/livez" })).statusCode).toBe(200);
    expect((await server.inject({ url: "/readyz" })).statusCode).toBe(200);
    expect((await server.inject({ url: "/metrics" })).statusCode).toBe(200);
  });

  it("exempts probes carrying a query string", async () => {
    vi.stubEnv("RATE_LIMIT_MAX", "1");
    const server = await buildTestServer();

    await server.inject({ url: "/livez" });

    expect((await server.inject({ url: "/livez?probe=kubelet" })).statusCode).toBe(200);
  });

  it("allows a second server in the same process", async () => {
    await buildTestServer();
    const second = await buildTestServer();

    expect((await second.inject({ url: "/livez" })).statusCode).toBe(200);
  });
});

const UUID = /^[0-9a-f-]{36}$/;

/** `genReqId` is handed the raw Node request, long before Fastify has built anything around it. */
const reqWith = (header?: string | string[]) =>
  ({ headers: header === undefined ? {} : { "x-request-id": header } }) as IncomingMessage;

describe("requestId", () => {
  it("propagates an upstream request id", () => {
    expect(requestId(reqWith("upstream-123"))).toBe("upstream-123");
  });

  it("takes the first value when x-request-id is repeated", () => {
    // Node joins duplicate headers into "first,second" before anything else sees them.
    expect(requestId(reqWith("first,second"))).toBe("first");
  });

  it("trims surrounding whitespace", () => {
    expect(requestId(reqWith("  spaced  "))).toBe("spaced");
  });

  it("generates an id when the header is absent", () => {
    expect(requestId(reqWith())).toMatch(UUID);
  });

  it("generates an id when the header is empty", () => {
    expect(requestId(reqWith("  "))).toMatch(UUID);
  });

  /** Node hands over an array for headers it does not collapse, which is not a usable id. */
  it("generates an id when the header arrives as an array", () => {
    expect(requestId(reqWith(["first", "second"]))).toMatch(UUID);
  });
});
