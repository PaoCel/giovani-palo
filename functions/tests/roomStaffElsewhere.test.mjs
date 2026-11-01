import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import {
  MISSING_STAFF_ROOM,
  assignmentProblem,
  emptyRoomPlan,
  proposeRoomPlan,
  validateRoomPlan,
} from "../lib/roomPlannerCore.mjs";

const require = createRequire(import.meta.url);
const {
  cleanupRegistrationFromPlan,
  createRoomManagementSaveHandler,
  parsePlan,
} = require("../lib/roomManagement.js");

// Contratto: docs/ATTIVITA_MODULARI.md, «Quinto incremento: finitura alloggi»,
// e docs/ROOM_MANAGEMENT.md (stanza staff e `staffElsewhere`).

const DATE = new Date("2026-07-15T12:00:00.000Z");

function room(id, category, capacity = 4, extra = {}) {
  return { id, name: `Stanza ${id}`, capacity, floor: "1", category, accessible: false, notes: "", minAge: null, maxAge: null, ...extra };
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
    userId: `utente-${id}`,
    ...extra,
  };
}

function plan(rooms, extra = {}) {
  return { ...emptyRoomPlan(), rooms, updatedAt: DATE.toISOString(), ...extra };
}

const YOUTH_ONLY_ROOMS = [room("boys", "boys", 2), room("girls", "girls", 2)];

test("il piano vuoto nasce con staffElsewhere false e il messaggio è quello del contratto", () => {
  assert.equal(emptyRoomPlan().staffElsewhere, false);
  assert.equal(MISSING_STAFF_ROOM, "Riserva almeno una stanza agli accompagnatori, oppure indica che sono alloggiati altrove.");
});

test("senza stanza staff il salvataggio chiede la stanza, salvo staffElsewhere true", () => {
  const withoutStaff = plan(YOUTH_ONLY_ROOMS);
  const { staffElsewhere, ...legacy } = withoutStaff;
  assert.equal(staffElsewhere, false);
  assert.deepEqual(validateRoomPlan(legacy, [], DATE), [MISSING_STAFF_ROOM], "campo assente come nei piani vecchi");
  assert.deepEqual(validateRoomPlan(withoutStaff, [], DATE), [MISSING_STAFF_ROOM], "false esplicito");
  assert.deepEqual(validateRoomPlan({ ...withoutStaff, staffElsewhere: true }, [], DATE), []);
});

test("solo il booleano true esonera dalla stanza staff", () => {
  for (const value of ["true", 1, "yes", {}, null]) {
    assert.deepEqual(validateRoomPlan(plan(YOUTH_ONLY_ROOMS, { staffElsewhere: value }), [], DATE), [MISSING_STAFF_ROOM], `valore ${JSON.stringify(value)}`);
  }
});

test("l'opzione della bozza tace la stanza staff mancante, solo con true", () => {
  const withoutStaff = plan(YOUTH_ONLY_ROOMS);
  assert.deepEqual(validateRoomPlan(withoutStaff, [], DATE, { allowMissingStaffRoom: true }), []);
  for (const options of [{}, { allowMissingStaffRoom: false }, { allowMissingStaffRoom: "true" }, null, undefined]) {
    assert.deepEqual(validateRoomPlan(withoutStaff, [], DATE, options), [MISSING_STAFF_ROOM], `opzioni ${JSON.stringify(options)}`);
  }
});

test("l'opzione della bozza non nasconde gli altri problemi", () => {
  const boy = registration("boy");
  const draft = plan([room("girls", "girls", 1)], { assignments: { boy: "girls" } });
  assert.deepEqual(validateRoomPlan(draft, [boy], DATE, { allowMissingStaffRoom: true }), [
    "Persona boy: I giovani uomini possono essere assegnati solo alle stanze ragazzi.",
  ]);
});

test("piano senza stanze valido con o senza flag", () => {
  assert.deepEqual(validateRoomPlan(plan([]), [], DATE), []);
  assert.deepEqual(validateRoomPlan(plan([], { staffElsewhere: true }), [], DATE), []);
  assert.deepEqual(validateRoomPlan(emptyRoomPlan(), [], DATE), []);
});

test("una stanza coppia non vale come stanza staff, una staff femminile sì", () => {
  assert.deepEqual(validateRoomPlan(plan([room("couple", "couple", 2), ...YOUTH_ONLY_ROOMS]), [], DATE), [MISSING_STAFF_ROOM]);
  assert.deepEqual(validateRoomPlan(plan([room("donne", "staff_female", 2), ...YOUTH_ONLY_ROOMS]), [], DATE), []);
  assert.deepEqual(validateRoomPlan(plan([room("staff", "staff_male", 2)], { staffElsewhere: true }), [], DATE), [], "flag e stanza staff insieme");
});

