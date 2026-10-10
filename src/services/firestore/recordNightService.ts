import {
  collection,
  getDocsFromServer,
  query,
  where,
  type DocumentData,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { db, functions } from "@/services/firebase/app";
import type {
  RecordNightCategory,
  RecordNightEntry,
  RecordNightEntryKind,
  RecordNightEntryStatus,
  RecordNightMeasure,
  RecordNightRecord,
  RecordNightRecordStatus,
  RecordNightWithdrawnBy,
} from "@/types";
import {
  RECORD_NIGHT_CATEGORIES,
  RECORD_NIGHT_MEASURES,
  measureNeedsDuration,
} from "@/utils/recordNight";

// Notte dei Record (docs/NOTTE_DEI_RECORD.md). Record e tentativi si scrivono
// solo dalle callable; qui le letture sono server-first (i contatori cambiano
// spesso, niente cache-first) e le callable hanno un wrapper tipizzato.

export interface RecordNightProposalInput {
  text: string;
  measure: RecordNightMeasure;
  // Solo per `count_in_time` (10-60 secondi); per le altre misure viene ignorato.
  durationSeconds?: number | null;
  needs?: string;
}

// Un'iscrizione per cui l'utente può agire: la propria (`isSelf`) o quella di un
// figlio. `displayName` è il nome di battesimo, o nome e cognome se due persone
// hanno lo stesso.
export interface RecordNightPerson {
  registrationId: string;
  displayName: string;
  isSelf: boolean;
}

export interface RecordNightContext {
  people: RecordNightPerson[];
  // Gestisce i record: admin del palo, dirigente di unità del palo, oppure uid
  // messo in elenco da un admin (`setStaff`).
  isStaff: boolean;
  // Può scegliere chi gestisce i record: solo admin e super_admin del palo.
  canManageStaff: boolean;
}

// Un'iscrizione `user_` attiva che si può mettere in staff (solo admin del palo).
// `isAdult` serve solo a ordinare l'elenco: non dà nessun permesso.
export interface RecordNightStaffCandidate {
  uid: string;
  registrationId: string;
  name: string;
  unitName: string;
  isAdult: boolean;
  isStaff: boolean;
}

// Un'iscrizione attiva dell'attività, per "Iscrivi qualcuno" (solo staff).
export interface RecordNightParticipantOption {
  registrationId: string;
  name: string;
  unitName: string;
  isAdult: boolean;
}

export interface RecordNightRecordInput {
  title: string;
  category: RecordNightCategory;
  measure: RecordNightMeasure;
  durationSeconds?: number | null;
  notes?: string;
}

export interface RecordNightUpdateRecordInput extends RecordNightRecordInput {
  status: RecordNightRecordStatus;
}

// Esito di ogni azione: il tentativo e il record toccati (null se non toccati).
// Nascondere o mostrare un record (`updateRecord`) dice anche quanti tentativi
// sono stati ritirati, rimessi o lasciati ritirati (limite di 2 o unicità).
export interface RecordNightActionResult {
  entry: RecordNightEntry | null;
  record: RecordNightRecord | null;
  withdrawnCount: number;
  restoredCount: number;
  notRestoredCount: number;
}

interface RawActionResult {
  ok: boolean;
  action: string;
  entry?: (DocumentData & { id: string }) | null;
  record?: (DocumentData & { id: string }) | null;
  withdrawnCount?: number;
  restoredCount?: number;
  notRestoredCount?: number;
  people?: unknown;
  isStaff?: unknown;
  canManageStaff?: unknown;
  participants?: unknown;
  candidates?: unknown;
  staffUids?: unknown;
}

const participantCallable = httpsCallable<Record<string, unknown>, RawActionResult>(
  functions,
  "recordNightParticipant",
);

const adminCallable = httpsCallable<Record<string, unknown>, RawActionResult>(
  functions,
  "recordNightAdmin",
);

const CATEGORY_VALUES: ReadonlyArray<string> = RECORD_NIGHT_CATEGORIES.map((item) => item.value);
const MEASURE_VALUES: ReadonlyArray<string> = RECORD_NIGHT_MEASURES.map((item) => item.value);

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function asNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asMeasure(value: unknown): RecordNightMeasure {
  return typeof value === "string" && MEASURE_VALUES.includes(value)
    ? (value as RecordNightMeasure)
    : "other";
}

function asNullableMeasure(value: unknown): RecordNightMeasure | null {
  return typeof value === "string" && MEASURE_VALUES.includes(value)
    ? (value as RecordNightMeasure)
    : null;
}

function asCategory(value: unknown): RecordNightCategory {
  return typeof value === "string" && CATEGORY_VALUES.includes(value)
    ? (value as RecordNightCategory)
    : "fantasia";
}

function asWithdrawnBy(value: unknown): RecordNightWithdrawnBy | null {
  return value === "self" || value === "staff" || value === "system" ? value : null;
}

function asCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function asEntryStatus(value: unknown): RecordNightEntryStatus {
  switch (value) {
    case "approved":
    case "rejected":
    case "withdrawn":
      return value;
    default:
      return "pending";
  }
}

export function mapRecordNightRecord(id: string, data: DocumentData): RecordNightRecord {
  return {
    id,
    title: asString(data.title),
    category: asCategory(data.category),
    measure: asMeasure(data.measure),
    durationSeconds: asNullableNumber(data.durationSeconds),
    notes: asString(data.notes),
    challengerCount:
      typeof data.challengerCount === "number" && data.challengerCount > 0
        ? Math.floor(data.challengerCount)
        : 0,
    status: data.status === "hidden" ? "hidden" : "open",
    createdFromEntryId: asNullableString(data.createdFromEntryId),
    createdAt: asString(data.createdAt),
    updatedAt: asString(data.updatedAt),
    createdBy: asString(data.createdBy),
  };
}

export function mapRecordNightEntry(id: string, data: DocumentData): RecordNightEntry {
  const kind: RecordNightEntryKind = data.kind === "challenge" ? "challenge" : "proposal";
  return {
    id,
    registrationId: asString(data.registrationId),
    ownerUid: asNullableString(data.ownerUid),
    participantName: asString(data.participantName),
    kind,
    proposedText: asNullableString(data.proposedText),
    proposedMeasure: asNullableMeasure(data.proposedMeasure),
    proposedDurationSeconds: asNullableNumber(data.proposedDurationSeconds),
    proposedNeeds: asString(data.proposedNeeds),
    recordId: asNullableString(data.recordId),
    status: asEntryStatus(data.status),
    statusBeforeWithdraw:
      data.statusBeforeWithdraw === "pending" || data.statusBeforeWithdraw === "approved"
        ? data.statusBeforeWithdraw
        : null,
    withdrawnBy: asWithdrawnBy(data.withdrawnBy),
    withdrawnWithRecordHide: data.withdrawnWithRecordHide === true,
    rejectionReason: asString(data.rejectionReason),
    createdByAdmin: data.createdByAdmin === true,
    createdAt: asString(data.createdAt),
    updatedAt: asString(data.updatedAt),
    decidedAt: asNullableString(data.decidedAt),
    decidedBy: asNullableString(data.decidedBy),
  };
}

function recordsCollection(stakeId: string, activityId: string) {
  return collection(db, "stakes", stakeId, "activities", activityId, "records");
}

function entriesCollection(stakeId: string, activityId: string) {
  return collection(db, "stakes", stakeId, "activities", activityId, "recordEntries");
}

function mapResult(raw: RawActionResult): RecordNightActionResult {
  return {
    entry: raw.entry ? mapRecordNightEntry(raw.entry.id, raw.entry) : null,
    record: raw.record ? mapRecordNightRecord(raw.record.id, raw.record) : null,
    withdrawnCount: asCount(raw.withdrawnCount),
    restoredCount: asCount(raw.restoredCount),
    notRestoredCount: asCount(raw.notRestoredCount),
  };
}

function mapPeople(raw: unknown): RecordNightPerson[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .filter((item) => typeof item.registrationId === "string" && item.registrationId)
    .map((item) => ({
      registrationId: asString(item.registrationId),
      displayName: asString(item.displayName),
      isSelf: item.isSelf === true,
    }));
}

function mapStaffCandidates(raw: unknown): RecordNightStaffCandidate[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .filter((item) => typeof item.uid === "string" && item.uid)
    .map((item) => ({
      uid: asString(item.uid),
      registrationId: asString(item.registrationId),
      name: asString(item.name),
      unitName: asString(item.unitName),
      isAdult: item.isAdult === true,
      isStaff: item.isStaff === true,
    }));
}

function mapParticipantOptions(raw: unknown): RecordNightParticipantOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .filter((item) => typeof item.registrationId === "string" && item.registrationId)
    .map((item) => ({
      registrationId: asString(item.registrationId),
      name: asString(item.name),
      unitName: asString(item.unitName),
      isAdult: item.isAdult === true,
    }));
}

