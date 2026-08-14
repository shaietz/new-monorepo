/**
 * Workspace generators. Run `npm run gen`, or `npx turbo gen <generator>`.
 *
 * Loading mechanics worth knowing before editing this file: `@turbo/gen` bundles it to CommonJS
 * with esbuild and requires the result, so **top-level `await` is unavailable** — and a bundling
 * failure is swallowed, surfacing only as an inscrutable require error. Everything here is
 * synchronous anyway, because plop's `default` and `validate` callbacks have to be. `@turbo/gen`
 * publishes no runtime entry point, so it may only be imported for types.
 *
 * There is no root `tsconfig.json`, so `turbo run check-types` never sees this file. oxlint is its
 * only static gate.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { PlopTypes } from "@turbo/gen";

const WORKSPACE_DIRS = ["apps", "packages"] as const;

/** Lowercase, digits, single hyphens. Matches what npm accepts and what reads well as a directory. */
const KEBAB_CASE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MAX_NAME_LENGTH = 40;
const RESERVED_NAMES = new Set(["apps", "packages", "turbo", "node_modules", "src", "dist"]);

const FIRST_PORT = 8080;
const LAST_PORT = 65_535;
const PORT_DECLARATION = /^[ \t]*PORT[ \t]*=[ \t]*(\d+)[ \t]*$/m;

type PackageEnvironment = "isomorphic" | "node" | "browser";

interface EnvironmentProfile {
  /** File under `@repo/typescript-config` that the package's tsconfig extends. */
  tsconfig: string;
  /** The workspace's single `turbo.json` boundary tag. */
  tag: string;
  vitestEnvironment: string;
  isNode: boolean;
  isBrowser: boolean;
}

const ENVIRONMENTS: Record<PackageEnvironment, EnvironmentProfile> = {
  isomorphic: {
    tsconfig: "library.json",
    tag: "isomorphic",
    vitestEnvironment: "node",
    isNode: false,
    isBrowser: false,
  },
  node: {
    tsconfig: "node.json",
    tag: "node",
    vitestEnvironment: "node",
    isNode: true,
    isBrowser: false,
  },
  browser: {
    tsconfig: "react.json",
    tag: "browser",
    vitestEnvironment: "jsdom",
    isNode: false,
    isBrowser: true,
  },
};

/**
 * Files in the fastify-service template that belong only to a service that opted into that store.
 * `addMany` writes everything it globs, so an optional file is excluded from the glob rather than
 * kept in a template directory of its own. Paths are relative to this file's directory.
 */
const STORE_FILES = {
  redis: [
    "templates/fastify-service/src/plugins/external/redis.ts.hbs",
    "templates/fastify-service/test/plugins/external/redis.test.ts.hbs",
  ],
  postgres: [
    "templates/fastify-service/src/plugins/external/postgres.ts.hbs",
    "templates/fastify-service/test/plugins/external/postgres.test.ts.hbs",
  ],
} as const;

/**
 * Rejects a name that is malformed or already taken. Both `apps/` and `packages/` are checked from
 * every generator: each workspace's Vitest `test.name` is the bare name even for scoped packages,
 * so `apps/foo` and `@repo/foo` would collide in the root run that aggregates `apps/*` and
 * `packages/*`.
 */
function makeNameValidator(root: string) {
  return (input: string): true | string => {
    const name = input.trim();

    if (name === "") return "A name is required";
    if (name.length > MAX_NAME_LENGTH) return `Keep it to ${MAX_NAME_LENGTH} characters or fewer`;
    if (RESERVED_NAMES.has(name)) return `"${name}" is reserved`;
    if (!KEBAB_CASE.test(name)) {
      return `"${name}" must be kebab-case: lowercase letters and digits, separated by single hyphens`;
    }

    for (const dir of WORKSPACE_DIRS) {
      if (existsSync(path.join(root, dir, name))) return `${dir}/${name} already exists`;
    }

    return true;
  };
}

