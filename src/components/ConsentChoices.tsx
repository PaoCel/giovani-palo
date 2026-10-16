import { useId } from "react";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { PHOTO_CONSENT_OPTIONS } from "@/constants/legalDocs";
import type { PhotoConsentDecision } from "@/types";
import "@/styles/parentConsent.css";

/** `null` = nessuna risposta ancora: non c'è mai una scelta preselezionata. */
export type ConsentChoice = "accepted" | "refused" | null;

export interface ConsentChoicesValue {
  photo: ConsentChoice;
  social: ConsentChoice;
}

export const CONSENT_MISSING_MESSAGE = "Scegli una risposta per le foto e per i social";
export const CONSENT_SOCIAL_NEEDS_PHOTO_MESSAGE =
  "Per pubblicare sui social serve anche il consenso alle foto";

/** Valore da mostrare per una scelta salvata: il silenzio non è un consenso, quindi nessuna preselezione. */
export function consentChoiceFromDecision(
  value: PhotoConsentDecision | undefined | null,
): ConsentChoice {
  if (value === "accepted") return "accepted";
  if (value === "refused" || value === "revoked") return "refused";
  return null;
}

/**
 * Cosa impedisce di andare avanti con le due scelte, o `null` se sono valide.
 * Le stesse regole le applica la callable: qui servono a dirlo prima.
 */
export function getConsentChoicesProblem(
  photo: ConsentChoice,
  social: ConsentChoice,
): string | null {
  if (photo === null || social === null) return CONSENT_MISSING_MESSAGE;
  if (social === "accepted" && photo !== "accepted") {
    return CONSENT_SOCIAL_NEEDS_PHOTO_MESSAGE;
  }
  return null;
}

interface ConsentChoicesProps {
  value: ConsentChoicesValue;
  onChange: (value: ConsentChoicesValue) => void;
  disabled?: boolean;
}

export function ConsentChoices({ value, onChange, disabled = false }: ConsentChoicesProps) {
  const errorId = useId();
  const [photoText, socialText] = PHOTO_CONSENT_OPTIONS;
  // Segnalata subito, appena la combinazione è incoerente. Il "manca una
  // risposta" lo dice invece chi usa il componente, sotto il bottone.
  const inconsistent = value.social === "accepted" && value.photo === "refused";

  return (
    <div className="consent-choices">
      <ConsentQuestion
        icon="camera"
        title={photoText.title}
        text={photoText.label}
        hint={photoText.helpText}
        value={value.photo}
        disabled={disabled}
        onChange={(photo) => onChange({ ...value, photo })}
      />
      <ConsentQuestion
        icon="share"
        title={socialText.title}
        text={socialText.label}
        hint={socialText.helpText}
        value={value.social}
        disabled={disabled}
        invalid={inconsistent}
        describedBy={inconsistent ? errorId : undefined}
        onChange={(social) => onChange({ ...value, social })}
      />
      {inconsistent ? (
        <p className="consent-choices__error" id={errorId} role="alert">
          <AppIcon name="bell" />
          <span>{CONSENT_SOCIAL_NEEDS_PHOTO_MESSAGE}</span>
        </p>
      ) : null}
    </div>
  );
}

function ConsentQuestion({
  icon,
  title,
  text,
  hint,
  value,
  disabled,
  invalid = false,
  describedBy,
  onChange,
}: {
  icon: AppIconName;
  title: string;
  text: string;
  hint: string;
  value: ConsentChoice;
  disabled: boolean;
  invalid?: boolean;
  describedBy?: string;
  onChange: (value: "accepted" | "refused") => void;
}) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const hintId = `${baseId}-hint`;

  return (
    <section className={invalid ? "consent-card consent-card--invalid" : "consent-card"}>
      <header className="consent-card__head">
        <span aria-hidden="true" className="consent-card__icon">
          <AppIcon name={icon} />
        </span>
        <h3 id={titleId}>{title}</h3>
      </header>
      <p className="consent-card__text">{text}</p>
      <p className="consent-card__hint" id={hintId}>
        {hint}
      </p>
      <div
        aria-describedby={[hintId, describedBy].filter(Boolean).join(" ")}
        aria-labelledby={titleId}
        aria-required="true"
        className="consent-card__options"
        role="radiogroup"
      >
        <label
          className={
            value === "accepted"
              ? "consent-option consent-option--accepted is-selected"
              : "consent-option consent-option--accepted"
          }
        >
          <input
            checked={value === "accepted"}
            disabled={disabled}
            name={baseId}
            onChange={() => onChange("accepted")}
            type="radio"
            value="accepted"
          />
          <span aria-hidden="true" className="consent-option__dot" />
          <span>Acconsento</span>
        </label>
        <label
          className={
            value === "refused"
              ? "consent-option consent-option--refused is-selected"
              : "consent-option consent-option--refused"
          }
        >
          <input
            checked={value === "refused"}
            disabled={disabled}
            name={baseId}
            onChange={() => onChange("refused")}
            type="radio"
            value="refused"
          />
          <span aria-hidden="true" className="consent-option__dot" />
          <span>Non acconsento</span>
        </label>
      </div>
    </section>
  );
}
