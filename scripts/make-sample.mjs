import { writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const ink = rgb(0.106, 0.137, 0.188);
const slate = rgb(0.243, 0.325, 0.408);
const paper = rgb(0.953, 0.937, 0.902);

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.TimesRoman);
const bold = await doc.embedFont(StandardFonts.TimesRomanBold);

function add(title, body, width = 612, height = 792) {
  const page = doc.addPage([width, height]);
  page.drawRectangle({ x: 0, y: height - 28, width, height: 28, color: ink });
  page.drawText("TOP", { x: 16, y: height - 20, size: 11, font: bold, color: paper });
  page.drawText(title, { x: 54, y: height - 88, size: 28, font: bold, color: ink });
  const words = body.split(" ");
  let line = "";
  let y = height - 130;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, 13) > width - 108) {
      page.drawText(line, { x: 54, y, size: 13, font, color: slate });
      line = word;
      y -= 20;
    } else {
      line = next;
    }
  }
  if (line) page.drawText(line, { x: 54, y, size: 13, font, color: slate });
  return page;
}

add(
  "Quill sample",
  "A four-page packet. Select pages in the sidebar. Insert only brings pages in from another PDF. Extract downloads a new file and leaves this one alone.",
);
add(
  "Page two",
  "Portrait. Rotate this page and save a copy. The turn is stored in the PDF, not just on screen, so print and the next open keep it.",
);
add(
  "Wide page",
  "This sheet is landscape. Fit page should show the whole sheet, including the bar marked TOP.",
  792,
  612,
);
add(
  "Page four",
  "Drag a thumbnail to reorder. Remove is undoable until you save a copy. Print uses the pages as they are now, edits included.",
);

writeFileSync(new URL("../public/sample.pdf", import.meta.url), await doc.save());
