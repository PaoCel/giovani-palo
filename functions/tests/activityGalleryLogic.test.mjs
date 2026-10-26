// Galleria dell'attività: logica pura di functions/lib/activityGallery.js
// (finestra di caricamento e ruolo nella galleria). Nessun emulatore.
//
// Rilancio:
//   node --test functions/tests/activityGalleryLogic.test.mjs
//
// Riferimento: docs/GALLERIA_ATTIVITA.md (finestra: da startDate - 2 ore a
// endDate + 7 giorni; "membro" = account non anonimo del palo; "staff" = admin
// e dirigenti di unità del palo, più super_admin).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  computeUploadWindow,
  isWindowOpen,
  resolveGalleryRole,
  galleryIdForActivity,
  OPEN_BEFORE_START_MS,
  OPEN_AFTER_END_MS,
  MAX_REPORTS_PER_USER,
  REPORT_REASONS,
} = require("../lib/activityGallery.js");

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const START = "2026-10-16T14:00:00.000Z";
const END = "2026-10-17T20:00:00.000Z";
const startMs = Date.parse(START);
const endMs = Date.parse(END);

// ---------------------------------------------------------------------------
// Costanti e id
// ---------------------------------------------------------------------------

test("costanti: 2 ore prima dell'inizio, 7 giorni dopo la fine, 10 segnalazioni a testa", () => {
  assert.equal(OPEN_BEFORE_START_MS, 2 * HOUR);
  assert.equal(OPEN_AFTER_END_MS, 7 * DAY);
  assert.equal(MAX_REPORTS_PER_USER, 10);
  assert.deepEqual([...REPORT_REASONS].sort(), ["inappropriate", "mine", "off_topic"]);
});

test("galleryIdForActivity: id deterministico act_<activityId>", () => {
  assert.equal(galleryIdForActivity("viaggio-1"), "act_viaggio-1");
});

// ---------------------------------------------------------------------------
// computeUploadWindow
// ---------------------------------------------------------------------------

test("computeUploadWindow: start - 2h e end + 7g con stringhe ISO come in prod", () => {
  const window = computeUploadWindow({ startDate: START, endDate: END });
  assert.deepEqual(window, { fromMs: startMs - 2 * HOUR, untilMs: endMs + 7 * DAY });
});

test("computeUploadWindow: senza endDate usa lo start come fine", () => {
  const window = computeUploadWindow({ startDate: START });
  assert.deepEqual(window, { fromMs: startMs - 2 * HOUR, untilMs: startMs + 7 * DAY });
  assert.deepEqual(computeUploadWindow({ startDate: START, endDate: null }), window);
  assert.deepEqual(computeUploadWindow({ startDate: START, endDate: "" }), window);
});

test("computeUploadWindow: endDate invalida usa lo start come fine", () => {
  const expected = { fromMs: startMs - 2 * HOUR, untilMs: startMs + 7 * DAY };
  assert.deepEqual(computeUploadWindow({ startDate: START, endDate: "non una data" }), expected);
  assert.deepEqual(computeUploadWindow({ startDate: START, endDate: "2026-13-45" }), expected);
  assert.deepEqual(computeUploadWindow({ startDate: START, endDate: 12345 }), expected);
});

test("computeUploadWindow: endDate prima di startDate (o uguale) non accorcia la finestra", () => {
  const expected = { fromMs: startMs - 2 * HOUR, untilMs: startMs + 7 * DAY };
  assert.deepEqual(computeUploadWindow({ startDate: START, endDate: "2026-10-10T08:00:00.000Z" }), expected);
  assert.deepEqual(computeUploadWindow({ startDate: START, endDate: START }), expected);
});

test("computeUploadWindow: startDate mancante o invalida = nessuna finestra", () => {
  assert.equal(computeUploadWindow({}), null);
  assert.equal(computeUploadWindow({ endDate: END }), null, "la sola endDate non basta");
  assert.equal(computeUploadWindow({ startDate: null, endDate: END }), null);
  assert.equal(computeUploadWindow({ startDate: "", endDate: END }), null);
  assert.equal(computeUploadWindow({ startDate: "ieri", endDate: END }), null);
  assert.equal(computeUploadWindow({ startDate: "2026-02-31T10:00:00Z x", endDate: END }), null);
  assert.equal(computeUploadWindow(null), null);
  assert.equal(computeUploadWindow(undefined), null);
});

