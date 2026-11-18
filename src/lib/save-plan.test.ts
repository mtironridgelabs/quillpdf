import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LOCKED_FIELDS,
  LOCKED_FIELDS_BROWSER,
  LOCKED_PAGES,
  LOCKED_PAGES_BROWSER,
  NOTES_ONLY_LOCKED,
  TEXT_BOX_LOCKED,
  isOwnerLocked,
  planSave,
  savedCopyMessage,
} from "./save-plan.ts";

describe("locked form save", () => {
  it("treats a permission list as an owner lock and null as a normal file", () => {
    assert.equal(isOwnerLocked(null), false);
    assert.equal(isOwnerLocked([4, 256]), true);
  });

  it("writes an unlocked file, and uses PDFium only for a locked file on Windows", () => {
    assert.deepEqual(planSave({ hasAnswers: true, hasNotes: false, locked: false, canPdfium: true }), { kind: "write" });
    assert.deepEqual(planSave({ hasAnswers: false, hasNotes: true, locked: false, canPdfium: false }), { kind: "write" });
    assert.deepEqual(planSave({ hasAnswers: false, hasNotes: false, locked: true, canPdfium: true }), { kind: "none" });
    assert.deepEqual(planSave({ hasAnswers: true, hasNotes: false, locked: true, canPdfium: true }), { kind: "pdfium" });
    assert.deepEqual(planSave({ hasAnswers: true, hasNotes: false, locked: true, canPdfium: false }), {
      kind: "picture",
      notice: "picture-browser",
    });
    assert.deepEqual(planSave({ hasAnswers: true, hasNotes: true, locked: true, canPdfium: true }), { kind: "ask" });
    assert.deepEqual(planSave({ hasAnswers: false, hasNotes: true, locked: true, canPdfium: false }), { kind: "ask" });
  });

  it("explains the choice when a save cannot keep the fields", () => {
    assert.match(LOCKED_PAGES, /insert, remove, rotate/);
    assert.match(LOCKED_PAGES_BROWSER, /Windows app/);
    assert.match(LOCKED_FIELDS, /picture/);
    assert.match(LOCKED_FIELDS_BROWSER, /picture/);
    assert.match(TEXT_BOX_LOCKED, /picture/);
    assert.match(NOTES_ONLY_LOCKED, /save a picture/);
    assert.match(savedCopyMessage("locked-fields"), /stay editable/);
    assert.match(savedCopyMessage("locked-fields-notes"), /left out/);
    assert.match(savedCopyMessage("picture-browser"), /Windows app/);
    assert.match(savedCopyMessage("picture-notes"), /cannot be edited later/);
    assert.match(savedCopyMessage("picture-failed", "Quill couldn't find its PDF library."), /PDF library/);
    assert.match(savedCopyMessage("picture-failed", "Quill couldn't find its PDF library."), /cannot be edited later/);
  });
});
