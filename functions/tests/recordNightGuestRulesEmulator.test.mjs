// Notte dei Record, richieste senza account: rules Firestore provate
// nell'emulatore con utenti veri per ruolo. Riferimento (unica fonte, non il
// codice): docs/NOTTE_DEI_RECORD_SENZA_ACCOUNT.md, sezioni "Principi" (4),
// "Rules" e "Test e review".
//
// Rilancio (solo emulatori, progetto demo-room-planner). Per le sole rules basta
// Firestore; con le callable insieme serve la config completa:
//   firebase emulators:exec --only firestore --config firebase.room-test.json --project demo-room-planner \
//     'node --test --test-concurrency=1 functions/tests/recordNightGuestRulesEmulator.test.mjs'
//   firebase emulators:exec --config firebase.room-test.json --project demo-room-planner \
//     'node --test --test-concurrency=1 functions/tests/recordNightGuestRulesEmulator.test.mjs functions/tests/recordNightGuestEmulator.test.mjs'
// Con le porte occupate da un'altra sessione non fermarla: copia la config su
// porte diverse e rimuovi i file temporanei a fine prova.
//
// Cosa si prova:
//  1. recordRequests (stakes/{s}/activities/{a}/recordRequests/{id}) non si
//     legge e non si scrive da nessuno: admin, super_admin, dirigente di unità,
//     staff scelto, partecipante, genitore, estraneo, altro palo, utente senza
//     profilo, sessione anonima (anche quella che ha inviato la richiesta e
//     quella in elenco staff) e non autenticato. Documenti creati via Admin SDK.
//     Query provate: get, list intera, where anonUid/status/personKey,
//     collectionGroup, create, addDoc, update, delete, batch.
//  2. records e recordEntries restano illeggibili per anonimi e non loggati
//     (l'elenco pubblico passa SOLO dalla callable `context`).
//  3. units attive restano leggibili senza login; le inattive no.
//  4. recordsGuestEnabled sull'attività lo scrive solo l'admin del palo (le
//     rules dell'attività non hanno allowlist: nessuna modifica attesa).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { deleteApp, initializeApp } from "firebase/app";
import {
  addDoc,
  collection,
  collectionGroup,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  getFirestore,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

const require = createRequire(import.meta.url);
const { initializeApp: initializeAdminApp, getApps } = require("firebase-admin/app");
const { getFirestore: getAdminFirestore, Timestamp } = require("firebase-admin/firestore");

const PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
assert.match(PROJECT, /^demo-/u, "Usare esclusivamente un progetto demo-*");
assert.match(FIRESTORE_HOST, /^(127\.0\.0\.1|localhost):\d+$/u, "Firestore Emulator locale richiesto");
const [emulatorHost, emulatorPort] = FIRESTORE_HOST.split(":");

if (getApps().length === 0) initializeAdminApp({ projectId: PROJECT });
const adminDb = getAdminFirestore();
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const stakeId = `guest-rules-${runId}`;
const activityId = "night";
const activityPath = `stakes/${stakeId}/activities/${activityId}`;
const otherActivityPath = `stakes/${stakeId}/activities/other-night`;
const uid = (name) => `${name}-${runId}`;

const NOW = "2026-10-10T10:00:00.000Z";
const closeAt = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
const participantProfile = { role: "participant", stakeId };

// [attore, nome utente (uid), provider, profilo users/{uid} | null]
const ACTORS = [
  ["admin", "admin", "password", { role: "admin", stakeId }],
  ["superAdmin", "super", "password", { role: "super_admin", stakeId: "other-stake" }],
  ["otherAdmin", "other-admin", "password", { role: "admin", stakeId: "other-stake" }],
  ["unitLeader", "leader", "password", { role: "unit_leader", stakeId, unitId: "unit-a" }],
  ["unitLeaderOther", "leader-other", "password", { role: "unit_leader", stakeId: "other-stake", unitId: "unit-9" }],
  // Staff scelto: uid in management/recordNight.staffUids dell'attività.
  ["listedStaff", "listed-staff", "password", participantProfile],
  ["youthA", "youth-a", "password", participantProfile],
  ["parent", "parent", "password", { role: "parent", stakeId }],
  // Stesso palo, mai iscritto all'attività.
  ["outsider", "outsider", "password", participantProfile],
  ["otherStake", "other-stake-user", "password", { role: "participant", stakeId: "other-stake" }],
  ["noProfile", "no-profile", "password", null],
  // Sessione anonima che ha inviato le richieste seminate: nemmeno lei le legge.
  ["anonOwner", "anon-owner", "anonymous", null],
  ["anonOther", "anon-other", "anonymous", null],
  // Caso peggiore: anonimo con un profilo che punta al palo giusto e uid in elenco staff.
  ["anonListed", "anon-listed", "anonymous", participantProfile],
  ["signedOut", null, null, null],
];
const ALL_ACTORS = ACTORS.map(([actor]) => actor);
const clients = {};

const requests = (db, path = activityPath) => collection(db, `${path}/recordRequests`);
const requestDoc = (db, id, path = activityPath) => doc(db, `${path}/recordRequests/${id}`);
const records = (db) => collection(db, `${activityPath}/records`);
const recordDoc = (db, id) => doc(db, `${activityPath}/records/${id}`);
const entries = (db) => collection(db, `${activityPath}/recordEntries`);
const entryDoc = (db, id) => doc(db, `${activityPath}/recordEntries/${id}`);
const activityRef = (db) => doc(db, activityPath);
const unitsCol = (db) => collection(db, `stakes/${stakeId}/units`);
const unitDoc = (db, id) => doc(db, `stakes/${stakeId}/units/${id}`);

// Documento richiesta come lo descrive la spec (tabella "Richiesta").
const requestSeed = (extra) => ({
  anonUid: uid("anon-owner"),
  submissionId: "11111111-1111-4111-8111-111111111111",
  firstName: "Maria",
  lastName: "Rossi",
  unitId: "unit-a",
  unitName: "Rione Alfa",
  personKey: "maria rossi|unit-a",
  kind: "proposal",
  proposedText: "Salti con la corda",
  proposedMeasure: "count_in_time",
  proposedDurationSeconds: 30,
  proposedNeeds: "",
  recordId: null,
  status: "open",
  staffNote: "NOTA INTERNA",
  createdAt: NOW,
  updatedAt: NOW,
  expiresAt: Timestamp.fromDate(new Date("2026-10-23T00:00:00.000Z")),
  ...extra,
});
const SEEDED_REQUESTS = {
  "req-open": requestSeed({}),
  "req-challenge": requestSeed({
    submissionId: "22222222-2222-4222-8222-222222222222",
    kind: "challenge",
    proposedText: null,
    proposedMeasure: null,
    proposedDurationSeconds: null,
    recordId: "r-open",
    firstName: "Luca",
    lastName: "Bianchi",
    personKey: "luca bianchi|unit-a",
  }),
  "req-linked": requestSeed({
    anonUid: uid("anon-other"),
    submissionId: "33333333-3333-4333-8333-333333333333",
    status: "linked",
    linkedRegistrationId: `user_${uid("youth-a")}`,
    linkedEntryId: "e-guest",
    linkedBy: uid("admin"),
    linkedAt: NOW,
  }),
  "req-rejected": requestSeed({
    anonUid: uid("anon-other"),
    submissionId: "44444444-4444-4444-8444-444444444444",
    status: "rejected",
    decidedBy: uid("admin"),
    decidedAt: NOW,
  }),
  "req-withdrawn": requestSeed({ submissionId: "55555555-5555-4555-8555-555555555555", status: "withdrawn" }),
};
const recordSeed = (extra) => ({
  title: "Salti a piedi uniti in 60 secondi",
  category: "resistenza",
  measure: "count_in_time",
  durationSeconds: 60,
  notes: "",
  challengerCount: 2,
  status: "open",
  createdFromEntryId: null,
  createdAt: NOW,
  updatedAt: NOW,
  createdBy: uid("admin"),
  ...extra,
});
const SEEDED_RECORDS = {
  "r-open": recordSeed({}),
  "r-hidden": recordSeed({ title: "Record nascosto", status: "hidden", challengerCount: 0 }),
  "r-zero": recordSeed({ title: "Record senza iscritti", challengerCount: 0 }),
};
const SEEDED_ENTRIES = {
  // Tentativo nato da una richiesta senza account: stesso modello di sempre, due campi in più.
  "e-guest": {
    registrationId: `user_${uid("youth-a")}`,
    ownerUid: uid("youth-a"),
    participantName: "Anna Prima",
    kind: "challenge",
    proposedText: null,
    proposedMeasure: null,
    proposedDurationSeconds: null,
    proposedNeeds: "",
    recordId: "r-open",
    status: "approved",
    statusBeforeWithdraw: null,
    withdrawnBy: null,
    withdrawnWithRecordHide: false,
    rejectionReason: "",
    createdByAdmin: true,
    sourceRequestId: "req-linked",
    fromGuestRequest: true,
    createdAt: NOW,
    updatedAt: NOW,
    decidedAt: NOW,
    decidedBy: uid("admin"),
  },
};
const UNITS = {
  "unit-a": { name: "Rione Alfa", type: "rione", isActive: true, createdAt: NOW, updatedAt: NOW },
  "unit-b": { name: "Rione Beta", type: "rione", isActive: true, createdAt: NOW, updatedAt: NOW },
  "unit-off": { name: "Rione Spento", type: "rione", isActive: false, createdAt: NOW, updatedAt: NOW },
};
const ACTIVE_UNIT_IDS = Object.entries(UNITS).filter(([, data]) => data.isActive).map(([id]) => id).sort();

before(async () => {
  const seeds = [
    adminDb.doc(activityPath).set({
      title: "Viaggio al tempio",
      activityType: "trip",
      isPublic: true,
      isVisible: true,
      status: "registrations_open",
      startDate: "2026-10-16",
      recordsEnabled: true,
      recordsGuestEnabled: true,
      recordsCloseAt: closeAt,
    }),
    adminDb.doc(otherActivityPath).set({ title: "Altra attività", activityType: "trip", recordsEnabled: true }),
    adminDb.doc(`${activityPath}/management/recordNight`).set({
      staffUids: [uid("listed-staff"), uid("anon-listed")],
      updatedAt: NOW,
      updatedBy: uid("admin"),
    }),
    // Una richiesta anche nell'altra attività: lo staff di quella non entra qui e viceversa.
    adminDb.doc(`${otherActivityPath}/recordRequests/req-elsewhere`).set(requestSeed({})),
  ];
  for (const [, name, , profile] of ACTORS) {
    if (name && profile) seeds.push(adminDb.doc(`users/${uid(name)}`).set(profile));
  }
  for (const [id, data] of Object.entries(SEEDED_REQUESTS)) seeds.push(adminDb.doc(`${activityPath}/recordRequests/${id}`).set(data));
  for (const [id, data] of Object.entries(SEEDED_RECORDS)) seeds.push(adminDb.doc(`${activityPath}/records/${id}`).set(data));
  for (const [id, data] of Object.entries(SEEDED_ENTRIES)) seeds.push(adminDb.doc(`${activityPath}/recordEntries/${id}`).set(data));
  for (const [id, data] of Object.entries(UNITS)) seeds.push(adminDb.doc(`stakes/${stakeId}/units/${id}`).set(data));
  await Promise.all(seeds);

  for (const [actor, name, provider] of ACTORS) {
    const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT }, `${actor}-${runId}`);
    const firestore = getFirestore(app);
    const options = name ? { mockUserToken: { sub: uid(name), firebase: { sign_in_provider: provider } } } : {};
    connectFirestoreEmulator(firestore, emulatorHost, Number(emulatorPort), options);
    clients[actor] = { app, firestore, uid: name ? uid(name) : null };
  }
});

