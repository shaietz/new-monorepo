import fp from "fastify-plugin";

export interface HealthProbeOptions {
  readonly check: () => Promise<unknown>;
}

/**
 * Stands in for the real thing a service does — a postgres plugin contributing
 * `() => fastify.pg.query("SELECT 1")` — so the tests exercise the registry through the same path
 * production uses, rather than reaching into it directly.
 */
export default fp<HealthProbeOptions>(
  async (fastify, { check }) => {
    fastify.addHealthCheck("fixture", check);
  },
  { name: "health-probe" },
);
