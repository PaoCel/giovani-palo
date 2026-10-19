import { useState } from "react";
import { createPortal } from "react-dom";

import { useSheetKeys } from "@/components/gallery/GalleryConfirmSheet";
import type { GalleryMediaType, GalleryReportReason } from "@/types";

interface ReportMediaSheetProps {
  mediaType: GalleryMediaType;
  onCancel: () => void;
  onConfirm: (reason: GalleryReportReason) => Promise<void>;
}

const REASONS: { key: GalleryReportReason; label: string }[] = [
  { key: "mine", label: "Ci sono io e non voglio che si veda" },
  { key: "inappropriate", label: "Non è adatta" },
  { key: "off_topic", label: "Non c'entra con l'attività" },
];

export function ReportMediaSheet({ mediaType, onCancel, onConfirm }: ReportMediaSheetProps) {
  const [reason, setReason] = useState<GalleryReportReason>("mine");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noun = mediaType === "video" ? "questo video" : "questa foto";
  // Esc chiude il foglio, non il lightbox sotto.
  useSheetKeys(onCancel);

  async function submit() {
    setSending(true);
    setError(null);
    try {
      await onConfirm(reason);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error && caughtError.message
          ? caughtError.message
          : "Segnalazione non inviata. Riprova.",
      );
      setSending(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="ag-sheet-layer" role="dialog" aria-modal="true" aria-labelledby="ag-report-title">
      <button type="button" className="ag-sheet-scrim" aria-label="Annulla" onClick={onCancel} />
      <div className="ag-sheet">
        <span className="ag-sheet__grab" aria-hidden="true" />
        <h3 id="ag-report-title">Segnalare {noun}?</h3>
        <p>La nascondiamo subito a tutti. Un responsabile la controlla e decide se toglierla.</p>
        <div className="ag-reasons" role="radiogroup">
          {REASONS.map((entry) => (
            <label
              key={entry.key}
              className={`ag-reason${reason === entry.key ? " ag-reason--on" : ""}`}
            >
              <input
                type="radio"
                name="ag-report-reason"
                value={entry.key}
                checked={reason === entry.key}
                onChange={() => setReason(entry.key)}
              />
              <span className="ag-reason__dot" aria-hidden="true" />
              {entry.label}
            </label>
          ))}
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <button
          type="button"
          className="ag-btn ag-btn--danger"
          onClick={() => void submit()}
          disabled={sending}
        >
          {sending ? "Invio…" : "Segnala e nascondi"}
        </button>
        <button type="button" className="ag-btn ag-btn--ghost" onClick={onCancel}>
          Annulla
        </button>
      </div>
    </div>,
    document.body,
  );
}
