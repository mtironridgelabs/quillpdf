import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
  degrees,
} from "pdf-lib";
import { LOCKED_PAGES } from "./save-plan.ts";

export type QuarterTurn = 90 | -90 | 180;

async function load(bytes: Uint8Array) {
  try {
    return await PDFDocument.load(bytes.slice(0), { ignoreEncryption: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/encrypt|password/i.test(message)) {
      throw new Error(LOCKED_PAGES);
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

function asDict(context: PDFDocument["context"], value: unknown) {
  const object = value instanceof PDFRef ? context.lookup(value) : value;
  return object instanceof PDFDict ? object : undefined;
}

function asRef(value: unknown) {
  return value instanceof PDFRef ? value : undefined;
}

function partialName(dict: PDFDict) {
  const raw = dict.get(PDFName.of("T")) ?? dict.lookup(PDFName.of("T"));
  if (raw instanceof PDFHexString || raw instanceof PDFString) return raw.decodeText();
  return undefined;
}

function climb(dict: PDFDict) {
  const chain = [dict];
  const seen = new Set<PDFDict>();
  let current = dict;
  while (chain.length < 12) {
    const parent = asDict(current.context, current.get(PDFName.of("Parent")));
    if (!parent || seen.has(parent)) break;
    seen.add(parent);
    chain.push(parent);
    current = parent;
  }
  return chain;
}

function fullName(chain: PDFDict[]) {
  const parts: string[] = [];
  for (let index = chain.length - 1; index >= 0; index--) {
    const name = partialName(chain[index]!);
    if (name) parts.push(name);
  }
  return parts.join(".");
}

function pagesOf(doc: PDFDocument) {
  // pdf-lib leaves its page cache in place after removePage, so a removed page
  // still looks like it is in the file. Drop the cache before reading widgets.
  const cache = (doc as unknown as { pageCache?: { invalidate?: () => void } }).pageCache;
  cache?.invalidate?.();
  return doc.getPages();
}

function liveWidgetRefs(doc: PDFDocument) {
  const refs = new Set<string>();
  for (const page of pagesOf(doc)) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let index = 0; index < annots.size(); index++) {
      const ref = asRef(annots.get(index));
      if (ref) refs.add(ref.toString());
    }
  }
  return refs;
}

function isLive(dict: PDFDict, live: Set<string>) {
  const ref = dict.context.getObjectRef(dict);
  return ref ? live.has(ref.toString()) : false;
}

/** Drop kids whose widgets are no longer on a page. True when a widget remains. */
function pruneField(dict: PDFDict, live: Set<string>): boolean {
  const kids = dict.lookup(PDFName.of("Kids"));
  if (!(kids instanceof PDFArray)) return isLive(dict, live);
  const kept: PDFRef[] = [];
  for (let index = 0; index < kids.size(); index++) {
    const ref = asRef(kids.get(index));
    if (!ref) continue;
    const kid = asDict(dict.context, ref);
    if (!kid) continue;
    const kidLive = live.has(ref.toString());
    const nested = kid.lookup(PDFName.of("Kids")) instanceof PDFArray;
    const nestedAlive = nested && pruneField(kid, live);
    if (kidLive || nestedAlive) kept.push(ref);
  }
  const next = PDFArray.withContext(dict.context);
  for (const ref of kept) next.push(ref);
  dict.set(PDFName.of("Kids"), next);
  return kept.length > 0;
}

function claimName(chain: PDFDict[], taken: Set<string>) {
  const name = fullName(chain);
  if (!name) return;
  if (!taken.has(name)) {
    taken.add(name);
    return;
  }
  const named = chain.filter((dict) => partialName(dict));
  const target = named[0];
  if (!target) return;
  const stem = partialName(target)!;
  const prefix = name.endsWith(stem) ? name.slice(0, name.length - stem.length) : `${name}.`;
  let suffix = 2;
  while (taken.has(`${prefix}${stem}.${suffix}`)) suffix += 1;
  const nextPartial = `${stem}.${suffix}`;
  target.set(PDFName.of("T"), PDFHexString.fromText(nextPartial));
  taken.add(`${prefix}${nextPartial}`);
}

function acroForm(doc: PDFDocument) {
  return asDict(doc.context, doc.catalog.get(PDFName.of("AcroForm")));
}

function fieldRefs(doc: PDFDocument) {
  const refs = new Set<string>();
  const fields = acroForm(doc)?.lookup(PDFName.of("Fields"));
  if (!(fields instanceof PDFArray)) return refs;
  for (let index = 0; index < fields.size(); index++) {
    const ref = asRef(fields.get(index));
    if (ref) refs.add(ref.toString());
  }
  return refs;
}

/**
 * copyPages brings the field dictionaries along with the widgets, but not the
 * document form that lists them. Put those roots back on the form. Names already
 * in `taken` belong to the file that was already open; an incoming twin is renamed.
 */
function graftFields(doc: PDFDocument, taken: Set<string>, priorRoots: Set<string>) {
  const live = liveWidgetRefs(doc);
  const seen = new Set<PDFDict>();
  const roots: PDFDict[] = [];
  for (const page of pagesOf(doc)) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let index = 0; index < annots.size(); index++) {
      const ref = asRef(annots.get(index));
      const dict = ref ? asDict(doc.context, ref) : undefined;
      if (!dict || String(dict.lookup(PDFName.of("Subtype"))) !== "/Widget") continue;
      const chain = climb(dict);
      const root = chain[chain.length - 1]!;
      if (seen.has(root)) continue;
      seen.add(root);
      const rootRef = doc.context.getObjectRef(root);
      if (rootRef && priorRoots.has(rootRef.toString())) continue;
      if (!pruneField(root, live)) continue;
      claimName(chain, taken);
      roots.push(root);
    }
  }
  if (roots.length === 0 && priorRoots.size === 0) return;
  let form = acroForm(doc);
  if (!form) {
    if (roots.length === 0) return;
    form = doc.context.obj({});
    doc.catalog.set(PDFName.of("AcroForm"), form);
  }
  const existing = form.lookup(PDFName.of("Fields"));
  const fields = existing instanceof PDFArray ? existing : doc.context.obj([]);
  if (!(existing instanceof PDFArray)) form.set(PDFName.of("Fields"), fields);
  if (!(fields instanceof PDFArray)) return;
  const have = new Set<string>();
  for (let index = 0; index < fields.size(); index++) {
    const ref = asRef(fields.get(index));
    if (ref) have.add(ref.toString());
  }
  for (const root of roots) {
    let ref = doc.context.getObjectRef(root);
    if (!ref) ref = doc.context.register(root);
    if (have.has(ref.toString())) continue;
    fields.push(ref);
    have.add(ref.toString());
  }
}