test("con il flag la separazione di giovani e adulti resta identica", () => {
  const people = [
    registration("boy"),
    registration("girl", "giovane_donna"),
    registration("leader", "dirigente"),
    registration("helper", "accompagnatore"),
  ];
  const rooms = [room("boys", "boys", 3), room("girls", "girls", 3), room("men", "staff_male", 2)];
  const cases = [
    [{ boy: "girls" }, {}, "Persona boy: I giovani uomini possono essere assegnati solo alle stanze ragazzi."],
    [{ girl: "boys" }, {}, "Persona girl: Le giovani donne possono essere assegnate solo alle stanze ragazze."],
    [{ leader: "boys" }, { leader: "male" }, "Persona leader: Lo staff può essere assegnato solo a stanze staff o coppia."],
    [{ helper: "men" }, { helper: "female" }, "Persona helper: La stanza è riservata allo staff maschile."],
    [{ leader: "men" }, {}, "Persona leader: Indica il sesso dello staff prima dell'assegnazione."],
  ];
  for (const [assignments, adultGenders, expected] of cases) {
    for (const staffElsewhere of [false, true]) {
      const errors = validateRoomPlan(plan(rooms, { assignments, adultGenders, staffElsewhere }), people, DATE);
      assert.deepEqual(errors, [expected], `${JSON.stringify(assignments)} con staffElsewhere ${staffElsewhere}`);
    }
  }
});

test("con il flag età, capienza e minorenni in categoria adulta restano controllati", () => {
  const kid = registration("kid", "accompagnatore", { birthDate: "2012-01-01" });
  const boys = [registration("a"), registration("b"), registration("c", "giovane_uomo", { birthDate: "2014-01-01" })];
  const rooms = [room("boys", "boys", 2, { minAge: 14 }), room("men", "staff_male", 2)];
  const errors = validateRoomPlan(plan(rooms, {
    assignments: { a: "boys", b: "boys", c: "boys", kid: "men" },
    adultGenders: { kid: "male" },
    staffElsewhere: true,
  }), [...boys, kid], DATE);
  assert.ok(errors.includes("Persona c: L'età non rispetta il minimo della stanza."), errors.join(" | "));
  assert.ok(errors.includes("Stanza boys supera la capienza di 2."), errors.join(" | "));
  assert.ok(errors.some((error) => error.startsWith("Persona kid: Minorenne con categoria adulta")), errors.join(" | "));
});

test("con il flag le regole della stanza coppia non cambiano", () => {
  const husband = registration("husband", "dirigente");
  const wife = registration("wife", "accompagnatore");
  const people = [husband, wife];
  const rooms = [room("couple", "couple", 2), ...YOUTH_ONLY_ROOMS];
  const base = { assignments: { husband: "couple", wife: "couple" }, adultGenders: { husband: "male", wife: "female" }, staffElsewhere: true };
  assert.deepEqual(validateRoomPlan(plan(rooms, { ...base, couples: [{ firstId: "husband", secondId: "wife", confirmed: true }] }), people, DATE), []);
  const unconfirmed = validateRoomPlan(plan(rooms, { ...base, couples: [{ firstId: "husband", secondId: "wife", confirmed: false }] }), people, DATE);
  assert.ok(unconfirmed.includes("Persona husband: Serve una coppia adulta confermata di sesso diverso."), unconfirmed.join(" | "));
  assert.ok(unconfirmed.includes("Stanza couple può contenere solo una coppia confermata."), unconfirmed.join(" | "));
  const sameGender = validateRoomPlan(plan(rooms, {
    ...base,
    adultGenders: { husband: "male", wife: "male" },
    couples: [{ firstId: "husband", secondId: "wife", confirmed: true }],
  }), people, DATE);
  assert.ok(sameGender.includes("Una coppia confermata richiede un uomo e una donna indicati esplicitamente."), sameGender.join(" | "));
  const wideCouple = validateRoomPlan(plan([room("couple", "couple", 3)], { staffElsewhere: true }), [], DATE);
  assert.deepEqual(wideCouple, ["La stanza coppia Stanza couple deve avere due posti."]);
});

