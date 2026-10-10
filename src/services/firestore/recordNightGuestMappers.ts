// Notte dei Record, richieste senza account: dalle risposte grezze delle callable
// ai tipi del client. Solo funzioni pure (nessun import di Firebase), così le
// prova tests/recordNightGuest.test.mjs le esegue con Node sulle risposte vere
// del backend. Un campo mancante o di tipo sbagliato prende un valore neutro,
// mai un errore: la pagina non deve rompersi per una risposta strana.

import type {
  RecordNightCategory,
  RecordNightGuestContext,
  RecordNightGuestMine,
  RecordNightGuestRequest,
  RecordNightGuestState,
  RecordNightGuestUnit,
  RecordNightMeasure,
  RecordNightPublicRecord,
  RecordNightRecordStatus,
  RecordNightRegistrationType,
  RecordNightRequestKind,
  RecordNightRequestStatus,
  RecordNightRequestSuggestion,
  RecordNightStaffRequest,
} from "@/types";
import { RECORD_NIGHT_CATEGORIES, RECORD_NIGHT_MEASURES } from "../../utils/recordNight.ts";
import { GUEST_STATE_TEXTS } from "../../utils/recordNightGuest.ts";

const CATEGORY_VALUES: ReadonlyArray<string> = RECORD_NIGHT_CATEGORIES.map((item) => item.value);
const MEASURE_VALUES: ReadonlyArray<string> = RECORD_NIGHT_MEASURES.map((item) => item.value);
const STATE_VALUES: ReadonlyArray<string> = Object.keys(GUEST_STATE_TEXTS);

type Raw = Record<string, unknown>;

function isRaw(value: unknown): value is Raw {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function asNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function asList(value: unknown): Raw[] {
  return Array.isArray(value) ? value.filter(isRaw) : [];
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item !== "")
    : [];
}

