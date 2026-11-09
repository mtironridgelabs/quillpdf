import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const NOTE_SIZE = 11;
export const NOTE_WIDTH = 180;
export const NOTE_HEIGHT = NOTE_SIZE * 1.35;

export type StampField = {
  name: string;
  kind: "text" | "checkbox";
  value: string;
  page: number;
  rect: number[];
};

export type StampNote = {
  page: number;
  x: number;
  y: number;
  text: string;
  size: number;
  width?: number;
  height?: number;
};

export function noteBox(note: StampNote) {
  return { width: note.width ?? NOTE_WIDTH, height: note.height ?? NOTE_HEIGHT };
}

export function wrapNote(text: string, maxWidth: number, widthOf: (line: string) => number) {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      const trial = line ? `${line} ${word}` : word;
      if (widthOf(trial) <= maxWidth) {
        line = trial;
        continue;
      }
      if (line) lines.push(line);
      if (widthOf(word) <= maxWidth) {
        line = word;
        continue;
      }
      let chunk = "";
      for (const character of word) {
        if (widthOf(chunk + character) <= maxWidth) chunk += character;
        else {
          if (chunk) lines.push(chunk);
          chunk = character;
        }
      }
      line = chunk;
    }
    lines.push(line);
  }
  return lines;
}

const ink = rgb(27 / 255, 35 / 255, 48 / 255);

function latin(text: string) {
  return text.normalize("NFKD").replace(/[^\u0000-\u00ff]/g, "");
}

/** Write answers into a form pdf-lib can open, then bake them. Throws if the file cannot be rewritten. */
export async function applyFill(bytes: Uint8Array, fields: StampField[], notes: StampNote[]) {
  const doc = await PDFDocument.load(bytes.slice(0), { ignoreEncryption: true });
  if (doc.getPageCount() < 1) throw new Error("Quill couldn't write this PDF directly.");
  const font = await doc.embedFont(StandardFonts.Helvetica);

  if (fields.length > 0 && doc.catalog.getAcroForm()) {
    const form = doc.getForm();
    for (const field of fields) {
      try {
        if (field.kind === "checkbox") {
          const box = form.getCheckBox(field.name);
          if (field.value && field.value !== "Off") box.check();
          else box.uncheck();
        } else {
          form.getTextField(field.name).setText(field.value);
        }
      } catch {
        /* A nameless or odd widget is skipped. The text box is the fallback. */
      }
    }
    try {
      form.flatten();
    } catch {
      try {
        form.flatten({ updateFieldAppearances: false });
      } catch {
        /* Keep the written values even if the fields cannot be removed. */
      }
    }
  }

  for (const note of notes) {
    if (!note.text) continue;
    const page = doc.getPage(note.page - 1);
    const { width, height } = noteBox(note);
    const leading = note.size * 1.25;
    const max = Math.max(1, Math.floor(height / leading));
    const draw = (text: string) => {
      const lines = wrapNote(text, width, (line) => font.widthOfTextAtSize(line, note.size));
      lines.slice(0, max).forEach((line, index) => {
        if (!line) return;
        page.drawText(line, {
          x: note.x,
          y: note.y - note.size * 0.8 - index * leading,
          size: note.size,
          font,
          color: ink,
        });
      });
    };
    try {
      draw(note.text);
    } catch {
      const safe = latin(note.text);
      if (safe) draw(safe);
    }
  }

  return doc.save({ updateFieldAppearances: false });
}