after(async () => {
  await Promise.all(Object.values(clients).map(({ app }) => deleteApp(app)));
  await adminDb.recursiveDelete(adminDb.doc(`stakes/${stakeId}`));
  await Promise.all(
    ACTORS.filter(([, name, , profile]) => name && profile).map(([, name]) => adminDb.doc(`users/${uid(name)}`).delete()),
  );
  await adminDb.terminate();
});

async function expectDenied(attempt) {
  await assert.rejects(attempt, (error) => {
    assert.equal(error?.code, "permission-denied", `atteso permission-denied, ricevuto ${error?.code}: ${error?.message}`);
    return true;
  });
}

// ---------------------------------------------------------------------------
// 0. Il file rules compila e ha il match esplicito (il gate delle rules lo richiede)
// ---------------------------------------------------------------------------

const RULES_SOURCE = () => readFileSync(process.env.RECORD_NIGHT_GUEST_RULES_FILE || new URL("../../firestore.rules", import.meta.url), "utf8");

test("firestore.rules compila nell'emulatore senza errori", async () => {
  // RECORD_NIGHT_GUEST_RULES_FILE serve solo a provare che il test sappia fallire su rules sbagliate:
  // il PUT sostituisce il ruleset dell'emulatore, quindi i test seguenti girano con quel file.
  const content = RULES_SOURCE();
  const response = await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT}:securityRules`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content }] } }),
  });
  const body = await response.text();
  assert.equal(response.status, 200, `Compilazione rules fallita: ${body}`);
  assert.doesNotMatch(body, /error/iu, `L'emulatore segnala errori: ${body}`);
});

