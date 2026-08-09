import fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "./env.ts";
import { beginShutdown } from "./health.ts";
import { basePlugin } from "./plugin.ts";
import { serverOptions } from "./server-options.ts";

const started: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((server) => server.close()));
  vi.unstubAllEnvs();
});

/** Reports an outage the only way `basePlugin` recognises: by rejecting. */
const unhealthy = async () => {
  throw new Error("dependency down");
};

/** A dependency that has stopped answering usually hangs rather than refusing. */
const wedged = () => new Promise<void>(() => {});

async function buildTestServer(healthCheck?: () => Promise<void>) {
  const config = loadConfig();
  const server = fastify(serverOptions(config, "test"));

  await server.register(basePlugin, {
    config,
    name: "test",
    ...(healthCheck ? { healthCheck } : {}),
  });
  server.get("/ping", async () => "pong\n");

  started.push(server);
  return server;
}

describe("/livez", () => {
  it("reports ok", async () => {
    const server = await buildTestServer();
    const res = await server.inject({ url: "/livez" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("stays ok while a dependency is down", async () => {
    const server = await buildTestServer(unhealthy);

    expect((await server.inject({ url: "/livez" })).statusCode).toBe(200);
  });

  /** Failing liveness mid-drain restarts the pod, which is the opposite of a graceful shutdown. */
  it("stays ok while the service is draining", async () => {
    const server = await buildTestServer();
    beginShutdown(server);

    expect((await server.inject({ url: "/livez" })).statusCode).toBe(200);
  });
});

describe("/readyz", () => {
  it("reports ok when no health check is configured", async () => {
    const server = await buildTestServer();
    const res = await server.inject({ url: "/readyz" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  /**
   * Regression guard for the Zod serializer. Assert the body, not just the status: a mis-wired
   * serializer surfaces as 500 FST_ERR_FAILED_ERROR_SERIALIZATION in the payload.
   */
  it("serialises without a schema conflict", async () => {
    const server = await buildTestServer();
    const res = await server.inject({ url: "/readyz" });

    expect(res.body).not.toContain("FST_ERR_FAILED_ERROR_SERIALIZATION");
  });

  it("fails when the health check rejects", async () => {
    const server = await buildTestServer(unhealthy);
    const res = await server.inject({ url: "/readyz" });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "unavailable" });
  });

  /** A probe that never settles reads as neither healthy nor sick, so it has to have a deadline. */
  it("fails when the health check never settles", async () => {
    vi.stubEnv("HEALTH_TIMEOUT_MS", "50");
    const server = await buildTestServer(wedged);

    const res = await server.inject({ url: "/readyz" });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "unavailable" });
  });

  it("fails once the service starts draining, before the health check runs", async () => {
    const server = await buildTestServer(wedged);
    beginShutdown(server);

    // Would hang forever if draining did not short-circuit the check.
    const res = await server.inject({ url: "/readyz" });

    expect(res.statusCode).toBe(503);
  });

  /** Readiness is the only thing the health check gates — nothing sheds ordinary traffic. */
  it("leaves service routes answering while unhealthy", async () => {
    const server = await buildTestServer(unhealthy);
    const ping = await server.inject({ url: "/ping" });

    expect(ping.statusCode).toBe(200);
    expect(ping.body).toBe("pong\n");
  });
});
