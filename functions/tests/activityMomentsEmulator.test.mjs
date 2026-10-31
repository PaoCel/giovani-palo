// Independent acceptance tests from PROGRAMMA_PRIMO_INCREMENTO.
// Admin seeds synthetic fixtures ONLY; operations use the documented handlers.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { initializeApp as initializeClientApp, deleteApp as deleteClientApp } from "firebase/app";
import { getAuth as getClientAuth, connectAuthEmulator, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore as getClientFirestore, connectFirestoreEmulator, doc, collection, query, where,
  getDocFromServer, getDocsFromServer, setDoc, updateDoc, deleteDoc, terminate } from "firebase/firestore";

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
const app = initializeApp({ projectId }, `qa-moments-independent-${randomUUID()}`);
const db = getFirestore(app), auth = getAuth(app);
const { createMomentsAdminHandler, createMomentsParticipantHandler, reconcileMomentRegistration,
  cleanupMomentsForUser, cleanupDeletedMomentsActivity } = require("../lib/activityMoments.js");
const NOW = new Date("2030-01-01T12:00:00.000Z");
let currentTime = NOW;
const clock = () => new Date(currentTime);
const adminHandler = createMomentsAdminHandler({ db, clock });
const participantHandler = createMomentsParticipantHandler({ db, clock });
const runId = randomUUID().slice(0, 10);
const stakeId = `qa-moments-independent-${runId}`;
const otherStakeId = `qa-moments-other-${runId}`;
const actors = {};
const sdkClients = [];
let sequence = 0;
const requestId = () => randomUUID();
const request = (actor, data) => ({ auth: actor ? { uid: actor.uid, token: { firebase: { sign_in_provider: actor.anonymous ? "anonymous" : "password" } } } : undefined, data: JSON.parse(JSON.stringify(data)) });
const admin = (actor, activityId, data, stake = stakeId) => adminHandler(request(actor, { stakeId: stake, activityId, ...data }));
const participate = (actor, activityId, data, stake = stakeId) => participantHandler(request(actor, { stakeId: stake, activityId, ...data }));
const fields = (extra = {}) => ({ type: "turni", title: "Momento sintetico", startsAt: "2030-01-04T15:00:00+01:00", capacity: 2, ...extra });
async function actor(name, role = "participant", stake = stakeId) {
  const user = await auth.createUser({ uid: `qa-moment-${name}-${runId}`, email: `${name}-${runId}@example.invalid`, password: "qa-only-password-12345" });
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
async function assertPrivate(value) { assert.doesNotMatch(JSON.stringify(value), /MEDICAL_PRIVATE_SENTINEL|medicalNote|answers/); }
before(async () => {
  await db.doc(`stakes/${stakeId}`).set({ name: "Palo sintetico indipendente" });
  await db.doc(`stakes/${otherStakeId}`).set({ name: "Altro palo sintetico indipendente" });
  for (const [name, role, stake] of [["admin", "admin", stakeId], ["admin2", "admin", stakeId], ["leader", "unit_leader", stakeId],
    ["person", "participant", stakeId], ["person2", "participant", stakeId], ["parent", "participant", stakeId],
    ["parent2", "participant", stakeId], ["outside", "admin", otherStakeId], ["super", "super_admin", otherStakeId]]) {
    actors[name] = await actor(name, role, stake);
  }
});
after(async () => {
  for (const client of sdkClients) { await terminate(client.firestore); await deleteClientApp(client.app); }
  await db.recursiveDelete(db.doc(`stakes/${stakeId}`));
  await db.recursiveDelete(db.doc(`stakes/${otherStakeId}`));
  for (const actor of Object.values(actors)) {
    await db.doc(`users/${actor.uid}`).delete();
    await auth.deleteUser(actor.uid).catch(error => { if (error.code !== "auth/user-not-found") throw error; });
  }
  await deleteApp(app);
});

test("timeout tardivo save→delete→retry non ricrea una bozza eliminata", async () => {
  const a = await activity();
  const created = await save(a, { type: "info", capacity: undefined });
  await admin(actors.admin2, a.id, { action: "delete", momentId: created.moment.id, requestId: requestId(), expectedRevision: created.moment.revision });
  assert.equal((await a.moment(created.moment.id).get()).exists, false);
  await admin(actors.admin, a.id, created.payload).catch(error => {
    assert.ok(["aborted", "failed-precondition", "not-found"].includes(error.code));
  });
  assert.equal((await a.moment(created.moment.id).get()).exists, false, "un retry vecchio non deve resuscitare la bozza");
});

for (const name of ["person", "leader", "outside"]) {
  test(`authoring negato al ruolo/palo ${name}`, async () => {
    const a = await activity();
    await denied(save(a, {}, actors[name]), "permission-denied");
    await denied(admin(actors[name], a.id, { action: "context" }), "permission-denied");
  });
}
test("super-admin esistente può gestire altro palo", async () => {
  const a = await activity();
  const result = await save(a, {}, actors.super);
  assert.equal(result.moment.status, "draft");
});
test("nessun account e account anonimo non accedono alle callable", async () => {
  const a = await activity();
  await denied(admin(null, a.id, { action: "context" }), "unauthenticated");
  await denied(participate(null, a.id, { action: "context" }), "unauthenticated");
  const anonymous = { ...actors.person, anonymous: true };
  // Anonymous has an Auth session, but not the non-anonymous account required.
  await denied(admin(anonymous, a.id, { action: "context" }), ["permission-denied", "unauthenticated"]);
  await denied(participate(anonymous, a.id, { action: "context" }), ["permission-denied", "unauthenticated"]);
});
test("profilo mancante nega anche un auth.uid valido", async () => {
  const a = await activity();
  await denied(admin({ uid: `missing-${runId}` }, a.id, { action: "context" }), ["permission-denied", "failed-precondition"]);
});
test("ruoli RecordNight e categoria dichiarata non danno authoring programma", async () => {
  const a = await activity();
  await a.ref.collection("management").doc("recordNight").set({ staffUids: [actors.person.uid] });
  await denied(save(a, {}, actors.person), "permission-denied");
});
test("bozza invisibile agli iscritti; pubblicazione info senza partecipazione", async () => {
  const a = await activity(); await enroll(a, actors.person);
  const saved = await save(a, { type: "info", capacity: undefined });
  assert.deepEqual((await participate(actors.person, a.id, { action: "context" })).moments, []);
  const result = await admin(actors.admin, a.id, { action: "publish", momentId: saved.moment.id, requestId: requestId(), expectedRevision: saved.moment.revision });
  assert.equal(result.moment.participation, null); assert.equal(result.moment.capacity, null);
  const context = await participate(actors.person, a.id, { action: "context" });
  assert.equal(context.moments.length, 1); assert.equal(context.moments[0].type, "info");
  assert.equal(context.moments[0].endsAt, context.moments[0].startsAt);
  await assertPrivate(context);
});
test("membro non iscritto non riceve il programma registered", async () => {
  const a = await activity(); await published(a);
  await db.doc(`stakes/${stakeId}/members/${actors.person.uid}`).set({ status: "active" });
  const result = await participate(actors.person, a.id, { action: "context" });
  assert.deepEqual(result.moments, []); assert.deepEqual(result.people, []);
});
test("tipo immutabile anche in bozza", async () => {
  const a = await activity(), saved = await save(a);
  await denied(admin(actors.admin, a.id, { ...saved.payload, requestId: requestId(), expectedRevision: saved.moment.revision, fields: fields({ type: "info", capacity: undefined }) }), "failed-precondition");
});
test("revisione admin difende due editor concorrenti e conserva il titolo vincente", async () => {
  const a = await activity(), saved = await save(a);
  const update = (who, title) => admin(who, a.id, { ...saved.payload, requestId: requestId(), expectedRevision: saved.moment.revision, fields: fields({ title }) });
  const results = await Promise.allSettled([update(actors.admin, "Editor A"), update(actors.admin2, "Editor B")]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.find(r => r.status === "rejected").reason.code, "aborted");
  assert.ok(["Editor A", "Editor B"].includes((await a.moment(saved.moment.id).get()).get("title")));
});
test("retry identico di save non modifica revisione né timestamp", async () => {
  const a = await activity(), saved = await save(a);
  const repeated = await admin(actors.admin, a.id, saved.payload);
  assert.equal(repeated.moment.revision, saved.moment.revision);
  assert.equal(repeated.moment.updatedAt, saved.moment.updatedAt);
});
test("capienza1: due iscritti concorrenti ottengono esattamente un posto", async () => {
  const a = await activity(); const ids = await Promise.all([enroll(a, actors.person), enroll(a, actors.person2)]);
  const m = await published(a, { capacity: 1 });
  const result = await Promise.allSettled([join(actors.person, a, m, ids[0]), join(actors.person2, a, m, ids[1])]);
  assert.equal(result.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(result.find(r => r.status === "rejected").reason.code, "resource-exhausted");
  assert.equal(await taken(a, m), 1);
  assert.equal((await a.moment(m.id).collection("entries").where("status", "==", "approved").get()).size, 1);
});
test("doppio tocco join stesso requestId resta un solo posto e una entry", async () => {
  const a = await activity(), id = await enroll(a, actors.person), m = await published(a);
  const payload = { requestId: requestId() };
  const result = await Promise.all([join(actors.person, a, m, id, payload), join(actors.person, a, m, id, payload)]);
  assert.equal(result[0].entry.revision, result[1].entry.revision);
  assert.equal(await taken(a, m), 1); assert.equal((await a.moment(m.id).collection("entries").get()).size, 1);
});
test("self non può iscrivere un altro partecipante né manipolare UID nel payload", async () => {
  const a = await activity(), otherId = await enroll(a, actors.person2), m = await published(a);
  await denied(join(actors.person, a, m, otherId), "permission-denied");
  const ownId = await enroll(a, actors.person);
  await denied(join(actors.person, a, m, ownId, { uid: actors.person2.uid }), "invalid-argument");
  assert.equal(await taken(a, m), 0);
});
test("genitore gestisce figli propri senza membership e non vede nomi altrui", async () => {
  const a = await activity(), id = await enrollChild(a, actors.parent), otherId = await enrollChild(a, actors.parent2);
  const m = await published(a);
  const context = await participate(actors.parent, a.id, { action: "context" });
  assert.equal(context.people.length, 1); assert.equal(context.people[0].registrationId, id);
  assert.equal(context.people[0].isSelf, false); assert.equal(context.people[0].eligible, true);
  await join(actors.parent, a, m, id);
  await denied(join(actors.parent, a, m, otherId), "permission-denied");
  await assertPrivate(context); assert.doesNotMatch(JSON.stringify(context), new RegExp(actors.parent2.uid));
});
test("parentUid contraffatto su childId altrui non concede ownership", async () => {
  const a = await activity();
  const id = await enrollChild(a, actors.parent2, "foreign", { parentUid: actors.parent.uid });
  const m = await published(a);
  await denied(join(actors.parent, a, m, id), "permission-denied");
  assert.equal(await taken(a, m), 0);
});
for (const registrationStatus of ["active", "confirmed", "pending_parent_authorization", undefined, null]) {
  test(`callable ammette iscrizione ${String(registrationStatus)}`, async () => {
    const a = await activity(), id = await enroll(a, actors.person, { registrationStatus }), m = await published(a);
    const result = await join(actors.person, a, m, id);
    assert.equal(result.entry.status, "approved"); assert.equal(await taken(a, m), 1);
  });
}
for (const registrationStatus of ["submitted", "waitlist", "draft", "cancelled", "rejected_by_parent", "unexpected", ""]) {
  test(`callable esclude iscrizione ${registrationStatus || "vuota"}`, async () => {
    const a = await activity(), id = await enroll(a, actors.person, { registrationStatus }), m = await published(a);
    await denied(join(actors.person, a, m, id), "failed-precondition");
    assert.equal(await taken(a, m), 0);
    const context = await participate(actors.person, a.id, { action: "context" });
    assert.equal(context.people[0].eligible, false); assert.deepEqual(context.moments, []);
  });
}
test("status cancelled prevale sul fallback legacy e sul confirmed esplicito", async () => {
  for (const registrationStatus of [null, "confirmed"]) {
    const a = await activity(), id = await enroll(a, actors.person, { registrationStatus, status: "cancelled" }), m = await published(a);
    await denied(join(actors.person, a, m, id), "failed-precondition"); assert.equal(await taken(a, m), 0);
  }
});
test("rinuncia, ripristino e vecchio timeout inverso non ritirano il nuovo posto", async () => {
  const a = await activity(), id = await enroll(a, actors.person), m = await published(a);
  const first = await join(actors.person, a, m, id);
  const oldRequest = { requestId: requestId() };
  const left = await withdraw(actors.person, a, m, id, first.entry.revision, oldRequest);
  assert.equal(left.entry.status, "withdrawn"); assert.equal(await taken(a, m), 0);
  const restored = await join(actors.person, a, m, id, { expectedRevision: left.entry.revision });
  assert.ok(restored.entry.revision > left.entry.revision);
  await denied(withdraw(actors.person, a, m, id, first.entry.revision, oldRequest), "aborted");
  assert.equal(await taken(a, m), 1); assert.equal((await a.moment(m.id).collection("entries").doc(id).get()).get("status"), "approved");
});
test("ripristino ricontrolla capienza occupata da un altro", async () => {
  const a = await activity(), id = await enroll(a, actors.person), otherId = await enroll(a, actors.person2), m = await published(a, { capacity: 1 });
  const first = await join(actors.person, a, m, id), left = await withdraw(actors.person, a, m, id, first.entry.revision);
  await join(actors.person2, a, m, otherId);
  await denied(join(actors.person, a, m, id, { expectedRevision: left.entry.revision }), "resource-exhausted");
  assert.equal(await taken(a, m), 1);
});
test("admin non può ridurre capienza sotto gli iscritti", async () => {
  const a = await activity(), m = await published(a), id = await enroll(a, actors.person), id2 = await enroll(a, actors.person2);
  await join(actors.person, a, m, id); await join(actors.person2, a, m, id2);
  const latest = (await admin(actors.admin, a.id, { action: "context" })).moments[0];
  await denied(admin(actors.admin, a.id, { action: "save", momentId: m.id, requestId: requestId(), expectedRevision: latest.revision, fields: fields({ capacity: 1 }) }), "failed-precondition");
  assert.equal(await taken(a, m), 2);
});

test("nascondi conserva storico proprio, rinuncia disponibile e nessuna nuova join", async () => {
  const a = await activity(), id = await enroll(a, actors.person), id2 = await enroll(a, actors.person2), m = await published(a);
  const joined = await join(actors.person, a, m, id);
  const latest = (await admin(actors.admin, a.id, { action: "context" })).moments[0];
  await admin(actors.admin, a.id, { action: "hide", momentId: m.id, requestId: requestId(), expectedRevision: latest.revision });
  await denied(join(actors.person2, a, m, id2), "failed-precondition");
  const context = await participate(actors.person, a.id, { action: "context" });
  assert.equal(context.moments.length, 1); assert.equal(context.moments[0].restricted, true);
  assert.equal(context.moments[0].entries[0].status, "approved");
  await withdraw(actors.person, a, m, id, joined.entry.revision);
  assert.equal(await taken(a, m), 0);
});
test("titoli modificati dopo hide non trapelano dalle proprie entry storiche", async () => {
  const a = await activity(), id = await enroll(a, actors.person), m = await published(a);
  await join(actors.person, a, m, id);
  const latest = (await admin(actors.admin, a.id, { action: "context" })).moments[0];
  const hidden = (await admin(actors.admin, a.id, { action: "hide", momentId: m.id, requestId: requestId(), expectedRevision: latest.revision })).moment;
  await admin(actors.admin, a.id, { action: "save", momentId: m.id, requestId: requestId(), expectedRevision: hidden.revision, fields: fields({ title: "PRIVATE_HIDDEN_NEW_TITLE" }) });
  const context = await participate(actors.person, a.id, { action: "context" });
  assert.doesNotMatch(JSON.stringify(context), /PRIVATE_HIDDEN_NEW_TITLE/);
  assert.match(JSON.stringify(context), /Momento sintetico/);
});
test("draft/delete negati anche dopo rinuncia: esiste storico entry", async () => {
  const a = await activity(), id = await enroll(a, actors.person), m = await published(a);
  const joined = await join(actors.person, a, m, id); await withdraw(actors.person, a, m, id, joined.entry.revision);
  for (const action of ["draft", "delete"]) {
    const latest = (await admin(actors.admin, a.id, { action: "context" })).moments[0];
    await denied(admin(actors.admin, a.id, { action, momentId: m.id, requestId: requestId(), expectedRevision: latest.revision }), "failed-precondition");
  }
});
test("roster solo admin, contiene soli approved e nessun dato sanitario", async () => {
  const a = await activity(), id = await enroll(a, actors.person), id2 = await enroll(a, actors.person2), m = await published(a);
  await join(actors.person, a, m, id);
  const second = await join(actors.person2, a, m, id2); await withdraw(actors.person2, a, m, id2, second.entry.revision);
  const roster = await admin(actors.admin, a.id, { action: "roster", momentId: m.id });
  assert.equal(roster.entries.length, 1); assert.equal(roster.entries[0].registrationId, id);
  assert.equal(roster.entries[0].status, "approved"); await assertPrivate(roster);
  await denied(admin(actors.person, a.id, { action: "roster", momentId: m.id }), "permission-denied");
  await denied(admin(actors.leader, a.id, { action: "roster", momentId: m.id }), "permission-denied");
});
for (const status of ["draft", "cancelled"]) test(`attività ${status} nega nuove adesioni e programma completo`, async () => {
  const a = await activity(), id = await enroll(a, actors.person), m = await published(a);
  await a.ref.update({ status });
  await denied(join(actors.person, a, m, id), "failed-precondition");
  assert.deepEqual((await participate(actors.person, a.id, { action: "context" })).moments, []);
});
test("finestra controllata dal server: chiusura esclusiva e ripristino negato dopo scadenza", async () => {
  const a = await activity(), id = await enroll(a, actors.person), m = await published(a, { customWindow: true, opensAt: "2030-01-01T12:00:00Z", closesAt: "2030-01-01T12:00:01Z" });
  const first = await join(actors.person, a, m, id), left = await withdraw(actors.person, a, m, id, first.entry.revision);
  currentTime = new Date("2030-01-01T12:00:01Z");
  try { await denied(join(actors.person, a, m, id, { expectedRevision: left.entry.revision }), "failed-precondition"); }
  finally { currentTime = NOW; }
  assert.equal(await taken(a, m), 0);
});
test("annullamento principale ritira una volta, duplicato trigger non cambia revisione", async () => {
  const a = await activity(), id = await enroll(a, actors.person), m = await published(a);
  const joined = await join(actors.person, a, m, id);
  await a.ref.collection("registrations").doc(id).update({ registrationStatus: "cancelled" });
  const ids = { stakeId, activityId: a.id, registrationId: id };
  await reconcileMomentRegistration(db, ids, clock);
  const entry = a.moment(m.id).collection("entries").doc(id);
  const first = (await entry.get()).data();
  assert.equal(first.status, "withdrawn"); assert.equal(first.withdrawnReason, "registration_inactive");
  assert.ok(first.revision > joined.entry.revision); assert.equal(await taken(a, m), 0);
  await reconcileMomentRegistration(db, ids, clock);
  assert.equal((await entry.get()).get("revision"), first.revision); assert.equal(await taken(a, m), 0);
});
test("ripristino principale non promette posto se nel frattempo è pieno", async () => {
  const a = await activity(), id = await enroll(a, actors.person), id2 = await enroll(a, actors.person2), m = await published(a, { capacity: 1 });
  await join(actors.person, a, m, id);
  const registration = a.ref.collection("registrations").doc(id), ids = { stakeId, activityId: a.id, registrationId: id };
  await registration.update({ registrationStatus: "cancelled" }); await reconcileMomentRegistration(db, ids, clock);
  await join(actors.person2, a, m, id2);
  await registration.update({ registrationStatus: "confirmed" }); await reconcileMomentRegistration(db, ids, clock);
  const entry = (await a.moment(m.id).collection("entries").doc(id).get()).data();
  assert.equal(entry.status, "withdrawn"); assert.equal(entry.restoreBlockedReason, "full"); assert.equal(await taken(a, m), 1);
});
test("cambio proprietario revoca entry precedente senza consegnarla al nuovo proprietario", async () => {
  const a = await activity(), id = await enrollChild(a, actors.parent), m = await published(a);
  await join(actors.parent, a, m, id);
  await a.ref.collection("registrations").doc(id).update({ parentUid: actors.parent2.uid });
  await reconcileMomentRegistration(db, { stakeId, activityId: a.id, registrationId: id }, clock);
  const entry = (await a.moment(m.id).collection("entries").doc(id).get()).data();
  assert.equal(entry.status, "withdrawn"); assert.equal(await taken(a, m), 0);
  assert.ok(!entry.ownerUids.includes(actors.parent.uid));
  assert.doesNotMatch(JSON.stringify(await participate(actors.parent2, a.id, { action: "context" })), new RegExp(actors.parent.uid));
});
test("account cleanup richiede assenza Auth e profilo, ritira solo le proprie entry", async () => {
  const disposable = await actor("cleanup"); actors.cleanup = disposable;
  const a = await activity(), id = await enroll(a, disposable), otherId = await enroll(a, actors.person2), m = await published(a);
  await join(disposable, a, m, id); await join(actors.person2, a, m, otherId);
  const pdf = a.ref.collection("registrations").doc(id).collection("private").doc("retained-pdf");
  await pdf.set({ path: "parent-consents/synthetic-retained.pdf", retentionMonths: 24 });
  await cleanupMomentsForUser(db, auth, disposable.uid).catch(error => assert.ok(["failed-precondition", "permission-denied"].includes(error.code)));
  assert.equal(await taken(a, m), 2);
  await auth.deleteUser(disposable.uid);
  await cleanupMomentsForUser(db, auth, disposable.uid).catch(error => assert.ok(["failed-precondition", "permission-denied"].includes(error.code)));
  assert.equal(await taken(a, m), 2);
  await db.doc(`users/${disposable.uid}`).delete();
  await cleanupMomentsForUser(db, auth, disposable.uid);
  const ref = a.moment(m.id).collection("entries").doc(id), data = (await ref.get()).data();
  assert.equal(data.status, "withdrawn"); assert.equal(data.withdrawnReason, "account_deleted"); assert.ok(!data.ownerUids.includes(disposable.uid));
  assert.equal(await taken(a, m), 1); assert.equal((await a.moment(m.id).collection("entries").doc(otherId).get()).get("status"), "approved");
  assert.ok((await pdf.get()).exists); assert.ok((await a.ref.collection("registrations").doc(id).get()).exists);
  const revision = data.revision; await cleanupMomentsForUser(db, auth, disposable.uid); assert.equal((await ref.get()).get("revision"), revision);
  await denied(join(disposable, a, m, id, { expectedRevision: data.revision }), ["permission-denied", "failed-precondition"]);
});
test("cleanup attività assente include orfani e receipt, non agisce su attività ricreata", async () => {
  const a = await activity(), m = await published(a), id = await enroll(a, actors.person);
  await join(actors.person, a, m, id);
  await a.ref.collection("moments").doc("orphan").collection("entries").doc("orphan-entry").set({ ownerUids: [actors.person.uid], status: "withdrawn" });
  await a.ref.collection("momentDeletions").doc("deleted-receipt").set({ deletedAt: new Date() });
  await cleanupDeletedMomentsActivity(db, { stakeId, activityId: a.id });
  assert.ok((await a.moment(m.id).get()).exists);
  await a.ref.delete(); await cleanupDeletedMomentsActivity(db, { stakeId, activityId: a.id });
  assert.equal((await a.ref.collection("moments").get()).size, 0);
  assert.equal((await a.ref.collection("moments").doc("orphan").collection("entries").get()).size, 0);
  assert.equal((await a.ref.collection("momentDeletions").get()).size, 0);
  assert.ok((await a.ref.collection("registrations").doc(id).get()).exists, "cleanup modulo non cancella iscrizioni/PDF");
});

async function sdk(who) {
  const app = initializeClientApp({ apiKey: "demo-key", projectId }, `moments-sdk-${who.uid}-${randomUUID()}`);
  const clientAuth = getClientAuth(app); connectAuthEmulator(clientAuth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  await signInWithEmailAndPassword(clientAuth, who.email, "qa-only-password-12345");
  const firestore = getClientFirestore(app), [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(":");
  connectFirestoreEmulator(firestore, host, Number(port));
  const result = { app, firestore }; sdkClients.push(result); return result;
}
for (const name of ["admin", "super", "person", "parent", "outside"]) test(`SDK ${name}: nessun get/list/write moments, entries o receipt`, async () => {
  const a = await activity(), id = await enroll(a, actors.person), m = await published(a); await join(actors.person, a, m, id);
  await a.ref.collection("momentDeletions").doc("existing-receipt").set({ deletedAt: new Date() });
  const client = await sdk(actors[name]), prefix = `${a.ref.path}/moments/${m.id}`;
  for (const target of [prefix, `${prefix}/entries/${id}`, `${a.ref.path}/momentDeletions/absent`, `${a.ref.path}/momentDeletions/existing-receipt`]) {
    const ref = doc(client.firestore, target);
    for (const action of [() => getDocFromServer(ref), () => setDoc(ref, { forbidden: true }), () => updateDoc(ref, { forbidden: true }), () => deleteDoc(ref)]) {
      await denied(action(), "permission-denied");
    }
  }
  for (const target of [`${a.ref.path}/moments`, `${prefix}/entries`, `${a.ref.path}/momentDeletions`]) await denied(getDocsFromServer(collection(client.firestore, target)), "permission-denied");
  await denied(getDocsFromServer(query(collection(client.firestore, `${prefix}/entries`), where("ownerUids", "array-contains", actors[name].uid))), "permission-denied");
});

test("delete assente crea fence; retry delete non riscrive la receipt", async () => {
  const a = await activity(), momentId = `never-created-${randomUUID()}`;
  const payload = { action: "delete", momentId, requestId: requestId(), expectedRevision: null };
  assert.equal((await admin(actors.admin, a.id, payload)).deleted, true);
  const receiptRef = a.ref.collection("momentDeletions").doc(momentId), receipt = (await receiptRef.get()).data();
  assert.deepEqual(Object.keys(receipt), ["deletedAt"]); assert.ok(receipt.deletedAt.toMillis() > 0);
  assert.equal((await admin(actors.admin, a.id, payload)).deleted, true);
  assert.equal((await receiptRef.get()).get("deletedAt").toMillis(), receipt.deletedAt.toMillis());
  await assert.rejects(admin(actors.admin, a.id, { action: "save", momentId, requestId: requestId(), expectedRevision: null, fields: fields() }), error => {
    assert.equal(error.code, "failed-precondition"); assert.equal(error.details?.reason, "moment_deleted"); return true;
  });
  assert.equal((await a.moment(momentId).get()).exists, false);
});
test("receipt resta autorevole anche se un doc cancellato viene ricreato da manutenzione", async () => {
  const a = await activity(), saved = await save(a);
  const original = (await a.moment(saved.moment.id).get()).data();
  await admin(actors.admin, a.id, { action: "delete", momentId: saved.moment.id, requestId: requestId(), expectedRevision: saved.moment.revision });
  await a.moment(saved.moment.id).set(original);
  await assert.rejects(admin(actors.admin, a.id, saved.payload), error => {
    assert.equal(error.code, "failed-precondition"); assert.equal(error.details?.reason, "moment_deleted"); return true;
  });
});
test("limite50 momenti: la cinquantunesima creazione è atomica e negata", async () => {
  const a = await activity(), saved = await save(a);
  const canonical = (await a.moment(saved.moment.id).get()).data();
  const batch = db.batch(); for (let index = 1; index < 50; index++) batch.set(a.moment(`seed-${index}`), canonical); await batch.commit();
  await denied(save(a), "resource-exhausted");
  assert.equal((await a.ref.collection("moments").get()).size, 50);
});
test("più di100 figli non scaricano un contesto parziale silenzioso", async () => {
  const a = await activity(); const batch = db.batch();
  for (let index = 0; index < 101; index++) batch.set(a.ref.collection("registrations").doc(`child_${actors.parent.uid}_limit-${index}`), { parentUid: actors.parent.uid, fullName: `Figlio ${index}`, registrationStatus: "confirmed" });
  await batch.commit(); await published(a);
  await denied(participate(actors.parent, a.id, { action: "context" }), "resource-exhausted");
});
test("revoca ruolo prima della transazione nega un vecchio invio admin", async () => {
  const revoked = await actor("revoked", "admin"); actors.revoked = revoked;
  const a = await activity();
  const proxy = new Proxy(db, { get(target, property) {
    if (property === "runTransaction") return async (work, options) => {
      await db.doc(`users/${revoked.uid}`).update({ role: "participant" });
      return target.runTransaction(work, options);
    };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  const delayed = createMomentsAdminHandler({ db: proxy, clock });
  await denied(delayed(request(revoked, { action: "save", stakeId, activityId: a.id, momentId: `revoked-${randomUUID()}`, requestId: requestId(), expectedRevision: null, fields: fields() })), "permission-denied");
  assert.equal((await a.ref.collection("moments").get()).size, 0);
});
test("cleanup account su due pali riprende dopo un errore parziale ed esclude altre entries", async () => {
  const who = await actor("partial-cleanup"); actors.partialCleanup = who;
  const a = await activity(), b = await activity({ stake: otherStakeId });
  const id = await enroll(a, who), m = await published(a); await join(who, a, m, id);
  const canonical = (await a.moment(m.id).get()).data(), entry = (await a.moment(m.id).collection("entries").doc(id).get()).data();
  await b.moment(m.id).set(canonical); await b.moment(m.id).collection("entries").doc(id).set(entry);
  const foreign = a.ref.collection("records").doc("other-module").collection("entries").doc("keep");
  await foreign.set({ ownerUids: [who.uid], status: "approved", sentinel: true });
  await auth.deleteUser(who.uid); await db.doc(`users/${who.uid}`).delete();
  let transactions = 0;
  const proxy = new Proxy(db, { get(target, property) {
    if (property === "runTransaction") return async (work, options) => {
      if (++transactions === 2) throw new Error("qa-partial-cleanup-interruption");
      return target.runTransaction(work, options);
    };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  await assert.rejects(cleanupMomentsForUser(proxy, auth, who.uid), /qa-partial-cleanup-interruption/);
  assert.equal(await taken(a, m) + await taken(b, m), 1, "una sola unità completata prima dell'errore");
  await cleanupMomentsForUser(db, auth, who.uid); assert.equal(await taken(a, m) + await taken(b, m), 0);
  for (const activity of [a, b]) {
    const data = (await activity.moment(m.id).collection("entries").doc(id).get()).data();
    assert.equal(data.status, "withdrawn"); assert.ok(!data.ownerUids.includes(who.uid));
  }
  assert.deepEqual((await foreign.get()).data(), { ownerUids: [who.uid], status: "approved", sentinel: true });
});
test("cleanup attività attraversa più lotti da200 senza lasciare orfani", async () => {
  const a = await activity();
  for (let start = 0; start < 401; start += 200) {
    const batch = db.batch();
    for (let index = start; index < Math.min(start + 200, 401); index++) batch.set(a.moment("orphan-batch").collection("entries").doc(`entry-${index}`), { status: "withdrawn", ownerUids: [actors.person.uid] });
    await batch.commit();
  }
  await a.ref.delete(); await cleanupDeletedMomentsActivity(db, { stakeId, activityId: a.id });
  assert.equal((await a.moment("orphan-batch").collection("entries").get()).size, 0);
  await cleanupDeletedMomentsActivity(db, { stakeId, activityId: a.id });
  assert.equal((await a.ref.collection("moments").listDocuments()).length, 0);
});
