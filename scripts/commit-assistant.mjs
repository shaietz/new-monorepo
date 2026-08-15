import { spawnSync } from "node:child_process";
import { openSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import tty from "node:tty";
import { fileURLToPath } from "node:url";
import inquirer, { createPromptModule } from "inquirer";

const { Separator } = inquirer;

// cz-git's ESM build only exports its `defineConfig`/`definePrompt` config
// helpers; the commitizen `prompter` adapter only exists in the CJS build.
const czAdapter = createRequire(import.meta.url)("cz-git");

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(moduleDir, "..");
// Resolved rather than joined onto `rootDir/node_modules`, which assumes npm hoisted it to the
// top level. This also keeps the dependency visible to `npm run knip`.
const commitlintBin = fileURLToPath(import.meta.resolve("@commitlint/cli/cli.js"));
const messageFile = process.argv[2];

function runCommitlint() {
  return spawnSync(process.execPath, [commitlintBin, "--edit", messageFile], {
    cwd: rootDir,
    encoding: "utf8",
  });
}

// Pulls a subject candidate out of the message the user originally typed
// (the one that just failed commitlint), so the wizard can offer it back
// instead of starting from a blank subject. Strips a conventional-commit
// `type(scope): ` prefix if there is one, since the wizard asks for type
// and scope separately.
function extractOriginalSubject() {
  let raw;
  try {
    raw = readFileSync(messageFile, "utf8");
  } catch {
    return "";
  }
  const header = raw.split("\n").find((line) => line.trim() && !line.startsWith("#"));
  if (!header) {
    return "";
  }
  const conventional = header.match(/^\w+(?:\([^)]*\))?!?:\s*(.*)$/);
  return (conventional ? conventional[1] : header).trim();
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
  // inquirer pipes an internal MuteStream into whatever `output` we give
  // it and calls .end() on that MuteStream when a prompt finishes; the default
  // pipe() behavior forwards that as a real .end() on our stream too. For
  // process.stdout Node ignores it (the stdio fds are protected), but this
  // manually-opened CONOUT$ handle has no such protection, so it would
  // actually close after the *first* prompt — every prompt after that
  // renders into a dead stream and nothing appears on screen, which looks
  // like the CLI hung. Neutralize .end() so the handle survives the whole
  // multi-prompt commitizen flow.
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

// cz-git's `subject` question hardcodes `validate` to reject an empty
// answer ("[ERROR] subject is required") with no config flag to turn that
// off. Intercept the question list cz-git builds and strip that one check
// so leaving the prompt blank is accepted; length limits still apply to
// whatever the user does type. Also seeds the prompt's `completeValue`
// (cz-git's ghost-text autofill: shown greyed out, accepted by pressing
// Tab/Right, or submitted as-is on a bare Enter) with the subject the user
// originally typed, so fixing a mis-formatted message doesn't mean retyping
// it from scratch.
function allowEmptySubject(questions, defaultSubject) {
  for (const question of questions) {
    if (question?.name === "subject" && typeof question.validate === "function") {
      const originalValidate = question.validate;
      question.validate = (subject, answers) =>
        subject?.trim() ? originalValidate(subject, answers) : true;
      if (defaultSubject) {
        question.completeValue = defaultSubject;
      }
    }
  }
  return questions;
}

// Drives the commitizen `cz-git` adapter directly (rather than shelling out
// to `git-cz`), so it can share the TTY streams we've already wired up for
// this hook invocation.
function runCommitizen(io, defaultSubject) {
  const prompt = createPromptModule({ input: io.input, output: io.output });
  const promptWithOptionalSubject = (questions) =>
    prompt(allowEmptySubject(questions, defaultSubject));
  return new Promise((resolve) => {
    // cz-git registers extra prompt types (search-list, etc.) onto `cz`
    // before calling `cz.prompt`, so unlike the plain `{ prompt }` shape
    // used previously, it needs `registerPrompt` too.
    czAdapter.prompter(
      {
        prompt: promptWithOptionalSubject,
        registerPrompt: prompt.registerPrompt.bind(prompt),
        Separator,
      },
      resolve,
    );
  });
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

  // VS Code's Source Control panel runs git straight from the extension
  // host (child_process, no shell, no console attached). On Windows,
  // opening CONIN$/CONOUT$ below can still succeed in that case (there's a
  // hidden console handle), so the interactive prompt would render into a
  // window you can never see or type into and just hang forever. Fail fast
  // instead.
  //
  // VSCODE_GIT_IPC_HANDLE alone doesn't distinguish that from a commit run
  // in VS Code's own integrated terminal: VS Code injects the same handle
  // into every terminal it spawns, and husky's sh.exe wrapper on Windows
  // doesn't reliably preserve process.stdin.isTTY either way, so neither
  // signal tells the two apart on its own. TERM_PROGRAM=vscode does: VS
  // Code sets it for every integrated terminal shell, but the extension
  // host process driving the SCM panel never has it.
  if (process.env.VSCODE_GIT_IPC_HANDLE && process.env.TERM_PROGRAM !== "vscode") {
    console.error(first.stdout?.trim() || first.stderr?.trim() || "");
    console.error(
      "\ncommit-assistant: commit message is invalid, and the interactive prompt can't run " +
        "from VS Code's Source Control panel.\n" +
        "Either fix the message above to match Conventional Commits, or run `npm run commit` " +
        "in a terminal.",
    );
    process.exit(1);
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

  io.output.write("\n✖ Invalid commit message\n\n");
  io.output.write(`${first.stdout?.trim() || first.stderr?.trim() || ""}\n`);
  io.output.write("\nOpening commitizen...\n\n");

  try {
    const message = await runCommitizen(io, extractOriginalSubject());
    // With an empty subject, cz-git emits "type(scope): " with a trailing
    // space before the newline (or end of string) — the conventional
    // commits header pattern requires that literal ": " to parse the type
    // at all, so the space can't be stripped. commitlint.config.js
    // downgrades `header-trim` to a warning to accommodate this.
    writeFileSync(messageFile, message);

    const second = runCommitlint();
    if (second.status !== 0) {
      io.output.write(`${second.stdout?.trim() || second.stderr?.trim() || ""}\n`);
      io.output.write("\ncommit-assistant: message still invalid, aborting commit.\n");
      exit(1, io);
    }

    io.output.write(`\nGenerated commit:\n\n  ${message.split("\n")[0]}\n\n`);
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