// La durata viaggia solo con "Quante volte in un tempo dato": se il ragazzo
// cambia misura dopo aver scritto i secondi, il valore vecchio non parte.
function durationFor(measure: RecordNightMeasure, durationSeconds?: number | null) {
  return measureNeedsDuration(measure) ? (durationSeconds ?? null) : null;
}

async function callParticipant(
  stakeId: string,
  activityId: string,
  action: string,
  payload: Record<string, unknown> = {},
) {
  const result = await participantCallable({ stakeId, activityId, action, ...payload });
  return mapResult(result.data);
}

async function callAdmin(
  stakeId: string,
  activityId: string,
  action: string,
  payload: Record<string, unknown> = {},
) {
  const result = await adminCallable({ stakeId, activityId, action, ...payload });
  return mapResult(result.data);
}

// Messaggio da mostrare dopo un errore delle callable: i messaggi del server
// sono già in italiano e pensati per l'utente (limite, chiusura, duplicati).
export function getRecordNightErrorMessage(error: unknown) {
  const { code, message } = (error ?? {}) as { code?: string; message?: unknown };
  const userFacing = [
    "functions/failed-precondition",
    "functions/invalid-argument",
    "functions/not-found",
    "functions/permission-denied",
    "functions/unauthenticated",
  ];
  if (code && userFacing.includes(code) && typeof message === "string" && message.trim()) {
    return message;
  }
  return "Non è stato possibile completare l'operazione. Controlla la connessione e riprova.";
}

