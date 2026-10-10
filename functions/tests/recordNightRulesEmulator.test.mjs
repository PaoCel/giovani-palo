// Notte dei Record: rules Firestore provate nell'emulatore con le query ESATTE
// del client (src/services/firestore/recordNightService.ts) e utenti veri per
// ruolo. Riferimento: docs/NOTTE_DEI_RECORD.md, sezioni "Chi può fare cosa" e
// "Firestore rules".
//
// Rilancio (solo emulatori, progetto demo-room-planner), insieme alle callable:
//   firebase emulators:exec --config firebase.room-test.json --project demo-room-planner \
//     'node --test --test-concurrency=1 functions/tests/recordNightRulesEmulator.test.mjs functions/tests/recordNightEmulator.test.mjs'
//
// Staff = admin/super_admin del palo, unit_leader dello stesso palo, uid in
// stakes/{s}/activities/{a}/management/recordNight.staffUids (lo scrive solo il
// server su richiesta di un admin). Legge tutti i record e tutti i tentativi.
// genderRoleCategory NON dà permessi: chi si iscrive "come accompagnatore" non è staff.
// Tutti gli altri: record solo `open` con where status == 'open'; tentativi solo
// con where ownerUid == proprio uid (un genitore vede quelli dei figli).
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
const { getFirestore: getAdminFirestore } = require("firebase-admin/firestore");

const PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
assert.match(PROJECT, /^demo-/u, "Usare esclusivamente un progetto demo-*");
assert.match(FIRESTORE_HOST, /^(127\.0\.0\.1|localhost):\d+$/u, "Firestore Emulator locale richiesto");
const [emulatorHost, emulatorPort] = FIRESTORE_HOST.split(":");

if (getApps().length === 0) initializeAdminApp({ projectId: PROJECT });
const adminDb = getAdminFirestore();
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const stakeId = `record-rules-${runId}`;
const activityId = "night";
const activityPath = `stakes/${stakeId}/activities/${activityId}`;
const otherActivityPath = `stakes/${stakeId}/activities/other-night`;
const uid = (name) => `${name}-${runId}`;

const closeAt = new Date(Date.now() + 48 * 3600 * 1000).toISOString();

const participantProfile = { role: "participant", stakeId };
// [attore, nome utente (uid), provider, profilo users/{uid} | null]
const ACTORS = [
  ["admin", "admin", "password", { role: "admin", stakeId }],
  ["superAdmin", "super", "password", { role: "super_admin", stakeId: "other-stake" }],
  ["otherAdmin", "other-admin", "password", { role: "admin", stakeId: "other-stake" }],
  ["youthA", "youth-a", "password", participantProfile],
  ["youthB", "youth-b", "password", participantProfile],
  // Stesso palo, mai iscritto all'attività: l'elenco lo vede lo stesso.
  ["outsider", "outsider", "password", participantProfile],
  ["unitLeader", "leader", "password", { role: "unit_leader", stakeId, unitId: "unit-1" }],
  ["unitLeaderOther", "leader-other", "password", { role: "unit_leader", stakeId: "other-stake", unitId: "unit-9" }],
  ["parent", "parent", "password", { role: "parent", stakeId }],
  ["parent2", "parent-2", "password", { role: "parent", stakeId }],
  ["otherStake", "other-stake-user", "password", { role: "participant", stakeId: "other-stake" }],
  // Utente autenticato senza documento users/{uid}.
  ["noProfile", "no-profile", "password", null],
  // Caso peggiore: anonimo con un profilo che punta al palo giusto.
  ["anonymous", "anon", "anonymous", participantProfile],
  ["signedOut", null, null, null],
  // Iscritti che si dichiarano dirigente/accompagnatore: la categoria non dà permessi.
  ["adultLeader", "adult-leader", "password", participantProfile],
  ["adultCompanion", "adult-companion", "password", participantProfile],
  ["youthAccompanist", "youth-accompanist", "password", participantProfile],
  // In elenco (management/recordNight.staffUids): questi sì gestiscono i record.
  ["listedStaff", "listed-staff", "password", participantProfile],
  ["listedAnon", "listed-anon", "anonymous", participantProfile],
  // In elenco, ma di un'altra attività dello stesso palo.
  ["listedElsewhere", "listed-elsewhere", "password", participantProfile],
  ["adultOtherStake", "adult-other-stake", "password", { role: "participant", stakeId: "other-stake" }],
];
const clients = {};

