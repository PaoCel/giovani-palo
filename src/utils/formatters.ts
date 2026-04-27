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

export function formatShortDate(isoDate: string) {
  return shortDateFormatter.format(new Date(isoDate));
}

export function formatDateTime(isoDate: string) {
  return dateTimeFormatter.format(new Date(isoDate));
}

export function formatDateOnly(isoDate: string) {
  return shortDateFormatter.format(new Date(isoDate));
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

export function formatEventWindow(event: Event) {
  return formatDateRange(event.startDate, event.endDate);
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