test("con il flag un accompagnatore resta assegnabile alle stanze staff e coppia esistenti", () => {
  const leader = registration("leader", "dirigente");
  const husband = registration("husband", "dirigente");
  const wife = registration("wife", "accompagnatore");
  const people = [leader, husband, wife];
  const rooms = [room("men", "staff_male", 2), room("couple", "couple", 2), ...YOUTH_ONLY_ROOMS];
  const current = plan(rooms, {
    adultGenders: { leader: "male", husband: "male", wife: "female" },
    couples: [{ firstId: "husband", secondId: "wife", confirmed: true }],
    staffElsewhere: true,
  });
  assert.equal(assignmentProblem(leader, rooms[0], current, people, DATE), null);
  assert.equal(assignmentProblem(husband, rooms[1], current, people, DATE), null);
  assert.equal(assignmentProblem(leader, rooms[2], current, people, DATE), "Lo staff può essere assegnato solo a stanze staff o coppia.");
  const assigned = { ...current, assignments: { leader: "men", husband: "couple", wife: "couple" } };
  assert.deepEqual(validateRoomPlan(assigned, people, DATE), []);
});

// Stanze ancora da classificare: senza flag la proposta ne riserva una allo staff.
function unclassifiedScenario(staffElsewhere) {
  const rooms = [room("a", "unassigned", 2), room("b", "unassigned", 3), room("c", "unassigned", 2)];
  const people = [
    registration("boy1"), registration("boy2"), registration("boy3"),
    registration("girl1", "giovane_donna"), registration("girl2", "giovane_donna"),
    registration("leader", "dirigente"), registration("helper", "accompagnatore"),
  ];
  const input = plan(rooms, { adultGenders: { leader: "male", helper: "female" }, staffElsewhere });
  // Piano salvato prima della funzione: il campo non c'è proprio.
  if (staffElsewhere === undefined) delete input.staffElsewhere;
  return { input, people };
}

test("senza flag la proposta riserva ancora una stanza allo staff (comportamento storico)", () => {
  for (const staffElsewhere of [undefined, false]) {
    const { input, people } = unclassifiedScenario(staffElsewhere);
    const proposed = proposeRoomPlan(input, people, DATE);
    assert.equal(proposed.rooms.filter((item) => item.category === "staff_male" || item.category === "staff_female").length, 1);
    assert.equal(proposed.staffElsewhere, false);
  }
});

test("con il flag la proposta non riserva stanze allo staff e non assegna adulti", () => {
  const { input, people } = unclassifiedScenario(true);
  const snapshot = structuredClone(input);
  const proposed = proposeRoomPlan(input, people, DATE);
  assert.deepEqual(input, snapshot, "il piano in ingresso non cambia");
  assert.equal(proposed.staffElsewhere, true);
  for (const item of proposed.rooms) assert.ok(["boys", "girls", "unassigned"].includes(item.category), `${item.id}: ${item.category}`);
  assert.equal(proposed.assignments.leader, undefined);
  assert.equal(proposed.assignments.helper, undefined);
  // Tutte e tre le stanze restano ai giovani: 7 posti per 5 ragazzi.
  assert.deepEqual(Object.keys(proposed.assignments).sort(), ["boy1", "boy2", "boy3", "girl1", "girl2"]);
  assert.deepEqual(validateRoomPlan(proposed, people, DATE), []);
  assert.deepEqual(proposeRoomPlan(input, people, DATE), proposed, "proposta deterministica");
});

test("con il flag la proposta non riclassifica una stanza occupata da adulti", () => {
  // Un adulto in una stanza non classificata (piano importato a metà): senza
  // flag la proposta la trasforma in stanza staff, con il flag no.
  // Lo stato non nasce dall'interfaccia (la validazione lo segnala e blocca
  // «Assegna automaticamente»), ma la proposta non deve inventare stanze staff.
  const rooms = [room("a", "unassigned", 2), room("b", "boys", 2)];
  const people = [registration("leader", "dirigente")];
  const base = plan(rooms, { assignments: { leader: "a" }, adultGenders: { leader: "male" } });
  assert.equal(proposeRoomPlan(base, people, DATE).rooms.find((item) => item.id === "a").category, "staff_male");
  const proposed = proposeRoomPlan({ ...base, staffElsewhere: true }, people, DATE);
  assert.equal(proposed.rooms.find((item) => item.id === "a").category, "unassigned");
  assert.equal(proposed.assignments.leader, "a", "l'assegnazione esistente resta");
});

