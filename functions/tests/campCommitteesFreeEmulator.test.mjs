// Quarto incremento di docs/ATTIVITA_MODULARI.md: comitati e gruppi liberi.
// Callable reali (campManagementSave, campManagementStaff `roster`), rules reali
// e identità client vere dell'Auth Emulator. L'Admin SDK serve solo a seminare i
// dati e a verificare l'esito; la prova di revoca chiama il handler in-process
// con Firestore vero e cambia i permessi tra controllo iniziale e transazione.
//
// Lancio (porte e progetto demo a scelta):
//   firebase emulators:exec --only auth,firestore,functions --project demo-xxx \
//     --config <config> "CAMP_FUNCTIONS_HOST=127.0.0.1:<porta functions> \
//     node --test functions/tests/campCommitteesFreeEmulator.test.mjs"
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInAnonymously } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import {
  getFirestore as getClientFirestore,
  connectFirestoreEmulator,
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  terminate,
} from "firebase/firestore";

// Guardie sugli host PRIMA di inizializzare l'Admin SDK.
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
assert.match(projectId, /^demo-[a-z0-9-]+$/u, "Progetto demo-* obbligatorio");
function localHost(value, name) {
  assert.match(value || "", /^(localhost|127\.0\.0\.1):[1-9]\d{0,4}$/u, `${name}: emulatore locale obbligatorio`);
  const [host, port] = value.split(":");
  assert.ok(Number(port) <= 65535, `${name}: porta non valida`);
  return { host, port: Number(port), value };
}
const authHost = localHost(process.env.FIREBASE_AUTH_EMULATOR_HOST, "Auth");
const firestoreHost = localHost(process.env.FIRESTORE_EMULATOR_HOST, "Firestore");
const functionHost = localHost(process.env.CAMP_FUNCTIONS_HOST, "Functions");

const require = createRequire(import.meta.url);
const { initializeApp: initializeAdminApp, deleteApp: deleteAdminApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth: getAdminAuth } = require("firebase-admin/auth");
const adminApp = initializeAdminApp({ projectId });
const db = getFirestore(adminApp);
const adminAuth = getAdminAuth(adminApp);

const runId = randomUUID().replace(/-/gu, "").slice(0, 10);
const stakeId = `comitati-${runId}`;
const otherStakeId = `comitati-altro-${runId}`;
const HISTORIC = ["logistics", "wellbeing", "kitchen", "games", "spiritual"];
const ACTIVITY_TYPES = ["standard", "overnight", "trip", "camp", "multi_day"];
const NON_CAMP_TYPES = ACTIVITY_TYPES.filter((type) => type !== "camp");
const LEGACY_MESSAGE = "Questa versione dell'app non può modificare il piano. Ricarica la pagina per aggiornarla.";
const ROSTER_FIELDS = ["firstName", "fullName", "genderRoleCategory", "id", "lastName", "registrationStatus", "status", "unitName"];
const PROJECTION_KEYS = ["assignedCommittees", "assignedPatrolId", "assignedPatrolName", "assignedPatrolRole", "updatedAt"];
const SENTINELS = {
  birthDate: "1987-06-05",
  email: `sentinella-${runId}@example.invalid`,
  phone: `+39000${runId}`,
  medical: `SENTINELLA-SANITARIA-${runId}`,
  allergy: `SENTINELLA-ALLERGIA-${runId}`,
  userId: `SENTINELLA-UID-${runId}`,
};
const containsSentinel = (value) => {
  const text = JSON.stringify(value);
  return Object.values(SENTINELS).filter((sentinel) => text.includes(sentinel));
};

const clients = {};
const apps = [];
let sequence = 0;

const newCommitteeId = () => `c_${randomUUID().replace(/-/gu, "").slice(0, 12)}`;
const committee = (id, extra = {}) => ({
  id,
  title: `Comitato ${id}`,
  responsibilities: "",
  leaderRegistrationIds: [],
  manualLeaderIds: [],
  memberRegistrationIds: [],
  ...extra,
});
const format2 = (committees, { expectedUpdatedAt = null, groupLabel } = {}) => ({
  planFormat: 2,
  expectedUpdatedAt,
  plan: { ...(groupLabel ? { groupLabel } : {}), committees, patrols: [], manualLeaders: [] },
});
const historicList = () => HISTORIC.map((id) => committee(id));
const legacyPayload = (extra = {}) => ({ plan: { committees: [], patrols: [], manualLeaders: [], ...extra } });

async function client(name, { role = "participant", stake = stakeId, anonymous = false, signedOut = false, unitId = null } = {}) {
  const app = initializeApp({ apiKey: "demo-key", projectId }, `comitati-${name}-${runId}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${authHost.value}`, { disableWarnings: true });
  if (anonymous) await signInAnonymously(auth);
  else if (!signedOut) await createUserWithEmailAndPassword(auth, `${name}-${runId}@example.invalid`, "comitati-test-only-123");
  const uid = auth.currentUser?.uid ?? null;
  const functions = getFunctions(app, "europe-west1");
  connectFunctionsEmulator(functions, functionHost.host, functionHost.port);
  const saveCallable = httpsCallable(functions, "campManagementSave");
  const staffCallable = httpsCallable(functions, "campManagementStaff");
  const firestore = getClientFirestore(app);
  connectFirestoreEmulator(firestore, firestoreHost.host, firestoreHost.port);
  if (uid && !anonymous) {
    await db.doc(`stakes/${stake}/members/${uid}`).set({ status: "active", staffRole: role === "participant" ? null : role });
    // `genderRoleCategory: dirigente` autodichiarata: non deve dare nessun accesso.
    await db.doc(`users/${uid}`).set({ role, stakeId: stake, fullName: `Persona ${name}`, genderRoleCategory: "dirigente", ...(unitId ? { unitId } : {}) });
  }
  return {
    uid,
    firestore,
    save: async (activityId, data) => (await saveCallable({ stakeId, activityId, ...data })).data,
    staff: async (activityId, data) => (await staffCallable({ stakeId, activityId, ...data })).data,
    roster: async (activityId) => (await staffCallable({ stakeId, activityId, action: "roster" })).data,
  };
}

function registrationDoc(name, extra = {}) {
  return {
    firstName: name,
    lastName: "Sintetico",
    fullName: `${name} Sintetico`,
    genderRoleCategory: "giovane_uomo",
    unitId: "unit-other",
    unitNameSnapshot: "Unità sintetica",
    registrationStatus: "confirmed",
    status: "active",
    birthDate: SENTINELS.birthDate,
    email: SENTINELS.email,
    phone: SENTINELS.phone,
    userId: SENTINELS.userId,
    answers: { medicalNote: SENTINELS.medical, allergies: SENTINELS.allergy },
    allergiesInfo: SENTINELS.allergy,
    medicalNotes: SENTINELS.medical,
    assignedCommittees: [],
    assignedPatrolId: null,
    assignedPatrolName: null,
    assignedPatrolRole: null,
    createdAt: "2026-10-26T10:00:00.000Z",
    updatedAt: "2026-10-26T10:00:00.000Z",
    ...extra,
  };
}

