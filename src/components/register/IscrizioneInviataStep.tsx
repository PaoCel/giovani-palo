import { useEffect, useId, useRef, type ReactNode } from "react";

import genitoreFigliaUrl from "@/assets/flusso-genitore/genitore-figlia.webp";
import genitoreUrl from "@/assets/flusso-genitore/genitore.webp";
import inviataUrl from "@/assets/flusso-genitore/inviata.webp";
import { AppIcon } from "@/components/AppIcon";
import { INVIATA } from "@/copy/inviata";
import { fillCopy } from "@/copy/parole";
import { PERCORSO } from "@/copy/percorso";
import type { GenderRoleCategory, Registration } from "@/types";
import { getParentEmailAddress, getParentEmailOutcome } from "@/utils/childChoice";

import "@/styles/registerFlow.css";

// WebP a 2× della misura mostrata, con le dimensioni vere: niente salti al
// caricamento (docs/FLUSSO_GENITORE.md, "Illustrazioni").
const ILLUSTRATIONS = {
  genitore: { src: genitoreUrl, height: 345 },
  "genitore-figlia": { src: genitoreFigliaUrl, height: 343 },
  inviata: { src: inviataUrl, height: 333 },
} as const;

interface TimelineStep {
  key: string;
  done?: boolean;
  now?: boolean;
  title: string;
  text: ReactNode;
}

interface IscrizioneInviataStepProps {
  mode: "figlio" | "io";
  // Letta dal vivo: lo stato dell'autorizzazione e l'esito della mail cambiano
  // dopo l'invio (trigger del server, firma in un'altra scheda).
  registration: Registration;
  personName: string;
  personFirstName: string;
  // L'illustrazione segue il gruppo del figlio: mamma con figlio, papà con figlia.
  childGroup?: GenderRoleCategory | "";
  eventTitle: string;
  onClose: () => void;
  // Figlio: "Autorizza ora" (G5), "Iscrivi un altro figlio", "Vai a Famiglia".
  onAuthorize?: () => void;
  authorizing?: boolean;
  authorizeError?: string | null;
  onAnother?: () => void;
  onFamily?: () => void;
  // Io: "Modifica" se la mail al genitore non è partita, e la tua scheda.
  onEdit?: () => void;
  onScheda?: () => void;
  // Io, account adulto che può avere figli (G2, per esempio un dirigente):
  // "Iscrivi tuo figlio o tua figlia" porta a "Chi iscrivi?".
  onChild?: () => void;
}

