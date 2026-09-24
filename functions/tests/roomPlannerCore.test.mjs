import test from "node:test";
import assert from "node:assert/strict";

import {
  ageAt,
  assignmentProblem,
  buildPreferenceLinks,
  eligibleRegistrations,
  emptyRoomPlan,
  proposeRoomPlan,
  roomSummary,
  validateRoomPlan,
} from "../lib/roomPlannerCore.mjs";

const DATE = new Date("2026-07-15T12:00:00.000Z");

function room(id, category, capacity = 4, extra = {}) {
  return {
    id,
    name: `Stanza ${id}`,
    capacity,
    floor: "1",
    category,
    accessible: false,
    notes: "",
    minAge: null,
    maxAge: null,
    ...extra,
  };
}

function registration(id, genderRoleCategory = "giovane_uomo", extra = {}) {
  return {
    id,
    fullName: `Persona ${id}`,
    birthDate: genderRoleCategory.startsWith("giovane") ? "2010-01-01" : "1985-01-01",
    genderRoleCategory,
    registrationStatus: "confirmed",
    answers: {},
    roomPreferenceMatches: {},
    userId: id,
    ...extra,
  };
}

function plan(rooms, extra = {}) {
  return { ...emptyRoomPlan(), rooms, updatedAt: DATE.toISOString(), ...extra };
}

test("filtra gli stati non idonei senza deduplicare i nomi", () => {
  const active = registration("active", "giovane_uomo", { fullName: "Nome Uguale" });
  const sameName = registration("same", "giovane_uomo", { fullName: "Nome Uguale" });
  const registrations = [
    active,
    sameName,
    ...["draft", "waitlist", "cancelled", "rejected", "rejected_by_parent"].map((status) =>
      registration(status, "giovane_uomo", { registrationStatus: status }),
    ),
    registration("legacy-cancelled", "giovane_uomo", { registrationStatus: "confirmed", status: "cancelled" }),
    registration("unknown", "giovane_uomo", { registrationStatus: "custom" }),
  ];
  assert.deepEqual(eligibleRegistrations(registrations).map(({ id }) => id), ["active", "same"]);
});

test("calcola l'età alla data dell'evento e rifiuta date impossibili", () => {
  assert.equal(ageAt("2008-07-15", DATE), 18);
  assert.equal(ageAt("2008-07-16", DATE), 17);
  assert.equal(ageAt("2025-02-29", DATE), null);
  assert.equal(ageAt("non-data", DATE), null);
  assert.equal(ageAt("2008-07-16", "2026-07-15T23:30:00-10:00"), 17);
});

test("una preferenza cancellata non riappare dal vecchio abbinamento", () => {
  const source = registration("source", "giovane_uomo", { answers: {}, roomPreferenceMatches: {
    roomPreference1Name: { rawValue: "Marco", status: "matched", matchedRegistrationId: "target" },
  } });
  assert.deepEqual(buildPreferenceLinks([source, registration("target", "giovane_uomo", { fullName: "Marco" })]), []);
});

test("risolve nomi univoci, conserva match coerenti e lascia ambigui irrisolti", () => {
  const target = registration("target", "giovane_donna", { fullName: "Giulia D'Angelo" });
  const exact = registration("exact", "giovane_donna", {
    answers: { roomPreference1Name: "  GIULIA d'angelo " },
  });
  const savedTarget = registration("saved-target", "giovane_donna", { fullName: "Marta Verdi" });
  const saved = registration("saved", "giovane_donna", {
    answers: { roomPreference1Name: "Marti" },
    roomPreferenceMatches: {
      roomPreference1Name: {
        rawValue: "Marti",
        matchedRegistrationId: "saved-target",
        status: "matched",
      },
    },
  });
  const duplicateA = registration("duplicate-a", "giovane_donna", { fullName: "Anna Rossi" });
  const duplicateB = registration("duplicate-b", "giovane_donna", { fullName: "Anna Rossi" });
  const ambiguous = registration("ambiguous", "giovane_donna", {
    answers: { roomPreference1Name: "Anna Rossi" },
    roomPreferenceMatches: {
      roomPreference1Name: {
        rawValue: "Anna Rossi",
        matchedRegistrationId: "duplicate-a",
        status: "matched",
      },
    },
  });
  const sameAsRequester = registration("same-as-requester", "giovane_donna", {
    fullName: "Nome Condiviso",
    answers: { roomPreference1Name: "Nome Condiviso" },
  });
  const sameAsOther = registration("same-as-other", "giovane_donna", { fullName: "Nome Condiviso" });
  const links = buildPreferenceLinks([target, exact, savedTarget, saved, duplicateA, duplicateB, ambiguous, sameAsRequester, sameAsOther]);
  assert.equal(links.find((link) => link.fromId === "exact")?.toId, "target");
  assert.equal(links.find((link) => link.fromId === "saved")?.toId, "saved-target");
  assert.equal(links.find((link) => link.fromId === "ambiguous")?.toId, null);
  assert.equal(links.find((link) => link.fromId === "same-as-requester")?.toId, null);
});

