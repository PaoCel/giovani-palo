import { AppModal } from "@/components/AppModal";

interface ConfirmSheetProps {
  title: string;
  body: string;
  // La scelta sicura viene prima; chiudere il foglio vale come "annulla".
  cancelLabel: string;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  error?: string | null;
  // "danger" per le azioni che tolgono qualcosa (annullare, eliminare).
  tone?: "neutral" | "danger";
  onCancel: () => void;
  onConfirm: () => void;
}

// Conferma dentro la pagina al posto di window.confirm (docs/FLUSSO_GENITORE.md:
// mai un dialogo del browser, che nel pannello e in alcune PWA non compare).
export function ConfirmSheet({
  title,
  body,
  cancelLabel,
  confirmLabel,
  busyLabel,
  busy = false,
  error,
  tone = "neutral",
  onCancel,
  onConfirm,
}: ConfirmSheetProps) {
  return (
    <AppModal
      footer={
        <div className="family-cancel-actions">
          <button
            className="button button--primary"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className={tone === "danger" ? "button button--danger" : "button button--ghost"}
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy && busyLabel ? busyLabel : confirmLabel}
          </button>
        </div>
      }
      onClose={busy ? () => undefined : onCancel}
      title={title}
    >
      <div className="stack">
        <p className="family-cancel-body">{body}</p>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </AppModal>
  );
}
