// Avviso del passo "Genitore e sicurezza" del modulo di iscrizione. Dice
// quello che il salvataggio farà davvero, non quello che succede a
// un'iscrizione nuova: un minore già firmato leggeva che sarebbe partita una
// mail al genitore e che l'iscrizione sarebbe tornata "in attesa", mentre il
// salvataggio conserva lo stato e nessuno scrive al genitore (2026-10-19).
// Funzioni pure: le caricano anche i test Node, quindi niente alias "@/"
// negli import di valori.

import type { Registration } from "@/types";
import { getParentEmailOutcome } from "./childChoice.ts";
import { resolveRegistrationStatusOnSave } from "./registrationStatus.ts";

export type ParentStepNotice =
  // Il salvataggio fa partire la mail al genitore: iscrizione nuova, o
  // annullata senza firma (anche con un link già partito o dopo un rifiuto).
  | "nuovo_link"
  // In attesa con un link già emesso: nessuna mail nuova, salvo un indirizzo
  // diverso (shouldReissueParentAuthorization nelle functions).
  | "scritto"
  | "in_invio"
  // Invio fallito: il salvataggio fa riprovare il trigger.
  | "mail_fallita"
  // Il genitore con account ha già usato "Autorizza ora".
  | "autorizza_ora"
  // Firma presente: lo stato resta (o l'annullata torna attiva), nessuna mail.
  | "autorizzata"
  | "rifiutata"
  // Stato che il salvataggio conserva senza firma né mail (dati vecchi).
  | "nessuno";

export type ParentStepNoticeSource = Pick<
  Registration,
  "registrationStatus" | "parentAuthorization"
>;

// `existing` è l'iscrizione già salvata (con id), non il precompilato di un
// figlio: senza iscrizione il salvataggio la crea in attesa e parte la mail.
export function getParentStepNotice(
  existing: ParentStepNoticeSource | null | undefined,
): ParentStepNotice {
  if (!existing) {
    return "nuovo_link";
  }

  const state = existing.parentAuthorization ?? null;

  // Il passo genitore c'è solo quando l'autorizzazione serve: il modulo chiede
  // sempre "in attesa", e lo stato vero lo decide la stessa funzione del
  // salvataggio.
  const next = resolveRegistrationStatusOnSave(existing, "pending_parent_authorization", {
    parentAuthorizationRequested: true,
  });

  // Annullata e senza firma: il salvataggio vale come iscrizione nuova e il
  // trigger manda un link nuovo, anche dopo un rifiuto o con un link già
  // partito (restartParentAuthorizationAfterCancellation nelle functions).
  if (existing.registrationStatus === "cancelled" && next === "pending_parent_authorization") {
    return "nuovo_link";
  }

  // Rifiuto: nessuna mail, nemmeno con un indirizzo nuovo (il trigger non
  // rimette in gioco un'autorizzazione decisa).
  if (
    state?.status === "rejected_by_parent" ||
    existing.registrationStatus === "rejected_by_parent"
  ) {
    return "rifiutata";
  }
  const outcome = getParentEmailOutcome({
    registrationStatus: next,
    parentAuthorization: state,
  });

  if (outcome === "authorized") {
    return "autorizzata";
  }

  if (next !== "pending_parent_authorization") {
    return "nessuno";
  }

  if (outcome === "failed") {
    return "mail_fallita";
  }

  // Stessa regola del trigger onRegistrationPendingParentAuth: senza un link
  // già emesso, scrive al genitore.
  if (!state?.tokenId) {
    return "nuovo_link";
  }

  if (outcome === "self") {
    return "autorizza_ora";
  }

  return outcome === "sent" ? "scritto" : "in_invio";
}

// Il suggerimento sotto "Email genitore" promette un link: solo dove ne può
// ancora partire uno, con l'indirizzo scritto lì.
export function parentStepNoticeSendsLink(notice: ParentStepNotice) {
  return notice !== "autorizzata" && notice !== "rifiutata" && notice !== "nessuno";
}
