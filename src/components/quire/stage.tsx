import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PagePaint } from "@/components/quire/paint";
import { FillLayer, type PageNote } from "@/components/quire/fill-layer";

export type ViewMode = "fit-page" | "fit-width";

export type InkStroke = {
  color: string;
  width: number;
  alpha: number;
  points: { x: number; y: number }[];
};

type Ink = {
  active: boolean;
  pen: Pick<InkStroke, "color" | "width" | "alpha">;
  strokes: InkStroke[];
  onCommit: (stroke: InkStroke) => void;
};

type Fill = {
  placing: boolean;
  focusId: string;
  values: Record<string, string>;
  notes: PageNote[];
  onValue: (id: string, value: string) => void;
  onPlace: (page: number, x: number, y: number) => void;
  onNoteText: (id: string, text: string) => void;
  onNoteMove: (id: string, x: number, y: number) => void;
  onNoteResize: (id: string, width: number, height: number) => void;
  onNoteRemove: (id: string) => void;
};

type Size = { w: number; h: number };

export function Stage({
  pdf,
  page,
  mode,
  zoom,
  scrollRequest,
  scrollBlock = "nearest",
  ink = null,
  fill = null,
  onPage,
  onZoom,
}: {
  pdf: PDFDocumentProxy;
  page: number;
  mode: ViewMode;
  zoom: number;
  scrollRequest: number;
  scrollBlock?: ScrollLogicalPosition;
  ink?: Ink | null;
  fill?: Fill | null;
  onPage: (page: number) => void;
  onZoom: (factor: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 800, h: 600 });
  const [sizes, setSizes] = useState<Size[]>([]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      onZoom(event.deltaY < 0 ? 1.08 : 1 / 1.08);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onZoom]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setBox({ w: rect.width, h: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSizes([]);
    void (async () => {
      const next: Size[] = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        const sheet = await pdf.getPage(number);
        const viewport = sheet.getViewport({ scale: 1 });
        next.push({ w: viewport.width, h: viewport.height });
      }
      if (!cancelled) setSizes(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf]);

  const pageRef = useRef(page);
  pageRef.current = page;

  useEffect(() => {
    document.getElementById(`q-page-${pageRef.current}`)?.scrollIntoView({ block: scrollBlock });
  }, [scrollRequest, mode, pdf, scrollBlock]);

  useEffect(() => {
    const root = scroller.current;
    if (!root || sizes.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const best = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const number = Number((best?.target as HTMLElement | undefined)?.dataset.page);
        if (number) onPage(number);
      },
      { root, threshold: [0.55] },
    );
    root.querySelectorAll<HTMLElement>(".q-sheet").forEach((sheet) => observer.observe(sheet));
    return () => observer.disconnect();
  }, [mode, pdf, sizes.length, onPage]);

  const pad = box.w < 640 ? 16 : 48;
  const scaleFor = (size: Size | undefined, fit: ViewMode) => {
    if (!size || size.w === 0 || size.h === 0) return 1;
    const fitted =
      fit === "fit-page"
        ? Math.min((box.w - pad) / size.w, (box.h - pad) / size.h)
        : (box.w - pad) / size.w;
    return Math.min(4, Math.max(0.25, fitted * zoom));
  };

  const visible = sizes.map((_, index) => index);

  return (
    <main className="q-stage" data-mode={mode} data-ink={ink?.active || undefined} ref={scroller}>
      {sizes.length === 0 ? (
        <p className="q-status">Preparing pages…</p>
      ) : (
        <div className="q-stage-inner">
          {visible.map((index) => {
            const size = sizes[index];
            const scale = scaleFor(size, mode);
            if (!size) return null;
            return (
              <article
                key={index}
                id={`q-page-${index + 1}`}
                data-page={index + 1}
                className="q-sheet"
                style={{ width: size.w * scale, height: size.h * scale }}
              >
                <VisibleSheet pdf={pdf} pageNumber={index + 1} scale={scale} />
                {fill ? (
                  <FillLayer
                    pdf={pdf}
                    pageNumber={index + 1}
                    scale={scale}
                    values={fill.values}
                    notes={fill.notes}
                    placing={fill.placing}
                    focusId={fill.focusId}
                    onValue={fill.onValue}
                    onPlace={fill.onPlace}
                    onNoteText={fill.onNoteText}
                    onNoteMove={fill.onNoteMove}
                    onNoteResize={fill.onNoteResize}
                    onNoteRemove={fill.onNoteRemove}
                  />
                ) : null}
              </article>
            );
          })}
          {ink ? (
            <InkLayer active={ink.active} pen={ink.pen} strokes={ink.strokes} onCommit={ink.onCommit} />
          ) : null}
        </div>
      )}
    </main>
  );
}

function VisibleSheet({
  pdf,
  pageNumber,
  scale,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShow(Boolean(entry?.isIntersecting)),
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ width: "100%", height: "100%" }}>
      {show ? <PagePaint pdf={pdf} pageNumber={pageNumber} scale={scale} /> : null}
    </div>
  );
}

function paintStrokes(ctx: CanvasRenderingContext2D, strokes: InkStroke[], width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
  for (const stroke of strokes) {
    const first = stroke.points[0];
    if (!first) continue;
    ctx.save();
    ctx.globalAlpha = stroke.alpha;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (stroke.points.length < 2) {
      ctx.beginPath();
      ctx.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function InkLayer({
  active,
  pen,
  strokes,
  onCommit,
}: {
  active: boolean;
  pen: Pick<InkStroke, "color" | "width" | "alpha">;
  strokes: InkStroke[];
  onCommit: (stroke: InkStroke) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draft = useRef<InkStroke | null>(null);
  const drawing = useRef(false);
  const strokesRef = useRef(strokes);
  const penRef = useRef(pen);
  strokesRef.current = strokes;
  penRef.current = pen;

  const redraw = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const list = draft.current ? [...strokesRef.current, draft.current] : strokesRef.current;
    paintStrokes(ctx, list, canvas.clientWidth, canvas.clientHeight);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(parent.clientWidth * dpr));
      canvas.height = Math.max(1, Math.floor(parent.clientHeight * dpr));
      redraw();
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [strokes]);

  const pointFrom = (event: { currentTarget: HTMLCanvasElement; clientX: number; clientY: number }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  return (
    <canvas
      ref={canvasRef}
      className="q-ink"
      data-on={active || undefined}
      onPointerDown={(event) => {
        if (!active) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drawing.current = true;
        draft.current = { ...penRef.current, points: [pointFrom(event)] };
        redraw();
      }}
      onPointerMove={(event) => {
        if (!drawing.current || !draft.current) return;
        draft.current.points.push(pointFrom(event));
        redraw();
      }}
      onPointerUp={(event) => {
        if (!drawing.current || !draft.current) return;
        drawing.current = false;
        const stroke = draft.current;
        draft.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        onCommit(stroke);
      }}
    />
  );
}
