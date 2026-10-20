// Migrazione A3 dell'appartenenza al palo: la logica pura di
// functions/lib/stakeMembership.js provata contro le regole scritte nella spec
// (docs/APPARTENENZA_AL_PALO.md, "### Migrazione (scelta A3)"), non contro il
// codice. Niente emulatore, niente rete:
//   node --test functions/tests/stakeMembershipMigration.test.mjs
// Lo script che usa questa logica è provato nell'emulatore da
// stakeMembershipMigrationEmulator.test.mjs.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const lib = require("../lib/stakeMembership.js");
const {
  MAX_REGISTRATION_HINTS,
  MEMBER_STATUSES,
  SOURCE_KINDS,
  LIVE_REGISTRATION_STATUSES,
  STAFF_ROLES,
  birthYearOf,
  buildMigratedMember,
  isLiveRegistration,
  migrationGroupOf,
  planStakeMemberMigration,
  registrationOwnerUids,
  staffRoleFromUserRole,
} = lib;

const STAKE = "roma-est";
const AT = { sentinel: "serverTimestamp" }; // segnaposto: la logica non deve guardarlo dentro
const SOURCE_AT = { sentinel: "now" };
const REF = "a3-2026-10";

let counter = 0;
const user = (over = {}) => ({
  uid: `u${++counter}`,
  role: "participant",
  stakeId: STAKE,
  unitId: "rione-1",
  unitName: "Rione Uno",
  fullName: "Anna Rossi",
  firstName: "Anna",
  lastName: "Rossi",
  birthDate: "2008-05-14",
  ...over,
});
const registration = (over = {}) => ({ activityId: "viaggio", registrationStatus: "confirmed", ...over });
const plan = (input) =>
  planStakeMemberMigration({
    stakeId: STAKE,
    users: [],
    registrations: [],
    existingMemberUids: new Set(),
    activityTitles: new Map([["viaggio", "Viaggio al tempio"]]),
    at: AT,
    sourceAt: SOURCE_AT,
    migrationRef: REF,
    ...input,
  });
const docOf = (result, uid) => result.toCreate.find((item) => item.uid === uid)?.doc;

describe("costanti del modello (spec: Modello)", () => {
  test("gli stati sono i sei della spec", () => {
    assert.deepEqual([...MEMBER_STATUSES], ["pending", "active", "declined", "withdrawn", "removed", "blocked"]);
  });
  test("i motivi di appartenenza sono quelli della spec", () => {
    assert.deepEqual(
      [...SOURCE_KINDS].sort(),
      ["link_code", "manual_registration", "migration", "parent_link", "staff_approval", "staff_invite"],
    );
  });
  test("i ruoli staff copiati sul documento sono admin e unit_leader", () => {
    assert.deepEqual([...STAFF_ROLES].sort(), ["admin", "unit_leader"]);
  });
  test("al massimo 5 suggerimenti di iscrizione (registrationHints ≤ 5)", () => {
    assert.equal(MAX_REGISTRATION_HINTS, 5);
  });
});

describe("staffRoleFromUserRole", () => {
  test("admin -> admin, super_admin -> admin, unit_leader -> unit_leader", () => {
    assert.equal(staffRoleFromUserRole("admin"), "admin");
    assert.equal(staffRoleFromUserRole("super_admin"), "admin");
    assert.equal(staffRoleFromUserRole("unit_leader"), "unit_leader");
  });
  test("participant, parent e valori strani -> null", () => {
    for (const role of ["participant", "parent", "", undefined, null, "Admin", "root"]) {
      assert.equal(staffRoleFromUserRole(role), null, String(role));
    }
  });
});

describe("birthYearOf (solo l'anno, mai la data completa)", () => {
  test("YYYY-MM-DD -> anno", () => {
    assert.equal(birthYearOf("2008-05-14"), 2008);
    assert.equal(birthYearOf("1985-12-31"), 1985);
  });
  test("formati diversi, vuoti o non stringhe -> null", () => {
    for (const value of ["14/05/2008", "2008-5-4", "2008", "2008-05-14T00:00:00Z", " 2008-05-14", "", null, undefined, 20080514, {}]) {
      assert.equal(birthYearOf(value), null, JSON.stringify(value));
    }
  });
});

