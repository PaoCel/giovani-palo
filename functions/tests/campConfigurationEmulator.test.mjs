// Independent acceptance checks from ATTIVITA_MODULARI: real callable, client
// identities and synthetic data. The one fault-injection case calls .run with
// real Firestore/Auth while failing a projection transaction after plan commit.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInAnonymously } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { getFirestore as getClientFirestore, connectFirestoreEmulator, doc, getDocFromServer, setDoc, updateDoc, terminate } from "firebase/firestore";

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
assert.match(projectId, /^demo-[a-z0-9-]+$/u, "Progetto demo-* obbligatorio");
function localHost(value, name) {
  assert.match(value || "", /^(localhost|127\.0\.0\.1):[1-9]\d{0,4}$/u, `${name}: emulatore locale obbligatorio`);
  const [host, port] = value.split(":");
  assert.ok(Number(port) <= 65535);
  return { host, port: Number(port), value };
}
const authHost = localHost(process.env.FIREBASE_AUTH_EMULATOR_HOST, "Auth");
const firestoreHost = localHost(process.env.FIRESTORE_EMULATOR_HOST, "Firestore");
const functionHost = localHost(process.env.CAMP_FUNCTIONS_HOST, "Functions");
// No Admin initialization before all three endpoint guards.
const require = createRequire(import.meta.url);
const { initializeApp: initializeAdminApp, deleteApp: deleteAdminApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth: getAdminAuth } = require("firebase-admin/auth");
const adminApp = initializeAdminApp({ projectId });
const db = getFirestore(adminApp);
const adminAuth = getAdminAuth(adminApp);
const runId = randomUUID().slice(0, 10);
const stakeId = `camp-contract-${runId}`;
const otherStakeId = `camp-other-${runId}`;
const committeeIds = ["logistics", "wellbeing", "kitchen", "games", "spiritual"];
const clients = {};
const apps = [];
let activitySequence = 0;

async function client(name, { role = "participant", stake = stakeId, anonymous = false } = {}) {
  const app = initializeApp({ apiKey: "demo-key", projectId }, `camp-${name}-${runId}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${authHost.value}`, { disableWarnings: true });
  if (anonymous) await signInAnonymously(auth);
  else await createUserWithEmailAndPassword(auth, `${name}-${runId}@example.invalid`, "camp-contract-test-only123");
  const uid = auth.currentUser.uid;
  const functions = getFunctions(app, "europe-west1");
  connectFunctionsEmulator(functions, functionHost.host, functionHost.port);
  const callable = httpsCallable(functions, "campManagementSave");
  const firestore = getClientFirestore(app);
  connectFirestoreEmulator(firestore, firestoreHost.host, firestoreHost.port);
  if (!anonymous) {
    await db.doc(`stakes/${stake}/members/${uid}`).set({ status: "active", staffRole: role === "participant" ? null : role });
    await db.doc(`users/${uid}`).set({ role, stakeId: stake, fullName: `Persona ${name}`, genderRoleCategory: "dirigente" });
  }
  return { uid, firestore, save: async (activityId, data) => (await callable({ stakeId, activityId, ...data })).data };
}
const committee = (plan, id = "logistics") => plan.committees.find(item => item.id === id);
function plan(memberIds = [], { groupLabel = "team", assignment = "logistics", title = "Comitato sintetico", responsibilities = "Prepara le attività" } = {}) {
  return {
    groupLabel,
    committees: committeeIds.map(id => ({ id, title: id === assignment ? title : `Comitato ${id}`, responsibilities: id === assignment ? responsibilities : "",
      leaderRegistrationIds: [], manualLeaderIds: [], memberRegistrationIds: id === assignment ? memberIds : [] })),
    patrols: [], manualLeaders: [],
  };
}
async function activity(count = 2) {
  const id = `activity-${++activitySequence}-${runId}`;
  const ref = db.doc(`stakes/${stakeId}/activities/${id}`);
  await ref.set({ title: "Campeggio sintetico", activityType: "camp", startDate: "2026-10-26", endDate: "2026-10-30" });
  const ids = Array.from({ length: count }, (_, index) => index === 0 ? `user_${clients.person.uid}` : `manual_synthetic_${index}`);
  for (let start = 0; start < ids.length; start += 400) {
    const batch = db.batch();
    ids.slice(start, start + 400).forEach((registrationId, index) => batch.set(ref.collection("registrations").doc(registrationId), {
      fullName: `Partecipante sintetico ${start + index}`, birthDate: "2009-01-01", genderRoleCategory: "giovane_uomo",
      registrationStatus: "confirmed", assignedCommittees: [], assignedPatrolId: null,
      answers: { medicalNote: "Sentinella: non modificare" }, createdAt: "2026-10-26T10:00:00.000Z",
    }));
    await batch.commit();
  }
  return { id, ref, ids, management: ref.collection("management").doc("camp") };
}
async function denied(promise, code) {
  await assert.rejects(promise, error => { assert.equal(error.code, `functions/${code}`); return true; });
}

