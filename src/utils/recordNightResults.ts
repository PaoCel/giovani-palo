import type { RecordNightMeasure, RecordNightRecord } from "../types/models.ts";

export interface RecordNightResult {
  winnerName: string;
  // Seconds for timed records, otherwise the count/distance in the record's unit.
  value: number;
}

export function parseRecordNightResult(input: unknown): RecordNightResult | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const data = input as Record<string, unknown>;
  const name = typeof data.winnerName === "string" ? data.winnerName.trim() : "";
  if (!name || name.length > 100 || typeof data.value !== "number"
    || !Number.isFinite(data.value) || data.value <= 0) return null;
  return { winnerName: name, value: data.value };
}

const number = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3, useGrouping: true });

export function getRecordNightResultRecords(
  records: ReadonlyArray<RecordNightRecord>, endDate: string, nowMs = Date.now(),
): RecordNightRecord[] {
  if (typeof endDate !== "string" || !endDate.trim()) return [];
  const end = new Date(endDate).getTime();
  if (!Number.isFinite(end) || end >= nowMs) return [];
  return records.filter(record => record.status === "open" && parseRecordNightResult(record.result));
}

export function formatRecordNightResult(value: number, measure: RecordNightMeasure): string {
  if (measure !== "longest_time" && measure !== "fastest_time") return number.format(value);
  const minutes = Math.floor(value / 60);
  const seconds = Math.round((value - minutes * 60) * 1000) / 1000;
  if (!minutes) return `${number.format(seconds)} s`;
  return seconds ? `${number.format(minutes)} min ${number.format(seconds)} s` : `${number.format(minutes)} min`;
}
