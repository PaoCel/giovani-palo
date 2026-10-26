import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  cleanupRegistrationFromPlan,
  cleanupRegistrationReferences,
  createRoomManagementSaveHandler,
  parsePlan,
  registrationRoomPatch,
} = require("../lib/roomManagement.js");

function validPlan() {
  return {
    rooms: [{
      id: "staff",
      name: "Staff",
      capacity: 2,
      floor: "terra",
      category: "staff_male",
      accessible: true,
      notes: "",
      minAge: null,
      maxAge: null,
    }],
    assignments: {},
    lockedIds: [],
    adultGenders: {},
    couples: [],
    revision: 0,
    updatedAt: "",
  };
}

test("il parser accetta solo il flag di pubblicazione booleano, assente nei piani vecchi", () => {
  assert.equal(parsePlan(validPlan()).published, false);
  assert.equal(parsePlan({ ...validPlan(), published: true }).published, true);
  assert.throws(() => parsePlan({ ...validPlan(), published: "yes" }), /pubblicazione/);
});

test("la pubblicazione comunica la stanza e la bozza la ritira senza toccare i legacy", () => {
  const plan = { ...validPlan(), assignments: { boy: "staff" }, published: true };
  assert.deepEqual(registrationRoomPatch({ id: "boy" }, plan), { assignedRoomId: "staff", assignedRoomName: "Staff" });
  assert.equal(registrationRoomPatch({ id: "boy", assignedRoomId: "staff", assignedRoomName: "Staff" }, plan), null);
  assert.deepEqual(registrationRoomPatch({ id: "boy", assignedRoomId: "staff", assignedRoomName: "Vecchia" }, plan), { assignedRoomId: "staff", assignedRoomName: "Staff" });
  assert.deepEqual(registrationRoomPatch({ id: "other", assignedRoomName: "Staff" }, plan), { assignedRoomId: null, assignedRoomName: null });
  assert.deepEqual(registrationRoomPatch({ id: "boy", assignedRoomId: "staff", assignedRoomName: "Staff" }, { ...plan, published: false }), { assignedRoomId: null, assignedRoomName: null });
  assert.equal(registrationRoomPatch({ id: "boy" }, { ...plan, published: false }), null);
  assert.equal(registrationRoomPatch({ id: "boy", assignedRoomId: "legacy" }, { ...plan, published: false }), null);
  assert.deepEqual(registrationRoomPatch({ id: "boy" }, { ...plan, assignments: { boy: "missing-room" } }), null);
});

test("il parser rifiuta campi iniettati e non corregge valori invalidi", () => {
  assert.throws(() => parsePlan({ ...validPlan(), notes: "x" }), /campi non ammessi/);
  assert.throws(() => parsePlan({ ...validPlan(), rooms: [{ ...validPlan().rooms[0], capacity: 0 }] }), /Capienza/);
  assert.throws(() => parsePlan({ ...validPlan(), assignments: { person: "path/room" } }), /ID stanza assegnata/);
  const specialMap = JSON.parse('{"__proto__":"staff"}');
  assert.throws(() => parsePlan({ ...validPlan(), assignments: specialMap }), /Assegnazioni: ID/);
  assert.throws(() => parsePlan({ ...validPlan(), assignments: { constructor: "staff" } }), /Assegnazioni: ID/);
  assert.throws(() => parsePlan({ ...validPlan(), rooms: [{ ...validPlan().rooms[0], capacity: 51 }] }), /Capienza/);
});

test("la pulizia elimina ogni riferimento e incrementa la revisione", async () => {
  const result = await cleanupRegistrationReferences({
    ...validPlan(),
    assignments: { deleted: "staff", kept: "staff" },
    lockedIds: ["deleted", "kept"],
    adultGenders: { deleted: "male", kept: "male" },
    couples: [{ firstId: "deleted", secondId: "kept", confirmed: true }],
    revision: 4,
  }, "deleted", "2026-07-15T12:00:00.000Z");
  assert.deepEqual(result, {
    assignments: { kept: "staff" },
    adultGenders: { kept: "male" },
    lockedIds: ["kept"],
    couples: [],
    revision: 5,
    updatedAt: "2026-07-15T12:00:00.000Z",
  });
  assert.equal(await cleanupRegistrationReferences(validPlan(), "absent", "now"), null);
});

test("la cancellazione di un coniuge libera il posto matrimoniale dell'altro", async () => {
  const plan = validPlan();
  plan.rooms.push({ ...plan.rooms[0], id: "couple", category: "couple" });
  plan.assignments = { deleted: "couple", kept: "couple" };
  plan.lockedIds = ["deleted", "kept"];
  plan.couples = [{ firstId: "deleted", secondId: "kept", confirmed: true }];
  const cleaned = await cleanupRegistrationReferences(plan, "deleted", "now");
  assert.deepEqual(cleaned.assignments, {});
  assert.deepEqual(cleaned.lockedIds, []);
});