describe("registrationOwnerUids / isLiveRegistration", () => {
  test("titolare, genitore e ospite collegato, senza doppioni né spazi", () => {
    assert.deepEqual(registrationOwnerUids({ userId: "a", parentUid: "b", anonymousUid: "c" }).sort(), ["a", "b", "c"]);
    assert.deepEqual(registrationOwnerUids({ userId: "a", parentUid: " a ", anonymousUid: "a" }), ["a"]);
  });
  test("campi vuoti, mancanti o non stringa sono ignorati; le iscrizioni manual_ non hanno account", () => {
    assert.deepEqual(registrationOwnerUids({ userId: "", parentUid: null, anonymousUid: 7 }), []);
    assert.deepEqual(registrationOwnerUids({}), []);
    assert.deepEqual(registrationOwnerUids(null), []);
    assert.deepEqual(registrationOwnerUids(undefined), []);
  });
  test("contano le iscrizioni inviate e non chiuse: submitted, waitlist, active, pending_parent_authorization, confirmed", () => {
    for (const status of ["submitted", "waitlist", "active", "pending_parent_authorization", "confirmed"]) {
      assert.equal(isLiveRegistration({ registrationStatus: status }), true, status);
    }
    assert.deepEqual([...LIVE_REGISTRATION_STATUSES].sort(), ["active", "confirmed", "pending_parent_authorization", "submitted", "waitlist"]);
  });
  test("non contano la bozza, l'annullata e la rifiutata dal genitore", () => {
    for (const status of ["draft", "cancelled", "rejected_by_parent"]) {
      assert.equal(isLiveRegistration({ registrationStatus: status }), false, status);
    }
    assert.equal(isLiveRegistration(null), false);
    assert.equal(isLiveRegistration(undefined), false);
  });
});

describe("migrationGroupOf (gruppi A3)", () => {
  test("staff vince su tutto, anche senza iscrizioni", () => {
    assert.equal(migrationGroupOf({ role: "admin" }, 0), "staff");
    assert.equal(migrationGroupOf({ role: "super_admin" }, 5), "staff");
    assert.equal(migrationGroupOf({ role: "unit_leader" }, 0), "staff");
  });
  test("participant e parent: con iscrizioni viva = registered, senza = queued", () => {
    assert.equal(migrationGroupOf({ role: "participant" }, 1), "registered");
    assert.equal(migrationGroupOf({ role: "parent" }, 3), "registered");
    assert.equal(migrationGroupOf({ role: "participant" }, 0), "queued");
    assert.equal(migrationGroupOf({ role: "parent" }, 0), "queued");
    assert.equal(migrationGroupOf({}, 0), "queued");
  });
});

