import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  APP_ENV_REL_PATH,
  commandInvocation,
  localPackageBin,
  mergeAppEnv,
  parseAppEnv,
  projectRoot,
  readAppEnv,
} from "./with-app-env.mjs";

const execFileAsync = promisify(execFile);
const WRAPPER = join(projectRoot(), "scripts/with-app-env.mjs");
const PRINT_FLAG = "process.stdout.write(String(process.env.VITE_AUTH_ENABLED));";

function makeWorkspace(appEnvJson) {
  const root = mkdtempSync(join(tmpdir(), "app-env-"));
  if (appEnvJson !== undefined) {
    mkdirSync(join(root, ".grok"), { recursive: true });
    writeFileSync(join(root, APP_ENV_REL_PATH), appEnvJson);
  }
  return root;
}

test("keeps VITE_-prefixed string entries", () => {
  assert.deepEqual(parseAppEnv('{"VITE_AUTH_ENABLED":"false"}'), {
    VITE_AUTH_ENABLED: "false",
  });
});

test("drops non-VITE keys, non-string values and malformed documents", () => {
  assert.deepEqual(parseAppEnv('{"DATABASE_URL":"postgres://x","VITE_N":1,"VITE_OK":"y"}'), {
    VITE_OK: "y",
  });
  assert.deepEqual(parseAppEnv("not json"), {});
  assert.deepEqual(parseAppEnv('["VITE_AUTH_ENABLED"]'), {});
  assert.deepEqual(parseAppEnv("null"), {});
});

test("a missing app-env.json is a clean no-op", () => {
  assert.deepEqual(readAppEnv(makeWorkspace()), {});
});

test("reads the app env from a workspace", () => {
  const root = makeWorkspace('{"VITE_AUTH_ENABLED":"false"}');
  assert.deepEqual(readAppEnv(root), { VITE_AUTH_ENABLED: "false" });
});

test("an explicit process-env override wins over the file", () => {
  const merged = mergeAppEnv(
    { VITE_AUTH_ENABLED: "false" },
    { VITE_AUTH_ENABLED: "true", PATH: "/usr/bin" },
  );
  assert.equal(merged.VITE_AUTH_ENABLED, "true");
  assert.equal(merged.PATH, "/usr/bin");
});

test("the template ships auth off", () => {
  assert.deepEqual(readAppEnv(projectRoot()), { VITE_AUTH_ENABLED: "false" });
});

test("vite loadEnv resolves the wrapped value", () => {
  // What `import.meta.env.VITE_AUTH_ENABLED` becomes: loadEnv prefix-matches
  // process.env, so the wrapper's merge has to land before Vite starts.
  // Do not `import { loadEnv } from "vite"` here — Vite 8 loads rolldown
  // native bindings that SIGSEGV the test worker under qemu-user.
  const root = makeWorkspace('{"VITE_AUTH_ENABLED":"false"}');
  const merged = mergeAppEnv(readAppEnv(root), { PATH: "/usr/bin" });
  assert.equal(merged.VITE_AUTH_ENABLED, "false");
});

test("the wrapped command runs with the app env applied", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    WRAPPER,
    process.execPath,
    "-e",
    PRINT_FLAG,
  ]);
  assert.equal(stdout, "false");
});

test("the wrapped command sees an explicit override, not the file value", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [WRAPPER, process.execPath, "-e", PRINT_FLAG],
    { env: { ...process.env, VITE_AUTH_ENABLED: "true" } },
  );
  assert.equal(stdout, "true");
});

test("the wrapper propagates the command's exit code", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [WRAPPER, process.execPath, "-e", "process.exit(3)"]),
    (err) => err.code === 3,
  );
});

test("a signal-killed command is never reported as success", async () => {
  // The wrapper's own SIGTERM handler must not swallow the re-raised signal:
  // a cancelled build reporting exit 0 is a silently passing gate.
  await assert.rejects(
    execFileAsync(process.execPath, [
      WRAPPER,
      process.execPath,
      "-e",
      "process.kill(process.pid, 'SIGTERM');setTimeout(() => {}, 1000);",
    ]),
    (err) => err.signal === "SIGTERM" || err.code !== 0,
  );
});