test("computeUploadWindow: solo stringhe; numeri, Date e oggetti Timestamp non contano", () => {
  assert.equal(computeUploadWindow({ startDate: startMs }), null);
  assert.equal(computeUploadWindow({ startDate: new Date(startMs) }), null);
  assert.equal(computeUploadWindow({ startDate: { seconds: Math.floor(startMs / 1000), nanoseconds: 0 } }), null);
});

test("computeUploadWindow: data senza ora (solo giorno) vale come mezzanotte UTC", () => {
  const window = computeUploadWindow({ startDate: "2026-10-16", endDate: "2026-10-17" });
  assert.equal(window.fromMs, Date.UTC(2026, 9, 16) - 2 * HOUR);
  assert.equal(window.untilMs, Date.UTC(2026, 9, 17) + 7 * DAY);
});

test("computeUploadWindow: offset di fuso orario rispettato", () => {
  const window = computeUploadWindow({ startDate: "2026-10-16T16:00:00+02:00" });
  assert.equal(window.fromMs, Date.parse("2026-10-16T14:00:00Z") - 2 * HOUR);
});

// ---------------------------------------------------------------------------
// isWindowOpen
// ---------------------------------------------------------------------------

test("isWindowOpen: estremo inferiore incluso, superiore escluso", () => {
  const window = { fromMs: 1000, untilMs: 5000 };
  assert.equal(isWindowOpen(window, 999), false);
  assert.equal(isWindowOpen(window, 1000), true);
  assert.equal(isWindowOpen(window, 4999), true);
  assert.equal(isWindowOpen(window, 5000), false);
  assert.equal(isWindowOpen(window, 5001), false);
});

test("isWindowOpen: finestra assente = chiusa", () => {
  assert.equal(isWindowOpen(null, Date.now()), false);
  assert.equal(isWindowOpen(undefined, Date.now()), false);
});

test("isWindowOpen: sui confini della finestra calcolata dall'attività", () => {
  const window = computeUploadWindow({ startDate: START, endDate: END });
  assert.equal(isWindowOpen(window, startMs - 2 * HOUR - 1), false, "un ms prima dell'apertura");
  assert.equal(isWindowOpen(window, startMs - 2 * HOUR), true, "esattamente all'apertura");
  assert.equal(isWindowOpen(window, endMs + 7 * DAY - 1), true, "un ms prima della chiusura");
  assert.equal(isWindowOpen(window, endMs + 7 * DAY), false, "esattamente alla chiusura");
});

test("isWindowOpen: attività in corso, conclusa da 10 giorni, futura fra 3 giorni", () => {
  const now = Date.parse("2026-10-15T12:00:00.000Z");
  const iso = (offsetMs) => new Date(now + offsetMs).toISOString();
  const running = computeUploadWindow({ startDate: iso(-3 * HOUR), endDate: iso(5 * HOUR) });
  const concluded = computeUploadWindow({ startDate: iso(-11 * DAY), endDate: iso(-10 * DAY) });
  const future = computeUploadWindow({ startDate: iso(3 * DAY), endDate: iso(4 * DAY) });
  assert.equal(isWindowOpen(running, now), true);
  assert.equal(isWindowOpen(concluded, now), false);
  assert.equal(isWindowOpen(future, now), false);
  // Conclusa da 6 giorni: ancora nella settimana di grazia.
  const recentlyConcluded = computeUploadWindow({ startDate: iso(-7 * DAY), endDate: iso(-6 * DAY) });
  assert.equal(isWindowOpen(recentlyConcluded, now), true);
});

// ---------------------------------------------------------------------------
// resolveGalleryRole
// ---------------------------------------------------------------------------