test("spec: il match /recordRequests/{requestId} è esplicito e dice solo `if false`", () => {
  const content = RULES_SOURCE().replace(/\/\/.*$/gmu, "");
  const start = content.indexOf("match /recordRequests/{requestId}");
  assert.ok(start >= 0, "match /recordRequests/{requestId} assente dalle rules: il gate lo richiede");
  const open = content.indexOf("{", content.indexOf("{requestId}", start) + "{requestId}".length);
  let depth = 0;
  let end = -1;
  for (let index = open; index < content.length; index += 1) {
    if (content[index] === "{") depth += 1;
    if (content[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  assert.ok(end > open, "blocco del match non chiuso");
  const block = content.slice(open + 1, end);
  const allows = [...block.matchAll(/allow\s+([^:]+):\s*if\s+([^;]+);/gu)];
  assert.ok(allows.length >= 1, "nessuna regola dentro il match");
  for (const [, operations, condition] of allows) {
    assert.equal(condition.trim(), "false", `allow ${operations.trim()} non è \`if false\`: ${condition.trim()}`);
  }
  assert.doesNotMatch(block, /match\s+\//u, "match annidati dentro recordRequests");
  // Nessuna lettura di richieste anche a livello di collectionGroup.
  assert.doesNotMatch(content, /\{path=\*\*\}\/recordRequests/u, "collectionGroup su recordRequests concesso");
});

// ---------------------------------------------------------------------------
// 1. recordRequests: nessuna lettura per nessuno, nemmeno chi l'ha inviata
// ---------------------------------------------------------------------------

function readAttempts(actor) {
  const db = clients[actor].firestore;
  const me = clients[actor].uid ?? "nobody";
  return [
    ["get di una richiesta aperta", () => getDocFromServer(requestDoc(db, "req-open"))],
    ["get di una sfida", () => getDocFromServer(requestDoc(db, "req-challenge"))],
    ["get di una richiesta collegata", () => getDocFromServer(requestDoc(db, "req-linked"))],
    ["get di una richiesta rifiutata", () => getDocFromServer(requestDoc(db, "req-rejected"))],
    ["get di una richiesta ritirata", () => getDocFromServer(requestDoc(db, "req-withdrawn"))],
    ["get di un id che non esiste", () => getDocFromServer(requestDoc(db, "req-non-esiste"))],
    ["get di una richiesta di un'altra attività", () => getDocFromServer(requestDoc(db, "req-elsewhere", otherActivityPath))],
    ["list della collection intera", () => getDocsFromServer(requests(db))],
    ["list where anonUid == proprio uid", () => getDocsFromServer(query(requests(db), where("anonUid", "==", me)))],
    ["list where anonUid == uid del titolare delle richieste", () => getDocsFromServer(query(requests(db), where("anonUid", "==", uid("anon-owner"))))],
    ["list where status == open", () => getDocsFromServer(query(requests(db), where("status", "==", "open")))],
    ["list where status == linked", () => getDocsFromServer(query(requests(db), where("status", "==", "linked")))],
    ["list where personKey == ...", () => getDocsFromServer(query(requests(db), where("personKey", "==", "maria rossi|unit-a")))],
    ["list where anonUid + status", () => getDocsFromServer(query(requests(db), where("anonUid", "==", me), where("status", "==", "open")))],
    ["list nell'altra attività", () => getDocsFromServer(requests(db, otherActivityPath))],
    ["collectionGroup intero", () => getDocsFromServer(collectionGroup(db, "recordRequests"))],
    ["collectionGroup where anonUid == proprio uid", () => getDocsFromServer(query(collectionGroup(db, "recordRequests"), where("anonUid", "==", me)))],
    ["collectionGroup where status == open", () => getDocsFromServer(query(collectionGroup(db, "recordRequests"), where("status", "==", "open")))],
  ];
}

for (const actor of ALL_ACTORS) {
  test(`recordRequests: nessuna lettura passa (${actor})`, async () => {
    const leaked = [];
    for (const [label, attempt] of readAttempts(actor)) {
      try {
        await attempt();
        leaked.push(`${label}: LETTURA RIUSCITA`);
      } catch (error) {
        if (error?.code !== "permission-denied") leaked.push(`${label}: errore diverso da permission-denied (${error?.code}: ${error?.message})`);
      }
    }
    assert.deepEqual(leaked, [], `Letture non negate per ${actor}:\n${leaked.join("\n")}`);
  });
}

// ---------------------------------------------------------------------------
// 2. recordRequests: nessuna scrittura per nessuno, nemmeno l'admin
// ---------------------------------------------------------------------------

function writeAttempts(actor) {
  const db = clients[actor].firestore;
  const me = clients[actor].uid ?? "nobody";
  // Il client SDK accetta solo il suo Timestamp o una Date (non quello di firebase-admin).
  const mine = requestSeed({
    anonUid: me,
    submissionId: "99999999-9999-4999-8999-999999999999",
    expiresAt: new Date("2026-10-23T00:00:00.000Z"),
  });
  return [
    ["create con id fisso (proprio uid come anonUid)", () => setDoc(requestDoc(db, "req-new"), mine)],
    ["create con id automatico", () => addDoc(requests(db), mine)],
    ["create già collegata (status linked)", () => setDoc(requestDoc(db, "req-new-linked"), { ...mine, status: "linked", linkedRegistrationId: `user_${me}` })],
    ["create con scadenza lontanissima", () => setDoc(requestDoc(db, "req-new-ttl"), { ...mine, expiresAt: new Date("2099-01-01T00:00:00.000Z") })],
    ["create nell'altra attività", () => setDoc(requestDoc(db, "req-new-elsewhere", otherActivityPath), mine)],
    ["create in batch", () => {
      const batch = writeBatch(db);
      batch.set(requestDoc(db, "req-batch"), mine);
      return batch.commit();
    }],
    ["sovrascrive una richiesta esistente", () => setDoc(requestDoc(db, "req-open"), { ...mine, firstName: "Hack" })],
    ["update status verso withdrawn (ritiro dal client)", () => updateDoc(requestDoc(db, "req-open"), { status: "withdrawn" })],
    ["update status verso open (ripristino dal client)", () => updateDoc(requestDoc(db, "req-withdrawn"), { status: "open" })],
    ["update status verso linked", () => updateDoc(requestDoc(db, "req-open"), { status: "linked", linkedRegistrationId: `user_${me}` })],
    ["update di staffNote", () => updateDoc(requestDoc(db, "req-open"), { staffNote: "Hack" })],
    ["update di anonUid", () => updateDoc(requestDoc(db, "req-linked"), { anonUid: me })],
    ["update della scadenza", () => updateDoc(requestDoc(db, "req-open"), { expiresAt: new Date("2099-01-01T00:00:00.000Z") })],
    ["delete", () => deleteDoc(requestDoc(db, "req-open"))],
    ["delete di una richiesta collegata", () => deleteDoc(requestDoc(db, "req-linked"))],
    ["delete in batch", () => {
      const batch = writeBatch(db);
      batch.delete(requestDoc(db, "req-rejected"));
      return batch.commit();
    }],
  ];
}

for (const actor of ALL_ACTORS) {
  test(`recordRequests: nessuna scrittura passa (${actor})`, async () => {
    const leaked = [];
    for (const [label, attempt] of writeAttempts(actor)) {
      try {
        await attempt();
        leaked.push(`${label}: SCRITTURA RIUSCITA`);
      } catch (error) {
        if (error?.code !== "permission-denied") leaked.push(`${label}: errore diverso da permission-denied (${error?.code}: ${error?.message})`);
      }
    }
    assert.deepEqual(leaked, [], `Scritture non negate per ${actor}:\n${leaked.join("\n")}`);
  });
}

test("dopo le prove le richieste seminate sono intatte e non ne è nata nessuna", async () => {
  const snap = await adminDb.collection(`${activityPath}/recordRequests`).get();
  assert.deepEqual(snap.docs.map((item) => item.id).sort(), Object.keys(SEEDED_REQUESTS).sort(), "richieste create o cancellate dai client");
  for (const item of snap.docs) assert.deepEqual(item.data(), SEEDED_REQUESTS[item.id], `richiesta ${item.id} modificata`);
  const elsewhere = await adminDb.collection(`${otherActivityPath}/recordRequests`).get();
  assert.deepEqual(elsewhere.docs.map((item) => item.id), ["req-elsewhere"]);
  assert.deepEqual(elsewhere.docs[0].data(), requestSeed({}));
});

// ---------------------------------------------------------------------------
// 3. records e recordEntries: anonimi e non loggati non leggono niente
//    (l'elenco senza account esce solo dalla callable `context`)
// ---------------------------------------------------------------------------

const NO_ACCOUNT_ACTORS = ["anonOwner", "anonOther", "anonListed", "signedOut"];

for (const actor of NO_ACCOUNT_ACTORS) {
  test(`records e recordEntries: ${actor} non legge niente`, async () => {
    const db = clients[actor].firestore;
    const me = clients[actor].uid ?? "nobody";
    const attempts = [
      ["records: list where status == open (la query del partecipante)", () => getDocsFromServer(query(records(db), where("status", "==", "open")))],
      ["records: list intera", () => getDocsFromServer(records(db))],
      ["records: get di un record aperto", () => getDocFromServer(recordDoc(db, "r-open"))],
      ["records: get di un record aperto senza iscritti", () => getDocFromServer(recordDoc(db, "r-zero"))],
      ["records: list where challengerCount > 0", () => getDocsFromServer(query(records(db), where("challengerCount", ">", 0)))],
      ["records: collectionGroup", () => getDocsFromServer(collectionGroup(db, "records"))],
      ["records: collectionGroup where status == open", () => getDocsFromServer(query(collectionGroup(db, "records"), where("status", "==", "open")))],
      ["recordEntries: list intera", () => getDocsFromServer(entries(db))],
      ["recordEntries: list where ownerUid == proprio uid", () => getDocsFromServer(query(entries(db), where("ownerUid", "==", me)))],
      ["recordEntries: list where ownerUid == titolare di un tentativo da richiesta", () => getDocsFromServer(query(entries(db), where("ownerUid", "==", uid("youth-a"))))],
      ["recordEntries: list where fromGuestRequest == true", () => getDocsFromServer(query(entries(db), where("fromGuestRequest", "==", true)))],
      ["recordEntries: get di un tentativo da richiesta", () => getDocFromServer(entryDoc(db, "e-guest"))],
      ["recordEntries: collectionGroup", () => getDocsFromServer(collectionGroup(db, "recordEntries"))],
    ];
    const leaked = [];
    for (const [label, attempt] of attempts) {
      try {
        await attempt();
        leaked.push(`${label}: LETTURA RIUSCITA`);
      } catch (error) {
        if (error?.code !== "permission-denied") leaked.push(`${label}: errore diverso da permission-denied (${error?.code}: ${error?.message})`);
      }
    }
    assert.deepEqual(leaked, [], `Letture non negate per ${actor}:\n${leaked.join("\n")}`);
  });
}

test("records e recordEntries: nessuna scrittura da anonimi e non loggati", async () => {
  const leaked = [];
  for (const actor of NO_ACCOUNT_ACTORS) {
    const db = clients[actor].firestore;
    const attempts = [
      ["records: create", () => setDoc(recordDoc(db, "r-new"), recordSeed({ challengerCount: 1 }))],
      ["records: update del contatore", () => updateDoc(recordDoc(db, "r-open"), { challengerCount: 99 })],
      ["records: delete", () => deleteDoc(recordDoc(db, "r-open"))],
      ["recordEntries: create", () => setDoc(entryDoc(db, "e-new"), { ...SEEDED_ENTRIES["e-guest"], ownerUid: clients[actor].uid })],
      ["recordEntries: update dello stato", () => updateDoc(entryDoc(db, "e-guest"), { status: "withdrawn" })],
      ["recordEntries: delete", () => deleteDoc(entryDoc(db, "e-guest"))],
    ];
    for (const [label, attempt] of attempts) {
      try {
        await attempt();
        leaked.push(`${actor} / ${label}: SCRITTURA RIUSCITA`);
      } catch (error) {
        if (error?.code !== "permission-denied") leaked.push(`${actor} / ${label}: ${error?.code}`);
      }
    }
  }
  assert.deepEqual(leaked, [], leaked.join("\n"));
  const [recordSnap, entrySnap] = await Promise.all([
    adminDb.collection(`${activityPath}/records`).get(),
    adminDb.collection(`${activityPath}/recordEntries`).get(),
  ]);
  assert.deepEqual(recordSnap.docs.map((item) => item.id).sort(), Object.keys(SEEDED_RECORDS).sort());
  assert.deepEqual(entrySnap.docs.map((item) => item.id).sort(), Object.keys(SEEDED_ENTRIES).sort());
  for (const item of recordSnap.docs) assert.deepEqual(item.data(), SEEDED_RECORDS[item.id], `record ${item.id} modificato`);
  for (const item of entrySnap.docs) assert.deepEqual(item.data(), SEEDED_ENTRIES[item.id], `tentativo ${item.id} modificato`);
});

// Il comportamento di sempre non cambia per chi ha un account: nessuna regressione.
test("regressione: un ragazzo del palo legge ancora i record aperti e il tentativo da richiesta di cui è titolare", async () => {
  const open = await getDocsFromServer(query(records(clients.youthA.firestore), where("status", "==", "open")));
  assert.deepEqual(open.docs.map((item) => item.id).sort(), ["r-open", "r-zero"]);
  const own = await getDocsFromServer(query(entries(clients.youthA.firestore), where("ownerUid", "==", clients.youthA.uid)));
  assert.deepEqual(own.docs.map((item) => item.id), ["e-guest"]);
  assert.equal(own.docs[0].data().fromGuestRequest, true);
  // Non vede i tentativi degli altri.
  await expectDenied(getDocsFromServer(entries(clients.youthA.firestore)));
  // Lo staff legge tutto come prima.
  const staffEntries = await getDocsFromServer(entries(clients.listedStaff.firestore));
  assert.equal(staffEntries.size, 1);
  const adminRecords = await getDocsFromServer(records(clients.admin.firestore));
  assert.equal(adminRecords.size, Object.keys(SEEDED_RECORDS).length);
});

// ---------------------------------------------------------------------------
// 4. units: le attive restano leggibili senza login (comportamento esistente)
// ---------------------------------------------------------------------------

for (const actor of ["signedOut", "anonOwner", "anonListed", "noProfile", "youthA", "outsider", "otherStake"]) {
  test(`units: ${actor} legge le attive e non le inattive`, async () => {
    const db = clients[actor].firestore;
    const active = await getDocFromServer(unitDoc(db, "unit-a"));
    assert.equal(active.exists(), true);
    assert.equal(active.data().isActive, true);
    assert.equal(active.data().name, "Rione Alfa");
    const listed = await getDocsFromServer(query(unitsCol(db), where("isActive", "==", true)));
    assert.deepEqual(listed.docs.map((item) => item.id).sort(), ACTIVE_UNIT_IDS);
    await expectDenied(getDocFromServer(unitDoc(db, "unit-off")));
    await expectDenied(getDocsFromServer(unitsCol(db)));
    await expectDenied(getDocsFromServer(query(unitsCol(db), where("isActive", "==", false))));
  });
}

// isStakeAdmin vale per l'admin del palo e per ogni super_admin (ruolo globale).
test("units: admin e super_admin leggono anche le inattive; nessun altro scrive", async () => {
  for (const actor of ["admin", "superAdmin"]) {
    const adminUnits = await getDocsFromServer(unitsCol(clients[actor].firestore));
    assert.equal(adminUnits.size, Object.keys(UNITS).length, actor);
    assert.equal((await getDocFromServer(unitDoc(clients[actor].firestore, "unit-off"))).exists(), true, actor);
  }
  const leaked = [];
  for (const actor of ALL_ACTORS.filter((name) => name !== "admin" && name !== "superAdmin")) {
    const db = clients[actor].firestore;
    const attempts = [
      ["create", () => setDoc(unitDoc(db, "unit-intrusa"), { name: "Intrusa", type: "rione", isActive: true, createdAt: NOW, updatedAt: NOW })],
      ["update del nome", () => updateDoc(unitDoc(db, "unit-a"), { name: "Manomessa" })],
      ["riattiva una inattiva", () => updateDoc(unitDoc(db, "unit-off"), { isActive: true })],
      ["delete", () => deleteDoc(unitDoc(db, "unit-b"))],
    ];
    for (const [label, attempt] of attempts) {
      try {
        await attempt();
        leaked.push(`${actor} / ${label}: SCRITTURA RIUSCITA`);
      } catch (error) {
        if (error?.code !== "permission-denied") leaked.push(`${actor} / ${label}: ${error?.code}`);
      }
    }
  }
  assert.deepEqual(leaked, [], leaked.join("\n"));
  const after = await adminDb.collection(`stakes/${stakeId}/units`).get();
  assert.deepEqual(after.docs.map((item) => item.id).sort(), Object.keys(UNITS).sort());
  for (const item of after.docs) assert.deepEqual(item.data(), UNITS[item.id], `unità ${item.id} modificata`);
});

// ---------------------------------------------------------------------------
// 5. recordsGuestEnabled sull'attività: lo scrive l'admin dell'editor, nessuno
//    altro (lo staff dei record non guadagna questo permesso)
// ---------------------------------------------------------------------------

test("admin del palo scrive recordsGuestEnabled sull'attività (nessuna modifica alle rules richiesta)", async () => {
  await updateDoc(activityRef(clients.admin.firestore), { recordsGuestEnabled: false });
  await updateDoc(activityRef(clients.admin.firestore), { recordsGuestEnabled: true });
  const snap = await adminDb.doc(activityPath).get();
  assert.equal(snap.data().recordsGuestEnabled, true);
  assert.equal(snap.data().recordsEnabled, true);
});

for (const actor of ["youthA", "parent", "unitLeader", "listedStaff", "outsider", "otherAdmin", "unitLeaderOther", "anonOwner", "anonListed", "signedOut"]) {
  test(`${actor} non scrive recordsGuestEnabled sull'attività`, async () => {
    await expectDenied(updateDoc(activityRef(clients[actor].firestore), { recordsGuestEnabled: false }));
    await expectDenied(updateDoc(activityRef(clients[actor].firestore), { recordsGuestEnabled: true, recordsEnabled: true }));
    assert.equal((await adminDb.doc(activityPath).get()).data().recordsGuestEnabled, true);
  });
}

// ---------------------------------------------------------------------------
// 6. Indici e TTL (statico): query solo su uguaglianza, nessun indice composito;
//    il TTL su expiresAt, se dichiarato in questo file, è sul campo giusto.
//    La spec ammette anche la dichiarazione via REST: in quel caso resta un
//    controllo esplicito sulla produzione (policy attiva), non verificabile qui.
// ---------------------------------------------------------------------------

test("indici: nessun indice composito per recordRequests; TTL su expiresAt (collection group) se dichiarato", (t) => {
  const file = JSON.parse(readFileSync(new URL("../../firestore.indexes.json", import.meta.url), "utf8"));
  const composite = (file.indexes ?? []).filter((index) => index.collectionGroup === "recordRequests");
  assert.deepEqual(composite, [], "recordRequests si interroga solo per uguaglianza (anonUid, status, personKey): nessun indice composito");
  const overrides = (file.fieldOverrides ?? []).filter((item) => item.collectionGroup === "recordRequests");
  for (const override of overrides) {
    assert.equal(override.fieldPath, "expiresAt", "l'unico override di recordRequests è il TTL su expiresAt");
    assert.equal(override.ttl, true, "il TTL su expiresAt deve essere attivo (ttl: true)");
  }
  if (overrides.length === 0) t.diagnostic("TTL non dichiarato in firestore.indexes.json: va attivato via REST e verificato in produzione prima di dichiarare fatto");
});