before(async () => {
  await db.doc(`stakes/${stakeId}`).set({ name: "Palo sintetico camp" });
  await db.doc(`stakes/${otherStakeId}`).set({ name: "Altro palo sintetico camp" });
  clients.admin = await client("admin", { role: "admin" });
  clients.leader = await client("leader", { role: "unit_leader" });
  clients.person = await client("person");
  clients.listed = await client("listed");
  clients.outside = await client("outside", { role: "admin", stake: otherStakeId });
  clients.anonymous = await client("anonymous", { anonymous: true });
});
after(async () => {
  await db.recursiveDelete(db.doc(`stakes/${stakeId}`));
  await db.recursiveDelete(db.doc(`stakes/${otherStakeId}`));
  for (const value of Object.values(clients)) {
    await adminAuth.deleteUser(value.uid);
    await db.doc(`users/${value.uid}`).delete();
  }
  await Promise.all(Object.values(clients).map(value => terminate(value.firestore)));
  await Promise.all(apps.map(deleteApp));
  await deleteAdminApp(adminApp);
});

test("callable reale: crea configurazione, titolo e incarico, proietta senza modificare altri dati", async () => {
  const fixture = await activity();
  const result = await clients.admin.save(fixture.id, { plan: plan([fixture.ids[0]], { title: "  La sala  ", responsibilities: "  Prepara la sala  " }), expectedUpdatedAt: null });
  assert.equal(result.ok, true);
  assert.equal(result.plan.groupLabel, "team");
  assert.deepEqual(result.plan.committees.map(item => item.id).sort(), [...committeeIds].sort());
  assert.equal(committee(result.plan).title, "La sala");
  assert.equal(committee(result.plan).responsibilities, "Prepara la sala");
  assert.ok(Number.isFinite(Date.parse(result.plan.updatedAt)));
  const projection = (await fixture.ref.collection("registrations").doc(fixture.ids[0]).get()).data();
  assert.equal(projection.assignedCommittees[0].title, "La sala");
  assert.deepEqual(projection.answers, { medicalNote: "Sentinella: non modificare" });
  assert.equal(projection.createdAt, "2026-10-26T10:00:00.000Z");
});

test("legacy senza revisione o nuove opzioni conserva incarico e denominazione salvati", async () => {
  const fixture = await activity();
  const first = await clients.admin.save(fixture.id, { plan: plan([fixture.ids[0]], { groupLabel: "compagnia", responsibilities: "Prepara i materiali" }), expectedUpdatedAt: null });
  const legacy = await clients.admin.save(fixture.id, { plan: { committees: [{ id: "logistics", title: "Materiali aggiornati", leaderRegistrationIds: [], memberRegistrationIds: [fixture.ids[0]] }], patrols: [], manualLeaders: [] } });
  assert.equal(legacy.plan.groupLabel, "compagnia");
  assert.equal(committee(legacy.plan).responsibilities, "Prepara i materiali");
  assert.equal(committee(legacy.plan).title, "Materiali aggiornati");
  assert.ok(legacy.plan.updatedAt > first.plan.updatedAt);
  assert.equal(legacy.plan.committees.length, 5);
});