// Attività con cinque iscrizioni: due utenti veri (person, listed), manual_a e
// manual_b attive, manual_c annullata. Le attive sono quattro.
async function activity(type = "trip", { staff = false, omit = [] } = {}) {
  const id = `${type}-${++sequence}-${runId}`;
  const ref = db.doc(`stakes/${stakeId}/activities/${id}`);
  await ref.set({ title: `Attività sintetica ${type}`, activityType: type, startDate: "2026-11-20", endDate: "2026-11-22", overnight: true });
  const registrations = {
    [`user_${clients.person.uid}`]: registrationDoc("Persona", { userId: clients.person.uid }),
    [`user_${clients.listed.uid}`]: registrationDoc("Staff", { userId: clients.listed.uid, genderRoleCategory: "accompagnatore" }),
    manual_a: registrationDoc("Anna", { genderRoleCategory: "giovane_donna", registrationStatus: "active" }),
    manual_b: registrationDoc("Bruno"),
    manual_c: registrationDoc("Carla", { genderRoleCategory: "giovane_donna", registrationStatus: "cancelled", status: "cancelled" }),
  };
  const skipped = new Set(omit.map((name) => `user_${clients[name].uid}`));
  for (const [registrationId, data] of Object.entries(registrations)) {
    if (!skipped.has(registrationId)) await ref.collection("registrations").doc(registrationId).set(data);
  }
  if (staff) await ref.collection("management").doc("campStaff").set({ staffUids: [clients.listed.uid], updatedAt: "2026-10-26T10:00:00.000Z" });
  return {
    id,
    type,
    ref,
    plan: ref.collection("management").doc("camp"),
    personId: `user_${clients.person.uid}`,
    listedId: `user_${clients.listed.uid}`,
    activeIds: Object.entries(registrations)
      .filter(([registrationId, data]) => !skipped.has(registrationId) && data.registrationStatus !== "cancelled")
      .map(([registrationId]) => registrationId)
      .sort(),
  };
}
async function registrationsOf(fixture) {
  const snapshot = await fixture.ref.collection("registrations").get();
  return new Map(snapshot.docs.map((document) => [document.id, document.data()]));
}
const stable = (data) => Object.fromEntries(Object.entries(data).filter(([key]) => !PROJECTION_KEYS.includes(key)));
const committeeIdsOf = (plan) => plan.committees.map((item) => item.id);
const planPath = (fixture) => `stakes/${stakeId}/activities/${fixture.id}/management/camp`;

async function callableCode(promise, code, label = "") {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, `functions/${code}`, `${label} atteso ${code}, ricevuto ${error?.code}: ${error?.message}`);
    return true;
  });
}
async function rejectedWithOneOf(promise, codes, label = "") {
  await assert.rejects(promise, (error) => {
    assert.ok(codes.map((code) => `functions/${code}`).includes(error?.code), `${label} codici ammessi ${codes}, ricevuto ${error?.code}: ${error?.message}`);
    return true;
  });
}
async function rulesDenied(promise, label = "") {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, "permission-denied", `${label} ${error?.code}: ${error?.message}`);
    return true;
  });
}

before(async () => {
  await db.doc(`stakes/${stakeId}`).set({ name: "Palo sintetico comitati" });
  await db.doc(`stakes/${otherStakeId}`).set({ name: "Altro palo sintetico comitati" });
  clients.admin = await client("admin", { role: "admin" });
  clients.leader = await client("leader", { role: "unit_leader", unitId: "unit-lead" });
  clients.person = await client("person", { unitId: "unit-person" });
  clients.listed = await client("listed");
  clients.outside = await client("outside", { role: "admin", stake: otherStakeId });
  clients.outsideLeader = await client("outsideleader", { role: "unit_leader", stake: otherStakeId, unitId: "unit-lead" });
  clients.anonymous = await client("anonymous", { anonymous: true });
  clients.signedOut = await client("signedout", { signedOut: true });
});

after(async () => {
  await db.recursiveDelete(db.doc(`stakes/${stakeId}`));
  await db.recursiveDelete(db.doc(`stakes/${otherStakeId}`));
  for (const value of Object.values(clients)) {
    if (!value.uid) continue;
    await adminAuth.deleteUser(value.uid).catch(() => {});
    await db.doc(`users/${value.uid}`).delete();
  }
  for (const uid of syntheticUids) await db.doc(`users/${uid}`).delete();
  await Promise.all(Object.values(clients).map((value) => terminate(value.firestore)));
  await Promise.all(apps.map(deleteApp));
  await deleteAdminApp(adminApp);
});

// ---------------------------------------------------------------------------
// Admin su un'attività non campeggio: formato 2, assegnazioni, eliminazione
// ---------------------------------------------------------------------------

test("admin su viaggio: salva un comitato c_ con assegnazioni, poi lo elimina; le iscrizioni restano intatte", async () => {
  const fixture = await activity("trip");
  const seeded = await registrationsOf(fixture);
  const newId = newCommitteeId();
  const members = ["manual_a", "manual_b"];

  const first = await clients.admin.save(fixture.id, format2([
    committee("logistics", { title: "Logistica" }),
    committee(newId, { title: "  Palco e luci  ", emoji: "🎪", responsibilities: "Monta il palco", leaderRegistrationIds: [fixture.personId], memberRegistrationIds: members }),
  ]));
  assert.equal(first.ok, true);
  assert.deepEqual(committeeIdsOf(first.plan), ["logistics", newId]);
  const created = first.plan.committees.find((item) => item.id === newId);
  assert.equal(created.title, "Palco e luci");
  assert.equal(created.emoji, "", "i comitati nuovi non hanno emoji");
  assert.equal(created.responsibilities, "Monta il palco");
  assert.deepEqual(created.memberRegistrationIds, members);
  assert.equal(first.plan.groupLabel, "gruppo", "negli altri tipi i gruppi partono da Gruppi");
  assert.equal(first.registrationsSynced, 5);

  const stored = (await fixture.plan.get()).data();
  assert.deepEqual(committeeIdsOf(stored), ["logistics", newId]);
  assert.equal(stored.updatedAt, first.plan.updatedAt);
  assert.deepEqual(containsSentinel(stored), [], "il piano salvato non porta dati sensibili delle iscrizioni");

  let registrations = await registrationsOf(fixture);
  for (const registrationId of [...members, fixture.personId]) {
    assert.deepEqual(registrations.get(registrationId).assignedCommittees.map((item) => item.id), [newId], registrationId);
    assert.equal(registrations.get(registrationId).assignedCommittees[0].title, "Palco e luci");
  }
  for (const registrationId of [fixture.listedId, "manual_c"]) assert.deepEqual(registrations.get(registrationId).assignedCommittees, [], registrationId);

  // Elimina il comitato con persone: formato 2, elenco completo senza il comitato.
  const second = await clients.admin.save(fixture.id, format2([committee("logistics", { title: "Logistica" })], { expectedUpdatedAt: first.plan.updatedAt }));
  assert.deepEqual(committeeIdsOf(second.plan), ["logistics"]);
  assert.deepEqual(committeeIdsOf((await fixture.plan.get()).data()), ["logistics"]);
  assert.deepEqual(
    second.plan.committees.flatMap((item) => [...item.memberRegistrationIds, ...item.leaderRegistrationIds]),
    [],
    "le persone del comitato eliminato restano senza comitato",
  );
  registrations = await registrationsOf(fixture);
  for (const [registrationId, data] of registrations) {
    assert.deepEqual(data.assignedCommittees, [], `${registrationId}: assignedCommittees senza il comitato eliminato`);
    assert.deepEqual(stable(data), stable(seeded.get(registrationId)), `${registrationId}: iscrizione e altri campi intatti`);
    assert.equal(data.registrationStatus, seeded.get(registrationId).registrationStatus);
    assert.deepEqual(data.answers, seeded.get(registrationId).answers);
    assert.equal(data.birthDate, seeded.get(registrationId).birthDate);
  }

  // Dopo il salvataggio si ricrea e si riassegna.
  const recreatedId = newCommitteeId();
  const third = await clients.admin.save(fixture.id, format2([
    committee("logistics", { title: "Logistica" }),
    committee(recreatedId, { title: "Palco e luci", memberRegistrationIds: members }),
  ], { expectedUpdatedAt: second.plan.updatedAt }));
  assert.deepEqual(committeeIdsOf(third.plan), ["logistics", recreatedId]);
  registrations = await registrationsOf(fixture);
  for (const registrationId of members) assert.deepEqual(registrations.get(registrationId).assignedCommittees.map((item) => item.id), [recreatedId]);
  for (const [registrationId, data] of registrations) assert.deepEqual(stable(data), stable(seeded.get(registrationId)), `${registrationId} ancora intatta`);
});

