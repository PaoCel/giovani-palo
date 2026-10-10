import { useEffect, useRef, useState } from "react";

import { RecordNightIcon } from "@/components/recordNight/RecordNightIcon";

export interface RecordNightToastState {
  id: number;
  kind: "undo" | "error";
  message: string;
  // Solo per "undo": il tentativo appena ritirato.
  entryId?: string;
}

interface RecordNightToastProps {
  toast: RecordNightToastState | null;
  busy: boolean;
  onUndo: (entryId: string) => void;
  onDismiss: () => void;
}

const VISIBLE_MS = 8000;

// Avviso in basso: "Ritiro fatto: ..." con Annulla, oppure l'errore di
// un'azione. Resta ~8 secondi; il conto si ferma finché ci sono sopra il
// puntatore o il focus, così c'è il tempo di premere Annulla.
export function RecordNightToast({ toast, busy, onUndo, onDismiss }: RecordNightToastProps) {
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(VISIBLE_MS);

  useEffect(() => {
    remainingRef.current = VISIBLE_MS;
    setPaused(false);
  }, [toast?.id]);

  useEffect(() => {
    if (!toast || paused || busy) return;
    const startedAt = Date.now();
    const timer = setTimeout(onDismiss, remainingRef.current);
    return () => {
      clearTimeout(timer);
      remainingRef.current = Math.max(1500, remainingRef.current - (Date.now() - startedAt));
    };
  }, [busy, onDismiss, paused, toast]);

  return (
    <div aria-live="polite" className="rn-toast-region" role="status">
      {toast ? (
        <div
          className={toast.kind === "error" ? "rn-toast rn-toast--error" : "rn-toast"}
          key={toast.id}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
          }}
          onFocus={() => setPaused(true)}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <RecordNightIcon name={toast.kind === "error" ? "alert" : "check"} />
          <p className="rn-toast__text">{toast.message}</p>
          {toast.kind === "undo" && toast.entryId ? (
            <button
              className="rn-toast__action"
              disabled={busy}
              onClick={() => onUndo(toast.entryId as string)}
              type="button"
            >
              Annulla
            </button>
          ) : (
            <button
              aria-label="Chiudi l'avviso"
              className="rn-icon-btn rn-icon-btn--sm"
              onClick={onDismiss}
              type="button"
            >
              <RecordNightIcon name="x" />
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
