import fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
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
  const server = fastify(serverOptions(config, "orders"));

  await server.register(basePlugin, { config, name: "orders" });

  server
    .withTypeProvider<ZodTypeProvider>()
    .get("/things", { schema: { response: { 200: z.object({ id: z.uuid() }) } } }, async () => ({
      id: crypto.randomUUID(),
    }));

  started.push(server);
  return server;
}

describe("docs", () => {
  /** The spec describes the whole API surface, so publishing it is a decision, not a default. */
  it("is off unless asked for", async () => {
    const server = await buildTestServer();

    expect((await server.inject({ url: "/docs/json" })).statusCode).toBe(404);
  });

  it("serves an OpenAPI document titled after the service", async () => {
    vi.stubEnv("ENABLE_DOCS", "true");
    const server = await buildTestServer();

    const res = await server.inject({ url: "/docs/json" });

    expect(res.statusCode).toBe(200);
    expect(res.json().info).toMatchObject({ title: "orders" });
  });

  /** Documentation is generated from the schemas routes already validate against, so it cannot drift. */
  it("describes routes registered after the plugin", async () => {
    vi.stubEnv("ENABLE_DOCS", "true");
    const server = await buildTestServer();

    const paths = (await server.inject({ url: "/docs/json" })).json().paths;

    expect(Object.keys(paths)).toContain("/things");
    expect(Object.keys(paths)).toContain("/readyz");
  });
});