const records = (db) => collection(db, `${activityPath}/records`);
const recordDoc = (db, id) => doc(db, `${activityPath}/records/${id}`);
const entries = (db) => collection(db, `${activityPath}/recordEntries`);
const entryDoc = (db, id) => doc(db, `${activityPath}/recordEntries/${id}`);
const activityRef = (db) => doc(db, activityPath);
const staffDoc = (db) => doc(db, `${activityPath}/management/recordNight`);

const NOW = "2026-10-09T10:00:00.000Z";
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
const entrySeed = (extra) => ({
  registrationId: "user_x",
  ownerUid: uid("youth-a"),
  participantName: "Nome Cognome",
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
  createdByAdmin: false,
  createdAt: NOW,
  updatedAt: NOW,
  decidedAt: NOW,
  decidedBy: null,
  ...extra,
});

const SEEDED_RECORDS = {
  "r-open": recordSeed({}),
  "r-hidden": recordSeed({ title: "Record nascosto", status: "hidden", challengerCount: 0 }),
  // Nascosto ma con iscritti: nascondere un record non lo rende leggibile.
  "r-hidden-full": recordSeed({ title: "Record nascosto con iscritti", status: "hidden", challengerCount: 2 }),
  "r-zero": recordSeed({ title: "Record senza iscritti", challengerCount: 0 }),
};
const OPEN_RECORD_IDS = Object.entries(SEEDED_RECORDS).filter(([, data]) => data.status === "open").map(([id]) => id).sort();
const SEEDED_ENTRIES = {
  "e-a-challenge": entrySeed({
    registrationId: `user_${uid("youth-a")}`,
    ownerUid: uid("youth-a"),
    participantName: "Anna Prima",
  }),
  "e-a-proposal": entrySeed({
    registrationId: `user_${uid("youth-a")}`,
    ownerUid: uid("youth-a"),
    participantName: "Anna Prima",
    kind: "proposal",
    proposedText: "Salto con la corda",
    proposedMeasure: "count_streak",
    recordId: null,
    status: "pending",
  }),
  "e-b-challenge": entrySeed({
    registrationId: `user_${uid("youth-b")}`,
    ownerUid: uid("youth-b"),
    participantName: "Bruno Secondo",
  }),
  // Figlio senza account: il tentativo è del genitore (ownerUid = uid del genitore).
  "e-child": entrySeed({
    registrationId: `child_${uid("parent")}_kid1`,
    ownerUid: uid("parent"),
    participantName: "Carlo Terzo",
    createdByAdmin: true,
    decidedBy: uid("admin"),
  }),
  "e-child-2": entrySeed({
    registrationId: `child_${uid("parent-2")}_kid1`,
    ownerUid: uid("parent-2"),
    participantName: "Dario Quarto",
  }),
  // Dato vecchio, senza titolare: lo vede solo lo staff.
  "e-legacy-null": entrySeed({
    registrationId: `child_${uid("parent")}_kid0`,
    ownerUid: null,
    participantName: "Elia Quinto",
    createdByAdmin: true,
  }),
};

