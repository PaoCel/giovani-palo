import test from "node:test";
import assert from "node:assert/strict";

import {
  ageAt,
  assignmentProblem,
  buildPreferenceLinks,
  eligibleRegistrations,
  emptyRoomPlan,
  isRoomEligibleStatus,
  proposeRoomPlan,
  removeRegistrationReferences,
  roomSummary,
  staleRegistrationIds,
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

test("un minorenne con categoria adulta non va in una stanza staff", () => {
  const rooms = [room("staff", "staff_male", 2)];
  const kid = registration("kid", "accompagnatore", { birthDate: "2012-05-05" });
  const adult = registration("adult", "accompagnatore");
  const withKid = plan(rooms, { assignments: { kid: "staff" }, adultGenders: { kid: "male" } });
  assert.match(assignmentProblem(kid, rooms[0], withKid, [kid, adult], DATE) ?? "", /Minorenne con categoria adulta/u);
  assert.ok(validateRoomPlan(withKid, [kid, adult], DATE).some((error) => /Minorenne con categoria adulta/u.test(error)));
  const withAdult = plan(rooms, { assignments: { adult: "staff" }, adultGenders: { adult: "male" } });
  assert.equal(assignmentProblem(adult, rooms[0], withAdult, [kid, adult], DATE), null);
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

test("lo stato idoneo guarda solo lo stato, non l'id, e lo stato legacy non idoneo prevale", () => {
  for (const status of ["submitted", "confirmed", "active", "pending_parent_authorization"]) {
    assert.equal(isRoomEligibleStatus({ registrationStatus: status }), true, status);
  }
  for (const status of ["draft", "waitlist", "cancelled", "rejected", "rejected_by_parent", "custom", ""]) {
    assert.equal(isRoomEligibleStatus({ registrationStatus: status }), false, status || "stato vuoto");
  }
  // Maiuscole e spazi non cambiano l'esito.
  assert.equal(isRoomEligibleStatus({ registrationStatus: "  CONFIRMED " }), true);
  assert.equal(isRoomEligibleStatus({ registrationStatus: " Cancelled" }), false);
  // Senza lo stato principale decide quello legacy.
  assert.equal(isRoomEligibleStatus({ status: "confirmed" }), true);
  assert.equal(isRoomEligibleStatus({ status: "cancelled" }), false);
  assert.equal(isRoomEligibleStatus({ status: "custom" }), false);
  assert.equal(isRoomEligibleStatus({}), false);
  // Uno stato legacy non idoneo prevale su uno principale idoneo, e viceversa.
  assert.equal(isRoomEligibleStatus({ registrationStatus: "confirmed", status: "cancelled" }), false);
  assert.equal(isRoomEligibleStatus({ registrationStatus: "cancelled", status: "confirmed" }), false);
  assert.equal(isRoomEligibleStatus({ registrationStatus: "confirmed", status: "confirmed" }), true);
  // Un id mancante non conta: eligibleRegistrations, invece, lo richiede.
  assert.equal(isRoomEligibleStatus({ registrationStatus: "confirmed" }), true);
  assert.deepEqual(eligibleRegistrations([{ registrationStatus: "confirmed" }]), []);
});

test("lo stato idoneo rifiuta input che non è un oggetto senza lanciare", () => {
  for (const value of [null, undefined, "confirmed", 42, true, [], ["confirmed"]]) {
    assert.equal(isRoomEligibleStatus(value), false, JSON.stringify(value) ?? "undefined");
  }
});

test("le iscrizioni non più idonee citate dal piano si trovano in ogni riferimento", () => {
  const registrations = [
    registration("ok"),
    registration("annullata", "giovane_uomo", { registrationStatus: "cancelled" }),
    registration("rifiutata", "giovane_donna", { registrationStatus: "rejected" }),
    registration("legacy", "giovane_uomo", { registrationStatus: "confirmed", status: "cancelled" }),
    registration("blocco", "giovane_uomo", { registrationStatus: "cancelled" }),
    registration("sesso", "dirigente", { registrationStatus: "cancelled" }),
    registration("moglie", "accompagnatore", { registrationStatus: "cancelled" }),
    registration("marito", "dirigente"),
  ];
  const input = plan([room("staff", "staff_male"), room("boys", "boys")], {
    assignments: { ok: "boys", annullata: "boys", rifiutata: "boys", legacy: "boys", assente: "boys" },
    lockedIds: ["blocco"],
    adultGenders: { sesso: "male", marito: "male" },
    couples: [{ firstId: "marito", secondId: "moglie", confirmed: true }],
  });
  assert.deepEqual(
    staleRegistrationIds(input, registrations).sort(),
    ["annullata", "assente", "blocco", "legacy", "moglie", "rifiutata", "sesso"].sort(),
  );
});

test("le iscrizioni idonee non risultano mai da rimuovere e gli id non si ripetono", () => {
  const registrations = [
    registration("boy"),
    registration("adulto", "dirigente"),
    registration("moglie", "accompagnatore", { registrationStatus: "pending_parent_authorization" }),
    registration("annullata", "giovane_uomo", { registrationStatus: "cancelled" }),
  ];
  const rooms = [room("staff", "staff_male"), room("boys", "boys")];
  const valid = plan(rooms, {
    assignments: { boy: "boys", adulto: "staff" },
    lockedIds: ["boy"],
    adultGenders: { adulto: "male", moglie: "female" },
    couples: [{ firstId: "adulto", secondId: "moglie", confirmed: false }],
  });
  assert.deepEqual(staleRegistrationIds(valid, registrations), []);
  assert.deepEqual(staleRegistrationIds(emptyRoomPlan(), registrations), []);

  // Lo stesso id citato da assegnazione, blocco, sesso e coppia compare una volta sola.
  const repeated = plan(rooms, {
    assignments: { annullata: "boys" },
    lockedIds: ["annullata"],
    adultGenders: { annullata: "male" },
    couples: [{ firstId: "annullata", secondId: "annullata", confirmed: false }, { firstId: "annullata", secondId: "boy", confirmed: false }],
  });
  assert.deepEqual(staleRegistrationIds(repeated, registrations), ["annullata"]);
});

test("un id citato solo da blocchi, sesso staff o coppie è comunque da rimuovere", () => {
  const registrations = [registration("adulto", "dirigente"), registration("vivo", "accompagnatore")];
  const input = plan([room("staff", "staff_male")]);
  assert.deepEqual(staleRegistrationIds({ ...input, lockedIds: ["fantasma"] }, registrations), ["fantasma"]);
  assert.deepEqual(staleRegistrationIds({ ...input, adultGenders: { fantasma: "female" } }, registrations), ["fantasma"]);
  assert.deepEqual(
    staleRegistrationIds({ ...input, couples: [{ firstId: "adulto", secondId: "fantasma", confirmed: true }] }, registrations),
    ["fantasma"],
  );
  assert.deepEqual(
    staleRegistrationIds({ ...input, couples: [{ firstId: "fantasma", secondId: "vivo", confirmed: false }] }, registrations),
    ["fantasma"],
  );
});

test("le iscrizioni da rimuovere si trovano anche con input malformato, senza eccezioni", () => {
  assert.deepEqual(staleRegistrationIds(null, [registration("a")]), []);
  assert.deepEqual(staleRegistrationIds(undefined, undefined), []);
  assert.deepEqual(staleRegistrationIds("piano", "iscrizioni"), []);
  assert.deepEqual(
    staleRegistrationIds({ assignments: [], lockedIds: [null, 5, "", {}], adultGenders: "x", couples: [null, 7, {}] }, [registration("a")]),
    [],
  );
  // Senza elenco di iscrizioni valido nessuna è idonea: tutti gli id citati sono da togliere.
  assert.deepEqual(staleRegistrationIds({ assignments: { a: "boys" } }, null), ["a"]);
});

test("la rimozione toglie ogni riferimento a una persona, coppia compresa", () => {
  const input = plan([room("staff", "staff_male"), room("boys", "boys")], {
    assignments: { boy: "boys", gone: "boys", adulto: "staff" },
    lockedIds: ["boy", "gone"],
    adultGenders: { adulto: "male", gone: "female" },
    couples: [{ firstId: "gone", secondId: "adulto", confirmed: true }],
  });
  assert.deepEqual(removeRegistrationReferences(input, ["gone"]), {
    assignments: { boy: "boys", adulto: "staff" },
    adultGenders: { adulto: "male" },
    lockedIds: ["boy"],
    couples: [],
  });
});

test("la rimozione toglie più persone insieme e accetta quelle citate solo da blocchi o sesso", () => {
  const input = plan([room("staff", "staff_male"), room("boys", "boys")], {
    assignments: { a: "boys", b: "boys", c: "boys" },
    lockedIds: ["a", "solo-blocco"],
    adultGenders: { "solo-sesso": "male", c: "female" },
  });
  assert.deepEqual(removeRegistrationReferences(input, ["a", "b", "solo-blocco", "solo-sesso"]), {
    assignments: { c: "boys" },
    adultGenders: { c: "female" },
    lockedIds: [],
    couples: [],
  });
  assert.deepEqual(removeRegistrationReferences(input, ["solo-blocco"])?.lockedIds, ["a"]);
  assert.deepEqual(removeRegistrationReferences(input, ["solo-sesso"])?.adultGenders, { c: "female" });
});

test("rimuovendo un coniuge si libera anche l'altro dalla matrimoniale, con blocco e coppia", () => {
  const input = plan([room("staff", "staff_male"), room("couple", "couple", 2)], {
    assignments: { marito: "couple", moglie: "couple" },
    lockedIds: ["marito", "moglie"],
    adultGenders: { marito: "male", moglie: "female" },
    couples: [{ firstId: "marito", secondId: "moglie", confirmed: true }],
  });
  const result = removeRegistrationReferences(input, ["moglie"]);
  assert.deepEqual(result, {
    assignments: {},
    // Il sesso resta a chi non è stato rimosso: serve a rimetterlo in una stanza staff.
    adultGenders: { marito: "male" },
    lockedIds: [],
    couples: [],
  });
  // Vale anche a parti invertite.
  const reversed = removeRegistrationReferences(input, ["marito"]);
  assert.deepEqual(reversed?.assignments, {});
  assert.deepEqual(reversed?.adultGenders, { moglie: "female" });
  assert.deepEqual(reversed?.lockedIds, []);
  assert.deepEqual(reversed?.couples, []);
});

test("il coniuge rimasto solo in una matrimoniale viene liberato anche se l'altro non aveva una stanza", () => {
  const input = plan([room("staff", "staff_male"), room("couple", "couple", 2)], {
    assignments: { moglie: "couple" },
    lockedIds: ["moglie"],
    adultGenders: { marito: "male", moglie: "female" },
    couples: [{ firstId: "marito", secondId: "moglie", confirmed: true }],
  });
  const result = removeRegistrationReferences(input, ["marito"]);
  assert.deepEqual(result?.assignments, {});
  assert.deepEqual(result?.lockedIds, []);
  assert.deepEqual(result?.couples, []);
  assert.deepEqual(result?.adultGenders, { moglie: "female" });
});

test("il coniuge che sta in una stanza non coppia resta dov'è", () => {
  const input = plan([room("staff", "staff_male", 3), room("couple", "couple", 2)], {
    assignments: { marito: "staff", moglie: "staff" },
    lockedIds: ["marito", "moglie"],
    adultGenders: { marito: "male", moglie: "male" },
    couples: [{ firstId: "marito", secondId: "moglie", confirmed: false }],
  });
  assert.deepEqual(removeRegistrationReferences(input, ["moglie"]), {
    assignments: { marito: "staff" },
    adultGenders: { marito: "male" },
    lockedIds: ["marito"],
    couples: [],
  });
  // Coniuge fuori da ogni stanza: nessun effetto collaterale sul resto.
  const unassigned = { ...input, assignments: { moglie: "staff" }, lockedIds: ["moglie"] };
  assert.deepEqual(removeRegistrationReferences(unassigned, ["moglie"])?.assignments, {});
  // Non toccare le coppie degli altri.
  const other = { ...input, couples: [...input.couples, { firstId: "x", secondId: "y", confirmed: true }] };
  assert.deepEqual(removeRegistrationReferences(other, ["moglie"])?.couples, [{ firstId: "x", secondId: "y", confirmed: true }]);
});

test("la rimozione di una persona di un'altra coppia non libera chi sta nella matrimoniale", () => {
  const input = plan([room("staff", "staff_male"), room("couple", "couple", 2)], {
    assignments: { marito: "couple", moglie: "couple" },
    lockedIds: ["marito", "moglie"],
    adultGenders: { marito: "male", moglie: "female" },
    couples: [{ firstId: "marito", secondId: "moglie", confirmed: true }, { firstId: "x", secondId: "y", confirmed: true }],
  });
  assert.deepEqual(removeRegistrationReferences(input, ["x"]), {
    assignments: { marito: "couple", moglie: "couple" },
    adultGenders: { marito: "male", moglie: "female" },
    lockedIds: ["marito", "moglie"],
    couples: [{ firstId: "marito", secondId: "moglie", confirmed: true }],
  });
});

test("la rimozione restituisce null quando il piano non cita le persone", () => {
  const input = plan([room("staff", "staff_male"), room("boys", "boys")], {
    assignments: { a: "boys" },
    lockedIds: ["a"],
    adultGenders: { b: "male" },
    couples: [{ firstId: "b", secondId: "c", confirmed: false }],
  });
  assert.equal(removeRegistrationReferences(input, ["assente"]), null);
  assert.equal(removeRegistrationReferences(input, []), null);
  assert.equal(removeRegistrationReferences(emptyRoomPlan(), ["a"]), null);
  assert.equal(removeRegistrationReferences(input, ["a"]) === null, false);
});

test("la rimozione non modifica il piano in ingresso", () => {
  const input = plan([room("staff", "staff_male"), room("couple", "couple", 2)], {
    assignments: { marito: "couple", moglie: "couple", altro: "staff" },
    lockedIds: ["marito", "moglie"],
    adultGenders: { marito: "male", moglie: "female", altro: "male" },
    couples: [{ firstId: "marito", secondId: "moglie", confirmed: true }],
  });
  const before = structuredClone(input);
  const ids = ["moglie"];
  const result = removeRegistrationReferences(input, ids);
  assert.deepEqual(input, before);
  assert.deepEqual(ids, ["moglie"]);
  // Il risultato non condivide strutture con l'ingresso: modificarlo non lo altera.
  result.assignments.altro = "cambiato";
  result.couples.push({ firstId: "z", secondId: "w", confirmed: false });
  result.lockedIds.push("z");
  result.adultGenders.altro = "female";
  assert.deepEqual(input, before);
  // Anche quando non cambia nulla il piano resta intatto.
  assert.equal(removeRegistrationReferences(input, ["assente"]), null);
  assert.deepEqual(input, before);
});

test("la rimozione con input malformato non lancia eccezioni", () => {
  for (const value of [null, undefined, "piano", 7, []]) {
    assert.equal(removeRegistrationReferences(value, ["a"]), null, JSON.stringify(value) ?? "undefined");
  }
  assert.equal(removeRegistrationReferences({}, ["a"]), null);
  assert.equal(removeRegistrationReferences({ rooms: "x", assignments: [], lockedIds: "y", adultGenders: null, couples: {} }, ["a"]), null);
  assert.equal(removeRegistrationReferences(plan([]), undefined), null);
  assert.equal(removeRegistrationReferences(plan([]), null), null);
  // Elementi nulli o incompleti nelle liste non bloccano la pulizia del resto.
  const dirty = {
    rooms: [{ id: "couple", category: "couple" }],
    assignments: { a: "couple" },
    lockedIds: [null, "a", 5],
    adultGenders: { a: "male" },
    couples: [null, {}, 3, { firstId: "a", secondId: "b", confirmed: true }],
  };
  const result = removeRegistrationReferences(dirty, ["a"]);
  assert.deepEqual(result?.assignments, {});
  assert.deepEqual(result?.adultGenders, {});
  assert.deepEqual(result?.lockedIds, [null, 5]);
  assert.deepEqual(result?.couples, [null, {}, 3]);
});

// Regressione: con una voce nulla in `rooms` (o senza id) e il coniuge senza
// stanza, `room?.id` e `assignments[partnerId]` erano entrambi undefined,
// risultavano uguali e `room.category` lanciava. Un piano salvato dalla
// callable non ha stanze nulle (parsePlan), ma i dati scritti a mano sì.
test("la rimozione non lancia con una stanza nulla o senza id e il coniuge senza stanza", () => {
  const dirty = {
    rooms: [null, { category: "couple" }, { id: "couple", category: "couple" }],
    assignments: { a: "couple" },
    lockedIds: ["a", "b"],
    adultGenders: { a: "male" },
    couples: [{ firstId: "a", secondId: "b", confirmed: true }],
  };
  let result;
  assert.doesNotThrow(() => { result = removeRegistrationReferences(dirty, ["a"]); });
  assert.deepEqual(result?.assignments, {});
  assert.deepEqual(result?.adultGenders, {});
  assert.deepEqual(result?.couples, []);
  // Il coniuge senza stanza non viene "liberato" da una stanza che non ha: il blocco resta com'era.
  assert.deepEqual(result?.lockedIds, ["b"]);
});

test("un'iscrizione assegnata e poi annullata rende il piano non valido col suo nome", () => {
  const boy = registration("boy", "giovane_uomo", { fullName: "Marco Bianchi" });
  const rooms = [room("staff", "staff_male", 2), room("boys", "boys", 2)];
  const saved = plan(rooms, { assignments: { boy: "boys" }, lockedIds: ["boy"] });
  assert.deepEqual(validateRoomPlan(saved, [boy], DATE), []);

  const cancelled = { ...boy, registrationStatus: "cancelled" };
  const errors = validateRoomPlan(saved, [cancelled], DATE);
  assert.ok(errors.includes("Marco Bianchi: L'iscrizione non è idonea al piano stanze."), errors.join(" | "));

  // Stato legacy: stesso messaggio. Annullata senza nome: resta il messaggio per id.
  const legacy = { ...boy, status: "cancelled" };
  assert.ok(validateRoomPlan(saved, [legacy], DATE).some((error) => error.includes("Marco Bianchi")));
  const anonymous = { ...cancelled, fullName: "" };
  assert.ok(
    validateRoomPlan(saved, [anonymous], DATE).includes("Assegnazione riferita a un'iscrizione assente o non idonea: boy."),
  );
});

test("un'iscrizione assente dal piano mantiene il messaggio per id", () => {
  const rooms = [room("staff", "staff_male", 2), room("boys", "boys", 2)];
  const saved = plan(rooms, { assignments: { fantasma: "boys" } });
  const errors = validateRoomPlan(saved, [registration("altro")], DATE);
  assert.ok(errors.includes("Assegnazione riferita a un'iscrizione assente o non idonea: fantasma."), errors.join(" | "));
  assert.ok(!errors.some((error) => error.includes("non è idonea al piano stanze")));
});

test("dopo l'annullamento la rimozione dei riferimenti riporta il piano valido e rigenerabile", () => {
  const boy = registration("boy", "giovane_uomo", { fullName: "Marco Bianchi" });
  const girl = registration("girl", "giovane_donna", { fullName: "Giulia Verdi" });
  const marito = registration("marito", "dirigente", { fullName: "Paolo Neri" });
  const moglie = registration("moglie", "accompagnatore", { fullName: "Anna Neri" });
  const rooms = [room("staff", "staff_male", 2), room("boys", "boys", 3), room("girls", "girls", 3), room("couple", "couple", 2)];
  const saved = plan(rooms, {
    assignments: { boy: "boys", girl: "girls", marito: "couple", moglie: "couple" },
    lockedIds: ["boy", "marito", "moglie"],
    adultGenders: { marito: "male", moglie: "female" },
    couples: [{ firstId: "marito", secondId: "moglie", confirmed: true }],
  });
  const before = [boy, girl, marito, moglie];
  assert.deepEqual(validateRoomPlan(saved, before, DATE), []);

  // Annullano un ragazzo e una moglie: il piano salvato prima non regge più.
  const after = [{ ...boy, registrationStatus: "cancelled" }, girl, marito, { ...moglie, registrationStatus: "cancelled" }];
  const errors = validateRoomPlan(saved, after, DATE);
  assert.ok(errors.some((error) => error.includes("Marco Bianchi")), errors.join(" | "));
  assert.ok(errors.some((error) => error.includes("Anna Neri")), errors.join(" | "));

  const stale = staleRegistrationIds(saved, after);
  assert.deepEqual(stale.sort(), ["boy", "moglie"]);
  const cleaned = { ...saved, ...removeRegistrationReferences(saved, stale) };
  assert.deepEqual(cleaned.assignments, { girl: "girls" });
  assert.deepEqual(cleaned.lockedIds, []);
  assert.deepEqual(cleaned.couples, []);
  assert.deepEqual(cleaned.adultGenders, { marito: "male" });
  assert.deepEqual(validateRoomPlan(cleaned, after, DATE), []);
  assert.deepEqual(staleRegistrationIds(cleaned, after), []);
  assert.doesNotThrow(() => proposeRoomPlan(cleaned, after, DATE));
  assert.doesNotThrow(() => proposeRoomPlan(cleaned, after, DATE, { recalculate: true, occupyAllRoomsFirst: true }));
  // L'automatico non rimette l'annullato in una stanza.
  const proposed = proposeRoomPlan(cleaned, after, DATE, { recalculate: true });
  assert.equal(proposed.assignments.boy, undefined);
  assert.equal(proposed.assignments.moglie, undefined);
  assert.deepEqual(validateRoomPlan(proposed, after, DATE), []);
});
