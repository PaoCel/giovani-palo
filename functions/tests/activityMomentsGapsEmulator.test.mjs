// Independent acceptance tests for the "programma a momenti" (gap/edge coverage).
// Companion to activityMomentsEmulator.test.mjs: it uses its OWN random stakeId so
// the two files never touch each other's data. Admin SDK is used ONLY to seed
// synthetic fixtures (bulk entries/receipts) and to delete identities/profiles;
// every business operation goes through the documented handlers
// (createMomentsAdminHandler, createMomentsParticipantHandler,
// reconcileMomentRegistration, cleanupMomentsForUser, cleanupDeletedMomentsActivity).
//
// No "DIFETTO SOSPETTO" note is needed: for every case below the code matches the
// spec. Case 3 deserves a word: the idempotent-retry shortcut in activityMoments.js
// is gated on `previous.updatedBy === uid`, so a *different* admin replaying the
// same requestId is not idempotent and falls through to the revision guard, which
// answers "aborted" without touching the document.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const projectId = process.env.GCLOUD_PROJECT || "";
assert.match(projectId, /^demo-[a-z0-9-]+$/u, "Serve un progetto demo-* esplicito");
for (const key of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"]) {
  assert.match(process.env[key] || "", /^127\.0\.0\.1:[1-9]\d{0,4}$/u, `${key}: solo emulatore loopback`);
  assert.ok(Number(process.env[key].split(":")[1]) <= 65535);
}
const require = createRequire(import.meta.url);
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const app = initializeApp({ projectId }, `qa-moments-gaps-${randomUUID()}`);
const db = getFirestore(app), auth = getAuth(app);
const { createMomentsAdminHandler, createMomentsParticipantHandler, reconcileMomentRegistration,
  cleanupMomentsForUser, cleanupDeletedMomentsActivity } = require("../lib/activityMoments.js");

const NOW = new Date("2030-01-01T12:00:00.000Z");
let currentTime = NOW;
const clock = () => new Date(currentTime);
const adminHandler = createMomentsAdminHandler({ db, clock });
const participantHandler = createMomentsParticipantHandler({ db, clock });

const runId = randomUUID().slice(0, 10);
const stakeId = `qa-moments-gaps-${runId}`;
const otherStakeId = `qa-moments-gaps-other-${runId}`;
const actors = {};
let sequence = 0;
const requestId = () => randomUUID();
const request = (actor, data) => ({ auth: actor ? { uid: actor.uid, token: { firebase: { sign_in_provider: actor.anonymous ? "anonymous" : "password" } } } : undefined, data: JSON.parse(JSON.stringify(data)) });
const admin = (actor, activityId, data, stake = stakeId) => adminHandler(request(actor, { stakeId: stake, activityId, ...data }));
const participate = (actor, activityId, data, stake = stakeId) => participantHandler(request(actor, { stakeId: stake, activityId, ...data }));
const fields = (extra = {}) => ({ type: "turni", title: "Momento sintetico", startsAt: "2030-01-04T15:00:00+01:00", capacity: 2, ...extra });