// Iscrizioni user_<uid>: [attore, attività, dati]. Nessuna di queste dà permessi di staff.
const staffRegistration = (extra) => ({
  genderRoleCategory: "dirigente",
  registrationStatus: "confirmed",
  fullName: "Adulto Prova",
  ...extra,
});
const SEEDED_REGISTRATIONS = [
  ["adultLeader", activityPath, staffRegistration({})],
  ["adultCompanion", activityPath, staffRegistration({ genderRoleCategory: "accompagnatore" })],
  ["youthAccompanist", activityPath, staffRegistration({ genderRoleCategory: "accompagnatore", fullName: "Ragazzo Furbo" })],
  ["listedStaff", activityPath, staffRegistration({ genderRoleCategory: "giovane_uomo" })],
  ["listedAnon", activityPath, staffRegistration({})],
  ["adultOtherStake", activityPath, staffRegistration({})],
];
// Elenco staff per attività: [percorso attività, uid in elenco]
const STAFF_LISTS = [
  [activityPath, [uid("listed-staff"), uid("listed-anon")]],
  [otherActivityPath, [uid("listed-elsewhere")]],
];

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
      recordsCloseAt: closeAt,
    }),
    adminDb.doc(otherActivityPath).set({ title: "Altra attività", activityType: "trip", recordsEnabled: true }),
    adminDb.doc(`${otherActivityPath}/records/r-other`).set(recordSeed({ title: "Record dell'altra attività" })),
  ];
  for (const [path, staffUids] of STAFF_LISTS) {
    seeds.push(adminDb.doc(`${path}/management/recordNight`).set({ staffUids, updatedAt: NOW, updatedBy: uid("admin") }));
  }
  for (const [, name, , profile] of ACTORS) {
    if (name && profile) seeds.push(adminDb.doc(`users/${uid(name)}`).set(profile));
  }
  for (const [actor, path, data] of SEEDED_REGISTRATIONS) {
    const name = ACTORS.find(([key]) => key === actor)[1];
    seeds.push(adminDb.doc(`${path}/registrations/user_${uid(name)}`).set({ ...data, userId: uid(name) }));
  }
  for (const [id, data] of Object.entries(SEEDED_RECORDS)) {
    seeds.push(adminDb.doc(`${activityPath}/records/${id}`).set(data));
  }
  for (const [id, data] of Object.entries(SEEDED_ENTRIES)) {
    seeds.push(adminDb.doc(`${activityPath}/recordEntries/${id}`).set(data));
  }
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
// 0. Il file rules compila nell'emulatore
// ---------------------------------------------------------------------------

test("firestore.rules compila nell'emulatore senza errori", async () => {
  // RECORD_NIGHT_RULES_FILE serve solo a provare che il test sappia fallire su rules sbagliate.
  const content = readFileSync(process.env.RECORD_NIGHT_RULES_FILE || new URL("../../firestore.rules", import.meta.url), "utf8");
  assert.match(content, /match \/records\/\{recordId\}/u, "blocco records assente dal file rules");
  assert.match(content, /match \/recordEntries\/\{entryId\}/u, "blocco recordEntries assente dal file rules");
  // Stesso endpoint che usa @firebase/rules-unit-testing: 200 = compilato.
  const response = await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT}:securityRules`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content }] } }),
  });
  const body = await response.text();
  assert.equal(response.status, 200, `Compilazione rules fallita: ${body}`);
  assert.doesNotMatch(body, /error/iu, `L'emulatore segnala errori: ${body}`);
});

// ---------------------------------------------------------------------------
// 1. Letture. [descrizione, attore, consentito, operazione, verifica opzionale]
// ---------------------------------------------------------------------------

const allRecordsCheck = (snapshot) => assert.equal(snapshot.size, Object.keys(SEEDED_RECORDS).length);
const allEntriesCheck = (snapshot) => assert.equal(snapshot.size, Object.keys(SEEDED_ENTRIES).length);
// Query del partecipante (listRecords): where status == 'open'. Il filtro > 0 è lato client.
const openOnly = (db) => getDocsFromServer(query(records(db), where("status", "==", "open")));
const openRecordsCheck = (snapshot) => {
  assert.deepEqual(snapshot.docs.map((item) => item.id).sort(), OPEN_RECORD_IDS);
  for (const item of snapshot.docs) assert.equal(item.data().status, "open");
};
const ownEntries = (actor) => (db) =>
  getDocsFromServer(query(entries(db), where("ownerUid", "==", clients[actor].uid)));
const entriesOf = (uidName) => (db) => getDocsFromServer(query(entries(db), where("ownerUid", "==", uid(uidName))));

