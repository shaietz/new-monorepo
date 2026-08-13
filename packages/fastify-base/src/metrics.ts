import fp from "fastify-plugin";
import metrics from "fastify-metrics";

/** The endpoint a scraper talks to. Rate limiting exempts it. */
export const METRICS_PATH = "/metrics";

/**
 * Prometheus metrics for every route the service serves.
 *
 * Register **before swagger**: Prometheus exposition is ops output, not API surface, so `/metrics`
 * should stay out of the published spec. Registering it after swagger would document it.
 *
 * `metrics.default` is deliberate — fastify-metrics is CJS, so Node's ESM interop makes the plain
 * default import the whole `module.exports`; `register` unwraps it, `tsc` does not.
 * `clearRegisterOnInit` is required because prom-client's registry is global, and a second instance
 * in the same process throws without it.
 *
 * @see {@link https://github.com/SkeLLLa/fastify-metrics}
 */
export const metricsPlugin = fp(
  async (fastify) => {
    await fastify.register(metrics.default, {
      endpoint: METRICS_PATH,
      clearRegisterOnInit: true,
    });
  },
  { name: "metrics" },
);