describe("planStakeMemberMigration: gruppi della spec", () => {
  test("admin, super_admin e dirigente di unità: active con staffRole, nessuna revisione", () => {
    const admin = user({ role: "admin", unitId: "", unitName: "" });
    const superAdmin = user({ role: "super_admin" });
    const leader = user({ role: "unit_leader" });
    const result = plan({ users: [admin, superAdmin, leader] });
    assert.equal(result.toCreate.length, 3);
    assert.equal(result.counts.staff, 3);
    for (const [member, role] of [[admin, "admin"], [superAdmin, "admin"], [leader, "unit_leader"]]) {
      const doc = docOf(result, member.uid);
      assert.equal(doc.status, "active");
      assert.equal(doc.staffRole, role);
      assert.equal(doc.reviewNeeded, false);
      assert.equal(doc.decidedBy, "system");
      assert.equal(doc.decidedAt, AT);
    }
  });

  test("lo staff è active anche con solo iscrizioni annullate (conta il ruolo)", () => {
    const leader = user({ role: "unit_leader" });
    const result = plan({
      users: [leader],
      registrations: [registration({ userId: leader.uid, registrationStatus: "cancelled" })],
    });
    assert.equal(docOf(result, leader.uid).status, "active");
    assert.equal(docOf(result, leader.uid).reviewNeeded, false);
  });

  test("lo staff con iscrizioni vive non diventa 'da confermare'", () => {
    const admin = user({ role: "admin" });
    const result = plan({ users: [admin], registrations: [registration({ userId: admin.uid })] });
    assert.equal(docOf(result, admin.uid).reviewNeeded, false);
    assert.equal(docOf(result, admin.uid).staffRole, "admin");
  });

  test("participant con iscrizione propria (userId): active con reviewNeeded", () => {
    const youth = user();
    const result = plan({ users: [youth], registrations: [registration({ userId: youth.uid })] });
    const doc = docOf(result, youth.uid);
    assert.equal(doc.status, "active");
    assert.equal(doc.reviewNeeded, true);
    assert.equal(doc.staffRole, null);
    assert.equal(doc.decidedBy, "system");
    assert.equal(result.counts.registered, 1);
  });

  test("genitore che ha iscritto un figlio (parentUid): active con reviewNeeded", () => {
    const parent = user({ role: "parent" });
    const result = plan({ users: [parent], registrations: [registration({ userId: null, parentUid: parent.uid })] });
    assert.equal(docOf(result, parent.uid).status, "active");
    assert.equal(docOf(result, parent.uid).reviewNeeded, true);
  });

  test("ospite poi collegato (anonymousUid = uid dell'account): active con reviewNeeded", () => {
    const youth = user();
    const result = plan({
      users: [youth],
      registrations: [registration({ userId: undefined, anonymousUid: youth.uid })],
    });
    assert.equal(docOf(result, youth.uid).status, "active");
    assert.equal(docOf(result, youth.uid).reviewNeeded, true);
  });

  test("solo iscrizioni annullate: pending ('account esistente'), senza revisione", () => {
    const youth = user();
    const result = plan({
      users: [youth],
      registrations: [
        registration({ userId: youth.uid, registrationStatus: "cancelled" }),
        registration({ userId: youth.uid, activityId: "altra", registrationStatus: "cancelled" }),
      ],
    });
    const doc = docOf(result, youth.uid);
    assert.equal(doc.status, "pending");
    assert.equal(doc.reviewNeeded, false);
    assert.equal(doc.decidedAt, null);
    assert.equal(doc.decidedBy, null);
    assert.equal(doc.registrationHints.length, 0, "un'iscrizione annullata non è un suggerimento");
    assert.equal(result.counts.queued, 1);
  });

  test("nessuna iscrizione: pending", () => {
    const youth = user();
    const result = plan({ users: [youth] });
    assert.equal(docOf(result, youth.uid).status, "pending");
    assert.equal(docOf(result, youth.uid).requestedAt, AT);
  });

  test("una cancellata e una viva: basta la viva", () => {
    const youth = user();
    const result = plan({
      users: [youth],
      registrations: [
        registration({ userId: youth.uid, registrationStatus: "cancelled" }),
        registration({ userId: youth.uid, activityId: "campo", registrationStatus: "confirmed" }),
      ],
    });
    assert.equal(docOf(result, youth.uid).status, "active");
    assert.deepEqual(docOf(result, youth.uid).registrationHints.map((hint) => hint.activityId), ["campo"]);
  });

  // Iscrizione inviata e non chiusa (spec A3): non contano bozza, annullata, rifiutata dal genitore.
  for (const status of ["draft", "rejected_by_parent", "cancelled"]) {
    test(`solo un'iscrizione ${status}: pending, nessun suggerimento`, () => {
      const youth = user();
      const result = plan({ users: [youth], registrations: [registration({ userId: youth.uid, registrationStatus: status })] });
      const doc = docOf(result, youth.uid);
      assert.equal(doc.status, "pending");
      assert.equal(doc.reviewNeeded, false);
      assert.deepEqual(doc.registrationHints, []);
      assert.equal(result.counts.queued, 1);
    });
  }

  for (const status of ["submitted", "waitlist", "active", "pending_parent_authorization", "confirmed"]) {
    test(`un'iscrizione ${status}: active con reviewNeeded`, () => {
      const youth = user();
      const result = plan({ users: [youth], registrations: [registration({ userId: youth.uid, registrationStatus: status })] });
      assert.equal(docOf(result, youth.uid).status, "active");
      assert.equal(docOf(result, youth.uid).reviewNeeded, true);
      assert.equal(result.counts.registered, 1);
    });
  }

  test("mix: una bozza e una confermata -> active; il suggerimento è solo quello dell'iscrizione viva", () => {
    const youth = user();
    const result = plan({
      users: [youth],
      registrations: [
        registration({ userId: youth.uid, activityId: "bozza", registrationStatus: "draft" }),
        registration({ userId: youth.uid, activityId: "viaggio", registrationStatus: "confirmed" }),
      ],
      activityTitles: new Map([["bozza", "Solo bozza"], ["viaggio", "Viaggio al tempio"]]),
    });
    assert.equal(docOf(result, youth.uid).status, "active");
    assert.equal(docOf(result, youth.uid).reviewNeeded, true);
    assert.deepEqual(docOf(result, youth.uid).registrationHints, [{ activityId: "viaggio", title: "Viaggio al tempio" }]);
  });

  test("bozza, rifiutata dal genitore e annullata insieme: pending", () => {
    const youth = user();
    const result = plan({
      users: [youth],
      registrations: [
        registration({ userId: youth.uid, activityId: "a1", registrationStatus: "draft" }),
        registration({ userId: youth.uid, activityId: "a2", registrationStatus: "rejected_by_parent" }),
        registration({ userId: youth.uid, activityId: "a3", registrationStatus: "cancelled" }),
      ],
    });
    assert.equal(docOf(result, youth.uid).status, "pending");
  });

  test("il genitore con solo la bozza di un figlio resta in coda; con un figlio inviato è active", () => {
    const parentDraft = user({ role: "parent" });
    const parentSent = user({ role: "parent" });
    const result = plan({
      users: [parentDraft, parentSent],
      registrations: [
        registration({ userId: undefined, parentUid: parentDraft.uid, registrationStatus: "draft" }),
        registration({ userId: undefined, parentUid: parentSent.uid, registrationStatus: "submitted" }),
      ],
    });
    assert.equal(docOf(result, parentDraft.uid).status, "pending");
    assert.equal(docOf(result, parentSent.uid).status, "active");
  });

  test("lo staff resta active anche con sole bozze (conta il ruolo)", () => {
    const leader = user({ role: "unit_leader" });
    const result = plan({
      users: [leader],
      registrations: [registration({ userId: leader.uid, registrationStatus: "draft" })],
    });
    assert.equal(docOf(result, leader.uid).status, "active");
    assert.equal(docOf(result, leader.uid).reviewNeeded, false);
  });

  test("i uid con iscrizioni ma senza profilo (sessioni ospite) non diventano membri", () => {
    const youth = user();
    const result = plan({
      users: [youth],
      registrations: [
        registration({ userId: "sessione-ospite-1" }),
        registration({ anonymousUid: "sessione-ospite-2" }),
        registration({ userId: youth.uid }),
      ],
    });
    assert.deepEqual(result.toCreate.map((item) => item.uid), [youth.uid]);
  });
});

