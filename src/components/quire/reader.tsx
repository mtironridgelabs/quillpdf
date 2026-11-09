import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileOutput,
  FolderOpen,
  Maximize,
  Minus,
  Plus,
  Printer,
  RotateCcw,
  RotateCw,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";
import { InsertDialog } from "@/components/quire/insert-dialog";
import { Sidebar } from "@/components/quire/sidebar";
import { Stage, type InkStroke, type ViewMode } from "@/components/quire/stage";
import { appUrl } from "@/lib/app-url";
import {
  extractPages,
  flattenDocument,
  insertPages,
  movePage,
  pageListLabel,
  removePages,
  rotatePages,
} from "@/lib/pdf-ops";
import { applyFill, NOTE_HEIGHT, NOTE_SIZE, NOTE_WIDTH, type StampNote } from "@/lib/pdf-fill";
import { fieldsFromValues, rasterStamp } from "@/lib/raster-fill";
import { openPdfDocument } from "@/lib/pdfjs-client";
import {
  checkAndInstallUpdate,
  desktopShell,
  dismissDefaultAppsPrompt,
  listenForOpenedPdfs,
  openDefaultApps,
  savePdfWithDialog,
  shouldPromptForDefaultApps,
} from "@/lib/desktop";

type Doc = { name: string; pdf: PDFDocumentProxy };
type Pending = { name: string; bytes: Uint8Array };

const icon = { size: 18, strokeWidth: 1.75 } as const;

const PENS = [
  { id: "red", label: "Red", color: "#D7263D", width: 3.5, alpha: 1, highlighter: false },
  { id: "green", label: "Green", color: "#2E8B45", width: 3.5, alpha: 1, highlighter: false },
  { id: "blue", label: "Blue", color: "#2B6CB0", width: 3.5, alpha: 1, highlighter: false },
  { id: "black", label: "Black", color: "#1B2330", width: 3.5, alpha: 1, highlighter: false },
  { id: "highlight", label: "Yellow highlighter", color: "#F5D90A", width: 22, alpha: 0.45, highlighter: true },
] as const;