test("valida capienza, separazione, età e identità stabili duplicate", () => {
  const boy = registration("boy", "giovane_uomo", { userId: "same-user" });
  const duplicate = registration("duplicate", "giovane_uomo", {
    userId: null,
    linkedLaterToUserId: "same-user",
  });
  const girl = registration("girl", "giovane_donna");
  const rooms = [room("staff", "staff_male", 1), room("boys", "boys", 1, { minAge: 15, maxAge: 17 })];
  const invalid = plan(rooms, {
    assignments: { boy: "boys", duplicate: "staff", girl: "boys" },
    adultGenders: {},
  });
  const errors = validateRoomPlan(invalid, [boy, duplicate, girl], DATE);
  assert.ok(errors.some((error) => error.includes("stessa persona")));
  assert.ok(errors.some((error) => error.includes("giovani donne")));
  assert.ok(errors.some((error) => error.includes("capienza")));
  assert.equal(assignmentProblem(boy, rooms[1], invalid, [boy, duplicate, girl], DATE)?.includes("stessa persona"), true);
});

test("rifiuta nomi stanza duplicati ignorando maiuscole e accenti", () => {
  const errors = validateRoomPlan(
    plan([room("staff", "staff_male", 2, { name: "Primo Piáno" }), room("boys", "boys", 2, { name: "primo piano" })]),
    [],
    DATE,
  );
  assert.ok(errors.some((error) => error.includes("Nome stanza duplicato")));
});

test("una stanza coppia ammette soltanto due adulti di sesso diverso confermati", () => {
  const first = registration("first", "dirigente");
  const second = registration("second", "accompagnatore");
  const youth = registration("youth");
  const valid = plan([room("staff", "staff_male", 2), room("couple", "couple", 2)], {
    assignments: { first: "couple", second: "couple" },
    adultGenders: { first: "male", second: "female" },
    couples: [{ firstId: "first", secondId: "second", confirmed: true }],
  });
  assert.deepEqual(validateRoomPlan(valid, [first, second, youth], DATE), []);

  const unconfirmed = { ...valid, couples: [{ firstId: "first", secondId: "second", confirmed: false }] };
  assert.ok(validateRoomPlan(unconfirmed, [first, second], DATE).some((error) => error.includes("confermata")));
  const sameGender = { ...valid, adultGenders: { first: "male", second: "male" } };
  assert.ok(validateRoomPlan(sameGender, [first, second], DATE).some((error) => error.includes("uomo e una donna")));
  assert.ok(assignmentProblem(youth, valid.rooms[1], valid, [first, second, youth], DATE));
});

test("l'automatico privilegia preferenze reciproche e unidirezionali", () => {
  const a = registration("a", "giovane_uomo", { fullName: "Alfa Uno", answers: { roomPreference1Name: "Delta Quattro" } });
  const d = registration("d", "giovane_uomo", { fullName: "Delta Quattro", answers: { roomPreference1Name: "Alfa Uno" } });
  const b = registration("b", "giovane_uomo", { fullName: "Beta Due", answers: { roomPreference1Name: "Gamma Tre" } });
  const c = registration("c", "giovane_uomo", { fullName: "Gamma Tre" });
  const proposed = proposeRoomPlan(
    plan([room("staff", "staff_female", 2), room("one", "boys", 2), room("two", "boys", 2)]),
    [a, b, c, d],
    DATE,
  );
  assert.equal(proposed.assignments.a, proposed.assignments.d);
  assert.equal(proposed.assignments.b, proposed.assignments.c);
  assert.equal(Object.keys(proposed.assignments).length, 4);
});

test("riserva una stanza staff, rispetta note e ricalcolo", () => {
  const locked = registration("locked");
  const movable = registration("movable");
  const noted = registration("noted", "giovane_uomo", { answers: { roomNotes: "Vicino al bagno" } });
  const adult = registration("adult", "dirigente");
  const source = plan([room("small", "unassigned", 2), room("large", "boys", 4)], {
    assignments: { locked: "large", movable: "large", adult: "small" },
    lockedIds: ["locked"],
    adultGenders: { adult: "male" },
  });
  const proposed = proposeRoomPlan(source, [locked, movable, noted, adult], DATE, { recalculate: true });
  assert.equal(proposed.rooms.find(({ id }) => id === "small")?.category, "staff_male");
  assert.equal(proposed.assignments.locked, "large");
  assert.equal(proposed.assignments.adult, "small");
  assert.equal(proposed.assignments.noted, undefined);
});

test("assegna deterministicamente oltre cento giovani senza superare i letti", () => {
  const registrations = Array.from({ length: 120 }, (_, index) =>
    registration(`p-${String(index).padStart(3, "0")}`, index % 2 ? "giovane_donna" : "giovane_uomo"),
  );
  const rooms = [room("staff", "staff_male", 2)];
  for (let index = 0; index < 6; index += 1) rooms.push(room(`b-${index}`, "boys", 10));
  for (let index = 0; index < 6; index += 1) rooms.push(room(`g-${index}`, "girls", 10));
  const first = proposeRoomPlan(plan(rooms), registrations, DATE);
  const second = proposeRoomPlan(plan(rooms), registrations, DATE);
  assert.deepEqual(first.assignments, second.assignments);
  assert.equal(Object.keys(first.assignments).length, 120);
  assert.deepEqual(validateRoomPlan(first, registrations, DATE), []);
  assert.deepEqual(roomSummary(first, registrations), {
    assigned: 120,
    totalBeds: 122,
    freeBeds: 2,
    preferencesMet: 0,
    preferencesTotal: 0,
    unresolvedPreferences: 0,
  });
});

