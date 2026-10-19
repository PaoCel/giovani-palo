import { useEffect, useRef } from "react";

import { AppIcon } from "@/components/AppIcon";
import dirigenteUrl from "@/assets/flusso-genitore/dirigente.webp";
import genitoreUrl from "@/assets/flusso-genitore/genitore.webp";
import { GUARDIA } from "@/copy/guardia";
import { getAdultGuardSentence } from "@/utils/adultGuard";

import "@/styles/registerFlow.css";

interface AdultGuardCardProps {
  age: number;
  firstDay: Date;
  // Account già esistente (in cima al modulo): l'account non cambia tipo e la
  // data si corregge in «I tuoi dati».
  existingAccount: boolean;
  // In cima al modulo è il titolo della pagina; dentro «I tuoi dati» no.
  headingLevel: "h1" | "h2";
  disabled?: boolean;
  onChooseChild: () => void;
  onChooseAdult: () => void;
  onWrongDate: () => void;
  onConfirm: () => void;
}

// Guardia adulto (docs/FLUSSO_GENITORE.md, G): una scheda nella pagina, mai un
// dialogo del browser, con una strada per ogni risposta. Niente è salvato qui.
export function AdultGuardCard({
  age,
  firstDay,
  existingAccount,
  headingLevel,
  disabled = false,
  onChooseChild,
  onChooseAdult,
  onWrongDate,
  onConfirm,
}: AdultGuardCardProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const sentence = getAdultGuardSentence(age, firstDay);
  const Heading = headingLevel;

  // La scheda compare al posto del passo dopo: lettori di schermo e tastiera
  // ripartono da qui. Sotto la data va anche portata in vista; in cima al
  // modulo la pagina parte già dall'alto.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });

    if (headingLevel === "h2") {
      headingRef.current?.closest(".flow-guard")?.scrollIntoView({ block: "nearest" });
    }
    // Solo alla comparsa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section
      aria-labelledby="flow-guard-title"
      className={headingLevel === "h1" ? "flow-guard flow-guard--page" : "flow-guard"}
    >
      <div className="flow-guard__head">
        <span aria-hidden="true" className="flow-guard__icon">
          <AppIcon name="alert" />
        </span>
        <div>
          <Heading
            className="flow-guard__title"
            id="flow-guard-title"
            ref={headingRef}
            tabIndex={-1}
          >
            {GUARDIA.titolo}
          </Heading>
          <p className="flow-guard__text">
            {sentence.before}
            <strong>{sentence.anni}</strong>
            {sentence.after} {GUARDIA.chiPartecipa}
          </p>
        </div>
      </div>

      <div className="flow-guard__options">
        <button
          className="flow-guard__option"
          disabled={disabled}
          onClick={onChooseChild}
          type="button"
        >
          <span aria-hidden="true" className="flow-guard__thumb">
            <img alt="" height={52} src={genitoreUrl} width={36} />
          </span>
          <span className="flow-guard__label">
            <strong>{GUARDIA.iscrivoFiglio}</strong>
            <span>
              {existingAccount ? GUARDIA.iscrivoFiglioEsistente : GUARDIA.iscrivoFiglioNuovo}
            </span>
          </span>
          <AppIcon className="flow-guard__go" name="arrow-right" />
        </button>
        <button
          className="flow-guard__option"
          disabled={disabled}
          onClick={onChooseAdult}
          type="button"
        >
          <span aria-hidden="true" className="flow-guard__thumb">
            <img alt="" height={52} src={dirigenteUrl} width={36} />
          </span>
          <span className="flow-guard__label">
            <strong>{GUARDIA.dirigente}</strong>
            <span>{GUARDIA.dirigenteDettaglio}</span>
          </span>
          <AppIcon className="flow-guard__go" name="arrow-right" />
        </button>
        <button
          className="flow-guard__option"
          disabled={disabled}
          onClick={onWrongDate}
          type="button"
        >
          <span aria-hidden="true" className="flow-guard__date-icon">
            <AppIcon name="calendar" />
          </span>
          <span className="flow-guard__label">
            <strong>{GUARDIA.dataSbagliata}</strong>
            <span>
              {existingAccount ? GUARDIA.dataSbagliataEsistente : GUARDIA.dataSbagliataDettaglio}
            </span>
          </span>
          <AppIcon className="flow-guard__go" name="arrow-right" />
        </button>
      </div>

      <button className="flow-guard__confirm" disabled={disabled} onClick={onConfirm} type="button">
        {GUARDIA.confermo}
      </button>
    </section>
  );
}
