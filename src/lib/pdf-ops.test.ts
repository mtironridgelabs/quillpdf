import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPages, flattenDocument, insertPages, movePage, removePages, rotatePages } from "./pdf-ops.ts";
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

  it("bakes fillable fields into an insert, an extract, and a saved copy", async () => {
    const formDoc = await PDFDocument.create();
    const page = formDoc.addPage([612, 792]);
    const form = formDoc.getForm();
    const name = form.createTextField("Client.Name");
    name.setText("Ada");
    name.addToPage(page, { x: 72, y: 700, width: 160, height: 24 });
    const formBytes = await formDoc.save();

    const saved = await flattenDocument(formBytes);
    assert.notEqual(saved, formBytes);
    assert.equal((await PDFDocument.load(saved)).getForm().getFields().length, 0);

    const plain = await makeDoc(["Cover"]);
    const inserted = await insertPages(plain, formBytes, [0], 1);
    assert.equal((await PDFDocument.load(inserted)).getPageCount(), 2);
    assert.equal((await PDFDocument.load(inserted)).getForm().getFields().length, 0);

    const extracted = await extractPages(formBytes, [0]);
    assert.equal((await PDFDocument.load(extracted)).getPageCount(), 1);
    assert.equal((await PDFDocument.load(extracted)).getForm().getFields().length, 0);

    const untouched = await flattenDocument(plain);
    assert.equal(untouched, plain);
  });

  it("writes a text box onto a page and bakes a field", async () => {
    const formDoc = await PDFDocument.create();
    const page = formDoc.addPage([612, 792]);
    const form = formDoc.getForm();
    const name = form.createTextField("Client.Name");
    name.addToPage(page, { x: 72, y: 700, width: 160, height: 24 });
    const bytes = await formDoc.save();
    const filled = await applyFill(
      bytes,
      [{ name: "Client.Name", kind: "text", value: "Ada", page: 1, rect: [72, 700, 232, 724] }],
      [{ page: 1, x: 72, y: 640, text: "Bank note", size: 11 }],
    );
    const doc = await PDFDocument.load(filled);
    assert.equal(doc.getPageCount(), 1);
    assert.equal(doc.getForm().getFields().length, 0);
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
  });
});
