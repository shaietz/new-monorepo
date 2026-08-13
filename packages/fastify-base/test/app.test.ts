import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";

import { buildTestServer, closeTestServers } from "./fixtures/service.ts";

afterEach(async () => {
  await closeTestServers();
  vi.unstubAllEnvs();
});

describe("autoload", () => {
  /** `/ping` is not registered anywhere in this file — it comes from `test/fixtures/routes/root.ts`. */
  it("registers the service's routes directory", async () => {
    const server = await buildTestServer();
    const res = await server.inject({ url: "/ping" });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("pong\n");
  });

  it("still boots a service with no plugin or route directories of its own", async () => {
    const server = await buildTestServer();

    expect((await server.inject({ url: "/livez" })).statusCode).toBe(200);
  });
});

describe("service app", () => {
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
    const server = await buildTestServer({ silent: true });
    server.get("/gone", async () => {
      throw server.httpErrors.gone("finished");
    });

    const res = await server.inject({ url: "/gone" });

    expect(res.statusCode).toBe(410);
    expect(res.json()).toMatchObject({ message: "finished" });
  });

  it("publishes the parsed environment as fastify.config", async () => {
    vi.stubEnv("RATE_LIMIT_MAX", "42");
    const server = await buildTestServer({ name: "orders" });

    expect(server.config.RATE_LIMIT_MAX).toBe(42);
    expect(server.serviceName).toBe("orders");
  });

  /**
   * Guards `clearRegisterOnInit` on the metrics plugin: prom-client's registry is global, so a
   * second instance in the same process throws during boot without it — which is what building two
   * servers here would surface. Scraping the second one proves the registry survived the reset.
   */
  it("allows a second server in the same process", async () => {
    await buildTestServer();
    const second = await buildTestServer();

    expect((await second.inject({ url: "/livez" })).statusCode).toBe(200);
    expect((await second.inject({ url: "/metrics" })).statusCode).toBe(200);
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
    const server = await buildTestServer({ silent: true });

    await server.inject({ url: "/ping" });
    const limited = await server.inject({ url: "/ping" });

    expect(limited.statusCode).toBe(429);
    expect(limited.headers["x-request-id"]).toBeDefined();
  });
});

/** Behaviour is covered in `plugins/external/cors.test.ts`; this is the wiring through autoload. */
describe("cors", () => {
  it("reaches the assembled service when configured", async () => {
    vi.stubEnv("CORS_ORIGIN", "https://allowed.dev");
    const server = await buildTestServer();

    const res = await server.inject({
      method: "OPTIONS",
      url: "/ping",
      headers: { origin: "https://allowed.dev", "access-control-request-method": "GET" },
    });

    expect(res.headers["access-control-allow-origin"]).toBe("https://allowed.dev");
  });
});

describe("rate limiting", () => {
  it("limits ordinary routes", async () => {
    vi.stubEnv("RATE_LIMIT_MAX", "2");
    const server = await buildTestServer({ silent: true });

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
