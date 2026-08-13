import { afterEach, describe, it, vi } from "vitest";
import Fastify from "fastify";

import { loadConfig } from "../src/config.ts";
import { serverOptions } from "../src/server-options.ts";
import { expectBaseContract } from "../src/testing.ts";
import { buildTestServer, closeTestServers } from "./fixtures/service.ts";
import explicitApp from "./fixtures/explicit-app.ts";

afterEach(async () => {
  await closeTestServers();
  vi.unstubAllEnvs();
});

describe("expectBaseContract", () => {
  it("passes against a correctly wired service", async () => {
    await expectBaseContract(await buildTestServer({ silent: true }));
  });

  /**
   * The escape hatch, exercised rather than merely documented: a service that needs to change one
   * of the defaults inlines `basePlugin`'s list into its own `app.ts`, and that arrangement has to
   * satisfy the same contract.
   */
  it("passes against the hand-wired equivalent of basePlugin", async () => {
    const config = loadConfig();
    const fastify = Fastify({ ...serverOptions(config, "test"), logger: false });
    await fastify.register(explicitApp, { config, name: "test" });

    await expectBaseContract(fastify);
    await fastify.close();
  });
});
