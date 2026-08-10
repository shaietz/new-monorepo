import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildWithPlugin, closeHarnesses } from "../src/testing.ts";
import { corsPlugin } from "../src/cors.ts";

afterEach(closeHarnesses);

async function build(CORS_ORIGIN: string): Promise<FastifyInstance> {
  const server = await buildWithPlugin(corsPlugin, { config: { CORS_ORIGIN } });
  server.get("/ping", async () => "pong\n");
  return server;
}

const preflight = (server: FastifyInstance, origin: string) =>
  server.inject({
    method: "OPTIONS",
    url: "/ping",
    headers: { origin, "access-control-request-method": "GET" },
  });

describe("cors", () => {
  /**
   * Not registered at all, rather than registered with a falsy origin: `@fastify/cors` would still
   * answer preflights and still add `vary: Origin`, which is a different thing from "no CORS".
   */
  it("stays disabled when no origin is configured", async () => {
    const server = await build("");

    expect(
      (await preflight(server, "https://elsewhere.dev")).headers["access-control-allow-origin"],
    ).toBeUndefined();
  });

  it("honours a configured origin", async () => {
    const server = await build("https://allowed.dev");

    const allowed = await preflight(server, "https://allowed.dev");
    const denied = await preflight(server, "https://denied.dev");

    expect(allowed.headers["access-control-allow-origin"]).toBe("https://allowed.dev");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("reads a comma-separated list as an allow-list", async () => {
    const server = await build("https://one.dev, https://two.dev");

    expect(
      (await preflight(server, "https://two.dev")).headers["access-control-allow-origin"],
    ).toBe("https://two.dev");
    expect(
      (await preflight(server, "https://three.dev")).headers["access-control-allow-origin"],
    ).toBeUndefined();
  });

  it("allows a wildcard origin", async () => {
    const server = await build("*");

    expect(
      (await preflight(server, "https://anywhere.dev")).headers["access-control-allow-origin"],
    ).toBe("*");
  });
});
