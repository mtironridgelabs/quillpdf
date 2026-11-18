/** An owner lock (or any encryption pdf.js could still open). pdf-lib cannot rewrite these. */
export function isOwnerLocked(permissions: number[] | null): boolean {
  return permissions != null;
}

export const LOCKED_PAGES =
  "This PDF is locked. Quill can fill the existing fields and save them, but it can't insert, remove, rotate, reorder, or extract pages. Those changes would rebuild the file and drop the fields.";

export const LOCKED_PAGES_BROWSER =
  "This PDF is locked. This browser can't insert, remove, rotate, reorder, or extract pages. It also can't keep the fields editable. The Windows app can fill the existing fields and save them.";

export const LOCKED_FIELDS =
  "Fill the existing fields. Save a copy keeps them editable. A new text box can only be saved as a picture, because this PDF is locked.";

export const LOCKED_FIELDS_BROWSER =
  "You can type into the fields here. This browser can only save a picture of a locked PDF. The Windows app keeps the existing fields editable.";

export const TEXT_BOX = "Add a text box. Save a copy turns it into a field you can edit later.";

export const TEXT_BOX_LOCKED =
  "This PDF is locked. A new text box can only be saved as a picture. The existing fields can still be saved and edited later.";

export const NOTES_ONLY_LOCKED =
  "The text boxes can't be saved into a locked PDF. Fill an existing field, or save a picture.";

export type SaveNotice =
  | "fields"
  | "locked-fields"
  | "locked-fields-notes"
  | "picture-browser"
  | "picture-notes"
  | "picture-failed";

export type SavePlan =
  | { kind: "none" }
  | { kind: "write" }
  | { kind: "pdfium" }
  | { kind: "ask" }
  | { kind: "picture"; notice: "picture-browser" };

export function planSave(input: {
  hasAnswers: boolean;
  hasNotes: boolean;
  locked: boolean;
  canPdfium: boolean;
}): SavePlan {
  if (!input.hasAnswers && !input.hasNotes) return { kind: "none" };
  if (!input.locked) return { kind: "write" };
  if (input.hasNotes) return { kind: "ask" };
  if (input.canPdfium && input.hasAnswers) return { kind: "pdfium" };
  return { kind: "picture", notice: "picture-browser" };
}

export function savedCopyMessage(notice: SaveNotice, detail?: string): string {
  switch (notice) {
    case "fields":
      return "Saved a copy.";
    case "locked-fields":
      return "Saved a copy. The fields stay editable.";
    case "locked-fields-notes":
      return "Saved a copy. The fields stay editable. The text boxes were left out, because this PDF is locked.";
    case "picture-browser":
      return "Saved a picture. This browser can't keep a locked form editable. The Windows app can.";
    case "picture-notes":
      return "Saved a picture. It shows the text boxes, but this copy cannot be edited later.";
    case "picture-failed": {
      const reason = detail?.trim().replace(/\.$/, "") || "Quill couldn't keep the fields";
      return `Saved a picture. ${reason}. This copy cannot be edited later.`;
    }
  }
}
