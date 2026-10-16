import type { Event, RecordNightEntry, RecordNightMeasure, RecordNightRecord } from "@/types";

function timeOf(value: string | null | undefined) {
  if (!value) return Number.NaN;
  return new Date(value).getTime();
}

// Attività di cui stampare i certificati: quella con la Notte dei Record in
// corso o, se nessuna è in corso, la più vicina a oggi (anche già finita: i
// certificati si stampano la sera stessa o nei giorni dopo).
export function pickCertificateEvent(events: ReadonlyArray<Event>, now = Date.now()) {
  const distanceFromNow = (event: Event) => {
    const start = timeOf(event.startDate);
    const endValue = timeOf(event.endDate);
    const end = Number.isFinite(endValue) && endValue >= start ? endValue : start;
    if (now >= start && now <= end) return 0;
    return Math.min(Math.abs(now - start), Math.abs(now - end));
  };

  return (
    events
      .filter((event) => event.recordsEnabled === true && Number.isFinite(timeOf(event.startDate)))
      .sort((left, right) => distanceFromNow(left) - distanceFromNow(right))[0] ?? null
  );
}

// Cosa scrivere dopo il numero, in base a come si misura il record.
export function getCertificateUnit(measure: RecordNightMeasure, durationSeconds: number | null) {
  switch (measure) {
    case "count_in_time":
      return `in ${durationSeconds ?? 60} secondi`;
    case "count_streak":
      return "di fila";
    case "longest_time":
    case "fastest_time":
      return "secondi";
    case "distance":
      return "metri";
    default:
      return "";
  }
}

export function getCertificateValuePlaceholder(measure: RecordNightMeasure | null) {
  switch (measure) {
    case "fastest_time":
      return "es. 18,4";
    case "distance":
      return "es. 3,20";
    case "longest_time":
      return "es. 95";
    default:
      return "es. 42";
  }
}

// Nomi di chi ha sfidato quel record (tentativi approvati), per sceglierli con
// un tocco. Li legge solo lo staff.
export function getRecordChallengerNames(
  entries: ReadonlyArray<RecordNightEntry>,
  recordId: string,
) {
  const names = entries
    .filter((entry) => entry.recordId === recordId && entry.status === "approved")
    .map((entry) => entry.participantName.trim())
    .filter(Boolean);
  return [...new Set(names)].sort((left, right) => left.localeCompare(right, "it"));
}

export function sortRecordsByTitle(records: ReadonlyArray<RecordNightRecord>) {
  return [...records].sort((left, right) => left.title.localeCompare(right.title, "it"));
}

// Il risultato va nelle caselle del tabellone solo se è corto; altrimenti si
// scrive per intero.
export const CERTIFICATE_TILE_LIMIT = 7;

export function splitCertificateTiles(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > CERTIFICATE_TILE_LIMIT) return null;
  return Array.from(trimmed);
}

export function formatCertificateDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return "";
  return new Intl.DateTimeFormat("it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

export function todayIsoDate(now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
