import fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "./env.ts";
import { basePlugin } from "./plugin.ts";
import { serverOptions } from "./server-options.ts";
import { drainAndClose, startService } from "./start.ts";

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
  return { server, config };
}

describe("startService", () => {
  it("listens on the configured host and port and serves requests", async () => {
    vi.stubEnv("PORT", "0");
    vi.stubEnv("HOST", "127.0.0.1");

    const config = loadConfig();
    const server = fastify(serverOptions(config, "test"));

    started.push(server);
    server.get("/ping", async () => "pong\n");

    await startService(server, config);

    const address = server.server.address();
    expect(address).not.toBeNull();
    expect(typeof address).not.toBe("string");

    const { port } = address as { port: number };
    const res = await fetch(`http://127.0.0.1:${port}/ping`);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("pong\n");
  });
});

/**
 * The signal path itself cannot be tested — close-with-grace exits the process, which would take the
 * runner with it. `drainAndClose` is the whole body of that handler.
 */
describe("drainAndClose", () => {
  it("fails readiness before it stops accepting connections", async () => {
    vi.stubEnv("SHUTDOWN_DELAY_MS", "100");
    const { server, config } = await buildTestServer();

    const draining = drainAndClose(server, config);

    // Still serving, but already telling the load balancer to route elsewhere. Closing without this
    // window drops whatever was routed here before the orchestrator caught up.
    expect((await server.inject({ url: "/readyz" })).statusCode).toBe(503);
    expect((await server.inject({ url: "/ping" })).statusCode).toBe(200);

    await draining;
  });

  it("closes the server once the drain window has passed", async () => {
    vi.stubEnv("SHUTDOWN_DELAY_MS", "0");
    const { server, config } = await buildTestServer();

    await drainAndClose(server, config);

    // Fastify rejects work on a closed instance rather than serving it.
    await expect(server.inject({ url: "/ping" })).rejects.toThrow(
      "Fastify has already been closed and cannot be reopened",
    );
  });
});