/** Ports declared by `apps/*\/.env.example`, mapped to the app that declares them. */
function scanPorts(root: string): Map<number, string> {
  const used = new Map<number, string>();
  const appsDir = path.join(root, "apps");
  if (!existsSync(appsDir)) return used;

  for (const entry of readdirSync(appsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const envFile = path.join(appsDir, entry.name, ".env.example");
    if (!existsSync(envFile)) continue;

    const match = PORT_DECLARATION.exec(readFileSync(envFile, "utf8"));
    if (match?.[1]) used.set(Number(match[1]), entry.name);
  }

  return used;
}

function nextFreePort(root: string): number {
  const used = scanPorts(root);
  let port = FIRST_PORT;
  while (used.has(port)) port += 1;
  return port;
}

/** Rescans on every keystroke-completed answer, so it stays right if the tree changed mid-session. */
function makePortValidator(root: string) {
  return (input: string): true | string => {
    const port = Number(String(input).trim());

    if (!Number.isInteger(port)) return "The port must be a whole number";
    if (port < 1024 || port > LAST_PORT) return `The port must be between 1024 and ${LAST_PORT}`;

    const owner = scanPorts(root).get(port);
    return owner === undefined ? true : `Port ${port} is already taken by apps/${owner}`;
  };
}

/**
 * Links the new workspace and refreshes the lockfile. Without this the generated package has no
 * `node_modules`, so `check-types` and `test:coverage` fail on a workspace that is otherwise
 * complete.
 */
const installAction: PlopTypes.CustomActionFunction = (_answers, _config, plop) => {
  const root = plop?.getDestBasePath() ?? process.cwd();
  const result = spawnSync("npm", ["install", "--no-audit", "--no-fund"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm install exited with ${String(result.status)} — run it by hand to see why`);
  }

  return "npm install — workspace linked, package-lock.json updated";
};

/** @public — `@turbo/gen` calls this; nothing in the repo imports it. */
export default function generator(plop: PlopTypes.NodePlopAPI): void {
  const root = plop.getDestBasePath();
  const validateName = makeNameValidator(root);

  plop.setActionType("install", installAction);

  plop.setGenerator("react-app", {
    description: "A React 19 + Vite single-page app in apps/",
    prompts: [
      {
        type: "input",
        name: "name",
        message: "App name (kebab-case; becomes apps/<name>)",
        validate: validateName,
      },
    ],
    actions: [
      {
        type: "addMany",
        destination: "apps/{{ dashCase name }}",
        base: "templates/react-app",
        templateFiles: "templates/react-app/**/*",
        globOptions: { dot: true },
      },
      { type: "install" },
    ],
  });

  plop.setGenerator("fastify-service", {
    description: "A Fastify 5 service in apps/, built on @repo/fastify-base",
    prompts: [
      {
        type: "input",
        name: "name",
        message: "Service name (kebab-case; becomes apps/<name>)",
        validate: validateName,
      },
      {
        type: "input",
        name: "port",
        message: "HTTP port",
        default: String(nextFreePort(root)),
        validate: makePortValidator(root),
      },
      {
        type: "confirm",
        name: "redis",
        message: "Add a Redis client (@fastify/redis)?",
        default: false,
      },
      {
        type: "confirm",
        name: "postgres",
        message: "Add a Postgres client (@fastify/postgres)?",
        default: false,
      },
    ],
    actions: (answers) => {
      const { redis, postgres } = answers as { redis: boolean; postgres: boolean };

      return [
        {
          type: "addMany",
          destination: "apps/{{ dashCase name }}",
          base: "templates/fastify-service",
          templateFiles: "templates/fastify-service/**/*",
          globOptions: {
            dot: true,
            ignore: [
              ...(redis ? [] : STORE_FILES.redis),
              ...(postgres ? [] : STORE_FILES.postgres),
            ],
          },
          // Handlebars reads `redis` and `postgres` straight off the answers, so only the derived
          // flag has to be passed — and plop drops `data` keys that collide with an answer.
          data: { hasDataStore: redis || postgres },
        },
        { type: "install" },
      ];
    },
  });

  plop.setGenerator("package", {
    description: "A shared package in packages/, published internally as @repo/<name>",
    prompts: [
      {
        type: "input",
        name: "name",
        message: "Package name (kebab-case; becomes packages/<name>, imported as @repo/<name>)",
        validate: validateName,
      },
      {
        type: "list",
        name: "environment",
        message: "Where does it run?",
        default: "isomorphic",
        choices: [
          {
            name: "isomorphic — both browser and Node, so it may depend on neither",
            value: "isomorphic",
          },
          { name: "node       — server-side only", value: "node" },
          { name: "browser    — client-side only", value: "browser" },
        ],
      },
    ],
    actions: (answers) => {
      const { environment } = answers as { environment: PackageEnvironment };

      return [
        {
          type: "addMany",
          destination: "packages/{{ dashCase name }}",
          base: "templates/package",
          templateFiles: "templates/package/**/*",
          globOptions: { dot: true },
          data: ENVIRONMENTS[environment],
        },
        { type: "install" },
      ];
    },
  });
}
