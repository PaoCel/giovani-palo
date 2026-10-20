// Iscrizione a mano e correzione dei dati dall'admin (docs/ADMIN_ISCRITTI.md).
// Una sola fonte per cosa farà il salvataggio: lo stato, la mail al genitore,
// gli avvisi del foglio e il documento scritto si calcolano qui, con le stesse
// regole delle rules (validAdminManualCreate, validAdminRegistrationUpdate) e
// del trigger delle autorizzazioni. Lezione `parentStepNotice`: un avviso che
// guarda regole diverse dal salvataggio promette cose false.
//
// Questo file lo carica anche Node (tests/): import a runtime relativi con
// `.ts`, niente alias "@/".

import type {
  GenderRoleCategory,
  Registration,
  RegistrationStatus,
} from "@/types";
import { ADMIN } from "../copy/admin.ts";
import { fillCopy } from "../copy/parole.ts";
import { isMinorBirthDate } from "./age.ts";
import { getYouthGroupLabel } from "./profile.ts";

export const MANUAL_REGISTRATION_PREFIX = "manual_";

const BIRTH_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AdminPersonDraft {
  firstName: string;
  lastName: string;
  birthDate: string;
  genderRoleCategory: GenderRoleCategory | "";
  unitId: string;
  unitName: string;
  email: string;
  phone: string;
}

export interface AdminParentDraft {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export const EMPTY_PARENT_DRAFT: AdminParentDraft = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
};

export function isManualRegistration(registration: Pick<Registration, "id">) {
  return registration.id.startsWith(MANUAL_REGISTRATION_PREFIX);
}

// Id casuale fissato all'apertura del foglio: un "Aggiungi" ripetuto dopo un
// errore di rete riscrive lo stesso documento invece di crearne un secondo.
export function newManualRegistrationId(random: () => string = randomToken) {
  return `${MANUAL_REGISTRATION_PREFIX}${random()}`;
}

function randomToken() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(20);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function isValidBirthDate(value: string) {
  if (!BIRTH_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    year >= 1920 &&
    date.getTime() <= Date.now()
  );
}

export function isValidEmail(value: string) {
  return EMAIL_PATTERN.test(value.trim());
}

// Il genitore firma per un minorenne di un'attività che chiede
// l'autorizzazione: stesso conto di badge, filtri e rules (18 anni, oggi).
export function needsParentAuthorization(requiresParentAuthorization: boolean, birthDate: string) {
  return requiresParentAuthorization && isMinorBirthDate(birthDate);
}

export function isParentAuthorizationSigned(registration: Pick<Registration, "parentAuthorization">) {
  return registration.parentAuthorization?.status === "authorized";
}

function isParentAuthorizationDecided(registration: Pick<Registration, "parentAuthorization">) {
  const status = registration.parentAuthorization?.status;
  return status === "authorized" || status === "rejected_by_parent";
}

