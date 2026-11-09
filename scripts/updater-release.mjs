/**
 * Release gate for the Tauri updater.
 *
 * The public key belongs in src-tauri/tauri.conf.json at plugins.updater.pubkey.
 * The private key is a GitHub Actions secret and is never committed.
 */
export const UPDATER_PUBKEY_PLACEHOLDER = "REPLACE_WITH_TAURI_UPDATER_PUBKEY";
export const UPDATER_CONF_FILE = "src-tauri/tauri.conf.json";
export const UPDATER_PUBKEY_PATH = "plugins.updater.pubkey";

export function updaterReleaseErrors({ pubkey, signingKeyPresent }) {
  const errors = [];
  if (
    typeof pubkey !== "string" ||
    pubkey.trim() === "" ||
    pubkey.includes(UPDATER_PUBKEY_PLACEHOLDER)
  ) {
    errors.push(
      `Updater public key is still the placeholder. Paste the minisign public key into ${UPDATER_CONF_FILE} at ${UPDATER_PUBKEY_PATH}. Do not commit the private key.`,
    );
  }
  if (!signingKeyPresent) {
    errors.push(
      "GitHub Actions secret TAURI_SIGNING_PRIVATE_KEY is missing. Store the updater private key under that name. TAURI_SIGNING_PRIVATE_KEY_PASSWORD is optional and only needed when that private key is encrypted.",
    );
  }
  return errors;
}