async function actor(name, role = "participant", stake = stakeId) {
  const user = await auth.createUser({ uid: `qa-momgap-${name}-${runId}`, email: `${name}-${runId}@example.invalid`, password: "qa-only-password-12345" });
  await db.doc(`users/${user.uid}`).set({ role, stakeId: stake, unitId: "qa-unit", fullName: `Persona sintetica ${name}`, genderRoleCategory: "dirigente" });
  return { uid: user.uid, role, stake, email: user.email };
}
async function activity({ stake = stakeId, status = "registrations_open" } = {}) {
  const id = `activity-${++sequence}-${runId}`;
  const ref = db.doc(`stakes/${stake}/activities/${id}`);
  await ref.set({ title: "Attività sintetica", activityType: "standard", isPublic: true, isVisible: true, status,
    startDate: "2030-01-04T00:00:00+01:00", endDate: "2030-01-05T23:00:00+01:00" });
  return { id, ref, moment: id => ref.collection("moments").doc(id) };
}
async function save(a, extra = {}, actor = actors.admin) {
  const payload = { action: "save", momentId: `moment-${randomUUID()}`, requestId: requestId(), expectedRevision: null, fields: fields(extra) };
  return { payload, ...(await admin(actor, a.id, payload)) };
}
async function denied(promise, codes) {
  await assert.rejects(promise, error => {
    assert.ok((Array.isArray(codes) ? codes : [codes]).includes(error.code), `codice inatteso: ${error.code}`);
    return true;
  });
}
async function enroll(a, who, extra = {}) {
  const id = extra.id || `user_${who.uid}`;
  const data = { userId: who.uid, firstName: "Persona", lastName: "Sintetica", fullName: `Persona sintetica ${who.uid.split("-")[2]}`,
    registrationStatus: "confirmed", answers: { medicalNote: "MEDICAL_PRIVATE_SENTINEL" }, ...extra };
  delete data.id;
  for (const key of Object.keys(data)) if (data[key] === undefined) delete data[key];
  await a.ref.collection("registrations").doc(id).set(data);
  return id;
}
async function enrollChild(a, parent, childId = "child-one", extra = {}) {
  const id = `child_${parent.uid}_${childId}`;
  await a.ref.collection("registrations").doc(id).set({ parentUid: parent.uid, firstName: "Figlio", lastName: "Sintetico", fullName: `Figlio sintetico ${childId}`, registrationStatus: "confirmed", ...extra });
  return id;
}
async function published(a, extra = {}) {
  const saved = await save(a, extra);
  return (await admin(actors.admin, a.id, { action: "publish", momentId: saved.moment.id, requestId: requestId(), expectedRevision: saved.moment.revision })).moment;
}
const join = (who, a, m, registrationId, extra = {}) => participate(who, a.id, { action: "join", momentId: m.id, registrationId, requestId: requestId(), expectedRevision: null, ...extra });
const withdraw = (who, a, m, registrationId, revision, extra = {}) => participate(who, a.id, { action: "withdraw", momentId: m.id, registrationId, requestId: requestId(), expectedRevision: revision, ...extra });
async function taken(a, m) { return (await a.moment(m.id).get()).data().slots[0].taken; }

before(async () => {
  await db.doc(`stakes/${stakeId}`).set({ name: "Palo sintetico indipendente (gaps)" });
  await db.doc(`stakes/${otherStakeId}`).set({ name: "Altro palo sintetico indipendente (gaps)" });
  for (const [name, role, stake] of [["admin", "admin", stakeId], ["admin2", "admin", stakeId], ["person", "participant", stakeId],
    ["person2", "participant", stakeId], ["parent", "participant", stakeId]]) {
    actors[name] = await actor(name, role, stake);
  }
});
after(async () => {
  await db.recursiveDelete(db.doc(`stakes/${stakeId}`));
  await db.recursiveDelete(db.doc(`stakes/${otherStakeId}`));
  for (const actor of Object.values(actors)) {
    await db.doc(`users/${actor.uid}`).delete();
    await auth.deleteUser(actor.uid).catch(error => { if (error.code !== "auth/user-not-found") throw error; });
  }
  await deleteApp(app);
});

