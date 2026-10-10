import type {
  RecordNightCategory,
  RecordNightEntry,
  RecordNightMeasure,
  RecordNightRecord,
} from "@/types";
import {
  RECORD_NIGHT_LIMITS,
  getRecordNightMeasureLabel,
  measureNeedsDuration,
} from "@/utils/recordNight";

// Helper puri della scheda admin "Record" (Notte dei Record).

// "Quante volte in un tempo dato · 60 secondi"
export function getMeasureFullLabel(
  measure: RecordNightMeasure | null,
  durationSeconds: number | null | undefined,
) {
  if (!measure) return "Non indicata";
  const label = getRecordNightMeasureLabel(measure);
  return measureNeedsDuration(measure) && typeof durationSeconds === "number"
    ? `${label} · ${durationSeconds} secondi`
    : label;
}

export function formatRecordersCount(count: number) {
  return count === 1 ? "1 iscritto" : `${count} iscritti`;
}

export function getInitials(name: string) {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0])[0] ?? "";
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

const dayTimeFormatter = new Intl.DateTimeFormat("it-IT", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Rome",
});

// "9 ott, 14:32"; stringa vuota se la data manca o è illeggibile.
export function formatShortDateTime(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : dayTimeFormatter.format(date);
}

// Titolo precompilato dal testo del ragazzo: stessa frase, iniziale maiuscola,
// niente punto finale, tagliata al massimo consentito. Poi lo riscrive l'admin.
export function suggestRecordTitle(text: string | null | undefined) {
  const cleaned = (text ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.!?\s]+$/u, "");
  if (!cleaned) return "";
  const capitalized = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return Array.from(capitalized).slice(0, RECORD_NIGHT_LIMITS.title).join("");
}

// Categoria suggerita dal modo di misurare. È solo un punto di partenza: la
// scelta resta dell'admin, che vede il campo già compilato e lo può cambiare.
export function suggestCategory(
  measure: RecordNightMeasure | null,
): RecordNightCategory | "" {
  switch (measure) {
    case "count_in_time":
    case "longest_time":
      return "resistenza";
    case "fastest_time":
    case "distance":
      return "velocita";
    case "count_streak":
      return "precisione";
    case "other":
      return "fantasia";
    default:
      return "";
  }
}

// Minuscolo, senza accenti e senza segni: per cercare un nome digitato di fretta.
export function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// `findSimilarRecords` guarda solo i record visibili ai ragazzi (con iscritti):
// all'admin servono anche quelli ancora vuoti, che un'unione può riempire.
export function asVisibleForSimilarity(records: ReadonlyArray<RecordNightRecord>) {
  return records
    .filter((record) => record.status === "open")
    .map((record) => ({
      ...record,
      challengerCount: Math.max(1, record.challengerCount),
    }));
}

// Da questo punteggio in su la card avvisa che la proposta sembra un record
// già esistente.
export const STRONG_SIMILARITY = 0.75;

// Tentativi ritirati insieme al record quando un adulto lo nasconde: il server
// li marca con `withdrawnWithRecordHide` e li rimette dentro se il record torna
// visibile e hanno ancora posto.
export function isWithdrawnWithRecord(entry: RecordNightEntry, record: RecordNightRecord) {
  return (
    entry.status === "withdrawn" &&
    entry.recordId === record.id &&
    entry.withdrawnWithRecordHide
  );
}

// Chi ha ritirato il tentativo, per la sezione "Ritirati".
export function getWithdrawalLabel(withdrawnBy: RecordNightEntry["withdrawnBy"]) {
  switch (withdrawnBy) {
    case "self":
      return "Ritiro del partecipante";
    case "staff":
      return "Ritirato da un adulto";
    case "system":
      return "Iscrizione annullata";
    default:
      return "Ritirato";
  }
}

// "3 persone", "1 persona".
export function formatPeopleCount(count: number) {
  return count === 1 ? "1 persona" : `${count} persone`;
}
