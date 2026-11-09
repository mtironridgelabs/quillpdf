#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { UPDATER_CONF_FILE, updaterReleaseErrors } from "./updater-release.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const conf = JSON.parse(readFileSync(join(root, UPDATER_CONF_FILE), "utf8"));
const errors = updaterReleaseErrors({
  pubkey: conf?.plugins?.updater?.pubkey,
  signingKeyPresent: Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY),
});

if (errors.length > 0) {
  for (const error of errors) console.error(`::error::${error}`);
  process.exit(1);
}