test("show dopo hide conserva iscritti, taken e revisione senza perdere o duplicare posti", { timeout: 60_000 }, async () => {
  // Spec PROGRAMMA_PRIMO_INCREMENTO.md:93 "Nascosto | Rendi visibile senza perdere
  // dati o iscritti"; :125-128 la finestra/posizioni non si ricalcolano a vuoto.
  // Code activityMoments.js:313-332 show => status "published" senza toccare slots/entries.
  const a = await activity();
  const id = await enroll(a, actors.person), id2 = await enroll(a, actors.person2);
  const m = await published(a, { capacity: 2 });
  await join(actors.person, a, m, id);
  await join(actors.person2, a, m, id2);
  assert.equal(await taken(a, m), 2);
  const hidden = (await admin(actors.admin, a.id, { action: "hide", momentId: m.id, requestId: requestId(), expectedRevision: m.revision })).moment;
  assert.equal(hidden.status, "hidden");
  assert.equal(await taken(a, m), 2, "hide non deve toccare taken");
  // The participant still sees its own historical entries after hide (restricted).
  const duringHide = await participate(actors.person, a.id, { action: "context" });
  assert.equal(duringHide.moments.length, 1);
  assert.equal(duringHide.moments[0].restricted, true);
  assert.equal(duringHide.moments[0].entries.length, 1);
  const shown = (await admin(actors.admin, a.id, { action: "show", momentId: m.id, requestId: requestId(), expectedRevision: hidden.revision })).moment;
  assert.equal(shown.status, "published");
  assert.equal(shown.revision, hidden.revision + 1, "show incrementa la revisione di uno");
  assert.equal(await taken(a, m), 2, "nessun posto perso né duplicato");
  assert.equal((await a.moment(m.id).collection("entries").where("status", "==", "approved").get()).size, 2, "entrambi gli iscritti ancora approvati");
  const after = await participate(actors.person, a.id, { action: "context" });
  assert.equal(after.moments.length, 1);
  assert.equal(after.moments[0].restricted, false);
});

test("azione di stato su momento eliminato da un altro admin dà not-found senza ricreare il doc né riscrivere la receipt", { timeout: 60_000 }, async () => {
  // Spec PROGRAMMA_PRIMO_INCREMENTO.md:57-66 il fencing resta autorevole per tutta
  // la vita dell'attività; una create/azione non deve ricreare un ID cancellato.
  // Code activityMoments.js:229-244: per hide/publish/draft/show `deletion` non viene
  // nemmeno letto e `!snap.exists && action !== "save"` -> HttpsError("not-found").
  const a = await activity();
  const saved = await save(a);
  await admin(actors.admin2, a.id, { action: "delete", momentId: saved.moment.id, requestId: requestId(), expectedRevision: saved.moment.revision });
  assert.equal((await a.moment(saved.moment.id).get()).exists, false);
  const receiptRef = a.ref.collection("momentDeletions").doc(saved.moment.id);
  const before = (await receiptRef.get()).data();
  assert.deepEqual(Object.keys(before), ["deletedAt"], "receipt di cancellazione contiene solo deletedAt");
  for (const action of ["hide", "publish", "draft"]) {
    await denied(admin(actors.admin, a.id, { action, momentId: saved.moment.id, requestId: requestId(), expectedRevision: saved.moment.revision }), "not-found");
    assert.equal((await a.moment(saved.moment.id).get()).exists, false, `${action} non deve ricreare il documento`);
  }
  const receiptAfter = (await receiptRef.get()).data();
  assert.deepEqual(Object.keys(receiptAfter), ["deletedAt"]);
  assert.equal(receiptAfter.deletedAt.toMillis(), before.deletedAt.toMillis(), "nessuna riscrittura della receipt");
});

test("retry di save con lo stesso requestId da un admin diverso non modifica nulla", { timeout: 60_000 }, async () => {
  // Code activityMoments.js:245-262: il ritorno idempotente richiede
  // `previous.updatedBy === uid`; un admin diverso non entra nel ramo e cade su
  // assertRevision(previous, null) -> "aborted" (momentsCore.js:229-235 requestFingerprint
  // serve solo a impedire che lo stesso requestId cambi contenuto per lo stesso autore).
  const a = await activity();
  const saved = await save(a, {}, actors.admin);
  const original = (await a.moment(saved.moment.id).get()).data();
  assert.equal(original.updatedBy, actors.admin.uid);
  assert.equal(original.revision, 1);
  await denied(admin(actors.admin2, a.id, saved.payload), "aborted");
  const after = (await a.moment(saved.moment.id).get()).data();
  assert.equal(after.revision, original.revision, "revisione invariata");
  assert.equal(after.updatedBy, actors.admin.uid, "l'autore resta quello originale");
  assert.equal(after.lastRequestId, saved.payload.requestId, "lastRequestId non riscritto");
  assert.equal(after.title, original.title);
});