describe("planStakeMemberMigration: idempotenza e confini", () => {
  test("un members esistente non si tocca mai: nessun documento, motivo 'already_member'", () => {
    const decided = user({ role: "participant" });
    const staff = user({ role: "admin" });
    const fresh = user();
    const result = plan({
      users: [decided, staff, fresh],
      registrations: [registration({ userId: decided.uid })],
      existingMemberUids: new Set([decided.uid, staff.uid]),
    });
    assert.deepEqual(result.toCreate.map((item) => item.uid), [fresh.uid]);
    assert.deepEqual(result.skipped.map((item) => [item.uid, item.reason]).sort(), [
      [decided.uid, "already_member"],
      [staff.uid, "already_member"],
    ].sort());
    assert.equal(result.counts.alreadyMember, 2);
    assert.equal(result.counts.queued, 1);
    assert.equal(result.counts.registered, 0, "l'esistente non viene nemmeno contato nei gruppi");
    assert.equal(result.counts.staff, 0);
  });

  test("secondo giro: con gli uid del primo giro tra gli esistenti il piano è vuoto", () => {
    const users = [user({ role: "admin" }), user(), user({ role: "parent" })];
    const registrations = [registration({ parentUid: users[2].uid })];
    const first = plan({ users, registrations });
    assert.equal(first.toCreate.length, 3);
    const second = plan({ users, registrations, existingMemberUids: new Set(first.toCreate.map((item) => item.uid)) });
    assert.equal(second.toCreate.length, 0);
    assert.equal(second.counts.alreadyMember, 3);
  });

  test("gli utenti di un altro palo (o senza palo) sono ignorati e contati", () => {
    const mine = user();
    const other = user({ stakeId: "milano" });
    const none = user({ stakeId: "" });
    const missing = user({ stakeId: undefined });
    const result = plan({ users: [mine, other, none, missing], registrations: [registration({ userId: other.uid })] });
    assert.deepEqual(result.toCreate.map((item) => item.uid), [mine.uid]);
    assert.equal(result.counts.otherStake, 3);
  });

  test("palo senza utenti: piano vuoto", () => {
    const result = plan({});
    assert.deepEqual(result.toCreate, []);
    assert.deepEqual(result.skipped, []);
  });

  test("gli input non vengono modificati", () => {
    const users = Object.freeze([Object.freeze(user()), Object.freeze(user({ role: "admin" }))]);
    const registrations = Object.freeze([Object.freeze(registration({ userId: users[0].uid }))]);
    const existing = new Set(["x"]);
    const titles = new Map([["viaggio", "Viaggio al tempio"]]);
    plan({ users, registrations, existingMemberUids: existing, activityTitles: titles });
    assert.deepEqual([...existing], ["x"]);
    assert.deepEqual([...titles], [["viaggio", "Viaggio al tempio"]]);
  });

  test("activityTitles accetta anche un oggetto semplice", () => {
    const youth = user();
    const result = plan({
      users: [youth],
      registrations: [registration({ userId: youth.uid })],
      activityTitles: { viaggio: "Viaggio al tempio" },
    });
    assert.equal(docOf(result, youth.uid).registrationHints[0].title, "Viaggio al tempio");
  });

  test("una stessa iscrizione con userId e parentUid uguali conta una volta", () => {
    const parent = user({ role: "parent" });
    const result = plan({
      users: [parent],
      registrations: [registration({ userId: parent.uid, parentUid: parent.uid })],
    });
    assert.equal(docOf(result, parent.uid).registrationHints.length, 1);
  });
});

