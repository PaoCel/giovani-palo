import type { Registration } from "@/types";
import { isMinorBirthDate } from "@/utils/age";

export function hasConfirmedParentConsent(registration: Registration) {
  if (!isMinorBirthDate(registration.birthDate)) {
    return true;
  }

  return (
    registration.registrationStatus === "confirmed" ||
    registration.parentAuthorization?.status === "authorized" ||
    Boolean(registration.parentConsentDocumentUrl) ||
    registration.answers.parentConfirmed === true ||
    registration.answers.parentalConsentAccepted === true
  );
}
