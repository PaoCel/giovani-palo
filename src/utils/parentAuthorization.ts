import type {
  ParentAuthorizationStatus,
  PhotoConsentDecision,
  Registration,
} from "@/types";
import { isMinorBirthDate } from "@/utils/age";

export type ParentAuthorizationUiStatus = ParentAuthorizationStatus | "missing";
export type ParentAuthorizationTone = "neutral" | "info" | "success" | "warning" | "danger";

export function getParentAuthorizationStatus(
  registration: Registration,
): ParentAuthorizationUiStatus {
  return registration.parentAuthorization?.status ?? "missing";
}

export function isParentAuthorizationAuthorized(registration: Registration) {
  return getParentAuthorizationStatus(registration) === "authorized";
}

export function hasSignedParentAuthorizationPdf(registration: Registration) {
  return (
    isParentAuthorizationAuthorized(registration) &&
    Boolean(registration.parentAuthorization?.pdfPath)
  );
}

export function getParentAuthorizationBadge(
  registration: Registration,
  required: boolean,
): { label: string; tone: ParentAuthorizationTone } {
  if (!required) {
    return { label: "Email non richiesta", tone: "neutral" };
  }

  switch (getParentAuthorizationStatus(registration)) {
    case "authorized":
      return { label: "Autorizzata", tone: "success" };
    case "rejected_by_parent":
      return { label: "Rifiutata", tone: "danger" };
    case "email_error":
      return { label: "Errore email", tone: "danger" };
    case "expired":
      return { label: "Link scaduto", tone: "warning" };
    case "email_sent":
    case "pending_parent_authorization":
    case "pending_request":
      return { label: "In attesa", tone: "warning" };
    case "not_required":
      return { label: "Non richiesta", tone: "neutral" };
    case "revoked":
      return { label: "Revocata", tone: "danger" };
    case "missing":
    default:
      return { label: "Email mancante", tone: "warning" };
  }
}

export interface PhotoConsentBadge {
  label: string;
  tone: ParentAuthorizationTone;
}

export interface PhotoConsentBadges {
  photo: PhotoConsentBadge;
  social: PhotoConsentBadge;
}

function getConsentDecisionBadge(
  prefix: "Foto" | "Social",
  decision: PhotoConsentDecision | undefined,
): PhotoConsentBadge {
  switch (decision) {
    case "accepted":
      return { label: `${prefix}: sì`, tone: "success" };
    case "refused":
      return { label: `${prefix}: no`, tone: "neutral" };
    case "revoked":
      return { label: `${prefix}: revocato`, tone: "danger" };
    case "not_answered":
    default:
      // Firme vecchie o scelta mai data: vale come nessun consenso.
      return { label: `${prefix}: da chiedere`, tone: "warning" };
  }
}

/**
 * Scelte del genitore su foto e social (non la spunta dei maggiorenni nel
 * modulo, `answers.photoInternalConsent`, che vale solo per gli adulti).
 * Ritorna `null` solo per gli adulti senza firma del genitore. Per un minore
 * torna sempre una coppia di pill: "da chiedere" se non c'è un consenso
 * valido (non firmato, rifiutato dal genitore, scaduto, errore email).
 *
 * Il social implica la foto: un "social sì" con foto diversa da "sì" (firme
 * vecchie incoerenti) non è un consenso utilizzabile e si legge "da chiedere".
 * I dati originali e gli audit non vengono toccati.
 */
export function getPhotoConsentBadges(
  registration: Registration,
): PhotoConsentBadges | null {
  const authorization = registration.parentAuthorization;
  const status = authorization?.status;
  const hasSignature = status === "authorized" || status === "revoked";

  if (hasSignature && authorization) {
    const social =
      authorization.socialPublicationConsent === "accepted" &&
      authorization.photoConsent !== "accepted"
        ? undefined
        : authorization.socialPublicationConsent;

    return {
      photo: getConsentDecisionBadge("Foto", authorization.photoConsent),
      social: getConsentDecisionBadge("Social", social),
    };
  }

  if (!isMinorBirthDate(registration.birthDate)) {
    return null;
  }

  return {
    photo: getConsentDecisionBadge("Foto", undefined),
    social: getConsentDecisionBadge("Social", undefined),
  };
}

/** True per un minore che non ha ancora dato (o ha perso) la scelta su foto o social. */
export function needsPhotoConsentQuestion(registration: Registration) {
  const badges = getPhotoConsentBadges(registration);
  return Boolean(
    badges &&
      (badges.photo.tone === "warning" || badges.social.tone === "warning"),
  );
}