test("cancellazione attività rimuove momenti info/turni, entries e receipt momentDeletions", { timeout: 60_000 }, async () => {
  // Spec PROGRAMMA_PRIMO_INCREMENTO.md:101-105 "La cancellazione dell'attività elimina
  // anche momenti e sottocollezioni"; :70 il cleanup elimina anche le receipt a lotti.
  // Code activityMoments.js:772-812 cleanupDeletedMomentsActivity.
  const a = await activity();
  const info = await published(a, { type: "info", capacity: undefined });
  const turni = await published(a, { capacity: 2 });
  const id = await enroll(a, actors.person);
  await join(actors.person, a, turni, id);
  // A real receipt comes from deleting a draft moment, as in the admin flow.
  const tmp = await save(a);
  await admin(actors.admin, a.id, { action: "delete", momentId: tmp.moment.id, requestId: requestId(), expectedRevision: tmp.moment.revision });
  assert.equal((await a.ref.collection("momentDeletions").get()).size, 1);
  assert.equal((await a.moment(info.id).get()).exists, true);
  assert.equal((await a.moment(turni.id).get()).exists, true);
  assert.equal((await a.moment(turni.id).collection("entries").get()).size, 1);
  await a.ref.delete();
  await cleanupDeletedMomentsActivity(db, { stakeId, activityId: a.id });
  assert.equal((await a.ref.collection("moments").get()).size, 0, "tutti i momenti rimossi");
  assert.equal((await a.moment(turni.id).collection("entries").get()).size, 0, "entries rimosse");
  assert.equal((await a.moment(info.id).collection("entries").get()).size, 0);
  assert.equal((await a.ref.collection("momentDeletions").get()).size, 0, "receipt rimosse");
});

test("più di 200 receipt momentDeletions rimosse tutte a lotti dal cleanup attività", { timeout: 120_000 }, async () => {
  // Spec PROGRAMMA_PRIMO_INCREMENTO.md:70 "a lotti con controllo transazionale che
  // l'attività non sia ricreata"; Code activityMoments.js:800-810 il loop da 200 receipt.
  const a = await activity();
  const total = 250;
  for (let start = 0; start < total; start += 250) {
    const batch = db.batch();
    for (let index = start; index < Math.min(start + 250, total); index++) {
      batch.set(a.ref.collection("momentDeletions").doc(`seed-receipt-${index}`), { deletedAt: new Date() });
    }
    await batch.commit();
  }
  assert.equal((await a.ref.collection("momentDeletions").get()).size, total);
  await a.ref.delete();
  await cleanupDeletedMomentsActivity(db, { stakeId, activityId: a.id });
  assert.equal((await a.ref.collection("momentDeletions").get()).size, 0, "tutte le receipt rimosse in più lotti");
});

