import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Notte dei Record: logica pura (limite, unicità, transizioni, delta del
// contatore, finestra di iscrizione) e flussi delle callable su un Firestore
// finto in memoria. Niente emulatori: i test con le rules e l'Auth veri sono a parte.

const require = createRequire(import.meta.url);
const night = require("../lib/recordNight.js");

const {
  ENTRY_TRANSITIONS,
  assertEntryLimit,
  assertNoDuplicateProposal,
  assertNotAlreadyInRecord,
  assertTransition,
  buildChallengeEntry,
  buildPeople,
  canActForRegistration,
  planHideRecord,
  planShowRecord,
  resolveStaffAccess,
  canManageStaff,
  nextStaffUids,
  staffUidsOf,
  buildProposalEntry,
  canTransition,
  cleanupDeletedActivity,
  counterDelta,
  createRecordNightAdminHandler,
  createRecordNightParticipantHandler,
  getParticipantWindow,
  isRegistrationActive,
  nextChallengerCount,
  ownerUidFromRegistrationId,
  parseAdminRequest,
  parseParticipantRequest,
  participantNameFromRegistration,
  planRetireEntries,
  resolveCloseAt,
  retireEntriesForRegistration,
} = night;

function throwsHttps(fn, code, pattern) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code, `codice atteso ${code}, ricevuto ${error.code} (${error.message})`);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

async function rejectsHttps(promise, code, pattern) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `codice atteso ${code}, ricevuto ${error.code} (${error.message})`);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

const entry = (id, status, extra = {}) => ({ id, status, kind: "proposal", recordId: null, ...extra });

// ---------------------------------------------------------------------------
// Logica pura
// ---------------------------------------------------------------------------

test("limite: al massimo 2 tentativi pending/approved, ritirati e rifiutati non contano", () => {
  assertEntryLimit([], "self");
  assertEntryLimit([entry("a", "pending")], "self");
  assertEntryLimit([entry("a", "approved"), entry("b", "withdrawn"), entry("c", "rejected")], "self");
  throwsHttps(
    () => assertEntryLimit([entry("a", "pending"), entry("b", "approved")], "self"),
    "failed-precondition",
    /^Limite di 2 record raggiunto: ritirane uno per sceglierne un altro\.$/,
  );
  throwsHttps(
    () => assertEntryLimit([entry("a", "pending"), entry("b", "approved")], "admin"),
    "failed-precondition",
    /Limite di 2 record raggiunto per questa persona/,
  );
  // Il tentativo che si sta ripristinando o riaprendo non conta contro se stesso.
  assertEntryLimit([entry("a", "pending"), entry("b", "approved")], "self", "b");
});

test("unicità: una persona non ha due tentativi attivi sullo stesso record", () => {
  const entries = [
    entry("a", "approved", { kind: "challenge", recordId: "r1" }),
    entry("b", "pending"),
    entry("c", "withdrawn", { kind: "challenge", recordId: "r2" }),
  ];
  throwsHttps(() => assertNotAlreadyInRecord(entries, "r1", "self"), "failed-precondition", /^Già in gara per questo record\.$/);
  throwsHttps(() => assertNotAlreadyInRecord(entries, "r1", "admin"), "failed-precondition", /Questa persona è già iscritta/);
  assertNotAlreadyInRecord(entries, "r2", "self"); // ritirato: si può rientrare
  assertNotAlreadyInRecord(entries, "r3", "self");
  assertNotAlreadyInRecord(entries, "r1", "self", "a"); // escluso se stesso (restore)
});

test("proposta doppia identica rifiutata, diversa ammessa", () => {
  const entries = [
    entry("a", "pending", { proposedText: "Salti a piedi uniti", proposedMeasure: "count_in_time", proposedDurationSeconds: 60 }),
  ];
  throwsHttps(
    () => assertNoDuplicateProposal(entries, { text: "  salti  a PIEDI uniti ", measure: "count_in_time", durationSeconds: 60 }),
    "failed-precondition",
    /Questa proposta è già presente/,
  );
  assertNoDuplicateProposal(entries, { text: "Salti a piedi uniti", measure: "count_in_time", durationSeconds: 30 });
  assertNoDuplicateProposal(entries, { text: "Salti a piedi uniti", measure: "count_streak", durationSeconds: null });
});

test("transizioni di stato: solo quelle della tabella", () => {
  const states = ["pending", "approved", "rejected", "withdrawn"];
  const allowed = new Set([
    "pending>approved", "pending>rejected", "pending>withdrawn",
    "approved>pending", "approved>withdrawn",
    "rejected>pending",
    "withdrawn>pending", "withdrawn>approved",
  ]);
  for (const from of states) {
    for (const to of states) {
      assert.equal(canTransition(from, to), allowed.has(`${from}>${to}`), `${from} -> ${to}`);
    }
  }
  assert.equal(canTransition("bogus", "pending"), false);
  assert.equal(canTransition("__proto__", "pending"), false);
  assert.deepEqual(Object.keys(ENTRY_TRANSITIONS).sort(), [...states].sort());
  assertTransition("pending", "approved");
  throwsHttps(() => assertTransition("rejected", "withdrawn"), "failed-precondition", /rifiutata/);
});

test("delta del contatore: +1 entrando in approved, -1 uscendo, mai sotto zero", () => {
  assert.equal(counterDelta(null, "approved"), 1); // sfida o iscrizione fatta da un admin
  assert.equal(counterDelta("pending", "approved"), 1); // approva / unisci
  assert.equal(counterDelta("withdrawn", "approved"), 1); // annulla il ritiro
  assert.equal(counterDelta("approved", "withdrawn"), -1); // ritiro
  assert.equal(counterDelta("approved", "pending"), -1); // riporta in attesa
  assert.equal(counterDelta("pending", "withdrawn"), 0);
  assert.equal(counterDelta("pending", "rejected"), 0);
  assert.equal(counterDelta("rejected", "pending"), 0);
  assert.equal(counterDelta("withdrawn", "pending"), 0);
  assert.equal(nextChallengerCount(2, 1), 3);
  assert.equal(nextChallengerCount(1, -1), 0);
  assert.equal(nextChallengerCount(0, -1), 0);
  assert.equal(nextChallengerCount(undefined, 1), 1);
  assert.equal(nextChallengerCount(-4, 1), 1);
});

test("ritiro d'ufficio: pending e approved vanno a withdrawn senza Annulla, contatori scalati, idempotente", () => {
  const entries = [
    entry("a", "approved", { kind: "challenge", recordId: "r1" }),
    entry("b", "pending"),
    entry("c", "rejected"),
    entry("d", "withdrawn", { statusBeforeWithdraw: "approved", recordId: "r2" }),
  ];
  const plan = planRetireEntries(entries, "2026-10-12T10:00:00.000Z");
  assert.deepEqual(plan.patches.map((item) => item.id), ["a", "b"]);
  for (const { patch } of plan.patches) {
    assert.deepEqual(patch, {
      status: "withdrawn",
      statusBeforeWithdraw: null,
      withdrawnBy: "system",
      withdrawnWithRecordHide: false,
      updatedAt: "2026-10-12T10:00:00.000Z",
    });
  }
  assert.deepEqual([...plan.recordDeltas], [["r1", -1]]);
  const after = entries.map((item) => {
    const found = plan.patches.find((p) => p.id === item.id);
    return found ? { ...item, ...found.patch } : item;
  });
  assert.equal(planRetireEntries(after, "x").patches.length, 0);
});

test("finestra di iscrizione: recordsCloseAt, altrimenti startDate; valore illeggibile = chiuso", () => {
  const base = { recordsEnabled: true, startDate: "2026-10-16T14:00:00.000Z" };
  const close = "2026-10-15T19:00:00.000Z";
  const before = new Date("2026-10-15T18:59:59.999Z");
  const exactly = new Date(close);
  assert.equal(getParticipantWindow({ ...base, recordsCloseAt: close }, before), "open");
  assert.equal(getParticipantWindow({ ...base, recordsCloseAt: close }, exactly), "closed");
  assert.equal(getParticipantWindow({ ...base, recordsCloseAt: null }, exactly), "open");
  assert.equal(getParticipantWindow(base, new Date("2026-10-16T14:00:00.000Z")), "closed");
  assert.equal(getParticipantWindow({ ...base, recordsCloseAt: "boh" }, before), "closed");
  assert.equal(getParticipantWindow({ ...base, startDate: "boh" }, before), "closed");
  assert.equal(getParticipantWindow({ ...base, recordsEnabled: false }, before), "disabled");
  assert.equal(getParticipantWindow({ startDate: base.startDate }, before), "disabled");
  assert.equal(resolveCloseAt({ recordsCloseAt: close, startDate: "boh" }).toISOString(), close);
  assert.equal(resolveCloseAt({ recordsCloseAt: { toDate: () => new Date(close) } }).toISOString(), close);
});

test("iscrizione: annullata o rifiutata dal genitore non è attiva; nome dai campi reali", () => {
  assert.equal(isRegistrationActive({ registrationStatus: "active" }), true);
  assert.equal(isRegistrationActive({ registrationStatus: "pending_parent_authorization" }), true);
  assert.equal(isRegistrationActive({}), true);
  assert.equal(isRegistrationActive({ registrationStatus: "cancelled" }), false);
  assert.equal(isRegistrationActive({ registrationStatus: "rejected_by_parent" }), false);
  assert.equal(isRegistrationActive({ status: "cancelled" }), false);
  assert.equal(isRegistrationActive(undefined), false);
  assert.equal(participantNameFromRegistration({ firstName: " Mario ", lastName: "Rossi", fullName: "x" }), "Mario Rossi");
  assert.equal(participantNameFromRegistration({ fullName: "Anna Verdi" }), "Anna Verdi");
  assert.equal(participantNameFromRegistration({}), "Partecipante");
  assert.equal(ownerUidFromRegistrationId("user_abc"), "abc");
  // Il figlio è gestito dal genitore: uid dal campo parentUid, altrimenti dall'id.
  assert.equal(ownerUidFromRegistrationId("child_p_c"), "p");
  assert.equal(ownerUidFromRegistrationId("child_p_c", { parentUid: "parent9" }), "parent9");
  assert.equal(ownerUidFromRegistrationId("child_p_c", { parentUid: "" }), "p");
  throwsHttps(() => ownerUidFromRegistrationId("guest_abc"), "invalid-argument");
});

test("la sfida e l'iscrizione admin nascono approved, la proposta pending", () => {
  const proposal = buildProposalEntry({
    registrationId: "user_u1",
    ownerUid: "u1",
    participantName: "Mario Rossi",
    fields: { text: "Salti", measure: "count_in_time", durationSeconds: 60, needs: "" },
    nowIso: "t",
  });
  assert.equal(proposal.status, "pending");
  assert.equal(proposal.recordId, null);
  assert.equal(proposal.kind, "proposal");
  assert.equal(proposal.statusBeforeWithdraw, null);
  const challenge = buildChallengeEntry({
    registrationId: "child_p_c",
    ownerUid: null,
    participantName: "Luca",
    recordId: "r1",
    createdByAdmin: true,
    decidedBy: "admin1",
    nowIso: "t",
  });
  assert.equal(challenge.status, "approved");
  assert.equal(challenge.recordId, "r1");
  assert.equal(challenge.ownerUid, null);
  assert.equal(challenge.createdByAdmin, true);
  assert.equal(challenge.proposedText, null);
});