// Come mapRecordNightRecord: una categoria o una misura sconosciuta ripiega su
// un valore valido ("fantasia", "other") invece di rompere l'elenco.
function asCategory(value: unknown): RecordNightCategory {
  return typeof value === "string" && CATEGORY_VALUES.includes(value)
    ? (value as RecordNightCategory)
    : "fantasia";
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

function asKind(value: unknown): RecordNightRequestKind {
  return value === "challenge" ? "challenge" : "proposal";
}

// Contesto pubblico (`context`).
export function mapGuestContext(raw: unknown): RecordNightGuestContext {
  const data: Raw = isRaw(raw) ? raw : {};
  const units: RecordNightGuestUnit[] = asList(data.units)
    .filter((item) => typeof item.id === "string" && item.id !== "")
    .map((item) => ({ id: asString(item.id), name: asString(item.name) }));
  const records: RecordNightPublicRecord[] = asList(data.records)
    .filter((item) => typeof item.id === "string" && item.id !== "")
    .map((item) => ({
      id: asString(item.id),
      title: asString(item.title),
      category: asCategory(item.category),
      measure: asMeasure(item.measure),
      durationSeconds: asNullableNumber(item.durationSeconds),
    }));
  return {
    open: data.open === true,
    closeAt: asNullableString(data.closeAt),
    intakeOpen: data.intakeOpen === true,
    units,
    records,
  };
}

function asGuestState(value: unknown): RecordNightGuestState {
  return typeof value === "string" && STATE_VALUES.includes(value)
    ? (value as RecordNightGuestState)
    : "received";
}

// Una richiesta vista da chi l'ha inviata (un elemento di `mine`).
export function mapGuestRequest(raw: Raw): RecordNightGuestRequest {
  return {
    requestId: asString(raw.requestId),
    kind: asKind(raw.kind),
    firstName: asString(raw.firstName),
    lastName: asString(raw.lastName),
    unitName: asString(raw.unitName),
    text: asNullableString(raw.text),
    measure: asNullableMeasure(raw.measure),
    durationSeconds: asNullableNumber(raw.durationSeconds),
    needs: asString(raw.needs),
    recordId: asNullableString(raw.recordId),
    recordTitle: asNullableString(raw.recordTitle),
    state: asGuestState(raw.state),
    reason: asString(raw.reason),
    createdAt: asString(raw.createdAt),
    canWithdraw: raw.canWithdraw === true,
    canRestore: raw.canRestore === true,
  };
}

// `mine`: le richieste di questo telefono, dalla più recente.
export function mapGuestMine(raw: unknown): RecordNightGuestMine {
  const data: Raw = isRaw(raw) ? raw : {};
  return {
    open: data.open === true,
    closeAt: asNullableString(data.closeAt),
    requests: asList(data.requests)
      .filter((item) => typeof item.requestId === "string" && item.requestId !== "")
      .map(mapGuestRequest),
  };
}

function asRequestStatus(value: unknown): RecordNightRequestStatus {
  return value === "linked" || value === "rejected" || value === "withdrawn" ? value : "open";
}

function asRegistrationType(value: unknown): RecordNightRegistrationType {
  return value === "user" || value === "child" ? value : "manual";
}

function asRecordStatus(value: unknown): RecordNightRecordStatus | null {
  return value === "open" || value === "hidden" ? value : null;
}

function mapSuggestion(raw: Raw): RecordNightRequestSuggestion {
  return {
    registrationId: asString(raw.registrationId),
    name: asString(raw.name),
    unitName: asString(raw.unitName),
    type: asRegistrationType(raw.type),
    activeEntries: asCount(raw.activeEntries),
    alreadyOnRecord: raw.alreadyOnRecord === true,
  };
}

// Una richiesta vista dallo staff (`listRequests` e gli esiti delle azioni; in
// questi ultimi `duplicates` e `suggestions` non ci sono e restano vuoti).
export function mapStaffRequest(raw: Raw): RecordNightStaffRequest {
  const id = asString(raw.id) || asString(raw.requestId);
  return {
    id,
    status: asRequestStatus(raw.status),
    kind: asKind(raw.kind),
    firstName: asString(raw.firstName),
    lastName: asString(raw.lastName),
    unitId: asString(raw.unitId),
    unitName: asString(raw.unitName),
    personKey: asString(raw.personKey),
    proposedText: asNullableString(raw.proposedText),
    proposedMeasure: asNullableMeasure(raw.proposedMeasure),
    proposedDurationSeconds: asNullableNumber(raw.proposedDurationSeconds),
    proposedNeeds: asString(raw.proposedNeeds),
    recordId: asNullableString(raw.recordId),
    recordTitle: asNullableString(raw.recordTitle),
    recordStatus: asRecordStatus(raw.recordStatus),
    staffNote: asString(raw.staffNote),
    linkedRegistrationId: asNullableString(raw.linkedRegistrationId),
    linkedEntryId: asNullableString(raw.linkedEntryId),
    linkedBy: asNullableString(raw.linkedBy),
    linkedAt: asNullableString(raw.linkedAt),
    decidedBy: asNullableString(raw.decidedBy),
    decidedAt: asNullableString(raw.decidedAt),
    createdAt: asString(raw.createdAt),
    updatedAt: asString(raw.updatedAt),
    duplicates: asStringList(raw.duplicates),
    suggestions: asList(raw.suggestions).map(mapSuggestion),
  };
}

export interface RecordNightRequestQueue {
  requests: RecordNightStaffRequest[];
  // Richieste `open` in coda e tetto dei telefoni: lo staff può superarlo.
  openCount: number;
  openLimit: number;
}

// `listRequests`.
export function mapStaffQueue(raw: unknown): RecordNightRequestQueue {
  const data: Raw = isRaw(raw) ? raw : {};
  const requests = asList(data.requests)
    .map(mapStaffRequest)
    .filter((request) => request.id !== "");
  return {
    requests,
    openCount:
      typeof data.openCount === "number"
        ? asCount(data.openCount)
        : requests.filter((request) => request.status === "open").length,
    openLimit: asCount(data.openLimit),
  };
}
