import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFCheckBox, PDFDocument, PDFTextField, StandardFonts } from "pdf-lib";
import { pageMove } from "./page-move.ts";
import { extractPages, flattenDocument, insertPages, movePage, movePages, removePages, rotatePages } from "./pdf-ops.ts";
import { applyFill } from "./pdf-fill.ts";

async function makeDoc(labels: string[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const label of labels) {
    const page = doc.addPage([612, 792]);
    page.drawText(label, { x: 72, y: 700, size: 24, font });
  }
  return doc.save();
}

async function formDoc(name: string, value: string, label: string) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(label, { x: 72, y: 740, size: 18, font });
  const form = doc.getForm();
  const text = form.createTextField(name);
  text.setText(value);
  text.addToPage(page, { x: 72, y: 700, width: 200, height: 24, font });
  const box = form.createCheckBox("Checking");
  box.addToPage(page, { x: 72, y: 660, width: 18, height: 18 });
  box.check();
  return doc.save();
}

async function fieldReport(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getForm().getFields().map((field) => {
    if (field instanceof PDFCheckBox) return `${field.getName()}=${field.isChecked() ? "yes" : "no"}`;
    if (field instanceof PDFTextField) return `${field.getName()}=${field.getText() ?? ""}`;
    return `${field.getName()}=`;
  });
}

