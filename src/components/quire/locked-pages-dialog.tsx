import * as Dialog from "@radix-ui/react-dialog";

export type PageLockChoice = "unlock" | "flatten" | "cancel";

export function LockedPagesDialog({
  open,
  canRelease,
  hasNotes,
  busy,
  onChoose,
}: {
  open: boolean;
  canRelease: boolean;
  hasNotes: boolean;
  busy: boolean;
  onChoose: (choice: PageLockChoice) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && !busy && onChoose("cancel")}>
      <Dialog.Portal>
        <Dialog.Overlay className="q-overlay" />
        <Dialog.Content className="q-dialog">
          <Dialog.Title asChild>
            <h2>This PDF is locked</h2>
          </Dialog.Title>
          <Dialog.Description>
            {canRelease
              ? "Quill can fill the fields, but it can't change the pages while the lock stays on."
              : "This browser can't change the pages or remove the lock. The Windows app can save an unlocked copy, which keeps the fields fillable, or a flattened copy, which paints the answers onto the pages."}
          </Dialog.Description>
          {canRelease ? (
            <p>
              Save an unlocked copy if you still want to fill the fields. Save a flattened copy if you want the
              answers painted onto the pages and the form removed. Either copy can then have its pages changed, and
              Quill opens it after you save. A signature on the original does not carry over.
              {hasNotes ? " Text boxes you added are not included. Add them again after the copy opens." : ""}
            </p>
          ) : null}
          <div className="q-dialog-actions">
            <button type="button" className="q-btn" disabled={busy} onClick={() => onChoose("cancel")}>
              Keep editing
            </button>
            {canRelease ? (
              <>
                <button type="button" className="q-btn" disabled={busy} onClick={() => onChoose("flatten")}>
                  Save a flattened copy
                </button>
                <button type="button" className="q-btn primary" disabled={busy} onClick={() => onChoose("unlock")}>
                  Save an unlocked copy
                </button>
              </>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