test("admin: elenco con zero comitati ammesso, nessuno torna ai cinque storici e le proiezioni si svuotano", async () => {
  const fixture = await activity("overnight");
  const first = await clients.admin.save(fixture.id, format2([committee("kitchen", { memberRegistrationIds: ["manual_a"] })]));
  assert.deepEqual((await registrationsOf(fixture)).get("manual_a").assignedCommittees.map((item) => item.id), ["kitchen"]);
  const empty = await clients.admin.save(fixture.id, format2([], { expectedUpdatedAt: first.plan.updatedAt }));
  assert.deepEqual(empty.plan.committees, []);
  assert.deepEqual((await fixture.plan.get()).data().committees, []);
  for (const [registrationId, data] of await registrationsOf(fixture)) assert.deepEqual(data.assignedCommittees, [], registrationId);
  const refilled = await clients.admin.save(fixture.id, format2(historicList(), { expectedUpdatedAt: empty.plan.updatedAt }));
  assert.deepEqual(committeeIdsOf(refilled.plan), HISTORIC);
});

test("una persona sta in un solo comitato anche dopo il salvataggio dal server", async () => {
  const fixture = await activity("trip");
  const result = await clients.admin.save(fixture.id, format2([
    committee(newCommitteeId(), { title: "Primo", memberRegistrationIds: ["manual_a", "manual_b"] }),
    committee(newCommitteeId(), { title: "Secondo", memberRegistrationIds: ["manual_a"], leaderRegistrationIds: ["manual_b"] }),
  ]));
  const people = result.plan.committees.flatMap((item) => [...item.leaderRegistrationIds, ...item.memberRegistrationIds]);
  assert.equal(new Set(people).size, people.length, "nessuna persona in due comitati");
  for (const [, data] of await registrationsOf(fixture)) assert.ok(data.assignedCommittees.length <= 1);
});

// Cardinalità con dirigente manuale: il server collega per nome un dirigente
// manuale «Ada Rossi» all'iscrizione adulta `user_ada`. Se `user_ada` è già nel
// comitato A e il dirigente manuale sta nel comitato B, la stessa persona finirebbe
// in due comitati: il formato 2 deve rifiutare (invalid-argument, messaggio con
// persona e i due comitati, nessuna scrittura); il formato precedente passa ma
// `assignedCommittees` non supera un comitato.
async function activityWithAda(type) {
  const fixture = await activity(type);
  await fixture.ref.collection("registrations").doc("user_ada").set(
    registrationDoc("Ada", { firstName: "Ada", lastName: "Rossi", fullName: "Ada Rossi", genderRoleCategory: "dirigente" }),
  );
  return fixture;
}
const adaManualLeader = { id: "manual-ada", fullName: "Ada Rossi" };
const distinctCommitteeIds = (assignments) => [...new Set((assignments || []).map((item) => item.id))];

for (const type of ["trip", "camp"]) {
  for (const role of ["member", "leader"]) {
    test(`cardinalità (${type}, Ada ${role === "member" ? "membro" : "guida"} di A): formato 2 rifiuta il dirigente manuale omonimo in B, senza scritture`, async () => {
      const fixture = await activityWithAda(type);
      const seeded = await registrationsOf(fixture);
      const alfa = type === "camp" ? "logistics" : newCommitteeId();
      const beta = type === "camp" ? "kitchen" : newCommitteeId();
      const payload = format2([
        committee(alfa, { title: "Comitato Alfa", ...(role === "member" ? { memberRegistrationIds: ["user_ada"] } : { leaderRegistrationIds: ["user_ada"] }) }),
        committee(beta, { title: "Comitato Beta", manualLeaderIds: [adaManualLeader.id] }),
      ]);
      payload.plan.manualLeaders = [adaManualLeader];
      await assert.rejects(clients.admin.save(fixture.id, payload), (error) => {
        assert.equal(error.code, "functions/invalid-argument", `${error.code}: ${error.message}`);
        assert.equal(
          error.message,
          "Ada Rossi è in due comitati: Comitato Alfa e Comitato Beta. Togli una delle due assegnazioni e salva di nuovo.",
          "il messaggio nomina la persona e i due comitati, nell'ordine dell'elenco",
        );
        return true;
      });
      assert.equal((await fixture.plan.get()).exists, false, "nessun piano scritto");
      assert.deepEqual(await registrationsOf(fixture), seeded, "nessuna proiezione scritta");
    });
  }
}

test("cardinalità: il formato 2 con Ada solo dirigente manuale (nessun conflitto) passa e la collega per nome", async () => {
  const fixture = await activityWithAda("trip");
  const beta = newCommitteeId();
  const payload = format2([committee(newCommitteeId(), { title: "Comitato Alfa" }), committee(beta, { title: "Comitato Beta", manualLeaderIds: [adaManualLeader.id] })]);
  payload.plan.manualLeaders = [adaManualLeader];
  const saved = await clients.admin.save(fixture.id, payload);
  assert.equal(saved.ok, true);
  assert.equal(saved.plan.manualLeaders[0].linkedRegistrationId, "user_ada", "il dirigente manuale è collegato per nome");
  assert.deepEqual((await registrationsOf(fixture)).get("user_ada").assignedCommittees.map((item) => item.id), [beta]);
});

