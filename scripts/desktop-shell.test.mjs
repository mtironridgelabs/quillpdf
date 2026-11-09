import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  UPDATER_CONF_FILE,
  UPDATER_PUBKEY_PATH,
  UPDATER_PUBKEY_PLACEHOLDER,
  updaterReleaseErrors,
} from "./updater-release.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("desktop shell contract", () => {
  const conf = JSON.parse(read(UPDATER_CONF_FILE));
  const pkg = JSON.parse(read("package.json"));
  const cargo = read("src-tauri/Cargo.toml");
  const hooks = read("src-tauri/windows/hooks.nsh");
  const release = read(".github/workflows/release.yml");

  it("keeps version 0.1.0 on the app, the shell, and the npm package", () => {
    assert.equal(conf.version, "0.1.0");
    assert.equal(pkg.version, "0.1.0");
    assert.match(cargo, /^version = "0\.1\.0"$/m);
  });

  it("names the per-user NSIS app Quill", () => {
    assert.equal(conf.productName, "Quill");
    assert.equal(conf.identifier, "com.bridgetowealth.quill");
    assert.deepEqual(conf.bundle.targets, ["nsis"]);
    assert.equal(conf.bundle.windows.nsis.installMode, "currentUser");
    assert.equal(conf.bundle.createUpdaterArtifacts, true);
    assert.equal(conf.app.windows[0].title, "Quill");
  });

  it("does not register a file association that seizes the .pdf default", () => {
    assert.equal(conf.bundle.fileAssociations, undefined);
    assert.equal(hooks.includes("!insertmacro APP_ASSOCIATE"), false);
    assert.match(hooks, /OpenWithProgids/);
    assert.match(hooks, /RegisteredApplications/);
    assert.match(hooks, /NSIS_HOOK_POSTINSTALL/);
    assert.match(hooks, /NSIS_HOOK_POSTUNINSTALL/);
    assert.equal(hooks.includes('Software\\Classes\\.pdf" ""'), false);
  });

  it("points the updater at the GitHub latest.json endpoint and the minisign public key", () => {
    assert.equal(
      conf.plugins.updater.pubkey,
      "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDQwNzcwMEY1RDM2RDUwQUYKUldTdlVHM1Q5UUIzUUpFSUo1OENILzVXVVpOMWEyU3hLN2ZUM1NWdGxpdDdVVkcwRjhGM25xQ3YK",
    );
    assert.equal(conf.plugins.updater.pubkey.includes(UPDATER_PUBKEY_PLACEHOLDER), false);
    assert.deepEqual(conf.plugins.updater.endpoints, [
      "https://github.com/mtironridgelabs/quillpdf/releases/latest/download/latest.json",
    ]);
    assert.equal(UPDATER_PUBKEY_PATH, "plugins.updater.pubkey");
  });

  it("publishes a Windows release only after the pubkey and signing secret are real", () => {
    assert.match(release, /windows-latest/);
    assert.match(release, /tags:[\s\S]*- "v\*"/);
    assert.match(release, /contents: write/);
    assert.match(release, /includeUpdaterJson: true/);
    assert.match(release, /updaterJsonPreferNsis: true/);
    assert.match(release, /releaseDraft: false/);
    assert.match(release, /TAURI_SIGNING_PRIVATE_KEY/);
    assert.match(release, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD/);
    assert.match(release, /check-updater-release\.mjs/);
    assert.equal(release.includes("contents: write"), true);
    const jobBlock = release.slice(release.indexOf("jobs:"));
    assert.equal(jobBlock.includes("contents: read"), false);
  });

  it("rejects a placeholder pubkey and a missing signing secret", () => {
    const errors = updaterReleaseErrors({
      pubkey: UPDATER_PUBKEY_PLACEHOLDER,
      signingKeyPresent: false,
    });
    assert.equal(errors.length, 2);
    assert.match(errors[0], /src-tauri\/tauri\.conf\.json/);
    assert.match(errors[0], /plugins\.updater\.pubkey/);
    assert.match(errors[1], /TAURI_SIGNING_PRIVATE_KEY/);
    assert.deepEqual(
      updaterReleaseErrors({ pubkey: "real-public-key", signingKeyPresent: true }),
      [],
    );
  });
});
