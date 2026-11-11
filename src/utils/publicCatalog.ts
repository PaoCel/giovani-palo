// Pagine pubbliche (home e /activities): palo «Tutta Italia» e date come nel
// mockup approvato. Lo carica anche Node (tests/): niente alias "@/".

import { ANNUNCIATA } from "../copy/annunciata.ts";
import { CATALOGO } from "../copy/catalogo.ts";
import { fillCopy } from "../copy/parole.ts";

export interface PublicWhenEvent {
  startDate: string;
  endDate?: string;
  location?: string;
  /** Attività annunciata senza ora: le 00:00 e le 23:59 salvate non si mostrano. */
  timeToBeDefined?: boolean;
}

export interface PublicWhenOptions {
  /** Testo al posto del luogo quando manca («Luogo da definire» per un'annunciata). */
  missingPlace?: string;
}

export interface HomeWhenParts {
  date: string;
  suffix: string;
}

const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"] as const;

const MESI_LUNGHI = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
] as const;

const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"] as const;

const GIORNI_CORTI = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"] as const;

const PUBLIC_TYPES = ["standard", "overnight", "trip", "camp", "multi_day"] as const;

export type PublicActivityType = (typeof PUBLIC_TYPES)[number];

function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function asDate(value: string | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sameCalendarDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function isMidnight(date: Date) {
  return date.getHours() === 0 && date.getMinutes() === 0;
}

function hoursMinutes(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function placeOf(event: PublicWhenEvent, options: PublicWhenOptions) {
  return event.location?.trim() || options.missingPlace?.trim() || "";
}

function placeSuffix(event: PublicWhenEvent, options: PublicWhenOptions) {
  const place = placeOf(event, options);
  return place ? ` · ${place}` : "";
}

/** Id vuoto = tutta Italia. Non si sceglie mai un palo al posto dell'utente. */
export function resolvePublicCatalogStakeId(
  requestedStakeId: string | null,
  storedStakeId: string,
  activeStakeIds: readonly string[] | null,
) {
  const ready = activeStakeIds !== null;

  function isActive(id: string) {
    return Boolean(id) && (!ready || activeStakeIds.includes(id));
  }

  if (isActive(requestedStakeId ?? "")) {
    return requestedStakeId ?? "";
  }

  if (isActive(storedStakeId)) {
    return storedStakeId;
  }

  return "";
}

export function isPublicActivityType(value: string): value is PublicActivityType {
  return (PUBLIC_TYPES as readonly string[]).includes(value);
}

export function publicActivityTypeOf(event: { activityType?: string | null; overnight?: boolean }) {
  if (event.activityType && isPublicActivityType(event.activityType)) {
    return event.activityType;
  }

  return event.overnight ? "overnight" : "standard";
}

export function publicActivityTypeLabel(type: string) {
  if (isPublicActivityType(type)) {
    return CATALOGO.tipi[type];
  }

  return CATALOGO.tipi.standard;
}

export function monthKey(isoDate: string) {
  const date = asDate(isoDate);

  if (!date) {
    return "";
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string) {
  const [year, month] = key.split("-");
  const name = MESI_LUNGHI[Number(month) - 1];

  if (!name || !year) {
    return key;
  }

  return `${capitalize(name)} ${year}`;
}

export function shortMonth(isoDate: string) {
  const date = asDate(isoDate);
  return date ? MESI[date.getMonth()] : "";
}

export function monthDay(isoDate: string) {
  const date = asDate(isoDate);
  return date ? String(date.getDate()) : "";
}

/** Riga della home: data corta in grassetto, poi ora e luogo. */
export function formatHomeWhen(event: PublicWhenEvent, options: PublicWhenOptions = {}): HomeWhenParts {
  const start = asDate(event.startDate);

  if (!start) {
    return { date: "", suffix: placeSuffix(event, options) };
  }

  const date = `${capitalize(GIORNI_CORTI[start.getDay()])} ${start.getDate()} ${MESI[start.getMonth()]} ${start.getFullYear()}`;
  // Con l'ora di fine ancora da scegliere l'inizio si legge «dalle 19:00», come in elenco.
  const clock = event.timeToBeDefined
    ? fillCopy(ANNUNCIATA.dalle, { ora: hoursMinutes(start) })
    : hoursMinutes(start);
  const time = isMidnight(start) ? "" : `, ${clock}`;

  return { date, suffix: `${time}${placeSuffix(event, options)}` };
}

/** Riga dell'elenco: giorno lungo e, se è lo stesso giorno, l'orario. */
export function formatListWhen(event: PublicWhenEvent, options: PublicWhenOptions = {}) {
  const start = asDate(event.startDate);

  if (!start) {
    return placeOf(event, options);
  }

  const end = asDate(event.endDate) ?? start;
  let when: string;

  if (sameCalendarDay(start, end)) {
    const day = `${capitalize(GIORNI[start.getDay()])} ${start.getDate()} ${MESI_LUNGHI[start.getMonth()]} ${start.getFullYear()}`;
    const startTime = hoursMinutes(start);
    const endTime = hoursMinutes(end);
    const showTime = !isMidnight(start) || !isMidnight(end);

    if (event.timeToBeDefined) {
      // Senza ora la fine è salvata alle 23:59: non si mostra mai; l'inizio solo se scelto.
      when = isMidnight(start) ? day : `${day}, ${fillCopy(ANNUNCIATA.dalle, { ora: startTime })}`;
    } else if (!showTime) {
      when = day;
    } else if (startTime === endTime) {
      when = `${day}, ${startTime}`;
    } else {
      when = `${day}, ${startTime}–${endTime}`;
    }
  } else {
    const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    const left = sameMonth
      ? `${capitalize(GIORNI[start.getDay()])} ${start.getDate()}`
      : `${capitalize(GIORNI[start.getDay()])} ${start.getDate()} ${MESI_LUNGHI[start.getMonth()]}`;
    const right = `${GIORNI[end.getDay()]} ${end.getDate()} ${MESI_LUNGHI[end.getMonth()]} ${end.getFullYear()}`;
    when = `${left} – ${right}`;
  }

  return `${when}${placeSuffix(event, options)}`;
}