describe("registrationHints", () => {
  test("al massimo 5, deduplicati per attività, nell'ordine in cui compaiono", () => {
    const youth = user();
    const activities = ["a1", "a2", "a3", "a4", "a5", "a6", "a7"];
    const registrations = [
      registration({ userId: youth.uid, activityId: "a1" }),
      registration({ userId: youth.uid, activityId: "a1" }), // doppione: stessa attività
      ...activities.slice(1).map((activityId) => registration({ userId: youth.uid, activityId })),
      registration({ userId: youth.uid, activityId: "a2" }),
    ];
    const titles = new Map(activities.map((id) => [id, `Titolo ${id}`]));
    const result = plan({ users: [youth], registrations, activityTitles: titles });
    const hints = docOf(result, youth.uid).registrationHints;
    assert.deepEqual(hints.map((hint) => hint.activityId), ["a1", "a2", "a3", "a4", "a5"]);
    assert.deepEqual(hints.map((hint) => hint.title), ["Titolo a1", "Titolo a2", "Titolo a3", "Titolo a4", "Titolo a5"]);
    for (const hint of hints) assert.deepEqual(Object.keys(hint).sort(), ["activityId", "title"]);
  });

  test("titolo mancante -> 'Attività'; attività senza id ignorata", () => {
    const youth = user();
    const result = plan({
      users: [youth],
      registrations: [
        registration({ userId: youth.uid, activityId: "senza-titolo" }),
        registration({ userId: youth.uid, activityId: "" }),
        registration({ userId: youth.uid, activityId: undefined }),
      ],
      activityTitles: new Map(),
    });
    assert.deepEqual(docOf(result, youth.uid).registrationHints, [{ activityId: "senza-titolo", title: "Attività" }]);
  });

  test("le iscrizioni di altri non finiscono tra i suggerimenti", () => {
    const youth = user();
    const other = user();
    const result = plan({
      users: [youth, other],
      registrations: [registration({ userId: youth.uid, activityId: "mia" }), registration({ userId: other.uid, activityId: "sua" })],
      activityTitles: new Map([["mia", "Mia"], ["sua", "Sua"]]),
    });
    assert.deepEqual(docOf(result, youth.uid).registrationHints.map((hint) => hint.activityId), ["mia"]);
    assert.deepEqual(docOf(result, other.uid).registrationHints.map((hint) => hint.activityId), ["sua"]);
  });
});

