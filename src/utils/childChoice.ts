// "Chi iscrivi?" e "Iscrizione inviata" (docs/FLUSSO_GENITORE.md, E, F e H):
// stato della scheda di ogni figlio, avvisi sull'età, chiave delle bozze del
// modulo ed esito della mail di autorizzazione. Funzioni pure: le caricano
// anche i test Node, quindi niente alias "@/" negli import di valori.

import type { ChildProfile, Event, GenderRoleCategory, Registration } from "@/types";
import { CHI_ISCRIVI } from "../copy/chiIscrivi.ts";
import { fillCopy } from "../copy/parole.ts";
import { isEventAudienceEligible } from "./events.ts";
import { getAgeOn, isAcceptableBirthDate, parseCalendarDate } from "./profileCompletion.ts";

// Avvisi morbidi (non blocchi): le attività GU e GD sono dagli 11 anni, e a
// 19 anni compiuti il primo giorno ci si iscrive con il proprio account (G1).
export const MIN_YOUTH_AGE = 11;
export const ADULT_GUARD_AGE = 19;

const MONTHS = [
  CHI_ISCRIVI.meseGennaio,
  CHI_ISCRIVI.meseFebbraio,
  CHI_ISCRIVI.meseMarzo,
  CHI_ISCRIVI.meseAprile,
  CHI_ISCRIVI.meseMaggio,
  CHI_ISCRIVI.meseGiugno,
  CHI_ISCRIVI.meseLuglio,
  CHI_ISCRIVI.meseAgosto,
  CHI_ISCRIVI.meseSettembre,
  CHI_ISCRIVI.meseOttobre,
  CHI_ISCRIVI.meseNovembre,
  CHI_ISCRIVI.meseDicembre,
] as const;

// Primo giorno dell'attività come giorno di calendario locale. `startDate` è
// un istante ISO ("2027-04-24T07:00:00.000Z") o un giorno ("2027-04-24"):
// un giorno nudo si legge locale, mai UTC. Senza data valida: `fallback`.
export function getActivityFirstDay(startDate: string | null | undefined, fallback: Date) {
  const value = typeof startDate === "string" ? startDate.trim() : "";
  const today = new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());

  // Un giorno impossibile ("2027-02-30") non slitta al mese dopo: vale il ripiego.
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return parseCalendarDate(value) ?? today;
  }

  const instant = value ? new Date(value) : null;

  if (!instant || Number.isNaN(instant.getTime())) {
    return today;
  }

  return new Date(instant.getFullYear(), instant.getMonth(), instant.getDate());
}

// "14 anni ad aprile": l'età il primo giorno dell'attività, con il mese.
export function describeAgeAtActivity(birthDate: string | null | undefined, firstDay: Date) {
  const age = getAgeOn(birthDate, firstDay);

  if (age === null) {
    return null;
  }

  return fillCopy(CHI_ISCRIVI.etaAlMese, {
    eta: String(age),
    mese: MONTHS[firstDay.getMonth()],
  });
}

export type ChildAgeWarning = "sotto11" | "maggiorenne" | null;

export function getChildAgeWarning(birthDate: string | null | undefined, firstDay: Date): ChildAgeWarning {
  const age = getAgeOn(birthDate, firstDay);

  if (age === null) {
    return null;
  }

  if (age < MIN_YOUTH_AGE) {
    return "sotto11";
  }

  return age >= ADULT_GUARD_AGE ? "maggiorenne" : null;
}

export function getChildAgeWarningText(
  warning: ChildAgeWarning,
  child: Pick<ChildProfile, "firstName" | "fullName" | "genderRoleCategory">,
) {
  if (warning === "sotto11") {
    return CHI_ISCRIVI.sotto11;
  }

  if (warning === "maggiorenne") {
    return fillCopy(
      child.genderRoleCategory === "giovane_donna"
        ? CHI_ISCRIVI.maggiorenneSola
        : CHI_ISCRIVI.maggiorenneSolo,
      { nome: child.firstName || child.fullName },
    );
  }

  return null;
}

// Un'iscrizione che conta: esiste e non è annullata. Un'iscrizione annullata
// rende la scheda di nuovo selezionabile (matrice "Iscrizione annullata").
export function isLiveRegistration(registration: Pick<Registration, "registrationStatus"> | null | undefined) {
  return Boolean(registration) && registration?.registrationStatus !== "cancelled";
}