describe("pdf page desk", () => {
  it("writes a quarter turn into the file", async () => {
    const bytes = await makeDoc(["A", "B"]);
    const turned = await rotatePages(bytes, [1], -90);
    const doc = await PDFDocument.load(turned);
    assert.equal(doc.getPage(0).getRotation().angle, 0);
    assert.equal(doc.getPage(1).getRotation().angle, 270);
  });

  it("extracts pages in the requested order", async () => {
    let bytes = await makeDoc(["A", "B", "C"]);
    bytes = await rotatePages(bytes, [0], 90);
    bytes = await rotatePages(bytes, [2], 180);
    const out = await extractPages(bytes, [2, 0]);
    const doc = await PDFDocument.load(out);
    assert.equal(doc.getPageCount(), 2);
    assert.equal(doc.getPage(0).getRotation().angle, 180);
    assert.equal(doc.getPage(1).getRotation().angle, 90);
  });

  it("inserts pages from another PDF before a chosen page", async () => {
    const dest = await makeDoc(["A", "B", "C"]);
    let source = await makeDoc(["X", "Y"]);
    source = await rotatePages(source, [0, 1], 90);
    const out = await insertPages(dest, source, [0, 1], 1);
    const doc = await PDFDocument.load(out);
    assert.equal(doc.getPageCount(), 5);
    assert.equal(doc.getPage(0).getRotation().angle, 0);
    assert.equal(doc.getPage(1).getRotation().angle, 90);
    assert.equal(doc.getPage(2).getRotation().angle, 90);
    assert.equal(doc.getPage(3).getRotation().angle, 0);
  });

  it("keeps a text field and a checkbox fillable after extract, insert, and reorder", async () => {
    const formBytes = await formDoc("Client.Name", "Ada", "Form");
    const extracted = await extractPages(formBytes, [0]);
    assert.deepEqual(await fieldReport(extracted), ["Client.Name=Ada", "Checking=yes"]);

    const cover = await makeDoc(["Cover"]);
    const inserted = await insertPages(cover, formBytes, [0], 1);
    assert.equal((await PDFDocument.load(inserted)).getPageCount(), 2);
    assert.deepEqual(await fieldReport(inserted), ["Client.Name=Ada", "Checking=yes"]);

    const combined = await PDFDocument.load(formBytes);
    const [coverPage] = await combined.copyPages(await PDFDocument.load(cover), [0]);
    combined.insertPage(0, coverPage);
    const moved = await movePages(await combined.save(), [0], 1);
    assert.deepEqual(await fieldReport(moved), ["Client.Name=Ada", "Checking=yes"]);
    const rotated = await rotatePages(formBytes, [0], 90);
    assert.deepEqual(await fieldReport(rotated), ["Client.Name=Ada", "Checking=yes"]);
  });

  it("renames an incoming field when the open file already uses that name", async () => {
    const dest = await formDoc("Client.Name", "Ada", "Dest");
    const source = await formDoc("Client.Name", "Bea", "Source");
    const inserted = await insertPages(dest, source, [0], 1);
    assert.deepEqual(await fieldReport(inserted), [
      "Client.Name=Ada",
      "Checking=yes",
      "Client.Name.2=Bea",
      "Checking.2=yes",
    ]);
  });

  it("drops a field that lived only on a removed page and keeps the others", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const form = doc.getForm();
    for (const label of ["A", "B"]) {
      const page = doc.addPage([612, 792]);
      page.drawText(label, { x: 72, y: 740, size: 18, font });
      const text = form.createTextField(`Page.${label}`);
      text.setText(label);
      text.addToPage(page, { x: 72, y: 680, width: 120, height: 24, font });
    }
    const bytes = await doc.save();
    const removed = await removePages(bytes, [0]);
    assert.equal((await PDFDocument.load(removed)).getPageCount(), 1);
    assert.deepEqual(await fieldReport(removed), ["Page.B=B"]);
  });

  it("still flattens when asked, and leaves a file with no form alone", async () => {
    const formBytes = await formDoc("Client.Name", "Ada", "Form");
    const saved = await flattenDocument(formBytes);
    assert.notEqual(saved, formBytes);
    assert.equal((await PDFDocument.load(saved)).getForm().getFields().length, 0);
    const plain = await makeDoc(["Cover"]);
    assert.equal(await flattenDocument(plain), plain);
  });

  it("keeps a filled field editable and turns a text box into a field", async () => {
    const form = await PDFDocument.create();
    const page = form.addPage([612, 792]);
    const fields = form.getForm();
    const name = fields.createTextField("Client.Name");
    name.addToPage(page, { x: 72, y: 700, width: 160, height: 24 });
    const bytes = await form.save();
    const filled = await applyFill(
      bytes,
      [{ name: "Client.Name", kind: "text", value: "Ada", page: 1, rect: [72, 700, 232, 724] }],
      [{ page: 1, x: 72, y: 640, text: "Bank note", size: 11 }],
    );
    const doc = await PDFDocument.load(filled);
    const saved = doc.getForm();
    assert.equal(saved.getTextField("Client.Name").getText(), "Ada");
    const note = saved.getFields().find((field) => field.getName().startsWith("Quill.Note."));
    assert.ok(note);
    assert.equal(saved.getTextField(note.getName()).getText(), "Bank note");

    const again = await applyFill(
      filled,
      [{ name: "Client.Name", kind: "text", value: "Bea", page: 1, rect: [72, 700, 232, 724] }],
      [],
    );
    const next = await PDFDocument.load(again);
    assert.equal(next.getForm().getTextField("Client.Name").getText(), "Bea");
    assert.equal(next.getForm().getFields().length, 2);
  });

  it("refuses to remove every page and moves one page without losing its turn", async () => {
    let bytes = await makeDoc(["A", "B", "C"]);
    bytes = await rotatePages(bytes, [0], 90);
    await assert.rejects(() => removePages(bytes, [0, 1, 2]), /at least one page/);
    const removed = await removePages(bytes, [1]);
    assert.equal((await PDFDocument.load(removed)).getPageCount(), 2);
    const moved = await movePage(bytes, 0, 2);
    const doc = await PDFDocument.load(moved);
    assert.equal(doc.getPageCount(), 3);
    assert.equal(doc.getPage(0).getRotation().angle, 0);
    assert.equal(doc.getPage(2).getRotation().angle, 90);
    const block = await movePages(bytes, [0], 2);
    const after = await PDFDocument.load(block);
    assert.equal(after.getPage(2).getRotation().angle, 90);
  });
});

describe("thumbnail drag", () => {
  it("moves a single page to the gap the pointer is over", () => {
    assert.deepEqual(pageMove(3, [0], 3), { indices: [0], dest: 2 });
    assert.equal(pageMove(3, [0], 1), null);
    assert.deepEqual(pageMove(4, [2], 0), { indices: [2], dest: 0 });
  });

  it("moves a selected group as one block and keeps their order", () => {
    assert.deepEqual(pageMove(4, [2, 0], 4), { indices: [0, 2], dest: 2 });
    assert.deepEqual(pageMove(4, [1, 2], 0), { indices: [1, 2], dest: 0 });
    assert.equal(pageMove(4, [1, 2], 2), null);
  });
});