// "Iscrizione inviata" (docs/FLUSSO_GENITORE.md, H): dice cosa succede dopo,
// con l'esito vero della mail di autorizzazione.
export function IscrizioneInviataStep({
  mode,
  registration,
  personName,
  personFirstName,
  childGroup = "",
  eventTitle,
  onClose,
  onAuthorize,
  authorizing = false,
  authorizeError,
  onAnother,
  onFamily,
  onEdit,
  onScheda,
  onChild,
}: IscrizioneInviataStepProps) {
  const titleId = `${useId()}-title`;
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const outcome = getParentEmailOutcome(registration);
  const email = getParentEmailAddress(registration);
  const pending = outcome !== "none" && outcome !== "authorized";
  const illustration =
    mode === "io"
      ? ILLUSTRATIONS.inviata
      : childGroup === "giovane_donna"
        ? ILLUSTRATIONS["genitore-figlia"]
        : ILLUSTRATIONS.genitore;

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  const dirigenti: TimelineStep = {
    key: "dirigenti",
    done: true,
    title: INVIATA.dirigentiTitolo,
    text: INVIATA.dirigentiTesto,
  };
  const steps: TimelineStep[] = [dirigenti];

  if (mode === "figlio") {
    if (outcome === "authorized") {
      steps.push({
        key: "autorizzata",
        done: true,
        title: INVIATA.autorizzataTitolo,
        text: INVIATA.autorizzataTesto,
      });
    } else if (pending) {
      steps.push({
        key: "autorizzi",
        now: true,
        title: INVIATA.autorizziTitolo,
        text:
          outcome === "self"
            ? INVIATA.riprendiFirma
            : fillCopy(
                outcome === "sent"
                  ? INVIATA.autorizziMandato
                  : outcome === "failed"
                    ? INVIATA.autorizziMailFallita
                    : INVIATA.autorizziInInvio,
                { email },
              ),
      });
    }

    steps.push({
      key: "famiglia",
      title: INVIATA.famigliaTitolo,
      text: INVIATA.famigliaTesto,
    });
  } else {
    if (outcome === "authorized") {
      steps.push({
        key: "genitore",
        done: true,
        title: INVIATA.genitoreTitolo,
        text: INVIATA.autorizzataIo,
      });
    } else if (pending) {
      steps.push({
        key: "genitore",
        now: true,
        title: INVIATA.genitoreTitolo,
        text:
          outcome === "failed" ? (
            <>
              {INVIATA.genitoreMailFallita}{" "}
              {onEdit ? (
                <button className="flow-signed-in__switch" onClick={onEdit} type="button">
                  {INVIATA.modifica}
                </button>
              ) : null}
            </>
          ) : (
            fillCopy(outcome === "sent" ? INVIATA.genitoreScritto : INVIATA.genitoreInInvio, {
              email,
            })
          ),
      });
    }

    steps.push({
      key: "scheda",
      title: INVIATA.schedaTitolo,
      text: INVIATA.schedaTesto,
    });
  }

  return (
    <section aria-labelledby={titleId} className="auth-screen inviata">
      <div className="flow-topbar">
        <button
          aria-label={INVIATA.chiudi}
          className="flow-topbar__back"
          onClick={onClose}
          type="button"
        >
          <AppIcon name="x" />
        </button>
        <span className="flow-topbar__eyebrow">{PERCORSO.eyebrow}</span>
        <span aria-hidden="true" className="flow-topbar__spacer" />
      </div>

      <div className="inviata__hero">
        <img
          alt=""
          className="inviata__image"
          decoding="async"
          height={illustration.height}
          src={illustration.src}
          width={240}
        />
        <div className="inviata__copy">
          <h1 className="auth-screen__title" id={titleId} ref={titleRef} tabIndex={-1}>
            {INVIATA.titolo}
          </h1>
          <p className="auth-screen__lead">
            <strong>{personName}</strong> · {eventTitle}
          </p>
          {mode === "io" && pending ? (
            <span className="kid-tag kid-tag--sand">{INVIATA.attesaGenitore}</span>
          ) : null}
        </div>
      </div>

      {mode === "figlio" && pending ? (
        <div className="inviata-next">
          <span className="inviata-next__tag">
            <AppIcon name="pencil" />
            {INVIATA.attesaTua}
          </span>
          <h2>{fillCopy(INVIATA.autorizzaTitolo, { nome: personFirstName || personName })}</h2>
          <p>{INVIATA.autorizzaTesto}</p>
          <button
            className="button button--large inviata-next__button"
            disabled={authorizing}
            onClick={onAuthorize}
            type="button"
          >
            {authorizing ? INVIATA.apertura : INVIATA.autorizzaOra}
          </button>
          {authorizeError ? (
            <p className="inviata-next__error" role="alert">
              {authorizeError}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="inviata-steps">
        <h2 className="inviata-steps__title">{INVIATA.cosaSuccede}</h2>
        <ol className="inviata-steps__list">
          {steps.map((step, index) => (
            <li
              className={[
                "inviata-step",
                step.done ? "inviata-step--done" : "",
                step.now ? "inviata-step--now" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={step.key}
            >
              <span aria-hidden="true" className="inviata-step__mark">
                {step.done ? <AppIcon name="check" /> : index + 1}
              </span>
              <span className="inviata-step__text">
                <strong>{step.title}</strong>
                <span>{step.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="auth-foot">
        {mode === "figlio" ? (
          <div className="inviata-foot">
            <button className="button button--soft button--large" onClick={onAnother} type="button">
              {INVIATA.iscriviAltro}
            </button>
            <button className="button button--ghost button--large" onClick={onFamily} type="button">
              {INVIATA.vaiAFamiglia}
            </button>
          </div>
        ) : onChild ? (
          <div className="inviata-foot">
            <button className="button button--primary button--large" onClick={onScheda} type="button">
              {INVIATA.vaiAllaScheda}
            </button>
            <button className="button button--ghost button--large" onClick={onChild} type="button">
              {INVIATA.iscriviFiglio}
            </button>
          </div>
        ) : (
          <button className="button button--primary button--large" onClick={onScheda} type="button">
            {INVIATA.vaiAllaScheda}
          </button>
        )}
      </div>
    </section>
  );
}
