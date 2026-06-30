import type { ParentAuthorizationStatus, Registration } from "@/types";

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
