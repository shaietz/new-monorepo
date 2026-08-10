import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";

import { buildTestServer, closeTestServers } from "./fixtures/service.ts";
import { buildWithPlugin, closeHarnesses } from "../src/testing.ts";
import { swaggerPlugin } from "../src/swagger.ts";

afterEach(async () => {
  await Promise.all([closeTestServers(), closeHarnesses()]);
  vi.unstubAllEnvs();
});

async function build(ENABLE_DOCS: boolean): Promise<FastifyInstance> {
  const server = await buildWithPlugin(swaggerPlugin, { name: "orders", config: { ENABLE_DOCS } });

  server
    .withTypeProvider<ZodTypeProvider>()
    .get("/things", { schema: { response: { 200: z.object({ id: z.uuid() }) } } }, async () => ({
      id: crypto.randomUUID(),
    }));

  return server;
}

describe("docs", () => {
  /** The spec describes the whole API surface, so publishing it is a decision, not a default. */
  it("is off unless asked for", async () => {
    const server = await build(false);

    expect((await server.inject({ url: "/docs/json" })).statusCode).toBe(404);
  });

  it("serves an OpenAPI document titled after the service", async () => {
    const server = await build(true);

    const res = await server.inject({ url: "/docs/json" });

    expect(res.statusCode).toBe(200);
    expect(res.json().info).toMatchObject({ title: "orders" });
  });

  /** Documentation is generated from the schemas routes already validate against, so it cannot drift. */
  it("describes routes registered after it", async () => {
    const server = await build(true);

    expect(Object.keys((await server.inject({ url: "/docs/json" })).json().paths)).toContain(
      "/things",
    );
  });

  it("serves the UI alongside the document", async () => {
    const server = await build(true);
    const res = await server.inject({ url: "/docs" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  /**
   * The ordering the whole assembly depends on: swagger registers before the health routes and
   * before the service's autoloaded `routes/` directory, so both reach the spec. A route declared
   * earlier than swagger would silently vanish from it.
   *
   * `/metrics` is the deliberate exception — it registers one line *above* swagger in `app.ts`,
   * because Prometheus exposition is ops output rather than API surface. Asserted here so that
   * reordering the two fails a test instead of quietly changing the published spec.
   */
  it("documents the API surface and the probes, but not the metrics endpoint", async () => {
    vi.stubEnv("ENABLE_DOCS", "true");
    const server = await buildTestServer();

    const paths = Object.keys((await server.inject({ url: "/docs/json" })).json().paths);

    expect(paths).toEqual(expect.arrayContaining(["/ping", "/livez", "/readyz"]));
    expect(paths).not.toContain("/metrics");
  });
});
