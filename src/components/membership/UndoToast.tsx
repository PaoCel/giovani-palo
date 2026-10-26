import { useEffect, useState } from "react";

import { PALO } from "@/copy/palo";

import "@/styles/membership.css";

export interface UndoToastState {
  id: number;
  message: string;
  kind: "undo" | "info" | "error";
  /** Solo per `undo`: disfa l'azione appena fatta. */
  onUndo?: () => Promise<void>;
}

interface UndoToastProps {
  toast: UndoToastState | null;
  onDismiss: () => void;
}

// 5 secondi (docs/APPARTENENZA_AL_PALO.md, «Stati e ritorni»), in pausa
// finché il dito o il focus sono sopra.
const VISIBLE_MS = 5000;

/** Toast dopo un'azione, con "Annulla" che la disfa. */
export function UndoToast({ toast, onDismiss }: UndoToastProps) {
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPaused(false);
    setBusy(false);
  }, [toast?.id]);

  useEffect(() => {
    if (!toast || paused || busy) return undefined;
    const timer = window.setTimeout(onDismiss, VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [busy, onDismiss, paused, toast]);

  async function undo() {
    if (!toast?.onUndo) return;
    setBusy(true);
    try {
      await toast.onUndo();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div aria-live="polite" role="status">
      {toast ? (
        <div
          className={toast.kind === "error" ? "mship-toast mship-toast--error" : "mship-toast"}
          key={toast.id}
          onBlur={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <span className="mship-toast__text">{toast.message}</span>
          {toast.kind === "undo" && toast.onUndo ? (
            <button className="mship-toast__undo" disabled={busy} onClick={() => void undo()} type="button">
              {PALO.annulla}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
