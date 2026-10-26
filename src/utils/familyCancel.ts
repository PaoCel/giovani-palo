// Testo del foglio "Annulla l'iscrizione" in Famiglia (docs/FLUSSO_GENITORE.md,
// H): dice se l'iscrizione si potrà rifare, con la data di chiusura.
//
// Questo file lo carica anche Node (tests/): niente alias "@/" fra gli import
// di valori.

import type { Event, Registration } from "@/types";
import { ANNULLA } from "../copy/annulla.ts";
import { FAMIGLIA } from "../copy/famiglia.ts";
import { fillCopy } from "../copy/parole.ts";
import { formatDateOnly } from "./formatters.ts";

type CancelEvent = Pick<Event, "title" | "status" | "registrationOpen" | "registrationClose">;

// Le stesse regole di getRegistrationAvailability per "si può ancora iscrivere".
export function areRegistrationsOpen(event: CancelEvent | null | undefined, now = Date.now()) {
  if (!event || event.status !== "registrations_open") {
    return false;
  }

  const opensAt = new Date(event.registrationOpen).getTime();
  const closesAt = new Date(event.registrationClose).getTime();
  return now >= opensAt && now <= closesAt;
}

export function getCancelRegistrationCopy(
  childName: string,
  event: CancelEvent | null | undefined,
  now = Date.now(),
) {
  const attivita = event?.title?.trim() || FAMIGLIA.attivitaGenerica;
  const body = !event
    ? FAMIGLIA.annullaCorpoSenzaAttivita
    : areRegistrationsOpen(event, now)
      ? fillCopy(FAMIGLIA.annullaCorpoAperte, {
          attivita,
          data: formatDateOnly(event.registrationClose),
        })
      : fillCopy(FAMIGLIA.annullaCorpoChiuse, { attivita });

  return {
    title: fillCopy(FAMIGLIA.annullaTitolo, { nome: childName }),
    body,
  };
}

// Lo stesso foglio per la propria iscrizione, dalla scheda dell'attività.
export function getOwnCancelRegistrationCopy(event: CancelEvent, now = Date.now()) {
  const attivita = event.title?.trim() || FAMIGLIA.attivitaGenerica;
  return {
    title: ANNULLA.titoloTua,
    body: areRegistrationsOpen(event, now)
      ? fillCopy(ANNULLA.corpoAperteTua, { attivita, data: formatDateOnly(event.registrationClose) })
      : fillCopy(ANNULLA.corpoChiuseTua, { attivita }),
  };
}

// "Firma lasciata a metà?": c'è stato un "Autorizza ora" e l'autorizzazione
// aspetta ancora la firma.
export function shouldShowResumeSigning(
  registration: Pick<Registration, "registrationStatus" | "parentAuthorization">,
) {
  return (
    registration.registrationStatus === "pending_parent_authorization" &&
    Boolean(registration.parentAuthorization?.selfTokenIssuedAt)
  );
}

// Offline la scrittura resta in coda e la promessa non si risolve: dopo questo
// tempo si sblocca il pulsante e si dice di controllare la rete.
export const CANCEL_TIMEOUT_MS = 15000;
const TIMEOUT_CODE = "cancel-timeout";

export function withCancelTimeout<T>(promise: Promise<T>, ms = CANCEL_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Object.assign(new Error(ANNULLA.erroreRete), { code: TIMEOUT_CODE })),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// Messaggio in italiano per un annullamento fallito: il testo degli errori
// Firebase è in inglese ("Missing or insufficient permissions.").
export function getCancelErrorMessage(error: unknown) {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return code === TIMEOUT_CODE || code === "unavailable" ? ANNULLA.erroreRete : ANNULLA.errore;
}