// Firestore finto in memoria, quanto basta per le transazioni di
// roomManagement.js. Come quello vero, rifiuta una lettura dopo una scrittura
// e un update su un documento che non esiste. I valori del server (savedAt)
// restano segnaposto.
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
  const docRef = (path) => ({
    path,
    id: path.split("/").at(-1),
    collection: (name) => collectionRef(`${path}/${name}`),
  });
  const collectionRef = (path) => ({
    doc: (id) => docRef(`${path}/${id}`),
    limit: () => ({ collectionPath: path }),
  });
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
const SCENARIO_ROOMS = [
  { id: "staff", name: "Staff", capacity: 2, floor: "terra", category: "staff_male", accessible: false, notes: "", minAge: null, maxAge: null },
  { id: "boys", name: "Ragazzi", capacity: 3, floor: "primo", category: "boys", accessible: false, notes: "", minAge: 12, maxAge: 18 },
  { id: "couple", name: "Matrimoniale", capacity: 2, floor: "primo", category: "couple", accessible: false, notes: "", minAge: null, maxAge: null },
];

function scenarioRegistration(fullName, birthDate, genderRoleCategory, room) {
  return {
    fullName,
    birthDate,
    genderRoleCategory,
    registrationStatus: "confirmed",
    userId: `utente-${fullName}`,
    answers: {},
    roomPreferenceMatches: {},
    ...(room ? { assignedRoomId: room.id, assignedRoomName: room.name } : {}),
  };
}

// Piano pubblicato: ragazzo e amico nei ragazzi, coppia confermata nella
// matrimoniale. Un'altra attività del palo ha un piano con un id uguale.
function scenarioDb() {
  const [, boys, couple] = SCENARIO_ROOMS;
  return fakeFirestore({
    "users/admin": { role: "admin", stakeId: "palo" },
    [AREA]: { title: "Notte", overnight: true, startDate: "2026-07-15" },
    [`${AREA}/registrations/boy`]: scenarioRegistration("Marco Bianchi", "2010-01-01", "giovane_uomo", boys),
    [`${AREA}/registrations/friend`]: scenarioRegistration("Luca Verdi", "2011-03-03", "giovane_uomo", boys),
    [`${AREA}/registrations/husband`]: scenarioRegistration("Paolo Neri", "1985-01-01", "dirigente", couple),
    [`${AREA}/registrations/wife`]: scenarioRegistration("Anna Neri", "1986-02-02", "accompagnatore", couple),
    [`${AREA}/management/rooms`]: {
      rooms: SCENARIO_ROOMS,
      assignments: { boy: "boys", friend: "boys", husband: "couple", wife: "couple" },
      lockedIds: ["boy", "husband", "wife"],
      adultGenders: { husband: "male", wife: "female" },
      couples: [{ firstId: "husband", secondId: "wife", confirmed: true }],
      published: true,
      revision: 1,
      updatedAt: "2026-07-15T09:00:00.000Z",
    },
    "stakes/palo/activities/altra": { title: "Altra", overnight: true, startDate: "2026-07-15" },
    "stakes/palo/activities/altra/registrations/boy": scenarioRegistration("Marco Bianchi", "2010-01-01", "giovane_uomo", boys),
    "stakes/palo/activities/altra/management/rooms": {
      rooms: SCENARIO_ROOMS.slice(0, 2),
      assignments: { boy: "boys" },
      lockedIds: ["boy"],
      adultGenders: {},
      couples: [],
      published: true,
      revision: 7,
      updatedAt: "2026-07-01T10:00:00.000Z",
    },
  });
}

const CLOCK = () => new Date("2026-07-15T12:00:00.000Z");
const cleanup = (db, registrationId, activityId = "notte") =>
  cleanupRegistrationFromPlan(db, { stakeId: "palo", activityId, registrationId }, CLOCK);

test("l'annullamento di un'iscrizione assegnata ripulisce il piano e azzera la sua stanza", async () => {
  const db = scenarioDb();
  db.store.set(`${AREA}/registrations/boy`, { ...db.store.get(`${AREA}/registrations/boy`), registrationStatus: "cancelled" });
  assert.equal(await cleanup(db, "boy"), true);
  const plan = db.store.get(`${AREA}/management/rooms`);
  assert.deepEqual(plan.assignments, { friend: "boys", husband: "couple", wife: "couple" });
  assert.deepEqual(plan.lockedIds, ["husband", "wife"]);
  assert.equal(plan.revision, 2);
  assert.equal(plan.updatedAt, "2026-07-15T12:00:00.000Z");
  assert.equal(plan.published, true);
  assert.equal(plan.savedAt, "<serverTimestamp>");
  const boy = db.store.get(`${AREA}/registrations/boy`);
  assert.equal(boy.registrationStatus, "cancelled");
  assert.equal(boy.assignedRoomId, null);
  assert.equal(boy.assignedRoomName, null);
  for (const id of ["friend", "husband", "wife"]) assert.ok(db.store.get(`${AREA}/registrations/${id}`).assignedRoomName, id);
  // Una seconda esecuzione non trova più nulla da fare: niente rincorrersi.
  assert.equal(await cleanup(db, "boy"), false);
  assert.equal(db.store.get(`${AREA}/management/rooms`).revision, 2);
});

