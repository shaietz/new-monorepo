import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildTestServer, closeTestServers } from "./fixtures/service.ts";
import { buildWithPlugin, closeHarnesses } from "../src/testing.ts";
import { healthPlugin } from "../src/health.ts";

afterEach(async () => {
  await Promise.all([closeTestServers(), closeHarnesses()]);
  vi.unstubAllEnvs();
});

/** Reports an outage the only way the registry recognises: by rejecting. */
const unhealthy = async () => {
  throw new Error("dependency down");
};

/** A dependency that has stopped answering usually hangs rather than refusing. */
const wedged = () => new Promise<void>(() => {});

async function build(healthCheck?: () => Promise<void>): Promise<FastifyInstance> {
  const server = await buildWithPlugin(healthPlugin);
  server.get("/ping", async () => "pong\n");

  if (healthCheck) server.addHealthCheck("dependency", healthCheck);

  return server;
}

describe("/livez", () => {
  it("reports ok", async () => {
    const server = await build();
    const res = await server.inject({ url: "/livez" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("stays ok while a dependency is down", async () => {
    const server = await build(unhealthy);

    expect((await server.inject({ url: "/livez" })).statusCode).toBe(200);
  });
});

describe("/readyz", () => {
  it("reports ok when no health check is registered", async () => {
    const server = await build();
    const res = await server.inject({ url: "/readyz" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("reports ok when every registered check passes", async () => {
    const server = await build(async () => {});

    expect((await server.inject({ url: "/readyz" })).statusCode).toBe(200);
  });

  /**
   * Regression guard for the Zod serializer. Assert the body, not just the status: a mis-wired
   * serializer surfaces as 500 FST_ERR_FAILED_ERROR_SERIALIZATION in the payload.
   */
  it("serialises without a schema conflict", async () => {
    const server = await build();

    expect((await server.inject({ url: "/readyz" })).body).not.toContain(
      "FST_ERR_FAILED_ERROR_SERIALIZATION",
    );
  });

  it("fails when a health check rejects", async () => {
    const server = await build(unhealthy);
    const res = await server.inject({ url: "/readyz" });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "unavailable" });
  });

  /** A probe that never settles reads as neither healthy nor sick, so it has to have a deadline. */
  it("fails when a health check never settles", async () => {
    vi.stubEnv("HEALTH_TIMEOUT_MS", "50");
    const server = await build(wedged);

    const res = await server.inject({ url: "/readyz" });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "unavailable" });
  });

  /** Readiness is the only thing the health check gates — nothing sheds ordinary traffic. */
  it("leaves service routes answering while unhealthy", async () => {
    const server = await build(unhealthy);
    const ping = await server.inject({ url: "/ping" });

    expect(ping.statusCode).toBe(200);
    expect(ping.body).toBe("pong\n");
  });
});

/**
 * The probe reaches the registry through `test/fixtures/health-probe.ts`, i.e. the same
 * path a real service's `plugins/external/postgres.ts` takes.
 */
describe("probes contributed by an autoloaded plugin", () => {
  it("gate readiness on the assembled service", async () => {
    const server = await buildTestServer({ healthCheck: unhealthy, silent: true });

    expect((await server.inject({ url: "/readyz" })).statusCode).toBe(503);
    expect((await server.inject({ url: "/ping" })).statusCode).toBe(200);
  });

  it("leave readiness green while they pass", async () => {
    const server = await buildTestServer({ healthCheck: async () => {} });

    expect((await server.inject({ url: "/readyz" })).statusCode).toBe(200);
  });
});
