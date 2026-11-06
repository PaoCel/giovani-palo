import test from "node:test";
import assert from "node:assert/strict";

import { ANNUNCIATA } from "../src/copy/annunciata.ts";
import { fillCopy } from "../src/copy/parole.ts";
import {
  formatDateRange,
  formatDateTime,
  formatEventStart,
  formatEventWhen,
  formatEventWindow,
  formatShortDate,
  isMidnight,
} from "../src/utils/formatters.ts";

// Unico formattatore di «quando» (docs/ATTIVITA_MODULARI.md, «Resa con dati
// mancanti»). Senza timeToBeDefined è identico a formatDateRange; con il segno
// niente 23:59, in giornata «ora da definire» o «dalle 19:00», su più giorni
// solo i giorni.
//
// Comando: node --test tests/formatEventWhen.test.mjs

const iso = (year, month, day, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).toISOString();

const clock = (year, month, day, hour, minute) =>
  new Date(year, month - 1, day, hour, minute).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  });

test("isMidnight: 00:00 locale sì, qualunque altro minuto no", () => {
  assert.equal(isMidnight(iso(2026, 12, 15, 0, 0)), true);
  assert.equal(isMidnight(iso(2026, 12, 15, 0, 1)), false);
  assert.equal(isMidnight(iso(2026, 12, 15, 19, 0)), false);
  assert.equal(isMidnight(iso(2026, 12, 15, 23, 59)), false);
});

test("formatEventWhen: senza timeToBeDefined è identico a formatDateRange", () => {
  const sameDay = { startDate: iso(2026, 12, 15, 19, 0), endDate: iso(2026, 12, 15, 23, 0) };
  const multi = { startDate: iso(2026, 12, 15, 0, 0), endDate: iso(2026, 12, 17, 23, 59) };
  assert.equal(formatEventWhen(sameDay), formatDateRange(sameDay.startDate, sameDay.endDate));
  assert.equal(formatEventWhen(multi), formatDateRange(multi.startDate, multi.endDate));
  assert.equal(formatEventWhen({ ...sameDay, timeToBeDefined: false }), formatDateRange(sameDay.startDate, sameDay.endDate));
  assert.equal(formatEventWindow(sameDay), formatDateRange(sameDay.startDate, sameDay.endDate));
});

test("formatEventWhen: in giornata senza ora «• ora da definire», mai 23:59", () => {
  const event = {
    startDate: iso(2026, 12, 15, 0, 0),
    endDate: iso(2026, 12, 15, 23, 59),
    timeToBeDefined: true,
  };
  const out = formatEventWhen(event);
  assert.equal(out, `${formatShortDate(event.startDate)} • ${ANNUNCIATA.oraDaDefinire}`);
  assert.equal(out.includes("23:59"), false);
  assert.equal(out.includes("23.59"), false);
  assert.equal(formatEventWindow(event), out);
});

test("formatEventWhen: in giornata con ora d'inizio «• dalle 19:00», mai 23:59", () => {
  const event = {
    startDate: iso(2026, 12, 15, 19, 0),
    endDate: iso(2026, 12, 15, 23, 59),
    timeToBeDefined: true,
  };
  const expectedTime = fillCopy(ANNUNCIATA.dalle, { ora: clock(2026, 12, 15, 19, 0) });
  const out = formatEventWhen(event);
  assert.equal(out, `${formatShortDate(event.startDate)} • ${expectedTime}`);
  assert.match(out, /dalle /u);
  assert.equal(out.includes("23:59"), false);
  assert.equal(out.includes("23.59"), false);
  // Il copy del foglio usa i due punti: la resa deve coincidere.
  assert.equal(expectedTime, "dalle 19:00");
});

test("formatEventWhen: su più giorni solo i giorni, anche con timeToBeDefined", () => {
  const event = {
    startDate: iso(2026, 12, 15, 0, 0),
    endDate: iso(2026, 12, 17, 23, 59),
    timeToBeDefined: true,
  };
  const out = formatEventWhen(event);
  assert.equal(out, `${formatShortDate(event.startDate)} - ${formatShortDate(event.endDate)}`);
  assert.equal(out.includes("23:59"), false);
  assert.equal(out.includes("ora da definire"), false);
  assert.equal(out.includes("dalle"), false);
});

test("formatEventStart: solo il giorno se l'ora non è scelta, altrimenti data e ora", () => {
  const midnight = iso(2026, 12, 15, 0, 0);
  const evening = iso(2026, 12, 15, 19, 0);
  assert.equal(formatEventStart({ startDate: midnight, timeToBeDefined: true }), formatShortDate(midnight));
  assert.equal(formatEventStart({ startDate: evening, timeToBeDefined: true }), formatDateTime(evening));
  assert.equal(formatEventStart({ startDate: midnight }), formatDateTime(midnight));
  assert.equal(formatEventStart({ startDate: evening, timeToBeDefined: false }), formatDateTime(evening));
});
