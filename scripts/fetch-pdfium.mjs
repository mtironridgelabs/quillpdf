#!/usr/bin/env node
/**
 * Download the Windows PDFium build that matches pdfium-render's pdfium_8125 feature.
 * The release workflow runs this before `tauri build`. The DLL is not committed.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, copyFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const version = "8125";
const url = `https://github.com/bblanchon/pdfium-binaries/releases/download/chromium%2F${version}/pdfium-win-x64.tgz`;
const destDir = join(root, "src-tauri", "resources");
const dest = join(destDir, "pdfium.dll");
const scratch = join(tmpdir(), `quill-pdfium-${version}`);

rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });
const archive = join(scratch, "pdfium.tgz");
execFileSync("curl", ["-fsSL", "-o", archive, url], { stdio: "inherit" });
execFileSync("tar", ["-xzf", archive, "-C", scratch, "--no-same-owner"], { stdio: "inherit" });

const found = findDll(scratch);
if (!found) throw new Error("The PDFium archive did not contain pdfium.dll.");
mkdirSync(destDir, { recursive: true });
copyFileSync(found, dest);
const size = statSync(dest).size;
if (size < 1_000_000) throw new Error("pdfium.dll looks too small to be the real library.");
console.log(`[fetch-pdfium] ${dest} (${size} bytes)`);

function findDll(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findDll(path);
      if (nested) return nested;
    } else if (entry.name.toLowerCase() === "pdfium.dll") {
      return path;
    }
  }
  return null;
}
