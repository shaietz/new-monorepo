import fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { loadConfig, loggerOptions } from "./env.ts";
import { startService } from "./start.ts";

const started: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((server) => server.close()));
  vi.unstubAllEnvs();
});

describe("startService", () => {
  it("listens on the configured host and port and serves requests", async () => {
    vi.stubEnv("PORT", "0");
    vi.stubEnv("HOST", "127.0.0.1");

    const config = loadConfig();
    const server = fastify({ logger: loggerOptions(config) });

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
