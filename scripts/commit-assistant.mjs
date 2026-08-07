import { spawnSync } from "node:child_process";
import { openSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import tty from "node:tty";
import { fileURLToPath } from "node:url";
import { select, input } from "@inquirer/prompts";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(moduleDir, "..");
const commitlintBin = path.join(rootDir, "node_modules", "@commitlint", "cli", "cli.js");
const messageFile = process.argv[2];

const TYPES = [
  { name: "feat      New feature", value: "feat" },
  { name: "fix       Bug fix", value: "fix" },
  { name: "docs      Documentation", value: "docs" },
  { name: "style     Code style (formatting, etc)", value: "style" },
  { name: "refactor  Code change that neither fixes a bug nor adds a feature", value: "refactor" },
  { name: "perf      Performance improvement", value: "perf" },
  { name: "test      Adding or correcting tests", value: "test" },
  { name: "build     Build system or dependencies", value: "build" },
  { name: "ci        CI configuration", value: "ci" },
  { name: "chore     Maintenance", value: "chore" },
  { name: "revert    Revert a previous commit", value: "revert" },
  { name: "revert    Revert a previous commit", value: "revert" },
];

function runCommitlint() {
  return spawnSync(process.execPath, [commitlintBin, "--edit", messageFile], {
    cwd: rootDir,
    encoding: "utf8",
  });
}

function workspaceScopes() {
  const scopes = [];
  for (const dir of ["apps", "packages"]) {
    try {
      for (const entry of readdirSync(path.join(rootDir, dir), { withFileTypes: true })) {
        if (entry.isDirectory()) scopes.push(entry.name);
      }
    } catch {
      // workspace group may not exist, ignore
    }
  }
  return scopes;
}

// Our hook (.husky/commit-msg) invokes this script with no shell-level
// stdio redirection, so process.stdin/stdout are normally already the
// real console, inherited straight through git -> sh.exe -> node. Prefer
// that: it needs none of the fragile device-path tricks below.
//
// Fallback, if stdin/stdout ever aren't real TTYs (e.g. some other tool
// invokes this script through a pipe): Git for Windows runs hook scripts
// through its bundled MSYS sh.exe, whose /dev/tty emulation doesn't behave
// like a real console for native Node, so opening the platform console
// device directly sidesteps that layer. The fd must be wrapped as a
// `tty.ReadStream`/`tty.WriteStream`, not a plain `fs` stream: only the
// tty-flavored streams expose `setRawMode`, which inquirer needs to read
// arrow keys one keypress at a time instead of waiting for a buffered line.
function openConsole() {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    return { input: process.stdin, output: process.stdout };
  }

  const isWindows = process.platform === "win32";
  if (isWindows) {
    // Without forcing the codepage to UTF-8, writing straight to CONOUT$
    // bypasses Node's normal console conversion and renders as mojibake.
    spawnSync("chcp", ["65001"], { shell: true, stdio: "ignore" });
  }
  const ttyIn = isWindows ? "\\\\.\\CONIN$" : "/dev/tty";
  const ttyOut = isWindows ? "\\\\.\\CONOUT$" : "/dev/tty";
  // Windows console handles must be opened with both GENERIC_READ and
  // GENERIC_WRITE regardless of direction, or the mode-setting calls
  // uv_tty_init makes during raw-mode setup fail with EPERM. "r+" is the
  // fs flag that maps to O_RDWR.
  const inFd = openSync(ttyIn, "r+");
  const outFd = openSync(ttyOut, "r+");
  const consoleInput = new tty.ReadStream(inFd);
  const consoleOutput = new tty.WriteStream(outFd);
  // inquirer only calls setRawMode automatically on the real process.stdin;
  // for a stream we hand it explicitly, we have to switch it to raw mode
  // ourselves or arrow keys etc. never reach it (see @inquirer/prompts README).
  consoleInput.setRawMode(true);
  // @inquirer/core pipes an internal MuteStream into whatever `output` we give
  // it and calls .end() on that MuteStream when a prompt finishes; the default
  // pipe() behavior forwards that as a real .end() on our stream too. For
  // process.stdout Node ignores it (the stdio fds are protected), but this
  // manually-opened CONOUT$ handle has no such protection, so it would
  // actually close after the *first* prompt — every prompt after that
  // (scope, description) then renders into a dead stream and nothing appears
  // on screen, which looks like the CLI hung. Neutralize .end() so the handle
  // survives the whole multi-prompt flow.
  consoleOutput.end = () => consoleOutput;
  return { input: consoleInput, output: consoleOutput, isCustomTty: true };
}

function restoreConsole(io) {
  if (io?.isCustomTty) {
    try {
      io.input.setRawMode(false);
    } catch {
      // best-effort restore, nothing more we can do if this fails
    }
  }
}

function exit(code, io) {
  restoreConsole(io);
  process.exit(code);
}

async function main() {
  if (!messageFile) {
    console.error("commit-assistant: no commit message file provided");
    process.exit(1);
  }

  const first = runCommitlint();
  if (first.status === 0) {
    process.exit(0);
  }

  let io;
  try {
    io = openConsole();
  } catch (error) {
    console.error(first.stdout?.trim() || first.stderr?.trim() || "");
    console.error("\ncommit-assistant: could not open an interactive console, aborting.");
    console.error(`  ${error.code ?? error.name ?? "ERROR"}: ${error.message}`);
    console.error(
      `  process.stdin.isTTY=${process.stdin.isTTY} process.stdout.isTTY=${process.stdout.isTTY}`,
    );
    process.exit(1);
  }

  const original = readFileSync(messageFile, "utf8").split("\n")[0];

  io.output.write("\n✖ Invalid commit message\n\n");
  io.output.write(`${first.stdout?.trim() || first.stderr?.trim() || ""}\n`);
  io.output.write("\nOpening commit assistant...\n\n");

  try {
    const type = await select(
      {
        message: "Select commit type:",
        choices: TYPES,
      },
      io,
    );

    const scopeChoices = workspaceScopes();
    const scopePick = await select(
      {
        message: "Scope:",
        choices: [
          { name: "(none)", value: "" },
          ...scopeChoices.map((s) => ({ name: s, value: s })),
          { name: "other (type your own)", value: "__other__" },
        ],
      },
      io,
    );
    const scope =
      scopePick === "__other__" ? await input({ message: "Enter scope:" }, io) : scopePick;

    const description = await input(
      {
        message: "Description:",
        default: original.replace(/^\w+(\([^)]*\))?!?:\s*/, ""),
        validate: (value) => (value.trim().length > 0 ? true : "Description is required"),
      },
      io,
    );

    const header = scope ? `${type}(${scope}): ${description}` : `${type}: ${description}`;
    writeFileSync(messageFile, `${header}\n`);

    const second = runCommitlint();
    if (second.status !== 0) {
      io.output.write(`${second.stdout?.trim() || second.stderr?.trim() || ""}\n`);
      io.output.write("\ncommit-assistant: message still invalid, aborting commit.\n");
      exit(1, io);
    }

    io.output.write(`\nGenerated commit:\n\n  ${header}\n\n`);
    io.output.write("✓ Commit created\n");
    exit(0, io);
  } finally {
    // Only reached if a prompt throws (e.g. Ctrl+C -> ExitPromptError):
    // the exit() calls above already restore and exit before this can run.
    // Without this, a cancelled prompt would leave the real console stuck
    // in raw mode for whatever the user runs next.
    restoreConsole(io);
  }
}

main().catch((error) => {
  if (error?.name === "ExitPromptError") {
    console.log("\nCommit assistant cancelled.");
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
});