describe("forma del documento members migrato", () => {
  test("campi del modello della spec, valori iniziali", () => {
    const youth = user({ unitId: "rione-7", unitName: "Rione Sette", birthDate: "2009-02-03" });
    const result = plan({ users: [youth], registrations: [registration({ userId: youth.uid })] });
    const doc = docOf(result, youth.uid);
    assert.deepEqual(Object.keys(doc).sort(), [
      "birthYear", "claimedUnitId", "claimedUnitName", "declineCount", "decidedAt", "decidedBy", "displayName",
      "previous", "registrationHints", "requestedAt", "reviewNeeded", "sources", "staffRole", "status", "version",
    ].sort());
    assert.equal(doc.version, 1);
    assert.equal(doc.declineCount, 0);
    assert.equal(doc.previous, null);
    assert.equal(doc.claimedUnitId, "rione-7");
    assert.equal(doc.claimedUnitName, "Rione Sette");
    assert.equal(doc.displayName, "Anna Rossi");
    assert.equal(doc.birthYear, 2009);
    assert.equal(JSON.stringify(doc).includes("2009-02-03"), false, "la data completa non finisce nel documento");
    assert.equal(doc.requestedAt, AT);
  });

  test("sources: un solo motivo 'migration' col riferimento della migrazione", () => {
    const result = plan({ users: [user()] });
    const { sources } = result.toCreate[0].doc;
    assert.equal(sources.length, 1);
    assert.equal(sources[0].kind, "migration");
    assert.equal(sources[0].ref, REF);
    assert.ok(SOURCE_KINDS.includes(sources[0].kind));
  });

  test("sourceAt va dentro sources (valore concreto), at sui campi di primo livello", () => {
    const doc = plan({ users: [user({ role: "admin" })] }).toCreate[0].doc;
    assert.equal(doc.sources[0].at, SOURCE_AT);
    assert.equal(doc.requestedAt, AT);
    assert.equal(doc.decidedAt, AT);
    assert.notEqual(doc.sources[0].at, AT, "il sentinel serverTimestamp non può stare in un array");
  });

  test("senza sourceAt, sources[0].at ricade su at", () => {
    const doc = buildMigratedMember({
      user: user(),
      liveRegistrations: [],
      activityTitles: new Map(),
      at: AT,
      migrationRef: REF,
    });
    assert.equal(doc.sources[0].at, AT);
    const planned = planStakeMemberMigration({
      stakeId: STAKE,
      users: [user()],
      registrations: [],
      existingMemberUids: new Set(),
      activityTitles: new Map(),
      at: AT,
      migrationRef: REF,
    });
    assert.equal(planned.toCreate[0].doc.sources[0].at, AT);
  });

  test("senza unità nel profilo: stringhe vuote (la richiesta va agli admin)", () => {
    const doc = plan({ users: [user({ unitId: undefined, unitName: undefined })] }).toCreate[0].doc;
    assert.equal(doc.claimedUnitId, "");
    assert.equal(doc.claimedUnitName, "");
  });

  test("displayName: fullName, altrimenti nome e cognome; spazi tolti", () => {
    const withFull = plan({ users: [user({ fullName: "  Anna Maria Rossi ", firstName: "x", lastName: "y" })] }).toCreate[0].doc;
    assert.equal(withFull.displayName, "Anna Maria Rossi");
    const withParts = plan({ users: [user({ fullName: "", firstName: "Luca", lastName: "Bianchi" })] }).toCreate[0].doc;
    assert.equal(withParts.displayName, "Luca Bianchi");
    const onlyFirst = plan({ users: [user({ fullName: undefined, firstName: "Luca", lastName: "" })] }).toCreate[0].doc;
    assert.equal(onlyFirst.displayName, "Luca");
  });

  test("birthYear null se la data non è YYYY-MM-DD", () => {
    assert.equal(plan({ users: [user({ birthDate: "" })] }).toCreate[0].doc.birthYear, null);
    assert.equal(plan({ users: [user({ birthDate: "14/05/2008" })] }).toCreate[0].doc.birthYear, null);
  });
});