test("cardinalità: payload precedente su campeggio a cinque storici passa, ma Ada non finisce in due comitati", async () => {
  for (const preSeeded of [false, true]) {
    const fixture = await activityWithAda("camp");
    if (preSeeded) await clients.admin.save(fixture.id, format2(historicList()));
    const result = await clients.admin.save(fixture.id, {
      plan: {
        committees: [
          { id: "logistics", title: "Comitato Alfa", memberRegistrationIds: ["user_ada"] },
          { id: "kitchen", title: "Comitato Beta", manualLeaderIds: [adaManualLeader.id] },
        ],
        patrols: [],
        manualLeaders: [adaManualLeader],
      },
    });
    assert.equal(result.ok, true, `payload precedente (piano già salvato: ${preSeeded})`);
    const projected = (await registrationsOf(fixture)).get("user_ada").assignedCommittees;
    assert.ok(distinctCommitteeIds(projected).length <= 1, `assignedCommittees di user_ada: ${JSON.stringify(projected)}`);
    assert.ok(projected.length <= 1, `nessuna voce doppia: ${JSON.stringify(projected)}`);
    assert.deepEqual(projected.map((item) => item.id), ["logistics"], "vale il primo comitato nell'ordine storico dei cinque");
  }
});

test("ogni tipo di attività: admin e dirigente di unità salvano; i gruppi partono da Gruppi fuori dal campeggio", async () => {
  for (const type of ACTIVITY_TYPES) {
    const expectedLabel = type === "camp" ? "pattuglia" : "gruppo";
    const byAdmin = await activity(type);
    const saved = await clients.admin.save(byAdmin.id, format2([committee(newCommitteeId(), { title: "Uno" })]));
    assert.equal(saved.ok, true, `${type} admin`);
    assert.equal(saved.plan.groupLabel, expectedLabel, `${type} denominazione predefinita`);
    assert.equal((await byAdmin.plan.get()).get("groupLabel"), expectedLabel);

    const byLeader = await activity(type);
    const leaderSaved = await clients.leader.save(byLeader.id, format2([committee(newCommitteeId(), { title: "Uno" })]));
    assert.equal(leaderSaved.ok, true, `${type} dirigente`);
    assert.equal(leaderSaved.plan.groupLabel, expectedLabel, `${type} dirigente denominazione`);
  }
});

test("denominazione scelta: i cinque nomi valgono su ogni tipo; uno sconosciuto è rifiutato senza scrivere", async () => {
  for (const type of ["trip", "camp"]) {
    for (const groupLabel of ["pattuglia", "gruppo", "compagnia", "team", "squadra"]) {
      const fixture = await activity(type);
      const saved = await clients.admin.save(fixture.id, format2([], { groupLabel }));
      assert.equal(saved.plan.groupLabel, groupLabel, `${type} ${groupLabel}`);
    }
    const fixture = await activity(type);
    await callableCode(clients.admin.save(fixture.id, format2([], { groupLabel: "reparto" })), "invalid-argument", type);
    assert.equal((await fixture.plan.get()).exists, false);
  }
});

test("validazione sul server (formato 2): payload non validi non scrivono nulla", async () => {
  const fixture = await activity("trip");
  const first = await clients.admin.save(fixture.id, format2([committee(newCommitteeId(), { title: "Base", memberRegistrationIds: ["manual_a"] })]));
  const before = (await fixture.plan.get()).data();
  const projectionBefore = await registrationsOf(fixture);
  const id = newCommitteeId();
  const manyIds = Array.from({ length: 21 }, (_, index) => `c_${String(index).padStart(8, "0")}`);
  const cases = [
    ["ID con maiuscole", [committee("C_ABCDEFGH")]],
    ["ID troppo corto", [committee("c_abc")]],
    ["ID troppo lungo", [committee(`c_${"a".repeat(33)}`)]],
    ["ID sconosciuto senza prefisso", [committee("cucina")]],
    ["ID doppio", [committee(id), committee(id)]],
    ["titolo assente", [{ id, responsibilities: "" }]],
    ["titolo vuoto", [committee(id, { title: "" })]],
    ["titolo di 81 caratteri", [committee(id, { title: "T".repeat(81) })]],
    ["incarico di 601 caratteri", [committee(id, { responsibilities: "I".repeat(601) })]],
    ["21 comitati", manyIds.map((value) => committee(value))],
  ];
  for (const [label, committees] of cases) {
    await callableCode(clients.admin.save(fixture.id, format2(committees, { expectedUpdatedAt: first.plan.updatedAt })), "invalid-argument", label);
  }
  assert.deepEqual((await fixture.plan.get()).data(), before, "il piano non è cambiato");
  assert.deepEqual(await registrationsOf(fixture), projectionBefore, "le iscrizioni non sono cambiate");
  // Confini ammessi: titolo 80, incarico 600, 20 comitati.
  const twenty = Array.from({ length: 20 }, (_, index) => committee(`c_${String(index).padStart(8, "0")}`, { title: index === 0 ? "T".repeat(80) : `Titolo ${index}`, responsibilities: index === 0 ? "I".repeat(600) : "" }));
  const saved = await clients.admin.save(fixture.id, format2(twenty, { expectedUpdatedAt: first.plan.updatedAt }));
  assert.equal(saved.plan.committees.length, 20);
});

// ---------------------------------------------------------------------------
// Dirigente di unità: salva, elenco nomi, nessuna lettura delle iscrizioni
// ---------------------------------------------------------------------------

test("dirigente di unità su viaggio: salva il piano e riceve l'elenco nomi con i soli campi ammessi", async () => {
  const fixture = await activity("trip");
  const newId = newCommitteeId();
  const saved = await clients.leader.save(fixture.id, format2([committee(newId, { title: "Accoglienza", memberRegistrationIds: ["manual_a"] })]));
  assert.equal(saved.ok, true);
  assert.deepEqual((await registrationsOf(fixture)).get("manual_a").assignedCommittees.map((item) => item.id), [newId]);

  const roster = await clients.leader.roster(fixture.id);
  assert.equal(roster.ok, true);
  assert.ok(Array.isArray(roster.registrations));
  assert.deepEqual(roster.registrations.map((entry) => entry.id).sort(), fixture.activeIds, "solo le iscrizioni attive");
  assert.equal(roster.registrations.some((entry) => entry.id === "manual_c"), false, "l'iscrizione annullata non c'è");
  for (const entry of roster.registrations) {
    assert.deepEqual(Object.keys(entry).sort(), ROSTER_FIELDS, `campi di ${entry.id}`);
  }
  assert.deepEqual(containsSentinel(roster), [], "nessun dato di nascita, risposta, sanitario o contatto nell'elenco nomi");
  const anna = roster.registrations.find((entry) => entry.id === "manual_a");
  assert.equal(anna.fullName, "Anna Sintetico");
  assert.equal(anna.firstName, "Anna");
  assert.equal(anna.lastName, "Sintetico");
  assert.equal(anna.genderRoleCategory, "giovane_donna");
  assert.equal(anna.unitName, "Unità sintetica");
  assert.equal(anna.registrationStatus, "active");
});

