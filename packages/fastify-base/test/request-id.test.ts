import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";

import { requestId } from "../src/request-id.ts";

const UUID = /^[0-9a-f-]{36}$/;

/** `genReqId` is handed the raw Node request, long before Fastify has built anything around it. */
const reqWith = (header?: string | string[]) =>
  ({ headers: header === undefined ? {} : { "x-request-id": header } }) as IncomingMessage;

describe("requestId", () => {
  it("propagates an upstream request id", () => {
    expect(requestId(reqWith("upstream-123"))).toBe("upstream-123");
  });

  it("takes the first value when x-request-id is repeated", () => {
    // Node joins duplicate headers into "first,second" before anything else sees them.
    expect(requestId(reqWith("first,second"))).toBe("first");
  });

  it("trims surrounding whitespace", () => {
    expect(requestId(reqWith("  spaced  "))).toBe("spaced");
  });

  it("generates an id when the header is absent", () => {
    expect(requestId(reqWith())).toMatch(UUID);
  });

  it("generates an id when the header is empty", () => {
    expect(requestId(reqWith("  "))).toMatch(UUID);
  });

  /** Node hands over an array for headers it does not collapse, which is not a usable id. */
  it("generates an id when the header arrives as an array", () => {
    expect(requestId(reqWith(["first", "second"]))).toMatch(UUID);
  });

  /**
   * Fastify's own fallback is a per-process counter (`req-1`, `req-2`), which collides between
   * replicas. A UUID is the reason this function exists at all rather than `requestIdHeader`.
   */
  it("generates ids that do not collide across processes", () => {
    expect(requestId(reqWith())).not.toBe(requestId(reqWith()));
  });
});
