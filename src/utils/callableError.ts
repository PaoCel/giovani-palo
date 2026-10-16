// Le callable di consenso rispondono con `details.reason` ("consent_required",
// "social_needs_photo", "consent_stale"): il codice, non il testo, decide cosa fare.
export function getCallableErrorReason(error: unknown): string | undefined {
  const details = (error as { details?: unknown } | null)?.details;
  if (details && typeof details === "object" && "reason" in details) {
    const reason = (details as { reason?: unknown }).reason;
    return typeof reason === "string" ? reason : undefined;
  }
  return undefined;
}

const CONSENT_STALE_MESSAGE = "Le scelte sono state cambiate da un'altra parte nel frattempo";

/** Le scelte sono cambiate altrove dopo che la pagina le aveva lette. */
export function isConsentStaleError(error: unknown): boolean {
  if (getCallableErrorReason(error) === "consent_stale") return true;
  return error instanceof Error && error.message.includes(CONSENT_STALE_MESSAGE);
}