test("elenco nomi: lo stesso payload per admin su ogni tipo e per il dirigente sul campeggio", async () => {
  for (const type of ACTIVITY_TYPES) {
    const fixture = await activity(type);
    const roster = await clients.admin.roster(fixture.id);
    assert.deepEqual(roster.registrations.map((entry) => entry.id).sort(), fixture.activeIds, `${type} admin`);
    for (const entry of roster.registrations) assert.deepEqual(Object.keys(entry).sort(), ROSTER_FIELDS, `${type} ${entry.id}`);
    assert.deepEqual(containsSentinel(roster), [], type);
  }
  const camp = await activity("camp");
  const roster = await clients.leader.roster(camp.id);
  assert.deepEqual(roster.registrations.map((entry) => entry.id).sort(), camp.activeIds);
  assert.deepEqual(containsSentinel(roster), []);
});

test("dirigente di unità su viaggio: nessun elenco iscrizioni via SDK, il piano sì", async () => {
  const fixture = await activity("trip");
  const leader = clients.leader.firestore;
  // Query identica a registrationsService.listRegistrationsByEvent(…, fromServer=true).
  await rulesDenied(getDocsFromServer(collection(leader, `stakes/${stakeId}/activities/${fixture.id}/registrations`)), "list non filtrato");
  await rulesDenied(getDocFromServer(doc(leader, `stakes/${stakeId}/activities/${fixture.id}/registrations/manual_a`)), "get di un'iscrizione");
  await rulesDenied(getDocFromServer(doc(leader, `stakes/${stakeId}/activities/${fixture.id}/registrations/${fixture.personId}`)), "get di un'iscrizione utente");

  const missing = await getDocFromServer(doc(leader, planPath(fixture)));
  assert.equal(missing.exists(), false, "piano mai salvato: lettura consentita, documento assente");
  const newId = newCommitteeId();
  await clients.leader.save(fixture.id, format2([committee(newId, { title: "Accoglienza" })]));
  const snapshot = await getDocFromServer(doc(leader, planPath(fixture)));
  assert.equal(snapshot.exists(), true);
  assert.deepEqual(committeeIdsOf(snapshot.data()), [newId]);
});

test("dirigente di unità su campeggio: legge anche le iscrizioni, come prima", async () => {
  const fixture = await activity("camp");
  const snapshot = await getDocsFromServer(collection(clients.leader.firestore, `stakes/${stakeId}/activities/${fixture.id}/registrations`));
  assert.equal(snapshot.size, 5);
});

test("azioni context, list e set di campManagementStaff restano solo campeggio", async () => {
  const fixture = await activity("trip");
  for (const actor of ["admin", "leader"]) {
    await callableCode(clients[actor].staff(fixture.id, { action: "context" }), "failed-precondition", `${actor} context`);
    await callableCode(clients[actor].staff(fixture.id, { action: "list" }), "failed-precondition", `${actor} list`);
    await callableCode(clients[actor].staff(fixture.id, { action: "set", uid: clients.person.uid, enabled: true }), "failed-precondition", `${actor} set`);
  }
  await rejectedWithOneOf(clients.person.staff(fixture.id, { action: "list" }), ["failed-precondition", "permission-denied"], "iscritto list");
  assert.equal((await fixture.ref.collection("management").doc("campStaff").get()).exists, false, "nessun elenco staff scritto");
  const camp = await activity("camp");
  assert.deepEqual(await clients.leader.staff(camp.id, { action: "context" }), { ok: true, isStaff: true, canManageStaff: false });
  await callableCode(clients.leader.staff(camp.id, { action: "list" }), "permission-denied", "dirigente list su campeggio");
});

// ---------------------------------------------------------------------------
// Staff in elenco campeggio
// ---------------------------------------------------------------------------

test("staff in elenco: sul campeggio salva (formato 2 e precedente) e vede l'elenco nomi", async () => {
  const fixture = await activity("camp", { staff: true });
  const newId = newCommitteeId();
  const saved = await clients.listed.save(fixture.id, format2([committee(newId, { title: "Cassa", memberRegistrationIds: ["manual_b"] })]));
  assert.equal(saved.ok, true);
  assert.equal(saved.plan.groupLabel, "pattuglia");
  const roster = await clients.listed.roster(fixture.id);
  assert.deepEqual(roster.registrations.map((entry) => entry.id).sort(), fixture.activeIds);
  assert.deepEqual(containsSentinel(roster), []);
  await clients.admin.save(fixture.id, format2(historicList(), { expectedUpdatedAt: saved.plan.updatedAt }));
  const legacy = await clients.listed.save(fixture.id, legacyPayload());
  assert.equal(legacy.ok, true);
});

test("staff in elenco: su un viaggio salvataggio ed elenco nomi sono negati", async () => {
  const fixture = await activity("trip", { staff: true });
  await callableCode(clients.listed.save(fixture.id, format2([committee(newCommitteeId())])), "permission-denied", "save formato 2");
  await callableCode(clients.listed.save(fixture.id, legacyPayload()), "permission-denied", "save precedente");
  await callableCode(clients.listed.roster(fixture.id), "permission-denied", "roster");
  assert.equal((await fixture.plan.get()).exists, false);
  for (const type of NON_CAMP_TYPES) {
    const other = await activity(type, { staff: true });
    await callableCode(clients.listed.save(other.id, format2([])), "permission-denied", `save ${type}`);
    await callableCode(clients.listed.roster(other.id), "permission-denied", `roster ${type}`);
  }
});

// ---------------------------------------------------------------------------
// Iscritto, anonimo, altro palo
// ---------------------------------------------------------------------------

test("iscritto, anonimo, admin e dirigente di un altro palo: salvataggio ed elenco nomi negati su ogni tipo", async () => {
  for (const type of ACTIVITY_TYPES) {
    const fixture = await activity(type, { staff: type === "camp" });
    const seeded = await registrationsOf(fixture);
    for (const actor of ["person", "anonymous", "outside", "outsideLeader"]) {
      await callableCode(clients[actor].save(fixture.id, format2([committee(newCommitteeId(), { memberRegistrationIds: ["manual_a"] })])), "permission-denied", `${actor} save ${type}`);
      await callableCode(clients[actor].save(fixture.id, legacyPayload()), "permission-denied", `${actor} save precedente ${type}`);
      await callableCode(clients[actor].roster(fixture.id), "permission-denied", `${actor} roster ${type}`);
    }
    await callableCode(clients.signedOut.save(fixture.id, format2([])), "unauthenticated", `senza login save ${type}`);
    await callableCode(clients.signedOut.roster(fixture.id), "unauthenticated", `senza login roster ${type}`);
    assert.equal((await fixture.plan.get()).exists, false, `${type}: nessun piano scritto dai rifiuti`);
    assert.deepEqual(await registrationsOf(fixture), seeded, `${type}: iscrizioni intatte`);
  }
});

