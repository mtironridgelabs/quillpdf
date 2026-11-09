#!/usr/bin/env node
/**
 * Vite dev server for `tauri dev`. Port 1420, loopback only, so it does not
 * take the web preview's 0.0.0.0:8080.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const env = {
  ...process.env,
  QUILL_DESKTOP: "1",
  VITE_QUILL_DESKTOP: "1",
  VITE_GROK_EXTENSIONS: "0",
};

const child = spawn(
  process.execPath,
  [join(root, "scripts/with-app-env.mjs"), "vite", "dev", "--host", "127.0.0.1", "--port", "1420"],
  { cwd: root, env, stdio: "inherit" },
);

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (err) => {
  console.error("[dev-desktop] failed to start vite:", err?.message || err);
  process.exit(127);
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
