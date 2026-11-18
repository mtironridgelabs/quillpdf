import type { PDFDocumentProxy } from "pdfjs-dist";
import { applyFill, type StampField, type StampNote } from "@/lib/pdf-fill";
import { rasterStamp } from "@/lib/raster-fill";
import { NOTES_ONLY_LOCKED, planSave, type SaveNotice } from "@/lib/save-plan";

export type LockedChoice = "fields" | "picture" | "cancel";

export type SavedCopy = { bytes: Uint8Array; notice: SaveNotice; detail?: string };

/** Turn the open document into the bytes that should be written. Null means the user cancelled. */
export async function buildSavedCopy(input: {
  bytes: Uint8Array;
  pdf: PDFDocumentProxy;
  answers: StampField[];
  notes: StampNote[];
  locked: boolean;
  canPdfium: boolean;
  ask: () => Promise<LockedChoice>;
  fillLocked?: (bytes: Uint8Array, fields: StampField[]) => Promise<Uint8Array>;
}): Promise<SavedCopy | null> {
  const plan = planSave({
    hasAnswers: input.answers.length > 0,
    hasNotes: input.notes.length > 0,
    locked: input.locked,
    canPdfium: input.canPdfium,
  });
  if (plan.kind === "none") return { bytes: input.bytes, notice: "fields" };
  if (plan.kind === "write") {
    try {
      const bytes = await applyFill(input.bytes, input.answers, input.notes);
      return { bytes, notice: "fields" };
    } catch (error) {
      return {
        bytes: await rasterStamp(input.pdf, input.answers, input.notes),
        notice: "picture-failed",
        detail: error instanceof Error ? error.message : undefined,
      };
    }
  }
  if (plan.kind === "picture") {
    return {
      bytes: await rasterStamp(input.pdf, input.answers, input.notes),
      notice: plan.notice,
    };
  }

  let notice: SaveNotice = "locked-fields";
  if (plan.kind === "ask") {
    const choice = await input.ask();
    if (choice === "cancel") return null;
    if (choice === "picture") {
      return {
        bytes: await rasterStamp(input.pdf, input.answers, input.notes),
        notice: "picture-notes",
      };
    }
    if (input.answers.length === 0) throw new Error(NOTES_ONLY_LOCKED);
    notice = "locked-fields-notes";
  }

  if (!input.fillLocked) {
    return {
      bytes: await rasterStamp(input.pdf, input.answers, input.notes),
      notice: "picture-browser",
    };
  }
  try {
    return { bytes: await input.fillLocked(input.bytes, input.answers), notice };
  } catch (error) {
    return {
      bytes: await rasterStamp(input.pdf, input.answers, input.notes),
      notice: "picture-failed",
      detail: error instanceof Error ? error.message : undefined,
    };
  }
}