test("cleanup account rimuove oltre 200 entries su più momenti e due attività, riallinea taken e lascia intatte le entry altrui", { timeout: 120_000 }, async () => {
  // Spec PROGRAMMA_PRIMO_INCREMENTO.md:53-54 la query collection-group entries per
  // ownerUids; :103-105 la cancellazione account rimuove ownerUids e ritira le
  // adesioni pertinenti; :188-190 cleanup a lotti da 200 riprendibile.
  // Code activityMoments.js:701-718 (assertDeletedMomentIdentity) decide che l'utente è
  // cancellato SOLO se BOTH Auth identity AND profile doc are gone; :719-771 il cleanup.
  const who = await actor("bulk-cleanup"); actors.bulkCleanup = who;
  const a = await activity();
  const b = await activity({ stake: otherStakeId });
  const uidEntries = (count, prefix) => Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}`, ownerUids: [who.uid], status: "approved" }));
  async function seed(a, momentId, specs) {
    const approved = specs.filter((spec) => spec.status === "approved").length;
    const ref = a.moment(momentId);
    await ref.set({ type: "turni", title: `Seed ${momentId}`, startsAt: "2030-01-04T15:00:00+01:00", endsAt: "2030-01-04T16:00:00+01:00",
      audience: "registered", status: "published", revision: 1, updatedAt: NOW,
      slots: [{ id: "main", label: "main", capacity: 2000, taken: approved }],
      summary: { entryCount: approved, totalEntries: specs.length } });
    const batch = db.batch();
    for (const spec of specs) batch.set(ref.collection("entries").doc(spec.id), {
      registrationId: spec.id, ownerUids: spec.ownerUids, slotId: "main", status: spec.status, withdrawnReason: null, revision: 1, updatedAt: NOW,
    });
    await batch.commit();
  }
  // 250 uid-owned entries across three moments over two activities (>200 => two batches).
  await seed(a, "a-1", uidEntries(120, "a1"));
  await seed(a, "a-2", [...uidEntries(90, "a2"), { id: `other-${runId}`, ownerUids: [actors.person2.uid], status: "approved" }]);
  await seed(b, "b-1", uidEntries(40, "b1"));
  // Guard: while the identity still exists the cleanup must refuse and change nothing.
  const refused = await cleanupMomentsForUser(db, auth, who.uid);
  assert.equal(refused.skipped, "account_exists");
  await auth.deleteUser(who.uid);
  await db.doc(`users/${who.uid}`).delete();
  const result = await cleanupMomentsForUser(db, auth, who.uid);
  assert.equal(result.changed, 250, "tutte e 250 le entry proprie ritirate");
  assert.equal(await taken(a, { id: "a-1" }), 0);
  assert.equal(await taken(a, { id: "a-2" }), 1, "resta il solo posto di person2");
  assert.equal(await taken(b, { id: "b-1" }), 0);
  for (const [act, id] of [[a, "a-1"], [a, "a-2"], [b, "b-1"]]) {
    const remaining = await act.moment(id).collection("entries").where("ownerUids", "array-contains", who.uid).get();
    assert.equal(remaining.size, 0, `${id}: nessuna entry conserva ownerUids dell'utente`);
  }
  const other = (await a.moment("a-2").collection("entries").doc(`other-${runId}`).get()).data();
  assert.equal(other.status, "approved");
  assert.deepEqual(other.ownerUids, [actors.person2.uid], "entry di altro utente intatta");
});

test("genitore con due figli sullo stesso momento turni: un posto ciascuno, rinuncia indipendente, contesto li elenca entrambi", { timeout: 60_000 }, async () => {
  // Spec PROGRAMMA_PRIMO_INCREMENTO.md:75-83 il genitore agisce solo sui figli con
  // parentUid proprio; :152-156 il contesto elenca le persone (isSelf/eligible).
  // Code recordNight.js:542-563 buildPeople; activityMoments.js:353-385 readPeople.
  const a = await activity();
  const one = await enrollChild(a, actors.parent, "figlio-uno");
  const two = await enrollChild(a, actors.parent, "figlio-due");
  const m = await published(a, { capacity: 2 });
  const first = await join(actors.parent, a, m, one);
  await join(actors.parent, a, m, two);
  assert.equal(await taken(a, m), 2, "ogni figlio occupa un posto");
  const context = await participate(actors.parent, a.id, { action: "context" });
  assert.equal(context.people.length, 2);
  const listed = new Set(context.people.map((person) => person.registrationId));
  assert.ok(listed.has(one) && listed.has(two), "il contesto elenca entrambi i figli");
  for (const person of context.people) {
    assert.equal(person.isSelf, false);
    assert.equal(person.eligible, true);
  }
  assert.equal(context.moments[0].entries.length, 2, "entrambe le entry proprie nel contesto");
  await withdraw(actors.parent, a, m, one, first.entry.revision);
  assert.equal(await taken(a, m), 1, "la rinuncia di un figlio non tocca l'altro");
  assert.equal((await a.moment(m.id).collection("entries").doc(one).get()).get("status"), "withdrawn");
  assert.equal((await a.moment(m.id).collection("entries").doc(two).get()).get("status"), "approved");
});
