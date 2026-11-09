import { previewPathPrefix } from "@/lib/preview-path-prefix";

/** Asset path that still resolves when the preview is mounted under a port prefix. */
export function appUrl(path: string) {
  const clean = path.replace(/^\/+/, "");
  if (typeof window === "undefined") return `/${clean}`;
  const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
  return `${prefix}/${clean}`;
}