test("nuovo client: revisione obsoleta e null su piano esistente non scrivono", async () => {
  const fixture = await activity();
  const first = await clients.admin.save(fixture.id, { plan: plan(), expectedUpdatedAt: null });
  const second = await clients.admin.save(fixture.id, { plan: { groupLabel: "squadra" }, expectedUpdatedAt: first.plan.updatedAt });
  const before = (await fixture.management.get()).data();
  await denied(clients.admin.save(fixture.id, { plan: { groupLabel: "gruppo" }, expectedUpdatedAt: first.plan.updatedAt }), "aborted");
  await denied(clients.admin.save(fixture.id, { plan: { groupLabel: "gruppo" }, expectedUpdatedAt: null }), "aborted");
  assert.deepEqual((await fixture.management.get()).data(), before);
  assert.equal(second.plan.groupLabel, "squadra");
});

test("validazione server: payload e revisioni malformati non sostituiscono il piano", async () => {
  const fixture = await activity();
  const first = await clients.admin.save(fixture.id, { plan: plan(), expectedUpdatedAt: null });
  const before = (await fixture.management.get()).data();
  for (const input of [null, "plan", [], { groupLabel: "nuovo" }, { committees: "all" }, { committees: [{ id: "logistics", title: "T".repeat(81) }] }, { committees: [{ id: "logistics", responsibilities: "I".repeat(601) }] }]) {
    await denied(clients.admin.save(fixture.id, { plan: input, expectedUpdatedAt: first.plan.updatedAt }), "invalid-argument");
  }
  for (const expectedUpdatedAt of [42, {}, []]) await denied(clients.admin.save(fixture.id, { plan: {}, expectedUpdatedAt }), "invalid-argument");
  assert.deepEqual((await fixture.management.get()).data(), before);
});

test("incarico e guida di un comitato non concedono permessi di gestione", async () => {
  const fixture = await activity();
  const requested = plan();
  committee(requested).leaderRegistrationIds = [fixture.ids[0]];
  await clients.admin.save(fixture.id, { plan: requested, expectedUpdatedAt: null });
  const before = (await fixture.management.get()).data();
  await denied(clients.person.save(fixture.id, { plan: { groupLabel: "gruppo" }, expectedUpdatedAt: before.updatedAt }), "permission-denied");
  await denied(clients.outside.save(fixture.id, { plan: {}, expectedUpdatedAt: before.updatedAt }), "permission-denied");
  await denied(clients.anonymous.save(fixture.id, { plan: {}, expectedUpdatedAt: before.updatedAt }), "permission-denied");
  assert.deepEqual((await fixture.management.get()).data(), before);
});

test("dirigente e staff in elenco conservano accesso; la revoca viene riletta al save", async () => {
  const fixture = await activity();
  const registrationId = `user_${clients.listed.uid}`;
  await fixture.ref.collection("registrations").doc(registrationId).set({ fullName: "Staff sintetico", registrationStatus: "confirmed", birthDate: "1980-01-01", genderRoleCategory: "accompagnatore" });
  const list = fixture.ref.collection("management").doc("campStaff");
  await list.set({ staffUids: [clients.listed.uid] });
  const first = await clients.leader.save(fixture.id, { plan: plan(), expectedUpdatedAt: null });
  const second = await clients.listed.save(fixture.id, { plan: { groupLabel: "gruppo" }, expectedUpdatedAt: first.plan.updatedAt });
  assert.equal(second.ok, true);
  await list.update({ staffUids: [] });
  await denied(clients.listed.save(fixture.id, { plan: { groupLabel: "team" }, expectedUpdatedAt: second.plan.updatedAt }), "permission-denied");
  assert.equal((await fixture.management.get()).get("groupLabel"), "gruppo");
});