test("occupa tutte le stanze prima di soddisfare le preferenze", () => {
  const people = [registration("a", "giovane_uomo", { answers: { roomPreference1Name: "Persona b" } }), registration("b")];
  const input = plan([room("staff", "staff_male"), room("a", "boys"), room("b", "boys")]);
  const result = proposeRoomPlan(input, people, DATE, { occupyAllRoomsFirst: true });
  assert.equal(new Set(Object.values(result.assignments)).size, 2);
  assert.equal(Object.keys(result.assignments).length, 2);
  assert.deepEqual(validateRoomPlan(result, people, DATE), []);
  assert.deepEqual(input.assignments, {});
});

test("riusa i letti liberi solo dopo aver aperto tutte le stanze compatibili", () => {
  const people = Array.from({ length: 8 }, (_, index) => registration(`p${index}`));
  const input = plan([room("staff", "staff_male"), room("small", "boys", 1), room("medium", "boys", 2), room("large", "boys", 4)]);
  const result = proposeRoomPlan(input, people, DATE, { occupyAllRoomsFirst: true });
  assert.equal(new Set(Object.values(result.assignments)).size, 3);
  assert.equal(Object.keys(result.assignments).length, 7);
  assert.deepEqual(validateRoomPlan(result, people, DATE), []);
});

test("separa i piani, riclassifica stanze giovani vuote e conserva staff e coppie", () => {
  const people = [registration("boy"), registration("girl", "giovane_donna")];
  const input = plan([
    room("staff", "staff_male", 2, { floor: "PT" }),
    room("ground", "girls", 4, { floor: "PT" }),
    room("first", "boys", 4, { floor: "1" }),
    room("couple", "couple", 2, { floor: "1" }),
    room("unknown", "unassigned", 4, { floor: "" }),
  ]);
  const result = proposeRoomPlan(input, people, DATE, { occupyAllRoomsFirst: true, youthFloors: { boys: "PT", girls: "1" } });
  assert.deepEqual(result.assignments, { boy: "ground", girl: "first" });
  assert.equal(result.rooms.find((room) => room.id === "staff").category, "staff_male");
  assert.equal(result.rooms.find((room) => room.id === "couple").category, "couple");
  assert.deepEqual(validateRoomPlan(result, people, DATE), []);
});

test("non supera il piano scelto quando i posti finiscono e non usa stanze senza piano", () => {
  const people = [registration("a"), registration("b"), registration("c")];
  const input = plan([room("staff", "staff_male"), room("ground", "boys", 1, { floor: "PT" }), room("first", "unassigned", 10), room("unknown", "unassigned", 10, { floor: "" })]);
  const result = proposeRoomPlan(input, people, DATE, { occupyAllRoomsFirst: true, youthFloors: { boys: "PT", girls: "1" } });
  assert.deepEqual(Object.values(result.assignments), ["ground"]);
});

test("segnala blocchi su piani incompatibili e ricalcola solo le assegnazioni sbloccate", () => {
  const people = [registration("boy")];
  const input = plan([room("staff", "staff_male"), room("ground", "boys", 2, { floor: "PT" }), room("first", "boys")], { assignments: { boy: "first" } });
  const options = { youthFloors: { boys: "PT", girls: "1" }, occupyAllRoomsFirst: true };
  assert.throws(() => proposeRoomPlan(input, people, DATE, options), /assegnazione conservata/);
  assert.deepEqual(proposeRoomPlan(input, people, DATE, { ...options, recalculate: true }).assignments, { boy: "ground" });
  assert.throws(() => proposeRoomPlan({ ...input, lockedIds: ["boy"] }, people, DATE, { ...options, recalculate: true }), /assegnazione conservata/);
  assert.throws(() => proposeRoomPlan(input, people, DATE, { youthFloors: { boys: "", girls: "1" } }), /due piani diversi/);
});

test("la priorità stanze conserva blocchi, note e limiti di età", () => {
  const people = [registration("locked"), registration("note", "giovane_uomo", { answers: { roomNotes: "Da verificare" } }), registration("new")];
  const input = plan([room("staff", "staff_male"), room("used", "boys"), room("empty", "boys"), room("older", "boys", 4, { minAge: 18 })], { assignments: { locked: "used" }, lockedIds: ["locked"] });
  const result = proposeRoomPlan(input, people, DATE, { occupyAllRoomsFirst: true, recalculate: true });
  assert.deepEqual(result.assignments, { locked: "used", new: "empty" });
  assert.deepEqual(result.lockedIds, ["locked"]);
  assert.deepEqual(validateRoomPlan(result, people, DATE), []);
});
