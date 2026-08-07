import fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import { loadConfig, loggerOptions } from "./env.ts";
import { basePlugin } from "./plugin.ts";

const started: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((server) => server.close()));
  vi.unstubAllEnvs();
});

async function buildTestServer(healthCheck?: () => Promise<boolean>) {
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

  it("sheds load on service routes when unhealthy", async () => {
    const server = await buildTestServer(async () => false);

    const ping = await server.inject({ url: "/ping" });

    expect(ping.statusCode).toBe(503);
    expect(ping.headers["retry-after"]).toBe("10");
  });

  it("keeps liveness and metrics answering while unhealthy", async () => {
    const server = await buildTestServer(async () => false);

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
    const server = await buildTestServer(async () => false);

    expect((await server.inject({ url: "/readyz" })).statusCode).toBe(503);
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