// Staff: admin/super_admin, unit_leader dello stesso palo, uid in elenco.
const STAFF = [
  ["admin del palo", "admin"],
  ["super_admin", "superAdmin"],
  ["dirigente di unità dello stesso palo", "unitLeader"],
  ["iscritto messo in elenco da un admin", "listedStaff"],
];
// Del palo ma non staff: leggono i record aperti e i propri tentativi.
const MEMBERS = [
  ["ragazzo", "youthA"],
  ["altro ragazzo", "youthB"],
  ["utente non iscritto all'attività", "outsider"],
  ["genitore", "parent"],
  ["iscritto come dirigente (non in elenco)", "adultLeader"],
  ["iscritto come accompagnatore (non in elenco)", "adultCompanion"],
  ["ragazzo che si dichiara accompagnatore e si iscrive", "youthAccompanist"],
  ["uid in elenco di un'altra attività", "listedElsewhere"],
];
// Fuori dal palo o senza account vero: non leggono i record.
const OUTSIDERS = [
  ["utente di un altro palo", "otherStake"],
  ["admin di un altro palo", "otherAdmin"],
  ["dirigente di unità di un altro palo", "unitLeaderOther"],
  ["adulto iscritto ma con profilo di un altro palo", "adultOtherStake"],
  ["utente loggato senza profilo", "noProfile"],
  ["anonimo", "anonymous"],
  ["anonimo il cui uid è in elenco", "listedAnon"],
  ["non loggato", "signedOut"],
];