test("nessun oracolo di esistenza: chi non può salvare riceve permission-denied anche su un'attività inesistente", async () => {
  const missing = `inesistente-${runId}`;
  for (const actor of ["person", "outside", "outsideLeader"]) {
    await callableCode(clients[actor].save(missing, format2([])), "permission-denied", `${actor} save`);
    await callableCode(clients[actor].roster(missing), "permission-denied", `${actor} roster`);
  }
  await callableCode(clients.admin.save(missing, format2([])), "not-found", "admin save");
  await callableCode(clients.admin.roster(missing), "not-found", "admin roster");
});

test("iscritto normale: legge management/camp della propria attività, non quello di un'altra", async () => {
  for (const type of ["trip", "camp"]) {
    const fixture = await activity(type);
    const newId = newCommitteeId();
    await clients.admin.save(fixture.id, format2([committee(newId, { title: "Visibile", responsibilities: "Si vede", memberRegistrationIds: ["manual_a"] })]));
    const snapshot = await getDocFromServer(doc(clients.person.firestore, planPath(fixture)));
    assert.equal(snapshot.exists(), true, `${type}: l'iscritto legge il piano`);
    assert.equal(snapshot.data().committees[0].title, "Visibile");
    assert.deepEqual(containsSentinel(snapshot.data()), [], `${type}: il piano letto dall'iscritto non porta dati sensibili`);
    await rulesDenied(getDocsFromServer(collection(clients.person.firestore, `stakes/${stakeId}/activities/${fixture.id}/registrations`)), `${type}: elenco iscrizioni`);

    const notRegistered = await activity(type, { omit: ["person"] });
    await rulesDenied(getDocFromServer(doc(clients.person.firestore, planPath(notRegistered))), `${type}: attività non propria`);
  }
});

test("altro palo e anonimo non leggono management/camp", async () => {
  const fixture = await activity("trip");
  await clients.admin.save(fixture.id, format2([committee(newCommitteeId())]));
  for (const actor of ["outside", "outsideLeader", "anonymous", "signedOut"]) {
    await rulesDenied(getDocFromServer(doc(clients[actor].firestore, planPath(fixture))), actor);
  }
});

// ---------------------------------------------------------------------------
// Client precedenti (payload senza planFormat)
// ---------------------------------------------------------------------------

test("payload precedente su campeggio senza piano: accettato, cinque storici, Pattuglie", async () => {
  const fixture = await activity("camp");
  const saved = await clients.admin.save(fixture.id, legacyPayload());
  assert.equal(saved.ok, true);
  assert.deepEqual(committeeIdsOf(saved.plan).sort(), [...HISTORIC].sort());
  assert.equal(saved.plan.groupLabel, "pattuglia");
  for (const item of saved.plan.committees) assert.equal(item.responsibilities, "", item.id);
  const again = await clients.admin.save(fixture.id, legacyPayload({ groupLabel: "squadra" }));
  assert.equal(again.ok, true, "con i cinque storici salvati il payload precedente resta accettato");
  assert.equal(again.plan.groupLabel, "squadra");
});

test("payload precedente su campeggio con piano di cinque storici (semina diretta): accettato, con unione", async () => {
  const fixture = await activity("camp");
  await fixture.plan.set({
    groupLabel: "compagnia",
    committees: HISTORIC.map((id) => ({ id, title: `Seed ${id}`, emoji: "🙂", responsibilities: `Incarico ${id}`, leaderRegistrationIds: [], manualLeaderIds: [], memberRegistrationIds: [], publicMembers: [], updatedAt: "2026-10-26T10:00:00.000Z" })),
    patrols: [], manualLeaders: [], updatedAt: "2026-10-26T10:00:00.000Z",
  });
  const saved = await clients.admin.save(fixture.id, { plan: { committees: [{ id: "kitchen", title: "Cucina nuova" }] } });
  assert.equal(saved.ok, true);
  assert.deepEqual(committeeIdsOf(saved.plan).sort(), [...HISTORIC].sort(), "unione: gli omessi restano");
  assert.equal(saved.plan.committees.find((item) => item.id === "kitchen").title, "Cucina nuova");
  assert.equal(saved.plan.committees.find((item) => item.id === "games").responsibilities, "Incarico games");
  assert.equal(saved.plan.groupLabel, "compagnia");
});

test("payload precedente su viaggio: failed-precondition col messaggio della spec, senza piano o con piano", async () => {
  for (const type of NON_CAMP_TYPES) {
    const fixture = await activity(type);
    for (const payload of [legacyPayload(), { plan: { committees: HISTORIC.map((id) => ({ id })), patrols: [], manualLeaders: [] } }, { plan: { groupLabel: "team" } }]) {
      await assert.rejects(clients.admin.save(fixture.id, payload), (error) => {
        assert.equal(error.code, "functions/failed-precondition", `${type}: ${error.message}`);
        assert.equal(error.message, LEGACY_MESSAGE);
        return true;
      });
    }
    assert.equal((await fixture.plan.get()).exists, false, `${type}: nessun piano scritto`);

    const withPlan = await activity(type);
    await clients.admin.save(withPlan.id, format2(historicList()));
    const before = (await withPlan.plan.get()).data();
    await callableCode(clients.admin.save(withPlan.id, legacyPayload()), "failed-precondition", `${type} con cinque storici salvati`);
    assert.deepEqual((await withPlan.plan.get()).data(), before, `${type}: piano intatto`);
  }
});

test("payload precedente del dirigente di unità su viaggio: accesso sì, ma formato rifiutato", async () => {
  const fixture = await activity("trip");
  await assert.rejects(clients.leader.save(fixture.id, legacyPayload()), (error) => {
    assert.equal(error.code, "functions/failed-precondition");
    assert.equal(error.message, LEGACY_MESSAGE);
    return true;
  });
});

test("payload precedente su campeggio con un comitato c_: rifiutato, il piano non cambia", async () => {
  const fixture = await activity("camp");
  const newId = newCommitteeId();
  const first = await clients.admin.save(fixture.id, format2([...historicList(), committee(newId, { title: "Nuovo", memberRegistrationIds: ["manual_a"] })]));
  const before = (await fixture.plan.get()).data();
  const projection = await registrationsOf(fixture);
  await assert.rejects(clients.admin.save(fixture.id, { plan: { committees: [{ id: "kitchen", memberRegistrationIds: ["manual_b"] }] }, expectedUpdatedAt: first.plan.updatedAt }), (error) => {
    assert.equal(error.code, "functions/failed-precondition");
    assert.equal(error.message, LEGACY_MESSAGE);
    return true;
  });
  assert.deepEqual((await fixture.plan.get()).data(), before);
  assert.deepEqual(await registrationsOf(fixture), projection, "nessuna persona spostata in silenzio");
  assert.deepEqual((await fixture.plan.get()).data().committees.map((item) => item.id), [...HISTORIC, newId]);
});

