import type { ReactNode } from "react";

import { RecordNightIcon, type RecordNightIconName } from "@/components/recordNight/RecordNightIcon";

export function RecordNightLoading({ label }: { label: string }) {
  return (
    <p className="rn-loading" role="status">
      <i aria-hidden="true" className="rn-led" />
      {label}
    </p>
  );
}

// Card d'invito dentro la pagina: accesso, iscrizione all'attività.
export function RecordNightGate({
  title,
  text,
  action,
  icon,
}: {
  title: string;
  text: string;
  action: ReactNode;
  icon: RecordNightIconName;
}) {
  return (
    <section className="rn-gate">
      <span aria-hidden="true" className="rn-gate__ico">
        <RecordNightIcon name={icon} />
      </span>
      <h2 className="rn-gate__title">{title}</h2>
      <p className="rn-gate__text">{text}</p>
      <div className="rn-gate__action">{action}</div>
    </section>
  );
}

// Pagina senza una Notte dei Record da mostrare (attività inesistente, modulo
// spento, nessuna serata in programma), con la stessa pelle.
export function RecordNightState({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action: ReactNode;
}) {
  return (
    <section className="rn-state">
      <span className="rn-live">
        <i aria-hidden="true" className="rn-led rn-led--off" />
        Notte dei Record
      </span>
      <h1 className="rn-state__title">{title}</h1>
      <p className="rn-state__text">{text}</p>
      <div className="rn-gate__action">{action}</div>
    </section>
  );
}