const READ_CASES = [
  // --- Staff: records e recordEntries intere (listAllRecords, listAllEntries), nascosti compresi.
  ...STAFF.flatMap(([label, actor]) => [
    [`${label} legge records intera (nascosti compresi)`, actor, true, (db) => getDocsFromServer(records(db)), allRecordsCheck],
    [`${label} legge anche con il filtro status == open`, actor, true, openOnly, openRecordsCheck],
    [`${label} legge un record nascosto con get diretto`, actor, true, (db) => getDocFromServer(recordDoc(db, "r-hidden-full")), (s) => assert.equal(s.data().status, "hidden")],
    [`${label} legge recordEntries intera`, actor, true, (db) => getDocsFromServer(entries(db)), allEntriesCheck],
    [`${label} legge il tentativo di un ragazzo con get diretto`, actor, true, (db) => getDocFromServer(entryDoc(db, "e-b-challenge")), (s) => assert.equal(s.exists(), true)],
    [`${label} legge un tentativo senza titolare`, actor, true, (db) => getDocFromServer(entryDoc(db, "e-legacy-null")), (s) => assert.equal(s.exists(), true)],
  ]),

  // --- Membri non staff: solo where status == 'open' (listRecords).
  ...MEMBERS.flatMap(([label, actor]) => [
    [`${label} legge records where status == open`, actor, true, openOnly, openRecordsCheck],
    [`${label} non legge records intera`, actor, false, (db) => getDocsFromServer(records(db))],
    [`${label} non legge un record hidden con get diretto`, actor, false, (db) => getDocFromServer(recordDoc(db, "r-hidden-full"))],
    [`${label} non legge recordEntries intera`, actor, false, (db) => getDocsFromServer(entries(db))],
    [`${label} non legge il tentativo di un altro con get diretto`, actor, false, (db) => getDocFromServer(entryDoc(db, "e-child-2"))],
    [`${label} non legge un tentativo senza titolare`, actor, false, (db) => getDocFromServer(entryDoc(db, "e-legacy-null"))],
    [`${label} non legge i tentativi senza titolare (where ownerUid == null)`, actor, false,
      (db) => getDocsFromServer(query(entries(db), where("ownerUid", "==", null)))],
  ]),
  ["ragazzo non legge records where status == hidden", "youthA", false,
    (db) => getDocsFromServer(query(records(db), where("status", "==", "hidden")))],
  ["ragazzo non legge records where status in [open, hidden]", "youthA", false,
    (db) => getDocsFromServer(query(records(db), where("status", "in", ["open", "hidden"])))],
  ["ragazzo non legge records con un filtro che non fissa lo status (challengerCount > 0)", "youthA", false,
    (db) => getDocsFromServer(query(records(db), where("challengerCount", ">", 0)))],
  ["get diretto di un record aperto a zero iscritti (ragazzo)", "youthA", true, (db) => getDocFromServer(recordDoc(db, "r-zero")), (s) => assert.equal(s.exists(), true)],
  ["get diretto di un record hidden senza iscritti (ragazzo)", "youthA", false, (db) => getDocFromServer(recordDoc(db, "r-hidden"))],

  // --- Fuori dal palo, senza profilo, anonimi, non loggati: nessun record.
  ...OUTSIDERS.flatMap(([label, actor]) => [
    [`${label} non legge records where status == open`, actor, false, openOnly],
    [`${label} non legge records intera`, actor, false, (db) => getDocsFromServer(records(db))],
    [`${label} non fa get di un record aperto`, actor, false, (db) => getDocFromServer(recordDoc(db, "r-open"))],
    [`${label} non legge recordEntries intera`, actor, false, (db) => getDocsFromServer(entries(db))],
    [`${label} non fa get di un tentativo`, actor, false, (db) => getDocFromServer(entryDoc(db, "e-a-challenge"))],
  ]),
  ["anonimo non legge nemmeno where ownerUid == proprio uid", "anonymous", false, ownEntries("anonymous")],
  ["anonimo il cui uid è in elenco non legge where ownerUid == proprio uid", "listedAnon", false, ownEntries("listedAnon")],
  ["non loggato non legge where ownerUid == qualunque uid", "signedOut", false, entriesOf("youth-a")],
  ["utente senza profilo: la query sul proprio uid resta consentita (rule sul solo ownerUid)", "noProfile", true,
    ownEntries("noProfile"), (s) => assert.equal(s.size, 0)],

  // --- recordNightService.listOwnEntries: where ownerUid == uid.
  ["ragazzo legge recordEntries where ownerUid == proprio uid", "youthA", true, ownEntries("youthA"), (s) => {
    assert.equal(s.size, 2);
    for (const item of s.docs) assert.equal(item.data().ownerUid, clients.youthA.uid);
  }],
  ["altro ragazzo legge solo i suoi tentativi", "youthB", true, ownEntries("youthB"), (s) => assert.equal(s.size, 1)],
  ["utente non iscritto legge i propri tentativi (nessuno)", "outsider", true, ownEntries("outsider"), (s) => assert.equal(s.size, 0)],
  ["ragazzo che si dichiara accompagnatore legge solo i propri tentativi (nessuno)", "youthAccompanist", true, ownEntries("youthAccompanist"), (s) => assert.equal(s.size, 0)],
  ["ragazzo con filtro in più sul proprio uid (status pending)", "youthA", true,
    (db) => getDocsFromServer(query(entries(db), where("ownerUid", "==", clients.youthA.uid), where("status", "==", "pending"))),
    (s) => assert.equal(s.size, 1)],
  ["get diretto del proprio tentativo", "youthA", true, (db) => getDocFromServer(entryDoc(db, "e-a-challenge")), (s) => assert.equal(s.exists(), true)],

  // --- Genitore: con where ownerUid == uid legge i tentativi dei figli.
  ["genitore legge i tentativi dei figli con where ownerUid == proprio uid", "parent", true, ownEntries("parent"), (s) => {
    assert.deepEqual(s.docs.map((item) => item.id), ["e-child"]);
    assert.equal(s.docs[0].data().registrationId, `child_${uid("parent")}_kid1`);
  }],
  ["genitore fa get diretto del tentativo del proprio figlio", "parent", true, (db) => getDocFromServer(entryDoc(db, "e-child")), (s) => assert.equal(s.exists(), true)],
  ["altro genitore legge solo i tentativi dei propri figli", "parent2", true, ownEntries("parent2"), (s) => assert.deepEqual(s.docs.map((item) => item.id), ["e-child-2"])],
  ["genitore non legge i tentativi dei figli di un altro genitore (where ownerUid == altro)", "parent", false, entriesOf("parent-2")],
  ["genitore non fa get del tentativo del figlio di un altro genitore", "parent", false, (db) => getDocFromServer(entryDoc(db, "e-child-2"))],
  ["altro genitore non fa get del tentativo dei figli del primo", "parent2", false, (db) => getDocFromServer(entryDoc(db, "e-child"))],
  ["ragazzo non fa get del tentativo di un figlio", "youthA", false, (db) => getDocFromServer(entryDoc(db, "e-child"))],
  ["genitore non legge recordEntries intera", "parent", false, (db) => getDocsFromServer(entries(db))],
  ["genitore non legge records intera", "parent", false, (db) => getDocsFromServer(records(db))],

  // --- Tentativi altrui.
  ["ragazzo non legge i tentativi di un altro (where ownerUid == uid altrui)", "youthA", false, entriesOf("youth-b")],
  ["ragazzo non filtra per registrationId altrui", "youthA", false,
    (db) => getDocsFromServer(query(entries(db), where("registrationId", "==", `user_${uid("youth-b")}`)))],
  ["ragazzo non filtra con ownerUid in [proprio, altrui]", "youthA", false,
    (db) => getDocsFromServer(query(entries(db), where("ownerUid", "in", [uid("youth-a"), uid("youth-b")])))],
  ["ragazzo non legge tutti i tentativi approvati (filtro che non fissa il proprio uid)", "youthA", false,
    (db) => getDocsFromServer(query(entries(db), where("status", "==", "approved")))],
  ["get diretto del tentativo di un altro ragazzo", "youthA", false, (db) => getDocFromServer(entryDoc(db, "e-b-challenge"))],
  ["get diretto del tentativo di un altro (a parti invertite)", "youthB", false, (db) => getDocFromServer(entryDoc(db, "e-a-challenge"))],

  // --- collectionGroup: nessuna rule, nessun accesso, neanche per lo staff che non è admin.
  ["ragazzo non legge records via collectionGroup", "youthA", false, (db) => getDocsFromServer(collectionGroup(db, "records"))],
  ["ragazzo non legge records via collectionGroup con status == open", "youthA", false,
    (db) => getDocsFromServer(query(collectionGroup(db, "records"), where("status", "==", "open")))],
  ["ragazzo non legge recordEntries via collectionGroup", "youthA", false, (db) => getDocsFromServer(collectionGroup(db, "recordEntries"))],
  ["anonimo non legge recordEntries via collectionGroup", "anonymous", false, (db) => getDocsFromServer(collectionGroup(db, "recordEntries"))],
  ["staff in elenco non legge recordEntries via collectionGroup", "listedStaff", false, (db) => getDocsFromServer(collectionGroup(db, "recordEntries"))],

  // --- L'elenco vale per attività: chi è in elenco altrove gestisce solo quell'attività.
  ["uid in elenco di un'altra attività legge i record di quell'attività (nascosti compresi)", "listedElsewhere", true,
    (db) => getDocsFromServer(collection(db, `${otherActivityPath}/records`)), (s) => assert.deepEqual(s.docs.map((item) => item.id), ["r-other"])],
  ["chi è in elenco qui non legge i record dell'altra attività intera", "listedStaff", false,
    (db) => getDocsFromServer(collection(db, `${otherActivityPath}/records`))],
  ["chi è in elenco qui legge comunque i record aperti dell'altra attività (è del palo)", "listedStaff", true,
    (db) => getDocsFromServer(query(collection(db, `${otherActivityPath}/records`), where("status", "==", "open"))), (s) => assert.equal(s.size, 1)],
  ["unit_leader del palo legge i record dell'altra attività (nessun elenco lì per lui)", "unitLeader", true,
    (db) => getDocsFromServer(collection(db, `${otherActivityPath}/records`)), (s) => assert.equal(s.size, 1)],

  // --- management/recordNight: lo legge solo un admin del palo.
  ["admin del palo legge l'elenco staff", "admin", true, (db) => getDocFromServer(staffDoc(db)), (s) => assert.deepEqual(s.data().staffUids, [uid("listed-staff"), uid("listed-anon")])],
  ["super_admin legge l'elenco staff", "superAdmin", true, (db) => getDocFromServer(staffDoc(db)), (s) => assert.equal(s.exists(), true)],
  ...[
    ["dirigente di unità", "unitLeader"], ["chi è in elenco", "listedStaff"], ["ragazzo", "youthA"], ["genitore", "parent"],
    ["iscritto come dirigente", "adultLeader"], ["ragazzo che si dichiara accompagnatore", "youthAccompanist"],
    ["admin di un altro palo", "otherAdmin"], ["anonimo", "anonymous"], ["anonimo in elenco", "listedAnon"], ["non loggato", "signedOut"],
  ].map(([label, actor]) => [`${label} non legge l'elenco staff`, actor, false, (db) => getDocFromServer(staffDoc(db))]),
  ["chi è in elenco non legge la collection management", "listedStaff", false, (db) => getDocsFromServer(collection(db, `${activityPath}/management`))],
];

