import { useEffect, useRef } from "react";

import { AppIcon } from "@/components/AppIcon";
import { ChoiceCard } from "@/components/ChoiceCard";
import { CHI_SEI } from "@/copy/chiSei";

import "@/styles/registerFlow.css";

export type ChiSeiChoice = "ragazzo" | "genitore" | "dirigente";

interface ChiSeiPanelProps {
  // La risposta di prima, ritrovata con "Cambia" da "I tuoi dati".
  selected: ChiSeiChoice | null;
  busy?: boolean;
  onChoose: (choice: ChiSeiChoice) => void;
  onSignOut: () => void;
}

// «Chi sei?» dopo un account nuovo creato fuori da un'attività
// (docs/FLUSSO_GENITORE.md, I). Niente freccia indietro: l'account esiste già,
// in alto c'è "Esci". La scelta non scrive niente: decide quali dati chiedere,
// e il tipo di account si salva con "I tuoi dati". Si cambia dopo dal profilo.
// "Dirigente o accompagnatore" non dà permessi: il ruolo lo assegna un admin.
export function ChiSeiPanel({ selected, busy = false, onChoose, onSignOut }: ChiSeiPanelProps) {
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  // Arriva dopo il tocco su "Crea un account" in fondo alla pagina: si
  // riparte dall'alto, con il focus sul titolo.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section className="auth-screen chi-sei">
      <div className="flow-topbar flow-topbar--end">
        <span className="flow-topbar__eyebrow">{CHI_SEI.eyebrow}</span>
        <button className="flow-topbar__link" disabled={busy} onClick={onSignOut} type="button">
          <AppIcon name="logout" />
          <span>{CHI_SEI.esci}</span>
        </button>
      </div>

      <div className="auth-screen__copy">
        <h1 className="auth-screen__title" ref={titleRef} tabIndex={-1}>
          {CHI_SEI.titolo}
        </h1>
        <p className="auth-screen__lead">{CHI_SEI.lead}</p>
      </div>

      <div className="choice-list">
        <ChoiceCard
          compact
          detail={CHI_SEI.ragazzoDettaglio}
          disabled={busy}
          illustration="giovani"
          onSelect={() => onChoose("ragazzo")}
          selected={selected === "ragazzo"}
          title={CHI_SEI.ragazzo}
        />
        <ChoiceCard
          compact
          detail={CHI_SEI.genitoreDettaglio}
          disabled={busy}
          illustration="genitore"
          onSelect={() => onChoose("genitore")}
          selected={selected === "genitore"}
          title={CHI_SEI.genitore}
        />
        <ChoiceCard
          compact
          detail={CHI_SEI.dirigenteDettaglio}
          disabled={busy}
          illustration="dirigente"
          onSelect={() => onChoose("dirigente")}
          selected={selected === "dirigente"}
          title={CHI_SEI.dirigente}
        />
      </div>
    </section>
  );
}

// Sopra "I tuoi dati" dopo «Chi sei?»: la risposta data, con "Cambia".
export function ChiSeiAnswer({
  choice,
  onChange,
}: {
  choice: ChiSeiChoice;
  onChange: () => void;
}) {
  const label =
    choice === "genitore" ? CHI_SEI.genitore : choice === "dirigente" ? CHI_SEI.dirigente : CHI_SEI.ragazzo;

  return (
    <div className="flow-context">
      <span aria-hidden="true" className="flow-context__mark">
        <AppIcon name={choice === "genitore" ? "users" : "user"} />
      </span>
      <span className="flow-context__text">
        <strong>{label}</strong>
      </span>
      <button
        aria-label={CHI_SEI.cambiaScelta}
        className="flow-context__change"
        onClick={onChange}
        type="button"
      >
        {CHI_SEI.cambia}
      </button>
    </div>
  );
}
