import { PDFDocument, degrees } from "pdf-lib";

export type QuarterTurn = 90 | -90 | 180;

async function load(bytes: Uint8Array) {
  try {
    return await PDFDocument.load(bytes.slice(0), { ignoreEncryption: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/encrypt|password/i.test(message)) {
      throw new Error("This PDF is locked. Quill doesn't open password-protected files.");
    }
    throw new Error("Quill couldn't read that PDF.");
  }
}

function turn(angle: number, delta: number) {
  const next = angle + delta;
  const wrapped = ((next % 360) + 360) % 360;
  return (Math.round(wrapped / 90) * 90) % 360;
}

async function bakeFields(bytes: Uint8Array) {
  const doc = await load(bytes);
  if (!doc.catalog.getAcroForm()) return bytes;
  if (doc.getForm().getFields().length === 0) return bytes;
  try {
    doc.getForm().flatten();
    return doc.save({ updateFieldAppearances: false });
  } catch {
    const retry = await load(bytes);
    try {
      retry.getForm().flatten({ updateFieldAppearances: false });
      return retry.save({ updateFieldAppearances: false });
    } catch {
      throw new Error("Quill couldn't flatten the form fields in this PDF.");
    }
  }
}

/** Bake fillable fields into the page. Returns the same bytes when there is no form. */
export async function flattenDocument(bytes: Uint8Array) {
  return bakeFields(bytes);
}

export async function rotatePages(bytes: Uint8Array, indices: number[], delta: QuarterTurn) {
  if (indices.length === 0) throw new Error("Choose a page to rotate.");
  const doc = await load(bytes);
  const count = doc.getPageCount();
  for (const index of indices) {
    if (index < 0 || index >= count) throw new Error("That page is outside the document.");
    const page = doc.getPage(index);
    page.setRotation(degrees(turn(page.getRotation().angle, delta)));
  }
  return doc.save();
}

export async function extractPages(bytes: Uint8Array, indices: number[]) {
  if (indices.length === 0) throw new Error("Choose at least one page to extract.");
  const src = await load(await bakeFields(bytes));
  const count = src.getPageCount();
  for (const index of indices) {
    if (index < 0 || index >= count) throw new Error("That page is outside the document.");
  }
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, indices);
  for (const page of copied) out.addPage(page);
  return out.save();
}

/** Insert copies of `sourceIndices` (0-based) immediately before `beforeIndex`. */
export async function insertPages(
  destBytes: Uint8Array,
  sourceBytes: Uint8Array,
  sourceIndices: number[],
  beforeIndex: number,
) {
  if (sourceIndices.length === 0) throw new Error("Choose pages to insert.");
  const dest = await load(await bakeFields(destBytes));
  const src = await load(await bakeFields(sourceBytes));
  const sourceCount = src.getPageCount();
  for (const index of sourceIndices) {
    if (index < 0 || index >= sourceCount) throw new Error("That page is outside the other PDF.");
  }
  const count = dest.getPageCount();
  const at = Math.min(Math.max(0, beforeIndex), count);
  const copied = await dest.copyPages(src, sourceIndices);
  copied.forEach((page, offset) => dest.insertPage(at + offset, page));
  return dest.save();
}

export async function removePages(bytes: Uint8Array, indices: number[]) {
  if (indices.length === 0) throw new Error("Choose a page to remove.");
  const doc = await load(bytes);
  const unique = [...new Set(indices)].sort((a, b) => b - a);
  if (unique.length >= doc.getPageCount()) throw new Error("Leave at least one page in the document.");
  for (const index of unique) {
    if (index < 0 || index >= doc.getPageCount()) throw new Error("That page is outside the document.");
    doc.removePage(index);
  }
  return doc.save();
}

export async function movePage(bytes: Uint8Array, from: number, to: number) {
  const doc = await load(bytes);
  const count = doc.getPageCount();
  if (from < 0 || to < 0 || from >= count || to >= count) {
    throw new Error("That page is outside the document.");
  }
  if (from === to) return bytes;
  const page = doc.getPage(from);
  doc.removePage(from);
  doc.insertPage(to, page);
  return doc.save();
}

export function pageListLabel(pages: number[]) {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  const parts: string[] = [];
  let start = sorted[0]!;
  let prev = sorted[0]!;
  for (let index = 1; index < sorted.length; index++) {
    const page = sorted[index]!;
    if (page === prev + 1) {
      prev = page;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = page;
    prev = page;
  }
  parts.push(start === prev ? `${start}` : `${start}–${prev}`);
  return parts.join(", ");
}