for (const [description, actor, allowed, operation, check] of READ_CASES) {
  test(description, async () => {
    const attempt = operation(clients[actor].firestore);
    if (!allowed) return expectDenied(attempt);
    const result = await attempt;
    if (check) check(result);
  });
}

// ---------------------------------------------------------------------------
// 2. Scritture client: sempre negate, anche per admin e staff
// ---------------------------------------------------------------------------

const WRITE_ACTORS = [
  "admin", "superAdmin", "unitLeader", "listedStaff", "adultLeader", "adultCompanion", "youthAccompanist",
  "youthA", "parent", "outsider", "anonymous", "signedOut",
];

function writeAttempts(actor) {
  const db = clients[actor].firestore;
  const me = clients[actor].uid ?? "nobody";
  const newEntry = entrySeed({ registrationId: `user_${me}`, ownerUid: me });
  return [
    ["records: create con id fisso", () => setDoc(recordDoc(db, "r-new"), recordSeed({ challengerCount: 1 }))],
    ["records: create con id automatico", () => addDoc(records(db), recordSeed({ challengerCount: 1 }))],
    ["records: sovrascrive un record esistente", () => setDoc(recordDoc(db, "r-open"), recordSeed({ title: "Hack" }))],
    ["records: update del contatore", () => updateDoc(recordDoc(db, "r-open"), { challengerCount: 99 })],
    ["records: update dello stato", () => updateDoc(recordDoc(db, "r-hidden"), { status: "open" })],
    ["records: delete", () => deleteDoc(recordDoc(db, "r-open"))],
    ["records: create in batch", () => { const batch = writeBatch(db); batch.set(recordDoc(db, "r-batch"), recordSeed({})); return batch.commit(); }],
    ["recordEntries: create con id fisso (proprio uid)", () => setDoc(entryDoc(db, "e-new"), newEntry)],
    ["recordEntries: create con id automatico (proprio uid)", () => addDoc(entries(db), newEntry)],
    ["recordEntries: sovrascrive il proprio tentativo", () => setDoc(entryDoc(db, "e-a-challenge"), entrySeed({ ownerUid: me }))],
    ["recordEntries: update status del tentativo", () => updateDoc(entryDoc(db, "e-a-proposal"), { status: "approved" })],
    ["recordEntries: update di ownerUid", () => updateDoc(entryDoc(db, "e-b-challenge"), { ownerUid: me })],
    ["recordEntries: update del tentativo di un figlio", () => updateDoc(entryDoc(db, "e-child"), { status: "withdrawn" })],
    ["recordEntries: delete", () => deleteDoc(entryDoc(db, "e-a-challenge"))],
    ["recordEntries: create in batch", () => { const batch = writeBatch(db); batch.set(entryDoc(db, "e-batch"), newEntry); return batch.commit(); }],
    // L'elenco staff: nessun client lo scrive, nemmeno un admin, e nessuno si mette in elenco da solo.
    ["management/recordNight: set con il proprio uid", () => setDoc(staffDoc(db), { staffUids: [me], updatedAt: NOW, updatedBy: me })],
    ["management/recordNight: update dell'elenco", () => updateDoc(staffDoc(db), { staffUids: [me] })],
    ["management/recordNight: delete", () => deleteDoc(staffDoc(db))],
    ["management/recordNight: create in un'altra attività", () => setDoc(doc(db, `${otherActivityPath}/management/recordNight`), { staffUids: [me] })],
  ];
}

