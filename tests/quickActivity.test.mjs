import test from "node:test";
import assert from "node:assert/strict";

import { ANNUNCIATA as COPY } from "../src/copy/annunciata.ts";
import {
  EMPTY_QUICK_VALUES,
  buildQuickPayload,
  findQuickDuplicate,
  getQuickLocalRange,
  hasQuickInput,
  isQuickDatePast,
  needsEndDate,
  quickValuesFromEvent,
  validateQuick,
} from "../src/utils/quickActivity.ts";

// Logica pura del foglio rapido (docs/ATTIVITA_MODULARI.md, «Settimo incremento»).
// Le date AAAA-MM-GG e i datetime-local sono ora locale: gli ISO si costruiscono
// con `new Date("…").toISOString()` per non dipendere dal fuso. Lanciare anche
// con TZ=Europe/Rome e TZ=America/New_York.
//
// Comando: node --test tests/quickActivity.test.mjs

const STRONG_TYPES = ["overnight", "trip", "camp", "multi_day"];

const quick = (overrides = {}) => ({
  ...EMPTY_QUICK_VALUES,
  title: "Serata giochi",
  activityType: "standard",
  date: "2027-01-23",
  ...overrides,
});

const asEvent = (payload, extra = {}) => ({
  title: payload.title,
  startDate: payload.startDate,
  endDate: payload.endDate,
  location: payload.location,
  activityType: payload.activityType,
  timeToBeDefined: payload.timeToBeDefined,
  ...extra,
});

// ---------- validateQuick ----------

test("validateQuick: il nome è obbligatorio, anche se fatto di soli spazi", () => {
  assert.equal(validateQuick(quick({ title: "" })).title, COPY.erroreNome);
  assert.equal(validateQuick(quick({ title: "   " })).title, COPY.erroreNome);
  assert.equal(validateQuick(quick()).title, undefined);
});

test("validateQuick: data assente o malformata", () => {
  for (const date of ["", "  ", "boh", "23/01/2027", "2027-1-23", "2027-13-01"]) {
    assert.equal(validateQuick(quick({ date })).date, COPY.erroreData, `"${date}"`);
  }
  assert.equal(validateQuick(quick()).date, undefined);
});

test("validateQuick: «Fino al» è obbligatorio per i tipi non standard", () => {
  assert.equal(needsEndDate("standard"), false);
  assert.equal(validateQuick(quick({ endDate: "" })).endDate, undefined);

  for (const activityType of STRONG_TYPES) {
    assert.equal(needsEndDate(activityType), true, activityType);
    assert.equal(validateQuick(quick({ activityType, endDate: "" })).endDate, COPY.erroreFine, activityType);
    assert.equal(validateQuick(quick({ activityType, endDate: "boh" })).endDate, COPY.erroreFine, activityType);
    assert.equal(
      validateQuick(quick({ activityType, endDate: "2027-01-23" })).endDate,
      undefined,
      `${activityType} stesso giorno`,
    );
  }
});

test("validateQuick: la fine prima dell'inizio è rifiutata, a pari data no", () => {
  const before = validateQuick(quick({ activityType: "camp", endDate: "2027-01-22" }));
  assert.equal(before.endDate, COPY.erroreFinePrima);
  assert.equal(validateQuick(quick({ activityType: "camp", endDate: "2027-01-23" })).endDate, undefined);
  assert.equal(validateQuick(quick({ activityType: "camp", endDate: "2027-01-25" })).endDate, undefined);
});

test("validateQuick: un tipo standard non chiede la fine anche se è prima dell'inizio", () => {
  assert.deepEqual(validateQuick(quick({ endDate: "2027-01-01" })), {});
});

test("validateQuick: nome e giorno bastano per un'attività in giornata", () => {
  assert.deepEqual(validateQuick(quick({ location: "", time: "" })), {});
});

// ---------- getQuickLocalRange / buildQuickPayload ----------

test("getQuickLocalRange: senza ora è 00:00, con ora scelta la tiene, la fine è 23:59", () => {
  assert.deepEqual(getQuickLocalRange(quick({ time: "" })), {
    start: "2027-01-23T00:00",
    end: "2027-01-23T23:59",
  });
  assert.deepEqual(getQuickLocalRange(quick({ time: "19:00" })), {
    start: "2027-01-23T19:00",
    end: "2027-01-23T23:59",
  });
  assert.deepEqual(getQuickLocalRange(quick({ time: "7:00" })), {
    start: "2027-01-23T00:00",
    end: "2027-01-23T23:59",
  }, "ora malformata: ripiega su 00:00");
});