test("l'annullamento di un coniuge libera l'altro dalla matrimoniale e azzera entrambe le stanze", async () => {
  const db = scenarioDb();
  db.store.set(`${AREA}/registrations/wife`, { ...db.store.get(`${AREA}/registrations/wife`), registrationStatus: "cancelled" });
  assert.equal(await cleanup(db, "wife"), true);
  const plan = db.store.get(`${AREA}/management/rooms`);
  assert.deepEqual(plan.assignments, { boy: "boys", friend: "boys" });
  assert.deepEqual(plan.lockedIds, ["boy"]);
  assert.deepEqual(plan.couples, []);
  assert.deepEqual(plan.adultGenders, { husband: "male" });
  for (const id of ["husband", "wife"]) {
    const registration = db.store.get(`${AREA}/registrations/${id}`);
    assert.equal(registration.assignedRoomId, null, id);
    assert.equal(registration.assignedRoomName, null, id);
  }
  assert.equal(db.store.get(`${AREA}/registrations/husband`).registrationStatus, "confirmed");
  assert.equal(db.store.get(`${AREA}/registrations/boy`).assignedRoomName, "Ragazzi");
});

test("la pulizia non fa nulla se l'iscrizione è idonea, il piano manca o la persona non è citata", async () => {
  const db = scenarioDb();
  const before = structuredClone([...db.store.entries()]);
  assert.equal(await cleanup(db, "boy"), false, "iscrizione ancora idonea");
  db.store.delete(`${AREA}/management/rooms`);
  db.store.set(`${AREA}/registrations/boy`, { ...db.store.get(`${AREA}/registrations/boy`), registrationStatus: "cancelled" });
  assert.equal(await cleanup(db, "boy"), false, "piano assente");
  db.store.set(`${AREA}/management/rooms`, before.find(([path]) => path === `${AREA}/management/rooms`)[1]);
  assert.equal(await cleanup(db, "sconosciuta"), false, "iscrizione assente dal piano");
  assert.equal(db.store.get(`${AREA}/management/rooms`).revision, 1);
});

test("la pulizia di un'attività non tocca il piano di un'altra con lo stesso id di iscrizione", async () => {
  const db = scenarioDb();
  db.store.set(`${AREA}/registrations/boy`, { ...db.store.get(`${AREA}/registrations/boy`), registrationStatus: "cancelled" });
  const otherBefore = structuredClone([
    db.store.get("stakes/palo/activities/altra/management/rooms"),
    db.store.get("stakes/palo/activities/altra/registrations/boy"),
  ]);
  assert.equal(await cleanup(db, "boy"), true);
  assert.deepEqual([
    db.store.get("stakes/palo/activities/altra/management/rooms"),
    db.store.get("stakes/palo/activities/altra/registrations/boy"),
  ], otherBefore);
});

test("un'iscrizione cancellata dal database esce dal piano come una annullata", async () => {
  const db = scenarioDb();
  db.store.delete(`${AREA}/registrations/husband`);
  assert.equal(await cleanup(db, "husband"), true);
  const plan = db.store.get(`${AREA}/management/rooms`);
  assert.deepEqual(plan.assignments, { boy: "boys", friend: "boys" });
  assert.deepEqual(plan.couples, []);
  // La moglie, liberata dalla matrimoniale, perde la stanza sulla sua iscrizione.
  assert.equal(db.store.get(`${AREA}/registrations/wife`).assignedRoomName, null);
});

test("dopo la pulizia il salvataggio della callable accetta il piano riletto, prima lo rifiutava", async () => {
  const db = scenarioDb();
  const handler = createRoomManagementSaveHandler({ db, clock: CLOCK });
  const request = (plan) => ({
    auth: { uid: "admin", token: { firebase: { sign_in_provider: "password" } } },
    data: { stakeId: "palo", activityId: "notte", expectedRevision: plan.revision, plan },
  });
  const readable = () => {
    const { savedAt, ...rest } = db.store.get(`${AREA}/management/rooms`);
    return rest;
  };
  const stale = readable();
  db.store.set(`${AREA}/registrations/boy`, { ...db.store.get(`${AREA}/registrations/boy`), registrationStatus: "cancelled" });
  await assert.rejects(handler(request(stale)), (error) => {
    assert.equal(error.code, "invalid-argument");
    assert.match(error.message, /Marco Bianchi: L'iscrizione non è idonea al piano stanze\./);
    return true;
  });
  assert.equal(await cleanup(db, "boy"), true);
  const saved = await handler(request(readable()));
  assert.equal(saved.plan.revision, 3);
  assert.deepEqual(saved.plan.assignments, { friend: "boys", husband: "couple", wife: "couple" });
  // Il salvataggio non rimette una stanza all'iscrizione annullata.
  assert.equal(db.store.get(`${AREA}/registrations/boy`).assignedRoomName, null);
});