test("the CLI still runs when invoked through a symlinked path", async () => {
  // node realpaths import.meta.url but not process.argv[1], so a raw comparison
  // turns the wrapper into a no-op that exits 0 without starting anything.
  const link = join(mkdtempSync(join(tmpdir(), "app-env-link-")), "scripts");
  symlinkSync(join(projectRoot(), "scripts"), link);
  const { stdout } = await execFileAsync(process.execPath, [
    join(link, "with-app-env.mjs"),
    process.execPath,
    "-e",
    PRINT_FLAG,
  ]);
  assert.equal(stdout, "false");
});

function installFakeBin(root, command, relativeBin, body = "") {
  const packageDir = join(root, "node_modules", command);
  mkdirSync(join(packageDir, "bin"), { recursive: true });
  writeFileSync(
    join(packageDir, "package.json"),
    JSON.stringify({ bin: { [command]: relativeBin } }),
  );
  const script = join(packageDir, relativeBin);
  mkdirSync(join(script, ".."), { recursive: true });
  writeFileSync(script, body);
  return script;
}

test("a local package bin is run with node instead of a bare command", () => {
  // Windows release v0.1.0 died on `spawn vite ENOENT`: the npm shim is
  // vite.cmd, and spawn does not resolve PATHEXT. The invocation must be
  // this Node plus the package's JS entry, which is what the Unix shim runs.
  const root = mkdtempSync(join(tmpdir(), "app-env-bin-"));
  const script = installFakeBin(root, "vite", "bin/vite.js");
  assert.equal(localPackageBin(root, "vite"), script);
  assert.deepEqual(commandInvocation(root, "vite", ["build"]), {
    command: process.execPath,
    args: [script, "build"],
  });
});

test("a string bin field is accepted", () => {
  const root = mkdtempSync(join(tmpdir(), "app-env-bin-"));
  const packageDir = join(root, "node_modules", "vite");
  mkdirSync(join(packageDir, "bin"), { recursive: true });
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({ bin: "bin/vite.js" }));
  writeFileSync(join(packageDir, "bin", "vite.js"), "");
  assert.equal(localPackageBin(root, "vite"), join(packageDir, "bin", "vite.js"));
});

test("a bin path that escapes the package is ignored", () => {
  const root = mkdtempSync(join(tmpdir(), "app-env-bin-"));
  const packageDir = join(root, "node_modules", "vite");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    join(packageDir, "package.json"),
    JSON.stringify({ bin: { vite: "../../evil.js" } }),
  );
  writeFileSync(join(root, "evil.js"), "");
  assert.equal(localPackageBin(root, "vite"), null);
  assert.deepEqual(commandInvocation(root, "vite", ["build"]), {
    command: "vite",
    args: ["build"],
  });
});

test("absolute commands, missing packages, and non-JS bins are not rewritten", () => {
  const root = mkdtempSync(join(tmpdir(), "app-env-bin-"));
  assert.deepEqual(commandInvocation(root, process.execPath, ["-e", "1"]), {
    command: process.execPath,
    args: ["-e", "1"],
  });
  assert.equal(localPackageBin(root, "vite"), null);
  assert.equal(localPackageBin(root, "../vite"), null);
  assert.equal(localPackageBin(root, "vite.cmd"), null);
  installFakeBin(root, "tool", "bin/tool");
  assert.equal(localPackageBin(root, "tool"), null);
});

test(
  "the wrapper runs the local vite CLI when the .bin shim is not on PATH",
  { skip: !existsSync(join(projectRoot(), "node_modules", "vite", "package.json")) },
  async () => {
    const script = localPackageBin(projectRoot(), "vite");
    assert.ok(script, "installed vite must resolve to its JS entry, not the .bin shim");
    assert.match(script, /vite[/\\]bin[/\\]vite\.js$/);
    // Drop node_modules/.bin so a bare `spawn("vite")` cannot succeed. This is
    // the Windows failure mode (shim not executable as the name `vite`).
    const env = { ...process.env };
    for (const key of ["PATH", "Path"]) {
      if (typeof env[key] !== "string") continue;
      env[key] = env[key]
        .split(delimiter)
        .filter((entry) => !entry.includes("node_modules"))
        .join(delimiter);
    }
    const { stdout } = await execFileAsync(process.execPath, [WRAPPER, "vite", "--version"], {
      env,
    });
    assert.match(stdout, /\d+\.\d+\.\d+/);
  },
);
