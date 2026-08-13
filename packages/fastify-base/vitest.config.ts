import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "fastify-base",
    environment: "node",
    // Routes `@fastify/autoload`'s dynamic import through Vitest's module graph. Without it
    // autoload reaches each plugin file with a plain Node import, the module is evaluated a second
    // time outside the runner, and coverage for every autoloaded file is measured against a copy
    // that never ran.
    server: { deps: { inline: [/@fastify\/autoload/] } },
    include: ["test/**/*.{test,spec}.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