for (const actor of WRITE_ACTORS) {
  test(`nessuna scrittura client su records e recordEntries passa (${actor})`, async () => {
    const leaked = [];
    for (const [label, attempt] of writeAttempts(actor)) {
      try {
        await attempt();
        leaked.push(`${label}: SCRITTURA RIUSCITA`);
      } catch (error) {
        if (error?.code !== "permission-denied") leaked.push(`${label}: errore diverso da permission-denied (${error?.code})`);
      }
    }
    assert.deepEqual(leaked, [], `Scritture non negate per ${actor}:\n${leaked.join("\n")}`);
  });
}

test("dopo le scritture negate i dati seminati sono intatti", async () => {
  const [recordSnap, entrySnap, staffSnap] = await Promise.all([
    adminDb.collection(`${activityPath}/records`).get(),
    adminDb.collection(`${activityPath}/recordEntries`).get(),
    adminDb.doc(`${activityPath}/management/recordNight`).get(),
  ]);
  assert.deepEqual(staffSnap.data().staffUids, [uid("listed-staff"), uid("listed-anon")], "l'elenco staff è stato modificato");
  assert.deepEqual((await adminDb.doc(`${otherActivityPath}/management/recordNight`).get()).data().staffUids, [uid("listed-elsewhere")]);
  assert.deepEqual(recordSnap.docs.map((d) => d.id).sort(), Object.keys(SEEDED_RECORDS).sort());
  assert.deepEqual(entrySnap.docs.map((d) => d.id).sort(), Object.keys(SEEDED_ENTRIES).sort());
  for (const snap of recordSnap.docs) assert.deepEqual(snap.data(), SEEDED_RECORDS[snap.id], `record ${snap.id} modificato`);
  for (const snap of entrySnap.docs) assert.deepEqual(snap.data(), SEEDED_ENTRIES[snap.id], `tentativo ${snap.id} modificato`);
});

