import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { normalizeCampConfiguration, assertCampRevision, nextCampRevision, CampConfigurationError } = require("../lib/campConfiguration.js");

const REVISION = "2026-10-26T12:00:00.000Z";
const previousPlan = () => ({
  groupLabel: "compagnia", updatedAt: REVISION,
  committees: [
    { id: "logistics", title: "Materiali", responsibilities: "Prepara la sala", leaderRegistrationIds: ["user_leader"], manualLeaderIds: ["manual-1"], memberRegistrationIds: ["user_one"] },
    { id: "kitchen", title: "Cucina", responsibilities: "Prepara la cena", leaderRegistrationIds: [], manualLeaderIds: [], memberRegistrationIds: ["child_parent_one"] },
  ],
  patrols: [{ id: "patrol-a", name: "A", leaderRegistrationId: "user_leader", supervisorRegistrationIds: [], manualSupervisorIds: [], memberRegistrationIds: ["user_one"] }],
  manualLeaders: [{ id: "manual-1", fullName: "Dirigente sintetico", linkedRegistrationId: null }],
});
const committee = (plan, id = "logistics") => plan.committees.find(item => item.id === id);
const invalid = (action) => assert.throws(action, error => error instanceof CampConfigurationError && error.code === "invalid-argument");

for (const value of ["pattuglia", "gruppo", "compagnia", "team", "squadra"]) {
  test(`groupLabel ${value}: cambia soltanto configurazione, conserva persone e ID`, () => {
    const before = previousPlan();
    const frozen = structuredClone(before);
    const actual = normalizeCampConfiguration({ groupLabel: value }, before);
    assert.equal(actual.groupLabel, value);
    assert.deepEqual(actual.committees, before.committees);
    assert.deepEqual(actual.patrols, before.patrols);
    assert.deepEqual(actual.manualLeaders, before.manualLeaders);
    assert.deepEqual(before, frozen, "nessuna mutazione del piano salvato");
  });
}

test("payload legacy vuoto conserva l'intero piano salvato e default iniziale Pattuglia", () => {
  assert.deepEqual(normalizeCampConfiguration({}, previousPlan()), previousPlan());
  assert.equal(normalizeCampConfiguration({}).groupLabel, "pattuglia");
});

test("comitato parziale conserva titolo, incarico e liste individuali omesse", () => {
  const before = previousPlan();
  const actual = normalizeCampConfiguration({ committees: [{ id: "logistics", title: "  Sala e materiali  " }] }, before);
  assert.equal(committee(actual).title, "Sala e materiali");
  assert.equal(committee(actual).responsibilities, "Prepara la sala");
  for (const field of ["leaderRegistrationIds", "manualLeaderIds", "memberRegistrationIds"]) assert.deepEqual(committee(actual)[field], committee(before)[field]);
  assert.deepEqual(committee(actual, "kitchen"), committee(before, "kitchen"));
});

test("liste [] esplicite svuotano solo l'assegnazione scelta; committees [] conserva comitati", () => {
  const before = previousPlan();
  const actual = normalizeCampConfiguration({ committees: [{ id: "logistics", memberRegistrationIds: [], responsibilities: "" }], patrols: [], manualLeaders: [] }, before);
  assert.deepEqual(committee(actual).memberRegistrationIds, []);
  assert.deepEqual(committee(actual).leaderRegistrationIds, ["user_leader"]);
  assert.equal(committee(actual).responsibilities, "");
  assert.deepEqual(actual.patrols, []);
  assert.deepEqual(actual.manualLeaders, []);
  assert.deepEqual(normalizeCampConfiguration({ committees: [] }, before).committees, before.committees);
});

test("titolo 80 e incarico 600 sono ammessi dopo trim, senza alterare ID", () => {
  const actual = normalizeCampConfiguration({ committees: [{ id: "logistics", title: `  ${"T".repeat(80)}  `, responsibilities: ` ${"I".repeat(600)} ` }] }, previousPlan());
  assert.equal(committee(actual).id, "logistics");
  assert.equal(committee(actual).title.length, 80);
  assert.equal(committee(actual).responsibilities.length, 600);
});

for (const patch of [{ title: "" }, { title: "  " }, { title: "T".repeat(81) }, { title: 5 }, { responsibilities: "I".repeat(601) }, { responsibilities: [] }]) {
  test(`configurazione comitato invalida è rifiutata: ${JSON.stringify(patch).slice(0, 60)}`, () => {
    invalid(() => normalizeCampConfiguration({ committees: [{ id: "logistics", ...patch }] }, previousPlan()));
  });
}
for (const value of [null, "", "unknown", "constructor", "__proto__", {}, 1]) {
  test(`groupLabel esplicito invalido non diventa default: ${JSON.stringify(value)}`, () => invalid(() => normalizeCampConfiguration({ groupLabel: value }, previousPlan())));
}
for (const value of [null, "plan", []]) {
  test(`piano non object rifiutato: ${JSON.stringify(value)}`, () => invalid(() => normalizeCampConfiguration(value, previousPlan())));
}
for (const field of ["committees", "patrols", "manualLeaders"]) {
  test(`${field} non array non svuota dati per errore`, () => {
    for (const value of [null, {}, "", 5]) invalid(() => normalizeCampConfiguration({ [field]: value }, previousPlan()));
  });
}

test("revisioni: legacy undefined passa; null solo piano assente o senza updatedAt", () => {
  assert.doesNotThrow(() => assertCampRevision(undefined, previousPlan()));
  assert.doesNotThrow(() => assertCampRevision(null, null));
  assert.doesNotThrow(() => assertCampRevision(null, {}));
  assert.doesNotThrow(() => assertCampRevision(REVISION, previousPlan()));
  for (const [expected, current] of [[null, previousPlan()], [REVISION, null], ["2026-10-25T12:00:00.000Z", previousPlan()]]) {
    assert.throws(() => assertCampRevision(expected, current), error => error instanceof CampConfigurationError && error.code === "aborted");
  }
});

test("nuova revisione cresce con clock uguale o arretrato e conserva un clock successivo", () => {
  const time = Date.parse(REVISION);
  assert.equal(nextCampRevision(REVISION, time), "2026-10-26T12:00:00.001Z");
  assert.equal(nextCampRevision(REVISION, time - 1000), "2026-10-26T12:00:00.001Z");
  assert.equal(nextCampRevision(REVISION, time + 1000), "2026-10-26T12:00:01.000Z");
  assert.equal(nextCampRevision(null, time), REVISION);
});