test("due editor con la stessa revisione: un solo vincitore, proiezioni coerenti con lui", async () => {
  const fixture = await activity();
  const first = await clients.admin.save(fixture.id, { plan: plan(), expectedUpdatedAt: null });
  const choices = [plan([fixture.ids[0]], { groupLabel: "compagnia", assignment: "kitchen" }), plan([fixture.ids[1]], { groupLabel: "squadra", assignment: "games" })];
  const results = await Promise.allSettled(choices.map(input => clients.admin.save(fixture.id, { plan: input, expectedUpdatedAt: first.plan.updatedAt })));
  assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  const rejected = results.find(item => item.status === "rejected");
  assert.equal(rejected.reason.code, "functions/aborted");
  const winner = results.find(item => item.status === "fulfilled").value.plan;
  assert.equal((await fixture.management.get()).get("updatedAt"), winner.updatedAt);
  const registrations = await fixture.ref.collection("registrations").get();
  for (const document of registrations.docs) {
    const expected = winner.committees.filter(item => item.memberRegistrationIds.includes(document.id)).map(item => item.id).sort();
    assert.deepEqual(document.get("assignedCommittees").map(item => item.id).sort(), expected);
  }
});

test("errore di proiezione dopo commit dichiara planSaved e lascia il piano recuperabile", async () => {
  const fixture = await activity();
  const { campManagementSave } = require("../lib/campManagement.js");
  const original = db.runTransaction;
  let injected = false;
  db.runTransaction = async function (...args) {
    const saved = await fixture.management.get();
    if (saved.exists && saved.get("groupLabel") === "team") {
      injected = true;
      throw Object.assign(new Error("qa-projection-failure"), { code: "qa-injected" });
    }
    return original.apply(this, args);
  };
  try {
    await assert.rejects(campManagementSave.run({ auth: { uid: clients.admin.uid, token: { firebase: { sign_in_provider: "password" } } }, data: { stakeId, activityId: fixture.id, plan: plan([fixture.ids[0]]), expectedUpdatedAt: null } }), error => {
      assert.equal(error.details?.planSaved, true);
      assert.equal(typeof error.details?.updatedAt, "string");
      return true;
    });
    assert.equal(injected, true, "deve fallire la fase successiva al piano, non la validazione");
    const saved = (await fixture.management.get()).data();
    assert.equal(saved.groupLabel, "team");
    assert.ok(saved.updatedAt);
  } finally { db.runTransaction = original; }
});

test("due salvataggi legacy su oltre 500 iscrizioni: nessuna proiezione vecchia ripristinata", { timeout: 120_000 }, async () => {
  const fixture = await activity(501);
  await clients.admin.save(fixture.id, { plan: plan(fixture.ids), expectedUpdatedAt: null });
  const choices = [plan(fixture.ids, { groupLabel: "compagnia", assignment: "kitchen" }), plan(fixture.ids, { groupLabel: "squadra", assignment: "games" })];
  const results = await Promise.allSettled(choices.map(input => clients.admin.save(fixture.id, { plan: input })));
  assert.ok(results.some(item => item.status === "fulfilled"));
  for (const item of results) if (item.status === "rejected") {
    assert.equal(item.reason.details?.planSaved, true);
    assert.equal(typeof item.reason.details?.updatedAt, "string");
  }
  const saved = (await fixture.management.get()).data();
  const registrations = await fixture.ref.collection("registrations").get();
  const assignment = saved.committees.find(item => item.memberRegistrationIds.length === 501);
  assert.ok(assignment, "un unico comitato vincitore contiene le 501 persone");
  for (const document of registrations.docs) {
    assert.deepEqual(document.get("assignedCommittees").map(item => item.id), [assignment.id]);
    assert.deepEqual(document.get("answers"), { medicalNote: "Sentinella: non modificare" });
  }
});

// Exact management/camp document operations through the authenticated client
// SDK: Admin seeds only the identities, activity and registrations above.
const clientPlanRef = (actor, fixture) => doc(actor.firestore, `stakes/${stakeId}/activities/${fixture.id}/management/camp`);
const directPlan = (groupLabel) => ({ ...plan(), groupLabel, updatedAt: "2026-10-26T12:00:00.000Z" });
async function rulesDenied(promise) {
  await assert.rejects(promise, error => { assert.equal(error.code, "permission-denied"); return true; });
}

