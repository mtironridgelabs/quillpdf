/**
 * Stand-in for @tauri-apps imports during the web/Vercel build.
 * The web bundle never calls these. The desktop build uses the real packages.
 */

export function save(): Promise<null> {
  return Promise.resolve(null);
}

export function check(): Promise<null> {
  return Promise.resolve(null);
}

export function relaunch(): Promise<void> {
  return Promise.resolve();
}

export function invoke(): Promise<never> {
  return Promise.reject(new Error("Quill desktop APIs are not in the web build."));
}

export function listen(): Promise<() => void> {
  return Promise.resolve(() => {});
}
