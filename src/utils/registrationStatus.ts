// Stato di un'iscrizione dopo il salvataggio del modulo. Modulo senza import
// a runtime: il test `tests/registrationStatus.test.mjs` lo carica direttamente.
import type { Registration, RegistrationStatus } from "@/types";

export type RegistrationStatusSource = Pick<
  Registration,
  "registrationStatus" | "parentAuthorization"
>;

// Un'iscrizione esistente conserva il suo stato: lo cambiano solo il genitore
// che firma e gli admin. L'eccezione è l'iscrizione annullata, dove il
// salvataggio vale come nuova iscrizione: non esiste nessuna UI di
// riattivazione, e conservare "cancelled" lasciava la persona convinta di
// essersi reiscritta mentre l'iscrizione restava invisibile (2026-09-17).
export function resolveRegistrationStatusOnSave(
  existing: RegistrationStatusSource | null,
  requested: RegistrationStatus,
): RegistrationStatus {
  if (requested === "cancelled") {
    return "cancelled";
  }

  if (existing && existing.registrationStatus !== "cancelled") {
    return existing.registrationStatus;
  }

  if (requested === "pending_parent_authorization") {
    // Autorizzazione già firmata prima dell'annullamento: non si ricomincia
    // dal genitore, l'iscrizione torna direttamente attiva.
    return existing?.parentAuthorization?.status === "authorized"
      ? "active"
      : "pending_parent_authorization";
  }

  return "active";
}