// ---------------------------------------------------------------------------
// 3. Il flag sull'attività (recordsEnabled / recordsCloseAt) lo scrive l'admin
//    dell'editor: lo staff dei record non guadagna questo permesso
// ---------------------------------------------------------------------------

test("admin del palo scrive recordsEnabled e recordsCloseAt sull'attività", async () => {
  await updateDoc(activityRef(clients.admin.firestore), { recordsEnabled: true, recordsCloseAt: closeAt });
  await updateDoc(activityRef(clients.admin.firestore), { recordsCloseAt: null });
  await updateDoc(activityRef(clients.admin.firestore), { recordsCloseAt: closeAt });
  const snap = await adminDb.doc(activityPath).get();
  assert.equal(snap.data().recordsEnabled, true);
  assert.equal(snap.data().recordsCloseAt, closeAt);
});

for (const actor of ["youthA", "parent", "unitLeader", "listedStaff", "adultLeader", "youthAccompanist", "otherAdmin", "anonymous", "signedOut"]) {
  test(`${actor} non scrive recordsEnabled sull'attività`, async () => {
    await expectDenied(updateDoc(activityRef(clients[actor].firestore), { recordsEnabled: false }));
    await expectDenied(updateDoc(activityRef(clients[actor].firestore), { recordsCloseAt: "2030-01-01T00:00:00.000Z" }));
  });
}

// ---------------------------------------------------------------------------
// 4. Le query provate qui sono quelle del client (lette dal sorgente del servizio)
// ---------------------------------------------------------------------------

test("recordNightService.ts usa le query provate in questo file", () => {
  const source = readFileSync(new URL("../../src/services/firestore/recordNightService.ts", import.meta.url), "utf8").replace(/\/\/.*$/gmu, "");
  const body = (name) => {
    const match = new RegExp(`async ${name}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n  \\},`, "u").exec(source);
    assert.ok(match, `funzione ${name} non trovata in recordNightService.ts`);
    return match[1].replace(/\s+/gu, " ");
  };
  // Membri del palo: records where status == 'open'.
  assert.match(body("listRecords"), /query\(\s*recordsCollection\(stakeId, activityId\), where\("status", "==", "open"\)\s*\)/u);
  // Staff: records e recordEntries interi.
  assert.match(body("listAllRecords"), /getDocsFromServer\(recordsCollection\(stakeId, activityId\)\)/u);
  assert.doesNotMatch(body("listAllRecords"), /where\(/u);
  assert.match(body("listAllEntries"), /getDocsFromServer\(entriesCollection\(stakeId, activityId\)\)/u);
  assert.doesNotMatch(body("listAllEntries"), /where\(/u);
  // Titolare (e genitore): recordEntries where ownerUid == uid.
  assert.match(body("listOwnEntries"), /query\(\s*entriesCollection\(stakeId, activityId\), where\("ownerUid", "==", uid\)\s*\)/u);
});