test("con il flag e il ricalcolo chi ha già una stanza staff o coppia la conserva", () => {
  const rooms = [room("men", "staff_male", 2), room("couple", "couple", 2), room("boys", "boys", 2), room("girls", "unassigned", 2)];
  const people = [
    registration("leader", "dirigente"),
    registration("husband", "dirigente"),
    registration("wife", "accompagnatore"),
    registration("helper", "accompagnatore"),
    registration("boy"),
    registration("girl", "giovane_donna"),
  ];
  const input = plan(rooms, {
    assignments: { leader: "men", husband: "couple", wife: "couple", boy: "boys" },
    adultGenders: { leader: "male", husband: "male", wife: "female", helper: "female" },
    couples: [{ firstId: "husband", secondId: "wife", confirmed: true }],
    staffElsewhere: true,
  });
  const proposed = proposeRoomPlan(input, people, DATE, { recalculate: true });
  assert.deepEqual(proposed.rooms.map(({ id, category }) => [id, category]), [["men", "staff_male"], ["couple", "couple"], ["boys", "boys"], ["girls", "girls"]]);
  assert.equal(proposed.assignments.leader, "men");
  assert.equal(proposed.assignments.husband, "couple");
  assert.equal(proposed.assignments.wife, "couple");
  assert.equal(proposed.assignments.helper, undefined, "l'accompagnatore senza stanza resta alloggiato altrove");
  assert.equal(proposed.assignments.girl, "girls");
  assert.deepEqual(validateRoomPlan(proposed, people, DATE), []);
});

test("con il flag e i piani separati le stanze staff restano staff", () => {
  const rooms = [
    room("men", "staff_male", 2, { floor: "PT" }),
    room("pt", "unassigned", 2, { floor: "PT" }),
    room("p1", "unassigned", 2, { floor: "P1" }),
  ];
  const people = [registration("boy"), registration("girl", "giovane_donna")];
  const proposed = proposeRoomPlan(plan(rooms, { staffElsewhere: true }), people, DATE, { youthFloors: { boys: "PT", girls: "P1" } });
  assert.deepEqual(proposed.rooms.map(({ id, category }) => [id, category]), [["men", "staff_male"], ["pt", "boys"], ["p1", "girls"]]);
  assert.equal(proposed.staffElsewhere, true);
});

test("con il flag e i piani separati nessuna stanza vuota diventa staff", () => {
  const rooms = [
    room("pt1", "unassigned", 2, { floor: "PT" }),
    room("pt2", "unassigned", 2, { floor: "PT" }),
    room("p1", "unassigned", 2, { floor: "P1" }),
  ];
  const people = [registration("boy"), registration("girl", "giovane_donna")];
  const options = { youthFloors: { boys: "PT", girls: "P1" } };
  const historic = proposeRoomPlan(plan(rooms), people, DATE, options);
  assert.equal(historic.rooms.filter((item) => item.category.startsWith("staff_")).length, 1, "senza flag una stanza va allo staff");
  const proposed = proposeRoomPlan(plan(rooms, { staffElsewhere: true }), people, DATE, options);
  assert.deepEqual(proposed.rooms.map(({ id, category }) => [id, category]), [["pt1", "boys"], ["pt2", "boys"], ["p1", "girls"]]);
  assert.deepEqual(validateRoomPlan(proposed, people, DATE), []);
});

test("la proposta riporta il flag come booleano anche da input incompleti", () => {
  const people = [registration("boy")];
  const rooms = [room("boys", "boys", 2), room("men", "staff_male", 2)];
  assert.equal(proposeRoomPlan(plan(rooms, { staffElsewhere: true }), people, DATE).staffElsewhere, true);
  const { staffElsewhere: _omitted, ...legacy } = plan(rooms);
  assert.equal(proposeRoomPlan(legacy, people, DATE).staffElsewhere, false);
  assert.equal(proposeRoomPlan(plan(rooms, { staffElsewhere: "true" }), people, DATE).staffElsewhere, false);
  assert.equal(proposeRoomPlan(null, people, DATE).staffElsewhere, false);
});

function parserPlan(extra = {}) {
  return {
    rooms: [room("boys", "boys", 2)],
    assignments: {},
    lockedIds: [],
    adultGenders: {},
    couples: [],
    revision: 0,
    updatedAt: "",
    ...extra,
  };
}

