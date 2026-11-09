import { base64ToBytes, bytesToBase64 } from "@/lib/desktop-bytes";

/**
 * True only for `npm run build:desktop` / `dev:desktop`. The web build replaces
 * this with false and drops the desktop UI.
 */
export const desktopShell = import.meta.env.VITE_QUILL_DESKTOP === "1";

const DEFAULT_APPS_KEY = "quill.defaultAppsPrompt";

export function shouldPromptForDefaultApps(): boolean {
  if (!desktopShell || typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(DEFAULT_APPS_KEY) !== "seen";
  } catch {
    return false;
  }
}

export function dismissDefaultAppsPrompt(): void {
  try {
    localStorage.setItem(DEFAULT_APPS_KEY, "seen");
  } catch {
    // Private mode can reject storage. The prompt may show again next launch.
  }
}

type OpenedPdf = { name: string; base64: string };

export async function listenForOpenedPdfs(
  onOpen: (name: string, bytes: Uint8Array) => void,
): Promise<() => void> {
  if (!desktopShell) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const { invoke } = await import("@tauri-apps/api/core");

  let pulling = false;
  let again = false;

  const pull = async () => {
    if (pulling) {
      again = true;
      return;
    }
    pulling = true;
    try {
      do {
        again = false;
        for (;;) {
          const next = await invoke<OpenedPdf | null>("take_opened_pdf");
          if (!next) break;
          onOpen(next.name, base64ToBytes(next.base64));
        }
      } while (again);
    } finally {
      pulling = false;
    }
  };

  await pull();
  return listen("quill-open-pdf", () => {
    void pull();
  });
}

/** Native save dialog. Returns false when the user cancels. */
export async function savePdfWithDialog(bytes: Uint8Array, filename: string): Promise<boolean> {
  if (!desktopShell) return false;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const { invoke } = await import("@tauri-apps/api/core");
  const suggested = filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`;
  const path = await save({
    defaultPath: suggested,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (path == null) return false;
  await invoke("write_pdf_file", { path, base64: bytesToBase64(bytes) });
  return true;
}

export async function openDefaultApps(): Promise<void> {
  if (!desktopShell) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_default_apps");
}

export async function checkAndInstallUpdate(): Promise<"none" | "installed"> {
  if (!desktopShell) throw new Error("Updates are only available in the Windows app.");
  const { check } = await import("@tauri-apps/plugin-updater");
  const { relaunch } = await import("@tauri-apps/plugin-process");
  const update = await check();
  if (!update) return "none";
  await update.downloadAndInstall();
  await relaunch();
  return "installed";
}