export const recordNightService = {
  // Record aperti: l'unica lettura concessa ai membri del palo (la rule
  // richiede proprio questo filtro). Il client mostra poi solo quelli con
  // iscritti (isRecordVisibleToParticipants).
  async listRecords(stakeId: string, activityId: string) {
    const snapshot = await getDocsFromServer(
      query(recordsCollection(stakeId, activityId), where("status", "==", "open")),
    );
    return snapshot.docs.map((item) => mapRecordNightRecord(item.id, item.data()));
  },

  // Solo staff: tutti i record, nascosti compresi.
  async listAllRecords(stakeId: string, activityId: string) {
    const snapshot = await getDocsFromServer(recordsCollection(stakeId, activityId));
    return snapshot.docs.map((item) => mapRecordNightRecord(item.id, item.data()));
  },

  // I tentativi di chi è loggato (un genitore vede anche quelli dei figli). La
  // rule richiede proprio questo filtro.
  async listOwnEntries(stakeId: string, activityId: string, uid: string) {
    const snapshot = await getDocsFromServer(
      query(entriesCollection(stakeId, activityId), where("ownerUid", "==", uid)),
    );
    return snapshot.docs
      .map((item) => mapRecordNightEntry(item.id, item.data()))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  },

  // Solo staff: tutti i tentativi, con i nomi.
  async listAllEntries(stakeId: string, activityId: string) {
    const snapshot = await getDocsFromServer(entriesCollection(stakeId, activityId));
    return snapshot.docs
      .map((item) => mapRecordNightEntry(item.id, item.data()))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  },

  // --- Partecipante (callable recordNightParticipant) ---------------------

  // Per chi posso agire (me stesso e i figli iscritti) e se gestisco i record.
  // Sola lettura, funziona anche dopo la chiusura delle iscrizioni.
  async getContext(stakeId: string, activityId: string): Promise<RecordNightContext> {
    const result = await participantCallable({ stakeId, activityId, action: "context" });
    return {
      people: mapPeople(result.data.people),
      isStaff: result.data.isStaff === true,
      canManageStaff: result.data.canManageStaff === true,
    };
  },

  // `registrationId` assente = la propria iscrizione (`user_<uid>`); un genitore
  // passa quella del figlio (`child_<uid>_<childId>`).
  propose(
    stakeId: string,
    activityId: string,
    input: RecordNightProposalInput & { registrationId?: string },
  ) {
    return callParticipant(stakeId, activityId, "propose", {
      text: input.text,
      measure: input.measure,
      durationSeconds: durationFor(input.measure, input.durationSeconds),
      needs: input.needs ?? "",
      ...(input.registrationId ? { registrationId: input.registrationId } : {}),
    });
  },

  challenge(stakeId: string, activityId: string, recordId: string, registrationId?: string) {
    return callParticipant(stakeId, activityId, "challenge", {
      recordId,
      ...(registrationId ? { registrationId } : {}),
    });
  },

  edit(stakeId: string, activityId: string, entryId: string, input: RecordNightProposalInput) {
    return callParticipant(stakeId, activityId, "edit", {
      entryId,
      text: input.text,
      measure: input.measure,
      durationSeconds: durationFor(input.measure, input.durationSeconds),
      needs: input.needs ?? "",
    });
  },

  withdraw(stakeId: string, activityId: string, entryId: string) {
    return callParticipant(stakeId, activityId, "withdraw", { entryId });
  },

  // "Annulla" dopo un ritiro: rimette il tentativo com'era.
  restore(stakeId: string, activityId: string, entryId: string) {
    return callParticipant(stakeId, activityId, "restore", { entryId });
  },

  // --- Admin (callable recordNightAdmin) ----------------------------------

  approve(stakeId: string, activityId: string, entryId: string, input: RecordNightRecordInput) {
    return callAdmin(stakeId, activityId, "approve", {
      entryId,
      title: input.title,
      category: input.category,
      measure: input.measure,
      durationSeconds: durationFor(input.measure, input.durationSeconds),
      notes: input.notes ?? "",
    });
  },

  merge(stakeId: string, activityId: string, entryId: string, recordId: string) {
    return callAdmin(stakeId, activityId, "merge", { entryId, recordId });
  },

  reject(stakeId: string, activityId: string, entryId: string, reason: string) {
    return callAdmin(stakeId, activityId, "reject", { entryId, reason });
  },

  // "Riporta in attesa": annulla approva, unisci e rifiuta.
  reopen(stakeId: string, activityId: string, entryId: string) {
    return callAdmin(stakeId, activityId, "reopen", { entryId });
  },

  // "Nuovo record": nasce `open` con 0 iscritti, quindi invisibile ai ragazzi
  // finché qualcuno non ci entra con `addParticipant`.
  createRecord(stakeId: string, activityId: string, input: RecordNightRecordInput) {
    return callAdmin(stakeId, activityId, "createRecord", {
      title: input.title,
      category: input.category,
      measure: input.measure,
      durationSeconds: durationFor(input.measure, input.durationSeconds),
      notes: input.notes ?? "",
    });
  },

  updateRecord(
    stakeId: string,
    activityId: string,
    recordId: string,
    input: RecordNightUpdateRecordInput,
  ) {
    return callAdmin(stakeId, activityId, "updateRecord", {
      recordId,
      title: input.title,
      category: input.category,
      measure: input.measure,
      durationSeconds: durationFor(input.measure, input.durationSeconds),
      // Se assente il server lascia le note com'erano.
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      status: input.status,
    });
  },

  // "Iscrivi qualcuno": `registrationId` è `user_<uid>` o `child_...`.
  addParticipant(stakeId: string, activityId: string, recordId: string, registrationId: string) {
    return callAdmin(stakeId, activityId, "addParticipant", { recordId, registrationId });
  },

  // Ritiro fatto dallo staff: non c'è "Annulla" per il ragazzo.
  withdrawEntry(stakeId: string, activityId: string, entryId: string) {
    return callAdmin(stakeId, activityId, "withdrawEntry", { entryId });
  },

  // Iscrizioni attive dell'attività per "Iscrivi qualcuno" (solo staff): chi non
  // è admin non può leggerle tutte dalle rules, le passa il server.
  async listParticipants(stakeId: string, activityId: string): Promise<RecordNightParticipantOption[]> {
    const result = await adminCallable({ stakeId, activityId, action: "listParticipants" });
    return mapParticipantOptions(result.data.participants);
  },

  // Solo admin e super_admin del palo: chi si può mettere in staff (iscrizioni
  // `user_` attive, adulti per primi) e chi lo è già.
  async listStaff(stakeId: string, activityId: string): Promise<RecordNightStaffCandidate[]> {
    const result = await adminCallable({ stakeId, activityId, action: "listStaff" });
    return mapStaffCandidates(result.data.candidates);
  },

  // Solo admin e super_admin del palo: mette o toglie `uid` dall'elenco di chi
  // gestisce i record. Mettere richiede un'iscrizione attiva all'attività.
  // Restituisce l'elenco aggiornato degli uid.
  async setStaff(stakeId: string, activityId: string, uid: string, enabled: boolean): Promise<string[]> {
    const result = await adminCallable({ stakeId, activityId, action: "setStaff", uid, enabled });
    return Array.isArray(result.data.staffUids)
      ? result.data.staffUids.filter((item): item is string => typeof item === "string")
      : [];
  },
};