test("validazione input: chiavi esatte, enum, durata solo per le prove a tempo", () => {
  const env = { stakeId: "s1", activityId: "a1" };
  const ok = parseParticipantRequest({
    ...env, action: "propose", text: "  Salti   a piedi\nuniti ", measure: "count_in_time", durationSeconds: 60, needs: "",
  });
  assert.deepEqual(ok.fields, { text: "Salti a piedi uniti", measure: "count_in_time", durationSeconds: 60, needs: "", registrationId: null });
  assert.equal(parseParticipantRequest({ ...env, action: "propose", text: "Equilibrio", measure: "other" }).fields.durationSeconds, null);

  throwsHttps(() => parseParticipantRequest({ ...env, action: "propose", text: "x", measure: "other", extra: 1 }), "invalid-argument", /campi non ammessi/);
  throwsHttps(() => parseParticipantRequest({ ...env, action: "nope" }), "invalid-argument", /Azione/);
  throwsHttps(() => parseParticipantRequest({ ...env, action: "__proto__" }), "invalid-argument", /Azione/);
  throwsHttps(() => parseParticipantRequest({ ...env, action: "approve", entryId: "e1" }), "invalid-argument", /Azione/);
  throwsHttps(() => parseParticipantRequest({ ...env, action: "propose", text: "", measure: "other" }), "invalid-argument", /obbligatorio/);
  throwsHttps(() => parseParticipantRequest({ ...env, action: "propose", text: "x".repeat(121), measure: "other" }), "invalid-argument", /troppo lungo/);
  throwsHttps(() => parseParticipantRequest({ ...env, action: "propose", text: "a\u0000b", measure: "other" }), "invalid-argument", /non valido/);
  throwsHttps(() => parseParticipantRequest({ ...env, action: "propose", text: "x", measure: "boh" }), "invalid-argument", /Come si misura/);
  throwsHttps(() => parseParticipantRequest({ ...env, action: "propose", text: "x", measure: "count_in_time" }), "invalid-argument", /durata/);
  throwsHttps(() => parseParticipantRequest({ ...env, action: "propose", text: "x", measure: "count_in_time", durationSeconds: 9 }), "invalid-argument", /durata/);
  throwsHttps(() => parseParticipantRequest({ ...env, action: "propose", text: "x", measure: "count_in_time", durationSeconds: 61 }), "invalid-argument", /durata/);
  throwsHttps(() => parseParticipantRequest({ ...env, action: "propose", text: "x", measure: "count_in_time", durationSeconds: 30.5 }), "invalid-argument", /durata/);
  throwsHttps(() => parseParticipantRequest({ ...env, action: "propose", text: "x", measure: "other", durationSeconds: 30 }), "invalid-argument", /durata/);
  throwsHttps(() => parseParticipantRequest({ stakeId: "a/b", activityId: "a1", action: "withdraw", entryId: "e1" }), "invalid-argument", /stakeId/);
  throwsHttps(() => parseParticipantRequest({ ...env, action: "withdraw", entryId: "../x" }), "invalid-argument", /entryId/);
  throwsHttps(() => parseParticipantRequest({ ...env, action: "withdraw" }), "invalid-argument", /entryId/);
  throwsHttps(() => parseParticipantRequest(null), "invalid-argument");

  const approve = parseAdminRequest({
    ...env, action: "approve", entryId: "e1", title: "Salti in 60 secondi", category: "resistenza", measure: "count_in_time", durationSeconds: 60,
  });
  assert.equal(approve.fields.notes, "");
  throwsHttps(() => parseAdminRequest({ ...env, action: "approve", entryId: "e1", title: "x", category: "boh", measure: "other" }), "invalid-argument", /Categoria/);
  throwsHttps(() => parseAdminRequest({ ...env, action: "approve", entryId: "e1", title: "x".repeat(81), category: "mente", measure: "other" }), "invalid-argument", /troppo lungo/);
  throwsHttps(() => parseAdminRequest({ ...env, action: "approve", entryId: "e1", title: "x", category: "mente", measure: "other", notes: "x".repeat(201) }), "invalid-argument", /troppo lungo/);
  throwsHttps(() => parseAdminRequest({ ...env, action: "reject", entryId: "e1", reason: "  " }), "invalid-argument", /obbligatorio/);
  throwsHttps(() => parseAdminRequest({ ...env, action: "addParticipant", recordId: "r1", registrationId: "guest_u1" }), "invalid-argument", /senza account/);
  throwsHttps(() => parseAdminRequest({ ...env, action: "addParticipant", recordId: "r1", registrationId: "xyz" }), "invalid-argument", /registrationId/);
  parseAdminRequest({ ...env, action: "addParticipant", recordId: "r1", registrationId: "child_p1_c1" });
  throwsHttps(() => parseAdminRequest({ ...env, action: "updateRecord", recordId: "r1", title: "x", category: "mente", measure: "other", status: "gone" }), "invalid-argument", /Stato/);
  // updateRecord senza notes = invariate; con null = svuotate.
  const keep = parseAdminRequest({ ...env, action: "updateRecord", recordId: "r1", title: "x", category: "mente", measure: "other", status: "open" });
  assert.equal(keep.fields.notes, undefined);
  const clear = parseAdminRequest({ ...env, action: "updateRecord", recordId: "r1", title: "x", category: "mente", measure: "other", status: "open", notes: null });
  assert.equal(clear.fields.notes, "");
});

test("gli elenchi di valori del server combaciano con quelli del client", () => {
  const client = readFileSync(new URL("../../src/utils/recordNight.ts", import.meta.url), "utf8");
  const types = readFileSync(new URL("../../src/types/models.ts", import.meta.url), "utf8");
  for (const value of [...night.RECORD_CATEGORIES, ...night.RECORD_MEASURES]) {
    assert.ok(client.includes(`value: "${value}"`), `src/utils/recordNight.ts non ha ${value}`);
    assert.ok(types.includes(`"${value}"`), `src/types/models.ts non ha ${value}`);
  }
  assert.equal(night.MAX_ACTIVE_ENTRIES, 2);
  assert.match(client, /RECORD_NIGHT_MAX_ENTRIES = 2/);
});

// ---------------------------------------------------------------------------
// Firestore finto: stesse regole di lettura-prima-di-scrittura della transazione vera
// ---------------------------------------------------------------------------

class FakeRef {
  constructor(store, path) { this.store = store; this.path = path; }
  get id() { return this.path.split("/").pop(); }
  collection(name) { return new FakeCollection(this.store, `${this.path}/${name}`); }
  async get() { return snapshotOf(this.store, this.path); }
  async delete() { this.store.docs.delete(this.path); }
}

