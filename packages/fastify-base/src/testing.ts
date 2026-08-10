import assert from "node:assert/strict";
import Fastify from "fastify";
import type {
  FastifyConfig,
  FastifyInstance,
  FastifyPluginAsync,
  FastifyPluginCallback,
  FastifyPluginOptions,
} from "fastify";

import { configPlugin, loadConfig } from "./config.ts";
import { healthRegistryPlugin, LIVEZ_PATH, READYZ_PATH } from "./health.ts";
import { METRICS_PATH } from "./metrics.ts";
import { requestIdPlugin } from "./request-id.ts";
import { zodPlugin } from "./zod.ts";

const started: FastifyInstance[] = [];

export interface HarnessOptions<T extends FastifyPluginOptions = FastifyPluginOptions> {
  /**
   * Merged over `loadConfig()`. A service whose plugins read config it added to `FastifyConfig`
   * must supply those keys here — only the base schema is parsed from the environment.
   */
  readonly config?: Partial<FastifyConfig>;
  readonly name?: string;
  /** Passed to `register(plugin, …)` — the ordinary way a plugin takes a substitute dependency. */
  readonly options?: T;
}

/**
 * One plugin on top of the bootstrap layer and nothing else, so an undeclared dependency — reaching
 * for `fastify.rateLimit`, say — fails here rather than as a boot error in the assembled app.
 *
 * ```ts
 * afterEach(closeHarnesses);
 * const server = await buildWithPlugin(redis, { options: { client: stub } });
 * ```
 */
export async function buildWithPlugin<T extends FastifyPluginOptions = FastifyPluginOptions>(
  plugin: FastifyPluginAsync<T> | FastifyPluginCallback<T>,
  { config, name = "test", options }: HarnessOptions<T> = {},
): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });

  // Only the base schema is parsed here; anything a service added to `FastifyConfig` has to arrive
  // through `config`, which is what makes the cast the caller's responsibility.
  await server.register(configPlugin, {
    config: { ...loadConfig(), ...config } as FastifyConfig,
    name,
  });
  await server.register(zodPlugin);
  await server.register(requestIdPlugin);
  await server.register(healthRegistryPlugin);

  await server.register(plugin, options ?? ({} as T));

  started.push(server);
  return server;
}

/** Call from `afterEach`, alongside `closeTestServers`. */
export async function closeHarnesses(): Promise<void> {
  await Promise.all(started.splice(0).map((server) => server.close()));
}

/**
 * Asserts that a service wired up the base stack correctly. One line in a service's test suite:
 *
 * ```ts
 * await expectBaseContract(Fastify(options).register(app));
 * ```
 *
 * Services register these plugins themselves, so a missing or misordered one is possible in a way it
 * is not when a single function does the wiring. Every assertion here corresponds to a failure that
 * is otherwise silent — the ordering ones especially, which produce no error, just a missing header
 * or a route absent from the spec.
 *
 * Uses `node:assert` rather than a matcher library so it carries no dependency of its own.
 */
export async function expectBaseContract(fastify: FastifyInstance): Promise<void> {
  await fastify.ready();

  const livez = await fastify.inject({ url: LIVEZ_PATH });
  assert.equal(livez.statusCode, 200, "GET /livez should answer 200 — is healthPlugin registered?");
  assert.deepEqual(livez.json(), { status: "ok" });

  const readyz = await fastify.inject({ url: READYZ_PATH });
  assert.equal(readyz.statusCode, 200, "GET /readyz should answer 200 with all checks passing");
  assert.deepEqual(readyz.json(), { status: "ok" });

  // Zod compilers reach the probes' response schemas. A missing `zodPlugin` surfaces here as
  // FST_ERR_FAILED_ERROR_SERIALIZATION rather than as a type error.
  assert.doesNotMatch(
    readyz.body,
    /FST_ERR_/u,
    "response serialisation failed — is zodPlugin registered?",
  );

  const metrics = await fastify.inject({ url: METRICS_PATH });
  assert.equal(
    metrics.statusCode,
    200,
    "GET /metrics should answer — is metricsPlugin registered?",
  );
  assert.match(metrics.body, /http_request_duration_seconds/u);

  assert.ok(
    livez.headers["content-security-policy"],
    "security headers missing — is @fastify/helmet registered?",
  );
  assert.match(
    String(livez.headers["x-request-id"]),
    /^[0-9a-f-]{36}$/u,
    "x-request-id not echoed — is requestIdPlugin registered?",
  );

  const first = await fastify.inject({ url: "/__contract-missing" });
  assert.equal(first.statusCode, 404);
  assert.deepEqual(
    Object.keys(first.json() as object).toSorted(),
    ["error", "message", "requestId", "statusCode"],
    "404 is not the shared error shape — is errorHandlerPlugin registered?",
  );

  // Three more misses trip the not-found handler's own limiter (max 3 per 500ms), which is a cheap
  // way to get a shed request without touching the service's real rate limit.
  await fastify.inject({ url: "/__contract-missing-2" });
  await fastify.inject({ url: "/__contract-missing-3" });
  const limited = await fastify.inject({ url: "/__contract-missing-4" });

  assert.equal(limited.statusCode, 429, "repeated 404s should be rate limited");
  assert.ok(
    limited.headers["x-request-id"],
    "a shed request lost x-request-id — is requestIdPlugin registered?",
  );

  // Swagger collects routes through an `onRoute` hook, so it only documents what follows it.
  const paths = Object.keys(fastify.swagger().paths ?? {});
  assert.ok(
    paths.includes(LIVEZ_PATH) && paths.includes(READYZ_PATH),
    "probes missing from the OpenAPI spec — healthPlugin must be registered after swaggerPlugin",
  );
  assert.ok(
    !paths.includes(METRICS_PATH),
    "/metrics leaked into the OpenAPI spec — metricsPlugin must be registered before swaggerPlugin",
  );
}
