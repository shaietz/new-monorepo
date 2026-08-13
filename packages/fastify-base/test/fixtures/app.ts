import { join } from "node:path";
import autoload from "@fastify/autoload";
import fp from "fastify-plugin";
import type { FastifyConfig } from "fastify";

import { basePlugin } from "../../src/index.ts";
import healthProbe from "./health-probe.ts";

export interface FixtureAppOptions {
  /** Passed in rather than loaded here, so a test can `vi.stubEnv` before each build. */
  readonly config: FastifyConfig;
  readonly name: string;
  readonly healthCheck?: () => Promise<unknown>;
}

/**
 * A miniature service, wired exactly the way a real one is. Keeping the fixture in the same shape
 * means these tests cover the arrangement services actually use, not a private shortcut.
 *
 * The hand-wired equivalent lives in `explicit-app.ts`; both must satisfy `expectBaseContract`.
 */
export default fp<FixtureAppOptions>(
  async (fastify, { config, name, healthCheck }) => {
    await fastify.register(basePlugin, { config, name });

    if (healthCheck) await fastify.register(healthProbe, { check: healthCheck });

    await fastify.register(autoload, {
      dir: join(import.meta.dirname, "routes"),
      options: {},
      autoHooks: true,
      cascadeHooks: true,
    });
  },
  { name: "fixture-app" },
);