test("getQuickLocalRange: i tipi forti usano il giorno di «Fino al»", () => {
  assert.deepEqual(getQuickLocalRange(quick({ activityType: "camp", endDate: "2027-01-25", time: "09:00" })), {
    start: "2027-01-23T09:00",
    end: "2027-01-25T23:59",
  });
  assert.deepEqual(getQuickLocalRange(quick({ activityType: "standard", endDate: "2027-01-25" })), {
    start: "2027-01-23T00:00",
    end: "2027-01-23T23:59",
  }, "in giornata ignora «Fino al»");
});

test("buildQuickPayload: 00:00 senza ora, ora scelta, 23:59 del giorno di fine", () => {
  const midnight = buildQuickPayload(quick({ time: "" }));
  assert.equal(midnight.startDate, new Date("2027-01-23T00:00").toISOString());
  assert.equal(midnight.endDate, new Date("2027-01-23T23:59").toISOString());

  const timed = buildQuickPayload(quick({ time: "19:00" }));
  assert.equal(timed.startDate, new Date("2027-01-23T19:00").toISOString());
  assert.equal(timed.endDate, new Date("2027-01-23T23:59").toISOString());

  const camp = buildQuickPayload(quick({ activityType: "camp", endDate: "2027-01-25" }));
  assert.equal(camp.startDate, new Date("2027-01-23T00:00").toISOString());
  assert.equal(camp.endDate, new Date("2027-01-25T23:59").toISOString());
});

test("buildQuickPayload: status planned, pubblica, visibile, ora da definire, iscrizioni vuote", () => {
  const payload = buildQuickPayload(quick({ location: "" }));
  assert.equal(payload.status, "planned");
  assert.equal(payload.isPublic, true);
  assert.equal(payload.isVisible, true);
  assert.equal(payload.timeToBeDefined, true);
  assert.equal(payload.registrationOpen, "");
  assert.equal(payload.registrationClose, "");
  assert.equal(payload.location, "");
  assert.equal(payload.description, "");
  assert.equal(payload.audience, "congiunta");
});

test("buildQuickPayload: il luogo vuoto è ammesso, il testo viene ripulito", () => {
  assert.equal(buildQuickPayload(quick({ location: "" })).location, "");
  assert.equal(buildQuickPayload(quick({ location: "  Cappella  " })).location, "Cappella");
  assert.equal(buildQuickPayload(quick({ title: "  Serata giochi  " })).title, "Serata giochi");
});

test("buildQuickPayload: i tipi forti accendono i requisiti, in giornata no", () => {
  const flags = ["requiresAccount", "requiresParentAuthorization", "requiresEmergencyContacts", "requiresMedicalNotes"];
  const standard = buildQuickPayload(quick());
  for (const field of flags) assert.equal(standard[field], false, field);

  for (const activityType of STRONG_TYPES) {
    const payload = buildQuickPayload(quick({ activityType, endDate: "2027-01-23" }));
    for (const field of flags) assert.equal(payload[field], true, `${activityType} ${field}`);
  }
});

test("buildQuickPayload: overnight solo se tipo rafforzato su più giorni", () => {
  assert.equal(buildQuickPayload(quick()).overnight, false);
  assert.equal(buildQuickPayload(quick({ activityType: "camp", endDate: "2027-01-23" })).overnight, false);
  assert.equal(buildQuickPayload(quick({ activityType: "camp", endDate: "2027-01-25" })).overnight, true);
  assert.equal(buildQuickPayload(quick({ activityType: "overnight", endDate: "2027-01-24" })).overnight, true);
  assert.equal(buildQuickPayload(quick({ endDate: "2027-01-25" })).overnight, false, "in giornata ignora più giorni");
});

// ---------- isQuickDatePast ----------

test("isQuickDatePast: ieri, oggi, domani rispetto a now passato", () => {
  const noon = new Date(2027, 0, 15, 12, 0, 0);
  assert.equal(isQuickDatePast(quick({ date: "2027-01-14" }), noon), true, "ieri");
  assert.equal(isQuickDatePast(quick({ date: "2027-01-15" }), noon), false, "oggi prima delle 23:59");
  assert.equal(isQuickDatePast(quick({ date: "2027-01-16" }), noon), false, "domani");
});

test("isQuickDatePast: un campeggio è passato quando è passata la fine, non l'inizio", () => {
  const noon = new Date(2027, 0, 15, 12, 0, 0);
  assert.equal(
    isQuickDatePast(quick({ activityType: "camp", date: "2027-01-13", endDate: "2027-01-14" }), noon),
    true,
  );
  assert.equal(
    isQuickDatePast(quick({ activityType: "camp", date: "2027-01-14", endDate: "2027-01-15" }), noon),
    false,
  );
});

test("isQuickDatePast: data assente o malformata non è passata", () => {
  const now = new Date(2027, 0, 15, 12, 0, 0);
  assert.equal(isQuickDatePast(quick({ date: "" }), now), false);
  assert.equal(isQuickDatePast(quick({ date: "boh" }), now), false);
});