for (const groupLabel of ["pattuglia", "gruppo", "compagnia", "team", "squadra"]) {
  test(`rules SDK: staff può creare e leggere il piano con groupLabel ${groupLabel}`, async () => {
    const fixture = await activity();
    const ref = clientPlanRef(clients.admin, fixture);
    await setDoc(ref, directPlan(groupLabel));
    assert.equal((await getDocFromServer(ref)).get("groupLabel"), groupLabel);
  });
}

test("rules SDK: documento legacy senza groupLabel resta scrivibile", async () => {
  const fixture = await activity();
  const { groupLabel: omitted, ...legacy } = directPlan("team");
  const ref = clientPlanRef(clients.admin, fixture);
  await setDoc(ref, legacy);
  assert.equal(Object.hasOwn((await getDocFromServer(ref)).data(), "groupLabel"), false);
});

test("rules SDK: update legacy conserva il nuovo campo già scritto dal server", async () => {
  const fixture = await activity();
  await fixture.management.set(directPlan("compagnia"));
  const ref = clientPlanRef(clients.admin, fixture);
  await updateDoc(ref, { updatedAt: "2026-10-26T12:00:01.000Z", patrols: [] });
  assert.equal((await getDocFromServer(ref)).get("groupLabel"), "compagnia");
});

for (const [name, groupLabel] of [["enum sconosciuto", "reparto"], ["null", null], ["numero", 1], ["oggetto", { value: "team" }]]) {
  test(`rules SDK: groupLabel ${name} viene rifiutato senza modifiche`, async () => {
    const fixture = await activity();
    await fixture.management.set(directPlan("team"));
    await rulesDenied(updateDoc(clientPlanRef(clients.admin, fixture), { groupLabel }));
    assert.equal((await fixture.management.get()).get("groupLabel"), "team");
  });
}

test("rules SDK: campo extra viene rifiutato dall'allowlist anche per staff", async () => {
  const fixture = await activity();
  await rulesDenied(setDoc(clientPlanRef(clients.admin, fixture), { ...directPlan("team"), unexpected: true }));
  assert.equal((await fixture.management.get()).exists, false);
});

test("rules SDK: il proprio iscritto legge groupLabel e incarico senza ottenere scrittura", async () => {
  const fixture = await activity();
  await fixture.management.set(directPlan("squadra"));
  const ref = clientPlanRef(clients.person, fixture);
  const saved = (await getDocFromServer(ref)).data();
  assert.equal(saved.groupLabel, "squadra");
  assert.equal(saved.committees[0].responsibilities, "Prepara le attività");
  await rulesDenied(updateDoc(ref, { groupLabel: "team" }));
});

test("rules SDK: admin di altro palo non legge né scrive il piano", async () => {
  const fixture = await activity();
  await fixture.management.set(directPlan("team"));
  const ref = clientPlanRef(clients.outside, fixture);
  await rulesDenied(getDocFromServer(ref));
  await rulesDenied(updateDoc(ref, { groupLabel: "gruppo" }));
});

test("rules SDK: identità anonima non scrive il piano", async () => {
  const fixture = await activity();
  await rulesDenied(setDoc(clientPlanRef(clients.anonymous, fixture), directPlan("team")));
});

test("rules SDK: dirigente del palo conserva la scrittura del piano", async () => {
  const fixture = await activity();
  const ref = clientPlanRef(clients.leader, fixture);
  await setDoc(ref, directPlan("gruppo"));
  assert.equal((await getDocFromServer(ref)).get("groupLabel"), "gruppo");
});

test("rules SDK: staff esplicito può scrivere fino alla revoca", async () => {
  const fixture = await activity();
  await fixture.ref.collection("registrations").doc(`user_${clients.listed.uid}`).set({ registrationStatus: "confirmed" });
  const staffRef = fixture.ref.collection("management").doc("campStaff");
  await staffRef.set({ staffUids: [clients.listed.uid] });
  const ref = clientPlanRef(clients.listed, fixture);
  await setDoc(ref, directPlan("team"));
  await staffRef.update({ staffUids: [] });
  await rulesDenied(updateDoc(ref, { groupLabel: "squadra" }));
  assert.equal((await fixture.management.get()).get("groupLabel"), "team");
});