describe("conteggi della spec (rilevazione del 2026-10-20)", () => {
  // 10 admin + 21 dirigenti = 31 attivi con staffRole; 108 con iscrizione
  // (101 participant + 7 parent) attivi da confermare; 41 senza iscrizioni
  // (39 participant + 2 parent) in coda; 48 uid con iscrizioni e senza profilo.
  test("lo stesso insieme dà 31 / 108 / 41 e nessun documento per le 48 sessioni ospite", () => {
    const users = [];
    const registrations = [];
    for (let i = 0; i < 10; i += 1) users.push(user({ role: "admin" }));
    for (let i = 0; i < 21; i += 1) users.push(user({ role: "unit_leader" }));
    for (let i = 0; i < 101; i += 1) {
      const youth = user();
      users.push(youth);
      registrations.push(registration({ userId: youth.uid, activityId: `a${i % 4}` }));
    }
    for (let i = 0; i < 7; i += 1) {
      const parent = user({ role: "parent" });
      users.push(parent);
      registrations.push(registration({ userId: undefined, parentUid: parent.uid }));
    }
    for (let i = 0; i < 39; i += 1) users.push(user());
    for (let i = 0; i < 2; i += 1) users.push(user({ role: "parent" }));
    // Un'iscrizione annullata non sposta nessuno dalla coda.
    registrations.push(registration({ userId: users[users.length - 1].uid, registrationStatus: "cancelled" }));
    for (let i = 0; i < 48; i += 1) registrations.push(registration({ userId: `ospite-${i}` }));

    const result = plan({ users, registrations });
    assert.equal(users.length, 180);
    assert.equal(result.counts.staff, 31);
    assert.equal(result.counts.registered, 108);
    assert.equal(result.counts.queued, 41);
    assert.equal(result.toCreate.length, 180);
    assert.equal(result.toCreate.filter((item) => item.doc.status === "active").length, 31 + 108);
    assert.equal(result.toCreate.filter((item) => item.doc.status === "pending").length, 41);
    assert.equal(result.toCreate.filter((item) => item.doc.reviewNeeded).length, 108);
    assert.equal(result.toCreate.filter((item) => item.doc.staffRole === "admin").length, 10);
    assert.equal(result.toCreate.filter((item) => item.doc.staffRole === "unit_leader").length, 21);
    assert.equal(new Set(result.toCreate.map((item) => item.uid)).size, 180);
  });
});
