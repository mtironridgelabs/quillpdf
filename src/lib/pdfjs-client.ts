import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { appUrl } from "@/lib/app-url";

let loading: Promise<typeof import("pdfjs-dist")> | null = null;

/** pdf.js AnnotationMode.ENABLE_FORMS. The page is painted without field appearances. Quill draws those. */
export const FORM_APPEARANCE_OFF = 2;

export function loadPdfjs() {
  if (!loading) {
    loading = import("pdfjs-dist").then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = workerUrl;
      return mod;
    });
  }
  return loading;
}

export async function openPdfDocument(bytes: Uint8Array) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: bytes.slice(0),
    isEvalSupported: false,
    enableXfa: false,
    cMapUrl: appUrl("/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: appUrl("/standard_fonts/"),
  });
  try {
    return await task.promise;
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : "";
    if (name === "PasswordException" || /password|encrypt/i.test(message)) {
      throw new Error("This PDF is locked. Quill doesn't open password-protected files.");
    }
    throw new Error("Quill couldn't open that PDF.");
  }
}
