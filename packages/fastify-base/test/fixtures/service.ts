import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

import { loadConfig } from "../../src/config.ts";
import { serverOptions } from "../../src/server-options.ts";
import app from "./app.ts";

const started: FastifyInstance[] = [];

export interface TestServerOptions {
  readonly name?: string;
  readonly healthCheck?: () => Promise<unknown>;
  /** Silences pino for suites that provoke errors, without pretending to be a different NODE_ENV. */
  readonly silent?: boolean;
}

/** Reads `process.env` on every call, so a test can `vi.stubEnv` first. */
export async function buildTestServer({
  name = "test",
  healthCheck,
  silent = false,
}: TestServerOptions = {}): Promise<FastifyInstance> {
  const config = loadConfig();
  const options = serverOptions(config, name);
  const fastify = Fastify(silent ? { ...options, logger: false } : options);

  // Awaited, not `ready()`: the plugin boots but the instance stays open, so a test can still add
  // its own routes afterwards.
  await fastify.register(app, { config, name, ...(healthCheck ? { healthCheck } : {}) });

  started.push(fastify);
  return fastify;
}

/** Call from `afterEach`. A server left open holds its port and its metrics registry. */
export async function closeTestServers(): Promise<void> {
  await Promise.all(started.splice(0).map((server) => server.close()));
}
