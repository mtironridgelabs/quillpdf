import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { NOTE_HEIGHT, NOTE_SIZE, noteBox } from "@/lib/pdf-fill";

export type PageNote = { id: string; page: number; x: number; y: number; text: string; width?: number; height?: number };

type Widget = {
  id: string;
  kind: "text" | "checkbox";
  value: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

export function FillLayer({
  pdf,
  pageNumber,
  scale,
  values,
  notes,
  placing,
  focusId,
  onValue,
  onPlace,
  onNoteText,
  onNoteMove,
  onNoteResize,
  onNoteRemove,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  values: Record<string, string>;
  notes: PageNote[];
  placing: boolean;
  focusId: string;
  onValue: (id: string, value: string) => void;
  onPlace: (page: number, x: number, y: number) => void;
  onNoteText: (id: string, text: string) => void;
  onNoteMove: (id: string, x: number, y: number) => void;
  onNoteResize: (id: string, width: number, height: number) => void;
  onNoteRemove: (id: string) => void;
}) {
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [points, setPoints] = useState<Record<string, { left: number; top: number }>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const annots = await page.getAnnotations();
      if (cancelled) return;
      const next: Widget[] = [];
      for (const annot of annots) {
        if (annot.subtype !== "Widget") continue;
        const kind = annot.checkBox ? "checkbox" : annot.fieldType === "Tx" ? "text" : null;
        if (!kind || !annot.rect) continue;
        const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(annot.rect);
        next.push({
          id: String(annot.id ?? ""),
          kind,
          value: String(annot.fieldValue ?? ""),
          left: Math.min(x1, x2),
          top: Math.min(y1, y2),
          width: Math.max(8, Math.abs(x2 - x1)),
          height: Math.max(8, Math.abs(y2 - y1)),
        });
      }
      const located: Record<string, { left: number; top: number }> = {};
      for (const note of notes) {
        if (note.page !== pageNumber) continue;
        const [left, top] = viewport.convertToViewportPoint(note.x, note.y);
        located[note.id] = { left, top };
      }
      setWidgets(next);
      setPoints(located);
    })();
    return () => {
      cancelled = true;
    };
  }, [notes, pageNumber, pdf, scale]);

  return (
    <div
      className="q-fill"
      data-place={placing || undefined}
      onPointerDown={(event) => {
        if (!placing) return;
        const target = event.target as HTMLElement;
        if (target.closest(".q-field, .q-note")) return;
        const rect = event.currentTarget.getBoundingClientRect();
        void (async () => {
          const page = await pdf.getPage(pageNumber);
          const viewport = page.getViewport({ scale });
          const [x, y] = viewport.convertToPdfPoint(event.clientX - rect.left, event.clientY - rect.top);
          onPlace(pageNumber, x, y);
        })();
      }}
    >
      {widgets.map((widget) => {
        const value = values[widget.id] ?? widget.value;
        const fontSize = Math.min(widget.height * 0.72, NOTE_SIZE * scale);
        if (widget.kind === "checkbox") {
          const on = Boolean(value) && value !== "Off";
          return (
            <button
              key={widget.id}
              type="button"
              className="q-field q-check"
              data-on={on || undefined}
              style={{ left: widget.left, top: widget.top, width: widget.width, height: widget.height }}
              aria-pressed={on}
              aria-label="Checkbox"
              onClick={() => onValue(widget.id, on ? "Off" : "Yes")}
            >
              {on ? "✓" : ""}
            </button>
          );
        }
        return (
          <input
            key={widget.id}
            className="q-field"
            style={{ left: widget.left, top: widget.top, width: widget.width, height: widget.height, fontSize }}
            value={value}
            aria-label="Form field"
            onChange={(event) => onValue(widget.id, event.target.value)}
          />
        );
      })}
      {notes
        .filter((note) => note.page === pageNumber)
        .map((note) => {
          const point = points[note.id];
          if (!point) return null;
          const box = noteBox({ ...note, size: NOTE_SIZE, text: note.text });
          return (
            <div
              key={note.id}
              className="q-note"
              style={{ left: point.left, top: point.top, width: box.width * scale, height: box.height * scale }}
            >
              <button
                type="button"
                className="q-note-move"
                aria-label="Move text box"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const startX = event.clientX;
                  const startY = event.clientY;
                  const origin = { x: note.x, y: note.y };
                  const move = (ev: PointerEvent) => {
                    onNoteMove(note.id, origin.x + (ev.clientX - startX) / scale, origin.y - (ev.clientY - startY) / scale);
                  };
                  const up = () => {
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", up);
                  };
                  window.addEventListener("pointermove", move);
                  window.addEventListener("pointerup", up);
                }}
              />
              <textarea
                id={`q-note-${note.id}`}
                autoFocus={focusId === note.id}
                style={{ fontSize: NOTE_SIZE * scale }}
                value={note.text}
                aria-label="Text box"
                rows={1}
                onChange={(event) => onNoteText(note.id, event.target.value)}
              />
              <button type="button" className="q-note-x" aria-label="Remove text box" onClick={() => onNoteRemove(note.id)}>
                ×
              </button>
              <button
                type="button"
                className="q-note-resize"
                aria-label="Stretch text box"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const startX = event.clientX;
                  const startY = event.clientY;
                  const origin = box;
                  const move = (ev: PointerEvent) => {
                    onNoteResize(
                      note.id,
                      Math.max(80, origin.width + (ev.clientX - startX) / scale),
                      Math.max(NOTE_HEIGHT, origin.height + (ev.clientY - startY) / scale),
                    );
                  };
                  const up = () => {
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", up);
                  };
                  window.addEventListener("pointermove", move);
                  window.addEventListener("pointerup", up);
                }}
              />
            </div>
          );
        })}
    </div>
  );
}
