import { PDFDocument } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { NOTE_SIZE, noteBox, wrapNote, type StampField, type StampNote } from "@/lib/pdf-fill";

const ink = "#1B2330";

export async function fieldsFromValues(pdf: PDFDocumentProxy, values: Record<string, string>): Promise<StampField[]> {
  const out: StampField[] = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const annots = await page.getAnnotations();
    for (const annot of annots) {
      if (annot.subtype !== "Widget") continue;
      const id = String(annot.id ?? "");
      if (!(id in values) || !annot.fieldName) continue;
      const kind = annot.checkBox ? "checkbox" : annot.fieldType === "Tx" ? "text" : null;
      if (!kind) continue;
      const rect = annot.rect as number[];
      out.push({
        name: String(annot.fieldName),
        kind,
        value: values[id] ?? "",
        page: number,
        rect: [rect[0] ?? 0, rect[1] ?? 0, rect[2] ?? 0, rect[3] ?? 0],
      });
    }
  }
  return out;
}

/** Used when the original file cannot be rewritten. Draws the page, then the answers, into a new PDF. */
export async function rasterStamp(pdf: PDFDocumentProxy, fields: StampField[], notes: StampNote[]) {
  const out = await PDFDocument.create();
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Quill couldn't draw that page.");
    await page.render({ canvasContext: context, viewport }).promise;
    context.fillStyle = ink;
    context.textBaseline = "middle";

    for (const field of fields) {
      if (field.page !== number || !field.value || field.value === "Off" || !field.rect) continue;
      const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(field.rect);
      const left = Math.min(x1, x2);
      const top = Math.min(y1, y2);
      const width = Math.abs(x2 - x1);
      const height = Math.abs(y2 - y1);
      context.save();
      context.beginPath();
      context.rect(left, top, width, height);
      context.clip();
      if (field.kind === "checkbox") {
        context.font = `${Math.max(8, height * 0.9)}px Helvetica, Arial, sans-serif`;
        context.textAlign = "center";
        context.fillText("✓", left + width / 2, top + height / 2);
      } else {
        const fontSize = Math.min(height * 0.72, NOTE_SIZE * 2);
        context.font = `${fontSize}px Helvetica, Arial, sans-serif`;
        context.textAlign = "left";
        context.fillText(field.value, left + 1, top + height / 2);
      }
      context.restore();
    }

    context.textBaseline = "top";
    context.textAlign = "left";
    for (const note of notes) {
      if (note.page !== number || !note.text) continue;
      const [vx, vy] = viewport.convertToViewportPoint(note.x, note.y);
      const { width, height } = noteBox(note);
      const fontSize = note.size * 2;
      context.font = `${fontSize}px Helvetica, Arial, sans-serif`;
      const leading = fontSize * 1.25;
      const max = Math.max(1, Math.floor((height * 2) / leading));
      const lines = wrapNote(note.text, width * 2, (line) => context.measureText(line).width);
      lines.slice(0, max).forEach((line, index) => {
        if (line) context.fillText(line, vx, vy + index * leading);
      });
    }

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Quill couldn't draw that page."))), "image/png");
    });
    const image = await out.embedPng(new Uint8Array(await blob.arrayBuffer()));
    const sheet = out.addPage([base.width, base.height]);
    sheet.drawImage(image, { x: 0, y: 0, width: base.width, height: base.height });
  }
  return out.save();
}
