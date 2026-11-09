#!/usr/bin/env node
/**
 * Run a command with `.grok/app-env.json` merged into its environment.
 *
 * `dev`, `build` and `preview` all route through this wrapper, so the dev
 * server, the built bundle and the preview server can never disagree about
 * `VITE_AUTH_ENABLED` — a divergence that only shows up as a built-output
 * mismatch long after the fact. Anything that starts Vite directly bypasses it.
 *
 * Only `VITE_`-prefixed keys are honored: the file is a build flag carrier, not
 * a secret store, and only `VITE_` vars reach the browser anyway. A real
 * `process.env` entry always wins, so an explicit override still works.
 *
 * That precedence also means the file governs this workspace only. A deployed
 * build runs with the provider's project env, where the deployer sets
 * `VITE_AUTH_ENABLED` itself (today unconditionally `"true"`), so the deployed
 * flag is the platform's, not this file's.
 *
 * Vite picks the values up because `loadEnv` prefix-matches entries already in
 * `process.env`, which is why the merge has to happen before Vite starts.
 */
import { spawn } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_ENV_REL_PATH = ".grok/app-env.json";

const VITE_PREFIX = "VITE_";

/**
 * Parse an app-env document, keeping only `VITE_`-prefixed string entries.
 * Anything unparseable is an empty environment — a workspace without the file
 * must behave exactly like today (auth on, no overrides).
 */
export function parseAppEnv(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const env = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.startsWith(VITE_PREFIX)) continue;
    if (typeof value !== "string") continue;
    env[key] = value;
  }
  return env;
}

/** The app env recorded under `root`, or `{}` when the file is absent. */
export function readAppEnv(root) {
  try {
    return parseAppEnv(readFileSync(join(root, APP_ENV_REL_PATH), "utf8"));
  } catch {
    return {};
  }
}

/** File values under the process environment: an explicit override wins. */
export function mergeAppEnv(appEnv, processEnv) {
  return { ...appEnv, ...processEnv };
}

/**
 * Translate a child's `exit` `(code, signal)` into this process's exit status.
 *
 * Do not re-raise the signal with `process.kill(process.pid, signal)`: under
 * qemu-user (amd64 image builds on an arm host) a self-directed signal is
 * routinely delivered as SIGSEGV to the wrong process, which takes down the
 * test worker and fails the image build. `128 + signo` is what a shell reports
 * for a signal-killed command, so a cancelled `vite build` is still a failure.
 */
export function exitStatusFromChild(code, signal) {
  if (signal) {
    const signo = osConstants.signals[signal];
    return 128 + (typeof signo === "number" ? signo : 1);
  }
  return code ?? 1;
}

/** The workspace root (this file lives in `<root>/scripts/`). */
export function projectRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

/** npm package names we are willing to treat as a local CLI (`vite`, not `../x`). */
const BARE_PACKAGE_NAME = /^[a-zA-Z0-9._-]+$/;

/**
 * JS entry of a bare package CLI installed under `root/node_modules`, if any.
 *
 * `spawn("vite")` looks the name up on PATH. On Windows the npm shim is
 * `node_modules/.bin/vite.cmd`, and CreateProcess does not apply PATHEXT, so
 * the spawn fails with ENOENT before Vite starts. That is the v0.1.0 Windows
 * release failure (`spawn vite ENOENT`, exit 127) inside `beforeBuildCommand`.
 * The Unix shim executes this same JS file. Return it so the caller can run
 * `node <script>` with an absolute Node path and never touch PATH or a shell.
 */
export function localPackageBin(root, command) {
  if (typeof command !== "string" || !BARE_PACKAGE_NAME.test(command)) return null;
  const packageDir = join(root, "node_modules", command);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  } catch {
    return null;
  }
  const bin = manifest?.bin;
  let relativeBin = null;
  if (typeof bin === "string") relativeBin = bin;
  else if (bin && typeof bin === "object" && typeof bin[command] === "string") {
    relativeBin = bin[command];
  }
  if (typeof relativeBin !== "string" || relativeBin.length === 0 || isAbsolute(relativeBin)) {
    return null;
  }
  const script = join(packageDir, relativeBin);
  const fromPackage = relative(packageDir, script);
  if (fromPackage.startsWith("..") || isAbsolute(fromPackage)) return null;
  // Only JS entries. A native or shell bin must stay a PATH lookup; running
  // it with Node would change what that command does. Vite's bin is JS.
  if (!/\.(?:[cm]?js)$/i.test(script)) return null;
  try {
    if (!statSync(script).isFile()) return null;
  } catch {
    return null;
  }
  return script;
}

/**
 * `spawn` file and args for `command`. Local Node CLIs run as
 * `process.execPath <package bin> ...args`; everything else is unchanged.
 */
export function commandInvocation(root, command, args) {
  const script = localPackageBin(root, command);
  if (!script) return { command, args };
  return { command: process.execPath, args: [script, ...args] };
}

/**
 * Whether `moduleUrl` is the script node was asked to run.
 *
 * Both sides are resolved through symlinks: node realpaths `import.meta.url`
 * but leaves `process.argv[1]` as typed, so comparing them raw makes a CLI
 * launched through a symlinked path (`/tmp` on macOS) a silent no-op.
 */
export function isMainModule(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(moduleUrl);
  } catch {
    return false;
  }
}

function main(argv) {
  const [command, ...args] = argv;
  if (!command) {
    console.error("usage: node scripts/with-app-env.mjs <command> [args…]");
    process.exit(2);
  }
  const env = mergeAppEnv(readAppEnv(projectRoot()), process.env);
  const invocation = commandInvocation(projectRoot(), command, args);
  const child = spawn(invocation.command, invocation.args, { stdio: "inherit", env });
  // The dev server is long-running and is stopped by signalling this wrapper.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", (err) => {
    console.error(`[with-app-env] failed to run ${command}:`, err?.message || err);
    process.exit(127);
  });
  child.on("exit", (code, signal) => {
    process.exit(exitStatusFromChild(code, signal));
  });
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2));
}