export type ChildChoiceState =
  | { kind: "registered" }
  | { kind: "blocked"; reason: "solo_gd" | "solo_gu" | "gruppo" }
  | { kind: "selectable" };

// Stato della scheda in "Chi iscrivi?": "Già iscritto · Apri" (mai un
// doppione), non selezionabile col motivo, oppure selezionabile.
export function getChildChoiceState(
  child: Pick<ChildProfile, "genderRoleCategory">,
  event: Pick<Event, "audience">,
  registration: Pick<Registration, "registrationStatus"> | null | undefined,
): ChildChoiceState {
  if (isLiveRegistration(registration)) {
    return { kind: "registered" };
  }

  const category = child.genderRoleCategory as GenderRoleCategory | "";

  if (!isEventAudienceEligible(event, category)) {
    if (!category) {
      return { kind: "blocked", reason: "gruppo" };
    }

    return {
      kind: "blocked",
      reason: event.audience === "giovane_donna" ? "solo_gd" : "solo_gu",
    };
  }

  return { kind: "selectable" };
}

export function getBlockedReasonText(reason: "solo_gd" | "solo_gu" | "gruppo") {
  if (reason === "solo_gd") {
    return CHI_ISCRIVI.soloGiovaniDonne;
  }

  return reason === "solo_gu" ? CHI_ISCRIVI.soloGiovaniUomini : CHI_ISCRIVI.gruppoMancante;
}

export function getRegisteredLabel(child: Pick<ChildProfile, "genderRoleCategory">) {
  return child.genderRoleCategory === "giovane_donna"
    ? CHI_ISCRIVI.giaIscritta
    : CHI_ISCRIVI.giaIscritto;
}

// Scelta iniziale in "Chi iscrivi?": quella di prima se è ancora
// selezionabile, altrimenti l'unico figlio selezionabile. Con due o più
// figli non si sceglie al posto del genitore (telefono di famiglia).
export function getInitialChildChoice(
  states: ReadonlyArray<{ childId: string; state: ChildChoiceState }>,
  previous: string | null | undefined,
) {
  const selectable = states.filter((item) => item.state.kind === "selectable");

  if (previous && selectable.some((item) => item.childId === previous)) {
    return previous;
  }

  return selectable.length === 1 ? selectable[0].childId : null;
}

// Bozza del modulo in memoria per account, attività e persona: i dati
// sanitari di un figlio non passano mai a un altro.
export function getRegisterDraftKey(input: {
  uid: string;
  stakeId: string;
  eventId: string;
  childId?: string | null;
}) {
  return [input.uid, input.stakeId, input.eventId, input.childId ? `child:${input.childId}` : "io"].join("|");
}

// Esito della mail di autorizzazione, letto dall'iscrizione (scritto dal
// trigger onRegistrationPendingParentAuth): "sent" solo con l'id del messaggio
// del provider, "failed" con email_error, "self" dopo "Autorizza ora" (il link
// della mail non vale più), "authorized" a firma fatta.
export type ParentEmailOutcome = "none" | "sending" | "sent" | "failed" | "self" | "authorized";

export function getParentEmailOutcome(
  registration: Pick<Registration, "registrationStatus" | "parentAuthorization"> | null | undefined,
): ParentEmailOutcome {
  if (!registration) {
    return "none";
  }

  const state = registration.parentAuthorization;

  if (registration.registrationStatus === "confirmed" || state?.status === "authorized") {
    return "authorized";
  }

  if (registration.registrationStatus !== "pending_parent_authorization") {
    return "none";
  }

  if (state?.selfTokenIssuedAt) {
    return "self";
  }

  if (state?.status === "email_error") {
    return "failed";
  }

  if (state?.status === "email_sent" && state.brevoMessageId) {
    return "sent";
  }

  return "sending";
}

// Indirizzo a cui è (o sarà) partita la mail: quello dell'ultimo invio,
// altrimenti quello scritto nel modulo.
export function getParentEmailAddress(
  registration: Pick<Registration, "parentAuthorization" | "answers"> | null | undefined,
) {
  const sent = registration?.parentAuthorization?.parentEmail;

  if (typeof sent === "string" && sent.trim()) {
    return sent.trim();
  }

  const request = (registration?.answers as Record<string, unknown> | undefined)?.parentAuthorizationRequest;
  const requested =
    request && typeof request === "object" ? (request as Record<string, unknown>).parentEmail : null;
  return typeof requested === "string" ? requested.trim() : "";
}

