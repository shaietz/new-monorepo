import { describe, expect, it } from "vitest";
import { buildServer } from "./app.ts";

describe("GET /ping", () => {
  it("returns pong", async () => {
    const server = buildServer();
    const res = await server.inject({ method: "GET", url: "/ping" });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("pong\n");

    await server.close();
  });
});
