#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  createReadStream,
  createWriteStream,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as clack from "@clack/prompts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const commitlintBin = path.join(rootDir, "node_modules", "@commitlint", "cli", "cli.js");
const commitMsgFile = process.argv[2];

if (!commitMsgFile) {
  console.error("commit-msg.mjs: missing commit message file path argument");
  process.exit(1);
}

const TYPES = [
  { value: "feat", label: "feat", hint: "a new feature" },
  { value: "fix", label: "fix", hint: "a bug fix" },
  { value: "docs", label: "docs", hint: "documentation only changes" },
  { value: "style", label: "style", hint: "formatting, no code change" },
  { value: "refactor", label: "refactor", hint: "neither fixes a bug nor adds a feature" },
  { value: "perf", label: "perf", hint: "a performance improvement" },
  { value: "test", label: "test", hint: "adding or fixing tests" },
  { value: "build", label: "build", hint: "build system or dependencies" },
  { value: "ci", label: "ci", hint: "CI configuration" },
  { value: "chore", label: "chore", hint: "other changes" },
  { value: "revert", label: "revert", hint: "reverts a previous commit" },
];

function runCommitlint() {
  return spawnSync(process.execPath, [commitlintBin, "--edit", commitMsgFile], {
    cwd: rootDir,
    encoding: "utf8",
  });
}

function discoverWorkspaceScopes() {
  const scopes = [];
  for (const group of ["apps", "packages"]) {
    const groupDir = path.join(rootDir, group);
    let entries = [];
    try {
      entries = readdirSync(groupDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(groupDir, entry);
      if (statSync(full).isDirectory()) scopes.push(entry);
    }
  }
  return scopes;
}

// Git for Windows always runs hook scripts through its bundled MSYS sh.exe,
// regardless of which shell invoked `git commit`. That layer proxies stdio
// through a pty emulation that doesn't reliably behave like a real console,
// which breaks @clack/prompts' raw-mode key handling (SIGPIPE mid-render).
// Opening the actual console device sidesteps that layer entirely.
function openTty() {
  const isWindows = process.platform === "win32";
  const ttyIn = isWindows ? "\\\\.\\CONIN$" : "/dev/tty";
  const ttyOut = isWindows ? "\\\\.\\CONOUT$" : "/dev/tty";
  return {
    input: createReadStream(ttyIn),
    output: createWriteStream(ttyOut),
  };
}

const first = runCommitlint();
if (first.status === 0) {
  process.exit(0);
}

let io;
try {
  io = openTty();
} catch {
  console.error(first.stdout?.trim() || first.stderr?.trim() || "");
  console.error("\ncommit-msg.mjs: no interactive terminal available to fix this up, aborting.");
  process.exit(1);
}

console.log("");
clack.intro("Commit message needs a bit of work", io);
console.log(first.stdout?.trim() || first.stderr?.trim() || "");
console.log("");

const originalSubject = readFileSync(commitMsgFile, "utf8").split("\n")[0].trim();

const type = await clack.select({
  message: "What type of change is this?",
  options: TYPES,
  ...io,
});
if (clack.isCancel(type)) {
  clack.cancel("Commit aborted.", io);
  process.exit(1);
}

const availableScopes = discoverWorkspaceScopes();
let scope = "";
if (availableScopes.length > 0) {
  const selected = await clack.multiselect({
    message:
      "Which workspace(s) does this touch? (space to select, enter to confirm, none to skip)",
    options: availableScopes.map((s) => ({ value: s, label: s })),
    required: false,
    ...io,
  });
  if (clack.isCancel(selected)) {
    clack.cancel("Commit aborted.", io);
    process.exit(1);
  }
  scope = selected.join(",");
}

const subject = await clack.text({
  message: "Short description of the change:",
  placeholder: "add login page",
  initialValue: originalSubject.replace(/^\w+(\([^)]*\))?!?:\s*/, ""),
  validate: (value) => {
    if (!value || !value.trim()) return "Subject is required";
  },
  ...io,
});
if (clack.isCancel(subject)) {
  clack.cancel("Commit aborted.", io);
  process.exit(1);
}

const breaking = await clack.confirm({
  message: "Is this a breaking change?",
  initialValue: false,
  ...io,
});
if (clack.isCancel(breaking)) {
  clack.cancel("Commit aborted.", io);
  process.exit(1);
}

let breakingDescription = "";
if (breaking) {
  const bd = await clack.text({
    message: "Describe the breaking change:",
    validate: (value) => {
      if (!value || !value.trim()) return "Description is required";
    },
    ...io,
  });
  if (clack.isCancel(bd)) {
    clack.cancel("Commit aborted.", io);
    process.exit(1);
  }
  breakingDescription = bd;
}

const header = `${type}${scope ? `(${scope})` : ""}${breaking ? "!" : ""}: ${subject.trim()}`;
const footer = breaking ? `\n\nBREAKING CHANGE: ${breakingDescription.trim()}` : "";
const finalMessage = `${header}${footer}\n`;

writeFileSync(commitMsgFile, finalMessage, "utf8");

const second = runCommitlint();
if (second.status !== 0) {
  console.log(second.stdout?.trim() || second.stderr?.trim() || "");
  clack.cancel("Commit message still invalid, aborting commit.", io);
  process.exit(1);
}

clack.outro(`Commit message set to: "${header}"`, io);
process.exit(0);
