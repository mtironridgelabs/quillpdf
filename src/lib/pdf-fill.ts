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
  return [...text.normalize("NFKD")].filter((char) => char.charCodeAt(0) <= 0xff).join("");
}

/** Write answers into the form and keep the fields, so the file can be edited again. */
export async function applyFill(bytes: Uint8Array, fields: StampField[], notes: StampNote[]) {
  const doc = await PDFDocument.load(bytes.slice(0), { ignoreEncryption: true });
  if (doc.getPageCount() < 1) throw new Error("Quill couldn't write this PDF directly.");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();

  if (fields.length > 0 && doc.catalog.getAcroForm()) {
    for (const field of fields) {
      try {
        if (field.kind === "checkbox") {
          const box = form.getCheckBox(field.name);
          if (field.value && field.value !== "Off") box.check();
          else box.uncheck();
          box.updateAppearances();
        } else {
          const text = form.getTextField(field.name);
          text.setText(latin(field.value));
          text.updateAppearances(font);
        }
      } catch {
        /* A nameless or odd widget is skipped. The text box is the fallback. */
      }
    }
  }

  const taken = new Set(form.getFields().map((field) => field.getName()));
  let noteIndex = 1;
  for (const note of notes) {
    const text = latin(note.text);
    if (!text) continue;
    let name = `Quill.Note.${noteIndex}`;
    while (taken.has(name)) {
      noteIndex += 1;
      name = `Quill.Note.${noteIndex}`;
    }
    taken.add(name);
    noteIndex += 1;
    const page = doc.getPage(note.page - 1);
    const { width, height } = noteBox(note);
    const box = form.createTextField(name);
    box.enableMultiline();
    box.setText(text);
    box.addToPage(page, {
      x: note.x,
      y: note.y - height,
      width,
      height,
      font,
      textColor: ink,
      borderWidth: 0,
      borderColor: ink,
      backgroundColor: rgb(1, 1, 1),
    });
    box.setFontSize(note.size);
    box.updateAppearances(font);
  }

  return doc.save({ updateFieldAppearances: false });
}