test("isQuickDatePast: dopo le 23:59 del giorno scelto il giorno è passato", () => {
  const afterClose = new Date(2027, 0, 15, 23, 59, 1);
  assert.equal(isQuickDatePast(quick({ date: "2027-01-15" }), afterClose), true);
});

// ---------- findQuickDuplicate ----------

const listed = (overrides = {}) => ({
  id: "a1",
  title: "Serata giochi",
  startDate: new Date("2027-01-23T00:00").toISOString(),
  status: "planned",
  ...overrides,
});

test("findQuickDuplicate: ignora maiuscole e spazi, confronta il giorno locale", () => {
  const events = [listed({ title: "  SERATA   giochi " })];
  const found = findQuickDuplicate(quick({ title: "serata giochi" }), events);
  assert.equal(found?.id, "a1");
  assert.equal(findQuickDuplicate(quick({ title: "Altra" }), events), null);
  assert.equal(findQuickDuplicate(quick({ date: "2027-01-24" }), events), null);
});

test("findQuickDuplicate: ignoreId esclude l'attività che si sta correggendo", () => {
  const events = [
    listed({ id: "mia", title: "Serata giochi" }),
    listed({ id: "altra", title: "Serata giochi", startDate: new Date("2027-01-23T19:00").toISOString() }),
  ];
  assert.equal(findQuickDuplicate(quick(), events, "mia")?.id, "altra");
  assert.equal(findQuickDuplicate(quick(), events, "altra")?.id, "mia");
  assert.equal(
    findQuickDuplicate(quick(), [listed({ id: "mia" })], "mia"),
    null,
  );
});

test("findQuickDuplicate: le annullate non contano", () => {
  const events = [listed({ status: "cancelled" })];
  assert.equal(findQuickDuplicate(quick(), events), null);
  assert.equal(findQuickDuplicate(quick(), [listed({ status: "draft" })])?.id, "a1");
  assert.equal(findQuickDuplicate(quick(), [listed({ status: "registrations_open" })])?.id, "a1");
});

test("findQuickDuplicate: senza nome o senza giorno valido non cerca", () => {
  const events = [listed()];
  assert.equal(findQuickDuplicate(quick({ title: "  " }), events), null);
  assert.equal(findQuickDuplicate(quick({ date: "" }), events), null);
});

// ---------- quickValuesFromEvent / andata e ritorno ----------

test("andata e ritorno: buildQuickPayload → evento → quickValuesFromEvent", () => {
  const cases = [
    quick({ time: "", location: "" }),
    quick({ time: "19:00", location: "Cappella" }),
    quick({ activityType: "camp", date: "2027-07-10", time: "09:00", endDate: "2027-07-15", location: "Monti" }),
    quick({ activityType: "overnight", date: "2027-03-01", time: "", endDate: "2027-03-02", location: "" }),
  ];
  for (const values of cases) {
    const payload = buildQuickPayload(values);
    const back = quickValuesFromEvent(asEvent(payload));
    assert.deepEqual(back, {
      title: values.title.trim(),
      activityType: values.activityType,
      date: values.date,
      time: values.time,
      endDate: needsEndDate(values.activityType) ? values.endDate : "",
      location: values.location.trim(),
    }, JSON.stringify(values));
  }
});

test("quickValuesFromEvent: 00:00 con ora da definire torna vuota, un'ora vera resta", () => {
  const midnight = quickValuesFromEvent(asEvent(buildQuickPayload(quick({ time: "" }))));
  assert.equal(midnight.time, "");
  const timed = quickValuesFromEvent(asEvent(buildQuickPayload(quick({ time: "19:00" }))));
  assert.equal(timed.time, "19:00");
  const defined = quickValuesFromEvent(asEvent(buildQuickPayload(quick({ time: "00:00" })), { timeToBeDefined: false }));
  assert.equal(defined.time, "00:00", "senza timeToBeDefined le 00:00 sono un'ora vera");
});

// ---------- hasQuickInput ----------

test("hasQuickInput: qualcosa di scritto nei campi che andrebbe perso", () => {
  assert.equal(hasQuickInput(EMPTY_QUICK_VALUES), false);
  assert.equal(hasQuickInput(quick({ title: "   ", date: "", time: "", endDate: "", location: "  " })), false);
  assert.equal(hasQuickInput(quick({ title: "Serata", date: "" })), true);
  assert.equal(hasQuickInput(quick({ title: "", date: "2027-01-23" })), true);
  assert.equal(hasQuickInput(quick({ title: "", date: "", time: "19:00" })), true);
  assert.equal(hasQuickInput(quick({ title: "", date: "", endDate: "2027-01-24" })), true);
  assert.equal(hasQuickInput(quick({ title: "", date: "", location: "Cappella" })), true);
});