test("payload precedente su campeggio con uno storico eliminato: rifiutato, il comitato non risorge", async () => {
  const fixture = await activity("camp");
  const first = await clients.admin.save(fixture.id, format2(HISTORIC.filter((id) => id !== "kitchen").map((id) => committee(id))));
  assert.equal(first.plan.committees.length, 4);
  await callableCode(clients.admin.save(fixture.id, legacyPayload()), "failed-precondition", "senza revisione");
  await callableCode(clients.admin.save(fixture.id, { ...legacyPayload(), expectedUpdatedAt: first.plan.updatedAt }), "failed-precondition", "con revisione");
  assert.deepEqual(committeeIdsOf((await fixture.plan.get()).data()), HISTORIC.filter((id) => id !== "kitchen"));
  // Il client nuovo può ripristinarlo esplicitamente.
  const restored = await clients.admin.save(fixture.id, format2(historicList(), { expectedUpdatedAt: first.plan.updatedAt }));
  assert.deepEqual(committeeIdsOf(restored.plan), HISTORIC);
});

// ---------------------------------------------------------------------------
// Revisione e conflitto
// ---------------------------------------------------------------------------

test("formato 2: revisione obsoleta o null su piano esistente → aborted; assente o non stringa → invalid-argument", async () => {
  const fixture = await activity("trip");
  const first = await clients.admin.save(fixture.id, format2([committee("kitchen")]));
  const second = await clients.admin.save(fixture.id, format2([committee("kitchen"), committee("games")], { expectedUpdatedAt: first.plan.updatedAt }));
  const before = (await fixture.plan.get()).data();
  const projection = await registrationsOf(fixture);
  const body = { planFormat: 2, plan: { committees: [committee("kitchen")] } };

  await callableCode(clients.admin.save(fixture.id, { ...body, expectedUpdatedAt: first.plan.updatedAt }), "aborted", "revisione obsoleta");
  await callableCode(clients.admin.save(fixture.id, { ...body, expectedUpdatedAt: null }), "aborted", "null su piano esistente");
  await callableCode(clients.admin.save(fixture.id, body), "invalid-argument", "revisione assente");
  for (const expectedUpdatedAt of [42, true, {}, []]) {
    await callableCode(clients.admin.save(fixture.id, { ...body, expectedUpdatedAt }), "invalid-argument", JSON.stringify(expectedUpdatedAt));
  }
  await callableCode(clients.admin.save(fixture.id, { ...body, planFormat: 3, expectedUpdatedAt: second.plan.updatedAt }), "invalid-argument", "formato 3");
  assert.deepEqual((await fixture.plan.get()).data(), before);
  assert.deepEqual(await registrationsOf(fixture), projection);

  const ok = await clients.admin.save(fixture.id, { ...body, expectedUpdatedAt: second.plan.updatedAt });
  assert.deepEqual(committeeIdsOf(ok.plan), ["kitchen"]);
});

