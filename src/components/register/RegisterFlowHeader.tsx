import type { ReactNode } from "react";

import { AppIcon } from "@/components/AppIcon";
import { PERCORSO } from "@/copy/percorso";
import type { RegisterFor } from "@/utils/registerFlow";

import "@/styles/registerFlow.css";

interface RegisterFlowHeaderProps {
  eventTitle: string;
  eventDates: string;
  // "Per: te · Cambia" in ogni passo dopo "Chi partecipa?" (null: le date).
  per: RegisterFor | null;
  onChangePer?: () => void;
  onBack: () => void;
  // Chi sta usando l'account, prima di scegliere (telefono di famiglia):
  // "Sei entrato come … · Cambia account", "Partecipi tu: … · Non sei …?".
  identity?: {
    text: ReactNode;
    // Prima dell'azione: "Non sei Marco?".
    prompt?: string;
    actionLabel: string;
    onAction: () => void;
    // Sotto, per un account appena creato: "Il tuo account resta…".
    note?: string | null;
  } | null;
  onSignOut?: () => void;
  // Riga sola sotto la barra, senza "Sei entrato come".
  note?: string | null;
  // Percorso in tre tappe: indice della tappa attiva, null per nasconderlo.
  progress?: { index: number; labels: readonly [string, string, string] } | null;
  busy?: boolean;
}

// Intestazione dei passi dell'iscrizione (docs/FLUSSO_GENITORE.md, B-F): la
// freccia torna al passo prima, l'attività resta in vista, "Per: … · Cambia"
// riporta a "Chi partecipa?" fino all'invio.
export function RegisterFlowHeader({
  eventTitle,
  eventDates,
  per,
  onChangePer,
  onBack,
  identity,
  onSignOut,
  note,
  progress,
  busy = false,
}: RegisterFlowHeaderProps) {
  return (
    <header className="flow-header">
      <div className="flow-topbar">
        <button
          aria-label={PERCORSO.indietro}
          className="flow-topbar__back"
          disabled={busy}
          onClick={onBack}
          type="button"
        >
          <AppIcon name="arrow-left" />
        </button>
        <span className="flow-topbar__eyebrow">{PERCORSO.eyebrow}</span>
        {onSignOut ? (
          <button className="flow-topbar__link" disabled={busy} onClick={onSignOut} type="button">
            {PERCORSO.esci}
          </button>
        ) : (
          <span aria-hidden="true" className="flow-topbar__spacer" />
        )}
      </div>

      {identity ? (
        <div className="flow-signed-in">
          <p>
            {identity.text}
            {" · "}
            {identity.prompt ? `${identity.prompt} ` : null}
            <button
              className="flow-signed-in__switch"
              disabled={busy}
              onClick={identity.onAction}
              type="button"
            >
              {identity.actionLabel}
            </button>
          </p>
          {identity.note ? <p className="flow-signed-in__note">{identity.note}</p> : null}
        </div>
      ) : note ? (
        <p className="flow-header__note">{note}</p>
      ) : null}

      <div className="flow-context">
        <span aria-hidden="true" className="flow-context__mark">
          <AppIcon name="ticket" />
        </span>
        <span className="flow-context__text">
          <strong>{eventTitle}</strong>
          <span>{per ? (per === "io" ? PERCORSO.perTe : PERCORSO.perFiglio) : eventDates}</span>
        </span>
        {per && onChangePer ? (
          <button
            aria-label={PERCORSO.cambiaPerChi}
            className="flow-context__change"
            disabled={busy}
            onClick={onChangePer}
            type="button"
          >
            {PERCORSO.cambia}
          </button>
        ) : null}
      </div>

      {progress ? (
        <ol className="flow-progress">
          {progress.labels.map((label, index) => (
            <li
              aria-current={index === progress.index ? "step" : undefined}
              className={
                index === progress.index
                  ? "flow-progress__item flow-progress__item--current"
                  : index < progress.index
                    ? "flow-progress__item flow-progress__item--done"
                    : "flow-progress__item"
              }
              key={label}
            >
              <span aria-hidden="true" className="flow-progress__bar" />
              <span className="flow-progress__label">{label}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </header>
  );
}