export function getRequestParentEmail(registration: Pick<Registration, "answers">) {
  const request = (registration.answers as Record<string, unknown>).parentAuthorizationRequest;
  if (!request || typeof request !== "object") return "";
  const email = (request as Record<string, unknown>).parentEmail;
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

// In attesa del genitore senza un indirizzo a cui mandare il link: le 4
// iscrizioni a mano di ottobre, o un minorenne aggiunto senza email.
export function isMissingParentEmail(
  registration: Pick<Registration, "registrationStatus" | "answers" | "parentAuthorization">,
) {
  return (
    registration.registrationStatus === "pending_parent_authorization" &&
    !isParentAuthorizationDecided(registration) &&
    !getRequestParentEmail(registration)
  );
}

// ---------------------------------------------------------------------------
// Aggiungi a mano
// ---------------------------------------------------------------------------

export interface ManualAddOutcome {
  status: Extract<RegistrationStatus, "active" | "pending_parent_authorization">;
  needsParent: boolean;
  sendsMail: boolean;
}

export function getManualAddOutcome(input: {
  birthDate: string;
  requiresParentAuthorization: boolean;
  parentEmail: string;
}): ManualAddOutcome {
  const needsParent = needsParentAuthorization(input.requiresParentAuthorization, input.birthDate);
  if (!needsParent) {
    return { status: "active", needsParent: false, sendsMail: false };
  }
  return {
    status: "pending_parent_authorization",
    needsParent: true,
    sendsMail: isValidEmail(input.parentEmail),
  };
}

export type ManualAddProblem =
  | "nome"
  | "cognome"
  | "dataNascita"
  | "categoria"
  | "unita"
  | "emailPersona"
  | "emailGenitore";

export function validateManualAdd(
  person: AdminPersonDraft,
  parent: AdminParentDraft,
  requiresParentAuthorization: boolean,
): ManualAddProblem[] {
  const problems: ManualAddProblem[] = [];
  if (!person.firstName.trim()) problems.push("nome");
  if (!person.lastName.trim()) problems.push("cognome");
  if (!isValidBirthDate(person.birthDate)) problems.push("dataNascita");
  if (!person.genderRoleCategory) problems.push("categoria");
  if (!person.unitId) problems.push("unita");
  if (person.email.trim() && !isValidEmail(person.email)) problems.push("emailPersona");
  if (
    needsParentAuthorization(requiresParentAuthorization, person.birthDate) &&
    parent.email.trim() &&
    !isValidEmail(parent.email)
  ) {
    problems.push("emailGenitore");
  }
  return problems;
}

function buildParentRequest(parent: AdminParentDraft, submittedAt: string) {
  return {
    parentFirstName: parent.firstName.trim(),
    parentLastName: parent.lastName.trim(),
    parentEmail: parent.email.trim().toLowerCase(),
    parentPhone: parent.phone.trim(),
    submittedAt,
  };
}

// Il documento completo di un'iscrizione a mano, nella forma che le rules
// accettano (validAdminManualCreate): ogni campo dell'elenco esplicito,
// titolare vuoto, consensi e assegnazioni vuoti, autore annotato.
// `timestamp` fissato all'apertura del foglio: un secondo tentativo identico
// non cambia nessun campo.
export function buildManualRegistrationDoc(input: {
  person: AdminPersonDraft;
  parent: AdminParentDraft;
  requiresParentAuthorization: boolean;
  createdBy: string;
  timestamp: string;
}) {
  const { person, parent, timestamp } = input;
  const outcome = getManualAddOutcome({
    birthDate: person.birthDate,
    requiresParentAuthorization: input.requiresParentAuthorization,
    parentEmail: parent.email,
  });
  const firstName = person.firstName.trim();
  const lastName = person.lastName.trim();
  const category = person.genderRoleCategory as GenderRoleCategory;
  const unitName = person.unitName.trim();

  return {
    userId: null,
    anonymousUid: null,
    anonymousTokenId: null,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    email: person.email.trim(),
    phone: person.phone.trim(),
    birthDate: person.birthDate,
    genderRoleCategory: category,
    unitId: person.unitId,
    unitNameSnapshot: unitName,
    answers: {
      birthDate: person.birthDate,
      genderRoleCategory: category,
      youthGroup: getYouthGroupLabel(category),
      unitName,
      ...(outcome.needsParent && outcome.sendsMail
        ? { parentAuthorizationRequest: buildParentRequest(parent, timestamp) }
        : {}),
    },
    roomPreferenceMatches: null,
    participatingDays: [],
    accessCode: null,
    recoveryCode: null,
    recoveryPdfGenerated: false,
    parentConsentDocumentName: null,
    parentConsentDocumentUrl: null,
    parentConsentDocumentPath: null,
    parentConsentUploadedAt: null,
    consentSignatureUrl: null,
    consentSignaturePath: null,
    consentSignatureSetAt: null,
    parentIdDocumentName: null,
    parentIdDocumentUrl: null,
    parentIdDocumentPath: null,
    parentIdUploadedAt: null,
    parentAuthorization: null,
    linkedLaterToUserId: null,
    parentUid: null,
    childId: null,
    registrationStatus: outcome.status,
    submittedByMode: "anonymous" as const,
    assignedRoomId: null,
    assignedRoomName: null,
    assignedTempleShiftId: null,
    assignedServiceTeamIds: [],
    assignedPatrolId: null,
    assignedPatrolName: null,
    assignedPatrolRole: null,
    assignedCommittees: [],
    createdBy: input.createdBy,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

// ---------------------------------------------------------------------------
// Possibili doppioni
// ---------------------------------------------------------------------------

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("it-IT")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Stesso nome e cognome (anche scambiati), o stesso nome e data di nascita,
// fra le iscrizioni non annullate dell'attività.
export function findPossibleDuplicates(
  registrations: Registration[],
  person: Pick<AdminPersonDraft, "firstName" | "lastName" | "birthDate">,
  excludeId?: string,
) {
  const first = normalizeName(person.firstName);
  const last = normalizeName(person.lastName);
  if (!first) return [];

  return registrations.filter((registration) => {
    if (registration.id === excludeId) return false;
    if (registration.registrationStatus === "cancelled") return false;
    const otherFirst = normalizeName(registration.firstName);
    const otherLast = normalizeName(registration.lastName);
    const otherFull = normalizeName(registration.fullName);
    const sameName =
      Boolean(last) &&
      ((otherFirst === first && otherLast === last) ||
        otherFull === `${first} ${last}` ||
        otherFull === `${last} ${first}`);
    const sameBirth =
      Boolean(person.birthDate) &&
      registration.birthDate === person.birthDate &&
      (otherFirst === first || otherFull.split(" ")[0] === first);
    return sameName || sameBirth;
  });
}

// ---------------------------------------------------------------------------
// Modifica dati
// ---------------------------------------------------------------------------

export function personDraftFromRegistration(registration: Registration): AdminPersonDraft {
  const answers = registration.answers as Record<string, unknown>;
  return {
    firstName: registration.firstName,
    lastName: registration.lastName,
    birthDate: registration.birthDate,
    genderRoleCategory: registration.genderRoleCategory,
    unitId: registration.unitId,
    unitName:
      registration.unitNameSnapshot ||
      (typeof answers.unitName === "string" ? answers.unitName : ""),
    email: registration.email,
    phone: registration.phone,
  };
}

export interface AdminEditContext {
  requiresParentAuthorization: boolean;
  // Unità prima della modifica, per l'avviso sulla visibilità.
  previousUnitName: string;
}

export interface AdminEditPlan {
  // Prossimo stato: uguale a prima se la modifica non lo tocca.
  nextStatus: RegistrationStatus;
  // Diventa minorenne in un'attività con autorizzazione, senza firma e senza
  // richiesta: servono i dati del genitore.
  needsParentFields: boolean;
  sendsMail: boolean;
  effects: string[];
}

function isYouth(category: GenderRoleCategory | "") {
  return category === "giovane_uomo" || category === "giovane_donna";
}

export function planAdminEdit(
  registration: Registration,
  person: AdminPersonDraft,
  parent: AdminParentDraft,
  context: AdminEditContext,
): AdminEditPlan {
  const effects: string[] = [];
  const cancelled = registration.registrationStatus === "cancelled";
  const decided = isParentAuthorizationDecided(registration);
  const wasMinor = isMinorBirthDate(registration.birthDate);
  const isMinor = isMinorBirthDate(person.birthDate);
  const birthChanged = registration.birthDate !== person.birthDate;
  const requestEmail = getRequestParentEmail(registration);
  let nextStatus = registration.registrationStatus;
  let needsParentFields = false;
  let sendsMail = false;

  if (birthChanged && !cancelled) {
    if (decided) {
      effects.push(ADMIN.effettoFirmaResta);
    } else if (context.requiresParentAuthorization && isMinor && !wasMinor) {
      nextStatus = "pending_parent_authorization";
      needsParentFields = !requestEmail;
      const email = requestEmail || (isValidEmail(parent.email) ? parent.email.trim().toLowerCase() : "");
      sendsMail = Boolean(email);
      effects.push(
        email
          ? fillCopy(ADMIN.effettoDiventaMinoreMail, { email })
          : ADMIN.effettoDiventaMinoreSenzaEmail,
      );
    } else if (
      context.requiresParentAuthorization &&
      !isMinor &&
      wasMinor &&
      registration.registrationStatus === "pending_parent_authorization"
    ) {
      nextStatus = "active";
      effects.push(ADMIN.effettoDiventaAdulto);
    } else if (isMinor !== wasMinor) {
      effects.push(isMinor ? ADMIN.effettoFotoGenitore : ADMIN.effettoFotoPersona);
    }
  }

  if (person.unitId !== registration.unitId && person.unitId) {
    effects.push(
      context.previousUnitName && registration.unitId
        ? fillCopy(ADMIN.effettoUnita, {
            nuova: person.unitName,
            vecchia: context.previousUnitName,
          })
        : fillCopy(ADMIN.effettoUnitaNuova, { nuova: person.unitName }),
    );
  }

  const nameChanged =
    person.firstName.trim() !== registration.firstName.trim() ||
    person.lastName.trim() !== registration.lastName.trim();
  if (nameChanged && isParentAuthorizationSigned(registration)) {
    effects.push(ADMIN.effettoNomeFirmato);
  }

  if (
    registration.assignedRoomName &&
    person.genderRoleCategory &&
    isYouth(person.genderRoleCategory) !== isYouth(registration.genderRoleCategory)
  ) {
    effects.push(fillCopy(ADMIN.effettoStanza, { stanza: registration.assignedRoomName }));
  }

  const hasAccount = Boolean(registration.userId || registration.parentUid);
  const anyChange =
    nameChanged ||
    birthChanged ||
    person.unitId !== registration.unitId ||
    person.genderRoleCategory !== registration.genderRoleCategory ||
    person.email.trim() !== registration.email.trim() ||
    person.phone.trim() !== registration.phone.trim();
  if (hasAccount && anyChange) {
    effects.push(ADMIN.effettoProfilo);
  }

  return { nextStatus, needsParentFields, sendsMail, effects };
}

export function validateAdminEdit(
  person: AdminPersonDraft,
  parent: AdminParentDraft,
  plan: Pick<AdminEditPlan, "needsParentFields">,
): ManualAddProblem[] {
  const problems: ManualAddProblem[] = [];
  if (!person.firstName.trim()) problems.push("nome");
  if (!person.lastName.trim()) problems.push("cognome");
  if (!isValidBirthDate(person.birthDate)) problems.push("dataNascita");
  if (!person.genderRoleCategory) problems.push("categoria");
  if (!person.unitId) problems.push("unita");
  if (person.email.trim() && !isValidEmail(person.email)) problems.push("emailPersona");
  if (plan.needsParentFields && parent.email.trim() && !isValidEmail(parent.email)) {
    problems.push("emailGenitore");
  }
  return problems;
}

// Le chiavi scritte con updateDoc: i campi della persona si scrivono sempre
// insieme (nome, cognome e nome completo; unità e copie; data e copie), le
// risposte con percorsi puntati per non toccare il resto del modulo. Solo le
// chiavi della lista dell'admin nelle rules.
export function buildAdminEditPatch(input: {
  registration: Registration;
  person: AdminPersonDraft;
  parent: AdminParentDraft;
  plan: AdminEditPlan;
  timestamp: string;
}): Record<string, unknown> {
  const { person, parent, plan, timestamp, registration } = input;
  const firstName = person.firstName.trim();
  const lastName = person.lastName.trim();
  const category = person.genderRoleCategory as GenderRoleCategory;
  const unitName = person.unitName.trim();
  const patch: Record<string, unknown> = {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    email: person.email.trim(),
    phone: person.phone.trim(),
    birthDate: person.birthDate,
    genderRoleCategory: category,
    unitId: person.unitId,
    unitNameSnapshot: unitName,
    "answers.birthDate": person.birthDate,
    "answers.genderRoleCategory": category,
    "answers.youthGroup": getYouthGroupLabel(category),
    "answers.unitName": unitName,
    updatedAt: timestamp,
  };
  if (plan.nextStatus !== registration.registrationStatus) {
    patch.registrationStatus = plan.nextStatus;
  }
  if (plan.needsParentFields && isValidEmail(parent.email)) {
    Object.assign(patch, parentRequestPatch(parent, timestamp));
  }
  return patch;
}

// "Chiedi l'autorizzazione": la richiesta del genitore con percorsi puntati
// (i dati sanitari già nel modulo restano), e lo stato in attesa se non lo
// era. La mail la manda il trigger esistente.
export function parentRequestPatch(parent: AdminParentDraft, timestamp: string) {
  const request = buildParentRequest(parent, timestamp);
  return {
    "answers.parentAuthorizationRequest.parentFirstName": request.parentFirstName,
    "answers.parentAuthorizationRequest.parentLastName": request.parentLastName,
    "answers.parentAuthorizationRequest.parentEmail": request.parentEmail,
    "answers.parentAuthorizationRequest.parentPhone": request.parentPhone,
    "answers.parentAuthorizationRequest.submittedAt": request.submittedAt,
  };
}

export function buildRequestAuthorizationPatch(
  registration: Pick<Registration, "registrationStatus">,
  parent: AdminParentDraft,
  timestamp: string,
): Record<string, unknown> {
  return {
    ...parentRequestPatch(parent, timestamp),
    ...(registration.registrationStatus === "pending_parent_authorization"
      ? {}
      : { registrationStatus: "pending_parent_authorization" }),
    updatedAt: timestamp,
  };
}

// ---------------------------------------------------------------------------
// Riattiva
// ---------------------------------------------------------------------------

export interface ReactivatePlan {
  status: Extract<RegistrationStatus, "active" | "pending_parent_authorization">;
  sendsMail: boolean;
  reopensRejection: boolean;
}

// Come il titolare (resolveRegistrationStatusOnSave e le rules): un
// minorenne di un'attività con autorizzazione torna attivo solo se il
// genitore ha già firmato, altrimenti in attesa; con la richiesta presente
// il trigger manda link e mail nuovi, e un rifiuto visto si riapre.
export function planAdminReactivate(
  registration: Pick<Registration, "birthDate" | "answers" | "parentAuthorization">,
  requiresParentAuthorization: boolean,
): ReactivatePlan {
  if (
    !needsParentAuthorization(requiresParentAuthorization, registration.birthDate) ||
    isParentAuthorizationSigned(registration)
  ) {
    return { status: "active", sendsMail: false, reopensRejection: false };
  }
  const sendsMail = Boolean(getRequestParentEmail(registration));
  return {
    status: "pending_parent_authorization",
    sendsMail,
    reopensRejection: sendsMail && registration.parentAuthorization?.status === "rejected_by_parent",
  };
}
