import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";

import { buildTestServer, closeTestServers } from "./fixtures/service.ts";

afterEach(async () => {
  await closeTestServers();
  vi.unstubAllEnvs();
});

/** The kind of text a driver puts in `error.message` — and must never reach a client. */
const LEAKY = "connect ECONNREFUSED postgres://app:hunter2@db.internal:5432";

/**
 * `silent` rather than `NODE_ENV=test`: these suites run under `production` to exercise masking,
 * and pino would otherwise write every deliberately provoked error to the suite's output.
 */
async function buildWithFailingRoutes(): Promise<FastifyInstance> {
  const server = await buildTestServer({ silent: true });

  server.get("/boom", async () => {
    throw new Error(LEAKY);
  });
  server.get("/gone", async () => {
    throw server.httpErrors.gone("finished");
  });

  return server;
}

describe("error handler", () => {
  it("masks internal error messages in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const server = await buildWithFailingRoutes();

    const res = await server.inject({ url: "/boom" });

    expect(res.statusCode).toBe(500);
    expect(res.json().message).toBe("Internal Server Error");
    expect(res.body).not.toContain("hunter2");
    expect(res.body).not.toContain("db.internal");
  });

  /** Masking in production only — hiding the cause while debugging locally helps nobody. */
  it("keeps the real message outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const server = await buildWithFailingRoutes();

    expect((await server.inject({ url: "/boom" })).json().message).toBe(LEAKY);
  });

  it("returns one shape for every failure", async () => {
    const server = await buildWithFailingRoutes();
    const res = await server.inject({ url: "/boom" });

    expect(res.json()).toMatchObject({
      statusCode: 500,
      error: "Internal Server Error",
      message: expect.any(String),
      requestId: expect.any(String),
    });
  });

  /** Without this, a user reporting "I got a 500" cannot be joined to any log line. */
  it("echoes the request id that identifies the failure in the logs", async () => {
    const server = await buildWithFailingRoutes();
    const res = await server.inject({ url: "/boom", headers: { "x-request-id": "trace-me" } });

    expect(res.json().requestId).toBe("trace-me");
  });

  /**
   * The Zod serializer throws on non-Zod schemas rather than falling back, so an error body that
   * accidentally acquired one would surface as this instead of the error it was describing.
   */
  it("serialises errors without a schema conflict", async () => {
    const server = await buildWithFailingRoutes();

    expect((await server.inject({ url: "/boom" })).body).not.toContain(
      "FST_ERR_FAILED_ERROR_SERIALIZATION",
    );
  });

  it("passes deliberate 4xx messages through", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const server = await buildWithFailingRoutes();
    const res = await server.inject({ url: "/gone" });

    expect(res.statusCode).toBe(410);
    expect(res.json()).toMatchObject({ statusCode: 410, error: "Gone", message: "finished" });
  });

  it("reports schema validation failures as 400 with detail", async () => {
    const server = await buildTestServer({ silent: true });
    server
      .withTypeProvider<ZodTypeProvider>()
      .post("/echo", { schema: { body: z.object({ email: z.email() }) } }, async () => "ok");

    const res = await server.inject({ method: "POST", url: "/echo", payload: { email: "nope" } });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ statusCode: 400, error: "Bad Request" });
    expect(res.json().details).toHaveLength(1);
  });

  /** A reply that violates its own schema is a bug here, and its shape is not the client's business. */
  it("masks a response that does not match its schema", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const server = await buildTestServer({ silent: true });
    server.withTypeProvider<ZodTypeProvider>().get(
      "/wrong",
      { schema: { response: { 200: z.object({ required: z.string() }) } } },
      // @ts-expect-error deliberately returns a shape the response schema rejects
      async () => ({}),
    );

    const res = await server.inject({ url: "/wrong" });

    expect(res.statusCode).toBe(500);
    expect(res.json().message).toBe("Internal Server Error");
  });
});

describe("not found handler", () => {
  it("returns the same shape as any other error", async () => {
    const server = await buildTestServer({ silent: true });
    const res = await server.inject({ url: "/nope" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      statusCode: 404,
      error: "Not Found",
      requestId: expect.any(String),
    });
    expect(res.json().message).toContain("/nope");
  });

  /**
   * An unlimited 404 lets an attacker enumerate valid URLs. This limiter is separate from, and much
   * tighter than, the one guarding real routes.
   */
  it("rate limits repeated misses", async () => {
    const server = await buildTestServer({ silent: true });

    // Sequential on purpose: the limiter counts in arrival order, so a parallel burst would make
    // which request is the fourth — and therefore which one is shed — nondeterministic.
    const first = await server.inject({ url: "/nope-1" });
    const second = await server.inject({ url: "/nope-2" });
    const third = await server.inject({ url: "/nope-3" });
    const fourth = await server.inject({ url: "/nope-4" });

    expect([first, second, third].map((res) => res.statusCode)).toEqual([404, 404, 404]);
    expect(fourth.statusCode).toBe(429);
  });
});