export function Reader() {
  const openRef = useRef<HTMLInputElement>(null);
  const bytesRef = useRef<Uint8Array | null>(null);
  const nameRef = useRef("document.pdf");
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const genRef = useRef(0);
  const past = useRef<Uint8Array[]>([]);
  const pageRef = useRef(1);
  const anchor = useRef(0);
  const busyRef = useRef(false);
  const presentingRef = useRef(false);
  const fillingRef = useRef(false);
  const placingRef = useRef(false);
  const fieldValuesRef = useRef<Record<string, string>>({});
  const notesRef = useRef<Array<StampNote & { id: string }>>([]);
  const fillView = useRef<{ mode: ViewMode; zoom: number } | null>(null);

  const [doc, setDoc] = useState<Doc | null>(null);
  const [page, setPage] = useState(1);
  const [pageText, setPageText] = useState("1");
  const [selected, setSelected] = useState<number[]>([]);
  const [dirty, setDirty] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<ViewMode>("fit-width");
  const [zoom, setZoom] = useState(1);
  const [presenting, setPresenting] = useState(false);
  const [inking, setInking] = useState(false);
  const [penId, setPenId] = useState<(typeof PENS)[number]["id"]>("black");
  const [strokes, setStrokes] = useState<InkStroke[]>([]);
  const [scrollRequest, setScrollRequest] = useState(0);
  const [insertOpen, setInsertOpen] = useState(false);
  const [insertBefore, setInsertBefore] = useState(2);
  const [pending, setPending] = useState<Pending | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [askDefaultApps, setAskDefaultApps] = useState(false);
  const [fillable, setFillable] = useState(false);
  const [filling, setFilling] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [focusNote, setFocusNote] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Array<StampNote & { id: string }>>([]);

  pageRef.current = page;
  presentingRef.current = presenting;
  fillingRef.current = filling;
  placingRef.current = placing;
  fieldValuesRef.current = fieldValues;
  notesRef.current = notes;
  const numPages = doc?.pdf.numPages ?? 0;

  const goTo = useCallback((next: number) => {
    setPage(next);
    setScrollRequest((value) => value + 1);
  }, []);

  const show = useCallback(async (name: string, bytes: Uint8Array, atPage: number) => {
    const generation = ++genRef.current;
    const pdf = await openPdfDocument(bytes);
    if (generation !== genRef.current) {
      await pdf.destroy();
      return;
    }
    let fields = false;
    try {
      const objects = await pdf.getFieldObjects();
      fields = Boolean(objects && Object.keys(objects).length > 0);
    } catch {
      fields = false;
    }
    if (generation !== genRef.current) {
      await pdf.destroy();
      return;
    }
    const previous = pdfRef.current;
    pdfRef.current = pdf;
    bytesRef.current = bytes;
    nameRef.current = name;
    setDoc({ name, pdf });
    setFillable(fields);
    setFieldValues({});
    setNotes([]);
    setFilling(false);
    setPlacing(false);
    const clamped = Math.min(Math.max(1, atPage), pdf.numPages);
    setPage(clamped);
    setSelected([]);
    setScrollRequest((value) => value + 1);
    await previous?.destroy();
  }, []);

  const loadBytes = useCallback(
    async (name: string, bytes: Uint8Array) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        past.current = [];
        setCanUndo(false);
        setDirty(false);
        setPresenting(false);
        await show(name, bytes, 1);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Quill couldn't open that PDF.");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [show],
  );

  const requestOpen = useCallback(
    (name: string, bytes: Uint8Array) => {
      if (dirty) {
        setPending({ name, bytes });
        return;
      }
      void loadBytes(name, bytes);
    },
    [dirty, loadBytes],
  );

  const readFile = useCallback(
    async (file: File) => {
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        toast.error("Choose a PDF.");
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      requestOpen(file.name, bytes);
    },
    [requestOpen],
  );

  const edit = useCallback(
    async (run: (bytes: Uint8Array) => Promise<Uint8Array>, atPage?: number) => {
      const bytes = bytesRef.current;
      if (!bytes || busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      try {
        const next = await run(bytes);
        past.current = [...past.current, bytes].slice(-8);
        setCanUndo(true);
        setDirty(true);
        await show(nameRef.current, next, atPage ?? pageRef.current);
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "That change didn't apply.");
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [show],
  );

  const chosen = useCallback(() => {
    return selected.length ? [...selected].sort((a, b) => a - b) : [pageRef.current - 1];
  }, [selected]);

  const undo = useCallback(async () => {
    if (busyRef.current) return;
    const previous = past.current.pop();
    setCanUndo(past.current.length > 0);
    if (!previous) return;
    busyRef.current = true;
    setDirty(past.current.length > 0);
    setBusy(true);
    try {
      await show(nameRef.current, previous, pageRef.current);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't undo that.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [show]);

  const saveCopy = useCallback(async () => {
    const bytes = bytesRef.current;
    if (!bytes || busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      const answers = await fieldsFromValues(pdfRef.current!, fieldValuesRef.current);
      const written = notesRef.current.filter((note) => note.text);
      let next = bytes;
      if (answers.length > 0 || written.length > 0) {
        try {
          next = await applyFill(bytes, answers, written);
        } catch {
          const pdf = pdfRef.current;
          if (!pdf) throw new Error("Quill couldn't write this PDF directly.");
          next = await rasterStamp(pdf, answers, written);
        }
      } else {
        next = await flattenDocument(bytes);
      }
      const saved = await deliverBytes(next, nameRef.current);
      if (!saved) return false;
      past.current = [];
      setCanUndo(false);
      if (next !== bytes) await show(nameRef.current, next, pageRef.current);
      setDirty(false);
      toast.success("Saved a copy.");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save a copy.");
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [show]);

  const printCurrent = useCallback(() => {
    const bytes = bytesRef.current;
    if (!bytes) return;
    printPdf(bytes);
  }, []);

  const extract = useCallback(async () => {
    const bytes = bytesRef.current;
    if (!bytes || busyRef.current) return;
    const indices = chosen();
    busyRef.current = true;
    setBusy(true);
    try {
      const out = await extractPages(bytes, indices);
      const label = pageListLabel(indices.map((index) => index + 1));
      const saved = await deliverBytes(out, `${nameRef.current.replace(/\.pdf$/i, "")} (pages ${label}).pdf`);
      if (!saved) return;
      toast.success(
        desktopShell
          ? "Extracted pages saved. This document was not changed."
          : "Extracted pages downloaded. This document was not changed.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't extract those pages.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [chosen]);

  const onZoom = useCallback((factor: number) => {
    setZoom((value) => Math.min(3, Math.max(0.5, value * factor)));
  }, []);

  const onSpyPage = useCallback((next: number) => {
    setPage((current) => (current === next ? current : next));
  }, []);

  const enterPresent = useCallback(() => {
    setPresenting(true);
    setScrollRequest((value) => value + 1);
  }, []);

  const leavePresent = useCallback(() => {
    setPresenting(false);
    setScrollRequest((value) => value + 1);
  }, []);

  const enterFill = useCallback(() => {
    if (presentingRef.current) setPresenting(false);
    fillView.current = { mode, zoom };
    setMode("fit-page");
    setZoom(1);
    setFilling(true);
    setScrollRequest((value) => value + 1);
  }, [mode, zoom]);

  const leaveFill = useCallback(() => {
    const prior = fillView.current;
    fillView.current = null;
    if (prior) {
      setMode(prior.mode);
      setZoom(prior.zoom);
    }
    setFilling(false);
    setPlacing(false);
    setScrollRequest((value) => value + 1);
  }, []);

  const placeNote = useCallback((pageNumber: number, x: number, y: number) => {
    const id = crypto.randomUUID();
    setNotes((current) => [...current, { id, page: pageNumber, x, y, text: "", size: NOTE_SIZE, width: NOTE_WIDTH, height: NOTE_HEIGHT }]);
    setFocusNote(id);
    setPlacing(false);
    setDirty(true);
  }, []);

  const closeDoc = useCallback(() => {
    genRef.current += 1;
    const previous = pdfRef.current;
    pdfRef.current = null;
    bytesRef.current = null;
    past.current = [];
    setDoc(null);
    setFillable(false);
    setFilling(false);
    setPlacing(false);
    setFieldValues({});
    setNotes([]);
    setSelected([]);
    setDirty(false);
    setCanUndo(false);
    setPresenting(false);
    setPage(1);
    setPending(null);
    setLeaving(false);
    void previous?.destroy();
  }, []);

  const requestClose = useCallback(() => {
    if (!doc) return;
    if (dirty) {
      setLeaving(true);
      return;
    }
    closeDoc();
  }, [closeDoc, dirty, doc]);

  const pen = PENS.find((item) => item.id === penId) ?? PENS[3];

  const addStroke = useCallback((stroke: InkStroke) => {
    setStrokes((current) => [...current, stroke]);
  }, []);

  useEffect(() => {
    if (presenting) return;
    setInking(false);
    setStrokes([]);
  }, [presenting]);

  useEffect(() => {
    setPageText(String(page));
  }, [page]);

  useEffect(() => {
    document.title = doc ? `${dirty ? "• " : ""}${doc.name} — Quill` : "Quill";
  }, [doc, dirty]);

  const requestOpenRef = useRef(requestOpen);
  requestOpenRef.current = requestOpen;

  useEffect(() => {
    if (!desktopShell) return;
    let stop = () => {};
    let cancelled = false;
    void listenForOpenedPdfs((name, bytes) => {
      requestOpenRef.current(name, bytes);
    })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : "Couldn't open that PDF.");
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  useEffect(() => {
    if (shouldPromptForDefaultApps()) setAskDefaultApps(true);
  }, []);

  const onUpdate = useCallback(async () => {
    if (!desktopShell || updating) return;
    setUpdating(true);
    try {
      const result = await checkAndInstallUpdate();
      if (result === "none") toast.success("Quill is up to date.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't check for an update.");
    } finally {
      setUpdating(false);
    }
  }, [updating]);

  const finishDefaultApps = useCallback((openSettings: boolean) => {
    dismissDefaultAppsPrompt();
    setAskDefaultApps(false);
    if (!openSettings) return;
    void openDefaultApps().catch((error) => {
      toast.error(error instanceof Error ? error.message : "Couldn't open Windows default app settings.");
    });
  }, []);

  useEffect(() => {
    const onBefore = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [dirty]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target?.closest("input, textarea, select, [contenteditable='true']"));
      const meta = event.metaKey || event.ctrlKey;
      if (event.key === "Escape" && fillingRef.current) {
        event.preventDefault();
        if (typing) {
          (target as HTMLElement | null)?.blur();
          return;
        }
        if (placingRef.current) {
          setPlacing(false);
          return;
        }
        leaveFill();
        return;
      }
      if (event.key === "Escape" && presentingRef.current) {
        event.preventDefault();
        leavePresent();
        return;
      }
      if (presentingRef.current && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
        event.preventDefault();
        const delta = event.key === "ArrowRight" ? 1 : -1;
        goTo(Math.min(numPages, Math.max(1, pageRef.current + delta)));
        return;
      }
      if (meta && event.key.toLowerCase() === "p") {
        event.preventDefault();
        printCurrent();
        return;
      }
      if (meta && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveCopy();
        return;
      }
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void undo();
        return;
      }
      if (typing || !doc || presentingRef.current || fillingRef.current) return;
      if (event.key === "f") {
        setMode("fit-page");
        setZoom(1);
      } else if (event.key === "w") {
        setMode("fit-width");
        setZoom(1);
      } else if (event.key === "r" && event.shiftKey) {
        void edit((bytes) => rotatePages(bytes, chosen(), -90));
      } else if (event.key === "r") {
        void edit((bytes) => rotatePages(bytes, chosen(), 90));
      } else if (event.key === "ArrowRight" || event.key === "PageDown") {
        if (mode === "fit-page") goTo(Math.min(numPages, pageRef.current + 1));
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        if (mode === "fit-page") goTo(Math.max(1, pageRef.current - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chosen, doc, edit, goTo, leaveFill, leavePresent, mode, numPages, printCurrent, saveCopy, undo]);

  return (
    <div
      className="quire"
      data-drag={dragging || undefined}
      data-present={presenting || undefined}
      data-fill={filling || undefined}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) void readFile(file);
      }}
    >
      {filling ? (
        <>
          <div className="q-markers">
            <button
              type="button"
              className="q-float"
              aria-label="Add a text box"
              aria-pressed={placing}
              data-on={placing || undefined}
              title="Add a text box"
              onClick={() => setPlacing((value) => !value)}
            >
              <Type size={22} strokeWidth={1.5} />
            </button>
          </div>
          <button type="button" className="q-fill-save" disabled={busy} onClick={() => void saveCopy()}>
            Save a copy
          </button>
          <button type="button" className="q-exit" aria-label="Leave forms" onClick={leaveFill}>
            <X size={22} strokeWidth={1.5} />
          </button>
        </>
      ) : presenting ? (
        <>
          <div className="q-markers">
            <button
              type="button"
              className="q-float"
              aria-label="Mark up"
              aria-pressed={inking}
              data-on={inking || undefined}
              style={{ color: pen.color }}
              onClick={() => setInking((value) => !value)}
            >
              <MarkerIcon color={pen.color} highlighter={pen.highlighter} />
            </button>
            <div className="q-marker-colors">
              {PENS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="q-float"
                  aria-label={item.label}
                  data-on={penId === item.id || undefined}
                  style={{ color: item.color }}
                  onClick={() => {
                    setPenId(item.id);
                    setInking(true);
                  }}
                >
                  <MarkerIcon color={item.color} highlighter={item.highlighter} />
                </button>
              ))}
              <button type="button" className="q-float" aria-label="Erase all markups" onClick={() => setStrokes([])}>
                <EraserIcon />
              </button>
            </div>
          </div>
          <button type="button" className="q-exit" aria-label="Leave presentation" onClick={leavePresent}>
            <X size={22} strokeWidth={1.5} />
          </button>
        </>
      ) : (
        <header className="q-bar">
          <div className="q-brand">
            {doc ? (
              <button type="button" className="q-brand-hit" onClick={requestClose} aria-label="Close this PDF">
                <img className="q-logo" src={appUrl("/quill-logo.png")} alt="" />
              </button>
            ) : (
              <img className="q-logo" src={appUrl("/quill-logo.png")} alt="Quill" />
            )}
          </div>
          {doc ? (
            <div className="q-file">
              <strong title={doc.name}>{doc.name}</strong>
              {dirty ? <span className="q-muted">Unsaved</span> : null}
            </div>
          ) : null}
          <div className="q-actions">
            <button type="button" className="q-btn" onClick={() => openRef.current?.click()}>
              <FolderOpen {...icon} />
              Open
            </button>
            {desktopShell && !doc ? (
              <button type="button" className="q-btn" disabled={updating} onClick={() => void onUpdate()}>
                {updating ? "Checking…" : "Update"}
              </button>
            ) : null}
            {doc ? (
              <>
                <span className="q-group">
                  <button
                    type="button"
                    className="q-btn"
                    disabled={busy}
                    onClick={() => {
                      setInsertBefore(Math.min(numPages + 1, page + 1));
                      setInsertOpen(true);
                    }}
                  >
                    Insert
                  </button>
                  <button type="button" className="q-btn" disabled={busy} onClick={() => void extract()}>
                    <FileOutput {...icon} />
                    Extract
                  </button>
                  <button
                    type="button"
                    className="q-btn icon"
                    disabled={busy || numPages < 2}
                    title="Remove selected pages"
                    aria-label="Remove selected pages"
                    onClick={() => {
                      const indices = chosen();
                      const removedBefore = indices.filter((index) => index < pageRef.current - 1).length;
                      void edit((bytes) => removePages(bytes, indices), pageRef.current - removedBefore);
                    }}
                  >
                    <Trash2 {...icon} />
                  </button>
                </span>
                <span className="q-group">
                  <button
                    type="button"
                    className="q-btn icon"
                    disabled={busy}
                    title="Rotate left"
                    aria-label="Rotate left"
                    onClick={() => void edit((bytes) => rotatePages(bytes, chosen(), -90))}
                  >
                    <RotateCcw {...icon} />
                  </button>
                  <button
                    type="button"
                    className="q-btn icon"
                    disabled={busy}
                    title="Rotate right"
                    aria-label="Rotate right"
                    onClick={() => void edit((bytes) => rotatePages(bytes, chosen(), 90))}
                  >
                    <RotateCw {...icon} />
                  </button>
                  <button
                    type="button"
                    className="q-btn icon"
                    disabled={!canUndo || busy}
                    title="Undo"
                    aria-label="Undo"
                    onClick={() => void undo()}
                  >
                    <Undo2 {...icon} />
                  </button>
                </span>
                <span className="q-group">
                  <button
                    type="button"
                    className="q-btn"
                    data-on={mode === "fit-page" || undefined}
                    title="Fit page (F)"
                    onClick={() => {
                      setMode("fit-page");
                      setZoom(1);
                    }}
                  >
                    <Maximize {...icon} />
                    Fit page
                  </button>
                  <button
                    type="button"
                    className="q-btn"
                    data-on={mode === "fit-width" && zoom === 1 && !presenting ? true : undefined}
                    title="Fit width (W)"
                    onClick={() => {
                      setMode("fit-width");
                      setZoom(1);
                    }}
                  >
                    Fit width
                  </button>
                  <button type="button" className="q-btn icon" aria-label="Zoom out" onClick={() => onZoom(1 / 1.1)}>
                    <Minus {...icon} />
                  </button>
                  <button type="button" className="q-btn icon" aria-label="Zoom in" onClick={() => onZoom(1.1)}>
                    <Plus {...icon} />
                  </button>
                </span>
                <span className="q-group">
                  <span className="q-page-field">
                    <button
                      type="button"
                      className="q-btn icon"
                      aria-label="Previous page"
                      disabled={page <= 1}
                      onClick={() => goTo(page - 1)}
                    >
                      <ChevronLeft {...icon} />
                    </button>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const next = Number(pageText);
                        if (Number.isFinite(next)) goTo(Math.min(numPages, Math.max(1, next)));
                        else setPageText(String(page));
                      }}
                    >
                      <input
                        className="q-page-input"
                        inputMode="numeric"
                        aria-label="Page number"
                        value={pageText}
                        onChange={(event) => setPageText(event.target.value.replace(/\D/g, ""))}
                      />
                    </form>
                    <span>of {numPages}</span>
                    <button
                      type="button"
                      className="q-btn icon"
                      aria-label="Next page"
                      disabled={page >= numPages}
                      onClick={() => goTo(page + 1)}
                    >
                      <ChevronRight {...icon} />
                    </button>
                  </span>
                  <button type="button" className="q-btn" onClick={enterFill}>
                    Forms
                  </button>
                  <button type="button" className="q-btn" onClick={enterPresent}>
                    Present
                  </button>
                  <button type="button" className="q-btn" disabled={busy} title="Print (Ctrl+P)" onClick={printCurrent}>
                    <Printer {...icon} />
                    Print
                  </button>
                  <button type="button" className="q-btn primary" disabled={busy} onClick={saveCopy}>
                    <Download {...icon} />
                    Save a copy
                  </button>
                </span>
              </>
            ) : null}
          </div>
          {fillable ? (
            <p className="q-form-note">
              This PDF has fillable fields. Use Forms to type on the page. Save a copy to keep it.
            </p>
          ) : null}
        </header>
      )}

      {doc ? (
        <div className="q-body">
          {presenting || filling ? null : (
            <Sidebar
              pdf={doc.pdf}
              numPages={numPages}
              page={page}
              selected={selected}
              onSelect={(index, event) => {
                goTo(index + 1);
                setSelected((current) => {
                  if (event.shiftKey) {
                    const start = Math.min(anchor.current, index);
                    const end = Math.max(anchor.current, index);
                    return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
                  }
                  if (event.metaKey || event.ctrlKey) {
                    return current.includes(index)
                      ? current.filter((value) => value !== index)
                      : [...current, index].sort((a, b) => a - b);
                  }
                  anchor.current = index;
                  return [index];
                });
                if (!event.shiftKey && !event.metaKey && !event.ctrlKey) anchor.current = index;
              }}
              onMove={(from, to) => void edit((bytes) => movePage(bytes, from, to), to + 1)}
            />
          )}
          <Stage
            pdf={doc.pdf}
            page={page}
            mode={mode}
            zoom={zoom}
            scrollRequest={scrollRequest}
            scrollBlock={presenting ? "start" : "nearest"}
            ink={
              presenting
                ? { active: inking, pen: { color: pen.color, width: pen.width, alpha: pen.alpha }, strokes, onCommit: addStroke }
                : null
            }
            fill={
              filling
                ? {
                    placing,
                    focusId: focusNote,
                    values: fieldValues,
                    notes,
                    onValue: (id, value) => {
                      setFieldValues((current) => ({ ...current, [id]: value }));
                      setDirty(true);
                    },
                    onPlace: placeNote,
                    onNoteText: (id, text) => {
                      setNotes((current) => current.map((note) => (note.id === id ? { ...note, text } : note)));
                      setDirty(true);
                    },
                    onNoteMove: (id, x, y) => {
                      setNotes((current) => current.map((note) => (note.id === id ? { ...note, x, y } : note)));
                    },
                    onNoteResize: (id, width, height) => {
                      setNotes((current) => current.map((note) => (note.id === id ? { ...note, width, height } : note)));
                    },
                    onNoteRemove: (id) => setNotes((current) => current.filter((note) => note.id !== id)),
                  }
                : null
            }
            onPage={onSpyPage}
            onZoom={onZoom}
          />
        </div>
      ) : (
        <main className="q-welcome">
          <div className="q-welcome-row">
            <img className="q-logo q-logo-hero" src={appUrl("/quill-logo.png")} alt="" />
            <button type="button" className="q-btn primary" onClick={() => openRef.current?.click()}>
              <FolderOpen {...icon} />
              Open a PDF
            </button>
          </div>
        </main>
      )}

      <input
        ref={openRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void readFile(file);
        }}
      />

      <InsertDialog
        open={insertOpen}
        numPages={numPages}
        defaultBefore={insertBefore}
        busy={busy}
        onClose={() => setInsertOpen(false)}
        onInsert={(bytes, indices, beforeIndex) => {
          void edit((current) => insertPages(current, bytes, indices, beforeIndex), beforeIndex + 1).then((ok) => {
            if (ok) {
              toast.success(`Inserted ${indices.length} ${indices.length === 1 ? "page" : "pages"}.`);
              setInsertOpen(false);
            }
          });
        }}
      />

      <Dialog.Root open={leaving} onOpenChange={(next) => !next && setLeaving(false)}>
        <Dialog.Portal>
          <Dialog.Overlay className="q-overlay" />
          <Dialog.Content className="q-dialog">
            <Dialog.Title asChild>
              <h2>Save a copy first?</h2>
            </Dialog.Title>
            <Dialog.Description>This PDF has changes that are not in a saved copy.</Dialog.Description>
            <div className="q-dialog-actions">
              <button type="button" className="q-btn" onClick={() => setLeaving(false)}>
                Keep editing
              </button>
              <button type="button" className="q-btn" onClick={closeDoc}>
                Close without saving
              </button>
              <button
                type="button"
                className="q-btn primary"
                onClick={() => {
                  void saveCopy().then((saved) => {
                    if (saved) closeDoc();
                  });
                }}
              >
                Save a copy
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={pending !== null} onOpenChange={(next) => !next && setPending(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="q-overlay" />
          <Dialog.Content className="q-dialog">
            <Dialog.Title asChild>
              <h2>Discard unsaved changes?</h2>
            </Dialog.Title>
            <Dialog.Description>The PDF you have open has edits that are not in a saved copy.</Dialog.Description>
            <div className="q-dialog-actions">
              <button type="button" className="q-btn" onClick={() => setPending(null)}>
                Keep editing
              </button>
              <button
                type="button"
                className="q-btn"
                data-on="true"
                onClick={() => {
                  const next = pending;
                  setPending(null);
                  if (next) void loadBytes(next.name, next.bytes);
                }}
              >
                Discard
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={askDefaultApps} onOpenChange={(next) => !next && finishDefaultApps(false)}>
        <Dialog.Portal>
          <Dialog.Overlay className="q-overlay" />
          <Dialog.Content className="q-dialog">
            <Dialog.Title asChild>
              <h2>Choose how PDFs open</h2>
            </Dialog.Title>
            <Dialog.Description>
              Quill is in the Open with list. It does not change your default PDF app. If you want PDFs to
              open in Quill, choose it in Windows default apps.
            </Dialog.Description>
            <div className="q-dialog-actions">
              <button type="button" className="q-btn" onClick={() => finishDefaultApps(false)}>
                Not now
              </button>
              <button type="button" className="q-btn primary" onClick={() => finishDefaultApps(true)}>
                Open default app settings
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Toaster position="bottom-center" toastOptions={{ className: "q-toast" }} />
    </div>
  );
}

function MarkerIcon({ color, highlighter }: { color: string; highlighter: boolean }) {
  if (highlighter) {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <g transform="rotate(-42 12 12)">
          <rect x="4.5" y="3" width="15" height="11" rx="1.2" fill={color} stroke="#1B2330" strokeWidth="1" />
          <rect x="4.5" y="11.2" width="15" height="2.2" fill="#1B2330" opacity="0.35" />
          <path d="M6 13.4h12l-1.4 5.2h-9.2z" fill={color} stroke="#1B2330" strokeWidth="1" />
        </g>
      </svg>
    );
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <g transform="rotate(-42 12 12)">
        <rect x="8" y="2.2" width="8" height="12.4" rx="1.5" fill={color} />
        <rect x="8" y="11.4" width="8" height="2" fill="#1B2330" opacity="0.3" />
        <path d="M9.1 13.4h5.8L12 21z" fill={color} />
      </g>
    </svg>
  );
}

function EraserIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <g transform="rotate(-42 12 12)">
        <rect x="5" y="8" width="14" height="8" rx="1.2" fill="#F3C1BC" stroke="#1B2330" strokeWidth="1.2" />
        <path d="M5 12.2h14" stroke="#1B2330" strokeWidth="1" />
      </g>
    </svg>
  );
}

function pdfBlob(bytes: Uint8Array) {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type: "application/pdf" });
}

async function deliverBytes(bytes: Uint8Array, filename: string): Promise<boolean> {
  if (!desktopShell) {
    downloadBytes(bytes, filename);
    return true;
  }
  return savePdfWithDialog(bytes, filename);
}

function downloadBytes(bytes: Uint8Array, filename: string) {
  const url = URL.createObjectURL(pdfBlob(bytes));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

let printFrame: HTMLIFrameElement | null = null;
let printUrl: string | null = null;

function printPdf(bytes: Uint8Array) {
  if (printFrame) {
    printFrame.remove();
    if (printUrl) URL.revokeObjectURL(printUrl);
  }
  printUrl = URL.createObjectURL(pdfBlob(bytes));
  const frame = document.createElement("iframe");
  frame.className = "q-print-frame";
  frame.title = "Print";
  frame.src = printUrl;
  printFrame = frame;
  document.body.appendChild(frame);
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) {
      window.open(printUrl ?? "", "_blank", "noopener");
      return;
    }
    win.addEventListener(
      "afterprint",
      () => {
        frame.remove();
        if (printFrame === frame) printFrame = null;
      },
      { once: true },
    );
    win.focus();
    win.print();
  };
}