test("il parser accetta staffElsewhere booleano e lo lascia assente se manca", () => {
  const absent = parsePlan(parserPlan());
  assert.equal(Object.hasOwn(absent, "staffElsewhere"), false);
  assert.equal(parsePlan(parserPlan({ staffElsewhere: true })).staffElsewhere, true);
  const explicitFalse = parsePlan(parserPlan({ staffElsewhere: false }));
  assert.equal(Object.hasOwn(explicitFalse, "staffElsewhere"), true);
  assert.equal(explicitFalse.staffElsewhere, false);
});

test("il parser rifiuta staffElsewhere non booleano", () => {
  for (const value of ["true", "false", 1, 0, null, {}, [], "Mario Rossi"]) {
    assert.throws(() => parsePlan(parserPlan({ staffElsewhere: value })), (error) => {
      assert.equal(error.code, "invalid-argument");
      assert.equal(error.message, "Il flag degli accompagnatori alloggiati altrove deve essere true o false.");
      return true;
    }, `valore ${JSON.stringify(value)}`);
  }
  assert.throws(() => parsePlan(parserPlan({ staffElsewhere: true, staffLodging: "Hotel" })), /campi non ammessi \(staffLodging\)/);
});

// Firestore finto in memoria, come in roomManagement.test.mjs: rifiuta letture
// dopo scritture e update su documenti assenti.
function fakeFirestore(seed) {
  const store = new Map(Object.entries(seed).map(([path, data]) => [path, structuredClone(data)]));
  const keep = (data) => JSON.parse(JSON.stringify(data, (key, value) =>
    value && typeof value === "object" && value.constructor?.name?.includes("ServerTimestamp") ? "<serverTimestamp>" : value));
  const snapshot = (path) => ({
    id: path.split("/").at(-1),
    ref: docRef(path),
    exists: store.has(path),
    data: () => (store.has(path) ? structuredClone(store.get(path)) : undefined),
  });
  const docRef = (path) => ({ path, id: path.split("/").at(-1), collection: (name) => collectionRef(`${path}/${name}`) });
  const collectionRef = (path) => ({ doc: (id) => docRef(`${path}/${id}`), limit: () => ({ collectionPath: path }) });
  return {
    store,
    doc: docRef,
    async runTransaction(work) {
      const writes = [];
      const guard = () => { if (writes.length) throw new Error("Letture dopo scritture nella transazione."); };
      const transaction = {
        async get(target) {
          guard();
          if (!target.collectionPath) return snapshot(target.path);
          const docs = [...store.keys()]
            .filter((path) => path.startsWith(`${target.collectionPath}/`) && !path.slice(target.collectionPath.length + 1).includes("/"))
            .map(snapshot);
          return { docs, size: docs.length };
        },
        async getAll(...refs) { guard(); return refs.map((ref) => snapshot(ref.path)); },
        set(ref, data) { writes.push(() => store.set(ref.path, keep(data))); },
        update(ref, patch) {
          writes.push(() => {
            if (!store.has(ref.path)) throw new Error(`Documento assente: ${ref.path}`);
            store.set(ref.path, { ...store.get(ref.path), ...keep(patch) });
          });
        },
      };
      const result = await work(transaction);
      for (const write of writes) write();
      return result;
    },
  };
}

const AREA = "stakes/palo/activities/notte";
const PLAN_PATH = `${AREA}/management/rooms`;
const CLOCK = () => new Date("2026-07-15T12:00:00.000Z");
const BOYS = { id: "boys", name: "Ragazzi", capacity: 2, floor: "primo", category: "boys", accessible: false, notes: "", minAge: null, maxAge: null };
const STAFF = { id: "staff", name: "Staff", capacity: 2, floor: "terra", category: "staff_male", accessible: false, notes: "", minAge: null, maxAge: null };

function handlerDb(savedPlan) {
  return fakeFirestore({
    "users/admin": { role: "admin", stakeId: "palo" },
    [AREA]: { title: "Notte", overnight: true, startDate: "2026-07-15" },
    [`${AREA}/registrations/boy`]: registration("boy", "giovane_uomo", { id: undefined }),
    [`${AREA}/registrations/friend`]: registration("friend", "giovane_uomo", { id: undefined }),
    [`${AREA}/registrations/leader`]: registration("leader", "dirigente", { id: undefined }),
    ...(savedPlan ? { [PLAN_PATH]: savedPlan } : {}),
  });
}

// Il client precedente rimanda il piano senza il campo nuovo.
function payload(revision, extra = {}) {
  return {
    rooms: [BOYS],
    assignments: { boy: "boys" },
    lockedIds: [],
    adultGenders: {},
    couples: [],
    published: false,
    revision,
    updatedAt: "",
    ...extra,
  };
}