export function getInitials(fullName: string) {
  const initials = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0))
    .slice(0, 2)
    .join("");
  return initials.toUpperCase() || "?";
}

// Colore dell'avatar: sempre lo stesso per lo stesso nome.
const AVATAR_TONES = ["blue", "sand", "green", "slate"] as const;
export type AvatarTone = (typeof AVATAR_TONES)[number];

export function getAvatarTone(seed: string): AvatarTone {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 997;
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

// Modulo del figlio (foglio "Aggiungi" e modulo aperto senza figli).
export interface ChildFormValues {
  firstName: string;
  lastName: string;
  birthDate: string;
  genderRoleCategory: "giovane_uomo" | "giovane_donna" | "";
  unitId: string;
}

// Nuovo figlio: unità come la tua, se è fra quelle del palo. In modifica: i
// dati salvati (Annulla li rimette, perché il foglio scrive solo con Salva).
export function getChildFormInitial(
  child: Pick<ChildProfile, "firstName" | "lastName" | "birthDate" | "genderRoleCategory" | "unitId"> | null,
  parentUnitId: string,
  unitIds: ReadonlyArray<string>,
): ChildFormValues {
  if (child) {
    return {
      firstName: child.firstName,
      lastName: child.lastName,
      birthDate: child.birthDate,
      genderRoleCategory:
        child.genderRoleCategory === "giovane_uomo" || child.genderRoleCategory === "giovane_donna"
          ? child.genderRoleCategory
          : "",
      unitId: child.unitId,
    };
  }

  return {
    firstName: "",
    lastName: "",
    birthDate: "",
    genderRoleCategory: "",
    unitId: parentUnitId && unitIds.includes(parentUnitId) ? parentUnitId : "",
  };
}

// Il primo errore da mostrare, o null. L'unità è obbligatoria solo se il palo
// ne ha configurate (senza, il campo resta spento come in Famiglia).
export function validateChildForm(
  values: ChildFormValues,
  options: { today: Date; unitIds: ReadonlyArray<string> },
) {
  if (!values.firstName.trim() || !values.lastName.trim()) {
    return CHI_ISCRIVI.erroreNome;
  }

  if (!values.birthDate) {
    return CHI_ISCRIVI.erroreDataNascita;
  }

  if (!isAcceptableBirthDate(values.birthDate, options.today)) {
    return CHI_ISCRIVI.erroreDataNonValida;
  }

  if (!values.genderRoleCategory) {
    return CHI_ISCRIVI.erroreGruppo;
  }

  if (options.unitIds.length > 0 && !options.unitIds.includes(values.unitId)) {
    return CHI_ISCRIVI.erroreUnita;
  }

  return null;
}

// Bozza del modulo di un figlio i cui dati sono stati corretti con la matita:
// nome, data, gruppo e unità tornano quelli del figlio (sono nascosti a chi ha
// già il profilo completo, e la data decide se serve l'autorizzazione del
// genitore). Le risposte che la bozza non ha restano assenti.
export interface DraftIdentityValues {
  firstName: string;
  lastName: string;
  birthDate: string;
  category: string;
  unitName: string;
  answers: Record<string, unknown>;
}

export function applyChildIdentity<T extends DraftIdentityValues>(
  values: T,
  child: Pick<ChildProfile, "firstName" | "lastName" | "birthDate" | "genderRoleCategory" | "unitName">,
): T {
  const answers: Record<string, unknown> = { ...values.answers };
  const identityAnswers: Record<string, string> = {
    birthDate: child.birthDate,
    genderRoleCategory: child.genderRoleCategory,
    youthGroup: child.genderRoleCategory,
    unitName: child.unitName,
  };

  for (const [field, value] of Object.entries(identityAnswers)) {
    if (field in answers) {
      answers[field] = value;
    }
  }

  return {
    ...values,
    firstName: child.firstName,
    lastName: child.lastName,
    birthDate: child.birthDate,
    category: child.genderRoleCategory,
    unitName: child.unitName,
    answers,
  };
}