function retainLiveFields(doc: PDFDocument) {
  const form = acroForm(doc);
  const fields = form?.lookup(PDFName.of("Fields"));
  if (!form || !(fields instanceof PDFArray)) return;
  const live = liveWidgetRefs(doc);
  const kept: PDFRef[] = [];
  for (let index = 0; index < fields.size(); index++) {
    const ref = asRef(fields.get(index));
    if (!ref) continue;
    const dict = asDict(doc.context, ref);
    if (!dict) continue;
    const alive = pruneField(dict, live);
    if (alive) kept.push(ref);
  }
  const next = PDFArray.withContext(doc.context);
  for (const ref of kept) next.push(ref);
  form.set(PDFName.of("Fields"), next);
}

function takenNames(doc: PDFDocument) {
  try {
    return new Set(doc.getForm().getFields().map((field) => field.getName()));
  } catch {
    return new Set<string>();
  }
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
  const src = await load(bytes);
  const count = src.getPageCount();
  for (const index of indices) {
    if (index < 0 || index >= count) throw new Error("That page is outside the document.");
  }
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, indices);
  for (const page of copied) out.addPage(page);
  graftFields(out, new Set(), new Set());
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
  const dest = await load(destBytes);
  const src = await load(sourceBytes);
  const sourceCount = src.getPageCount();
  for (const index of sourceIndices) {
    if (index < 0 || index >= sourceCount) throw new Error("That page is outside the other PDF.");
  }
  const taken = takenNames(dest);
  const prior = fieldRefs(dest);
  const count = dest.getPageCount();
  const at = Math.min(Math.max(0, beforeIndex), count);
  const copied = await dest.copyPages(src, sourceIndices);
  copied.forEach((page, offset) => dest.insertPage(at + offset, page));
  graftFields(dest, taken, prior);
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
  retainLiveFields(doc);
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

/** Move `indices` as one block. `dest` is the index after those pages are lifted out. */
export async function movePages(bytes: Uint8Array, indices: number[], dest: number) {
  const doc = await load(bytes);
  const count = doc.getPageCount();
  const ordered = [...new Set(indices)].sort((a, b) => a - b);
  if (ordered.length === 0) throw new Error("Choose a page to move.");
  if (ordered.length >= count) throw new Error("Leave at least one page where it is.");
  for (const index of ordered) {
    if (index < 0 || index >= count) throw new Error("That page is outside the document.");
  }
  if (dest < 0 || dest > count - ordered.length) throw new Error("That page is outside the document.");
  const pages = ordered.map((index) => doc.getPage(index));
  for (const index of [...ordered].sort((a, b) => b - a)) doc.removePage(index);
  pages.forEach((page, offset) => doc.insertPage(dest + offset, page));
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