function request(planData) {
  return {
    auth: { uid: "admin", token: { firebase: { sign_in_provider: "password" } } },
    data: { stakeId: "palo", activityId: "notte", expectedRevision: planData.revision, plan: planData },
  };
}

async function rejectsMissingStaff(promise) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, "invalid-argument");
    assert.ok(error.details?.errors?.includes(MISSING_STAFF_ROOM), JSON.stringify(error.details));
    return true;
  });
}

test("callable: un piano mai salvato senza il campo vale false e senza stanza staff è rifiutato", async () => {
  const db = handlerDb();
  const handler = createRoomManagementSaveHandler({ db, clock: CLOCK });
  await rejectsMissingStaff(handler(request(payload(0))));
  assert.equal(db.store.has(PLAN_PATH), false);
  const withStaff = await handler(request(payload(0, { rooms: [STAFF, BOYS] })));
  assert.equal(withStaff.plan.staffElsewhere, false, "il server restituisce sempre il booleano");
  assert.equal(db.store.get(PLAN_PATH).staffElsewhere, false);
});

test("callable: con true salva senza stanza staff e il client precedente conserva il valore", async () => {
  const db = handlerDb();
  const handler = createRoomManagementSaveHandler({ db, clock: CLOCK });
  const first = await handler(request(payload(0, { staffElsewhere: true })));
  assert.equal(first.plan.staffElsewhere, true);
  assert.equal(first.plan.revision, 1);
  assert.equal(db.store.get(PLAN_PATH).staffElsewhere, true);

  const legacy = await handler(request(payload(1, { assignments: { boy: "boys", friend: "boys" } })));
  assert.equal(legacy.plan.staffElsewhere, true);
  assert.equal(legacy.plan.revision, 2);
  assert.deepEqual(legacy.plan.assignments, { boy: "boys", friend: "boys" });
  assert.equal(db.store.get(PLAN_PATH).staffElsewhere, true);
});

test("callable: false esplicito sovrascrive il true salvato e torna a chiedere la stanza staff", async () => {
  const saved = { ...payload(3), staffElsewhere: true, updatedAt: "2026-07-14T10:00:00.000Z" };
  const db = handlerDb(saved);
  const handler = createRoomManagementSaveHandler({ db, clock: CLOCK });
  await rejectsMissingStaff(handler(request(payload(3, { staffElsewhere: false }))));
  assert.deepEqual(db.store.get(PLAN_PATH), saved, "il rifiuto non scrive nulla");
  const switched = await handler(request(payload(3, { rooms: [STAFF, BOYS], staffElsewhere: false })));
  assert.equal(switched.plan.staffElsewhere, false);
  assert.equal(switched.plan.revision, 4);
  assert.equal(db.store.get(PLAN_PATH).staffElsewhere, false);
  // Ora il valore salvato è false: un client precedente senza stanza staff viene rifiutato.
  await rejectsMissingStaff(handler(request(payload(4))));
});

test("callable: un valore salvato non booleano non esonera dalla stanza staff", async () => {
  const db = handlerDb({ ...payload(2), staffElsewhere: "true" });
  const handler = createRoomManagementSaveHandler({ db, clock: CLOCK });
  await rejectsMissingStaff(handler(request(payload(2))));
});

test("pulizia di un'iscrizione annullata: il flag resta e il piano riletto si salva", async () => {
  const db = handlerDb({
    ...payload(1),
    assignments: { boy: "boys", friend: "boys" },
    lockedIds: ["boy"],
    published: true,
    staffElsewhere: true,
    updatedAt: "2026-07-14T10:00:00.000Z",
  });
  db.store.set(`${AREA}/registrations/boy`, { ...db.store.get(`${AREA}/registrations/boy`), registrationStatus: "cancelled" });
  assert.equal(await cleanupRegistrationFromPlan(db, { stakeId: "palo", activityId: "notte", registrationId: "boy" }, CLOCK), true);
  const cleaned = db.store.get(PLAN_PATH);
  assert.equal(cleaned.staffElsewhere, true);
  assert.equal(cleaned.revision, 2);
  assert.deepEqual(cleaned.assignments, { friend: "boys" });
  const { savedAt, staffElsewhere, ...readByLegacyClient } = cleaned;
  const handler = createRoomManagementSaveHandler({ db, clock: CLOCK });
  const resaved = await handler(request(readByLegacyClient));
  assert.equal(resaved.plan.staffElsewhere, true);
  assert.equal(resaved.plan.revision, 3);
});
