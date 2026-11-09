import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Thumb } from "@/components/quire/paint";

export function Sidebar({
  pdf,
  numPages,
  page,
  selected,
  onSelect,
  onMove,
}: {
  pdf: PDFDocumentProxy;
  numPages: number;
  page: number;
  selected: number[];
  onSelect: (index: number, event: React.MouseEvent) => void;
  onMove: (from: number, to: number) => void;
}) {
  const [over, setOver] = useState<number | null>(null);
  const pages = Array.from({ length: numPages }, (_, index) => index);

  return (
    <aside className="q-side" aria-label="Pages">
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
          over={over === index}
          onSelect={onSelect}
          onOver={setOver}
          onMove={onMove}
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
  over,
  onSelect,
  onOver,
  onMove,
}: {
  pdf: PDFDocumentProxy;
  index: number;
  current: boolean;
  selected: boolean;
  over: boolean;
  onSelect: (index: number, event: React.MouseEvent) => void;
  onOver: (index: number | null) => void;
  onMove: (from: number, to: number) => void;
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
      data-over={over || undefined}
      draggable
      onClick={(event) => onSelect(index, event)}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", String(index));
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(event) => {
        event.preventDefault();
        onOver(index);
      }}
      onDragLeave={() => onOver(null)}
      onDrop={(event) => {
        event.preventDefault();
        onOver(null);
        const from = Number(event.dataTransfer.getData("text/plain"));
        if (Number.isInteger(from)) onMove(from, index);
      }}
    >
      {visible ? <Thumb pdf={pdf} pageNumber={index + 1} /> : <span className="q-thumb-frame" />}
      <span>{index + 1}</span>
    </button>
  );
}
