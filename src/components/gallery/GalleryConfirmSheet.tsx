import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { GALLERIA } from "@/copy/galleria";
import type { GalleryMediaType } from "@/types";
// Si apre anche dal lightbox della home, dove la galleria non è caricata.
import "@/styles/activityGallery.css";

interface GalleryConfirmSheetProps {
  title: string;
  body: string;
  // La scelta sicura viene prima; chiudere il foglio vale come "tieni".
  cancelLabel: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

// Il foglio si apre sopra il lightbox, che ascolta Esc e le frecce su
// document: li intercetta prima (fase di cattura su window), così Esc chiude
// solo il foglio e le frecce non cambiano foto sotto di lui.
export function useSheetKeys(onCancel: () => void) {
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancelRef.current();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.stopPropagation();
      }
    }

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

// Conferma dentro la pagina al posto di window.confirm (docs/FLUSSO_GENITORE.md:
// mai un dialogo del browser), nello stile del foglio "Segnala" della galleria.
export function GalleryConfirmSheet({
  title,
  body,
  cancelLabel,
  confirmLabel,
  busy = false,
  error,
  onCancel,
  onConfirm,
}: GalleryConfirmSheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const cancel = () => {
    if (!busy) onCancel();
  };
  useSheetKeys(cancel);

  // Focus al foglio all'apertura, di nuovo al pulsante "Elimina" alla chiusura.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheetRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="ag-sheet-layer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ag-confirm-title"
    >
      <button
        type="button"
        className="ag-sheet-scrim"
        aria-label={cancelLabel}
        onClick={cancel}
      />
      <div className="ag-sheet" ref={sheetRef} tabIndex={-1}>
        <span className="ag-sheet__grab" aria-hidden="true" />
        <h3 id="ag-confirm-title">{title}</h3>
        <p>{body}</p>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="ag-sheet__actions">
          <button type="button" className="ag-btn ag-btn--primary" onClick={cancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className="ag-btn ag-btn--danger" onClick={onConfirm} disabled={busy}>
            {busy ? GALLERIA.eliminazione : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Testi del foglio per eliminare una foto o un video.
export function getDeleteMediaCopy(type: GalleryMediaType) {
  return type === "video"
    ? {
        title: GALLERIA.eliminaVideoTitolo,
        cancelLabel: GALLERIA.tieniVideo,
        confirmLabel: GALLERIA.confermaEliminaVideo,
      }
    : {
        title: GALLERIA.eliminaFotoTitolo,
        cancelLabel: GALLERIA.tieniFoto,
        confirmLabel: GALLERIA.confermaEliminaFoto,
      };
}
