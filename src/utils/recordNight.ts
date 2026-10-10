// Notte dei Record (docs/NOTTE_DEI_RECORD.md): etichette, regole e helper puri
// usati dalle pagine. Gli elenchi di valori combaciano con
// functions/lib/recordNight.js (lo controlla functions/tests/recordNightLogic.test.mjs).

import type {
  Event,
  RecordNightCategory,
  RecordNightEntry,
  RecordNightMeasure,
  RecordNightRecord,
} from "@/types";
// Import relativo con estensione: i test di tests/ caricano questo file con
// Node, che non conosce l'alias "@/".
import { normalizeSurveyAnswer } from "./surveyClustering.ts";

// ---------------------------------------------------------------------------
// Tabelle
// ---------------------------------------------------------------------------

export const RECORD_NIGHT_CATEGORIES: ReadonlyArray<{
  value: RecordNightCategory;
  label: string;
}> = [
  { value: "resistenza", label: "Resistenza" },
  { value: "velocita", label: "Velocità" },
  { value: "precisione", label: "Precisione" },
  { value: "equilibrio", label: "Equilibrio" },
  { value: "mente", label: "Mente" },
  { value: "fantasia", label: "Fantasia" },
];

// Chi vince: `higher` il valore più alto, `lower` il più basso, `admin` lo
// decide l'organizzazione la sera (fase 2).
export type RecordNightWinDirection = "higher" | "lower" | "admin";

export const RECORD_NIGHT_MEASURES: ReadonlyArray<{
  value: RecordNightMeasure;
  label: string;
  wins: RecordNightWinDirection;
  winsLabel: string;
}> = [
  { value: "count_in_time", label: "Quante volte in un tempo dato", wins: "higher", winsLabel: "più alto" },
  { value: "count_streak", label: "Quante di fila senza sbagliare", wins: "higher", winsLabel: "più alto" },
  { value: "longest_time", label: "Quanto tempo resisti", wins: "higher", winsLabel: "più alto" },
  { value: "fastest_time", label: "Quanto ci metti", wins: "lower", winsLabel: "più basso" },
  { value: "distance", label: "Quanto lontano o quanto in alto", wins: "higher", winsLabel: "più alto" },
  { value: "other", label: "Altro, lo spiego io", wins: "admin", winsLabel: "deciso dall'admin" },
];

// Massimo di tentativi pending/approved per persona (applicato dal server).
export const RECORD_NIGHT_MAX_ENTRIES = 2;
export const RECORD_NIGHT_DURATION_RANGE = { min: 10, max: 60 } as const;
// Lunghezze massime dei campi (applicate dal server).
export const RECORD_NIGHT_LIMITS = {
  title: 80,
  notes: 200,
  text: 120,
  needs: 120,
  reason: 200,
} as const;

export function getRecordNightCategoryLabel(value: RecordNightCategory) {
  return RECORD_NIGHT_CATEGORIES.find((item) => item.value === value)?.label ?? value;
}

export function getRecordNightMeasureLabel(value: RecordNightMeasure) {
  return RECORD_NIGHT_MEASURES.find((item) => item.value === value)?.label ?? value;
}

// Etichette brevi della misura, per l'elenco e le card ("In 60 secondi",
// "Di fila"...). Le etichette lunghe restano nel modulo "Come si misura?".
export function getRecordNightMeasureShortLabel(
  value: RecordNightMeasure,
  durationSeconds?: number | null,
) {
  switch (value) {
    case "count_in_time":
      return `In ${durationSeconds ?? RECORD_NIGHT_DURATION_RANGE.max} secondi`;
    case "count_streak":
      return "Di fila";
    case "longest_time":
      return "Più a lungo";
    case "fastest_time":
      return "Tempo";
    case "distance":
      return "Distanza o altezza";
    default:
      return "Altro";
  }
}

export function getRecordNightWinDirection(value: RecordNightMeasure): RecordNightWinDirection {
  return RECORD_NIGHT_MEASURES.find((item) => item.value === value)?.wins ?? "admin";
}

// Il campo "secondi" serve solo a "Quante volte in un tempo dato".
export function measureNeedsDuration(value: RecordNightMeasure) {
  return value === "count_in_time";
}

// ---------------------------------------------------------------------------
// Record e tentativi
// ---------------------------------------------------------------------------

// Agli altri si mostra un record solo se è aperto e ha almeno un iscritto.
export function isRecordVisibleToParticipants(record: RecordNightRecord) {
  return record.status === "open" && record.challengerCount > 0;
}

