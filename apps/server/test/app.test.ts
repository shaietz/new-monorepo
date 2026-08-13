import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { expectBaseContract } from "@repo/fastify-base/testing";
import type { FastifyInstance } from "fastify";
import app, { options } from "../src/app.ts";

const started: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((server) => server.close()));
});

/** Awaited rather than `ready()`, so a test can still add its own routes afterwards. */
async function build() {
  const server = Fastify(options);
  await server.register(app);

  started.push(server);
  return server;
}

describe("base contract", () => {
  it("wires up the shared stack correctly", async () => {
    await expectBaseContract(await build());
  });
});

describe("GET /ping", () => {
  /** Comes from `src/routes/root.ts`, discovered by autoload rather than registered by hand. */
  it("returns pong", async () => {
    const server = await build();
    const res = await server.inject({ method: "GET", url: "/ping" });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("pong\n");
  });
});

describe("request ids", () => {
  /** `req.id` isn't visible on a normal response, so expose it for the assertion. */
  async function buildWithProbe() {
    const server = await build();
    server.get("/whoami", async (req) => ({ id: req.id }));
    return server;
  }

  it("propagates an upstream request id", async () => {
    const server = await buildWithProbe();
    const res = await server.inject({
      url: "/whoami",
      headers: { "x-request-id": "upstream-123" },
    });

    expect(res.json()).toEqual({ id: "upstream-123" });
  });

  it("takes the first value when x-request-id is repeated", async () => {
    // Node joins duplicate headers into "first,second" before Fastify sees them.
    const server = await buildWithProbe();
    const res = await server.inject({
      url: "/whoami",
      headers: { "x-request-id": ["first", "second"] },
    });

    expect(res.json()).toEqual({ id: "first" });
  });

  it("generates an id when the header is absent", async () => {
    const server = await buildWithProbe();
    const res = await server.inject({ url: "/whoami" });

    expect(res.json().id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("generates an id when the header is empty", async () => {
    const server = await buildWithProbe();
    const res = await server.inject({ url: "/whoami", headers: { "x-request-id": "  " } });

    expect(res.json().id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
