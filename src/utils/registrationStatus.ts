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
  options: { parentAuthorizationRequested?: boolean } = {},
): RegistrationStatus {
  if (requested === "cancelled") {
    return "cancelled";
  }

  if (existing && existing.registrationStatus !== "cancelled") {
    // Attiva senza firma e il modulo ora raccoglie il genitore (meno di 18
    // anni in un'attività che chiede l'autorizzazione, per esempio dopo una
    // data di nascita corretta): passa in attesa. Le rules lo impongono
    // quando cambia la data (docs/ADMIN_ISCRITTI.md); prima restava attiva
    // senza consenso.
    // Una decisione del genitore (firma o rifiuto) resta com'è.
    const decided =
      existing.parentAuthorization?.status === "authorized" ||
      existing.parentAuthorization?.status === "rejected_by_parent";
    if (
      existing.registrationStatus === "active" &&
      options.parentAuthorizationRequested &&
      !decided
    ) {
      return "pending_parent_authorization";
    }
    return existing.registrationStatus;
  }

  // I dati del genitore nel payload valgono quanto lo stato richiesto: se il
  // modulo li ha raccolti, l'autorizzazione serve e non è ancora arrivata. Un
  // client che chiedeva "active" saltava in silenzio il consenso di un minore.
  if (requested === "pending_parent_authorization" || options.parentAuthorizationRequested) {
    // Autorizzazione già firmata prima dell'annullamento: non si ricomincia
    // dal genitore, l'iscrizione torna direttamente attiva.
    return existing?.parentAuthorization?.status === "authorized"
      ? "active"
      : "pending_parent_authorization";
  }

  return "active";
}
