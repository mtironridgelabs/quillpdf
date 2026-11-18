import * as Dialog from "@radix-ui/react-dialog";

export type LockedChoice = "fields" | "picture" | "cancel";

export function LockedSaveDialog({
  open,
  canKeepFields,
  onChoose,
}: {
  open: boolean;
  canKeepFields: boolean;
  onChoose: (choice: LockedChoice) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onChoose("cancel")}>
      <Dialog.Portal>
        <Dialog.Overlay className="q-overlay" />
        <Dialog.Content className="q-dialog">
          <Dialog.Title asChild>
            <h2>This PDF is locked</h2>
          </Dialog.Title>
          <Dialog.Description>
            {canKeepFields
              ? "The existing fields can be saved and filled in again. A text box you added cannot become a field, because the lock does not allow new fields. Saving a picture shows the text boxes, but that copy cannot be edited later."
              : "A text box you added cannot become a field. This browser can only save a picture, which shows what you typed but cannot be edited later. The Windows app can keep the existing fields editable and leave the text boxes out."}
          </Dialog.Description>
          <div className="q-dialog-actions">
            <button type="button" className="q-btn" onClick={() => onChoose("cancel")}>
              Keep editing
            </button>
            <button type="button" className="q-btn" data-on={canKeepFields ? undefined : "true"} onClick={() => onChoose("picture")}>
              Save a picture
            </button>
            {canKeepFields ? (
              <button type="button" className="q-btn primary" onClick={() => onChoose("fields")}>
                Save the fields
              </button>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
