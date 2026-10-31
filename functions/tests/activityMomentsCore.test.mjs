// Independent expectations from PROGRAMMA_PRIMO_INCREMENTO, not production data.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const core = require("../lib/momentsCore.js");
const { Timestamp } = require("firebase-admin/firestore");

test("limiti pubblici del primo incremento", () => {
  assert.equal(core.MAX_MOMENTS, 50);
  assert.equal(core.MAX_CAPACITY, 2000);
  assert.equal(core.MAX_PEOPLE, 100);
});

for (const registrationStatus of ["active", "confirmed", "pending_parent_authorization"]) {
  test(`iscrizione principale ammessa: ${registrationStatus}`, () => {
    assert.equal(core.isMomentRegistrationActive({ registrationStatus }), true);
  });
  test(`status cancelled prevale anche su registrationStatus ${registrationStatus}`, () => {
    assert.equal(core.isMomentRegistrationActive({ registrationStatus, status: "cancelled" }), false);
  });
}
for (const registrationStatus of ["submitted", "waitlist", "draft", "cancelled", "rejected_by_parent", "unexpected", "", " confirmed ", "CONFIRMED", false, 1, [], {}]) {
  test(`registrationStatus esplicito escluso: ${JSON.stringify(registrationStatus)}`, () => {
    assert.equal(core.isMomentRegistrationActive({ registrationStatus }), false);
  });
}
for (const legacy of [{}, { registrationStatus: null }, { registrationStatus: undefined }, { status: "active" }, { status: "confirmed", registrationStatus: null }]) {
  test(`fallback legacy ammesso: ${JSON.stringify(legacy)}`, () => {
    assert.equal(core.isMomentRegistrationActive(legacy), true);
  });
}
for (const legacy of [{ status: "cancelled" }, { status: "cancelled", registrationStatus: null }, { status: "cancelled", registrationStatus: undefined }]) {
  test(`legacy annullato escluso: ${JSON.stringify(legacy)}`, () => {
    assert.equal(core.isMomentRegistrationActive(legacy), false);
  });
}
for (const value of [null, undefined, [], "active", false, 1]) {
  test(`nessun oggetto iscrizione: ${JSON.stringify(value)}`, () => {
    assert.equal(core.isMomentRegistrationActive(value), false);
  });
}