// 1 iscritto = "Record da stabilire", 2 o più = "Sfida · N sfidanti".
export function getRecordChallengerLabel(count: number) {
  if (count >= 2) return `Sfida · ${count} sfidanti`;
  if (count === 1) return "Record da stabilire";
  return "";
}

export function isEntryActive(entry: Pick<RecordNightEntry, "status">) {
  return entry.status === "pending" || entry.status === "approved";
}

export function countActiveEntries(entries: ReadonlyArray<Pick<RecordNightEntry, "status">>) {
  return entries.filter(isEntryActive).length;
}

export function canAddMoreEntries(entries: ReadonlyArray<Pick<RecordNightEntry, "status">>) {
  return countActiveEntries(entries) < RECORD_NIGHT_MAX_ENTRIES;
}

// Record per categoria, nell'ordine fisso delle categorie; dentro la categoria
// prima i più sfidati. Le categorie vuote non compaiono. Non filtra per stato:
// ai partecipanti si passa prima `records.filter(isRecordVisibleToParticipants)`.
export function groupRecordsByCategory(records: ReadonlyArray<RecordNightRecord>) {
  return RECORD_NIGHT_CATEGORIES.map((category) => ({
    category: category.value,
    label: category.label,
    records: records
      .filter((record) => record.category === category.value)
      .sort(
        (left, right) =>
          right.challengerCount - left.challengerCount ||
          left.title.localeCompare(right.title, "it-IT"),
      ),
  })).filter((group) => group.records.length > 0);
}

// Accesso negato, da Firestore o da una callable. Con l'SDK web Firestore usa
// il codice `permission-denied`, le callable `functions/permission-denied`.
// Una lettura di un documento che non esiste (o non si può vedere) risponde
// così: le pagine lo trattano come "non trovato", non come errore di rete.
export function isPermissionDenied(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "permission-denied" || code === "functions/permission-denied";
}

// ---------------------------------------------------------------------------
// Finestra di iscrizione (stessa regola del server)
// ---------------------------------------------------------------------------

export type RecordNightWindow = "disabled" | "open" | "closed";

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// `recordsCloseAt` se valorizzato, altrimenti `startDate`. Un valore scritto ma
// illeggibile dà null (chiuso), come sul server.
export function getRecordNightCloseAt(
  event: Pick<Event, "recordsCloseAt" | "startDate">,
): Date | null {
  return event.recordsCloseAt
    ? parseDate(event.recordsCloseAt)
    : parseDate(event.startDate);
}

export function getRecordNightWindow(
  event: Pick<Event, "recordsEnabled" | "recordsCloseAt" | "startDate">,
  now: Date = new Date(),
): RecordNightWindow {
  if (event.recordsEnabled !== true) return "disabled";
  const closeAt = getRecordNightCloseAt(event);
  if (!closeAt || now.getTime() >= closeAt.getTime()) return "closed";
  return "open";
}

const deadlineDateFormatter = new Intl.DateTimeFormat("it-IT", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/Rome",
});

const deadlineTimeFormatter = new Intl.DateTimeFormat("it-IT", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Rome",
});

// "giovedì 15 ottobre, 21:00"
export function formatRecordNightDeadline(closeAt: Date) {
  return `${deadlineDateFormatter.format(closeAt)}, ${deadlineTimeFormatter.format(closeAt)}`;
}

const weekdayFormatter = new Intl.DateTimeFormat("it-IT", {
  weekday: "long",
  timeZone: "Europe/Rome",
});

// Giorno e data della serata, dall'inizio dell'attività: "venerdì 16 ottobre".
// Stringa vuota se la data non si legge.
export function formatRecordNightDay(startDate: string | null | undefined) {
  const parsed = parseDate(startDate);
  return parsed ? deadlineDateFormatter.format(parsed) : "";
}

// Solo il giorno della settimana: "venerdì".
export function formatRecordNightWeekday(startDate: string | null | undefined) {
  const parsed = parseDate(startDate);
  return parsed ? weekdayFormatter.format(parsed) : "";
}

export interface RecordNightCountdown {
  days: number;
  hours: number;
  minutes: number;
}

// Tempo che manca alla chiusura, arrotondato al minuto per eccesso: finché le
// iscrizioni sono aperte il tabellone non mostra mai 00:00:00. Null se è già
// chiuso.
export function getRecordNightCountdown(closeAt: Date, now: Date = new Date()) {
  const remaining = closeAt.getTime() - now.getTime();
  if (remaining <= 0) return null;
  const totalMinutes = Math.ceil(remaining / 60_000);
  return {
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60,
  } satisfies RecordNightCountdown;
}

