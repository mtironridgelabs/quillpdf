#!/usr/bin/env node
/**
 * Static SPA build embedded by the Tauri shell.
 *
 * Leaves `npm run build` (Vercel / Nitro) alone. Sets QUILL_DESKTOP so Vite
 * emits client files to dist/desktop and does not inject the Grok network script.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exitStatusFromChild } from "./with-app-env.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const env = {
  ...process.env,
  QUILL_DESKTOP: "1",
  VITE_QUILL_DESKTOP: "1",
  // Offline shell: do not inject https://grok.com/.../extensions.js.
  VITE_GROK_EXTENSIONS: "0",
};

const child = spawn(process.execPath, [join(root, "scripts/with-app-env.mjs"), "vite", "build"], {
  cwd: root,
  env,
  stdio: "inherit",
});

child.on("error", (err) => {
  console.error("[build-desktop] failed to start vite:", err?.message || err);
  process.exit(127);
});

child.on("exit", (code, signal) => {
  const status = exitStatusFromChild(code, signal);
  if (status !== 0) process.exit(status);
  try {
    // TanStack prefixes a relative base as "/./assets". Collapse that to
    // "/assets" so the embedded WebView requests a real file.
    collapseDotPaths(join(root, "dist", "desktop"));
    assertDesktopShell(root);
  } catch (err) {
    console.error("[build-desktop]", err instanceof Error ? err.message : err);
    process.exit(1);
  }
});

export function collapseDotPaths(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      collapseDotPaths(path);
      continue;
    }
    if (!/\.(html|js|css|mjs)$/.test(entry.name)) continue;
    const text = readFileSync(path, "utf8");
    if (!text.includes("/./")) continue;
    writeFileSync(path, text.replaceAll("/./", "/"));
  }
}

export function assertDesktopShell(projectRoot) {
  const indexPath = join(projectRoot, "dist", "desktop", "index.html");
  if (!existsSync(indexPath)) {
    throw new Error("dist/desktop/index.html is missing. Tauri embeds that file.");
  }
  const html = readFileSync(indexPath, "utf8");
  if (!html.includes("<script")) {
    throw new Error("dist/desktop/index.html has no script tag.");
  }
  if (html.includes("grok-app-builder/extensions.js") || html.includes("https://grok.com")) {
    throw new Error(
      "Desktop shell still references grok.com. The embedded app must not use the network until Update is clicked.",
    );
  }
  if (html.includes("/./")) {
    throw new Error("Desktop index.html still has /./ asset paths.");
  }
  if (!html.includes('src="/assets/')) {
    throw new Error("Desktop index.html is missing a root /assets script.");
  }
  return indexPath;
}
