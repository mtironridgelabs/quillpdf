import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { loadPdfjs } from "@/lib/pdfjs-client";

export function PagePaint({
  pdf,
  pageNumber,
  scale,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const text = textRef.current;
    if (!canvas || !text) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    let layer: { cancel: () => void } | null = null;

    void (async () => {
      const pdfjs = await loadPdfjs();
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      const renderTask = page.render({
        canvasContext: context,
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      });
      task = renderTask;
      try {
        await renderTask.promise;
      } catch (error) {
        if ((error as { name?: string }).name !== "RenderingCancelledException") return;
        return;
      }
      if (cancelled) return;
      text.replaceChildren();
      text.style.width = `${viewport.width}px`;
      text.style.height = `${viewport.height}px`;
      const textLayer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent({ includeMarkedContent: true }),
        container: text,
        viewport,
      });
      layer = textLayer;
      await textLayer.render();
    })().catch(() => {
      /* A cancelled render, or a page that disappeared mid-edit. */
    });

    return () => {
      cancelled = true;
      task?.cancel();
      layer?.cancel();
    };
  }, [pdf, pageNumber, scale]);

  return (
    <>
      <canvas ref={canvasRef} />
      <div ref={textRef} className="textLayer" />
    </>
  );
}

export function Thumb({
  pdf,
  pageNumber,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(1.294);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    void (async () => {
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      if (cancelled) return;
      setRatio(base.height / base.width);
      const width = canvas.clientWidth || 120;
      const viewport = page.getViewport({ scale: width / base.width });
      canvas.width = Math.floor(viewport.width * 2);
      canvas.height = Math.floor(viewport.height * 2);
      const context = canvas.getContext("2d");
      if (!context) return;
      const renderTask = page.render({
        canvasContext: context,
        viewport,
        transform: [2, 0, 0, 2, 0, 0],
      });
      task = renderTask;
      try {
        await renderTask.promise;
      } catch {
        /* cancelled */
      }
    })().catch(() => {
      /* A cancelled render, or a page that disappeared mid-edit. */
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageNumber]);

  return (
    <span className="q-thumb-frame" style={{ aspectRatio: `${1} / ${ratio}` }}>
      <canvas ref={canvasRef} />
    </span>
  );
}