const STAKE = "palo-a";
const role = (profile, extra = {}) => resolveGalleryRole({ profile, stakeId: STAKE, isAnonymous: false, ...extra });

test("resolveGalleryRole: anonimo = nessun ruolo, anche con profilo del palo giusto", () => {
  assert.equal(role({ role: "participant", stakeId: STAKE }, { isAnonymous: true }), null);
  assert.equal(role({ role: "admin", stakeId: STAKE }, { isAnonymous: true }), null);
  assert.equal(role({ role: "super_admin" }, { isAnonymous: true }), null);
});

test("resolveGalleryRole: profilo assente = nessun ruolo", () => {
  assert.equal(role(null), null);
  assert.equal(role(undefined), null);
});

test("resolveGalleryRole: super_admin è staff di qualunque palo, anche senza stakeId", () => {
  assert.equal(role({ role: "super_admin", stakeId: "altro-palo" }), "staff");
  assert.equal(role({ role: "super_admin" }), "staff");
});

test("resolveGalleryRole: admin del palo è staff, di un altro palo no", () => {
  assert.equal(role({ role: "admin", stakeId: STAKE }), "staff");
  assert.equal(role({ role: "admin", stakeId: "altro-palo" }), null);
  assert.equal(role({ role: "admin" }), null);
});

test("resolveGalleryRole: unit_leader del palo è staff, di un altro palo no", () => {
  assert.equal(role({ role: "unit_leader", stakeId: STAKE, unitId: "u1" }), "staff");
  assert.equal(role({ role: "unit_leader", stakeId: "altro-palo", unitId: "u1" }), null);
});

// S2: "membro" è il documento `stakes/{s}/members/{uid}` attivo, non più
// `users.stakeId` (docs/APPARTENENZA_AL_PALO.md, «Contratto di autorizzazione»).
const ACTIVE = { status: "active" };

test("resolveGalleryRole: participant e parent sono membri solo con members attivo nel palo", () => {
  assert.equal(role({ role: "participant", stakeId: STAKE }, { member: ACTIVE }), "member");
  assert.equal(role({ role: "parent", stakeId: STAKE }, { member: ACTIVE }), "member");
  assert.equal(role({ role: "participant", stakeId: STAKE }), null, "palo scelto ma nessun members");
  assert.equal(role({ role: "parent", stakeId: STAKE }), null, "palo scelto ma nessun members");
  for (const status of ["pending", "declined", "withdrawn", "removed", "blocked"]) {
    assert.equal(role({ role: "participant", stakeId: STAKE }, { member: { status } }), null, status);
  }
  assert.equal(
    role({ role: "participant", stakeId: "altro-palo" }, { member: ACTIVE }),
    "member",
    "members attivo nel palo, palo scelto già cambiato: resta membro finché esce",
  );
});

test("resolveGalleryRole: un members attivo non basta a una sessione anonima", () => {
  assert.equal(role({ role: "participant", stakeId: STAKE }, { member: ACTIVE, isAnonymous: true }), null);
  assert.equal(role(null, { member: ACTIVE, isAnonymous: true }), null);
});

test("resolveGalleryRole: una categoria autodichiarata non dà lo staff", () => {
  for (const genderRoleCategory of ["dirigente", "accompagnatore"]) {
    assert.equal(role({ role: "participant", stakeId: STAKE, genderRoleCategory }, { member: ACTIVE }), "member");
    assert.equal(role({ role: "participant", stakeId: STAKE, genderRoleCategory }), null);
  }
});

test("resolveGalleryRole: ruolo sconosciuto o mancante nel palo = membro solo con members attivo, mai staff", () => {
  assert.equal(role({ stakeId: STAKE }, { member: ACTIVE }), "member");
  assert.equal(role({ role: "ADMIN", stakeId: STAKE }, { member: ACTIVE }), "member", "maiuscole non riconosciute");
  assert.equal(role({ role: "staff", stakeId: STAKE }, { member: ACTIVE }), "member");
  assert.equal(role({ role: "ADMIN", stakeId: STAKE }), null);
});