// "6 giorni, 4 ore e 12 minuti": la stessa durata del tabellone, a parole.
export function describeRecordNightCountdown({ days, hours, minutes }: RecordNightCountdown) {
  const parts = [
    days ? `${days} ${days === 1 ? "giorno" : "giorni"}` : "",
    hours ? `${hours} ${hours === 1 ? "ora" : "ore"}` : "",
    minutes ? `${minutes} ${minutes === 1 ? "minuto" : "minuti"}` : "",
  ].filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "meno di un minuto";
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Record simili mentre il ragazzo scrive
// ---------------------------------------------------------------------------

// Parole che non distinguono un record da un altro: articoli e preposizioni
// (le parole sotto le 3 lettere cadono comunque), verbi e misure generici.
const SIMILARITY_STOPWORDS = new Set([
  "una", "uno", "per", "con", "del", "dei", "della", "delle", "dello", "nel",
  "nella", "nelle", "alla", "alle", "dal", "dalla", "sul", "sulla", "sui",
  "che", "non", "più", "piu", "come", "sono", "sto", "mio", "mia", "miei",
  "fare", "faccio", "fai", "fatto", "riesco", "riuscire", "provo", "provare",
  "quante", "quanti", "quanto", "volte", "fila", "senza", "sbagliare",
  "secondi", "secondo", "minuto", "minuti", "tempo", "record", "sfida",
  "tutto", "tutti", "ogni", "solo", "anche",
]);

function similarityTokens(value: string) {
  const tokens = normalizeSurveyAnswer(value)
    .split(" ")
    .filter(
      (token) =>
        token.length >= 3 &&
        !/^\d+$/.test(token) &&
        !SIMILARITY_STOPWORDS.has(token),
    );
  return Array.from(new Set(tokens));
}

function sharedPrefixLength(left: string, right: string) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

// "salti" ~ "salto" ~ "saltare": stessa radice, ultime lettere diverse. Sotto le
// quattro lettere servono parole identiche.
function tokensMatch(left: string, right: string) {
  if (left === right) return true;
  const shortest = Math.min(left.length, right.length);
  if (shortest < 4) return false;
  return sharedPrefixLength(left, right) >= Math.max(3, shortest - 1);
}

// 0-1: media fra quanto di ciò che si scrive è spiegato dal titolo e quanto del
// titolo compare in ciò che si scrive. 0 se non c'è nulla in comune.
export function recordTextSimilarity(typed: string, title: string) {
  const typedTokens = similarityTokens(typed);
  const titleTokens = similarityTokens(title);
  if (!typedTokens.length || !titleTokens.length) return 0;
  const matchedTyped = typedTokens.filter((token) =>
    titleTokens.some((other) => tokensMatch(token, other)),
  ).length;
  if (matchedTyped === 0) return 0;
  const matchedTitle = titleTokens.filter((token) =>
    typedTokens.some((other) => tokensMatch(token, other)),
  ).length;
  return (matchedTyped / typedTokens.length + matchedTitle / titleTokens.length) / 2;
}

export interface SimilarRecord {
  record: RecordNightRecord;
  score: number;
}

// Record aperti e visibili simili al testo che si sta scrivendo, dal più
// simile. Con due o più parole servono almeno due parole in comune; con una
// sola basta una (il ragazzo ha appena iniziato a scrivere).
export function findSimilarRecords(
  typed: string,
  records: ReadonlyArray<RecordNightRecord>,
  options: { limit?: number; minScore?: number } = {},
): SimilarRecord[] {
  const { limit = 3, minScore = 0.5 } = options;
  const typedTokens = similarityTokens(typed);
  if (!typedTokens.length) return [];
  const required = Math.min(2, typedTokens.length);

  return records
    .filter(isRecordVisibleToParticipants)
    .map((record) => {
      const titleTokens = similarityTokens(record.title);
      const matched = typedTokens.filter((token) =>
        titleTokens.some((other) => tokensMatch(token, other)),
      ).length;
      return { record, matched, score: recordTextSimilarity(typed, record.title) };
    })
    .filter((item) => item.matched >= required && item.score >= minScore)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.record.challengerCount - left.record.challengerCount,
    )
    .slice(0, limit)
    .map(({ record, score }) => ({ record, score }));
}
