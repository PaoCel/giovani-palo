import { useEffect } from "react";
import { useRouteError } from "react-router-dom";

const RELOAD_FLAG = "gugd-chunk-reload";

// Pannello mostrato quando una route va in errore (render o chunk non
// caricato, es. nuova release deployata mentre l'app era aperta).
export function RouteErrorPanel() {
  const error = useRouteError();
  const message =
    error instanceof Error ? error.message : "Si è verificato un errore inatteso.";
  const isChunkError =
    error instanceof Error &&
    /dynamically imported module|Loading chunk|Importing a module script failed/i.test(
      message,
    );

  // Chunk vecchio dopo una release: un reload risolve da solo. Lo facciamo
  // una volta automaticamente (flag in sessionStorage per evitare loop).
  const autoReloading =
    isChunkError &&
    (() => {
      try {
        return !sessionStorage.getItem(RELOAD_FLAG);
      } catch {
        return false;
      }
    })();

  useEffect(() => {
    if (!autoReloading) {
      return;
    }

    try {
      sessionStorage.setItem(RELOAD_FLAG, "1");
      window.location.reload();
    } catch {
      // sessionStorage non disponibile: lasciamo il pannello manuale.
    }
  }, [autoReloading]);

  // Durante il reload automatico niente messaggio d'errore: l'utente vede
  // solo un aggiornamento, non un guasto.
  if (autoReloading) {
    return (
      <div className="loader-panel" role="status" aria-live="polite">
        <h1>Aggiornamento dell&apos;app…</h1>
        <p className="subtle-text">Un attimo, sto caricando la versione più recente.</p>
      </div>
    );
  }

  return (
    <div className="loader-panel" role="alert">
      <h1>Qualcosa è andato storto</h1>
      <p className="subtle-text">
        {isChunkError
          ? "È disponibile una nuova versione dell'app: ricarica la pagina per continuare."
          : message}
      </p>
      <div className="chip-row" style={{ justifyContent: "center" }}>
        <button
          type="button"
          className="button button--primary"
          onClick={() => window.location.reload()}
        >
          Ricarica la pagina
        </button>
        <a className="button button--ghost" href="/">
          Torna alla home
        </a>
      </div>
    </div>
  );
}
