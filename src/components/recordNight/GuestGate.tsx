import { Link } from "react-router-dom";

import { RecordNightIcon } from "@/components/recordNight/RecordNightIcon";

interface GuestGateProps {
  // Accesso con ritorno a questa pagina.
  loginPath: string;
  // Modulo acceso, finestra aperta e interruttore "Record senza account"
  // acceso: compare anche "Segnati con nome e unità". Dopo la chiusura resta
  // solo "Accedi".
  canSignUp: boolean;
  busy: boolean;
  // Riceve il tasto premuto: il foglio gli restituisce il focus alla chiusura
  // (su iPhone e Safari un tocco non dà il focus al tasto).
  onSignUp: (trigger: HTMLElement) => void;
}

// Pagina senza account vero (nessuna sessione, o sessione anonima del telefono):
// "Accedi" è sempre il primo tasto e porta alla pagina di accesso; sotto, la
// strada senza account (docs/NOTTE_DEI_RECORD_SENZA_ACCOUNT.md, UI).
export function GuestGate({ loginPath, canSignUp, busy, onSignUp }: GuestGateProps) {
  return (
    <section aria-labelledby="rn-guest-gate-title" className="rn-gate rn-gate--guest">
      <h2 className="rn-gate__title" id="rn-guest-gate-title">
        Hai un account? Accedi
      </h2>
      <p className="rn-gate__text">Vedi subito i tuoi record e li gestisci anche per i figli.</p>
      <div className="rn-gate__action">
        <Link className="rn-btn rn-btn--led" to={loginPath}>
          <RecordNightIcon name="user" />
          Accedi
        </Link>
      </div>
      <p className="rn-gate__hint">Dopo l'accesso torni a questa pagina.</p>
      {canSignUp ? (
        <div className="rn-gate__alt">
          <p className="rn-gate__alt-label">Non hai l'account?</p>
          <button
            className="rn-btn rn-btn--ghost"
            disabled={busy}
            onClick={(event) => onSignUp(event.currentTarget)}
            type="button"
          >
            <RecordNightIcon name="pencil" />
            Segnati con nome e unità
          </button>
        </div>
      ) : null}
    </section>
  );
}
