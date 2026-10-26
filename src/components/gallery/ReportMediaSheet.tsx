import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { keepTabInside, useInertBackground } from "@/hooks/useModalLayer";
import { useSheetKeys } from "@/components/gallery/GalleryConfirmSheet";
import { isConnectionError, isOffline } from "@/utils/writeTimeout";
import { GALLERIA } from "@/copy/galleria";
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
  const layerRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useInertBackground(layerRef);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheetRef.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const [reason, setReason] = useState<GalleryReportReason>("mine");
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const cancel = () => { if (!sendingRef.current) onCancel(); };
  const [error, setError] = useState<string | null>(null);
  const noun = mediaType === "video" ? "questo video" : "questa foto";
  // Esc chiude il foglio, non il lightbox sotto.
  useSheetKeys(cancel);

  async function submit() {
    if (sendingRef.current) return;
    if (isOffline()) { setError(GALLERIA.erroreRete); return; }
    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      await onConfirm(reason);
    } catch (caughtError) {
      setError(isConnectionError(caughtError) ? GALLERIA.erroreRete : "Segnalazione non inviata. Riprova.");
      sendingRef.current = false;
      setSending(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="ag-sheet-layer" role="dialog" aria-modal="true" aria-labelledby="ag-report-title" ref={layerRef}>
      <button type="button" className="ag-sheet-scrim" aria-hidden="true" tabIndex={-1} onClick={cancel} />
      <div className="ag-sheet" ref={sheetRef} tabIndex={-1} onKeyDown={event => keepTabInside(event, sheetRef.current)}>
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
                disabled={sending}
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
        <button type="button" className="ag-btn ag-btn--ghost" onClick={cancel} disabled={sending}>
          Annulla
        </button>
      </div>
    </div>,
    document.body,
  );
}