class FakeCollection {
  constructor(store, path) { this.store = store; this.path = path; }
  doc(id) { return new FakeRef(this.store, `${this.path}/${id ?? `auto${++this.store.counter}`}`); }
  where(field, op, value) { return new FakeQuery(this, field, op, value); }
  // Lettura fuori dalla transazione.
  async get() {
    this.store.collectionReads += 1;
    const prefix = `${this.path}/`;
    const docs = [...this.store.docs.keys()]
      .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map((path) => snapshotOf(this.store, path));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}

class FakeQuery {
  constructor(collection, field, op, value) { Object.assign(this, { collection, field, op, value }); }
}

function snapshotOf(store, path) {
  const data = store.docs.get(path);
  return {
    id: path.split("/").pop(),
    ref: new FakeRef(store, path),
    exists: data !== undefined,
    data: () => (data === undefined ? undefined : structuredClone(data)),
  };
}

class FakeTx {
  constructor(store) { this.store = store; this.writes = []; }
  assertNoWrites() {
    if (this.writes.length) throw new Error("Firestore transactions require all reads to be executed before all writes.");
  }
  async get(target) {
    this.assertNoWrites();
    if (target instanceof FakeCollection) {
      throw new Error("Una collezione intera non si legge dentro la transazione.");
    }
    if (target instanceof FakeQuery) {
      assert.equal(target.op, "==");
      const prefix = `${target.collection.path}/`;
      const docs = [...this.store.docs.keys()]
        .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
        .filter((path) => this.store.docs.get(path)[target.field] === target.value)
        .map((path) => snapshotOf(this.store, path));
      return { docs, size: docs.length, empty: docs.length === 0 };
    }
    return snapshotOf(this.store, target.path);
  }
  async getAll(...refs) {
    this.assertNoWrites();
    return refs.map((ref) => snapshotOf(this.store, ref.path));
  }
  create(ref, data) { this.writes.push({ op: "create", ref, data }); }
  update(ref, data) { this.writes.push({ op: "update", ref, data }); }
}

class FakeDb {
  constructor() { this.docs = new Map(); this.counter = 0; this.collectionReads = 0; }
  doc(path) { return new FakeRef(this, path); }
  seed(path, data) { this.docs.set(path, structuredClone(data)); return this; }
  read(path) { return this.docs.get(path); }
  list(collectionPath) {
    const prefix = `${collectionPath}/`;
    return [...this.docs.keys()]
      .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map((path) => ({ id: path.slice(prefix.length), ...this.docs.get(path) }));
  }
  async runTransaction(fn) {
    const tx = new FakeTx(this);
    const result = await fn(tx);
    const working = new Map(this.docs);
    for (const { op, ref, data } of tx.writes) {
      if (op === "create") {
        if (working.has(ref.path)) throw new Error(`ALREADY_EXISTS ${ref.path}`);
        working.set(ref.path, structuredClone(data));
      } else {
        if (!working.has(ref.path)) throw new Error(`NOT_FOUND ${ref.path}`);
        working.set(ref.path, { ...working.get(ref.path), ...structuredClone(data) });
      }
    }
    this.docs = working;
    return result;
  }
  async recursiveDelete(collection) {
    const prefix = `${collection.path}/`;
    for (const path of [...this.docs.keys()]) if (path.startsWith(prefix)) this.docs.delete(path);
  }
}

const ACTIVITY = "stakes/s1/activities/a1";
const NOW = "2026-10-12T10:00:00.000Z";

function world(activityOverrides = {}) {
  const db = new FakeDb();
  const clock = { now: NOW };
  db.seed(ACTIVITY, {
    recordsEnabled: true,
    recordsCloseAt: "2026-10-15T19:00:00.000Z",
    startDate: "2026-10-16T14:00:00.000Z",
    ...activityOverrides,
  });
  db.seed(`${ACTIVITY}/registrations/user_u1`, { firstName: "Mario", lastName: "Rossi", registrationStatus: "active" });
  db.seed(`${ACTIVITY}/registrations/user_u2`, { firstName: "Anna", lastName: "Verdi", registrationStatus: "confirmed" });
  db.seed(`${ACTIVITY}/registrations/user_u3`, { firstName: "Gianni", lastName: "Neri", registrationStatus: "active" });
  db.seed(`${ACTIVITY}/registrations/child_p1_c1`, {
    firstName: "Luca", lastName: "Bianchi", registrationStatus: "active", parentUid: "p1", childId: "c1", unitName: "Unità A",
  });
  db.seed(`${ACTIVITY}/registrations/user_gone`, { firstName: "Ex", lastName: "Iscritto", registrationStatus: "cancelled" });
  db.seed("users/admin1", { role: "admin", stakeId: "s1" });
  db.seed("users/admin2", { role: "admin", stakeId: "s2" });
  db.seed("users/super1", { role: "super_admin", stakeId: "s9" });
  db.seed("users/kid", { role: "participant", stakeId: "s1" });
  db.seed("users/p1", { role: "parent", stakeId: "s1" });
  db.seed("users/leader1", { role: "unit_leader", stakeId: "s1" });
  db.seed("users/leader2", { role: "unit_leader", stakeId: "s2" });
  db.seed("users/acc1", { role: "participant", stakeId: "s1" });
  db.seed(`${ACTIVITY}/registrations/user_acc1`, { firstName: "Elena", lastName: "Gialli", registrationStatus: "active", genderRoleCategory: "accompagnatore", unitName: "Unità B" });
  const clockFn = () => new Date(clock.now);
  const participant = createRecordNightParticipantHandler({ db, clock: clockFn });
  const admin = createRecordNightAdminHandler({ db, clock: clockFn });
  const as = (uid, provider = "password") => ({ uid, token: { firebase: { sign_in_provider: provider } } });
  const call = (handler, uid, data, provider) =>
    handler({ auth: uid ? as(uid, provider) : undefined, data: { stakeId: "s1", activityId: "a1", ...data } });
  return {
    db,
    clock,
    p: (uid, data, provider) => call(participant, uid, data, provider),
    a: (uid, data, provider) => call(admin, uid, data, provider),
    entry: (id) => db.read(`${ACTIVITY}/recordEntries/${id}`),
    record: (id) => db.read(`${ACTIVITY}/records/${id}`),
    entriesOf: () => db.list(`${ACTIVITY}/recordEntries`),
    records: () => db.list(`${ACTIVITY}/records`),
  };
}

const proposeSalti = { action: "propose", text: "Salti a piedi uniti", measure: "count_in_time", durationSeconds: 60, needs: "" };
const approveSalti = (entryId) => ({
  action: "approve", entryId, title: "Salti a piedi uniti in 60 secondi", category: "resistenza", measure: "count_in_time", durationSeconds: 60,
});

test("partecipante: proposta, limite di 2, doppione, nome dall'iscrizione", async () => {
  const w = world();
  const first = await w.p("u1", proposeSalti);
  assert.equal(first.entry.status, "pending");
  assert.equal(first.entry.recordId, null);
  assert.equal(first.entry.ownerUid, "u1");
  assert.equal(first.entry.registrationId, "user_u1");
  assert.equal(first.entry.participantName, "Mario Rossi");
  assert.equal(first.record, null);
  await rejectsHttps(w.p("u1", proposeSalti), "failed-precondition", /Questa proposta è già presente/);
  await w.p("u1", { action: "propose", text: "Equilibrio su un piede", measure: "longest_time" });
  await rejectsHttps(
    w.p("u1", { action: "propose", text: "Un altro", measure: "other" }),
    "failed-precondition",
    /^Limite di 2 record raggiunto: ritirane uno per sceglierne un altro\.$/,
  );
  assert.equal(w.entriesOf().length, 2);
  // L'altro ragazzo non è toccato dal limite.
  await w.p("u2", { action: "propose", text: "Un altro", measure: "other" });
});

test("partecipante: identità e finestra", async () => {
  const w = world();
  await rejectsHttps(w.p(null, proposeSalti), "unauthenticated");
  await rejectsHttps(w.p("u1", proposeSalti, "anonymous"), "permission-denied", /account personale/);
  await rejectsHttps(w.p("nobody", proposeSalti), "permission-denied", /serve l'iscrizione all'attività/);
  await rejectsHttps(w.p("gone", proposeSalti), "permission-denied", /serve l'iscrizione all'attività/);
  // L'iscrizione di un figlio (child_) non dà un account che agisce.
  await rejectsHttps(w.p("p1", proposeSalti), "permission-denied");

  w.clock.now = "2026-10-15T19:00:00.000Z";
  await rejectsHttps(w.p("u1", proposeSalti), "failed-precondition", /^Le iscrizioni ai record sono chiuse\.$/);

  const noClose = world({ recordsCloseAt: null });
  await noClose.p("u1", proposeSalti); // chiude a startDate: ancora aperto
  noClose.clock.now = "2026-10-16T14:00:00.000Z";
  await rejectsHttps(noClose.p("u2", proposeSalti), "failed-precondition", /chiuse/);

  const off = world({ recordsEnabled: false });
  await rejectsHttps(off.p("u1", proposeSalti), "failed-precondition", /non è attiva/);
  await rejectsHttps(off.a("admin1", { action: "reopen", entryId: "e1" }), "failed-precondition", /non è attiva/);

  await rejectsHttps(w.p("u1", { ...proposeSalti, stakeId: "../x" }), "invalid-argument");
  const missing = world();
  missing.db.docs.delete(ACTIVITY);
  await rejectsHttps(missing.p("u1", proposeSalti), "not-found", /Attività/);
});

test("admin: permessi (stesso palo, super_admin, niente participant né altro palo)", async () => {
  const w = world();
  const { entry } = await w.p("u1", proposeSalti);
  const approve = approveSalti(entry.id);
  await rejectsHttps(w.a(null, approve), "unauthenticated");
  await rejectsHttps(w.a("kid", approve), "permission-denied", /permessi/);
  await rejectsHttps(w.a("admin2", approve), "permission-denied", /permessi/);
  await rejectsHttps(w.a("ghost", approve), "permission-denied");
  const result = await w.a("super1", approve);
  assert.equal(result.entry.status, "approved");
  assert.equal(w.record(result.record.id).createdBy, "super1");
});

test("flusso completo: approva, unisci, ritira, annulla, riporta in attesa, contatore sempre coerente", async () => {
  const w = world();
  const proposalOne = (await w.p("u1", proposeSalti)).entry;
  const proposalTwo = (await w.p("u2", { action: "propose", text: "salti con i piedi uniti", measure: "count_in_time", durationSeconds: 60 })).entry;

  // Approva: nasce il record con 1 iscritto, il testo originale resta intatto.
  const approved = await w.a("admin1", approveSalti(proposalOne.id));
  const recordId = approved.record.id;
  assert.equal(approved.record.challengerCount, 1);
  assert.equal(approved.record.status, "open");
  assert.equal(approved.record.durationSeconds, 60);
  assert.equal(approved.entry.recordId, recordId);
  assert.equal(w.entry(proposalOne.id).proposedText, "Salti a piedi uniti");

  // Unisci: 2 iscritti.
  const merged = await w.a("admin1", { action: "merge", entryId: proposalTwo.id, recordId });
  assert.equal(merged.record.challengerCount, 2);
  assert.equal(w.entry(proposalTwo.id).status, "approved");
  await rejectsHttps(w.a("admin1", { action: "merge", entryId: proposalTwo.id, recordId }), "failed-precondition", /non è in attesa/);

  // Ritiro: scende il contatore e si salva lo stato per Annulla.
  const withdrawn = await w.p("u2", { action: "withdraw", entryId: proposalTwo.id });
  assert.equal(withdrawn.entry.status, "withdrawn");
  assert.equal(withdrawn.entry.statusBeforeWithdraw, "approved");
  assert.equal(withdrawn.record.challengerCount, 1);
  // Doppio tocco: nessun secondo decremento.
  const again = await w.p("u2", { action: "withdraw", entryId: proposalTwo.id });
  assert.equal(again.entry.status, "withdrawn");
  assert.equal(w.record(recordId).challengerCount, 1);

  // Annulla: torna approvato sul record, contatore su.
  const restored = await w.p("u2", { action: "restore", entryId: proposalTwo.id });
  assert.equal(restored.entry.status, "approved");
  assert.equal(restored.entry.statusBeforeWithdraw, null);
  assert.equal(restored.entry.recordId, recordId);
  assert.equal(restored.record.challengerCount, 2);
  // Doppio tocco su Annulla: nessun secondo incremento.
  await w.p("u2", { action: "restore", entryId: proposalTwo.id });
  assert.equal(w.record(recordId).challengerCount, 2);

  // Riporta in attesa: la proposta com'era, contatore giù.
  const reopened = await w.a("admin1", { action: "reopen", entryId: proposalTwo.id });
  assert.equal(reopened.entry.status, "pending");
  assert.equal(reopened.entry.recordId, null);
  assert.equal(reopened.entry.decidedAt, null);
  assert.equal(reopened.entry.proposedText, "salti con i piedi uniti");
  assert.equal(reopened.record.challengerCount, 1);

  // Rifiuta con motivo e riporta in attesa.
  const rejected = await w.a("admin1", { action: "reject", entryId: proposalTwo.id, reason: "  Troppo  rischioso " });
  assert.equal(rejected.entry.status, "rejected");
  assert.equal(rejected.entry.rejectionReason, "Troppo rischioso");
  assert.equal(w.record(recordId).challengerCount, 1);
  await rejectsHttps(w.p("u2", { action: "withdraw", entryId: proposalTwo.id }), "failed-precondition", /rifiutata/);
  const back = await w.a("admin1", { action: "reopen", entryId: proposalTwo.id });
  assert.equal(back.entry.status, "pending");
  assert.equal(back.entry.rejectionReason, "");
  assert.equal(w.record(recordId).challengerCount, 1);
});

test("sfida: contatore, unicità, limite, record non disponibile", async () => {
  const w = world();
  const proposal = (await w.p("u1", proposeSalti)).entry;
  const { record } = await w.a("admin1", approveSalti(proposal.id));

  const challenge = await w.p("u2", { action: "challenge", recordId: record.id });
  assert.equal(challenge.entry.status, "approved");
  assert.equal(challenge.entry.kind, "challenge");
  assert.equal(challenge.entry.recordId, record.id);
  assert.equal(challenge.record.challengerCount, 2);
  await rejectsHttps(w.p("u2", { action: "challenge", recordId: record.id }), "failed-precondition", /^Già in gara per questo record\.$/);
  await rejectsHttps(w.p("u1", { action: "challenge", recordId: record.id }), "failed-precondition", /Già in gara/);
  await rejectsHttps(w.p("u2", { action: "challenge", recordId: "nope" }), "failed-precondition", /non è più disponibile/);

  // Limite: u2 ha 1 sfida, ne aggiunge una seconda con una proposta, la terza è bloccata.
  await w.p("u2", { action: "propose", text: "Altro", measure: "other" });
  const second = await w.a("admin1", {
    action: "approve",
    entryId: w.entriesOf().find((item) => item.proposedText === "Altro").id,
    title: "Altro", category: "fantasia", measure: "other",
  });
  await rejectsHttps(w.p("u2", { action: "challenge", recordId: second.record.id }), "failed-precondition", /Già in gara/);

  // Record nascosto: non si sfida e non si ripristina.
  await w.a("admin1", {
    action: "updateRecord", recordId: record.id, title: record.title, category: "resistenza",
    measure: "count_in_time", durationSeconds: 60, status: "hidden",
  });
  const third = world();
  const p3 = (await third.p("u1", proposeSalti)).entry;
  const rec3 = (await third.a("admin1", approveSalti(p3.id))).record;
  await third.p("u2", { action: "challenge", recordId: rec3.id });
  const w2 = (await third.p("u2", { action: "propose", text: "Nuova", measure: "other" })).entry;
  const own = third.entriesOf().find((item) => item.kind === "challenge");
  await third.p("u2", { action: "withdraw", entryId: own.id });
  await third.a("admin1", {
    action: "updateRecord", recordId: rec3.id, title: rec3.title, category: "resistenza",
    measure: "count_in_time", durationSeconds: 60, status: "hidden",
  });
  await rejectsHttps(third.p("u2", { action: "restore", entryId: own.id }), "failed-precondition", /non è più disponibile/);
  await rejectsHttps(third.p("u2", { action: "challenge", recordId: rec3.id }), "failed-precondition", /non è più disponibile/);
  assert.ok(w2.id);
});

test("annulla il ritiro rispetta il limite di 2 e l'unicità", async () => {
  const w = world();
  const first = (await w.p("u1", proposeSalti)).entry;
  const withdrawn = await w.p("u1", { action: "withdraw", entryId: first.id });
  assert.equal(withdrawn.entry.statusBeforeWithdraw, "pending");
  await w.p("u1", { action: "propose", text: "Uno", measure: "other" });
  await w.p("u1", { action: "propose", text: "Due", measure: "other" });
  await rejectsHttps(w.p("u1", { action: "restore", entryId: first.id }), "failed-precondition", /Limite di 2 record raggiunto/);
  assert.equal(w.entry(first.id).status, "withdrawn");

  // Un tentativo mai ritirato non si "ripristina".
  const live = w.entriesOf().find((item) => item.proposedText === "Uno");
  const same = await w.p("u1", { action: "restore", entryId: live.id });
  assert.equal(same.entry.status, "pending");
  // Il ritiro d'ufficio (statusBeforeWithdraw null) non è annullabile.
  w.db.docs.set(`${ACTIVITY}/recordEntries/${first.id}`, { ...w.entry(first.id), statusBeforeWithdraw: null });
  await w.p("u1", { action: "withdraw", entryId: live.id });
  await rejectsHttps(w.p("u1", { action: "restore", entryId: first.id }), "failed-precondition", /niente da ripristinare/);
});

test("modifica: solo una proposta in attesa, propria", async () => {
  const w = world();
  const proposal = (await w.p("u1", proposeSalti)).entry;
  const edited = await w.p("u1", { action: "edit", entryId: proposal.id, text: "Salti a piedi pari", measure: "count_streak", needs: "Una corda" });
  assert.equal(edited.entry.proposedText, "Salti a piedi pari");
  assert.equal(edited.entry.proposedMeasure, "count_streak");
  assert.equal(edited.entry.proposedDurationSeconds, null);
  assert.equal(edited.entry.proposedNeeds, "Una corda");
  await rejectsHttps(w.p("u2", { action: "edit", entryId: proposal.id, text: "x", measure: "other" }), "not-found");
  await rejectsHttps(w.p("u2", { action: "withdraw", entryId: proposal.id }), "not-found");
  await w.a("admin1", approveSalti(proposal.id));
  await rejectsHttps(w.p("u1", { action: "edit", entryId: proposal.id, text: "x", measure: "other" }), "failed-precondition", /in attesa/);
});

test("admin: iscrivi qualcuno (user_ e child_), unicità, limite, record nascosto, riapertura", async () => {
  const w = world();
  const proposal = (await w.p("u1", proposeSalti)).entry;
  const { record } = await w.a("admin1", approveSalti(proposal.id));

  const child = await w.a("admin1", { action: "addParticipant", recordId: record.id, registrationId: "child_p1_c1" });
  assert.equal(child.entry.ownerUid, "p1"); // il genitore lo vede e lo gestisce
  assert.equal(child.entry.createdByAdmin, true);
  assert.equal(child.entry.participantName, "Luca Bianchi");
  assert.equal(child.entry.decidedBy, "admin1");
  assert.equal(child.record.challengerCount, 2);
  await rejectsHttps(w.a("admin1", { action: "addParticipant", recordId: record.id, registrationId: "child_p1_c1" }), "failed-precondition", /già iscritta/);

  const user = await w.a("admin1", { action: "addParticipant", recordId: record.id, registrationId: "user_u2" });
  assert.equal(user.entry.ownerUid, "u2");
  assert.equal(user.record.challengerCount, 3);
  await rejectsHttps(w.a("admin1", { action: "addParticipant", recordId: record.id, registrationId: "user_gone" }), "failed-precondition", /annullata/);
  await rejectsHttps(w.a("admin1", { action: "addParticipant", recordId: record.id, registrationId: "user_nope" }), "not-found");

  // Limite anche per l'admin: u2 è già su 2 record, un terzo non entra.
  const proposalB = (await w.p("u1", { action: "propose", text: "B", measure: "other" })).entry;
  const other = (await w.a("admin1", { action: "approve", entryId: proposalB.id, title: "B", category: "mente", measure: "other" })).record;
  await w.a("admin1", { action: "addParticipant", recordId: other.id, registrationId: "user_u2" });
  const proposalD = (await w.p("u3", { action: "propose", text: "D", measure: "other" })).entry;
  const third = (await w.a("admin1", { action: "approve", entryId: proposalD.id, title: "D", category: "fantasia", measure: "other" })).record;
  await rejectsHttps(w.a("admin1", { action: "addParticipant", recordId: third.id, registrationId: "user_u2" }), "failed-precondition", /Limite di 2 record raggiunto per questa persona/);

  // Un record nascosto non accetta iscrizioni.
  await w.a("admin1", { action: "updateRecord", recordId: other.id, title: "B", category: "mente", measure: "other", status: "hidden" });
  await rejectsHttps(w.a("admin1", { action: "addParticipant", recordId: other.id, registrationId: "child_p1_c1" }), "failed-precondition", /nascosto/);

  // L'admin ritira: contatore giù, nessun Annulla per il ragazzo.
  const removed = await w.a("admin1", { action: "withdrawEntry", entryId: user.entry.id });
  assert.equal(removed.entry.status, "withdrawn");
  assert.equal(removed.entry.statusBeforeWithdraw, null);
  assert.equal(removed.record.challengerCount, 2);
  await rejectsHttps(w.p("u2", { action: "restore", entryId: user.entry.id }), "failed-precondition", /niente da ripristinare/);

  // Una sfida non si riporta in attesa; un ritirato non si riapre.
  await rejectsHttps(w.a("admin1", { action: "reopen", entryId: child.entry.id }), "failed-precondition", /sfida/);
  const reopenWithdrawn = (await w.p("u3", { action: "propose", text: "C", measure: "other" })).entry;
  await w.p("u3", { action: "withdraw", entryId: reopenWithdrawn.id });
  await rejectsHttps(w.a("admin1", { action: "reopen", entryId: reopenWithdrawn.id }), "failed-precondition", /ritirata/);
});

test("riporta in attesa una proposta rifiutata rispetta il limite e l'iscrizione attiva", async () => {
  const w = world();
  const rejected = (await w.p("u1", proposeSalti)).entry;
  await w.a("admin1", { action: "reject", entryId: rejected.id, reason: "No" });
  await w.p("u1", { action: "propose", text: "Uno", measure: "other" });
  await w.p("u1", { action: "propose", text: "Due", measure: "other" });
  await rejectsHttps(w.a("admin1", { action: "reopen", entryId: rejected.id }), "failed-precondition", /Limite di 2 record raggiunto per questa persona/);
  assert.equal(w.entry(rejected.id).status, "rejected");

  const w2 = world();
  const r2 = (await w2.p("u1", proposeSalti)).entry;
  await w2.a("admin1", { action: "reject", entryId: r2.id, reason: "No" });
  w2.db.docs.set(`${ACTIVITY}/registrations/user_u1`, { firstName: "Mario", lastName: "Rossi", registrationStatus: "cancelled" });
  await rejectsHttps(w2.a("admin1", { action: "reopen", entryId: r2.id }), "failed-precondition", /annullata/);
});

test("admin: dopo la scadenza può ancora agire, il ragazzo no", async () => {
  const w = world();
  const proposal = (await w.p("u1", proposeSalti)).entry;
  w.clock.now = "2026-10-16T20:00:00.000Z";
  await rejectsHttps(w.p("u1", { action: "withdraw", entryId: proposal.id }), "failed-precondition", /chiuse/);
  await rejectsHttps(w.p("u1", { action: "restore", entryId: proposal.id }), "failed-precondition", /chiuse/);
  const approved = await w.a("admin1", approveSalti(proposal.id));
  assert.equal(approved.record.challengerCount, 1);
});

test("updateRecord: note invariate se assenti, svuotate con null; la misura azzera la durata", async () => {
  const w = world();
  const proposal = (await w.p("u1", proposeSalti)).entry;
  const { record } = await w.a("admin1", { ...approveSalti(proposal.id), notes: "Al chiuso\nNiente cibo" });
  const base = { action: "updateRecord", recordId: record.id, title: "Nuovo titolo", category: "velocita", measure: "fastest_time", status: "open" };
  const kept = await w.a("admin1", base);
  assert.equal(kept.record.notes, "Al chiuso\nNiente cibo");
  assert.equal(kept.record.durationSeconds, null);
  assert.equal(kept.record.challengerCount, 1);
  assert.equal(kept.entry, null);
  const cleared = await w.a("admin1", { ...base, notes: null });
  assert.equal(cleared.record.notes, "");
  await rejectsHttps(w.a("admin1", { ...base, recordId: "nope" }), "not-found", /Record/);
});

test("trigger: iscrizione annullata o cancellata ritira i tentativi e scala i contatori, una volta sola", async () => {
  const w = world();
  const one = (await w.p("u1", proposeSalti)).entry;
  const { record } = await w.a("admin1", approveSalti(one.id));
  await w.p("u2", { action: "challenge", recordId: record.id });
  const pending = (await w.p("u1", { action: "propose", text: "Altro", measure: "other" })).entry;
  assert.equal(w.record(record.id).challengerCount, 2);
  const params = { stakeId: "s1", activityId: "a1", registrationId: "user_u1" };
  const clock = () => new Date(NOW);

  // Iscrizione ancora attiva (riattivata prima del trigger): niente da fare.
  assert.deepEqual(await retireEntriesForRegistration(w.db, params, clock), { retired: 0, staffRemoved: false });
  assert.equal(w.entry(one.id).status, "approved");

  // Annullata: i due tentativi di u1 vanno a withdrawn senza Annulla.
  w.db.docs.set(`${ACTIVITY}/registrations/user_u1`, { firstName: "Mario", lastName: "Rossi", registrationStatus: "rejected_by_parent" });
  assert.deepEqual(await retireEntriesForRegistration(w.db, params, clock), { retired: 2, staffRemoved: false });
  for (const id of [one.id, pending.id]) {
    assert.equal(w.entry(id).status, "withdrawn");
    assert.equal(w.entry(id).statusBeforeWithdraw, null);
  }
  assert.equal(w.record(record.id).challengerCount, 1);
  // Idempotente: un secondo passaggio non decrementa di nuovo.
  assert.deepEqual(await retireEntriesForRegistration(w.db, params, clock), { retired: 0, staffRemoved: false });
  assert.equal(w.record(record.id).challengerCount, 1);
  // Gli altri non sono toccati.
  assert.equal(w.entriesOf().filter((item) => item.registrationId === "user_u2")[0].status, "approved");
  // Il ragazzo non può più agire né annullare.
  await rejectsHttps(w.p("u1", { action: "restore", entryId: one.id }), "permission-denied");

  // Cancellazione del documento: stesso esito.
  const w2 = world();
  const e2 = (await w2.p("u2", proposeSalti)).entry;
  await w2.a("admin1", approveSalti(e2.id));
  w2.db.docs.delete(`${ACTIVITY}/registrations/user_u2`);
  assert.deepEqual(await retireEntriesForRegistration(w2.db, { ...params, registrationId: "user_u2" }, clock), { retired: 1, staffRemoved: false });
  assert.equal(w2.records()[0].challengerCount, 0);
});

test("trigger: altro palo o altra attività con gli stessi id restano intatti", async () => {
  const w = world();
  const e = (await w.p("u1", proposeSalti)).entry;
  await w.a("admin1", approveSalti(e.id));
  const otherActivity = "stakes/s2/activities/a1";
  w.db.seed(otherActivity, { recordsEnabled: true });
  w.db.seed(`${otherActivity}/registrations/user_u1`, { registrationStatus: "cancelled" });
  w.db.seed(`${otherActivity}/recordEntries/x1`, { registrationId: "user_u1", status: "approved", recordId: "r1" });
  w.db.seed(`${otherActivity}/records/r1`, { challengerCount: 1, status: "open" });
  await retireEntriesForRegistration(w.db, { stakeId: "s1", activityId: "a1", registrationId: "user_u1" }, () => new Date(NOW));
  assert.equal(w.db.read(`${otherActivity}/recordEntries/x1`).status, "approved");
  assert.equal(w.db.read(`${otherActivity}/records/r1`).challengerCount, 1);
});

test("cancellazione attività: record e tentativi spariscono solo se l'attività non esiste più", async () => {
  const w = world();
  const e = (await w.p("u1", proposeSalti)).entry;
  await w.a("admin1", approveSalti(e.id));
  assert.equal(await cleanupDeletedActivity(w.db, { stakeId: "s1", activityId: "a1" }), false);
  assert.equal(w.entriesOf().length, 1);
  w.db.docs.delete(ACTIVITY);
  assert.equal(await cleanupDeletedActivity(w.db, { stakeId: "s1", activityId: "a1" }), true);
  assert.equal(w.entriesOf().length, 0);
  assert.equal(w.records().length, 0);
});

// ---------------------------------------------------------------------------
// createRecord e modifica senza doppioni (secondo giro)
// ---------------------------------------------------------------------------

test("createRecord: validazione come approve, chiavi esatte", () => {
  const env = { stakeId: "s1", activityId: "a1", action: "createRecord" };
  const ok = parseAdminRequest({ ...env, title: "  Salti   in 60 secondi ", category: "resistenza", measure: "count_in_time", durationSeconds: 60 });
  assert.deepEqual(ok.fields, {
    title: "Salti in 60 secondi", category: "resistenza", measure: "count_in_time", durationSeconds: 60, notes: "",
  });
  assert.equal(
    parseAdminRequest({ ...env, title: "Equilibrio", category: "equilibrio", measure: "longest_time", notes: "Al chiuso" }).fields.notes,
    "Al chiuso",
  );
  const base = { ...env, title: "x", category: "mente", measure: "other" };
  throwsHttps(() => parseAdminRequest({ ...base, entryId: "e1" }), "invalid-argument", /campi non ammessi/);
  throwsHttps(() => parseAdminRequest({ ...base, status: "open" }), "invalid-argument", /campi non ammessi/);
  throwsHttps(() => parseAdminRequest({ ...base, recordId: "r1" }), "invalid-argument", /campi non ammessi/);
  throwsHttps(() => parseAdminRequest({ ...base, title: "" }), "invalid-argument", /obbligatorio/);
  throwsHttps(() => parseAdminRequest({ ...base, title: "x".repeat(81) }), "invalid-argument", /troppo lungo/);
  throwsHttps(() => parseAdminRequest({ ...base, category: "boh" }), "invalid-argument", /Categoria/);
  throwsHttps(() => parseAdminRequest({ ...base, measure: "boh" }), "invalid-argument", /Come si misura/);
  throwsHttps(() => parseAdminRequest({ ...base, measure: "count_in_time" }), "invalid-argument", /durata/);
  throwsHttps(() => parseAdminRequest({ ...base, durationSeconds: 30 }), "invalid-argument", /durata/);
  throwsHttps(() => parseAdminRequest({ ...base, notes: "x".repeat(201) }), "invalid-argument", /troppo lungo/);
});

test("createRecord: record aperto a zero iscritti, invisibile finché non entra qualcuno", async () => {
  const w = world();
  const input = { action: "createRecord", title: "Palleggi senza farla cadere", category: "precisione", measure: "count_streak", notes: "Una palla" };
  const created = await w.a("admin1", input);
  assert.equal(created.ok, true);
  assert.equal(created.action, "createRecord");
  assert.equal(created.entry, null);
  assert.equal(created.record.status, "open");
  assert.equal(created.record.challengerCount, 0);
  assert.equal(created.record.createdBy, "admin1");
  assert.equal(created.record.durationSeconds, null);
  assert.equal(created.record.notes, "Una palla");
  assert.equal(created.record.createdAt, NOW);
  assert.deepEqual(w.record(created.record.id), {
    title: "Palleggi senza farla cadere", category: "precisione", measure: "count_streak", durationSeconds: null,
    notes: "Una palla", challengerCount: 0, status: "open", createdFromEntryId: null, createdAt: NOW, updatedAt: NOW, createdBy: "admin1",
  });
  assert.equal(w.entriesOf().length, 0);

  // A zero iscritti il ragazzo non lo sfida; l'admin ci iscrive qualcuno e diventa visibile.
  await rejectsHttps(w.p("u1", { action: "challenge", recordId: created.record.id }), "failed-precondition", /non è più disponibile/);
  const added = await w.a("admin1", { action: "addParticipant", recordId: created.record.id, registrationId: "child_p1_c1" });
  assert.equal(added.record.challengerCount, 1);
  const challenge = await w.p("u1", { action: "challenge", recordId: created.record.id });
  assert.equal(challenge.record.challengerCount, 2);

  // Con la durata, per le prove a tempo; e dopo la scadenza l'admin può ancora crearlo.
  w.clock.now = "2026-10-16T20:00:00.000Z";
  const timed = await w.a("admin1", {
    action: "createRecord", title: "Salti in 30 secondi", category: "resistenza", measure: "count_in_time", durationSeconds: 30,
  });
  assert.equal(timed.record.durationSeconds, 30);
  assert.equal(timed.record.notes, "");
  assert.equal(w.records().length, 2);
});

test("createRecord: solo admin del palo con il modulo acceso", async () => {
  const input = { action: "createRecord", title: "Nuovo", category: "mente", measure: "other" };
  const w = world();
  await rejectsHttps(w.a(null, input), "unauthenticated");
  await rejectsHttps(w.a("kid", input), "permission-denied", /permessi/);
  await rejectsHttps(w.a("admin2", input), "permission-denied", /permessi/);
  await rejectsHttps(w.p("u1", input), "invalid-argument", /Azione/); // non è un'azione del partecipante
  assert.equal(w.records().length, 0);
  assert.equal((await w.a("super1", input)).record.createdBy, "super1");

  const off = world({ recordsEnabled: false });
  await rejectsHttps(off.a("admin1", input), "failed-precondition", /non è attiva/);
  assert.equal(off.records().length, 0);
});

test("modifica: non si arriva a due proposte identiche attive", async () => {
  const w = world();
  const a = (await w.p("u1", proposeSalti)).entry;
  const b = (await w.p("u1", { action: "propose", text: "Equilibrio su un piede", measure: "longest_time" })).entry;

  // Identica all'altra (spazi e maiuscole non contano): rifiutata, B resta com'era.
  await rejectsHttps(
    w.p("u1", { action: "edit", entryId: b.id, text: "  salti A piedi  UNITI ", measure: "count_in_time", durationSeconds: 60 }),
    "failed-precondition",
    /^Questa proposta è già presente\.$/,
  );
  assert.equal(w.entry(b.id).proposedText, "Equilibrio su un piede");
  assert.equal(w.entry(b.id).updatedAt, b.updatedAt);

  // Stesso testo ma misura o durata diverse: è un'altra proposta, ammessa.
  const otherDuration = await w.p("u1", { action: "edit", entryId: b.id, text: "Salti a piedi uniti", measure: "count_in_time", durationSeconds: 30 });
  assert.equal(otherDuration.entry.proposedDurationSeconds, 30);
  const otherMeasure = await w.p("u1", { action: "edit", entryId: b.id, text: "Salti a piedi uniti", measure: "count_streak" });
  assert.equal(otherMeasure.entry.proposedMeasure, "count_streak");

  // Risalvare la propria proposta senza cambiarla non conta come doppione di se stessa.
  const same = await w.p("u1", { action: "edit", entryId: a.id, text: "Salti a piedi uniti", measure: "count_in_time", durationSeconds: 60, needs: "Una corda" });
  assert.equal(same.entry.proposedNeeds, "Una corda");

  // Una proposta ritirata non conta: si può rimodificare B come A solo se A non è più attiva.
  await w.p("u1", { action: "withdraw", entryId: a.id });
  const afterWithdraw = await w.p("u1", { action: "edit", entryId: b.id, text: "Salti a piedi uniti", measure: "count_in_time", durationSeconds: 60 });
  assert.equal(afterWithdraw.entry.proposedText, "Salti a piedi uniti");

  // Le proposte di un'altra persona non contano.
  const other = (await w.p("u2", { action: "propose", text: "Altro", measure: "other" })).entry;
  const crossed = await w.p("u2", { action: "edit", entryId: other.id, text: "Salti a piedi uniti", measure: "count_in_time", durationSeconds: 60 });
  assert.equal(crossed.entry.proposedText, "Salti a piedi uniti");
});

// ---------------------------------------------------------------------------
// Terzo giro: genitori, staff, context, listParticipants, nascondi/mostra
// ---------------------------------------------------------------------------

test("genitore: agisce per la propria user_ e per le child_<uid>_*, non per altro", () => {
  assert.equal(canActForRegistration("p1", "user_p1"), true);
  assert.equal(canActForRegistration("p1", "child_p1_c1"), true);
  assert.equal(canActForRegistration("p1", "child_p1_"), false);
  assert.equal(canActForRegistration("p1", "child_p10_c1"), false); // prefisso non basta
  assert.equal(canActForRegistration("p1", "child_p2_c1"), false);
  assert.equal(canActForRegistration("p1", "user_p2"), false);
  assert.equal(canActForRegistration("p1", "guest_p1"), false);
  assert.equal(canActForRegistration("", "user_"), false);
  assert.equal(canActForRegistration(undefined, "user_undefined"), false);
});

test("staff: admin, super_admin, dirigente di unità del palo, uid in elenco; la categoria dichiarata non conta", () => {
  assert.equal(resolveStaffAccess({ role: "admin", stakeId: "s1" }, "s1", "a1", null), "admin");
  assert.equal(resolveStaffAccess({ role: "admin", stakeId: "s2" }, "s1", "a1", null), null);
  assert.equal(resolveStaffAccess({ role: "super_admin", stakeId: "s9" }, "s1", "a1", null), "admin");
  assert.equal(resolveStaffAccess({ role: "unit_leader", stakeId: "s1" }, "s1", "a1", null), "unit_leader");
  assert.equal(resolveStaffAccess({ role: "unit_leader", stakeId: "s2" }, "s1", "a1", null), null);
  // Elenco: l'uid deve esserci E avere ancora un'iscrizione attiva, a prescindere da ruolo e
  // categoria del profilo.
  const active = { registrationStatus: "active" };
  const listedKid = { role: "participant", stakeId: "s1", genderRoleCategory: "giovane_uomo" };
  assert.equal(resolveStaffAccess(listedKid, "s1", "a1", ["a1"], active), "listed");
  assert.equal(resolveStaffAccess(listedKid, "s1", "a1", ["a1"], { registrationStatus: "confirmed" }), "listed");
  assert.equal(resolveStaffAccess(listedKid, "s1", "a1", ["a1"], {}), "listed"); // stato assente = attiva
  assert.equal(resolveStaffAccess({ role: "participant", stakeId: "s1" }, "s1", "a1", ["a2"], active), null);
  assert.equal(resolveStaffAccess({ role: "participant", stakeId: "s1" }, "s1", "a1", [], active), null);
  assert.equal(resolveStaffAccess(null, "s1", "a1", ["a1"], active), "listed"); // l'elenco basta (come nelle rules)
  assert.equal(resolveStaffAccess(null, "s1", "a1", null, active), null);
  assert.equal(resolveStaffAccess(null, "s1", "", [""], active), null);
  // In elenco ma senza più iscrizione attiva (annullata, rifiutata dal genitore, assente): non è staff.
  for (const registration of [{ registrationStatus: "cancelled" }, { registrationStatus: "rejected_by_parent" }, { status: "cancelled" }, null, undefined]) {
    assert.equal(resolveStaffAccess(listedKid, "s1", "a1", ["a1"], registration), null, JSON.stringify(registration));
  }
  // Admin e dirigenti di unità non dipendono dall'iscrizione.
  assert.equal(resolveStaffAccess({ role: "admin", stakeId: "s1" }, "s1", "a1", ["a1"], { registrationStatus: "cancelled" }), "admin");
  assert.equal(resolveStaffAccess({ role: "unit_leader", stakeId: "s1" }, "s1", "a1", null, null), "unit_leader");
  // Un ragazzo che si dichiara accompagnatore o dirigente non è staff.
  for (const genderRoleCategory of ["accompagnatore", "dirigente"]) {
    assert.equal(resolveStaffAccess({ role: "participant", stakeId: "s1", genderRoleCategory }, "s1", "kid14", null), null);
    assert.equal(resolveStaffAccess({ role: "participant", stakeId: "s1", genderRoleCategory }, "s1", "kid14", [], { registrationStatus: "active", genderRoleCategory }), null);
  }
  // Scegliere lo staff: solo admin e super_admin.
  assert.equal(canManageStaff("admin"), true);
  assert.equal(canManageStaff("unit_leader"), false);
  assert.equal(canManageStaff("listed"), false);
  assert.equal(canManageStaff(null), false);
});

test("elenco staff: senza doppioni, ordinato, tetto, togliere chi non c'è è un no-op", () => {
  assert.deepEqual(nextStaffUids([], "b", true), ["b"]);
  assert.deepEqual(nextStaffUids(["b"], "a", true), ["a", "b"]);
  assert.deepEqual(nextStaffUids(["a", "b"], "a", true), ["a", "b"]);
  assert.deepEqual(nextStaffUids(["a", "b"], "a", false), ["b"]);
  assert.deepEqual(nextStaffUids(["b"], "zz", false), ["b"]);
  const full = Array.from({ length: 100 }, (_, index) => `u${String(index).padStart(3, "0")}`);
  assert.equal(nextStaffUids(full, "extra", false).length, 100);
  throwsHttps(() => nextStaffUids(full, "extra", true), "failed-precondition", /Troppe persone/);
  assert.deepEqual(staffUidsOf({ staffUids: ["a", 3, "", null, "b"] }), ["a", "b"]);
  assert.deepEqual(staffUidsOf({ staffUids: "a" }), []);
  assert.deepEqual(staffUidsOf(undefined), []);
});

test("persone: prima la propria, poi i figli; nome di battesimo o nome e cognome se omonimi", () => {
  const reg = (id, firstName, lastName) => ({ id, data: { firstName, lastName } });
  assert.deepEqual(buildPeople(reg("user_p1", "Paola", "Rossi"), [reg("child_p1_b", "Marco", "Rossi"), reg("child_p1_a", "Anna", "Rossi")]), [
    { registrationId: "user_p1", displayName: "Paola", isSelf: true },
    { registrationId: "child_p1_a", displayName: "Anna", isSelf: false },
    { registrationId: "child_p1_b", displayName: "Marco", isSelf: false },
  ]);
  // Omonimi (anche tra genitore e figlio): nome e cognome.
  assert.deepEqual(
    buildPeople(reg("user_p1", "Marco", "Rossi"), [reg("child_p1_a", "marco", "Rossi Jr"), reg("child_p1_b", "Anna", "Rossi")]).map((item) => item.displayName),
    ["Marco Rossi", "Anna", "marco Rossi Jr"], // figli in ordine di nome
  );
  // Solo figli, nessuna iscrizione propria; nome mancante = fullName.
  assert.deepEqual(buildPeople(null, [{ id: "child_p1_a", data: { fullName: "Luca Bianchi" } }]), [
    { registrationId: "child_p1_a", displayName: "Luca", isSelf: false },
  ]);
  assert.deepEqual(buildPeople(null, []), []);
});

test("nascondere ritira gli approvati; mostrare rimette solo chi può, il resto resta ritirato", () => {
  const iso = "t";
  const entries = [
    entry("a", "approved", { registrationId: "ra", recordId: "r1", createdAt: "1" }),
    entry("b", "approved", { registrationId: "rb", recordId: "r1", createdAt: "2" }),
    entry("c", "withdrawn", { registrationId: "rc", recordId: "r1", createdAt: "3", statusBeforeWithdraw: "approved" }), // ritirato da sé
    entry("d", "pending", { registrationId: "rd", recordId: null }),
  ];
  const hide = planHideRecord(entries, iso);
  assert.equal(hide.withdrawnCount, 2);
  assert.deepEqual(hide.patches.map((item) => item.id), ["a", "b"]);
  for (const { patch } of hide.patches) {
    assert.deepEqual(patch, { status: "withdrawn", statusBeforeWithdraw: null, withdrawnBy: "staff", withdrawnWithRecordHide: true, updatedAt: iso });
  }
  assert.equal(planHideRecord([], iso).withdrawnCount, 0);

  const hidden = [
    entry("a", "withdrawn", { registrationId: "ra", recordId: "r1", createdAt: "1", withdrawnWithRecordHide: true }),
    entry("b", "withdrawn", { registrationId: "rb", recordId: "r1", createdAt: "2", withdrawnWithRecordHide: true }),
    entry("e", "withdrawn", { registrationId: "re", recordId: "r1", createdAt: "3", withdrawnWithRecordHide: true }),
    entry("f", "withdrawn", { registrationId: "rf", recordId: "r1", createdAt: "4", withdrawnWithRecordHide: true }),
    entry("c", "withdrawn", { registrationId: "rc", recordId: "r1", createdAt: "5" }), // senza flag: non si tocca
  ];
  const other = (id, registrationId, status = "approved", recordId = "rX") => entry(id, status, { registrationId, recordId });
  const siblings = new Map([
    ["ra", [hidden[0]]],
    ["rb", [hidden[1], other("b1", "rb"), other("b2", "rb", "pending", null)]], // già a 2 tentativi
    ["re", [hidden[2]]], // iscrizione annullata nel frattempo
    ["rf", [hidden[3], other("f1", "rf", "approved", "r1")]], // già su questo record
  ]);
  const show = planShowRecord("r1", hidden, new Set(["ra", "rb", "rf"]), siblings, iso);
  assert.deepEqual(show.restores.map((item) => item.id), ["a"]);
  assert.deepEqual(show.restores[0].patch, { status: "approved", statusBeforeWithdraw: null, withdrawnBy: null, withdrawnWithRecordHide: false, updatedAt: iso });
  assert.deepEqual(show.skipped.map((item) => item.id), ["b", "e", "f"]);
  assert.deepEqual(show.skipped[0].patch, { withdrawnWithRecordHide: false, updatedAt: iso });
  assert.equal(show.approvedCount, 1);
});

test("contesto, parse: azioni nuove, chiavi esatte, registrationId opzionale", () => {
  const env = { stakeId: "s1", activityId: "a1" };
  assert.deepEqual(parseParticipantRequest({ ...env, action: "context" }).fields, {});
  throwsHttps(() => parseParticipantRequest({ ...env, action: "context", registrationId: "user_u1" }), "invalid-argument", /campi non ammessi/);
  assert.equal(parseParticipantRequest({ ...env, action: "propose", text: "x", measure: "other", registrationId: "child_p1_c1" }).fields.registrationId, "child_p1_c1");
  assert.equal(parseParticipantRequest({ ...env, action: "challenge", recordId: "r1" }).fields.registrationId, null);
  assert.equal(parseParticipantRequest({ ...env, action: "challenge", recordId: "r1", registrationId: "user_u1" }).fields.registrationId, "user_u1");
  throwsHttps(() => parseParticipantRequest({ ...env, action: "challenge", recordId: "r1", registrationId: "guest_u1" }), "invalid-argument", /senza account/);
  throwsHttps(() => parseParticipantRequest({ ...env, action: "propose", text: "x", measure: "other", registrationId: "a/b" }), "invalid-argument", /registrationId/);
  // edit, withdraw e restore restano su entryId.
  throwsHttps(() => parseParticipantRequest({ ...env, action: "withdraw", entryId: "e1", registrationId: "user_u1" }), "invalid-argument", /campi non ammessi/);
  throwsHttps(() => parseParticipantRequest({ ...env, action: "edit", entryId: "e1", text: "x", measure: "other", registrationId: "user_u1" }), "invalid-argument", /campi non ammessi/);
  assert.deepEqual(parseAdminRequest({ ...env, action: "listParticipants" }).fields, {});
  throwsHttps(() => parseAdminRequest({ ...env, action: "listParticipants", recordId: "r1" }), "invalid-argument", /campi non ammessi/);
});

test("genitore: propone e sfida per i figli, limite e unicità per iscrizione, il tentativo è suo", async () => {
  const w = world();
  const child = "child_p1_c1";
  const proposal = await w.p("p1", { ...proposeSalti, registrationId: child });
  assert.equal(proposal.entry.registrationId, child);
  assert.equal(proposal.entry.ownerUid, "p1");
  assert.equal(proposal.entry.participantName, "Luca Bianchi");
  assert.equal(proposal.entry.withdrawnBy, null);
  assert.equal(proposal.entry.withdrawnWithRecordHide, false);

  // Senza registrationId il genitore agisce per sé: non è iscritto.
  await rejectsHttps(w.p("p1", proposeSalti), "permission-denied", /serve l'iscrizione all'attività/);
  // Non per figli altrui, né per la user_ di un altro, né per un'iscrizione annullata o ospite.
  await rejectsHttps(w.p("p2", { ...proposeSalti, registrationId: child }), "permission-denied", /Non puoi agire/);
  await rejectsHttps(w.p("p1", { ...proposeSalti, registrationId: "user_u1" }), "permission-denied", /Non puoi agire/);
  await rejectsHttps(w.p("p1", { ...proposeSalti, registrationId: "guest_p1" }), "invalid-argument");
  w.db.seed(`${ACTIVITY}/registrations/child_p1_gone`, { firstName: "Ex", lastName: "Figlio", registrationStatus: "cancelled", parentUid: "p1" });
  await rejectsHttps(w.p("p1", { ...proposeSalti, registrationId: "child_p1_gone" }), "permission-denied", /serve l'iscrizione all'attività/);
  // Un'iscrizione child_<uid>_* il cui parentUid non combacia non si usa.
  w.db.seed(`${ACTIVITY}/registrations/child_p1_odd`, { firstName: "Strano", lastName: "Caso", registrationStatus: "active", parentUid: "someone" });
  await rejectsHttps(w.p("p1", { ...proposeSalti, registrationId: "child_p1_odd" }), "permission-denied", /Non puoi agire/);

  // Modifica, ritiro e annulla ritiro: sul tentativo, con ownerUid == uid.
  const edited = await w.p("p1", { action: "edit", entryId: proposal.entry.id, text: "Salti sul posto", measure: "count_streak" });
  assert.equal(edited.entry.proposedText, "Salti sul posto");
  await rejectsHttps(w.p("u1", { action: "withdraw", entryId: proposal.entry.id }), "not-found");
  await rejectsHttps(w.p("p2", { action: "edit", entryId: proposal.entry.id, text: "x", measure: "other" }), "not-found");
  const withdrawn = await w.p("p1", { action: "withdraw", entryId: proposal.entry.id });
  assert.equal(withdrawn.entry.withdrawnBy, "self");
  assert.equal(withdrawn.entry.statusBeforeWithdraw, "pending");
  const restored = await w.p("p1", { action: "restore", entryId: proposal.entry.id });
  assert.equal(restored.entry.status, "pending");
  assert.equal(restored.entry.withdrawnBy, null);

  // Sfida con il figlio; il limite (2) e l'unicità valgono per iscrizione, non per genitore.
  const approved = await w.a("admin1", approveSalti(proposal.entry.id));
  const other = await w.p("u1", { action: "propose", text: "Altro", measure: "other" });
  const recordTwo = (await w.a("admin1", { action: "approve", entryId: other.entry.id, title: "Altro", category: "mente", measure: "other" })).record;
  await rejectsHttps(w.p("p1", { action: "challenge", recordId: approved.record.id, registrationId: child }), "failed-precondition", /Già in gara/);
  const second = await w.p("p1", { action: "challenge", recordId: recordTwo.id, registrationId: child });
  assert.equal(second.entry.ownerUid, "p1");
  assert.equal(second.record.challengerCount, 2);
  // Il limite è della sola iscrizione del figlio: gli altri hanno i loro 2.
  await w.p("u2", { action: "challenge", recordId: approved.record.id });
  await rejectsHttps(w.p("p1", { action: "propose", text: "Terzo", measure: "other", registrationId: child }), "failed-precondition", /Limite di 2 record raggiunto/);
});

test("admin addParticipant su un child_: ownerUid è il genitore (campo parentUid o id)", async () => {
  const w = world();
  const proposal = (await w.p("u1", proposeSalti)).entry;
  const { record } = await w.a("admin1", approveSalti(proposal.id));
  const added = await w.a("admin1", { action: "addParticipant", recordId: record.id, registrationId: "child_p1_c1" });
  assert.equal(added.entry.ownerUid, "p1");
  w.db.seed(`${ACTIVITY}/registrations/child_p7_c9`, { firstName: "Noa", lastName: "Verdi", registrationStatus: "active" });
  const byId = await w.a("admin1", { action: "addParticipant", recordId: record.id, registrationId: "child_p7_c9" });
  assert.equal(byId.entry.ownerUid, "p7");
  // Il genitore lo gestisce: lo ritira e lo annulla.
  const out = await w.p("p1", { action: "withdraw", entryId: added.entry.id });
  assert.equal(out.record.challengerCount, 2);
  assert.equal((await w.p("p1", { action: "restore", entryId: added.entry.id })).record.challengerCount, 3);
});

test("staff: admin, dirigente di unità, uid in elenco; chi si dichiara accompagnatore o dirigente no", async () => {
  const input = { action: "createRecord", title: "Nuovo", category: "mente", measure: "other" };
  const w = world();
  await w.a("admin1", input);
  await w.a("super1", input);
  await w.a("leader1", input);
  assert.equal(w.records().length, 3);

  // Il ragazzo che nel profilo si è dichiarato accompagnatore (o dirigente) NON è staff,
  // anche con l'iscrizione attiva a questa attività.
  w.db.seed("users/dir1", { role: "participant", stakeId: "s1", genderRoleCategory: "dirigente" });
  w.db.seed(`${ACTIVITY}/registrations/user_dir1`, { firstName: "Dario", lastName: "Blu", registrationStatus: "confirmed", genderRoleCategory: "dirigente" });
  await rejectsHttps(w.a("acc1", input), "permission-denied", /permessi/);
  await rejectsHttps(w.a("dir1", input), "permission-denied", /permessi/);
  await rejectsHttps(w.a("acc1", { action: "listParticipants" }), "permission-denied", /permessi/);
  await rejectsHttps(w.a("acc1", { action: "updateRecord", recordId: "r1", title: "x", category: "mente", measure: "other", status: "hidden" }), "permission-denied");
  assert.equal(w.records().length, 3);

  // Solo l'admin lo mette in elenco: da quel momento è staff, e smette quando lo toglie.
  await w.a("admin1", { action: "setStaff", uid: "acc1", enabled: true });
  assert.equal((await w.a("acc1", input)).record.createdBy, "acc1");
  assert.equal((await w.a("acc1", { action: "listParticipants" })).participants.length, 6);
  await w.a("admin1", { action: "setStaff", uid: "acc1", enabled: false });
  await rejectsHttps(w.a("acc1", input), "permission-denied", /permessi/);

  // Non staff: ragazzo, genitore, dirigente di unità o admin di un altro palo, utente senza profilo
  // e non in elenco, anonimo (anche se in elenco).
  for (const uid of ["kid", "p1", "leader2", "ghost", "admin2", "dir1", "u1"]) {
    await rejectsHttps(w.a(uid, input), "permission-denied", /permessi/);
  }
  await w.a("admin1", { action: "setStaff", uid: "acc1", enabled: true });
  await rejectsHttps(w.a("acc1", input, "anonymous"), "permission-denied");
  assert.equal(w.records().length, 4); // i tre iniziali e quello creato da acc1 mentre era in elenco
});

test("context: persone, isStaff, anche dopo la chiusura; richiede il modulo acceso e un account personale", async () => {
  const w = world();
  w.db.seed(`${ACTIVITY}/registrations/child_p1_c2`, { firstName: "Anna", lastName: "Bianchi", registrationStatus: "active", parentUid: "p1" });
  w.db.seed(`${ACTIVITY}/registrations/child_p1_c3`, { firstName: "Gone", lastName: "Bianchi", registrationStatus: "cancelled", parentUid: "p1" });
  w.db.seed(`${ACTIVITY}/registrations/child_p2_c1`, { firstName: "Altrui", lastName: "Bianchi", registrationStatus: "active", parentUid: "p2" });

  const parent = await w.p("p1", { action: "context" });
  assert.equal(parent.ok, true);
  assert.equal(parent.action, "context");
  assert.deepEqual(parent.people, [
    { registrationId: "child_p1_c2", displayName: "Anna", isSelf: false },
    { registrationId: "child_p1_c1", displayName: "Luca", isSelf: false },
  ]);
  assert.equal(parent.isStaff, false);
  assert.equal("entry" in parent, false);

  // Ragazzo con propria iscrizione: la propria, nessun figlio. Il genitore che si iscrive va prima.
  const kid = await w.p("u1", { action: "context" });
  assert.deepEqual(kid.people, [{ registrationId: "user_u1", displayName: "Mario", isSelf: true }]);
  w.db.seed("users/p1", { role: "parent", stakeId: "s1" });
  w.db.seed(`${ACTIVITY}/registrations/user_p1`, { firstName: "Paola", lastName: "Bianchi", registrationStatus: "active" });
  const both = await w.p("p1", { action: "context" });
  assert.equal(both.people[0].registrationId, "user_p1");
  assert.equal(both.people[0].isSelf, true);
  assert.equal(both.people.length, 3);

  // Omonimi: nome e cognome.
  w.db.seed(`${ACTIVITY}/registrations/child_p1_c4`, { firstName: "Luca", lastName: "Verdi", registrationStatus: "active", parentUid: "p1" });
  const homonyms = (await w.p("p1", { action: "context" })).people.filter((item) => item.registrationId.endsWith("c1") || item.registrationId.endsWith("c4"));
  assert.deepEqual(homonyms.map((item) => item.displayName).sort(), ["Luca Bianchi", "Luca Verdi"]);

  // isStaff per i tre tipi; un amministratore non iscritto non ha persone.
  const admin = await w.p("admin1", { action: "context" });
  assert.deepEqual(admin, { ok: true, action: "context", people: [], isStaff: true, canManageStaff: true });
  assert.equal((await w.p("leader1", { action: "context" })).isStaff, true);
  const acc = await w.p("acc1", { action: "context" });
  assert.equal(acc.isStaff, false); // categoria dichiarata: non basta
  assert.equal(acc.canManageStaff, false);
  assert.equal(acc.people.length, 1);
  await w.a("admin1", { action: "setStaff", uid: "acc1", enabled: true });
  const listed = await w.p("acc1", { action: "context" });
  assert.deepEqual([listed.isStaff, listed.canManageStaff], [true, false]);
  assert.equal((await w.p("leader2", { action: "context" })).isStaff, false);
  assert.equal((await w.p("leader1", { action: "context" })).canManageStaff, false);
  assert.equal((await w.p("super1", { action: "context" })).canManageStaff, true);
  assert.equal((await w.p("admin2", { action: "context" })).isStaff, false);

  // Dopo la chiusura funziona; a modulo spento no; gli anonimi no.
  w.clock.now = "2026-10-16T20:00:00.000Z";
  assert.equal((await w.p("u1", { action: "context" })).people.length, 1);
  await rejectsHttps(w.p("u1", proposeSalti), "failed-precondition", /chiuse/);
  const off = world({ recordsEnabled: false });
  await rejectsHttps(off.p("u1", { action: "context" }), "failed-precondition", /non è attiva/);
  await rejectsHttps(w.p("u1", { action: "context" }, "anonymous"), "permission-denied");
  await rejectsHttps(w.p(null, { action: "context" }), "unauthenticated");
});

test("listParticipants: iscrizioni attive user_ e child_, solo quattro campi, solo staff", async () => {
  const w = world();
  w.db.seed(`${ACTIVITY}/registrations/guest_zz`, { firstName: "Ospite", lastName: "Zeta", registrationStatus: "active" });
  w.db.seed(`${ACTIVITY}/registrations/user_dir9`, { firstName: "Dora", lastName: "Verdi", registrationStatus: "active", genderRoleCategory: "dirigente", unitNameSnapshot: "Unità C", email: "x@y.it", phone: "1" });
  const result = await w.a("leader1", { action: "listParticipants" });
  assert.equal(result.ok, true);
  assert.equal(result.action, "listParticipants");
  assert.equal("entry" in result, false);
  const byId = Object.fromEntries(result.participants.map((item) => [item.registrationId, item]));
  assert.deepEqual(Object.keys(byId).sort(), ["child_p1_c1", "user_acc1", "user_dir9", "user_u1", "user_u2", "user_u3"]);
  assert.deepEqual(byId.child_p1_c1, { registrationId: "child_p1_c1", name: "Luca Bianchi", unitName: "Unità A", isAdult: false });
  assert.deepEqual(byId.user_dir9, { registrationId: "user_dir9", name: "Dora Verdi", unitName: "Unità C", isAdult: true });
  assert.deepEqual(byId.user_acc1, { registrationId: "user_acc1", name: "Elena Gialli", unitName: "Unità B", isAdult: true });
  assert.deepEqual(byId.user_u1, { registrationId: "user_u1", name: "Mario Rossi", unitName: "", isAdult: false });
  for (const item of result.participants) assert.deepEqual(Object.keys(item).sort(), ["isAdult", "name", "registrationId", "unitName"]);
  assert.deepEqual(result.participants.map((item) => item.name), [...result.participants.map((item) => item.name)].sort((a, b) => a.localeCompare(b, "it-IT")));

  assert.equal(w.db.collectionReads, 1); // fuori dalla transazione (il finto la rifiuta dentro)
  await w.a("admin1", { action: "setStaff", uid: "acc1", enabled: true });
  assert.equal((await w.a("acc1", { action: "listParticipants" })).participants.length, 6);
  await rejectsHttps(w.a("kid", { action: "listParticipants" }), "permission-denied");
  await rejectsHttps(world({ recordsEnabled: false }).a("admin1", { action: "listParticipants" }), "failed-precondition");
});

test("nascondi con iscritti: tentativi ritirati dallo staff, contatore a 0; rimostra rimette chi può", async () => {
  const w = world();
  const proposalOne = (await w.p("u1", proposeSalti)).entry;
  const { record } = await w.a("admin1", approveSalti(proposalOne.id));
  const rec = { recordId: record.id };
  const u2 = (await w.p("u2", { action: "challenge", ...rec })).entry;
  const child = (await w.p("p1", { action: "challenge", ...rec, registrationId: "child_p1_c1" })).entry;
  const u3 = (await w.p("u3", { action: "challenge", ...rec })).entry;
  await w.p("u3", { action: "withdraw", entryId: u3.id }); // ritirato da sé prima: non si tocca
  assert.equal(w.record(record.id).challengerCount, 3);
  const edit = { action: "updateRecord", recordId: record.id, title: record.title, category: "resistenza", measure: "count_in_time", durationSeconds: 60 };

  const hidden = await w.a("admin1", { ...edit, status: "hidden" });
  assert.equal(hidden.record.status, "hidden");
  assert.equal(hidden.record.challengerCount, 0);
  assert.equal(hidden.withdrawnCount, 3);
  for (const id of [proposalOne.id, u2.id, child.id]) {
    assert.equal(w.entry(id).status, "withdrawn");
    assert.equal(w.entry(id).withdrawnBy, "staff");
    assert.equal(w.entry(id).withdrawnWithRecordHide, true);
    assert.equal(w.entry(id).statusBeforeWithdraw, null);
    assert.equal(w.entry(id).recordId, record.id);
  }
  assert.equal(w.entry(u3.id).withdrawnBy, "self");
  assert.equal(w.entry(u3.id).withdrawnWithRecordHide, false);
  // Il ragazzo non può annullare: ha l'avviso dello staff, non un "Annulla".
  await rejectsHttps(w.p("u2", { action: "restore", entryId: u2.id }), "failed-precondition", /niente da ripristinare/);
  await rejectsHttps(w.p("u2", { action: "challenge", ...rec }), "failed-precondition", /non è più disponibile/);
  // Nascondere di nuovo è un no-op sui tentativi.
  assert.equal((await w.a("admin1", { ...edit, title: "Titolo nuovo", status: "hidden" })).withdrawnCount, 0);

  // Mentre è nascosto: u2 riempie i suoi 2 posti, l'iscrizione di Luca viene annullata.
  const x = (await w.p("u2", { action: "propose", text: "Uno", measure: "other" })).entry;
  const y = (await w.p("u2", { action: "propose", text: "Due", measure: "other" })).entry;
  w.db.docs.set(`${ACTIVITY}/registrations/child_p1_c1`, { ...w.db.read(`${ACTIVITY}/registrations/child_p1_c1`), registrationStatus: "cancelled" });

  const shown = await w.a("admin1", { ...edit, title: record.title, status: "open" });
  assert.equal(shown.record.status, "open");
  assert.equal(shown.restoredCount, 1); // solo chi ha creato il record
  assert.equal(shown.notRestoredCount, 2); // u2 (limite di 2) e il figlio (iscrizione annullata)
  assert.equal(shown.withdrawnCount, 0);
  assert.equal(shown.record.challengerCount, 1);
  assert.equal(w.record(record.id).challengerCount, 1);
  assert.equal(w.entry(proposalOne.id).status, "approved");
  assert.equal(w.entry(proposalOne.id).withdrawnBy, null);
  assert.equal(w.entry(proposalOne.id).withdrawnWithRecordHide, false);
  for (const id of [u2.id, child.id]) {
    assert.equal(w.entry(id).status, "withdrawn");
    assert.equal(w.entry(id).withdrawnBy, "staff");
    assert.equal(w.entry(id).withdrawnWithRecordHide, false); // decisione presa
  }
  assert.equal(w.entry(u3.id).status, "withdrawn"); // ritiro volontario: resta così
  assert.equal(w.entry(x.id).status, "pending");
  assert.equal(w.entry(y.id).status, "pending");

  // Ora u2 può rientrare da sé (record di nuovo visibile) solo liberando un posto.
  await rejectsHttps(w.p("u2", { action: "challenge", ...rec }), "failed-precondition", /Limite di 2 record raggiunto/);
  await w.p("u2", { action: "withdraw", entryId: x.id });
  assert.equal((await w.p("u2", { action: "challenge", ...rec })).record.challengerCount, 2);

  // Mostrare un record già aperto non tocca nulla.
  const again = await w.a("admin1", { ...edit, status: "open" });
  assert.deepEqual([again.restoredCount, again.notRestoredCount, again.withdrawnCount], [0, 0, 0]);
  assert.equal(again.record.challengerCount, 2);
});

test("rimostra rimette tutti quando c'è posto, contatore ricalcolato", async () => {
  const w = world();
  const first = (await w.p("u1", proposeSalti)).entry;
  const { record } = await w.a("admin1", approveSalti(first.id));
  await w.p("u2", { action: "challenge", recordId: record.id });
  await w.a("admin1", { action: "addParticipant", recordId: record.id, registrationId: "child_p1_c1" });
  const edit = { action: "updateRecord", recordId: record.id, title: record.title, category: "resistenza", measure: "count_in_time", durationSeconds: 60 };
  await w.a("admin1", { ...edit, status: "hidden" });
  w.db.docs.set(`${ACTIVITY}/records/${record.id}`, { ...w.record(record.id), challengerCount: 99 }); // contatore sporco
  const shown = await w.a("admin1", { ...edit, status: "open" });
  assert.deepEqual([shown.restoredCount, shown.notRestoredCount], [3, 0]);
  assert.equal(shown.record.challengerCount, 3);
  assert.equal(w.entriesOf().filter((item) => item.status === "approved").length, 3);
});

test("riporta in attesa: il record creato da quell'approvazione e rimasto vuoto si nasconde", async () => {
  const w = world();
  const proposal = (await w.p("u1", proposeSalti)).entry;
  const approved = await w.a("admin1", approveSalti(proposal.id));
  assert.equal(approved.record.createdFromEntryId, proposal.id);
  assert.equal(w.record(approved.record.id).createdFromEntryId, proposal.id);

  const reopened = await w.a("admin1", { action: "reopen", entryId: proposal.id });
  assert.equal(reopened.entry.status, "pending");
  assert.equal(reopened.record.challengerCount, 0);
  assert.equal(reopened.record.status, "hidden");
  assert.equal(w.record(approved.record.id).status, "hidden");

  // Una nuova approvazione crea un record nuovo; il vecchio resta nascosto e non si unisce.
  const second = await w.a("admin1", approveSalti(proposal.id));
  assert.notEqual(second.record.id, approved.record.id);
  assert.equal(w.records().filter((item) => item.status === "open").length, 1);
  await rejectsHttps(
    w.a("admin1", { action: "merge", entryId: (await w.p("u2", { action: "propose", text: "Altra", measure: "other" })).entry.id, recordId: approved.record.id }),
    "failed-precondition",
    /nascosto/,
  );

  // Con altri iscritti il record resta aperto.
  await w.p("u2", { action: "challenge", recordId: second.record.id });
  const kept = await w.a("admin1", { action: "reopen", entryId: proposal.id });
  assert.equal(kept.record.status, "open");
  assert.equal(kept.record.challengerCount, 1);

  // Un record creato a mano (o per un'altra proposta) non si nasconde.
  const w2 = world();
  const manual = (await w2.a("admin1", { action: "createRecord", title: "Manuale", category: "mente", measure: "other" })).record;
  const p2 = (await w2.p("u1", { action: "propose", text: "Idea", measure: "other" })).entry;
  await w2.a("admin1", { action: "merge", entryId: p2.id, recordId: manual.id });
  const back = await w2.a("admin1", { action: "reopen", entryId: p2.id });
  assert.equal(back.record.status, "open");
  assert.equal(back.record.challengerCount, 0);
});

test("annulla il ritiro verso in attesa non riapre una proposta identica già attiva", async () => {
  const w = world();
  const first = (await w.p("u1", proposeSalti)).entry;
  await w.p("u1", { action: "withdraw", entryId: first.id });
  const twin = await w.p("u1", proposeSalti); // la prima è ritirata: si può riproporre
  assert.equal(twin.entry.status, "pending");
  await rejectsHttps(w.p("u1", { action: "restore", entryId: first.id }), "failed-precondition", /^Questa proposta è già presente\.$/);
  assert.equal(w.entry(first.id).status, "withdrawn");
  // Se l'altra viene ritirata, l'annulla torna possibile.
  await w.p("u1", { action: "withdraw", entryId: twin.entry.id });
  assert.equal((await w.p("u1", { action: "restore", entryId: first.id })).entry.status, "pending");
});

test("chi ha ritirato: self, staff, system; azzerato quando torna attivo", async () => {
  const w = world();
  const a = (await w.p("u1", proposeSalti)).entry;
  const b = (await w.p("u1", { action: "propose", text: "Due", measure: "other" })).entry;
  assert.equal((await w.p("u1", { action: "withdraw", entryId: a.id })).entry.withdrawnBy, "self");
  assert.equal((await w.a("admin1", { action: "withdrawEntry", entryId: b.id })).entry.withdrawnBy, "staff");
  assert.equal((await w.p("u1", { action: "restore", entryId: a.id })).entry.withdrawnBy, null);
  const retired = await retireEntriesForRegistration(
    (w.db.docs.set(`${ACTIVITY}/registrations/user_u1`, { registrationStatus: "cancelled" }), w.db),
    { stakeId: "s1", activityId: "a1", registrationId: "user_u1" },
    () => new Date(NOW),
  );
  assert.deepEqual(retired, { retired: 1, staffRemoved: false });
  assert.equal(w.entry(a.id).withdrawnBy, "system");
  assert.equal(w.entry(a.id).withdrawnWithRecordHide, false);
});

test("messaggi rivolti al ragazzo: neutri rispetto al genere", async () => {
  const w = world();
  const seen = [];
  const collect = async (promise) => { try { await promise; } catch (error) { seen.push(error.message); } };
  await collect(w.p("nobody", proposeSalti));
  await collect(w.p("u1", proposeSalti, "anonymous"));
  await collect(w.p(null, proposeSalti));
  const rec = (await w.a("admin1", { action: "createRecord", title: "R", category: "mente", measure: "other" })).record;
  await w.a("admin1", { action: "addParticipant", recordId: rec.id, registrationId: "user_u1" });
  await collect(w.p("u1", { action: "challenge", recordId: rec.id }));
  await collect(w.p("u1", proposeSalti).then(() => w.p("u1", proposeSalti)));
  await collect(w.p("u1", { action: "propose", text: "Tre", measure: "other" }));
  await collect(w.p("u1", { action: "withdraw", entryId: "nope" }));
  await collect(w.p("u1", { action: "restore", entryId: "nope" }));
  w.clock.now = "2026-10-16T20:00:00.000Z";
  await collect(w.p("u1", proposeSalti));
  assert.ok(seen.length >= 7, seen.join(" | "));
  // Niente participi o aggettivi al maschile riferiti a chi scrive.
  const masculine = /\b(iscritto|stato|pronto|autorizzato|registrato|connesso|loggato|sicuro|solo)\b/iu;
  for (const message of seen) assert.doesNotMatch(message, masculine, message);
});

// ---------------------------------------------------------------------------
// Quarto giro: staff scelto dall'admin (listStaff, setStaff), trigger, pulizia
// ---------------------------------------------------------------------------

const STAFF_DOC = `${ACTIVITY}/management/recordNight`;

test("parse: listStaff senza campi, setStaff con uid e enabled booleano", () => {
  const env = { stakeId: "s1", activityId: "a1" };
  assert.deepEqual(parseAdminRequest({ ...env, action: "listStaff" }).fields, {});
  throwsHttps(() => parseAdminRequest({ ...env, action: "listStaff", uid: "u1" }), "invalid-argument", /campi non ammessi/);
  assert.deepEqual(parseAdminRequest({ ...env, action: "setStaff", uid: "u1", enabled: true }).fields, { uid: "u1", enabled: true });
  throwsHttps(() => parseAdminRequest({ ...env, action: "setStaff", uid: "u1" }), "invalid-argument", /enabled/);
  throwsHttps(() => parseAdminRequest({ ...env, action: "setStaff", uid: "u1", enabled: "true" }), "invalid-argument", /enabled/);
  throwsHttps(() => parseAdminRequest({ ...env, action: "setStaff", uid: "u1", enabled: 1 }), "invalid-argument", /enabled/);
  throwsHttps(() => parseAdminRequest({ ...env, action: "setStaff", enabled: true }), "invalid-argument", /uid/);
  throwsHttps(() => parseAdminRequest({ ...env, action: "setStaff", uid: "a/b", enabled: true }), "invalid-argument", /uid/);
  throwsHttps(() => parseAdminRequest({ ...env, action: "setStaff", uid: "u1", enabled: true, role: "admin" }), "invalid-argument", /campi non ammessi/);
  // Non sono azioni del partecipante.
  throwsHttps(() => parseParticipantRequest({ ...env, action: "setStaff", uid: "u1", enabled: true }), "invalid-argument", /Azione/);
});

test("setStaff: lo scelgono solo admin e super_admin, non dirigenti di unità né staff in elenco", async () => {
  const w = world();
  const set = (uid, target, enabled = true) => w.a(uid, { action: "setStaff", uid: target, enabled });

  const first = await set("admin1", "acc1");
  assert.deepEqual(first, { ok: true, action: "setStaff", staffUids: ["acc1"] });
  assert.deepEqual(w.db.read(STAFF_DOC), { staffUids: ["acc1"], updatedAt: NOW, updatedBy: "admin1" });
  assert.deepEqual((await set("super1", "u2")).staffUids, ["acc1", "u2"]); // ordinato, senza doppioni
  assert.deepEqual((await set("admin1", "u2")).staffUids, ["acc1", "u2"]); // già presente: invariato
  assert.equal(w.db.read(STAFF_DOC).updatedBy, "super1"); // nessuna scrittura inutile

  // Solo gli admin del palo: non il dirigente di unità, non chi è in elenco (nemmeno per sé stesso),
  // non un admin di un altro palo, non un ragazzo.
  for (const uid of ["leader1", "acc1", "admin2", "kid", "u3", "ghost"]) {
    await rejectsHttps(set(uid, "u3"), "permission-denied", /permessi|amministratori/);
  }
  await rejectsHttps(set("acc1", "acc1", false), "permission-denied", /amministratori/);
  await rejectsHttps(set("leader1", "u3"), "permission-denied", /amministratori/);
  await rejectsHttps(w.a("acc1", { action: "listStaff" }), "permission-denied", /amministratori/);
  await rejectsHttps(w.a("leader1", { action: "listStaff" }), "permission-denied", /amministratori/);
  assert.deepEqual(w.db.read(STAFF_DOC).staffUids, ["acc1", "u2"]);

  // Togliere: chi non c'è è un no-op; chi c'è perde subito l'accesso.
  assert.deepEqual((await set("admin1", "u3", false)).staffUids, ["acc1", "u2"]);
  assert.deepEqual((await set("admin1", "acc1", false)).staffUids, ["u2"]);
  await rejectsHttps(w.a("acc1", { action: "createRecord", title: "x", category: "mente", measure: "other" }), "permission-denied", /permessi/);

  // Modulo spento: nemmeno l'admin.
  await rejectsHttps(world({ recordsEnabled: false }).a("admin1", { action: "setStaff", uid: "acc1", enabled: true }), "failed-precondition", /non è attiva/);
});

test("setStaff: si abilita solo chi ha un'iscrizione user_ attiva a questa attività", async () => {
  const w = world();
  const set = (target, enabled = true) => w.a("admin1", { action: "setStaff", uid: target, enabled });
  w.db.seed(`${ACTIVITY}/registrations/user_rej`, { firstName: "Re", lastName: "Fiutato", registrationStatus: "rejected_by_parent" });
  w.db.seed("stakes/s1/activities/other/registrations/user_elsewhere", { firstName: "Altra", lastName: "Attività", registrationStatus: "active" });
  for (const target of ["nobody", "gone", "rej", "elsewhere", "p1" /* ha solo un child_ */]) {
    await rejectsHttps(set(target), "failed-precondition", /iscrizione attiva/);
  }
  assert.equal(w.db.read(STAFF_DOC), undefined); // niente documento se non è cambiato nulla
  assert.deepEqual((await set("u1")).staffUids, ["u1"]);
  // Togliere non richiede l'iscrizione: si pulisce anche chi non è più iscritto.
  w.db.docs.set(`${ACTIVITY}/registrations/user_u1`, { registrationStatus: "cancelled" });
  assert.deepEqual((await set("u1", false)).staffUids, []);
  // Un uid ammesso resta ammesso: il tetto dell'elenco lo ferma.
  w.db.seed(STAFF_DOC, { staffUids: Array.from({ length: 100 }, (_, index) => `x${String(index).padStart(3, "0")}`), updatedAt: NOW, updatedBy: "admin1" });
  await rejectsHttps(set("u2"), "failed-precondition", /Troppe persone/);
});

test("listStaff: iscrizioni user_ attive, adulti prima, con chi è già in elenco; il resto non esce", async () => {
  const w = world();
  w.db.seed(`${ACTIVITY}/registrations/user_dir9`, {
    firstName: "Dora", lastName: "Verdi", registrationStatus: "active", genderRoleCategory: "dirigente", unitNameSnapshot: "Unità C", email: "x@y.it", phone: "1",
  });
  w.db.seed(`${ACTIVITY}/registrations/guest_zz`, { firstName: "Ospite", lastName: "Zeta", registrationStatus: "active" });
  await w.a("admin1", { action: "setStaff", uid: "u2", enabled: true });
  const before = w.db.collectionReads;

  const result = await w.a("admin1", { action: "listStaff" });
  assert.equal(w.db.collectionReads - before, 1); // lettura fuori dalla transazione
  assert.equal(result.ok, true);
  assert.equal(result.action, "listStaff");
  assert.deepEqual(result.candidates.map((item) => item.uid), ["dir9", "acc1", "u2", "u3", "u1"]); // adulti per nome, poi gli altri
  for (const item of result.candidates) assert.deepEqual(Object.keys(item).sort(), ["isAdult", "isStaff", "name", "registrationId", "uid", "unitName"]);
  const byUid = Object.fromEntries(result.candidates.map((item) => [item.uid, item]));
  assert.deepEqual(byUid.acc1, { uid: "acc1", registrationId: "user_acc1", name: "Elena Gialli", unitName: "Unità B", isAdult: true, isStaff: false });
  assert.deepEqual(byUid.dir9, { uid: "dir9", registrationId: "user_dir9", name: "Dora Verdi", unitName: "Unità C", isAdult: true, isStaff: false });
  assert.deepEqual(byUid.u2, { uid: "u2", registrationId: "user_u2", name: "Anna Verdi", unitName: "", isAdult: false, isStaff: true });
  assert.equal(byUid.u1.isStaff, false);
  assert.equal(byUid.gone, undefined); // annullata
  assert.equal(JSON.stringify(result).includes("child_"), false); // nessun figlio
  assert.equal(JSON.stringify(result).includes("x@y.it"), false); // nessun dato in più

  assert.equal((await w.a("super1", { action: "listStaff" })).candidates.length, 5);
  await rejectsHttps(w.a("kid", { action: "listStaff" }), "permission-denied");
  await rejectsHttps(world({ recordsEnabled: false }).a("admin1", { action: "listStaff" }), "failed-precondition");
});

test("trigger: iscrizione annullata o cancellata toglie l'uid dallo staff, una volta sola", async () => {
  const w = world();
  await w.a("admin1", { action: "setStaff", uid: "acc1", enabled: true });
  await w.a("admin1", { action: "setStaff", uid: "u2", enabled: true });
  const clock = () => new Date("2026-10-13T08:00:00.000Z");
  const params = { stakeId: "s1", activityId: "a1" };

  // Iscrizione ancora attiva: nessun effetto.
  assert.deepEqual(await retireEntriesForRegistration(w.db, { ...params, registrationId: "user_acc1" }, clock), { retired: 0, staffRemoved: false });
  assert.deepEqual(w.db.read(STAFF_DOC).staffUids, ["acc1", "u2"]);

  // Annullata (anche senza tentativi): fuori dallo staff, gli altri restano.
  w.db.docs.set(`${ACTIVITY}/registrations/user_acc1`, { ...w.db.read(`${ACTIVITY}/registrations/user_acc1`), registrationStatus: "cancelled" });
  assert.deepEqual(await retireEntriesForRegistration(w.db, { ...params, registrationId: "user_acc1" }, clock), { retired: 0, staffRemoved: true });
  assert.deepEqual(w.db.read(STAFF_DOC), { staffUids: ["u2"], updatedAt: "2026-10-13T08:00:00.000Z", updatedBy: "system" });
  await rejectsHttps(w.a("acc1", { action: "listParticipants" }), "permission-denied");
  // Idempotente.
  assert.deepEqual(await retireEntriesForRegistration(w.db, { ...params, registrationId: "user_acc1" }, clock), { retired: 0, staffRemoved: false });

  // Cancellata del tutto, con un tentativo attivo: ritira il tentativo e toglie lo staff nella stessa transazione.
  const proposal = (await w.p("u2", proposeSalti)).entry;
  w.db.docs.delete(`${ACTIVITY}/registrations/user_u2`);
  assert.deepEqual(await retireEntriesForRegistration(w.db, { ...params, registrationId: "user_u2" }, clock), { retired: 1, staffRemoved: true });
  assert.equal(w.entry(proposal.id).status, "withdrawn");
  assert.deepEqual(w.db.read(STAFF_DOC).staffUids, []);

  // Un figlio (child_) non tocca l'elenco, e senza documento dello staff non succede niente.
  w.db.docs.set(`${ACTIVITY}/registrations/child_p1_c1`, { ...w.db.read(`${ACTIVITY}/registrations/child_p1_c1`), registrationStatus: "cancelled" });
  assert.deepEqual(await retireEntriesForRegistration(w.db, { ...params, registrationId: "child_p1_c1" }, clock), { retired: 0, staffRemoved: false });
  const bare = world();
  bare.db.docs.set(`${ACTIVITY}/registrations/user_u1`, { registrationStatus: "cancelled" });
  assert.deepEqual(await retireEntriesForRegistration(bare.db, { ...params, registrationId: "user_u1" }, clock), { retired: 0, staffRemoved: false });
  assert.equal(bare.db.read(STAFF_DOC), undefined);

  // Altro palo con gli stessi id: intatto.
  w.db.seed("stakes/s2/activities/a1/management/recordNight", { staffUids: ["acc1"], updatedAt: NOW, updatedBy: "x" });
  w.db.seed("stakes/s2/activities/a1/registrations/user_acc1", { registrationStatus: "cancelled" });
  await retireEntriesForRegistration(w.db, { ...params, registrationId: "user_acc1" }, clock);
  assert.deepEqual(w.db.read("stakes/s2/activities/a1/management/recordNight").staffUids, ["acc1"]);
});

test("cancellazione attività: sparisce anche l'elenco dello staff", async () => {
  const w = world();
  await w.a("admin1", { action: "setStaff", uid: "acc1", enabled: true });
  assert.equal(await cleanupDeletedActivity(w.db, { stakeId: "s1", activityId: "a1" }), false);
  assert.ok(w.db.read(STAFF_DOC)); // attività ancora presente: niente
  w.db.docs.delete(ACTIVITY);
  assert.equal(await cleanupDeletedActivity(w.db, { stakeId: "s1", activityId: "a1" }), true);
  assert.equal(w.db.read(STAFF_DOC), undefined);
  // Idempotente anche senza il documento.
  assert.equal(await cleanupDeletedActivity(w.db, { stakeId: "s1", activityId: "a1" }), true);
});

test("messaggi: nessuna seconda persona riferita a chi è iscritto (vale anche per il figlio)", async () => {
  const w = world();
  const seen = [];
  const collect = async (promise) => { try { await promise; } catch (error) { seen.push(error.message); } };
  const child = "child_p1_c1";
  await w.p("p1", { ...proposeSalti, registrationId: child });
  const second = (await w.p("p1", { action: "propose", text: "Due", measure: "other", registrationId: child })).entry;
  await collect(w.p("p1", { action: "propose", text: "Tre", measure: "other", registrationId: child }));
  await w.p("p1", { action: "withdraw", entryId: second.id });
  await collect(w.p("p1", { ...proposeSalti, registrationId: child }));
  const rec = (await w.a("admin1", { action: "createRecord", title: "R", category: "mente", measure: "other" })).record;
  await w.a("admin1", { action: "addParticipant", recordId: rec.id, registrationId: "user_u1" });
  await collect(w.p("u1", { action: "challenge", recordId: rec.id }));
  assert.deepEqual(seen, [
    "Limite di 2 record raggiunto: ritirane uno per sceglierne un altro.",
    "Questa proposta è già presente.",
    "Già in gara per questo record.",
  ]);
  for (const message of seen) assert.doesNotMatch(message, /\b(Hai|Sei|hai|sei)\b/u, message);
});

test("in elenco ma iscrizione annullata o sparita: non è più staff (server), anche se il trigger non è girato", async () => {
  const w = world();
  const input = { action: "createRecord", title: "Nuovo", category: "mente", measure: "other" };
  await w.a("admin1", { action: "setStaff", uid: "acc1", enabled: true });
  await w.a("admin1", { action: "setStaff", uid: "u2", enabled: true });
  await w.a("acc1", input); // in elenco e iscritta: gestisce
  assert.equal((await w.p("acc1", { action: "context" })).isStaff, true);

  // Il documento dello staff resta com'è (trigger non eseguito): cambia solo l'iscrizione.
  const registration = (id) => w.db.read(`${ACTIVITY}/registrations/${id}`);
  w.db.docs.set(`${ACTIVITY}/registrations/user_acc1`, { ...registration("user_acc1"), registrationStatus: "cancelled" });
  w.db.docs.set(`${ACTIVITY}/registrations/user_u2`, { ...registration("user_u2"), registrationStatus: "rejected_by_parent" });
  assert.deepEqual(w.db.read(STAFF_DOC).staffUids, ["acc1", "u2"]);

  for (const uid of ["acc1", "u2"]) {
    await rejectsHttps(w.a(uid, input), "permission-denied", /permessi/);
    await rejectsHttps(w.a(uid, { action: "listParticipants" }), "permission-denied", /permessi/);
    assert.equal((await w.p(uid, { action: "context" })).isStaff, false, uid);
  }
  assert.equal(w.records().length, 1); // solo quello creato quando era iscritta

  // Iscrizione sparita del tutto: stesso esito.
  w.db.docs.set(`${ACTIVITY}/registrations/user_acc1`, { firstName: "Elena", lastName: "Gialli", registrationStatus: "active" });
  await w.a("acc1", input);
  w.db.docs.delete(`${ACTIVITY}/registrations/user_acc1`);
  await rejectsHttps(w.a("acc1", input), "permission-denied", /permessi/);

  // Admin e dirigente di unità non dipendono dall'elenco né dall'iscrizione.
  await w.a("admin1", input);
  await w.a("leader1", input);
});

// Iscrizioni inserite da un admin, senza account: id `manual_<...>`.
test("manual_: nessun titolare, nessun utente agisce per loro, solo lo staff le iscrive", () => {
  const id = "manual_paolo_celestini_roma5";
  assert.equal(ownerUidFromRegistrationId(id), null);
  assert.equal(ownerUidFromRegistrationId(id, { parentUid: "p1" }), null, "un parentUid fuori posto non crea un titolare");
  assert.equal(ownerUidFromRegistrationId(id, { userId: "u1" }), null);
  throwsHttps(() => ownerUidFromRegistrationId("manual_"), "invalid-argument");
  throwsHttps(() => ownerUidFromRegistrationId("Manual_x"), "invalid-argument");
  // Nessun uid, nemmeno uno costruito apposta, può agire per una manual_.
  for (const uid of ["p1", "manual", "manual_paolo", "paolo_celestini_roma5", "user", "child"]) {
    assert.equal(canActForRegistration(uid, id), false, `uid ${uid}`);
  }
  assert.equal(canActForRegistration("p1", "user_p1"), true, "resta valido per la propria iscrizione");
  // Lo staff può iscriverle; gli ospiti e gli id strani no.
  const env = { stakeId: "s1", activityId: "a1" };
  assert.equal(parseAdminRequest({ ...env, action: "addParticipant", recordId: "r1", registrationId: id }).fields.registrationId, id);
  throwsHttps(() => parseAdminRequest({ ...env, action: "addParticipant", recordId: "r1", registrationId: "manual_" }), "invalid-argument", /registrationId/);
  throwsHttps(() => parseAdminRequest({ ...env, action: "addParticipant", recordId: "r1", registrationId: "manuale_x" }), "invalid-argument", /registrationId/);
  throwsHttps(() => parseAdminRequest({ ...env, action: "addParticipant", recordId: "r1", registrationId: "guest_x" }), "invalid-argument", /senza account/);
  // Il parsing della richiesta del partecipante non basta a farle agire: lo nega l'handler (canActForRegistration).
  assert.equal(parseParticipantRequest({ ...env, action: "challenge", recordId: "r1", registrationId: id }).fields.registrationId, id);
  // Il nome viene dai campi dell'iscrizione come per le altre.
  assert.equal(participantNameFromRegistration({ firstName: "Paolo", lastName: "Celestini" }), "Paolo Celestini");
  // Annullata: non è attiva.
  assert.equal(isRegistrationActive({ firstName: "Paolo", registrationStatus: "confirmed" }), true);
  assert.equal(isRegistrationActive({ firstName: "Paolo", registrationStatus: "cancelled" }), false);
});