const validFields = extra => ({ type: "turni", title: "  Attività sintetica  ", startsAt: "2030-01-04T15:00:00+01:00", capacity: 2, ...extra });
function invalid(call) { assert.throws(call, error => error.code === "invalid-argument"); }
test("campi validi e titolo normalizzato", () => {
  const parsed = core.parseMomentFields(validFields());
  assert.equal(parsed.title, "Attività sintetica");
  assert.equal(parsed.type, "turni");
});
test("info senza capienza e fine facoltativa è valida", () => {
  assert.doesNotThrow(() => core.parseMomentFields({ type: "info", title: "Ritrovo", startsAt: "2030-01-04T15:00:00Z" }));
});
for (const [name, delta] of [
  ["titolo assente", { title: undefined }], ["titolo vuoto", { title: "   " }], ["titolo oltre80", { title: "x".repeat(81) }],
  ["descrizione oltre600", { description: "x".repeat(601) }], ["luogo oltre80", { place: "x".repeat(81) }],
  ["tipo ignoto", { type: "recordNight" }], ["capienza zero", { capacity: 0 }], ["capienza negativa", { capacity: -1 }],
  ["capienza frazionaria", { capacity: 1.5 }], ["capienza stringa", { capacity: "2" }], ["capienza oltre2000", { capacity: 2001 }],
  ["capienza assente", { capacity: undefined }], ["data senza offset", { startsAt: "2030-01-04T15:00:00" }],
  ["data inesistente", { startsAt: "non-una-data" }], ["fine prima inizio", { endsAt: "2030-01-03T15:00:00Z" }],
  ["custom senza chiusura", { customWindow: true, opensAt: "2030-01-01T10:00:00Z" }],
  ["custom senza apertura", { customWindow: true, closesAt: "2030-01-04T10:00:00Z" }],
  ["finestra inversa", { customWindow: true, opensAt: "2030-01-04T11:00:00Z", closesAt: "2030-01-04T10:00:00Z" }],
  ["finestra uguale", { customWindow: true, opensAt: "2030-01-04T11:00:00Z", closesAt: "2030-01-04T11:00:00Z" }],
]) test(`payload campi rifiutato: ${name}`, () => invalid(() => core.parseMomentFields(validFields(delta))));
for (const capacity of [1, 2000]) test(`capienza limite valida ${capacity}`, () => assert.doesNotThrow(() => core.parseMomentFields(validFields({ capacity }))));
for (const key of ["uid", "createdBy", "status", "slots", "taken", "summary", "audience", "visibleFromTs", "medicalNotes", "unsupported"]) {
  test(`campo non supportato mai eliminato implicitamente: ${key}`, () => invalid(() => core.parseMomentFields(validFields({ [key]: "client-controlled" }))));
}
const request = extra => ({ action: "save", stakeId: "qa-stake", activityId: "qa-activity", momentId: "qa-moment", requestId: "request-independent-001", expectedRevision: null, fields: validFields(), ...extra });
test("richiesta admin valida", () => assert.doesNotThrow(() => core.parseMomentRequest(request(), "admin")));
for (const [name, delta] of [
  ["revisione negativa", { expectedRevision: -1 }], ["revisione frazionaria", { expectedRevision: 1.5 }],
  ["revisione stringa", { expectedRevision: "1" }], ["revisione infinita", { expectedRevision: Infinity }],
  ["requestId assente", { requestId: undefined }], ["requestId vuoto", { requestId: "" }],
  ["path palo", { stakeId: "qa/stake" }], ["path attività", { activityId: "qa/activity" }],
  ["path momento", { momentId: "qa/moment" }], ["azione ignota", { action: "approve" }],
]) test(`richiesta rifiutata: ${name}`, () => invalid(() => core.parseMomentRequest(request(delta), "admin")));
for (const key of ["uid", "ownerUids", "registrationId", "slotId", "taken"]) {
  test(`admin non fornisce identità o contatori ${key}`, () => invalid(() => core.parseMomentRequest(request({ [key]: "forged" }), "admin")));
}
test("participant non può usare azioni admin", () => invalid(() => core.parseMomentRequest(request(), "participant")));
test("finestra server aperta inclusiva all'apertura ed esclusiva alla chiusura", () => {
  const opens = Date.parse("2030-01-01T12:00:00Z"), closes = opens + 1000;
  const moment = { type: "turni", status: "published", visibleFromTs: Timestamp.fromMillis(opens), participation: { opensAtTs: Timestamp.fromMillis(opens), closesAtTs: Timestamp.fromMillis(closes) } };
  assert.equal(core.isParticipationOpen(moment, new Date(opens - 1)), false);
  assert.equal(core.isParticipationOpen(moment, new Date(opens)), true);
  assert.equal(core.isParticipationOpen(moment, new Date(closes - 1)), true);
  assert.equal(core.isParticipationOpen(moment, new Date(closes)), false);
  assert.equal(core.isParticipationOpen({ ...moment, status: "hidden" }, new Date(opens)), false);
  assert.equal(core.isParticipationOpen({ ...moment, status: "draft" }, new Date(opens)), false);
});
for (const [id, data, owner] of [
  ["user_person-one", { userId: "person-one" }, "person-one"],
  // Self ownership follows its stable user_<uid> ID, not a copied UID field.
  ["user_person-one", { userId: "person-two" }, "person-one"],
  ["child_parent-one_child-one", { parentUid: "parent-one" }, "parent-one"],
  ["child_parent-two_child-one", { parentUid: "parent-one" }, null],
  ["child_parent-one_child-one", {}, null],
  ["manual_person-one", { userId: "person-one" }, null],
]) test(`ownership deriva da path e riferimento coerenti: ${id} ${JSON.stringify(data)}`, () => assert.equal(core.registrationOwnerUid(id, data), owner));
