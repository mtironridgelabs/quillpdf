import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Thumb } from "@/components/quire/paint";
import { openPdfDocument } from "@/lib/pdfjs-client";

export function InsertDialog({
  open,
  numPages,
  defaultBefore,
  busy,
  onClose,
  onInsert,
}: {
  open: boolean;
  numPages: number;
  defaultBefore: number;
  busy: boolean;
  onClose: () => void;
  onInsert: (bytes: Uint8Array, indices: number[], beforeIndex: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const sourcePdf = useRef<PDFDocumentProxy | null>(null);
  const [source, setSource] = useState<{ name: string; bytes: Uint8Array; pdf: PDFDocumentProxy } | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [before, setBefore] = useState(defaultBefore);
  const [error, setError] = useState("");
  const opened = useRef(false);

  useEffect(() => {
    if (open && !opened.current) {
      setBefore(defaultBefore);
      setPicked([]);
      setError("");
    }
    if (!open && opened.current) {
      sourcePdf.current?.destroy();
      sourcePdf.current = null;
      setSource(null);
    }
    opened.current = open;
  }, [open, defaultBefore]);

  async function choose(file: File | undefined) {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      const pdf = await openPdfDocument(bytes);
      sourcePdf.current?.destroy();
      sourcePdf.current = pdf;
      setSource({ name: file.name, bytes, pdf });
      setPicked(Array.from({ length: pdf.numPages }, (_, index) => index));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Quill couldn't open that PDF.");
    }
  }

  const count = source?.pdf.numPages ?? 0;

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="q-overlay" />
        <Dialog.Content className="q-dialog" aria-describedby="insert-help">
          <Dialog.Title asChild>
            <h2>Insert pages</h2>
          </Dialog.Title>
          <p id="insert-help">
            Bring pages in from another PDF. That file is not changed, and blank pages are not added.
          </p>
          <div className="q-insert-row">
            <button type="button" className="q-btn primary" onClick={() => inputRef.current?.click()}>
              Choose PDF
            </button>
            {source ? <span className="q-muted">{source.name}</span> : null}
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                void choose(file);
              }}
            />
          </div>
          {error ? <p>{error}</p> : null}
          {source ? (
            <>
              <div className="q-insert-row">
                <button
                  type="button"
                  className="q-btn"
                  onClick={() => setPicked(Array.from({ length: count }, (_, index) => index))}
                >
                  All
                </button>
                <button type="button" className="q-btn" onClick={() => setPicked([])}>
                  None
                </button>
                <label className="q-page-field">
                  Insert before page
                  <input
                    className="q-field"
                    inputMode="numeric"
                    value={before}
                    onChange={(event) => setBefore(Number(event.target.value.replace(/\D/g, "")) || 1)}
                    aria-label="Insert before page"
                  />
                </label>
              </div>
              <div className="q-source-grid">
                {Array.from({ length: count }, (_, index) => (
                  <button
                    key={index}
                    type="button"
                    className="q-thumb"
                    data-selected={picked.includes(index) || undefined}
                    onClick={(event) => {
                      if (event.shiftKey && picked.length) {
                        const anchor = picked[picked.length - 1] ?? index;
                        const start = Math.min(anchor, index);
                        const end = Math.max(anchor, index);
                        setPicked(Array.from({ length: end - start + 1 }, (_, offset) => start + offset));
                        return;
                      }
                      setPicked((current) =>
                        current.includes(index)
                          ? current.filter((page) => page !== index)
                          : [...current, index].sort((a, b) => a - b),
                      );
                    }}
                  >
                    <Thumb pdf={source.pdf} pageNumber={index + 1} />
                    <span>{index + 1}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
          <div className="q-dialog-actions">
            <Dialog.Close asChild>
              <button type="button" className="q-btn">
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              className="q-btn primary"
              disabled={!source || picked.length === 0 || busy}
              onClick={() => {
                if (!source) return;
                const at = Math.min(Math.max(1, before), numPages + 1) - 1;
                onInsert(source.bytes, [...picked].sort((a, b) => a - b), at);
              }}
            >
              {picked.length === 0 ? "Insert" : `Insert ${picked.length}`}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
