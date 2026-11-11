import type { Event } from "@/types";

const shortDateFormatter = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

// An empty or invalid date (an announced activity has no registration
// window yet) must not throw: Intl.format(Invalid Date) is a RangeError that
// takes the whole page down. Callers show their own «Da scegliere».
function safeFormat(formatter: Intl.DateTimeFormat, isoDate: string) {
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? "" : formatter.format(date);
}

export function formatShortDate(isoDate: string) {
  return safeFormat(shortDateFormatter, isoDate);
}

export function formatDateTime(isoDate: string) {
  return safeFormat(dateTimeFormatter, isoDate);
}

export function formatDateOnly(isoDate: string) {
  return safeFormat(shortDateFormatter, isoDate);
}

export function formatDateRange(startDate: string, endDate: string) {
  const start = new Date(startDate);
  const end = new Date(endDate);

  const sameDay = start.toDateString() === end.toDateString();

  if (sameDay) {
    return `${formatShortDate(startDate)} • ${start.toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
    })} - ${end.toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  return `${formatShortDate(startDate)} - ${formatShortDate(endDate)}`;
}

function formatClock(date: Date) {
  return date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

/** 00:00 locale: con `timeToBeDefined` vuol dire «ora non ancora scelta». */
export function isMidnight(isoDate: string) {
  const date = new Date(isoDate);
  return date.getHours() === 0 && date.getMinutes() === 0;
}

type WhenEvent = Pick<Event, "startDate" | "endDate"> & { timeToBeDefined?: boolean };

/**
 * L'unico formattatore di «quando» di un'attività (settimo incremento). Con
 * `timeToBeDefined` la fine non ha ora (niente «23:59») e l'inizio si mostra
 * solo se non è 00:00: «12 dic 2026 · dalle 19:00» o «12 dic 2026 · ora da
 * definire»; su più giorni solo i giorni, come sempre.
 */
export function formatEventWhen(event: WhenEvent, options: { missingTime?: string } = {}) {
  if (!event.timeToBeDefined) {
    return formatDateRange(event.startDate, event.endDate);
  }
  const start = new Date(event.startDate);
  const end = new Date(event.endDate || event.startDate);
  if (start.toDateString() !== end.toDateString()) {
    return `${formatShortDate(event.startDate)} - ${formatShortDate(event.endDate)}`;
  }
  const time = isMidnight(event.startDate)
    ? options.missingTime ?? "ora da definire"
    : `dalle ${formatClock(start)}`;
  return `${formatShortDate(event.startDate)} • ${time}`;
}

/** Inizio di un'attività con l'ora, o solo il giorno se l'ora non è scelta. */
export function formatEventStart(event: Pick<Event, "startDate"> & { timeToBeDefined?: boolean }) {
  return event.timeToBeDefined && isMidnight(event.startDate)
    ? formatShortDate(event.startDate)
    : formatDateTime(event.startDate);
}

export function formatEventWindow(event: WhenEvent) {
  return formatEventWhen(event);
}

export function toDatetimeLocalValue(isoDate?: string | null) {
  if (!isoDate) {
    return "";
  }

  const date = new Date(isoDate);
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  const localDate = new Date(date.getTime() - timezoneOffset);

  return localDate.toISOString().slice(0, 16);
}

export function fromDatetimeLocalValue(localValue: string) {
  if (!localValue) {
    return "";
  }

  return new Date(localValue).toISOString();
}

export function formatNullableValue(value?: string | null) {
  return value && value.trim() ? value : "Non specificato";
}

export function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
