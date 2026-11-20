import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Thumb } from "@/components/quire/paint";

export function Sidebar({
  pdf,
  numPages,
  page,
  selected,
  onSelect,
  onReorder,
}: {
  pdf: PDFDocumentProxy;
  numPages: number;
  page: number;
  selected: number[];
  onSelect: (index: number, event: React.MouseEvent) => void;
  onReorder: (moving: number[], insertAt: number) => void;
}) {
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const drag = useRef<{ index: number; group: number[]; y: number; active: boolean; at: number | null } | null>(null);
  const suppressClick = useRef(false);
  const pages = Array.from({ length: numPages }, (_, index) => index);

  function insertionIndex(clientY: number, list: HTMLElement) {
    const buttons = [...list.querySelectorAll<HTMLButtonElement>(".q-thumb")];
    for (let index = 0; index < buttons.length; index++) {
      const box = buttons[index]!.getBoundingClientRect();
      if (clientY < box.top + box.height / 2) return index;
    }
    return buttons.length;
  }

  return (
    <aside className="q-side" aria-label="Pages" title="Drag a thumbnail to change the page order. Fillable fields stay with their pages.">
      <div className="q-side-head">
        <span>Pages</span>
        <span>{selected.length > 0 ? `${selected.length} selected` : numPages}</span>
      </div>
      {pages.map((index) => (
        <ThumbButton
          key={`${pdf.fingerprints[0] ?? "doc"}-${index}`}
          pdf={pdf}
          index={index}
          current={page === index + 1}
          selected={selected.includes(index)}
          insert={insertAt === index ? "before" : insertAt === numPages && index === numPages - 1 ? "after" : undefined}
          onSelect={(thumb, event) => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            onSelect(thumb, event);
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const group = selected.includes(index) ? [...selected] : [index];
            drag.current = { index, group, y: event.clientY, active: false, at: null };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const state = drag.current;
            if (!state || state.index !== index) return;
            if (!state.active && Math.abs(event.clientY - state.y) < 5) return;
            state.active = true;
            const list = event.currentTarget.parentElement;
            if (!list) return;
            const at = insertionIndex(event.clientY, list);
            state.at = at;
            setInsertAt(at);
          }}
          onPointerUp={() => {
            const state = drag.current;
            drag.current = null;
            setInsertAt(null);
            if (!state?.active || state.at == null) return;
            suppressClick.current = true;
            onReorder(state.group, state.at);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setInsertAt(null);
          }}
        />
      ))}
    </aside>
  );
}

function ThumbButton({
  pdf,
  index,
  current,
  selected,
  insert,
  onSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  pdf: PDFDocumentProxy;
  index: number;
  current: boolean;
  selected: boolean;
  insert?: "before" | "after";
  onSelect: (index: number, event: React.MouseEvent) => void;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setVisible(true);
      },
      { rootMargin: "240px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <button
      ref={ref}
      type="button"
      className="q-thumb"
      data-current={current || undefined}
      data-selected={selected || undefined}
      data-insert={insert}
      onClick={(event) => onSelect(index, event)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {visible ? <Thumb pdf={pdf} pageNumber={index + 1} /> : <span className="q-thumb-frame" />}
      <span>{index + 1}</span>
    </button>
  );
}
