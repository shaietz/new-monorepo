import fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "./env.ts";
import { basePlugin } from "./plugin.ts";
import { serverOptions } from "./server-options.ts";

const started: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((server) => server.close()));
  vi.unstubAllEnvs();
});

async function buildTestServer() {
  const config = loadConfig();
  const server = fastify(serverOptions(config, "test"));

  await server.register(basePlugin, { config, name: "test" });
  server.get("/ping", async () => "pong\n");

  started.push(server);
  return server;
}

describe("basePlugin", () => {
  it("exposes metrics for the routes it has served", async () => {
    const server = await buildTestServer();

    await server.inject({ url: "/ping" });
    const metrics = await server.inject({ url: "/metrics" });

    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain("http_request_duration_seconds");
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

  it("allows a second server in the same process", async () => {
    await buildTestServer();
    const second = await buildTestServer();

    expect((await second.inject({ url: "/livez" })).statusCode).toBe(200);
  });
});

describe("request id header", () => {
  it("echoes the id back so a client can correlate its own call", async () => {
    const server = await buildTestServer();
    const res = await server.inject({ url: "/ping", headers: { "x-request-id": "upstream-123" } });

    expect(res.headers["x-request-id"]).toBe("upstream-123");
  });

  it("echoes a generated id when the caller sent none", async () => {
    const server = await buildTestServer();
    const res = await server.inject({ url: "/ping" });

    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  /** Set before rate limiting runs, so a shed request is still traceable. */
  it("is present on a rate-limited response", async () => {
    vi.stubEnv("RATE_LIMIT_MAX", "1");
    const server = await buildTestServer();

    await server.inject({ url: "/ping" });
    const limited = await server.inject({ url: "/ping" });

    expect(limited.statusCode).toBe(429);
    expect(limited.headers["x-request-id"]).toBeDefined();
  });
});

describe("cors", () => {
  it("stays disabled when no origin is configured", async () => {
    const server = await buildTestServer();
    const res = await server.inject({
      method: "OPTIONS",
      url: "/ping",
      headers: { origin: "https://elsewhere.dev", "access-control-request-method": "GET" },
    });

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("honours a configured origin", async () => {
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

  it("allows a wildcard origin", async () => {
    vi.stubEnv("CORS_ORIGIN", "*");
    const server = await buildTestServer();

    const res = await server.inject({
      method: "OPTIONS",
      url: "/ping",
      headers: { origin: "https://anywhere.dev", "access-control-request-method": "GET" },
    });

    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });
});

describe("rate limiting", () => {
  it("limits ordinary routes", async () => {
    vi.stubEnv("RATE_LIMIT_MAX", "2");
    const server = await buildTestServer();

    expect((await server.inject({ url: "/ping" })).statusCode).toBe(200);
    expect((await server.inject({ url: "/ping" })).statusCode).toBe(200);
    expect((await server.inject({ url: "/ping" })).statusCode).toBe(429);
  });

  /** Probes and scrapes matter most while the service is shedding load. */
  it("exempts probes and metrics", async () => {
    vi.stubEnv("RATE_LIMIT_MAX", "2");
    const server = await buildTestServer();

    await Promise.all(Array.from({ length: 5 }, () => server.inject({ url: "/livez" })));

    expect((await server.inject({ url: "/livez" })).statusCode).toBe(200);
    expect((await server.inject({ url: "/readyz" })).statusCode).toBe(200);
    expect((await server.inject({ url: "/metrics" })).statusCode).toBe(200);
  });

  /** Matching on the route pattern rather than the raw URL is what makes this hold. */
  it("exempts probes carrying a query string", async () => {
    vi.stubEnv("RATE_LIMIT_MAX", "1");
    const server = await buildTestServer();

    await server.inject({ url: "/livez" });

    expect((await server.inject({ url: "/livez?probe=kubelet" })).statusCode).toBe(200);
  });
});
