// Modalità rapida di Crea attività (docs/ATTIVITA_MODULARI.md, «Settimo
// incremento»). Logica pura del foglio: validazione, payload dell'annunciata,
// avvisi (giorno passato, doppione) e ritorno ai campi per «Correggi».
// Import relativi con estensione: i test di tests/ caricano il file con Node.

import type { ActivityType, Event, EventWriteInput } from "../types/models.ts";
import { ANNUNCIATA as COPY } from "../copy/annunciata.ts";
import { buildEssentialDraft } from "./eventCreation.ts";
import { toDatetimeLocalValue } from "./formatters.ts";

export interface QuickValues {
  title: string;
  activityType: ActivityType;
  /** Giorno d'inizio, valore di <input type="date"> (AAAA-MM-GG). */
  date: string;
  /** Ora d'inizio facoltativa (HH:MM), vuota = ora da definire. */
  time: string;
  /** «Fino al» (AAAA-MM-GG): obbligatorio per i tipi su più giorni. */
  endDate: string;
  location: string;
}

export type QuickErrors = Partial<Record<"title" | "date" | "endDate", string>>;

export const EMPTY_QUICK_VALUES: QuickValues = {
  title: "", activityType: "standard", date: "", time: "", endDate: "", location: "",
};

const DAY = /^\d{4}-\d{2}-\d{2}$/u;
const CLOCK = /^\d{2}:\d{2}$/u;

function validDay(value: string) {
  return DAY.test(value) && Number.isFinite(Date.parse(`${value}T00:00`));
}

/** I tipi rafforzati durano più giorni: chiedono «Fino al». */
export function needsEndDate(type: ActivityType) {
  return type !== "standard";
}

export function validateQuick(values: QuickValues): QuickErrors {
  const errors: QuickErrors = {};
  if (!values.title.trim()) errors.title = COPY.erroreNome;
  if (!validDay(values.date)) errors.date = COPY.erroreData;
  if (needsEndDate(values.activityType)) {
    if (!validDay(values.endDate)) errors.endDate = COPY.erroreFine;
    else if (validDay(values.date) && values.endDate < values.date) errors.endDate = COPY.erroreFinePrima;
  }
  return errors;
}

/** Valori datetime-local di inizio e fine: 00:00 (o l'ora scelta) e 23:59 del giorno di fine. */
export function getQuickLocalRange(values: QuickValues) {
  const time = CLOCK.test(values.time) ? values.time : "00:00";
  const endDay = needsEndDate(values.activityType) && validDay(values.endDate) ? values.endDate : values.date;
  return { start: `${values.date}T${time}`, end: `${endDay}T23:59` };
}

/**
 * Payload dell'annunciata: `status: "planned"`, pubblica e visibile, ora da
 * definire (la rapida non chiede mai l'ora di fine), finestra d'iscrizione
 * vuota. Gli stessi campi della bozza essenziale del sesto incremento.
 */
export function buildQuickPayload(
  values: QuickValues,
  defaults?: { allowGuestRegistration: boolean; requireLoginForEdit: boolean },
): EventWriteInput {
  const range = getQuickLocalRange(values);
  return {
    ...buildEssentialDraft({
      title: values.title,
      activityType: values.activityType,
      startDate: range.start,
      endDate: range.end,
      location: values.location,
    }, defaults),
    status: "planned",
    isPublic: true,
    isVisible: true,
    timeToBeDefined: true,
  };
}

/** Il giorno di fine è già passato rispetto a oggi (ora locale). */
export function isQuickDatePast(values: QuickValues, now = new Date()) {
  if (!validDay(values.date)) return false;
  const range = getQuickLocalRange(values);
  return Date.parse(range.end) < now.getTime();
}

function sameLocalDay(isoDate: string, day: string) {
  return Boolean(isoDate) && toDatetimeLocalValue(isoDate).slice(0, 10) === day;
}

function normalizedTitle(value: string) {
  return value.trim().toLocaleLowerCase("it-IT").replace(/\s+/gu, " ");
}

/** Un'attività già nel calendario con lo stesso nome nello stesso giorno (avviso, non blocca). */
export function findQuickDuplicate(
  values: QuickValues,
  events: readonly Pick<Event, "id" | "title" | "startDate" | "status">[],
  ignoreId?: string,
) {
  const title = normalizedTitle(values.title);
  if (!title || !validDay(values.date)) return null;
  return events.find(event => event.id !== ignoreId
    && event.status !== "cancelled"
    && normalizedTitle(event.title) === title
    && sameLocalDay(event.startDate, values.date)) ?? null;
}

/** «Correggi»: i campi del foglio dall'attività salvata. */
export function quickValuesFromEvent(event: Pick<Event, "title" | "startDate" | "endDate" | "location" | "activityType" | "timeToBeDefined">): QuickValues {
  const start = toDatetimeLocalValue(event.startDate);
  const end = toDatetimeLocalValue(event.endDate);
  const activityType = event.activityType ?? "standard";
  const time = start.slice(11, 16);
  return {
    title: event.title,
    activityType,
    date: start.slice(0, 10),
    time: event.timeToBeDefined && time === "00:00" ? "" : time,
    endDate: needsEndDate(activityType) ? end.slice(0, 10) : "",
    location: event.location,
  };
}

/** Il foglio ha qualcosa di scritto che andrebbe perso chiudendo. */
export function hasQuickInput(values: QuickValues) {
  return Boolean(values.title.trim() || values.date || values.time || values.endDate || values.location.trim());
}