test("formato 2: null su piano assente è accettato; due editor con la stessa revisione → un solo vincitore", async () => {
  const fixture = await activity("trip");
  const first = await clients.admin.save(fixture.id, format2([committee("kitchen")], { expectedUpdatedAt: null }));
  const results = await Promise.allSettled([
    clients.admin.save(fixture.id, format2([committee("games", { memberRegistrationIds: ["manual_a"] })], { expectedUpdatedAt: first.plan.updatedAt })),
    clients.leader.save(fixture.id, format2([committee("spiritual", { memberRegistrationIds: ["manual_a"] })], { expectedUpdatedAt: first.plan.updatedAt })),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.find((item) => item.status === "rejected").reason.code, "functions/aborted");
  const winner = results.find((item) => item.status === "fulfilled").value.plan;
  assert.equal((await fixture.plan.get()).get("updatedAt"), winner.updatedAt);
  const projected = (await registrationsOf(fixture)).get("manual_a").assignedCommittees.map((item) => item.id);
  assert.deepEqual(projected, [winner.committees[0].id], "la proiezione segue il vincitore");
});

// ---------------------------------------------------------------------------
// Scrittura diretta del piano dal client: negata a tutti
// ---------------------------------------------------------------------------

const planBody = (updatedAt = "2026-10-31T10:00:00.000Z") => ({ committees: [], patrols: [], manualLeaders: [], updatedAt });

for (const [type, actors] of [
  ["trip", ["admin", "leader", "listed", "person"]],
  ["camp", ["admin", "leader", "listed", "person"]],
]) {
  test(`rules SDK su ${type}: create, update e delete di management/camp negati a ${actors.join(", ")}`, async () => {
    const fixture = await activity(type, { staff: true });
    // Prima senza documento: create negata, update e delete su documento assente.
    for (const actor of actors) {
      const ref = doc(clients[actor].firestore, planPath(fixture));
      await rulesDenied(setDoc(ref, planBody()), `${actor} create`);
      await rulesDenied(updateDoc(ref, { updatedAt: "2026-10-31T11:00:00.000Z" }), `${actor} update su assente`);
      await rulesDenied(deleteDoc(ref), `${actor} delete su assente`);
    }
    assert.equal((await fixture.plan.get()).exists, false, "nessuna scrittura è passata");
    // Poi con il piano salvato dalla callable.
    const saved = await clients.admin.save(fixture.id, format2([committee("kitchen", { memberRegistrationIds: ["manual_a"] })], { groupLabel: "team" }));
    const before = (await fixture.plan.get()).data();
    for (const actor of actors) {
      const ref = doc(clients[actor].firestore, planPath(fixture));
      await rulesDenied(setDoc(ref, planBody()), `${actor} set su esistente`);
      await rulesDenied(setDoc(ref, { groupLabel: "squadra" }, { merge: true }), `${actor} merge`);
      await rulesDenied(updateDoc(ref, { groupLabel: "squadra", updatedAt: "2026-10-31T12:00:00.000Z" }), `${actor} update`);
      await rulesDenied(updateDoc(ref, { committees: [] }), `${actor} update committees`);
      await rulesDenied(deleteDoc(ref), `${actor} delete`);
    }
    assert.deepEqual((await fixture.plan.get()).data(), before, "il piano è identico");
    assert.equal(before.updatedAt, saved.plan.updatedAt);
  });
}

test("rules SDK: anche altro palo e anonimo non scrivono management/camp", async () => {
  const fixture = await activity("camp");
  for (const actor of ["outside", "outsideLeader", "anonymous", "signedOut"]) {
    await rulesDenied(setDoc(doc(clients[actor].firestore, planPath(fixture)), planBody()), actor);
  }
  assert.equal((await fixture.plan.get()).exists, false);
});

// ---------------------------------------------------------------------------
// Revoca durante il salvataggio
// ---------------------------------------------------------------------------

// Il handler controlla l'accesso fuori transazione e poi lo rilegge DENTRO la
// transazione del piano (la prima db.runTransaction). Si sostituisce
// db.runTransaction per cambiare i permessi esattamente tra i due controlli.
const { campManagementSave } = require("../lib/campManagement.js");
async function saveInProcess(uid, activityId, data) {
  return campManagementSave.run({ auth: { uid, token: { firebase: { sign_in_provider: "password" } } }, data: { stakeId, activityId, ...data } });
}
async function withRevocationBeforePlanTransaction(revoke, run) {
  const original = db.runTransaction;
  let calls = 0;
  let revoked = false;
  db.runTransaction = async function (...args) {
    calls += 1;
    if (calls === 1) {
      await revoke();
      revoked = true;
    }
    return original.apply(this, args);
  };
  try {
    return { result: await run().then((value) => ({ value }), (error) => ({ error })), revoked };
  } finally {
    db.runTransaction = original;
  }
}
const syntheticUids = new Set();
async function syntheticUser(label, profile) {
  const uid = `revoca-${label}-${runId}`;
  syntheticUids.add(uid);
  await db.doc(`users/${uid}`).set({ fullName: `Persona ${label}`, genderRoleCategory: "dirigente", ...profile });
  return uid;
}
const revocationPayload = (extra = {}) => format2([committee(newCommitteeId(), { title: "Revoca", memberRegistrationIds: ["manual_a", "manual_b"] })], extra);

const REVOCATIONS = [
  {
    label: "dirigente di unità declassato",
    type: "trip",
    setup: async () => ({ uid: await syntheticUser("leader-role", { role: "unit_leader", stakeId }) }),
    revoke: async ({ uid }) => db.doc(`users/${uid}`).update({ role: "participant" }),
  },
  {
    label: "dirigente di unità spostato in un altro palo",
    type: "trip",
    setup: async () => ({ uid: await syntheticUser("leader-stake", { role: "unit_leader", stakeId }) }),
    revoke: async ({ uid }) => db.doc(`users/${uid}`).update({ stakeId: otherStakeId }),
  },
  {
    label: "admin declassato",
    type: "overnight",
    setup: async () => ({ uid: await syntheticUser("admin-role", { role: "admin", stakeId }) }),
    revoke: async ({ uid }) => db.doc(`users/${uid}`).update({ role: "participant" }),
  },
  {
    label: "staff tolto dall'elenco del campeggio",
    type: "camp",
    setup: async (fixture) => {
      const uid = await syntheticUser("staff-list", { role: "participant", stakeId });
      await fixture.ref.collection("registrations").doc(`user_${uid}`).set(registrationDoc("Staff2", { registrationStatus: "confirmed" }));
      await fixture.ref.collection("management").doc("campStaff").set({ staffUids: [uid] });
      return { uid };
    },
    revoke: async ({ uid }, fixture) => fixture.ref.collection("management").doc("campStaff").update({ staffUids: [] }),
  },
  {
    label: "staff con iscrizione annullata",
    type: "camp",
    setup: async (fixture) => {
      const uid = await syntheticUser("staff-cancel", { role: "participant", stakeId });
      await fixture.ref.collection("registrations").doc(`user_${uid}`).set(registrationDoc("Staff3", { registrationStatus: "confirmed" }));
      await fixture.ref.collection("management").doc("campStaff").set({ staffUids: [uid] });
      return { uid };
    },
    revoke: async ({ uid }, fixture) => fixture.ref.collection("registrations").doc(`user_${uid}`).update({ registrationStatus: "cancelled" }),
  },
  {
    label: "staff in elenco su un campeggio che diventa viaggio",
    type: "camp",
    setup: async (fixture) => {
      const uid = await syntheticUser("staff-type", { role: "participant", stakeId });
      await fixture.ref.collection("registrations").doc(`user_${uid}`).set(registrationDoc("Staff4", { registrationStatus: "confirmed" }));
      await fixture.ref.collection("management").doc("campStaff").set({ staffUids: [uid] });
      return { uid };
    },
    revoke: async (_, fixture) => fixture.ref.update({ activityType: "trip" }),
  },
];

for (const scenario of REVOCATIONS) {
  test(`revoca durante il salvataggio: ${scenario.label}`, async () => {
    // Controllo positivo: senza revoca lo stesso identico salvataggio riesce.
    const control = await activity(scenario.type);
    const controlActor = await scenario.setup(control);
    const ok = await saveInProcess(controlActor.uid, control.id, revocationPayload());
    assert.equal(ok.ok, true, "senza revoca il salvataggio riesce (il harness funziona)");
    assert.equal((await control.plan.get()).exists, true);

    const fixture = await activity(scenario.type);
    const actor = await scenario.setup(fixture);
    const seeded = await registrationsOf(fixture);
    const { result, revoked } = await withRevocationBeforePlanTransaction(() => scenario.revoke(actor, fixture), () => saveInProcess(actor.uid, fixture.id, revocationPayload()));
    assert.equal(revoked, true, "la revoca è avvenuta tra il controllo iniziale e la transazione");
    assert.ok(result.error, "il salvataggio revocato deve essere rifiutato");
    assert.equal(result.error.code, "permission-denied");
    assert.equal((await fixture.plan.get()).exists, false, "nessun piano scritto");
    for (const [registrationId, data] of await registrationsOf(fixture)) {
      assert.deepEqual(data.assignedCommittees, seeded.get(registrationId).assignedCommittees, `${registrationId}: nessuna proiezione scritta`);
    }
  });
}

// ---------------------------------------------------------------------------
// Elenco nomi: tetto di 2.000 iscrizioni
// ---------------------------------------------------------------------------

test("elenco nomi: con 2.000 iscrizioni attive le restituisce tutte; oltre il tetto non ne restituisce più di 2.000", { timeout: 240_000 }, async () => {
  const id = `grande-${runId}`;
  const ref = db.doc(`stakes/${stakeId}/activities/${id}`);
  await ref.set({ title: "Attività grande", activityType: "trip", startDate: "2026-11-20" });
  const ids = Array.from({ length: 2000 }, (_, index) => `manual_g${String(index).padStart(4, "0")}`);
  for (let start = 0; start < ids.length; start += 400) {
    const batch = db.batch();
    for (const registrationId of ids.slice(start, start + 400)) {
      batch.set(ref.collection("registrations").doc(registrationId), registrationDoc("Grande", { answers: { medicalNote: SENTINELS.medical } }));
    }
    await batch.commit();
  }
  const exact = await clients.admin.roster(id);
  assert.equal(exact.registrations.length, 2000);
  assert.deepEqual(containsSentinel(exact), []);
  for (const entry of exact.registrations.slice(0, 20)) assert.deepEqual(Object.keys(entry).sort(), ROSTER_FIELDS);

  await ref.collection("registrations").doc("manual_g_extra").set(registrationDoc("Extra"));
  const over = await clients.admin.roster(id).then((value) => ({ value }), (error) => ({ error }));
  if (over.error) {
    assert.equal(over.error.code, "functions/failed-precondition", `oltre il tetto: ${over.error.code} ${over.error.message}`);
  } else {
    assert.ok(over.value.registrations.length <= 2000, `oltre il tetto restituite ${over.value.registrations.length}`);
  }
});
