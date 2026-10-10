// Notte dei Record, richieste senza account: callable VERE nell'emulatore
// Functions, con utenti dell'Auth emulator (sessioni anonime comprese).
// Riferimento (unica fonte, NON il codice): docs/NOTTE_DEI_RECORD_SENZA_ACCOUNT.md,
// con docs/NOTTE_DEI_RECORD.md per i contratti esistenti (recordNightParticipant,
// recordNightAdmin). Scritto dalla sola spec, indipendentemente dal backend.
//
// Rilancio (solo emulatori, progetto demo-room-planner, porte 9199/8180/5101),
// questo file e le rules insieme:
//   firebase emulators:exec --config firebase.room-test.json --project demo-room-planner \
//     'node --test --test-concurrency=1 functions/tests/recordNightGuestRulesEmulator.test.mjs functions/tests/recordNightGuestEmulator.test.mjs'
// Con le porte occupate da un'altra sessione non fermarla: copia la config su
// porte diverse (i test accettano solo 8180/9199/5101, quindi anche la copia
// del file) e rimuovi i file temporanei a fine prova.
// Sequenze casuali: RECORD_NIGHT_GUEST_FUZZ_SEEDS (default 11,2027,1016) e
// RECORD_NIGHT_GUEST_FUZZ_STEPS (default 80).
//
// Sezioni:
//   A  context (senza login): forma esatta, nessun dato riservato
//   B  flusso completo e collegamento su user_ / child_ / manual_
//   C  tetti: 12 aperte per telefono, 2 per persona, 40 create, 100 per attività,
//      anche su restore; non su reopenRequest / unlinkRequest
//   D  submissionId idempotente
//   E  account non anonimo, nomi, unità, payload
//   F  ORACOLO: nome iscritto / sconosciuto / duplicato = stessa risposta
//   G  mine: stati, nessuna fuga, errori dei ritiri generici
//   H  interruttore, recordsEnabled, finestra chiusa, richiesta scaduta
//   I  chi è staff (admin, dirigente di unità, staff scelto) e chi no
//   J  linkRequest: casi negativi
//   K  unlinkRequest da ogni stato del tentativo
//   L  rejectRequest / rejectRequests / reopenRequest
//   M  listRequests: duplicati e suggerimenti
//   N  trigger dell'iscrizione annullata e cleanup dell'attività
//   O  sequenze casuali con seed fisso e invarianti
//   P  aggiornamenti della spec (2026-10-10 sera): link/reject idempotenti, Scollega che
//      nasconde il record rimasto a zero, entryStatus/withdrawnBy in listRequests,
//      mine.recordTitle, scadenza già passata all'invio, tetti del telefono prima della coda
//   Q  GARE VERE (Promise.all sulle callable): link/ritiro, link/rifiuto, Scollega contro
//      Annulla del titolare, contro «Mostra di nuovo», contro il trigger; poi le invarianti
//   R  più persone dallo stesso telefono: idempotenza PER PERSONA (stessa persona + stesso
//      contenuto già aperto = quella richiesta), persone diverse = richieste distinte
//
// Ogni scenario crea una propria attività (stato e tetti non si mescolano).
// Le richieste "di contorno" dei test dello staff sono scritte via Admin SDK
// secondo la tabella dei campi della spec (seedRequest): così un difetto di
// `submit` non si porta dietro i test del collegamento.
//
// Ambiguità della spec e interpretazione scelta (da rileggere se un test fallisce):
//  - Le chiavi dell'elenco nelle risposte di mine/listRequests non sono nominate:
//    si prende l'unico array della risposta (o `requests`); l'id di una richiesta
//    è `requestId` oppure `id`.
//  - Il codice HTTPS degli errori "sul solo chiamante" non è nominato: si
//    controlla il messaggio (che è nella spec) e che il codice non sia un crash.
//  - 2 per persona e 40 create: messaggio fra i due "sul solo chiamante" dei tetti; il tetto
//    di 12 aperte usa esattamente "Hai già inviato il massimo...".
//  - `open` nel context = modulo acceso e finestra aperta; `intakeOpen` in più
//    l'interruttore acceso.
//  - Con recordsEnabled falso il context può dare errore "non è attiva" oppure
//    open/intakeOpen falsi e nessun record: si accettano entrambi.
//  - Un submissionId usato da un'ALTRA sessione dà una richiesta nuova (mai la
//    richiesta altrui).
//  - rejectRequests: rifiuta le open e salta le altre (spec aggiornata), con rejectedCount e skippedCount.
//  - Il tetto delle create in tutto (40) non si prova su restore (non crea documenti).
//  - Duplicato «per persona»: stessa sessione, stesso personKey, richiesta `open` con lo stesso
//    contenuto (sfida: stesso record; proposta: testo normalizzato, misura, durata; «serve» no).
//    Si controlla dopo finestra/interruttore/scadenza e prima dei tetti; un altro telefono crea sempre.
//  - Con l'interruttore recordsGuestEnabled spento (o assente) l'elenco pubblico del
//    context è VUOTO (D1, ora scritto anche nella riga `context` della spec).
//  - Gare vere: il Firestore emulator risolve i deadlock fra transazioni con un timeout dei lock
//    di secondi che arriva come INTERNAL (su Firestore vero è ABORTED e il Admin SDK riprova):
//    nei test Q è ammesso solo se dura 4+ secondi, viene contato in `t.diagnostic` e le invarianti
//    devono reggere lo stesso.
//  - A capo e tab dentro un nome sono spazi bianchi: accettati se normalizzati
//    (come negli altri campi di testo del modulo), non vanno salvati com'erano.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { deleteApp, initializeApp as initializeClientApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInAnonymously,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  getDocsFromServer,
  getFirestore as getClientFirestore,
  query,
  where,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

const require = createRequire(import.meta.url);
const { initializeApp: initializeAdminApp, getApps } = require("firebase-admin/app");
const { getFirestore: getAdminFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");

const PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "";
assert.equal(PROJECT, "demo-room-planner", "Usare esclusivamente il progetto demo-room-planner");
assert.match(FIRESTORE_HOST, /^(127\.0\.0\.1|localhost):8180$/u, "Firestore Emulator richiesto sulla porta 8180");
assert.match(AUTH_HOST, /^(127\.0\.0\.1|localhost):9199$/u, "Auth Emulator richiesto sulla porta 9199");

if (getApps().length === 0) initializeAdminApp({ projectId: PROJECT });
const adminDb = getAdminFirestore();
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const stakeId = `guest-night-${runId}`;
const foreignStakeId = `guest-foreign-${runId}`;

// Messaggi della spec (errori sul solo chiamante) e dei contratti esistenti.
const MAX_PHONE_MSG = "Hai già inviato il massimo di richieste da questo telefono.";
const CLOSED_MSG = "Le iscrizioni ai record sono chiuse.";
const CANNOT_RECEIVE_MSG = "Non riesco a riceverla ora. Parlane con il dirigente della tua unità.";
const CALLER_MESSAGES = [MAX_PHONE_MSG, CLOSED_MSG, CANNOT_RECEIVE_MSG];
const NOT_ACTIVE = /La Notte dei Record non è attiva/u;
const HAS_ACCOUNT = /Hai un account: accedi/u;
const NOT_STAFF_MSG = "Non hai i permessi per gestire i record di questa attività.";
const DUPLICATE_MSG = "Questa proposta è già presente.";
const LIMIT_RE = /Limite di 2 record raggiunto/u;
const ALREADY_RE = /(Già in gara per questo record|già iscritta a questo record)/u;

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const inFuture = (hours = 48) => new Date(Date.now() + hours * HOUR).toISOString();
const inPast = (hours = 2) => new Date(Date.now() - hours * HOUR).toISOString();
// Data del viaggio relativa a oggi: expiresAt (viaggio + 7 giorni) non deve mai essere già passata.
const TRIP_DATE = new Date(Date.now() + 6 * DAY).toISOString().slice(0, 10);

const UNITS = {
  a: { id: "unit-a", name: "Rione Alfa", isActive: true },
  b: { id: "unit-b", name: "Rione Beta", isActive: true },
  off: { id: "unit-off", name: "Rione Spento", isActive: false },
};
const UNIT_BY_ID = Object.fromEntries(Object.values(UNITS).map((unit) => [unit.id, unit]));

// Iscritti dei test: i nomi NON coincidono mai con quelli digitati dai telefoni
// (salvo nel test oracolo e nei suggerimenti, dove è voluto).
const PEOPLE = {
  boyA: ["Anna", "Prima"],
  boyB: ["Bruno", "Secondo"],
  boyC: ["Carlo", "Terzo"],
  boyD: ["Diana", "Quarta"],
  boyE: ["Enrico", "Quinto"],
  boyF: ["Fiora", "Sesta"],
  picked: ["Paola", "Accompagnatrice"],
};

const person = (firstName, lastName, unit = UNITS.a) => ({ firstName, lastName, unitId: unit.id });
const WHO = {
  maria: person("Maria", "Verdi"),
  luca: person("Luca", "Neri", UNITS.b),
  sara: person("Sara", "Gialli"),
  paolo: person("Paolo", "Blu", UNITS.b),
  elena: person("Elena", "Rosa"),
  marco: person("Marco", "Viola"),
  giulia: person("Giulia", "Arancio", UNITS.b),
  tommaso: person("Tommaso", "Grigi"),
};

// ---------------------------------------------------------------------------
// Clienti e dati
// ---------------------------------------------------------------------------

const pool = {};
const apps = [];
const seededUsers = [];

async function makeClient(name, mode) {
  const app = initializeClientApp({ apiKey: "demo-key", projectId: PROJECT }, `${name}-${runId}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  if (mode === "anonymous") await signInAnonymously(auth);
  else if (mode === "password") {
    await createUserWithEmailAndPassword(auth, `${name}-${runId}@example.invalid`, "record-test-password");
  }
  const firestore = getClientFirestore(app);
  connectFirestoreEmulator(firestore, "127.0.0.1", 8180);
  const functions = getFunctions(app, "europe-west1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5101);
  return {
    name,
    auth,
    firestore,
    uid: auth.currentUser?.uid ?? null,
    guestFn: httpsCallable(functions, "recordNightGuest"),
    participantFn: httpsCallable(functions, "recordNightParticipant"),
    adminFn: httpsCallable(functions, "recordNightAdmin"),
  };
}

const PROFILES = {
  admin: { role: "admin", stakeId },
  otherAdmin: { role: "admin", stakeId: "other-stake" },
  leader: { role: "unit_leader", stakeId, unitId: UNITS.a.id },
  leaderOther: { role: "unit_leader", stakeId: "other-stake", unitId: "unit-9" },
  // Staff scelto: iscritto messo in elenco da un admin, per attività.
  picked: { role: "participant", stakeId },
  boyA: { role: "participant", stakeId },
  boyB: { role: "participant", stakeId },
  boyC: { role: "participant", stakeId },
  boyD: { role: "participant", stakeId },
  boyE: { role: "participant", stakeId },
  boyF: { role: "participant", stakeId },
  parent: { role: "parent", stakeId },
  // Account vero mai iscritto all'attività.
  outsider: { role: "participant", stakeId },
};
const PHONE_NAMES = ["phone1", "phone2", "phone3", "phone4"];

before(async () => {
  const created = await Promise.all(Object.keys(PROFILES).map((name) => makeClient(name, "password")));
  for (const client of created) pool[client.name] = client;
  for (const name of PHONE_NAMES) pool[name] = await makeClient(name, "anonymous");
  pool.signedOut = await makeClient("signed-out", "none");
  await Promise.all(
    Object.entries(PROFILES).map(([name, profile]) => {
      seededUsers.push(pool[name].uid);
      return adminDb.doc(`users/${pool[name].uid}`).set(profile);
    }),
  );
  const nowIso = new Date().toISOString();
  await Promise.all([
    ...Object.values(UNITS).map((unit) =>
      adminDb.doc(`stakes/${stakeId}/units/${unit.id}`).set({ name: unit.name, type: "rione", isActive: unit.isActive, createdAt: nowIso, updatedAt: nowIso }),
    ),
    // Un'unità attiva di un altro palo: non deve comparire nel context di questo.
    adminDb.doc(`stakes/${foreignStakeId}/units/foreign-unit`).set({ name: "Rione Altrui", type: "rione", isActive: true, createdAt: nowIso, updatedAt: nowIso }),
  ]);
});

after(async () => {
  await Promise.all(apps.map((app) => deleteApp(app)));
  await adminDb.recursiveDelete(adminDb.doc(`stakes/${stakeId}`));
  await adminDb.recursiveDelete(adminDb.doc(`stakes/${foreignStakeId}`));
  await Promise.all(seededUsers.map((uid) => adminDb.doc(`users/${uid}`).delete()));
  await adminDb.terminate();
});

let phoneSequence = 0;
async function newPhone() {
  phoneSequence += 1;
  return makeClient(`phone-x${phoneSequence}`, "anonymous");
}

let sequence = 0;
const activityPath = (activityId) => `stakes/${stakeId}/activities/${activityId}`;
const entriesRef = (activityId) => adminDb.collection(`${activityPath(activityId)}/recordEntries`);
const recordsRef = (activityId) => adminDb.collection(`${activityPath(activityId)}/records`);
const requestsRef = (activityId) => adminDb.collection(`${activityPath(activityId)}/recordRequests`);
const registrationsRef = (activityId) => adminDb.collection(`${activityPath(activityId)}/registrations`);

async function enrollUser(activityId, client, extra = {}) {
  const [firstName, lastName] = PEOPLE[client.name] ?? ["Persona", "Prova"];
  await adminDb.doc(`${activityPath(activityId)}/registrations/user_${client.uid}`).set({
    userId: client.uid,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    genderRoleCategory: "giovane_uomo",
    registrationStatus: "confirmed",
    unitId: UNITS.a.id,
    unitName: UNITS.a.name,
    ...extra,
  });
  return `user_${client.uid}`;
}

async function enrollChild(activityId, parent, childId, firstName, lastName, extra = {}) {
  const registrationId = `child_${parent.uid}_${childId}`;
  await adminDb.doc(`${activityPath(activityId)}/registrations/${registrationId}`).set({
    parentUid: parent.uid,
    firstName,
    lastName,
    genderRoleCategory: "giovane_uomo",
    registrationStatus: "confirmed",
    unitId: UNITS.a.id,
    unitName: UNITS.a.name,
    ...extra,
  });
  return registrationId;
}

// Iscrizione inserita da un admin, senza account: manual_<...>.
async function enrollManual(activityId, id, firstName, lastName, extra = {}) {
  assert.match(id, /^manual_/u);
  await adminDb.doc(`${activityPath(activityId)}/registrations/${id}`).set({
    firstName,
    lastName,
    genderRoleCategory: "giovane_uomo",
    registrationStatus: "confirmed",
    unitId: UNITS.a.id,
    unitName: UNITS.a.name,
    ...extra,
  });
  return id;
}

// Iscrizione con un id qualunque (guest_, prefissi sconosciuti...).
async function enrollRaw(activityId, registrationId, firstName, lastName, extra = {}) {
  await adminDb.doc(`${activityPath(activityId)}/registrations/${registrationId}`).set({
    firstName,
    lastName,
    genderRoleCategory: "giovane_uomo",
    registrationStatus: "confirmed",
    unitId: UNITS.a.id,
    unitName: UNITS.a.name,
    ...extra,
  });
  return registrationId;
}

// Crea un'attività con la Notte dei Record accesa. `guest`: true | false | "absent".
// closeAt: undefined = fra 48 ore; null = null salvato; "absent" = campo assente.
async function newActivity({ members = [], enabled = true, guest = true, closeAt, startDate = TRIP_DATE, extra = {} } = {}) {
  const activityId = `act-${++sequence}`;
  const data = { title: "Viaggio al tempio (test)", activityType: "trip", ...extra };
  if (startDate !== "absent") data.startDate = startDate;
  if (enabled !== "absent") data.recordsEnabled = enabled;
  if (guest !== "absent") data.recordsGuestEnabled = guest;
  if (closeAt !== "absent") data.recordsCloseAt = closeAt === undefined ? inFuture() : closeAt;
  await adminDb.doc(activityPath(activityId)).set(data);
  await Promise.all(members.map((client) => enrollUser(activityId, client)));
  return activityId;
}

// Staff scelto: iscritto all'attività e messo in elenco da un admin.
async function makePickedStaff(activityId, client = pool.picked) {
  await enrollUser(activityId, client, { genderRoleCategory: "accompagnatore" });
  await A(pool.admin, activityId, "setStaff", { uid: client.uid, enabled: true });
  return client;
}

const G = async (client, activityId, action, payload = {}) => {
  const data = (await client.guestFn({ stakeId, activityId, action, ...payload })).data;
  if (data && data.action !== undefined) assert.equal(data.action, action, `risposta di ${action} con action ${data.action}`);
  return data;
};
const P = (client, activityId, action, payload = {}) =>
  client.participantFn({ stakeId, activityId, action, ...payload }).then((result) => result.data);
const A = (client, activityId, action, payload = {}) =>
  client.adminFn({ stakeId, activityId, action, ...payload }).then((result) => result.data);

const proposal = (text, extra = {}) => ({ text, measure: "count_in_time", durationSeconds: 60, needs: "", ...extra });
const recordInput = (title, extra = {}) => ({
  title,
  category: "resistenza",
  measure: "count_in_time",
  durationSeconds: 60,
  notes: "",
  ...extra,
});

// Payload di `submit`. submissionId = token del foglio (UUID, come lo genera il client).
const proposalRequest = (who, extra = {}) => ({
  submissionId: randomUUID(),
  kind: "proposal",
  ...who,
  text: "Salti con la corda",
  measure: "count_in_time",
  durationSeconds: 30,
  needs: "",
  ...extra,
});
const challengeRequest = (who, recordId, extra = {}) => ({
  submissionId: randomUUID(),
  kind: "challenge",
  ...who,
  recordId,
  ...extra,
});
const submit = (phone, activityId, payload) => G(phone, activityId, "submit", payload);
const withdraw = (phone, activityId, requestId) => G(phone, activityId, "withdraw", { requestId });
const restore = (phone, activityId, requestId) => G(phone, activityId, "restore", { requestId });

const link = (staff, activityId, requestId, registrationId, extra = {}) =>
  A(staff, activityId, "linkRequest", { requestId, registrationId, verified: true, ...extra });
const unlink = (staff, activityId, requestId) => A(staff, activityId, "unlinkRequest", { requestId });
const rejectRequest = (staff, activityId, requestId, note) =>
  A(staff, activityId, "rejectRequest", note === undefined ? { requestId } : { requestId, note });
const reopenRequest = (staff, activityId, requestId) => A(staff, activityId, "reopenRequest", { requestId });

// ---- lettura delle risposte con forma non nominata dalla spec ----
function listOf(response, label = "risposta") {
  assert.ok(response && typeof response === "object", `${label}: risposta non valida`);
  const arrays = Object.entries(response).filter(([, value]) => Array.isArray(value));
  assert.ok(arrays.length >= 1, `${label}: nessun elenco nella risposta ${JSON.stringify(response)}`);
  const named = arrays.find(([key]) => key === "requests");
  return (named ?? arrays[0])[1];
}
const idOf = (item) => item?.requestId ?? item?.id;
const mineItems = async (phone, activityId) => listOf(await G(phone, activityId, "mine"), "mine");
const mineById = async (phone, activityId) => new Map((await mineItems(phone, activityId)).map((item) => [idOf(item), item]));
async function stateOf(phone, activityId, requestId) {
  return (await mineById(phone, activityId)).get(requestId)?.state;
}
const listQueue = async (staff, activityId) => listOf(await A(staff, activityId, "listRequests"), "listRequests");
const queueById = async (staff, activityId) => new Map((await listQueue(staff, activityId)).map((item) => [idOf(item), item]));

// ---- lettura diretta (Admin SDK) ----
async function requestData(activityId, requestId) {
  const snap = await requestsRef(activityId).doc(requestId).get();
  assert.equal(snap.exists, true, `richiesta ${requestId} assente`);
  return snap.data();
}
async function entryData(activityId, entryId) {
  const snap = await entriesRef(activityId).doc(entryId).get();
  assert.equal(snap.exists, true, `tentativo ${entryId} assente`);
  return snap.data();
}
async function recordData(activityId, recordId) {
  const snap = await recordsRef(activityId).doc(recordId).get();
  assert.equal(snap.exists, true, `record ${recordId} assente`);
  return snap.data();
}
const allDocs = async (ref) => (await ref.get()).docs.map((doc) => ({ id: doc.id, ...doc.data() }));
const requestsOfPhone = async (activityId, phone) =>
  (await requestsRef(activityId).where("anonUid", "==", phone.uid).get()).docs.map((doc) => ({ id: doc.id, ...doc.data() }));
async function linkedEntryOf(activityId, requestId) {
  const request = await requestData(activityId, requestId);
  assert.ok(request.linkedEntryId, `la richiesta ${requestId} non ha linkedEntryId (status ${request.status})`);
  return { id: request.linkedEntryId, ...(await entryData(activityId, request.linkedEntryId)) };
}
async function entriesFromRequest(activityId, requestId) {
  return (await entriesRef(activityId).where("sourceRequestId", "==", requestId).get()).docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

// Normalizzazione di personKey come dice la spec: `nome cognome|unitId`, minuscole, senza accenti.
const normalizeName = (value) => String(value).normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/\s+/gu, " ").trim();
const personKeyOf = (who) => `${normalizeName(who.firstName)} ${normalizeName(who.lastName)}|${who.unitId}`;

// Richiesta scritta via Admin SDK secondo la tabella "Richiesta" della spec.
let seedSequence = 0;
async function seedRequest(activityId, phone, { who = WHO.maria, kind = "proposal", status = "open", text, recordId = null, extra = {} } = {}) {
  const requestId = `seed-${++seedSequence}-${runId}`;
  const nowIso = new Date().toISOString();
  await requestsRef(activityId).doc(requestId).set({
    anonUid: phone.uid,
    submissionId: randomUUID(),
    firstName: who.firstName,
    lastName: who.lastName,
    unitId: who.unitId,
    unitName: UNIT_BY_ID[who.unitId].name,
    personKey: personKeyOf(who),
    kind,
    proposedText: kind === "proposal" ? text ?? `Idea di ${who.firstName}` : null,
    proposedMeasure: kind === "proposal" ? "count_in_time" : null,
    proposedDurationSeconds: kind === "proposal" ? 30 : null,
    proposedNeeds: "",
    recordId: kind === "challenge" ? recordId : null,
    status,
    staffNote: "",
    createdAt: nowIso,
    updatedAt: nowIso,
    expiresAt: Timestamp.fromMillis(Date.now() + 7 * DAY),
    ...extra,
  });
  return requestId;
}

// Un ragazzo propone e lo staff approva: restituisce { entry, record } con challengerCount 1.
async function makeRecord(activityId, proposer, title, extra = {}) {
  const proposed = await P(proposer, activityId, "propose", proposal(`Proposta: ${title}`, extra));
  const approved = await A(pool.admin, activityId, "approve", { entryId: proposed.entry.id, ...recordInput(title) });
  return { entry: approved.entry, record: approved.record };
}

// ---- invarianti ----
const isActiveEntry = (entry) => entry.status === "pending" || entry.status === "approved";
const LINK_FIELDS = ["linkedRegistrationId", "linkedEntryId", "linkedBy", "linkedAt"];

// Invarianti sempre vere: contatore del record == tentativi approved; al massimo 2 tentativi
// attivi per iscrizione, mai due volte sullo stesso record; richiesta linked <-> tentativo
// coerente; nessun tentativo attivo orfano (richiesta non più collegata); legame cancellato
// sulle richieste non collegate.
async function assertConsistent(activityId) {
  const [recordDocs, entryDocs, requestDocs] = await Promise.all([
    allDocs(recordsRef(activityId)),
    allDocs(entriesRef(activityId)),
    allDocs(requestsRef(activityId)),
  ]);
  const active = entryDocs.filter(isActiveEntry);
  for (const record of recordDocs) {
    const approved = entryDocs.filter((entry) => entry.status === "approved" && entry.recordId === record.id).length;
    assert.equal(record.challengerCount, approved, `contatore del record ${record.id} (${record.title}) non coincide con i tentativi approved`);
    if (record.status === "hidden") assert.equal(record.challengerCount, 0, `record nascosto ${record.id} con contatore diverso da 0`);
  }
  for (const entry of entryDocs) {
    if (entry.status === "approved") {
      assert.equal(typeof entry.recordId, "string", `tentativo approved ${entry.id} senza recordId`);
      assert.ok(recordDocs.some((record) => record.id === entry.recordId), `tentativo ${entry.id} punta a un record inesistente`);
    }
  }
  const byRegistration = new Map();
  for (const entry of active) byRegistration.set(entry.registrationId, [...(byRegistration.get(entry.registrationId) ?? []), entry]);
  for (const [registrationId, list] of byRegistration) {
    assert.ok(list.length <= 2, `${registrationId} ha ${list.length} tentativi attivi (massimo 2)`);
    const recordIds = list.map((entry) => entry.recordId).filter(Boolean);
    assert.equal(new Set(recordIds).size, recordIds.length, `${registrationId} è due volte sullo stesso record`);
  }

  const requestMap = new Map(requestDocs.map((request) => [request.id, request]));
  for (const entry of entryDocs) {
    if (entry.sourceRequestId === undefined || entry.sourceRequestId === null) {
      // Spec: sourceRequestId e fromGuestRequest li hanno SOLO i tentativi collegati; gli altri non hanno il campo.
      assert.ok(!("sourceRequestId" in entry) && !("fromGuestRequest" in entry), `tentativo ${entry.id} non nato da una richiesta ma con sourceRequestId/fromGuestRequest`);
      continue;
    }
    assert.equal(entry.fromGuestRequest, true, `tentativo ${entry.id} con sourceRequestId ma senza fromGuestRequest`);
    const request = requestMap.get(entry.sourceRequestId);
    assert.ok(request, `tentativo ${entry.id} punta alla richiesta inesistente ${entry.sourceRequestId}`);
    if (isActiveEntry(entry)) {
      assert.equal(request.status, "linked", `tentativo ATTIVO ${entry.id} orfano: la richiesta ${request.id} è ${request.status}`);
      assert.equal(request.linkedEntryId, entry.id, `la richiesta ${request.id} è collegata a un altro tentativo`);
      assert.equal(request.linkedRegistrationId, entry.registrationId);
    }
  }
  for (const request of requestDocs) {
    assert.ok(["open", "linked", "rejected", "withdrawn"].includes(request.status), `richiesta ${request.id} con status ${request.status}`);
    const fromThis = entryDocs.filter((entry) => entry.sourceRequestId === request.id && isActiveEntry(entry));
    assert.ok(fromThis.length <= 1, `la richiesta ${request.id} ha ${fromThis.length} tentativi attivi`);
    if (request.status === "linked") {
      for (const field of LINK_FIELDS) assert.ok(request[field], `richiesta collegata ${request.id} senza ${field}`);
      const entry = entryDocs.find((item) => item.id === request.linkedEntryId);
      assert.ok(entry, `la richiesta ${request.id} punta al tentativo inesistente ${request.linkedEntryId}`);
      assert.equal(entry.sourceRequestId, request.id);
      assert.equal(entry.registrationId, request.linkedRegistrationId);
    } else {
      for (const field of LINK_FIELDS) assert.ok(!request[field], `richiesta ${request.status} ${request.id} con ${field} residuo`);
      assert.equal(fromThis.length, 0, `richiesta ${request.status} ${request.id} con un tentativo attivo`);
    }
  }
}

// Stato mostrato al richiedente, derivato come dice la spec (tabella `mine`).
function expectedState(request, entry) {
  if (request.status === "open") return "received";
  if (request.status === "withdrawn") return "withdrawn";
  if (request.status === "rejected") return "not_linked";
  assert.equal(request.status, "linked");
  assert.ok(entry, `richiesta collegata ${request.id} senza tentativo`);
  return { pending: "pending", approved: "approved", rejected: "rejected", withdrawn: "removed" }[entry.status];
}
async function assertMineMatchesData(phone, activityId) {
  const [items, requests, entries] = await Promise.all([mineById(phone, activityId), requestsOfPhone(activityId, phone), allDocs(entriesRef(activityId))]);
  const own = requests.filter((request) => !request.expiresAt || request.expiresAt.toMillis() > Date.now());
  assert.deepEqual([...items.keys()].sort(), own.map((request) => request.id).sort(), "mine non elenca esattamente le richieste del telefono");
  for (const request of own) {
    const entry = entries.find((item) => item.id === request.linkedEntryId);
    assert.equal(items.get(request.id).state, expectedState(request, entry), `stato di ${request.id} (${request.status}${entry ? `/${entry.status}` : ""})`);
  }
}

// ---- fughe ----
// Chiavi che il telefono non deve mai vedere in mine (spec: "Nessun campo dell'iscrizione,
// nessun altro tentativo della persona, nessun contatore passa al telefono").
const PHONE_FORBIDDEN_KEYS = new Set([
  "registrationId", "linkedRegistrationId", "linkedEntryId", "linkedBy", "entryId", "entry", "entries", "participantName",
  "staffNote", "challengerCount", "activeEntries", "alreadyOnRecord", "suggestions", "duplicates", "ownerUid", "createdBy",
  "decidedBy", "sourceRequestId", "statusBeforeWithdraw", "withdrawnBy", "withdrawnWithRecordHide", "createdByAdmin",
  "fromGuestRequest", "staffUids", "notes",
]);
function forbiddenPaths(value, forbidden = PHONE_FORBIDDEN_KEYS, path = "$") {
  if (Array.isArray(value)) return value.flatMap((item, index) => forbiddenPaths(item, forbidden, `${path}[${index}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => [...(forbidden.has(key) ? [`${path}.${key}`] : []), ...forbiddenPaths(item, forbidden, `${path}.${key}`)]);
  }
  return [];
}
function assertNoLeak(value, strings, label = "risposta") {
  assert.deepEqual(forbiddenPaths(value), [], `${label}: chiavi riservate nella risposta`);
  const text = JSON.stringify(value);
  for (const secret of strings.filter(Boolean)) assert.ok(!text.includes(secret), `${label}: compare «${secret}» nella risposta ${text}`);
}

const VOLATILE_KEYS = new Set(["requestId", "id", "createdAt", "updatedAt", "decidedAt", "linkedAt", "expiresAt"]);
function stripVolatile(value) {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !VOLATILE_KEYS.has(key)).map(([key, item]) => [key, stripVolatile(item)]));
  }
  return value;
}
const sortedKeys = (value) => Object.keys(value).sort();

// ---- errori ----
const CRASH_CODES = new Set(["functions/internal", "functions/unknown", "functions/data-loss", "functions/unauthenticated", "functions/unavailable", "functions/deadline-exceeded"]);
async function expectFail(promise, codes, expected) {
  await assert.rejects(promise, (error) => {
    const code = error?.code;
    if (codes === "any") {
      assert.ok(typeof code === "string" && code.startsWith("functions/") && !CRASH_CODES.has(code), `codice inatteso ${code}: ${error?.message}`);
    } else {
      const list = [].concat(codes).map((item) => `functions/${item}`);
      assert.ok(list.includes(code), `atteso ${list.join("|")}, ricevuto ${code}: ${error?.message}`);
    }
    if (expected instanceof RegExp) assert.match(error.message, expected);
    else if (typeof expected === "string") assert.equal(error.message, expected);
    return true;
  });
}
async function capture(promise) {
  try {
    return { ok: true, data: await promise };
  } catch (error) {
    return { ok: false, code: error?.code, message: error?.message };
  }
}

async function waitFor(read, predicate, description, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.fail(`Timeout in attesa di ${description}. Ultimo valore: ${JSON.stringify(last)}`);
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// A. context (senza login)
// ---------------------------------------------------------------------------

const CONTEXT_KEYS = ["action", "closeAt", "intakeOpen", "ok", "open", "records", "units"];
const CONTEXT_REQUIRED = ["closeAt", "intakeOpen", "ok", "open", "records", "units"];

function seedPublicRecord(activityId, id, extra) {
  const nowIso = new Date().toISOString();
  return recordsRef(activityId).doc(id).set({
    title: "Titolo",
    category: "resistenza",
    measure: "count_in_time",
    durationSeconds: 60,
    notes: "",
    challengerCount: 1,
    status: "open",
    createdFromEntryId: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: pool.admin.uid,
    ...extra,
  });
}
const publicRecord = (item) => ({ ...item, durationSeconds: item.durationSeconds ?? null });

test("A1 context senza login: solo titolo, categoria, misura e durata dei record open con sfidanti", async () => {
  const { signedOut, phone1, boyA, admin } = pool;
  const closeAt = inFuture(30);
  const act = await newActivity({ members: [boyA], closeAt });
  await seedPublicRecord(act, "r-due", {
    title: "Salti con la corda", category: "resistenza", measure: "count_in_time", durationSeconds: 60,
    notes: "NOTE-SEGRETE-DUE", challengerCount: 2, createdFromEntryId: "entry-segreta",
  });
  await seedPublicRecord(act, "r-uno", {
    title: "Equilibrio su un piede", category: "equilibrio", measure: "longest_time", durationSeconds: null,
    notes: "NOTE-SEGRETE-UNO", challengerCount: 1,
  });
  await seedPublicRecord(act, "r-zero", { title: "Record a zero iscritti", challengerCount: 0, notes: "NOTE-ZERO" });
  await seedPublicRecord(act, "r-nascosto", { title: "Record nascosto dallo staff", status: "hidden", challengerCount: 3, notes: "NOTE-NASCOSTO" });
  await enrollManual(act, "manual_segreto", "Zeffirino", "Quartarolo");
  await seedRequest(act, phone1, { who: WHO.maria });

  const res = await G(signedOut, act, "context");
  assert.equal(res.ok, true);
  for (const key of CONTEXT_REQUIRED) assert.ok(key in res, `context senza ${key}: ${JSON.stringify(res)}`);
  assert.deepEqual(Object.keys(res).filter((key) => !CONTEXT_KEYS.includes(key)), [], "il context ha chiavi che la spec non prevede");
  assert.equal(res.open, true);
  assert.equal(res.intakeOpen, true);
  assert.equal(new Date(res.closeAt).getTime(), new Date(closeAt).getTime(), "closeAt = chiusura delle iscrizioni");

  assert.deepEqual(res.records.map((item) => item.id).sort(), ["r-due", "r-uno"], "solo i record open con challengerCount > 0");
  for (const item of res.records) assert.deepEqual(sortedKeys(publicRecord(item)), ["category", "durationSeconds", "id", "measure", "title"]);
  assert.deepEqual(publicRecord(res.records.find((item) => item.id === "r-due")), {
    id: "r-due", title: "Salti con la corda", category: "resistenza", measure: "count_in_time", durationSeconds: 60,
  });
  assert.deepEqual(publicRecord(res.records.find((item) => item.id === "r-uno")), {
    id: "r-uno", title: "Equilibrio su un piede", category: "equilibrio", measure: "longest_time", durationSeconds: null,
  });
  assert.deepEqual(res.units.map((unit) => unit.id).sort(), [UNITS.a.id, UNITS.b.id], "solo le unità attive di questo palo");
  for (const unit of res.units) assert.deepEqual(sortedKeys(unit), ["id", "name"]);
  assert.equal(res.units.find((unit) => unit.id === UNITS.a.id).name, UNITS.a.name);

  const text = JSON.stringify(res);
  for (const secret of [
    "NOTE-SEGRETE-DUE", "NOTE-SEGRETE-UNO", "NOTE-ZERO", "NOTE-NASCOSTO", "entry-segreta", admin.uid, "Zeffirino", "Quartarolo",
    "Anna", "Prima", "Maria", "Verdi", "challengerCount", "createdBy", "notes", "Rione Altrui", "Rione Spento", "unit-off",
    "Record nascosto dallo staff", "Record a zero iscritti",
  ]) {
    assert.ok(!text.includes(secret), `il context mostra «${secret}»: ${text}`);
  }
  // Uguale per tutti: la risposta non dipende da chi chiama.
  for (const caller of [phone1, boyA, admin]) assert.deepEqual(await G(caller, act, "context"), res, `context diverso per ${caller.name}`);
  // Sola lettura: non crea nulla.
  assert.equal((await requestsRef(act).get()).size, 1, "context non crea richieste");
});

test("A2 context: intakeOpen segue modulo, finestra e interruttore", async () => {
  const { signedOut } = pool;
  const scenarios = [
    ["tutto acceso", {}, { open: true, intakeOpen: true }],
    ["interruttore spento", { guest: false }, { open: true, intakeOpen: false }],
    ["interruttore assente (default spento)", { guest: "absent" }, { open: true, intakeOpen: false }],
    ["finestra chiusa (recordsCloseAt passato)", { closeAt: inPast(1) }, { open: false, intakeOpen: false }],
    ["finestra chiusa (startDate passato, senza recordsCloseAt)", { closeAt: null, startDate: "2020-01-01" }, { open: false, intakeOpen: false }],
    ["finestra chiusa e interruttore spento", { closeAt: inPast(1), guest: false }, { open: false, intakeOpen: false }],
  ];
  for (const [label, options, expected] of scenarios) {
    const act = await newActivity(options);
    const res = await G(signedOut, act, "context");
    assert.equal(res.open, expected.open, `${label}: open`);
    assert.equal(res.intakeOpen, expected.intakeOpen, `${label}: intakeOpen`);
  }

  // D1: con l'interruttore spento (o assente) nessun titolo è pubblico, anche se i record esistono.
  for (const guest of [false, "absent"]) {
    const act = await newActivity({ guest });
    await seedPublicRecord(act, "r-1", { title: "Titolo non ancora pubblico", challengerCount: 2 });
    const res = await G(signedOut, act, "context");
    assert.deepEqual(res.records, [], `interruttore ${guest}: elenco pubblico non vuoto`);
    assert.ok(!JSON.stringify(res).includes("Titolo non ancora pubblico"));
  }

  // Modulo spento (recordsEnabled falso o assente): o errore «non è attiva» o niente di aperto e niente record.
  for (const enabled of [false, "absent"]) {
    const act = await newActivity({ enabled });
    await seedPublicRecord(act, "r-1", { title: "Non deve uscire", challengerCount: 2 });
    const outcome = await capture(G(signedOut, act, "context"));
    if (outcome.ok) {
      assert.equal(outcome.data.open, false);
      assert.equal(outcome.data.intakeOpen, false);
      assert.deepEqual(outcome.data.records, [], "modulo spento: nessun record pubblico");
      assert.ok(!JSON.stringify(outcome.data).includes("Non deve uscire"));
    } else {
      assert.equal(outcome.code, "functions/failed-precondition");
      assert.match(outcome.message, NOT_ACTIVE);
    }
  }

  // Attività inesistente o palo sbagliato: errore, non una risposta vuota con dati.
  await expectFail(G(signedOut, "attivita-che-non-esiste", "context"), ["not-found", "failed-precondition"]);
  const act = await newActivity();
  await expectFail(signedOut.guestFn({ stakeId: foreignStakeId, activityId: act, action: "context" }), ["not-found", "failed-precondition"]);
  // Payload sbagliato.
  await expectFail(G(signedOut, act, "azione-sconosciuta"), "invalid-argument");
  await expectFail(G(signedOut, "../altra", "context"), "invalid-argument");
  await expectFail(signedOut.guestFn({ activityId: act, action: "context" }), "invalid-argument");
  assert.equal((await requestsRef(act).get()).size, 0);
});

// ---------------------------------------------------------------------------
// B. Flusso completo e collegamento
// ---------------------------------------------------------------------------

test("B1 flusso completo: invio da sessione anonima, ritiro e ripristino, coda dello staff, collegamento, Approva", async () => {
  const { boyA, boyB, boyF, admin, phone1, phone2, signedOut } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyF] });
  const r1 = await makeRecord(act, boyF, "Equilibrio su un piede");

  // 0. L'elenco senza login mostra il record con sfidanti.
  const ctx = await G(signedOut, act, "context");
  assert.equal(ctx.intakeOpen, true);
  assert.deepEqual(ctx.records.map((item) => item.id), [r1.record.id]);
  assert.equal(ctx.records[0].title, "Equilibrio su un piede");

  // 1. Il telefono invia una proposta e una sfida.
  const proposalRes = await submit(phone1, act, proposalRequest(WHO.maria, { text: "Torre di bicchieri", needs: "Dieci bicchieri" }));
  assert.equal(proposalRes.ok, true);
  assert.equal(typeof proposalRes.requestId, "string");
  const challengeRes = await submit(phone1, act, challengeRequest(WHO.luca, r1.record.id));
  assert.equal(challengeRes.ok, true);
  assert.notEqual(challengeRes.requestId, proposalRes.requestId);

  const storedProposal = await requestData(act, proposalRes.requestId);
  assert.equal(storedProposal.anonUid, phone1.uid);
  assert.equal(storedProposal.status, "open");
  assert.equal(storedProposal.kind, "proposal");
  assert.equal(storedProposal.firstName, "Maria");
  assert.equal(storedProposal.lastName, "Verdi");
  assert.equal(storedProposal.unitId, UNITS.a.id);
  assert.equal(storedProposal.unitName, UNITS.a.name, "unitName è una copia del nome dell'unità");
  assert.equal(storedProposal.personKey, "maria verdi|unit-a");
  assert.equal(storedProposal.proposedText, "Torre di bicchieri");
  assert.equal(storedProposal.proposedMeasure, "count_in_time");
  assert.equal(storedProposal.proposedDurationSeconds, 30);
  assert.equal(storedProposal.proposedNeeds, "Dieci bicchieri");
  assert.equal(storedProposal.recordId ?? null, null);
  assert.equal(typeof storedProposal.submissionId, "string");
  assert.equal(typeof storedProposal.createdAt, "string");
  assert.equal(typeof storedProposal.updatedAt, "string");
  assert.equal(typeof storedProposal.expiresAt?.toMillis, "function", "expiresAt è un Timestamp (campo TTL)");
  const storedChallenge = await requestData(act, challengeRes.requestId);
  assert.equal(storedChallenge.kind, "challenge");
  assert.equal(storedChallenge.recordId, r1.record.id);
  assert.equal(storedChallenge.personKey, "luca neri|unit-b");
  assert.equal(storedChallenge.unitName, UNITS.b.name);
  assert.equal(storedChallenge.proposedText ?? null, null, "una sfida non ha testo proposto");
  // Una richiesta non conta: nessun tentativo, nessun contatore.
  assert.equal((await entriesRef(act).get()).size, 1, "solo il tentativo che ha creato il record");
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 1);

  // 2. mine: solo il telefono che ha inviato, lo stato è «ricevuta».
  const mine = await mineItems(phone1, act);
  assert.deepEqual(mine.map(idOf).sort(), [proposalRes.requestId, challengeRes.requestId].sort());
  for (const item of mine) assert.equal(item.state, "received");
  assertNoLeak(mine, [boyA.uid, boyB.uid, boyF.uid, admin.uid, "Anna Prima", "Bruno Secondo", "Fiora Sesta"], "mine");
  assert.deepEqual(await mineItems(phone2, act), [], "un altro telefono non vede le richieste altrui");

  // 3. Ritiro e «Annulla»: torna allo stato di prima.
  const withdrawn = await withdraw(phone1, act, proposalRes.requestId);
  assert.equal(withdrawn.ok, true);
  assert.equal((await requestData(act, proposalRes.requestId)).status, "withdrawn");
  assert.equal(await stateOf(phone1, act, proposalRes.requestId), "withdrawn");
  const restored = await restore(phone1, act, proposalRes.requestId);
  assert.equal(restored.ok, true);
  assert.equal((await requestData(act, proposalRes.requestId)).status, "open");
  assert.equal(await stateOf(phone1, act, proposalRes.requestId), "received");

  // 4. Coda dello staff: entrambe aperte, con suggerimenti e duplicati.
  const queue = await queueById(admin, act);
  for (const requestId of [proposalRes.requestId, challengeRes.requestId]) {
    const item = queue.get(requestId);
    assert.ok(item, `listRequests non elenca ${requestId}`);
    assert.equal(item.status, "open");
    assert.ok(Array.isArray(item.suggestions), "suggestions presente per ogni richiesta aperta");
    assert.ok("duplicates" in item, "duplicates presente per ogni richiesta aperta");
  }

  // 5. Collegamento della proposta all'iscrizione user_ di Anna: nasce un tentativo in attesa.
  const linked = await link(admin, act, proposalRes.requestId, `user_${boyA.uid}`);
  assert.equal(linked.ok, true);
  const afterLink = await requestData(act, proposalRes.requestId);
  assert.equal(afterLink.status, "linked");
  assert.equal(afterLink.linkedRegistrationId, `user_${boyA.uid}`);
  assert.equal(afterLink.linkedBy, admin.uid);
  assert.ok(afterLink.linkedAt, "linkedAt valorizzato");
  const entry = await entryData(act, afterLink.linkedEntryId);
  assert.equal(entry.status, "pending");
  assert.equal(entry.kind, "proposal");
  assert.equal(entry.ownerUid, boyA.uid);
  assert.equal(entry.participantName, "Anna Prima", "il nome viene dall'iscrizione, mai da quello digitato");
  assert.equal(entry.sourceRequestId, proposalRes.requestId);
  assert.equal(entry.fromGuestRequest, true);
  assert.equal(entry.proposedText, "Torre di bicchieri");
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 1, "una proposta in attesa non muove il contatore");
  assert.equal(await stateOf(phone1, act, proposalRes.requestId), "pending");
  // Il titolare dell'account lo vede nei propri tentativi, con l'etichetta.
  const own = await getDocsFromServer(query(collection(boyA.firestore, `${activityPath(act)}/recordEntries`), where("ownerUid", "==", boyA.uid)));
  assert.deepEqual(own.docs.map((doc) => doc.id), [afterLink.linkedEntryId]);
  assert.equal(own.docs[0].data().fromGuestRequest, true);

  // 6. «Approva» esistente, sul tentativo collegato: nasce il record, il telefono vede «Ci sei».
  const approved = await A(admin, act, "approve", { entryId: afterLink.linkedEntryId, ...recordInput("Torre di bicchieri in 60 secondi", { category: "precisione" }) });
  assert.equal(approved.entry.status, "approved");
  assert.equal(approved.record.challengerCount, 1);
  assert.equal((await entryData(act, afterLink.linkedEntryId)).sourceRequestId, proposalRes.requestId);
  assert.equal(await stateOf(phone1, act, proposalRes.requestId), "approved");

  // 7. Collegamento della sfida: approved e contatore +1.
  await link(admin, act, challengeRes.requestId, `user_${boyB.uid}`);
  const challengeEntry = await linkedEntryOf(act, challengeRes.requestId);
  assert.equal(challengeEntry.status, "approved");
  assert.equal(challengeEntry.kind, "challenge");
  assert.equal(challengeEntry.recordId, r1.record.id);
  assert.equal(challengeEntry.ownerUid, boyB.uid);
  assert.equal(challengeEntry.createdByAdmin, true);
  assert.equal(challengeEntry.decidedBy, admin.uid);
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 2);
  assert.equal(await stateOf(phone1, act, challengeRes.requestId), "approved");

  // 8. Dopo il collegamento il telefono non ritira né ripristina.
  await expectFail(withdraw(phone1, act, challengeRes.requestId), "any");
  await expectFail(restore(phone1, act, challengeRes.requestId), "any");
  assert.equal((await entryData(act, challengeEntry.id)).status, "approved");
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 2);
  // Il titolo approvato è ora pubblico (D1): compare nell'elenco senza login.
  const after = await G(signedOut, act, "context");
  assert.ok(after.records.some((item) => item.title === "Torre di bicchieri in 60 secondi"));
  await assertConsistent(act);
  await assertMineMatchesData(phone1, act);
});

const LINK_TARGETS = ["user_", "child_", "manual_"];
for (const prefix of LINK_TARGETS) {
  for (const kind of ["proposal", "challenge"]) {
    test(`B2 linkRequest ${kind} su ${prefix}: tentativo, ownerUid, nome dall'iscrizione, contatore`, async () => {
      const { boyA, boyF, parent, admin, phone1 } = pool;
      const act = await newActivity({ members: [boyA, boyF] });
      const r1 = await makeRecord(act, boyF, "Record per il collegamento");
      let registrationId;
      let expectedOwner;
      let expectedName;
      if (prefix === "user_") {
        registrationId = `user_${boyA.uid}`;
        expectedOwner = boyA.uid;
        expectedName = "Anna Prima";
      } else if (prefix === "child_") {
        registrationId = await enrollChild(act, parent, "kid1", "Dario", "Rossi");
        expectedOwner = parent.uid;
        expectedName = "Dario Rossi";
      } else {
        registrationId = await enrollManual(act, "manual_zeffirino_quartarolo", "Zeffirino", "Quartarolo");
        expectedOwner = null;
        expectedName = "Zeffirino Quartarolo";
      }
      const requestId = kind === "proposal"
        ? await seedRequest(act, phone1, { who: WHO.maria, text: "Torre di bicchieri" })
        : await seedRequest(act, phone1, { who: WHO.maria, kind: "challenge", recordId: r1.record.id });
      const before = (await recordData(act, r1.record.id)).challengerCount;

      assert.equal((await link(admin, act, requestId, registrationId)).ok, true);
      const request = await requestData(act, requestId);
      assert.equal(request.status, "linked");
      assert.equal(request.linkedRegistrationId, registrationId);
      assert.equal(request.linkedBy, admin.uid);
      assert.ok(request.linkedAt, "linkedAt valorizzato");
      const entry = await entryData(act, request.linkedEntryId);
      assert.equal(entry.registrationId, registrationId);
      assert.equal(entry.ownerUid ?? null, expectedOwner, `ownerUid di un ${prefix}`);
      assert.equal(entry.participantName, expectedName, "participantName viene dall'iscrizione");
      assert.equal(entry.sourceRequestId, requestId);
      assert.equal(entry.fromGuestRequest, true);
      assert.equal(entry.kind, kind);
      if (kind === "proposal") {
        assert.equal(entry.status, "pending");
        assert.equal(entry.recordId ?? null, null);
        assert.equal(entry.proposedText, "Torre di bicchieri");
        assert.equal(entry.proposedMeasure, "count_in_time");
        assert.equal(entry.proposedDurationSeconds, 30);
        assert.equal((await recordData(act, r1.record.id)).challengerCount, before);
      } else {
        assert.equal(entry.status, "approved");
        assert.equal(entry.recordId, r1.record.id);
        assert.equal(entry.createdByAdmin, true);
        assert.equal(entry.decidedBy, admin.uid);
        assert.equal((await recordData(act, r1.record.id)).challengerCount, before + 1);
      }
      assert.equal(await stateOf(phone1, act, requestId), kind === "proposal" ? "pending" : "approved");
      if (expectedOwner) {
        const owner = prefix === "user_" ? boyA : parent;
        const rows = await getDocsFromServer(query(collection(owner.firestore, `${activityPath(act)}/recordEntries`), where("ownerUid", "==", owner.uid)));
        assert.deepEqual(rows.docs.map((doc) => doc.id), [request.linkedEntryId]);
        assert.equal(rows.docs[0].data().fromGuestRequest, true);
      }
      await assertConsistent(act);
    });
  }
}

test("B3 tentativo collegato: il titolare lo modifica, lo ritira e lo ripristina; il telefono vede lo stato giusto", async () => {
  const { boyA, boyF, admin, phone1 } = pool;
  const act = await newActivity({ members: [boyA, boyF] });
  const r1 = await makeRecord(act, boyF, "Record del titolare");
  const proposalId = await seedRequest(act, phone1, { who: WHO.maria, text: "Idea originale" });
  const challengeId = await seedRequest(act, phone1, { who: WHO.luca, kind: "challenge", recordId: r1.record.id });
  await link(admin, act, proposalId, `user_${boyA.uid}`);
  await link(admin, act, challengeId, `user_${boyA.uid}`);
  const proposalEntry = await linkedEntryOf(act, proposalId);
  const challengeEntry = await linkedEntryOf(act, challengeId);

  // Modifica del titolare: tocca il tentativo, non la richiesta.
  await P(boyA, act, "edit", { entryId: proposalEntry.id, ...proposal("Testo corretto dal titolare", { durationSeconds: 30 }) });
  assert.equal((await entryData(act, proposalEntry.id)).proposedText, "Testo corretto dal titolare");
  assert.equal((await requestData(act, proposalId)).proposedText, "Idea originale", "la richiesta resta com'è stata inviata");
  assert.equal(await stateOf(phone1, act, proposalId), "pending");
  // Spec: mine mostra il testo della richiesta, non quello del tentativo (se il titolare lo modifica divergono: è voluto).
  const shown = JSON.stringify((await mineById(phone1, act)).get(proposalId));
  assert.ok(shown.includes("Idea originale"), `mine non mostra il testo della richiesta: ${shown}`);
  assert.ok(!shown.includes("Testo corretto dal titolare"), "mine mostra il testo modificato dal titolare");

  // Ritira (sfida approvata): contatore -1; il telefono vede «removed».
  const withdrawnChallenge = await P(boyA, act, "withdraw", { entryId: challengeEntry.id });
  assert.equal(withdrawnChallenge.entry.statusBeforeWithdraw, "approved");
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 1);
  assert.equal(await stateOf(phone1, act, challengeId), "removed");
  assert.equal((await requestData(act, challengeId)).status, "linked", "la richiesta resta collegata");
  // Annulla: torna «Ci sei», contatore +1.
  await P(boyA, act, "restore", { entryId: challengeEntry.id });
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 2);
  assert.equal(await stateOf(phone1, act, challengeId), "approved");

  // Ritira e ripristina la proposta in attesa.
  await P(boyA, act, "withdraw", { entryId: proposalEntry.id });
  assert.equal(await stateOf(phone1, act, proposalId), "removed");
  await P(boyA, act, "restore", { entryId: proposalEntry.id });
  assert.equal(await stateOf(phone1, act, proposalId), "pending");
  await assertConsistent(act);
});

test("B4 scadenza dei dati: expiresAt = data del viaggio + 7 giorni (se manca, chiusura + 14)", async () => {
  const { phone1 } = pool;
  const withTrip = await newActivity({ startDate: TRIP_DATE });
  const first = await submit(phone1, withTrip, proposalRequest(WHO.maria));
  const expires = (await requestData(withTrip, first.requestId)).expiresAt.toMillis();
  const trip = Date.parse(`${TRIP_DATE}T00:00:00.000Z`);
  assert.ok(expires >= trip + 6.5 * DAY && expires <= trip + 8.5 * DAY, `expiresAt ${new Date(expires).toISOString()} non è 7 giorni dopo il viaggio (${TRIP_DATE})`);

  const closeAt = inFuture(100);
  const noTrip = await newActivity({ startDate: "absent", closeAt });
  const second = await submit(phone1, noTrip, proposalRequest(WHO.maria));
  const expiresFallback = (await requestData(noTrip, second.requestId)).expiresAt.toMillis();
  const close = new Date(closeAt).getTime();
  assert.ok(expiresFallback >= close + 13.5 * DAY && expiresFallback <= close + 14.5 * DAY, `expiresAt ${new Date(expiresFallback).toISOString()} non è chiusura + 14 giorni`);
});

// ---------------------------------------------------------------------------
// D. submissionId idempotente
// ---------------------------------------------------------------------------

test("D1 stesso submissionId = stessa richiesta, in qualunque stato (anche dopo ritiro, rifiuto, collegamento)", async () => {
  const { admin, boyA, phone1 } = pool;
  const act = await newActivity({ members: [boyA] });
  const open = proposalRequest(WHO.maria, { text: "Idea uno" });
  const first = await submit(phone1, act, open);
  const again = await submit(phone1, act, open);
  assert.equal(again.ok, true);
  assert.equal(again.requestId, first.requestId, "doppio tocco: una sola richiesta");
  assert.equal((await requestsOfPhone(act, phone1)).length, 1);

  // Dopo il ritiro il rinvio restituisce la stessa richiesta e NON la riapre.
  await withdraw(phone1, act, first.requestId);
  const afterWithdraw = await submit(phone1, act, open);
  assert.equal(afterWithdraw.requestId, first.requestId);
  assert.equal((await requestData(act, first.requestId)).status, "withdrawn");
  assert.equal((await requestsOfPhone(act, phone1)).length, 1);

  // Dopo il rifiuto.
  const secondPayload = proposalRequest(WHO.luca, { text: "Idea due" });
  const second = await submit(phone1, act, secondPayload);
  await rejectRequest(admin, act, second.requestId, "Non collegabile.");
  const afterReject = await submit(phone1, act, secondPayload);
  assert.equal(afterReject.requestId, second.requestId);
  assert.equal((await requestData(act, second.requestId)).status, "rejected");

  // Dopo il collegamento.
  const thirdPayload = proposalRequest(WHO.sara, { text: "Idea tre" });
  const third = await submit(phone1, act, thirdPayload);
  await link(admin, act, third.requestId, `user_${boyA.uid}`);
  const afterLink = await submit(phone1, act, thirdPayload);
  assert.equal(afterLink.requestId, third.requestId);
  assert.equal((await requestData(act, third.requestId)).status, "linked");
  assert.equal((await requestsOfPhone(act, phone1)).length, 3, "nessuna richiesta in più");
  await assertConsistent(act);
});

test("D2 stesso contenuto della stessa persona = la stessa richiesta (anche con token nuovo); contenuto diverso = richiesta nuova; il token di un'altra sessione non restituisce mai la richiesta altrui", async () => {
  const { phone1, phone2 } = pool;
  const act = await newActivity();
  const payload = proposalRequest(WHO.maria);
  const mine = await submit(phone1, act, payload);
  // Altra sessione, stesso token: una richiesta sua.
  const theirs = await submit(phone2, act, payload);
  assert.equal(theirs.ok, true);
  assert.notEqual(theirs.requestId, mine.requestId, "un'altra sessione non deve ricevere l'id della richiesta di un altro telefono");
  assert.equal((await requestData(act, theirs.requestId)).anonUid, phone2.uid);
  assert.equal((await requestData(act, mine.requestId)).anonUid, phone1.uid);
  assert.deepEqual((await mineItems(phone2, act)).map(idOf), [theirs.requestId]);
  assert.deepEqual((await mineItems(phone1, act)).map(idOf), [mine.requestId]);
  // Stessa persona, stesso contenuto, token nuovo, stessa sessione: è quella richiesta (idempotenza per persona).
  const fresh = await submit(phone1, act, { ...payload, submissionId: randomUUID() });
  assert.deepEqual(stripVolatile(fresh), stripVolatile(mine), "stessa forma di risposta di una creazione");
  assert.equal(fresh.requestId, mine.requestId);
  assert.equal((await requestsOfPhone(act, phone1)).length, 1, "nessun documento in più");
  // «Serve qualcosa?» non conta, e nemmeno maiuscole e spazi nel testo.
  const sameWithNeeds = await submit(phone1, act, { ...payload, submissionId: randomUUID(), needs: "Una corda", text: "  SALTI con la CORDA " });
  assert.equal(sameWithNeeds.requestId, mine.requestId);
  assert.equal((await requestsOfPhone(act, phone1)).length, 1);
  // Contenuto diverso (testo, durata o misura): richiesta nuova (una persona per variante: il tetto è 2 per persona).
  for (const [who, variant] of [
    [WHO.luca, { text: "Un'altra idea" }],
    [WHO.sara, { durationSeconds: 45 }],
    [WHO.paolo, { measure: "count_streak", durationSeconds: null }],
  ]) {
    const base = await submit(phone1, act, proposalRequest(who));
    const other = await submit(phone1, act, proposalRequest(who, variant));
    assert.notEqual(other.requestId, base.requestId, `contenuto diverso (${Object.keys(variant).join(", ")}) = richiesta nuova`);
  }
  assert.equal((await requestsOfPhone(act, phone1)).length, 7);
});

test("D3 il rinvio al tetto non dà errore: stesso token o stessa persona con lo stesso contenuto restituiscono la richiesta già creata", async () => {
  const { phone1 } = pool;
  const act = await newActivity();
  const people = [WHO.maria, WHO.maria, WHO.luca, WHO.luca, WHO.sara, WHO.sara, WHO.paolo, WHO.paolo, WHO.elena, WHO.elena, WHO.marco, WHO.marco];
  let last;
  let lastPayload;
  for (const [index, who] of people.entries()) {
    lastPayload = proposalRequest(who, { text: `Idea ${index}` });
    last = await submit(phone1, act, lastPayload);
  }
  assert.equal((await requestsOfPhone(act, phone1)).length, 12);
  // Doppio tocco sulla dodicesima (stesso token).
  const replay = await submit(phone1, act, lastPayload);
  assert.equal(replay.requestId, last.requestId, "il rinvio al tetto restituisce la richiesta già creata");
  // Foglio nuovo, stessa persona e stesso contenuto: è quella richiesta, anche col telefono al tetto.
  const sameAgain = await submit(phone1, act, { ...lastPayload, submissionId: randomUUID() });
  assert.deepEqual(stripVolatile(sameAgain), stripVolatile(last));
  assert.equal(sameAgain.requestId, last.requestId);
  assert.equal((await requestsOfPhone(act, phone1)).length, 12);
  // Un'altra persona (o contenuto nuovo di una persona già a 2) trova il tetto del telefono.
  await expectFail(submit(phone1, act, proposalRequest(WHO.giulia)), "any", MAX_PHONE_MSG);
  await expectFail(submit(phone1, act, proposalRequest(WHO.marco, { text: "Una terza idea" })), "any", MAX_PHONE_MSG);
  assert.equal((await requestsOfPhone(act, phone1)).length, 12);
});

// ---------------------------------------------------------------------------
// E. Account vero, nomi, unità, payload
// ---------------------------------------------------------------------------

test("E1 un account vero riceve «Hai un account: accedi»; senza login non si invia; nulla viene creato", async () => {
  const { boyA, admin, signedOut } = pool;
  const act = await newActivity({ members: [boyA] });
  for (const client of [boyA, admin]) {
    await expectFail(submit(client, act, proposalRequest(WHO.maria)), "any", HAS_ACCOUNT);
  }
  for (const action of ["submit", "mine", "withdraw", "restore"]) {
    const payload = action === "submit" ? proposalRequest(WHO.maria) : action === "mine" ? {} : { requestId: "qualsiasi" };
    await expectFail(G(signedOut, act, action, payload), "unauthenticated");
  }
  // mine non è di un account vero: o rifiutato o vuoto (mai le richieste di qualcun altro).
  const seeded = await seedRequest(act, pool.phone1, { who: WHO.maria });
  const outcome = await capture(G(boyA, act, "mine"));
  if (outcome.ok) {
    const items = Object.values(outcome.data).find(Array.isArray) ?? [];
    assert.deepEqual(items.map(idOf), [], "un account vero non vede richieste di telefoni");
  }
  assert.equal((await requestsRef(act).get()).size, 1, `solo la richiesta seminata (${seeded})`);
});

const INVALID_NAMES = [
  "Mar1a", "1234", "Maria3", "3Maria",
  "https://evil.example", "www.evil.it", "evil.it", "mail@evil.it", "Maria.com",
  "<b>Maria</b>", "<script>alert(1)</script>", "Maria<img src=x>", "Maria&Co", "{{nome}}", "Maria_Rossi", "Maria;", "Maria\u0000", "Maria\u0007",
  "Maria 😀", "",
  "   ", "A", "A".repeat(41),
];
const VALID_NAMES = ["Zoë", "D'Angelo", "Anna-Maria", "Åsa", "Li", "Abcdefghij".repeat(4)];

test("E2 nome e cognome: cifre, URL, markup e lunghezze fuori da 2-40 rifiutati; lettere accentate, apostrofo e trattino accettati", async () => {
  const phone = await newPhone();
  const act = await newActivity();
  const failures = [];
  for (const bad of INVALID_NAMES) {
    for (const field of ["firstName", "lastName"]) {
      const outcome = await capture(submit(phone, act, proposalRequest({ ...WHO.maria, [field]: bad }, { text: `Prova ${field}` })));
      if (outcome.ok || outcome.code !== "functions/invalid-argument") failures.push(`${field}=${JSON.stringify(bad)}: ${outcome.ok ? "ACCETTATO" : outcome.code}`);
    }
  }
  assert.deepEqual(failures, [], `Nomi non validi non rifiutati con invalid-argument:\n${failures.join("\n")}`);
  assert.equal((await requestsOfPhone(act, phone)).length, 0, "nessun dato parziale per i nomi rifiutati");

  // A capo e tab sono spazi bianchi: il modulo li riduce a uno spazio come negli altri campi di testo
  // (la spec dice «spazio»). Accettato o rifiutato va bene, ma non devono restare a capo salvati.
  const spacing = await newPhone();
  for (const [index, raw] of ["Maria\nRossi", "Maria\tRossi", "  Anna   Maria  "].entries()) {
    const outcome = await capture(submit(spacing, act, proposalRequest({ firstName: raw, lastName: `Spazi${["Alfa", "Beta", "Gamma"][index]}`, unitId: UNITS.a.id }, { text: `Spazi ${index}` })));
    if (outcome.ok) {
      const stored = (await requestData(act, outcome.data.requestId)).firstName;
      assert.doesNotMatch(stored, /[\n\r\t]|\s{2}|^\s|\s$/u, `firstName salvato con spazi bianchi non normalizzati: ${JSON.stringify(stored)}`);
    } else {
      assert.equal(outcome.code, "functions/invalid-argument");
    }
  }
  const surnames = ["Alfa", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"];
  for (const [index, good] of VALID_NAMES.entries()) {
    const who = { firstName: good, lastName: surnames[index], unitId: UNITS.a.id };
    const res = await submit(phone, act, proposalRequest(who, { text: `Valido ${index}` }));
    assert.equal(res.ok, true, good);
    assert.equal((await requestData(act, res.requestId)).firstName, good);
  }
});

test("E3 unità: inattiva, inesistente, di un altro palo o assente rifiutate", async () => {
  const phone = await newPhone();
  const act = await newActivity();
  const bad = [
    ["unità inattiva", { ...WHO.maria, unitId: UNITS.off.id }],
    ["unità inesistente", { ...WHO.maria, unitId: "unita-che-non-esiste" }],
    ["unità di un altro palo", { ...WHO.maria, unitId: "foreign-unit" }],
    ["unità con id non valido", { ...WHO.maria, unitId: "../altro" }],
    ["unità assente", { firstName: "Maria", lastName: "Verdi" }],
  ];
  for (const [label, who] of bad) {
    await expectFail(submit(phone, act, proposalRequest(who)), ["invalid-argument", "failed-precondition", "not-found"]).catch((error) => {
      throw new Error(`${label}: ${error.message}`);
    });
  }
  assert.equal((await requestsOfPhone(act, phone)).length, 0);
  // Un'unità che diventa inattiva dopo l'invio non cancella la richiesta (la spec: attiva «al momento dell'invio»).
  const ok = await submit(phone, act, proposalRequest(WHO.maria));
  await adminDb.doc(`stakes/${stakeId}/units/${UNITS.b.id}`).update({ isActive: false });
  try {
    assert.equal((await requestData(act, ok.requestId)).status, "open");
    await expectFail(submit(phone, act, proposalRequest(WHO.luca)), ["invalid-argument", "failed-precondition", "not-found"]);
  } finally {
    await adminDb.doc(`stakes/${stakeId}/units/${UNITS.b.id}`).update({ isActive: true });
  }
});

test("E4 payload non valido: invalid-argument e nessun dato parziale; chiavi non previste non cambiano la richiesta", async () => {
  const phone = await newPhone();
  const { boyA } = pool;
  const act = await newActivity({ members: [boyA] });
  const base = proposalRequest(WHO.maria);
  const without = (key) => {
    const copy = { ...base };
    delete copy[key];
    return copy;
  };
  const bad = [
    ["submissionId assente", without("submissionId")],
    ["submissionId vuoto", { ...base, submissionId: "" }],
    ["kind assente", without("kind")],
    ["kind sconosciuto", { ...base, kind: "altro" }],
    ["proposta senza testo", { ...base, text: "" }],
    ["testo di soli spazi", { ...base, text: "   " }],
    ["testo oltre 120 caratteri", { ...base, text: "a".repeat(121) }],
    ["misura sconosciuta", { ...base, measure: "inventata" }],
    ["count_in_time senza durata", { ...base, durationSeconds: null }],
    ["durata sotto 10", { ...base, durationSeconds: 9 }],
    ["durata sopra 60", { ...base, durationSeconds: 61 }],
    ["durata non intera", { ...base, durationSeconds: 30.5 }],
    ["durata su una misura senza tempo", { ...base, measure: "distance", durationSeconds: 30 }],
    ["serve oltre 120 caratteri", { ...base, needs: "n".repeat(121) }],
    ["carattere di controllo nel testo", { ...base, text: "Idea\u0007" }],
    ["sfida senza recordId", challengeRequest(WHO.maria, undefined)],
    ["sfida con recordId non valido", challengeRequest(WHO.maria, "../altro")],
    ["nome assente", without("firstName")],
    ["cognome assente", without("lastName")],
  ];
  const failures = [];
  for (const [label, payload] of bad) {
    const outcome = await capture(submit(phone, act, payload));
    if (outcome.ok || outcome.code !== "functions/invalid-argument") failures.push(`${label}: ${outcome.ok ? "ACCETTATO" : outcome.code}`);
  }
  assert.deepEqual(failures, [], `Payload non validi non rifiutati con invalid-argument:\n${failures.join("\n")}`);
  assert.equal((await requestsOfPhone(act, phone)).length, 0, "nessun dato parziale");

  // Un telefono non decide mai registrationId, stato, titolare o legami: o rifiutato o ignorato.
  const smuggled = [
    { registrationId: `user_${boyA.uid}` },
    { linkedRegistrationId: `user_${boyA.uid}`, linkedEntryId: "x", linkedBy: pool.admin.uid },
    { status: "linked" },
    { anonUid: pool.phone2.uid },
    { staffNote: "scritta dal telefono" },
  ];
  for (const [index, extra] of smuggled.entries()) {
    const who = person(["Alba", "Berta", "Cinzia", "Dora", "Elisa"][index], "Lunari");
    const outcome = await capture(submit(phone, act, proposalRequest(who, { text: `Contrabbando ${index}`, ...extra })));
    if (!outcome.ok) {
      assert.equal(outcome.code, "functions/invalid-argument", JSON.stringify(extra));
      continue;
    }
    const stored = await requestData(act, outcome.data.requestId);
    assert.equal(stored.status, "open", `status deciso dal telefono: ${JSON.stringify(extra)}`);
    assert.equal(stored.anonUid, phone.uid, "anonUid è sempre la sessione chiamante");
    for (const field of LINK_FIELDS) assert.ok(!stored[field], `${field} deciso dal telefono`);
    assert.ok(!stored.registrationId, "registrationId deciso dal telefono");
    assert.ok(!stored.staffNote, "staffNote scritta dal telefono");
  }
  assert.equal((await entriesRef(act).get()).size, 0, "nessun tentativo creato da un invio");
});

test("E5 un altro telefono non ritira né ripristina: stesso errore di una richiesta inesistente, nulla cambia", async () => {
  const { phone1, phone2 } = pool;
  const act = await newActivity();
  const first = await submit(phone1, act, proposalRequest(WHO.maria));
  const second = await submit(phone1, act, proposalRequest(WHO.luca));
  await withdraw(phone1, act, second.requestId);
  for (const action of ["withdraw", "restore"]) {
    const foreign = await capture(G(phone2, act, action, { requestId: action === "withdraw" ? first.requestId : second.requestId }));
    const missing = await capture(G(phone2, act, action, { requestId: "richiesta-che-non-esiste" }));
    assert.equal(foreign.ok, false, `${action} di una richiesta altrui riuscito`);
    assert.equal(missing.ok, false);
    assert.deepEqual(foreign, missing, `${action}: l'errore su una richiesta altrui deve essere identico a quello su una inesistente`);
  }
  assert.equal((await requestData(act, first.requestId)).status, "open");
  assert.equal((await requestData(act, second.requestId)).status, "withdrawn");
  // Anche con requestId malformati l'errore non è un crash.
  await expectFail(G(phone2, act, "withdraw", { requestId: "../altro" }), ["invalid-argument", "not-found", "failed-precondition"]);
  await expectFail(G(phone2, act, "withdraw", {}), "invalid-argument");
});

// ---------------------------------------------------------------------------
// C. Tetti: 6 aperte per telefono, 2 per persona, 20 create, 100 per attività
// ---------------------------------------------------------------------------

// «Errori sul solo chiamante» della spec per i tetti del telefono.
const PHONE_LIMIT_RE = /^(Hai già inviato il massimo di richieste da questo telefono\.|Non riesco a riceverla ora\. Parlane con il dirigente della tua unità\.)$/u;

test("C1 tetto: 12 richieste aperte per telefono (proposte e sfide); un altro telefono e un posto liberato funzionano", async () => {
  const { phone1, phone2, boyF } = pool;
  const act = await newActivity({ members: [boyF] });
  const r1 = await makeRecord(act, boyF, "Record del tetto");
  const twelve = [WHO.maria, WHO.maria, WHO.luca, WHO.luca, WHO.sara, WHO.sara, WHO.paolo, WHO.paolo, WHO.elena, WHO.elena, WHO.marco, WHO.marco];
  const ids = [];
  for (const [index, who] of twelve.entries()) ids.push((await submit(phone1, act, proposalRequest(who, { text: `Idea ${index}` }))).requestId);
  assert.equal((await requestsOfPhone(act, phone1)).length, 12);

  await expectFail(submit(phone1, act, proposalRequest(WHO.giulia)), "any", MAX_PHONE_MSG);
  await expectFail(submit(phone1, act, challengeRequest(WHO.giulia, r1.record.id)), "any", MAX_PHONE_MSG);
  assert.equal((await requestsOfPhone(act, phone1)).length, 12, "le richieste rifiutate dal tetto non lasciano dati");

  // Un altro telefono, stesse persone: accettato in silenzio (lo staff vede il raggruppamento).
  assert.equal((await submit(phone2, act, proposalRequest(WHO.maria, { text: "Idea 0" }))).ok, true);

  // Ritirare libera un posto; il tetto torna a 12.
  await withdraw(phone1, act, ids[0]);
  assert.equal((await submit(phone1, act, proposalRequest(WHO.giulia))).ok, true);
  await expectFail(submit(phone1, act, proposalRequest(WHO.tommaso)), "any", MAX_PHONE_MSG);
  // Le richieste non più aperte (rifiutate, collegate) non occupano il tetto.
  await rejectRequest(pool.admin, act, ids[1], "No.");
  assert.equal((await submit(phone1, act, proposalRequest(WHO.tommaso))).ok, true);
  await assertConsistent(act);
});

test("C2 tetto: 2 richieste aperte per persona e telefono; nome normalizzato (maiuscole e accenti); altra unità o altro telefono liberi", async () => {
  const { phone1, phone2 } = pool;
  const act = await newActivity();
  const base = person("Àgata", "Bianchi");
  const first = await submit(phone1, act, proposalRequest(base, { text: "Uno" }));
  const second = await submit(phone1, act, proposalRequest({ ...base, firstName: "AGATA", lastName: "bianchi" }, { text: "Due" }));
  assert.equal((await requestData(act, first.requestId)).personKey, "agata bianchi|unit-a");
  assert.equal((await requestData(act, second.requestId)).personKey, "agata bianchi|unit-a", "personKey: minuscole e senza accenti");
  await expectFail(submit(phone1, act, proposalRequest({ ...base, firstName: "agàta" }, { text: "Tre" })), "any", PHONE_LIMIT_RE);
  assert.equal((await requestsOfPhone(act, phone1)).length, 2);

  // Altra unità = altra persona. Altro cognome = altra persona.
  assert.equal((await submit(phone1, act, proposalRequest({ ...base, unitId: UNITS.b.id }, { text: "Altra unità" }))).ok, true);
  assert.equal((await submit(phone1, act, proposalRequest({ ...base, lastName: "Rossi" }, { text: "Altro cognome" }))).ok, true);
  // Un altro telefono può inviare la stessa persona: accettato in silenzio.
  assert.equal((await submit(phone2, act, proposalRequest(base, { text: "Altro telefono" }))).ok, true);
  // Ritirarne una libera il posto.
  await withdraw(phone1, act, first.requestId);
  assert.equal((await submit(phone1, act, proposalRequest({ ...base, firstName: "àgata" }, { text: "Tre bis" }))).ok, true);
  await assertConsistent(act);
});

test("C3 tetto: 40 richieste create in tutto per telefono, anche se ritirate; il rinvio di un token vecchio resta valido", async () => {
  const phone = await newPhone();
  const act = await newActivity();
  const people = [WHO.maria, WHO.luca, WHO.sara, WHO.paolo, WHO.elena];
  const payloads = [];
  for (let index = 0; index < 40; index += 1) {
    const payload = proposalRequest(people[index % people.length], { text: `Idea ${index}` });
    payloads.push(payload);
    const created = await submit(phone, act, payload);
    await withdraw(phone, act, created.requestId);
  }
  const mine = await requestsOfPhone(act, phone);
  assert.equal(mine.length, 40);
  assert.ok(mine.every((request) => request.status === "withdrawn"));
  await expectFail(submit(phone, act, proposalRequest(WHO.giulia)), "any", PHONE_LIMIT_RE);
  assert.equal((await requestsOfPhone(act, phone)).length, 40, "la quarantunesima non lascia dati");
  // Rinvio di un token già usato: restituisce la richiesta già creata, non un errore di tetto.
  const replay = await submit(phone, act, payloads[0]);
  assert.equal(replay.requestId, mine.find((request) => request.submissionId === payloads[0].submissionId).id);
  // Il tetto è del telefono: un altro invia.
  assert.equal((await submit(pool.phone2, act, proposalRequest(WHO.giulia))).ok, true);
});

test("C4 tetto: 100 richieste aperte per attività, anche su restore; reopenRequest e unlinkRequest lo superano", async (t) => {
  const { admin, boyA, boyF } = pool;
  const act = await newActivity({ members: [boyA, boyF] });
  const phoneW = await newPhone();
  const phoneR = await newPhone();
  const phoneL = await newPhone();
  const withdrawnId = (await submit(phoneW, act, proposalRequest(WHO.maria, { text: "Ritirata" }))).requestId;
  await withdraw(phoneW, act, withdrawnId);
  const rejectedId = (await submit(phoneR, act, proposalRequest(WHO.luca, { text: "Rifiutata" }))).requestId;
  await rejectRequest(admin, act, rejectedId, "Non collegabile.");
  const linkedId = (await submit(phoneL, act, proposalRequest(WHO.sara, { text: "Collegata" }))).requestId;
  await link(admin, act, linkedId, `user_${boyA.uid}`);

  // Riempie la coda a 100 richieste aperte: 16 telefoni da 6 e uno da 4.
  const fillers = [];
  let openCount = 0;
  const trio = [WHO.maria, WHO.luca, WHO.sara];
  while (openCount < 100) {
    const phone = await newPhone();
    const ids = [];
    for (let slot = 0; slot < 6 && openCount < 100; slot += 1) {
      const created = await submit(phone, act, proposalRequest(trio[Math.floor(slot / 2)], { text: `Coda ${openCount}` }));
      ids.push(created.requestId);
      openCount += 1;
    }
    fillers.push({ phone, ids });
  }
  t.diagnostic(`telefoni usati per riempire la coda: ${fillers.length}`);
  const queueSize = async () => (await requestsRef(act).where("status", "==", "open").get()).size;
  assert.equal(await queueSize(), 100);

  // Coda piena: errore neutro per chi invia e per chi ripristina; nulla cambia.
  const latecomer = await newPhone();
  await expectFail(submit(latecomer, act, proposalRequest(WHO.tommaso)), "any", CANNOT_RECEIVE_MSG);
  await expectFail(restore(phoneW, act, withdrawnId), "any", CANNOT_RECEIVE_MSG);
  assert.equal((await requestData(act, withdrawnId)).status, "withdrawn");
  assert.equal(await queueSize(), 100);
  assert.equal((await requestsOfPhone(act, latecomer)).length, 0);

  // Lo staff supera il tetto: la coda può superare 100 per mano dello staff, mai di un telefono.
  assert.equal((await reopenRequest(admin, act, rejectedId)).ok, true);
  assert.equal((await unlink(admin, act, linkedId)).ok, true);
  assert.equal(await queueSize(), 102);
  assert.equal((await requestData(act, rejectedId)).status, "open");
  assert.equal((await requestData(act, linkedId)).status, "open");
  await expectFail(submit(latecomer, act, proposalRequest(WHO.tommaso)), "any", CANNOT_RECEIVE_MSG);

  // Un telefono può sempre ritirare; sotto i 100 si torna a ricevere.
  await withdraw(phoneR, act, rejectedId);
  await withdraw(phoneL, act, linkedId);
  assert.equal(await queueSize(), 100);
  await expectFail(submit(latecomer, act, proposalRequest(WHO.tommaso)), "any", CANNOT_RECEIVE_MSG);
  await withdraw(fillers[0].phone, act, fillers[0].ids[0]);
  assert.equal(await queueSize(), 99);
  assert.equal((await submit(latecomer, act, proposalRequest(WHO.tommaso))).ok, true);
  assert.equal(await queueSize(), 100);
  await expectFail(restore(phoneW, act, withdrawnId), "any", CANNOT_RECEIVE_MSG);
  await withdraw(fillers[0].phone, act, fillers[0].ids[1]);
  assert.equal((await restore(phoneW, act, withdrawnId)).ok, true);
  assert.equal((await requestData(act, withdrawnId)).status, "open");
  assert.equal(await queueSize(), 100);
  await assertConsistent(act);
});

test("C5 restore rispetta i tetti come submit: 12 per telefono e 2 per persona", async () => {
  const { phone2 } = pool;
  const phone = await newPhone();
  const act = await newActivity();
  // Tetto del telefono: 1 ritirata + 12 aperte.
  const parked = await submit(phone, act, proposalRequest(WHO.tommaso, { text: "Parcheggiata" }));
  await withdraw(phone, act, parked.requestId);
  const open = [];
  const six = [WHO.luca, WHO.luca, WHO.sara, WHO.sara, WHO.paolo, WHO.paolo, WHO.maria, WHO.maria, WHO.elena, WHO.elena, WHO.marco, WHO.marco];
  for (const [index, who] of six.entries()) {
    open.push((await submit(phone, act, proposalRequest(who, { text: `Aperta ${index}` }))).requestId);
  }
  await expectFail(restore(phone, act, parked.requestId), "any", MAX_PHONE_MSG);
  assert.equal((await requestData(act, parked.requestId)).status, "withdrawn", "ripristino rifiutato: la richiesta resta ritirata");
  await withdraw(phone, act, open[11]);
  assert.equal((await restore(phone, act, parked.requestId)).ok, true);
  assert.equal((await requestData(act, parked.requestId)).status, "open");

  // Tetto per persona: una ritirata + due aperte della stessa persona (contenuti diversi).
  const who = WHO.giulia;
  const a1 = await submit(phone2, act, proposalRequest(who, { text: "Giulia uno" }));
  await withdraw(phone2, act, a1.requestId);
  const a2 = await submit(phone2, act, proposalRequest(who, { text: "Giulia due" }));
  await submit(phone2, act, proposalRequest(who, { text: "Giulia tre" }));
  await expectFail(restore(phone2, act, a1.requestId), "any", PHONE_LIMIT_RE);
  assert.equal((await requestData(act, a1.requestId)).status, "withdrawn");
  await withdraw(phone2, act, a2.requestId);
  assert.equal((await restore(phone2, act, a1.requestId)).ok, true);
  await assertConsistent(act);
});

test("C6 reopenRequest e unlinkRequest non controllano i tetti del telefono e della persona", async () => {
  const { admin, boyA } = pool;
  const phone = await newPhone();
  const act = await newActivity({ members: [boyA] });
  const open = [];
  const twelve = [WHO.luca, WHO.luca, WHO.sara, WHO.sara, WHO.paolo, WHO.paolo, WHO.maria, WHO.maria, WHO.marco, WHO.marco, WHO.giulia, WHO.giulia];
  for (const [index, who] of twelve.entries()) {
    open.push((await submit(phone, act, proposalRequest(who, { text: `Aperta ${index}` }))).requestId);
  }
  await expectFail(submit(phone, act, proposalRequest(WHO.elena)), "any", MAX_PHONE_MSG);
  // Una rifiutata e una collegata, entrambe già del telefono: lo staff le riporta in coda oltre i tetti.
  const rejectedId = await seedRequest(act, phone, { who: WHO.elena, status: "rejected" });
  const linkedSeed = await seedRequest(act, phone, { who: WHO.luca, text: "Terza di Luca" });
  await link(admin, act, linkedSeed, `user_${boyA.uid}`);
  assert.equal((await reopenRequest(admin, act, rejectedId)).ok, true, "reopenRequest oltre il tetto del telefono");
  assert.equal((await unlink(admin, act, linkedSeed)).ok, true, "unlinkRequest oltre i tetti del telefono e della persona");
  const mine = await requestsOfPhone(act, phone);
  assert.equal(mine.filter((request) => request.status === "open").length, 14);
  assert.equal(mine.filter((request) => request.personKey === personKeyOf(WHO.luca)).filter((request) => request.status === "open").length, 3);
  // Il telefono non può invece aggiungerne altre.
  await expectFail(submit(phone, act, proposalRequest(WHO.tommaso)), "any", MAX_PHONE_MSG);
  await assertConsistent(act);
});

// ---------------------------------------------------------------------------
// F. ORACOLO: nome iscritto, sconosciuto e duplicato = stessa risposta
// ---------------------------------------------------------------------------

async function snapshotWorld(activityId) {
  const [entries, records, registrations] = await Promise.all([
    allDocs(entriesRef(activityId)),
    allDocs(recordsRef(activityId)),
    allDocs(registrationsRef(activityId)),
  ]);
  const byId = (left, right) => left.id.localeCompare(right.id);
  return JSON.parse(JSON.stringify({ entries: entries.sort(byId), records: records.sort(byId), registrations: registrations.sort(byId) }));
}

test("F1 oracolo: nome di una persona iscritta, sconosciuto e duplicato danno risposte identiche, e il mondo non cambia", async () => {
  const { boyA, boyB, boyC, boyD, boyF, parent } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyC, boyF] });
  const r1 = await makeRecord(act, boyF, "Record oracolo");
  await P(boyB, act, "challenge", { recordId: r1.record.id }); // Bruno è già sul record
  await P(boyC, act, "propose", proposal("Idea uno di Carlo")); // Carlo è al limite di 2
  await P(boyC, act, "propose", proposal("Idea due di Carlo"));
  await enrollChild(act, parent, "kid1", "Dario", "Rossi");
  await enrollManual(act, "manual_mario", "Mario", "Manuale");
  await enrollRaw(act, "guest_gianni", "Gianni", "Ospite");
  await enrollUser(act, boyD, { registrationStatus: "cancelled" }); // Diana: iscrizione annullata

  const families = {
    "iscritta, nessun tentativo": person("Anna", "Prima"),
    "iscritta, già sul record": person("Bruno", "Secondo"),
    "iscritta, al limite di 2": person("Carlo", "Terzo"),
    "figlio child_": person("Dario", "Rossi"),
    "manual_": person("Mario", "Manuale"),
    "guest_": person("Gianni", "Ospite"),
    "iscrizione annullata": person("Diana", "Quarta"),
    "sconosciuta": person("Qwxz", "Vkjh"),
    "iscritta, altra unità": person("Anna", "Prima", UNITS.b),
  };
  const before = await snapshotWorld(act);

  const outcomes = [];
  const record = async (label, kind, phone, payload) => {
    const res = await submit(phone, act, payload);
    outcomes.push({ label, kind, phone, res, payload });
  };
  for (const [label, who] of Object.entries(families)) {
    await record(label, "proposal", await newPhone(), proposalRequest(who, { text: "Torre di bicchieri" }));
    await record(label, "challenge", await newPhone(), challengeRequest(who, r1.record.id));
  }
  // Duplicati: stessa persona e stesso contenuto da un'ALTRA sessione (si crea, indistinguibile) e dalla STESSA
  // sessione (è la richiesta già aperta: stessa risposta di una creazione, nessun documento nuovo).
  const dupWho = person("Duplicata", "Persona");
  const dupPhoneA = await newPhone();
  const dupPhoneB = await newPhone();
  const dupPhoneC = await newPhone();
  await record("sconosciuta (primo invio)", "proposal", dupPhoneA, proposalRequest(dupWho, { text: "Stessa idea" }));
  await record("duplicato da un'altra sessione", "proposal", dupPhoneB, proposalRequest(dupWho, { text: "Stessa idea" }));
  await record("duplicato dalla stessa sessione", "proposal", dupPhoneA, proposalRequest(dupWho, { text: "Stessa idea" }));
  await record("sconosciuta (sfida, primo invio)", "challenge", dupPhoneC, challengeRequest(dupWho, r1.record.id));
  await record("duplicato di sfida da un'altra sessione", "challenge", dupPhoneB, challengeRequest(dupWho, r1.record.id));
  await record("duplicato di sfida dalla stessa sessione", "challenge", dupPhoneC, challengeRequest(dupWho, r1.record.id));
  const sameSession = new Set(["duplicato dalla stessa sessione", "duplicato di sfida dalla stessa sessione"]);

  // 1. Stessa risposta (a meno di requestId e timestamp), per forma e per valori.
  const reference = stripVolatile(outcomes[0].res);
  assert.equal(outcomes[0].res.ok, true);
  assert.equal(typeof outcomes[0].res.requestId, "string");
  const ids = new Set();
  for (const { label, kind, res } of outcomes) {
    assert.deepEqual(stripVolatile(res), reference, `${kind} «${label}»: la risposta cambia`);
    assert.equal(typeof res.requestId, "string", `${kind} «${label}»: requestId assente`);
    ids.add(res.requestId);
  }
  // Ogni invio con token nuovo è una richiesta nuova, anche il duplicato di un'altra sessione; solo il duplicato
  // della STESSA sessione (stessa persona, stesso contenuto, ancora aperta) restituisce la richiesta già creata.
  assert.equal(ids.size, outcomes.length - sameSession.size, "i duplicati della stessa sessione non creano richieste");
  const firstOf = (kind, phone) => outcomes.find((item) => item.kind === kind && item.phone === phone && !sameSession.has(item.label));
  for (const item of outcomes.filter((entry) => sameSession.has(entry.label))) {
    assert.equal(item.res.requestId, firstOf(item.kind, item.phone).res.requestId, `${item.label}: deve essere la richiesta già aperta`);
  }

  // 2. Stesso documento: stesse chiavi, tutte `open`, nessuna traccia dell'iscrizione.
  const requestForbidden = new Set(["registrationId", "linkedRegistrationId", "linkedEntryId", "suggestions", "matched", "registration", "entryId", "participantName"]);
  const keysByKind = { proposal: null, challenge: null };
  for (const { label, kind, res } of outcomes.filter((item) => !sameSession.has(item.label))) {
    const stored = await requestData(act, res.requestId);
    assert.equal(stored.status, "open", `${kind} «${label}»: stato iniziale`);
    const populated = Object.fromEntries(Object.entries(stored).filter(([, value]) => value !== null && value !== undefined && value !== ""));
    assert.deepEqual(forbiddenPaths(populated, requestForbidden), [], `${kind} «${label}»: il documento porta dati dell'iscrizione`);
    for (const field of LINK_FIELDS) assert.ok(!stored[field], `${kind} «${label}»: ${field}`);
    const keys = sortedKeys(stored).filter((key) => !["staffNote", "decidedBy", "decidedAt"].includes(key));
    if (keysByKind[kind] === null) keysByKind[kind] = keys;
    assert.deepEqual(keys, keysByKind[kind], `${kind} «${label}»: il documento ha chiavi diverse dagli altri`);
  }

  // 3. mine: stessa forma per tutti.
  const mineKeys = new Map();
  for (const { label, kind, phone, res } of outcomes) {
    const item = (await mineById(phone, act)).get(res.requestId);
    assert.ok(item, `${kind} «${label}»: mine non la elenca`);
    assert.equal(item.state, "received", `${kind} «${label}»`);
    assert.deepEqual(forbiddenPaths(item), [], `${kind} «${label}»: chiavi riservate in mine`);
    const keys = sortedKeys(item).join(",");
    if (!mineKeys.has(kind)) mineKeys.set(kind, keys);
    assert.equal(keys, mineKeys.get(kind), `${kind} «${label}»: mine ha chiavi diverse`);
  }

  // 4. L'invio non ha cambiato nulla né di record, né di tentativi, né di iscrizioni.
  assert.deepEqual(await snapshotWorld(act), before, "un invio ha modificato record, tentativi o iscrizioni");
  assert.equal((await requestsRef(act).get()).size, outcomes.length - sameSession.size, "nessun invio di un'altra sessione è stato scartato o accorpato");
  assert.ok((await allDocs(requestsRef(act))).every((request) => request.status === "open"), "nessun duplicato rifiutato da solo");
  await assertConsistent(act);
});

test("F2 oracolo: la sfida a un record su cui la persona c'è già, e al limite di 2, non cambia l'esito dell'invio", async () => {
  const { boyB, boyC, boyF } = pool;
  const act = await newActivity({ members: [boyB, boyC, boyF] });
  const r1 = await makeRecord(act, boyF, "Record uno");
  const r2 = await makeRecord(act, boyF, "Record due");
  await P(boyB, act, "challenge", { recordId: r1.record.id });
  await P(boyC, act, "challenge", { recordId: r1.record.id });
  await P(boyC, act, "challenge", { recordId: r2.record.id });
  const phones = [await newPhone(), await newPhone(), await newPhone()];
  const results = [
    await submit(phones[0], act, challengeRequest(person("Bruno", "Secondo"), r1.record.id)),
    await submit(phones[1], act, challengeRequest(person("Carlo", "Terzo"), r2.record.id)),
    await submit(phones[2], act, challengeRequest(person("Nessuno", "Sconosciuto"), r1.record.id)),
  ];
  const reference = stripVolatile(results[2]);
  for (const res of results) assert.deepEqual(stripVolatile(res), reference);
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 3, "le sfide da telefono non toccano il contatore");
  await assertConsistent(act);
});

// ---------------------------------------------------------------------------
// G. mine: stati, nessuna fuga, errori dei ritiri generici
// ---------------------------------------------------------------------------

test("G1 mine: received, withdrawn, not_linked, pending, approved, rejected, removed; nessuna fuga di iscrizioni, note o contatori", async () => {
  const { boyA, boyB, boyC, boyF, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyC, boyF] });
  const r1 = await makeRecord(act, boyF, "Record di prova");
  const manualId = await enrollManual(act, "manual_zeffirino", "Zeffirino", "Quartarolo");
  const phone = await newPhone();
  const q = {};
  q.received = (await submit(phone, act, proposalRequest(WHO.maria, { text: "Idea ricevuta" }))).requestId;
  q.withdrawn = (await submit(phone, act, proposalRequest(WHO.luca, { text: "Idea ritirata" }))).requestId;
  await withdraw(phone, act, q.withdrawn);
  q.not_linked = (await submit(phone, act, proposalRequest(WHO.sara, { text: "Idea rifiutata" }))).requestId;
  await rejectRequest(admin, act, q.not_linked, "NOTA-INTERNA-UNO");
  q.pending = (await submit(phone, act, proposalRequest(WHO.paolo, { text: "Idea collegata" }))).requestId;
  await link(admin, act, q.pending, `user_${boyA.uid}`);
  q.approved = (await submit(phone, act, challengeRequest(WHO.elena, r1.record.id))).requestId;
  await link(admin, act, q.approved, `user_${boyB.uid}`);
  q.rejected = (await submit(phone, act, proposalRequest(WHO.marco, { text: "Idea non accettata" }))).requestId;
  await link(admin, act, q.rejected, `user_${boyC.uid}`);
  const rejectedEntry = await linkedEntryOf(act, q.rejected);
  await A(admin, act, "reject", { entryId: rejectedEntry.id, reason: "Troppo rumorosa, scegli altro." });
  q.removed = (await submit(phone, act, challengeRequest(WHO.giulia, r1.record.id))).requestId;
  await link(admin, act, q.removed, manualId);
  const removedEntry = await linkedEntryOf(act, q.removed);
  await A(admin, act, "withdrawEntry", { entryId: removedEntry.id });

  const response = await G(phone, act, "mine");
  const items = new Map(listOf(response, "mine").map((item) => [idOf(item), item]));
  assert.equal(items.size, 7);
  for (const [state, requestId] of Object.entries(q)) assert.equal(items.get(requestId)?.state, state, `stato di ${requestId}`);
  assert.ok(JSON.stringify(items.get(q.rejected)).includes("Troppo rumorosa, scegli altro."), "«Non accettata» mostra il motivo del tentativo");

  const entryIds = [];
  for (const requestId of [q.pending, q.approved, q.rejected, q.removed]) entryIds.push((await requestData(act, requestId)).linkedEntryId);
  assertNoLeak(response, [
    boyA.uid, boyB.uid, boyC.uid, boyF.uid, admin.uid, "Anna Prima", "Bruno Secondo", "Carlo Terzo", "Fiora Sesta",
    "Zeffirino", "Quartarolo", manualId, `user_${boyA.uid}`, `user_${boyB.uid}`, "NOTA-INTERNA-UNO", ...entryIds,
  ], "mine");
  // Il rifiuto della richiesta ha lo stesso aspetto qualunque sia la nota interna.
  assert.ok(!JSON.stringify(items.get(q.not_linked)).includes("NOTA-INTERNA"), "la nota interna non arriva al telefono");
  await assertMineMatchesData(phone, act);
  await assertConsistent(act);
});

test("G2 mine segue il tentativo nel tempo: pending, rejected, pending, approved, pending, approved, removed", async () => {
  const { boyA, admin, phone1 } = pool;
  const act = await newActivity({ members: [boyA] });
  const requestId = await seedRequest(act, phone1, { who: WHO.maria, text: "Idea in viaggio" });
  await link(admin, act, requestId, `user_${boyA.uid}`);
  const entryId = (await requestData(act, requestId)).linkedEntryId;
  const expectState = async (state) => {
    assert.equal(await stateOf(phone1, act, requestId), state);
    await assertMineMatchesData(phone1, act);
    await assertConsistent(act);
  };
  await expectState("pending");
  await A(admin, act, "reject", { entryId, reason: "Scegli una prova più semplice." });
  await expectState("rejected");
  assert.ok(JSON.stringify((await mineById(phone1, act)).get(requestId)).includes("Scegli una prova più semplice."));
  await A(admin, act, "reopen", { entryId });
  await expectState("pending");
  await A(admin, act, "approve", { entryId, ...recordInput("Prova in viaggio") });
  await expectState("approved");
  await A(admin, act, "reopen", { entryId });
  await expectState("pending");
  await A(admin, act, "approve", { entryId, ...recordInput("Prova in viaggio, di nuovo") });
  await expectState("approved");
  await A(admin, act, "withdrawEntry", { entryId });
  await expectState("removed");
});

test("G3 removed ha la stessa forma comunque sia uscita la persona (staff, titolare, iscrizione annullata, record nascosto)", async () => {
  const { boyA, boyB, boyC, boyD, boyF, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyC, boyD, boyF] });
  const r1 = await makeRecord(act, boyF, "Record per la rimozione");
  const phone = await newPhone();
  const byStaff = await seedRequest(act, phone, { who: WHO.maria, kind: "challenge", recordId: r1.record.id });
  const bySelf = await seedRequest(act, phone, { who: WHO.luca, kind: "challenge", recordId: r1.record.id });
  const bySystem = await seedRequest(act, phone, { who: WHO.sara, kind: "challenge", recordId: r1.record.id });
  const byHide = await seedRequest(act, phone, { who: WHO.paolo, kind: "challenge", recordId: r1.record.id });
  await link(admin, act, byStaff, `user_${boyA.uid}`);
  await link(admin, act, bySelf, `user_${boyB.uid}`);
  await link(admin, act, bySystem, `user_${boyC.uid}`);
  await link(admin, act, byHide, `user_${boyD.uid}`);

  await A(admin, act, "withdrawEntry", { entryId: (await requestData(act, byStaff)).linkedEntryId });
  await P(boyB, act, "withdraw", { entryId: (await requestData(act, bySelf)).linkedEntryId });
  await adminDb.doc(`${activityPath(act)}/registrations/user_${boyC.uid}`).update({ registrationStatus: "cancelled" });
  const systemEntryId = (await requestData(act, bySystem)).linkedEntryId;
  await waitFor(async () => (await entryData(act, systemEntryId)).status, (status) => status === "withdrawn", "il ritiro d'ufficio");
  await A(admin, act, "updateRecord", { recordId: r1.record.id, ...recordInput("Record per la rimozione"), status: "hidden" });

  const items = await mineById(phone, act);
  const shapes = new Map();
  for (const [label, requestId] of Object.entries({ byStaff, bySelf, bySystem, byHide })) {
    const item = items.get(requestId);
    assert.equal(item.state, "removed", label);
    assert.deepEqual(forbiddenPaths(item), [], `${label}: chiavi riservate`);
    shapes.set(label, sortedKeys(item).join(","));
  }
  assert.equal(new Set(shapes.values()).size, 1, `«removed» ha forme diverse a seconda di chi ha ritirato: ${JSON.stringify([...shapes])}`);
  const entries = await allDocs(entriesRef(act));
  const byRequest = Object.fromEntries(entries.filter((entry) => entry.sourceRequestId).map((entry) => [entry.sourceRequestId, entry]));
  assert.equal(byRequest[byStaff].withdrawnBy, "staff");
  assert.equal(byRequest[bySelf].withdrawnBy, "self");
  assert.equal(byRequest[bySystem].withdrawnBy, "system");
  assert.equal(byRequest[byHide].withdrawnBy, "staff");
  assert.equal(byRequest[byHide].withdrawnWithRecordHide, true);
  await assertMineMatchesData(phone, act);
  await assertConsistent(act);
});

test("G4 il telefono non ritira né ripristina un tentativo collegato: errore generico e identico in ogni stato, nulla cambia", async () => {
  const { boyA, boyB, boyC, boyD, boyF, admin } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyC, boyD, boyF] });
  const r1 = await makeRecord(act, boyF, "Record del divieto");
  const manualId = await enrollManual(act, "manual_zeffirino", "Zeffirino", "Quartarolo");
  const phone = await newPhone();
  const make = async (who, kind, registrationId) => {
    const requestId = await seedRequest(act, phone, { who, kind, recordId: kind === "challenge" ? r1.record.id : null });
    await link(admin, act, requestId, registrationId);
    return requestId;
  };
  const cases = {
    pending: await make(WHO.maria, "proposal", `user_${boyA.uid}`),
    approved: await make(WHO.luca, "challenge", `user_${boyB.uid}`),
    rejected: await make(WHO.sara, "proposal", `user_${boyC.uid}`),
    "removed dal titolare": await make(WHO.paolo, "challenge", `user_${boyD.uid}`),
    "removed dallo staff": await make(WHO.elena, "challenge", manualId),
  };
  await A(admin, act, "reject", { entryId: (await requestData(act, cases.rejected)).linkedEntryId, reason: "No." });
  await P(boyD, act, "withdraw", { entryId: (await requestData(act, cases["removed dal titolare"])).linkedEntryId });
  await A(admin, act, "withdrawEntry", { entryId: (await requestData(act, cases["removed dallo staff"])).linkedEntryId });

  const before = await snapshotWorld(act);
  const withdrawErrors = [];
  const restoreErrors = [];
  for (const [label, requestId] of Object.entries(cases)) {
    const w = await capture(withdraw(phone, act, requestId));
    const r = await capture(restore(phone, act, requestId));
    assert.equal(w.ok, false, `withdraw su «${label}» riuscito`);
    assert.equal(r.ok, false, `restore su «${label}» riuscito`);
    assert.ok(!CRASH_CODES.has(w.code) && !CRASH_CODES.has(r.code), `${label}: ${w.code} / ${r.code}`);
    withdrawErrors.push([label, w]);
    restoreErrors.push([label, r]);
  }
  for (const [label, outcome] of withdrawErrors) assert.deepEqual(outcome, withdrawErrors[0][1], `withdraw: l'errore su «${label}» rivela lo stato del tentativo`);
  for (const [label, outcome] of restoreErrors) assert.deepEqual(outcome, restoreErrors[0][1], `restore: l'errore su «${label}» rivela lo stato del tentativo`);
  const secrets = ["Anna", "Bruno", "Carlo", "Zeffirino", "user_", "manual_", "approvat", "in attesa", "challengerCount"];
  for (const [, outcome] of [...withdrawErrors, ...restoreErrors]) {
    for (const secret of secrets) assert.ok(!String(outcome.message).includes(secret), `l'errore dice «${secret}»: ${outcome.message}`);
  }
  assert.deepEqual(await snapshotWorld(act), before, "un ritiro o ripristino dal telefono ha cambiato dei dati");
  await assertConsistent(act);
});

// ---------------------------------------------------------------------------
// H. Interruttore, recordsEnabled, finestra chiusa, richiesta scaduta
// ---------------------------------------------------------------------------

async function requestStatuses(activityId) {
  return Object.fromEntries((await allDocs(requestsRef(activityId))).map((request) => [request.id, request.status]));
}
const setActivity = (activityId, patch) => adminDb.doc(activityPath(activityId)).update(patch);

test("H1 interruttore recordsGuestEnabled spento: blocca solo submit; mine, ritiro, ripristino, context e tutto lo staff continuano", async () => {
  const { boyA, boyB, boyF, admin, leader, phone1, phone2, signedOut } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyF] });
  const r1 = await makeRecord(act, boyF, "Record dell'interruttore");
  const toWithdraw = (await submit(phone1, act, proposalRequest(WHO.maria, { text: "Da ritirare" }))).requestId;
  const parked = (await submit(phone1, act, proposalRequest(WHO.luca, { text: "Ritirata prima" }))).requestId;
  await withdraw(phone1, act, parked);
  const toLink = await seedRequest(act, phone1, { who: WHO.sara });
  const toReject = await seedRequest(act, phone1, { who: WHO.paolo });
  const toReopen = await seedRequest(act, phone1, { who: WHO.elena, status: "rejected" });
  const toUnlink = await seedRequest(act, phone1, { who: WHO.marco, kind: "challenge", recordId: r1.record.id });
  await link(admin, act, toUnlink, `user_${boyB.uid}`);
  const bulk = [await seedRequest(act, phone1, { who: WHO.giulia }), await seedRequest(act, phone1, { who: WHO.tommaso })];

  await setActivity(act, { recordsGuestEnabled: false });
  const sizeBefore = (await requestsRef(act).get()).size;
  // Solo submit si ferma, con il messaggio neutro della spec.
  await expectFail(submit(phone2, act, proposalRequest(WHO.maria)), "any", CANNOT_RECEIVE_MSG);
  await expectFail(submit(phone2, act, challengeRequest(WHO.maria, r1.record.id)), "any", CANNOT_RECEIVE_MSG);
  assert.equal((await requestsRef(act).get()).size, sizeBefore, "con l'interruttore spento non nasce nulla");
  // Il resto del telefono.
  const ctx = await G(signedOut, act, "context");
  assert.equal(ctx.intakeOpen, false);
  // D1: i titoli diventano pubblici solo dopo l'anteprima dello staff e l'accensione dell'interruttore.
  assert.deepEqual(ctx.records, [], "con l'interruttore spento l'elenco senza login non mostra nessun titolo");
  const items = await mineById(phone1, act);
  assert.ok(items.size >= 7, "le richieste già inviate si vedono");
  assert.equal((await withdraw(phone1, act, toWithdraw)).ok, true);
  assert.equal((await restore(phone1, act, parked)).ok, true, "restore non è chiuso dall'interruttore");
  assert.equal((await restore(phone1, act, toWithdraw)).ok, true);
  // Tutto lo staff.
  assert.ok((await queueById(leader, act)).size >= 7);
  await link(admin, act, toLink, `user_${boyA.uid}`);
  await rejectRequest(admin, act, toReject, "Non collegabile.");
  await reopenRequest(leader, act, toReopen);
  await unlink(admin, act, toUnlink);
  assert.equal((await A(admin, act, "rejectRequests", { requestIds: bulk })).ok, true);
  const statuses = await requestStatuses(act);
  assert.equal(statuses[toLink], "linked");
  assert.equal(statuses[toReject], "rejected");
  assert.equal(statuses[toReopen], "open");
  assert.equal(statuses[toUnlink], "open");
  assert.deepEqual(bulk.map((id) => statuses[id]), ["rejected", "rejected"]);

  // Riacceso, si riceve di nuovo.
  await setActivity(act, { recordsGuestEnabled: true });
  assert.equal((await submit(phone2, act, proposalRequest(WHO.maria))).ok, true);
  await assertConsistent(act);
});

test("H1b interruttore assente = spento; precedenze: finestra chiusa batte interruttore spento, recordsEnabled falso batte tutto", async () => {
  const { phone1 } = pool;
  const absent = await newActivity({ guest: "absent" });
  await expectFail(submit(phone1, absent, proposalRequest(WHO.maria)), "any", CANNOT_RECEIVE_MSG);

  const closedAndOff = await newActivity({ guest: false, closeAt: inPast(1) });
  await expectFail(submit(phone1, closedAndOff, proposalRequest(WHO.maria)), "any", CLOSED_MSG);

  const disabledAndClosed = await newActivity({ enabled: false, guest: false, closeAt: inPast(1) });
  await expectFail(submit(phone1, disabledAndClosed, proposalRequest(WHO.maria)), "any", NOT_ACTIVE);
  for (const act of [absent, closedAndOff, disabledAndClosed]) assert.equal((await requestsRef(act).get()).size, 0);
});

test("H2 recordsEnabled falso spegne tutto, telefono e staff; riacceso si riprende", async () => {
  const { boyA, boyF, admin, leader, phone1 } = pool;
  const act = await newActivity({ members: [boyA, boyF] });
  const r1 = await makeRecord(act, boyF, "Record del modulo spento");
  const mineOpen = (await submit(phone1, act, proposalRequest(WHO.maria, { text: "Aperta" }))).requestId;
  const parked = (await submit(phone1, act, proposalRequest(WHO.luca, { text: "Ritirata" }))).requestId;
  await withdraw(phone1, act, parked);
  const rejected = await seedRequest(act, phone1, { who: WHO.sara, status: "rejected" });
  const linkedId = await seedRequest(act, phone1, { who: WHO.paolo, kind: "challenge", recordId: r1.record.id });
  await link(admin, act, linkedId, `user_${boyA.uid}`);
  const bulkTarget = await seedRequest(act, phone1, { who: WHO.elena });

  await setActivity(act, { recordsEnabled: false });
  const world = await snapshotWorld(act);
  const statuses = await requestStatuses(act);
  // Telefono: nessuna azione.
  await expectFail(submit(phone1, act, proposalRequest(WHO.marco)), "any", NOT_ACTIVE);
  await expectFail(G(phone1, act, "mine"), "any", NOT_ACTIVE);
  await expectFail(withdraw(phone1, act, mineOpen), "any", NOT_ACTIVE);
  await expectFail(restore(phone1, act, parked), "any", NOT_ACTIVE);
  // Staff: nessuna delle sei nuove azioni.
  const staffPayloads = {
    listRequests: {},
    linkRequest: { requestId: bulkTarget, registrationId: `user_${boyA.uid}`, verified: true },
    rejectRequest: { requestId: bulkTarget, note: "No." },
    rejectRequests: { requestIds: [bulkTarget] },
    reopenRequest: { requestId: rejected },
    unlinkRequest: { requestId: linkedId },
  };
  for (const staff of [admin, leader]) {
    for (const [action, payload] of Object.entries(staffPayloads)) {
      await expectFail(A(staff, act, action, payload), "any", NOT_ACTIVE).catch((error) => {
        throw new Error(`${staff.name} / ${action}: ${error.message}`);
      });
    }
  }
  assert.deepEqual(await requestStatuses(act), statuses);
  assert.deepEqual(await snapshotWorld(act), world, "a modulo spento non cambia nulla");

  await setActivity(act, { recordsEnabled: true });
  assert.equal((await rejectRequest(admin, act, bulkTarget, "Ora sì.")).ok, true);
  assert.equal((await mineItems(phone1, act)).length, 5);
});

test("H3 finestra chiusa: il telefono non invia, non ritira, non ripristina; lo staff collega, scollega, rifiuta e riapre", async () => {
  const { boyA, boyB, boyF, admin, leader, signedOut } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyF] });
  const r1 = await makeRecord(act, boyF, "Record della chiusura");
  const phone = await newPhone();
  const openMine = (await submit(phone, act, proposalRequest(WHO.maria, { text: "Aperta" }))).requestId;
  const parkedMine = (await submit(phone, act, proposalRequest(WHO.luca, { text: "Ritirata" }))).requestId;
  await withdraw(phone, act, parkedMine);
  const toLink = await seedRequest(act, phone, { who: WHO.sara });
  const toLinkChallenge = await seedRequest(act, phone, { who: WHO.paolo, kind: "challenge", recordId: r1.record.id });
  const toReject = await seedRequest(act, phone, { who: WHO.elena });
  const toReopen = await seedRequest(act, phone, { who: WHO.marco, status: "rejected" });
  const toUnlink = await seedRequest(act, phone, { who: WHO.giulia });
  await link(admin, act, toUnlink, `user_${boyA.uid}`);
  const bulk = [await seedRequest(act, phone, { who: WHO.tommaso }), await seedRequest(act, phone, { who: person("Irene", "Celeste") })];

  await setActivity(act, { recordsCloseAt: inPast(1) });
  const statuses = await requestStatuses(act);
  // Telefono: tutto in sola lettura.
  await expectFail(submit(phone, act, proposalRequest(person("Nadia", "Oro"))), "any", CLOSED_MSG);
  await expectFail(withdraw(phone, act, openMine), "any", CLOSED_MSG);
  await expectFail(restore(phone, act, parkedMine), "any", CLOSED_MSG);
  assert.deepEqual(await requestStatuses(act), statuses, "chiusa: nessun cambio dal telefono");
  const items = await mineById(phone, act);
  assert.equal(items.get(openMine).state, "received");
  assert.equal(items.get(parkedMine).state, "withdrawn");
  assert.equal(items.get(toUnlink).state, "pending");
  const ctx = await G(signedOut, act, "context");
  assert.equal(ctx.intakeOpen, false);
  assert.equal(ctx.open, false);
  assert.equal(ctx.records.length, 1, "l'elenco resta in sola lettura");

  // Staff: ancora tutto, anche la sera.
  assert.ok((await queueById(admin, act)).size >= 9);
  await link(leader, act, toLink, `user_${boyB.uid}`);
  assert.equal((await entryData(act, (await requestData(act, toLink)).linkedEntryId)).status, "pending");
  await link(admin, act, toLinkChallenge, `user_${boyB.uid}`);
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 2);
  await rejectRequest(admin, act, toReject, "Non è iscritto.");
  await reopenRequest(leader, act, toReopen);
  await reopenRequest(admin, act, parkedMine); // ritirata dal telefono: dopo la chiusura Riapri è l'unica strada
  await unlink(admin, act, toUnlink);
  await A(leader, act, "rejectRequests", { requestIds: bulk });
  const after = await requestStatuses(act);
  assert.equal(after[parkedMine], "open");
  assert.equal(after[toLink], "linked");
  assert.equal(after[toLinkChallenge], "linked");
  assert.equal(after[toReject], "rejected");
  assert.equal(after[toReopen], "open");
  assert.equal(after[toUnlink], "open");
  assert.deepEqual(bulk.map((id) => after[id]), ["rejected", "rejected"]);
  // La richiesta riaperta dallo staff dopo la chiusura resta «received» e non si ritira dal telefono.
  assert.equal(await stateOf(phone, act, toReopen), "received");
  await expectFail(withdraw(phone, act, toReopen), "any", CLOSED_MSG);
  await assertConsistent(act);
});

test("H4 richiesta con expiresAt passato: inesistente per il telefono e per lo staff, nulla cambia", async () => {
  const { boyA, boyF, admin, phone1 } = pool;
  const act = await newActivity({ members: [boyA, boyF] });
  const r1 = await makeRecord(act, boyF, "Record della scadenza");
  const expiredAt = { expiresAt: Timestamp.fromMillis(Date.now() - 60_000) };
  const live = await seedRequest(act, phone1, { who: WHO.maria });
  const expiredOpen = await seedRequest(act, phone1, { who: WHO.luca, extra: expiredAt });
  const expiredWithdrawn = await seedRequest(act, phone1, { who: WHO.sara, status: "withdrawn", extra: expiredAt });
  const expiredRejected = await seedRequest(act, phone1, { who: WHO.paolo, status: "rejected", extra: expiredAt });
  const expiredLinked = await seedRequest(act, phone1, { who: WHO.elena, kind: "challenge", recordId: r1.record.id });
  await link(admin, act, expiredLinked, `user_${boyA.uid}`);
  await requestsRef(act).doc(expiredLinked).update(expiredAt);
  const world = await snapshotWorld(act);
  const statuses = await requestStatuses(act);

  // Telefono.
  assert.deepEqual((await mineItems(phone1, act)).map(idOf), [live], "mine non elenca le scadute");
  await expectFail(withdraw(phone1, act, expiredOpen), "any", CANNOT_RECEIVE_MSG);
  await expectFail(restore(phone1, act, expiredWithdrawn), "any", CANNOT_RECEIVE_MSG);
  await expectFail(withdraw(phone1, act, expiredLinked), "any");
  // Staff.
  assert.deepEqual([...(await queueById(admin, act)).keys()], [live], "listRequests non elenca le scadute");
  const absent = ["not-found", "failed-precondition"];
  await expectFail(link(admin, act, expiredOpen, `user_${boyA.uid}`), absent);
  await expectFail(rejectRequest(admin, act, expiredOpen, "No."), absent);
  await expectFail(reopenRequest(admin, act, expiredRejected), absent);
  await expectFail(unlink(admin, act, expiredLinked), absent);
  // rejectRequests su una scaduta: saltata come inesistente, senza errore.
  const bulk = await A(admin, act, "rejectRequests", { requestIds: [expiredOpen, expiredLinked] });
  assert.equal(bulk.rejectedCount, 0);
  assert.equal(bulk.skippedCount, 2);
  assert.deepEqual(await requestStatuses(act), statuses);
  assert.deepEqual(await snapshotWorld(act), world);
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 2, "la scollegata scaduta non ha mosso il contatore");
});

// ---------------------------------------------------------------------------
// I. Chi è staff e chi no
// ---------------------------------------------------------------------------

test("I1 chi non è staff non chiama nessuna delle nuove azioni di recordNightAdmin (anche con payload validi)", async () => {
  const { boyA, boyF, parent, outsider, leaderOther, otherAdmin, picked, phone1, phone2, signedOut } = pool;
  const act = await newActivity({ members: [boyA, boyF] });
  await enrollUser(act, picked, { genderRoleCategory: "accompagnatore" }); // iscritto come accompagnatore, ma non in elenco
  await enrollChild(act, parent, "kid1", "Dario", "Rossi");
  const r1 = await makeRecord(act, boyF, "Record riservato");
  const openId = await seedRequest(act, phone1, { who: WHO.maria });
  const rejectedId = await seedRequest(act, phone1, { who: WHO.luca, status: "rejected" });
  const linkedId = await seedRequest(act, phone1, { who: WHO.sara, kind: "challenge", recordId: r1.record.id });
  await link(pool.admin, act, linkedId, `user_${boyA.uid}`);
  const payloads = {
    listRequests: {},
    linkRequest: { requestId: openId, registrationId: `user_${boyA.uid}`, verified: true },
    rejectRequest: { requestId: openId, note: "Hack" },
    rejectRequests: { requestIds: [openId] },
    reopenRequest: { requestId: rejectedId },
    unlinkRequest: { requestId: linkedId },
  };
  const world = await snapshotWorld(act);
  const statuses = await requestStatuses(act);
  const failures = [];
  for (const client of [boyA, boyF, parent, outsider, leaderOther, otherAdmin, picked]) {
    for (const [action, payload] of Object.entries(payloads)) {
      const outcome = await capture(A(client, act, action, payload));
      if (outcome.ok) failures.push(`${client.name} / ${action}: ACCETTATO`);
      else if (outcome.code !== "functions/permission-denied" || outcome.message !== NOT_STAFF_MSG) failures.push(`${client.name} / ${action}: ${outcome.code} «${outcome.message}»`);
    }
  }
  assert.deepEqual(failures, [], `Non staff non rifiutati con permission-denied + messaggio della spec:\n${failures.join("\n")}`);
  // Sessione anonima (anche quella che ha inviato) e non autenticato.
  for (const [action, payload] of Object.entries(payloads)) {
    await expectFail(A(phone1, act, action, payload), "permission-denied");
    await expectFail(A(phone2, act, action, payload), "permission-denied");
    await expectFail(A(signedOut, act, action, payload), "unauthenticated");
  }
  assert.deepEqual(await requestStatuses(act), statuses);
  assert.deepEqual(await snapshotWorld(act), world);
});

const STAFF_KINDS = [
  ["admin del palo", "admin", false],
  ["dirigente di unità dello stesso palo", "leader", false],
  ["iscritto messo in elenco da un admin", "picked", true],
];
for (const closed of [false, true]) {
  for (const [label, key, listed] of STAFF_KINDS) {
    test(`I2 staff (${label}) esegue tutte le nuove azioni${closed ? " anche dopo la chiusura" : ""}`, async () => {
      const staff = pool[key];
      const { boyA, boyB, boyF, phone1 } = pool;
      const act = await newActivity({ members: [boyA, boyB, boyF] });
      if (listed) await makePickedStaff(act, staff);
      const r1 = await makeRecord(act, boyF, "Record dello staff");
      const toLinkProposal = await seedRequest(act, phone1, { who: WHO.maria, text: "Torre di bicchieri" });
      const toLinkChallenge = await seedRequest(act, phone1, { who: WHO.luca, kind: "challenge", recordId: r1.record.id });
      const toReject = await seedRequest(act, phone1, { who: WHO.sara });
      const toReopen = await seedRequest(act, phone1, { who: WHO.paolo, status: "rejected" });
      const bulk = [await seedRequest(act, phone1, { who: WHO.elena }), await seedRequest(act, phone1, { who: WHO.marco })];
      if (closed) await setActivity(act, { recordsCloseAt: inPast(1) });

      const queue = await queueById(staff, act);
      for (const id of [toLinkProposal, toLinkChallenge, toReject, toReopen, ...bulk]) assert.ok(queue.has(id), `${staff.name}: listRequests non elenca ${id}`);
      await link(staff, act, toLinkProposal, `user_${boyA.uid}`);
      assert.equal((await requestData(act, toLinkProposal)).linkedBy, staff.uid);
      await link(staff, act, toLinkChallenge, `user_${boyB.uid}`);
      assert.equal((await recordData(act, r1.record.id)).challengerCount, 2);
      const rejected = await rejectRequest(staff, act, toReject, "Non collegabile.");
      assert.equal(rejected.ok, true);
      assert.equal((await requestData(act, toReject)).decidedBy, staff.uid);
      await reopenRequest(staff, act, toReopen);
      assert.equal((await requestData(act, toReopen)).status, "open");
      await unlink(staff, act, toLinkProposal);
      assert.equal((await requestData(act, toLinkProposal)).status, "open");
      await A(staff, act, "rejectRequests", { requestIds: bulk, note: "Doppioni." });
      const statuses = await requestStatuses(act);
      assert.deepEqual(bulk.map((id) => statuses[id]), ["rejected", "rejected"]);
      await assertConsistent(act);
    });
  }
}

// ---------------------------------------------------------------------------
// J. linkRequest: casi negativi
// ---------------------------------------------------------------------------

async function expectUnlinked(activityId, requestId, phone) {
  assert.equal((await requestData(activityId, requestId)).status, "open", "la richiesta doveva restare aperta");
  assert.equal((await entriesFromRequest(activityId, requestId)).length, 0, "nessun tentativo doveva nascere");
  if (phone) assert.equal(await stateOf(phone, activityId, requestId), "received");
}

test("J1 linkRequest senza verified:true rifiutato (assente, false, stringa, numero, null)", async () => {
  const { boyA, admin, phone1 } = pool;
  const act = await newActivity({ members: [boyA] });
  const requestId = await seedRequest(act, phone1, { who: WHO.maria });
  const base = { requestId, registrationId: `user_${boyA.uid}` };
  const variants = [
    ["verified assente", base],
    ["verified false", { ...base, verified: false }],
    ["verified stringa «true»", { ...base, verified: "true" }],
    ["verified numero 1", { ...base, verified: 1 }],
    ["verified null", { ...base, verified: null }],
  ];
  for (const [label, payload] of variants) {
    await expectFail(A(admin, act, "linkRequest", payload), ["invalid-argument", "failed-precondition"]).catch((error) => {
      throw new Error(`${label}: ${error.message}`);
    });
    await expectUnlinked(act, requestId, phone1);
  }
  assert.equal((await entriesRef(act).get()).size, 0);
  // Con la spunta il collegamento riesce.
  assert.equal((await link(admin, act, requestId, base.registrationId)).ok, true);
});

test("J2 linkRequest: iscrizione annullata, respinta, assente, guest_, prefisso sconosciuto o id malformato rifiutati", async () => {
  const { boyA, boyD, boyE, parent, outsider, admin, phone1 } = pool;
  const act = await newActivity({ members: [boyA] });
  const targets = {
    "user_ annullata": await enrollUser(act, boyD, { registrationStatus: "cancelled" }),
    "user_ respinta dal genitore": await enrollUser(act, boyE, { registrationStatus: "rejected_by_parent" }),
    "manual_ annullata": await enrollManual(act, "manual_annullata", "Leo", "Vecchio", { registrationStatus: "cancelled" }),
    "manual_ con il campo legacy status cancelled": await enrollManual(act, "manual_legacy", "Gigi", "Antico", { status: "cancelled" }),
    "account senza iscrizione": `user_${outsider.uid}`,
    "manual_ inesistente": "manual_non_esiste",
    "child_ inesistente": `child_${parent.uid}_nonesiste`,
    "guest_ (escluso)": await enrollRaw(act, "guest_gianni", "Gianni", "Ospite"),
    "prefisso sconosciuto": await enrollRaw(act, "ospite_xyz", "Zed", "Ignoto"),
    "id malformato": "../altra",
    "id vuoto": "",
  };
  const requestId = await seedRequest(act, phone1, { who: WHO.maria });
  const challengeRecord = await makeRecord(act, boyA, "Record per le sfide negative");
  const challengeId = await seedRequest(act, phone1, { who: WHO.luca, kind: "challenge", recordId: challengeRecord.record.id });
  for (const [label, registrationId] of Object.entries(targets)) {
    for (const id of [requestId, challengeId]) {
      await expectFail(link(admin, act, id, registrationId), "any").catch((error) => {
        throw new Error(`${label}: ${error.message}`);
      });
    }
    await expectUnlinked(act, requestId, phone1);
    await expectUnlinked(act, challengeId, phone1);
  }
  assert.equal((await recordData(act, challengeRecord.record.id)).challengerCount, 1);
  // Lo stato al telefono non dice perché: resta «received» in ogni caso, e il rifiuto è neutro.
  await rejectRequest(admin, act, requestId, "Non collegabile.");
  assert.equal(await stateOf(phone1, act, requestId), "not_linked");
  await assertConsistent(act);
});

test("J3 linkRequest rispetta limite di 2, unicità, proposta identica, record nascosto o inesistente; richiesta non aperta", async () => {
  const { boyA, boyB, boyC, boyD, boyF, admin, phone1 } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyC, boyD, boyF] });
  const r1 = await makeRecord(act, boyF, "Record uno");
  const r2 = await makeRecord(act, boyF, "Record due");
  const r3 = await makeRecord(act, boyD, "Record tre");
  const r4 = await makeRecord(act, boyD, "Record nascosto");
  await A(admin, act, "updateRecord", { recordId: r4.record.id, ...recordInput("Record nascosto"), status: "hidden" });
  const count = async (record) => (await recordData(act, record.record.id)).challengerCount;

  // Limite di 2: Anna ha già due tentativi attivi.
  await P(boyA, act, "challenge", { recordId: r1.record.id });
  await P(boyA, act, "challenge", { recordId: r2.record.id });
  const overLimitChallenge = await seedRequest(act, phone1, { who: WHO.maria, kind: "challenge", recordId: r3.record.id });
  const overLimitProposal = await seedRequest(act, phone1, { who: WHO.luca, text: "Una proposta in più" });
  await expectFail(link(admin, act, overLimitChallenge, `user_${boyA.uid}`), "failed-precondition", LIMIT_RE);
  await expectFail(link(admin, act, overLimitProposal, `user_${boyA.uid}`), "failed-precondition", LIMIT_RE);
  assert.equal(await count(r3), 1, "il collegamento rifiutato non muove il contatore");
  await expectUnlinked(act, overLimitChallenge);
  await expectUnlinked(act, overLimitProposal);

  // Unicità: Bruno è già sul record.
  await P(boyB, act, "challenge", { recordId: r1.record.id });
  const duplicateChallenge = await seedRequest(act, phone1, { who: WHO.sara, kind: "challenge", recordId: r1.record.id });
  await expectFail(link(admin, act, duplicateChallenge, `user_${boyB.uid}`), "failed-precondition", ALREADY_RE);
  assert.equal(await count(r1), 3);
  await expectUnlinked(act, duplicateChallenge);

  // Proposta identica a una già attiva della stessa iscrizione.
  await P(boyC, act, "propose", proposal("Salti con la corda", { durationSeconds: 30 }));
  const duplicateProposal = await seedRequest(act, phone1, { who: WHO.paolo, text: "Salti con la corda" });
  await expectFail(link(admin, act, duplicateProposal, `user_${boyC.uid}`), "failed-precondition", DUPLICATE_MSG);
  await expectUnlinked(act, duplicateProposal);

  // Record nascosto o inesistente.
  const hiddenChallenge = await seedRequest(act, phone1, { who: WHO.elena, kind: "challenge", recordId: r4.record.id });
  const missingChallenge = await seedRequest(act, phone1, { who: WHO.marco, kind: "challenge", recordId: "record-che-non-esiste" });
  await expectFail(link(admin, act, hiddenChallenge, `user_${boyC.uid}`), "any");
  await expectFail(link(admin, act, missingChallenge, `user_${boyC.uid}`), "any");
  await expectUnlinked(act, hiddenChallenge);
  await expectUnlinked(act, missingChallenge);
  assert.equal(await count(r4), 0);

  // Richiesta non aperta: già collegata, rifiutata, ritirata. Nulla cambia.
  const linkedOnce = await seedRequest(act, phone1, { who: WHO.giulia, kind: "challenge", recordId: r3.record.id });
  await link(admin, act, linkedOnce, `user_${boyB.uid}`);
  assert.equal(await count(r3), 2);
  const rejectedOne = await seedRequest(act, phone1, { who: WHO.tommaso, status: "rejected" });
  const withdrawnOne = await seedRequest(act, phone1, { who: person("Irene", "Celeste"), status: "withdrawn" });
  for (const id of [linkedOnce, rejectedOne, withdrawnOne]) {
    await expectFail(link(admin, act, id, `user_${boyC.uid}`), ["failed-precondition", "not-found"]);
  }
  assert.equal((await requestData(act, linkedOnce)).linkedRegistrationId, `user_${boyB.uid}`, "un secondo collegamento non sposta il legame");
  assert.equal((await entriesFromRequest(act, linkedOnce)).length, 1);
  assert.equal((await requestData(act, rejectedOne)).status, "rejected");
  assert.equal((await requestData(act, withdrawnOne)).status, "withdrawn");
  // Id richiesta inesistente.
  await expectFail(link(admin, act, "richiesta-che-non-esiste", `user_${boyC.uid}`), ["not-found", "failed-precondition"]);

  // Liberato un posto, il collegamento riesce (la richiesta non era "bruciata").
  const firstOfAnna = (await allDocs(entriesRef(act))).find((entry) => entry.registrationId === `user_${boyA.uid}` && entry.status === "approved");
  await P(boyA, act, "withdraw", { entryId: firstOfAnna.id });
  await link(admin, act, overLimitChallenge, `user_${boyA.uid}`);
  assert.equal(await count(r3), 3);
  assert.equal((await requestData(act, overLimitChallenge)).status, "linked");
  await assertConsistent(act);
});

test("J4 due collegamenti insieme della stessa richiesta: ne riesce uno solo", async () => {
  const { boyA, boyB, boyF, admin, leader, phone1 } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyF] });
  const r1 = await makeRecord(act, boyF, "Record della gara");
  const requestId = await seedRequest(act, phone1, { who: WHO.maria, kind: "challenge", recordId: r1.record.id });
  const settled = await Promise.allSettled([
    link(admin, act, requestId, `user_${boyA.uid}`),
    link(leader, act, requestId, `user_${boyB.uid}`),
  ]);
  assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1, JSON.stringify(settled.map((item) => (item.status === "fulfilled" ? "ok" : item.reason?.code))));
  assert.equal((await entriesFromRequest(act, requestId)).length, 1, "un solo tentativo per richiesta");
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 2);
  await assertConsistent(act);
});

// ---------------------------------------------------------------------------
// K. unlinkRequest da ogni stato del tentativo
// ---------------------------------------------------------------------------
// Spec: da QUALUNQUE stato (pending, approved, rejected, withdrawn) il tentativo va a
// withdrawn con withdrawnBy staff, statusBeforeWithdraw null e withdrawnWithRecordHide
// false (nessun «Annulla» o «Mostra di nuovo» lo rimette); contatore -1 solo se era
// approved, una volta sola; la richiesta torna open con il legame cancellato.

const UNLINK_CASES = [
  { label: "in attesa (proposta)", kind: "proposal", prepare: async () => {} },
  { label: "approvato (sfida)", kind: "challenge", prepare: async () => {} },
  {
    label: "rifiutato",
    kind: "proposal",
    prepare: (c) => A(c.admin, c.act, "reject", { entryId: c.entryId, reason: "Troppo rumorosa." }),
    expectBefore: { status: "rejected" },
  },
  {
    label: "ritirato dal titolare, era in attesa (statusBeforeWithdraw valorizzato)",
    kind: "proposal",
    prepare: (c) => P(c.owner, c.act, "withdraw", { entryId: c.entryId }),
    expectBefore: { status: "withdrawn", statusBeforeWithdraw: "pending", withdrawnBy: "self" },
  },
  {
    label: "ritirato dal titolare, era approvato (statusBeforeWithdraw valorizzato)",
    kind: "challenge",
    prepare: (c) => P(c.owner, c.act, "withdraw", { entryId: c.entryId }),
    expectBefore: { status: "withdrawn", statusBeforeWithdraw: "approved", withdrawnBy: "self" },
  },
  {
    label: "ritirato con il record nascosto (withdrawnWithRecordHide)",
    kind: "challenge",
    hide: true,
    prepare: (c) => A(c.admin, c.act, "updateRecord", { recordId: c.r1.record.id, ...recordInput("Record dello scollegamento"), status: "hidden" }),
    expectBefore: { status: "withdrawn", withdrawnBy: "staff", withdrawnWithRecordHide: true },
  },
  {
    label: "ritirato dallo staff",
    kind: "challenge",
    prepare: (c) => A(c.admin, c.act, "withdrawEntry", { entryId: c.entryId }),
    expectBefore: { status: "withdrawn", withdrawnBy: "staff" },
  },
  {
    label: "ritirato d'ufficio (iscrizione annullata)",
    kind: "challenge",
    cancelled: true,
    prepare: async (c) => {
      await adminDb.doc(`${activityPath(c.act)}/registrations/${c.registrationId}`).update({ registrationStatus: "cancelled" });
      await waitFor(async () => (await entryData(c.act, c.entryId)).status, (status) => status === "withdrawn", "il ritiro d'ufficio");
    },
    expectBefore: { status: "withdrawn", withdrawnBy: "system" },
  },
  {
    label: "proposta approvata e unita a un record esistente",
    kind: "proposal",
    prepare: (c) => A(c.admin, c.act, "merge", { entryId: c.entryId, recordId: c.r1.record.id }),
    expectBefore: { status: "approved" },
  },
];

for (const spec of UNLINK_CASES) {
  test(`K1 unlinkRequest da tentativo «${spec.label}»`, async () => {
    const { boyA, boyF, admin, phone1 } = pool;
    const act = await newActivity({ members: [boyA, boyF] });
    const r1 = await makeRecord(act, boyF, "Record dello scollegamento");
    const registrationId = `user_${boyA.uid}`;
    const requestId = await seedRequest(act, phone1, {
      who: WHO.maria, kind: spec.kind, recordId: spec.kind === "challenge" ? r1.record.id : null, text: "Torre di bicchieri",
    });
    await link(admin, act, requestId, registrationId);
    const entryId = (await requestData(act, requestId)).linkedEntryId;
    await spec.prepare({ act, admin, owner: boyA, r1, requestId, entryId, registrationId });

    const entryBefore = await entryData(act, entryId);
    for (const [field, value] of Object.entries(spec.expectBefore ?? {})) assert.equal(entryBefore[field] ?? null, value, `prima dello scollegamento: ${field}`);
    const counter = async () => (await recordData(act, r1.record.id)).challengerCount;
    const countBefore = await counter();
    const wasApproved = entryBefore.status === "approved";

    assert.equal((await unlink(admin, act, requestId)).ok, true);

    // Tentativo: withdrawn / staff, nessun Annulla, nessun Mostra di nuovo.
    const entry = await entryData(act, entryId);
    assert.equal(entry.status, "withdrawn");
    assert.equal(entry.withdrawnBy, "staff");
    assert.equal(entry.statusBeforeWithdraw ?? null, null, "nessun «Annulla» dopo lo scollegamento");
    assert.ok(!entry.withdrawnWithRecordHide, "withdrawnWithRecordHide deve essere spento");
    // Contatore: -1 solo se era approved, una volta sola.
    assert.equal(await counter(), countBefore - (wasApproved ? 1 : 0), "contatore dopo lo scollegamento");
    // Richiesta: di nuovo aperta, legame cancellato, decisione registrata.
    const request = await requestData(act, requestId);
    assert.equal(request.status, "open");
    for (const field of LINK_FIELDS) assert.ok(!request[field], `${field} doveva essere cancellato`);
    assert.equal(request.decidedBy, admin.uid);
    assert.ok(request.decidedAt, "decidedAt valorizzato");
    assert.equal(await stateOf(phone1, act, requestId), "received");
    // Il titolare non può più ripristinare.
    await expectFail(P(boyA, act, "restore", { entryId }), ["failed-precondition", "permission-denied"]);
    assert.equal((await entryData(act, entryId)).status, "withdrawn");
    // Una seconda volta: errore oppure nessun effetto; il contatore non scende ancora.
    await capture(unlink(admin, act, requestId));
    assert.equal(await counter(), countBefore - (wasApproved ? 1 : 0), "scollegare due volte non deve scalare due volte");
    assert.equal((await requestData(act, requestId)).status, "open");
    await assertConsistent(act);

    // Il telefono torna padrone della sua richiesta: Ritira e Annulla.
    assert.equal((await withdraw(phone1, act, requestId)).ok, true);
    assert.equal((await requestData(act, requestId)).status, "withdrawn");
    assert.equal((await restore(phone1, act, requestId)).ok, true);
    assert.equal((await requestData(act, requestId)).status, "open");

    // «Mostra di nuovo» il record nascosto non rimette il tentativo scollegato.
    if (spec.hide) {
      const shown = await A(admin, act, "updateRecord", { recordId: r1.record.id, ...recordInput("Record dello scollegamento"), status: "open" });
      assert.equal(shown.restoredCount, 1, "rientra solo il tentativo del ragazzo che ha creato il record");
      assert.equal((await entryData(act, entryId)).status, "withdrawn", "il tentativo scollegato non rientra con il record");
      assert.equal(await counter(), 1);
    }
    // Scollega, poi Collega di nuovo: un tentativo nuovo, il vecchio resta ritirato.
    if (!spec.cancelled) {
      await link(admin, act, requestId, registrationId);
      const relinked = await requestData(act, requestId);
      assert.equal(relinked.status, "linked");
      assert.notEqual(relinked.linkedEntryId, entryId, "il collegamento successivo crea un tentativo nuovo");
      assert.equal((await entryData(act, entryId)).status, "withdrawn");
      assert.equal((await entriesFromRequest(act, requestId)).length, 2);
    }
    await assertConsistent(act);
  });
}

test("K2 unlinkRequest su una proposta approvata che ha creato un record: l'errore indica «Riporta in attesa»; dopo, lo scollegamento riesce", async () => {
  const { boyA, admin, phone1 } = pool;
  const act = await newActivity({ members: [boyA] });
  const requestId = await seedRequest(act, phone1, { who: WHO.maria, text: "Torre di bicchieri" });
  await link(admin, act, requestId, `user_${boyA.uid}`);
  const entryId = (await requestData(act, requestId)).linkedEntryId;
  const approved = await A(admin, act, "approve", { entryId, ...recordInput("Torre di bicchieri in 60 secondi") });
  const recordId = approved.record.id;
  assert.equal((await recordData(act, recordId)).createdFromEntryId, entryId);
  const world = await snapshotWorld(act);

  await expectFail(unlink(admin, act, requestId), "failed-precondition", /Riporta in attesa/iu);
  assert.deepEqual(await snapshotWorld(act), world, "lo scollegamento rifiutato non cambia nulla");
  assert.equal((await requestData(act, requestId)).status, "linked");
  assert.equal((await recordData(act, recordId)).challengerCount, 1);
  assert.equal(await stateOf(phone1, act, requestId), "approved");

  // «Riporta in attesa» (azione esistente): il record, rimasto vuoto, si nasconde.
  await A(admin, act, "reopen", { entryId });
  assert.equal((await entryData(act, entryId)).status, "pending");
  assert.equal((await recordData(act, recordId)).status, "hidden");
  assert.equal((await unlink(admin, act, requestId)).ok, true);
  const entry = await entryData(act, entryId);
  assert.equal(entry.status, "withdrawn");
  assert.equal(entry.withdrawnBy, "staff");
  assert.equal((await recordData(act, recordId)).challengerCount, 0, "il contatore non scende sotto zero né due volte");
  assert.equal((await requestData(act, requestId)).status, "open");
  await assertConsistent(act);
});

test("K3 gare: due scollegamenti insieme scalano il contatore una volta sola", async () => {
  const { boyA, boyF, admin, leader, phone1 } = pool;
  const act = await newActivity({ members: [boyA, boyF] });
  const r1 = await makeRecord(act, boyF, "Record della gara di scollegamento");
  const requestId = await seedRequest(act, phone1, { who: WHO.maria, kind: "challenge", recordId: r1.record.id });
  await link(admin, act, requestId, `user_${boyA.uid}`);
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 2);
  const settled = await Promise.allSettled([unlink(admin, act, requestId), unlink(leader, act, requestId), unlink(admin, act, requestId)]);
  assert.ok(settled.some((item) => item.status === "fulfilled"), JSON.stringify(settled.map((item) => item.status === "fulfilled" ? "ok" : item.reason?.code)));
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 1, "contatore sceso una volta sola");
  assert.equal((await requestData(act, requestId)).status, "open");
  await assertConsistent(act);
});

test("K4 unlinkRequest su richieste mai collegate: nessun effetto", async () => {
  const { boyA, boyF, admin, phone1 } = pool;
  const act = await newActivity({ members: [boyA, boyF] });
  const r1 = await makeRecord(act, boyF, "Record della prova");
  const ids = {
    open: await seedRequest(act, phone1, { who: WHO.maria }),
    rejected: await seedRequest(act, phone1, { who: WHO.luca, status: "rejected" }),
    withdrawn: await seedRequest(act, phone1, { who: WHO.sara, status: "withdrawn" }),
  };
  const world = await snapshotWorld(act);
  const statuses = await requestStatuses(act);
  for (const id of Object.values(ids)) await capture(unlink(admin, act, id));
  assert.deepEqual(await requestStatuses(act), statuses, "nessuna richiesta cambia stato");
  assert.deepEqual(await snapshotWorld(act), world);
  await expectFail(unlink(admin, act, "richiesta-che-non-esiste"), ["not-found", "failed-precondition"]);
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 1);
});

// ---------------------------------------------------------------------------
// L. rejectRequest / rejectRequests / reopenRequest
// ---------------------------------------------------------------------------

test("L1 rejectRequest: open -> rejected; la nota interna non arriva mai al telefono; stesso aspetto per ogni via; il resto non si rifiuta", async () => {
  const { boyA, admin, leader, phone1 } = pool;
  const act = await newActivity({ members: [boyA] });
  const withNote = await seedRequest(act, phone1, { who: WHO.maria });
  const withoutNote = await seedRequest(act, phone1, { who: WHO.luca });
  const viaBulk = await seedRequest(act, phone1, { who: WHO.sara });

  assert.equal((await rejectRequest(admin, act, withNote, "NOTA-INTERNA-TRE")).ok, true);
  const stored = await requestData(act, withNote);
  assert.equal(stored.status, "rejected");
  assert.equal(stored.staffNote, "NOTA-INTERNA-TRE");
  assert.equal(stored.decidedBy, admin.uid);
  assert.ok(stored.decidedAt, "decidedAt valorizzato");
  await rejectRequest(leader, act, withoutNote);
  assert.equal((await requestData(act, withoutNote)).status, "rejected");
  assert.equal((await requestData(act, withoutNote)).staffNote ?? "", "");
  await A(admin, act, "rejectRequests", { requestIds: [viaBulk], note: "NOTA-INTERNA-BULK" });
  assert.equal((await requestData(act, viaBulk)).staffNote, "NOTA-INTERNA-BULK");

  // Il telefono vede lo stesso «non collegata» qualunque sia la via o la nota.
  const response = await G(phone1, act, "mine");
  const items = new Map(listOf(response, "mine").map((item) => [idOf(item), item]));
  const shapes = [withNote, withoutNote, viaBulk].map((id) => {
    assert.equal(items.get(id).state, "not_linked");
    return sortedKeys(items.get(id)).join(",");
  });
  assert.equal(new Set(shapes).size, 1, `«non collegata» ha forme diverse: ${shapes.join(" | ")}`);
  assertNoLeak(response, ["NOTA-INTERNA-TRE", "NOTA-INTERNA-BULK", admin.uid, leader.uid, "NOTA-INTERNA"], "mine");

  // Ripetuto su una già rifiutata (anche da un altro membro dello staff): niente da fare, niente cambia.
  const repeated = await rejectRequest(leader, act, withNote, "ALTRA-NOTA");
  assert.equal(repeated.ok, true, "rejectRequest su una già rifiutata è idempotente");
  const unchanged = await requestData(act, withNote);
  assert.equal(unchanged.status, "rejected");
  assert.equal(unchanged.staffNote, "NOTA-INTERNA-TRE", "la seconda nota non riscrive la prima");
  assert.equal(unchanged.decidedBy, admin.uid, "la decisione resta di chi ha rifiutato per primo");

  // Nota: fino a 200 caratteri.
  const longNote = await seedRequest(act, phone1, { who: WHO.paolo });
  await expectFail(rejectRequest(admin, act, longNote, "n".repeat(201)), "invalid-argument");
  assert.equal((await requestData(act, longNote)).status, "open");
  assert.equal((await rejectRequest(admin, act, longNote, "n".repeat(200))).ok, true);

  // Solo richieste open: una collegata o ritirata non si rifiuta (errore o nessun effetto).
  const linkedId = await seedRequest(act, phone1, { who: WHO.elena });
  await link(admin, act, linkedId, `user_${boyA.uid}`);
  const withdrawnId = await seedRequest(act, phone1, { who: WHO.marco, status: "withdrawn" });
  for (const id of [linkedId, withdrawnId]) await capture(rejectRequest(admin, act, id, "No."));
  assert.equal((await requestData(act, linkedId)).status, "linked");
  assert.equal((await requestData(act, withdrawnId)).status, "withdrawn");
  assert.equal((await entryData(act, (await requestData(act, linkedId)).linkedEntryId)).status, "pending");
  await expectFail(rejectRequest(admin, act, "richiesta-che-non-esiste", "No."), ["not-found", "failed-precondition"]);
  await assertConsistent(act);
});

test("L2 rejectRequests: 50 aperte in blocco con rejectedCount e skippedCount; 51, vuoto o malformato rifiutati; le non aperte si saltano", async () => {
  const { boyA, admin, phone1 } = pool;
  const act = await newActivity({ members: [boyA] });
  const fifty = await Promise.all(Array.from({ length: 50 }, (_, index) => seedRequest(act, phone1, { who: WHO.maria, text: `Coda ${index}` })));
  const statuses = async () => Object.values(await requestStatuses(act));

  await expectFail(A(admin, act, "rejectRequests", { requestIds: [...fifty, "uno-in-più"] }), "invalid-argument");
  await expectFail(A(admin, act, "rejectRequests", { requestIds: [] }), "invalid-argument");
  await expectFail(A(admin, act, "rejectRequests", {}), "invalid-argument");
  await expectFail(A(admin, act, "rejectRequests", { requestIds: "non-un-elenco" }), "invalid-argument");
  await expectFail(A(admin, act, "rejectRequests", { requestIds: [123] }), "invalid-argument");
  assert.ok((await statuses()).every((status) => status === "open"), "le richieste rifiutate per payload non cambiano");

  // Il blocco rifiuta le richieste ancora `open` e salta le altre (collegata, inesistente): risposta con i conteggi.
  const extraOpen = await seedRequest(act, phone1, { who: WHO.luca });
  const linkedId = await seedRequest(act, phone1, { who: WHO.sara });
  await link(admin, act, linkedId, `user_${boyA.uid}`);
  const mixed = await A(admin, act, "rejectRequests", { requestIds: [fifty[0], linkedId, "richiesta-che-non-esiste", extraOpen] });
  assert.equal(mixed.ok, true);
  assert.equal(mixed.rejectedCount, 2);
  assert.equal(mixed.skippedCount, 2);
  assert.deepEqual(listOf(mixed, "rejectRequests").map(idOf).sort(), [fifty[0], extraOpen].sort(), "requests = le sole rifiutate");
  const afterMixed = await requestStatuses(act);
  assert.equal(afterMixed[linkedId], "linked", "una collegata si salta, non si rifiuta");
  assert.equal(afterMixed[fifty[0]], "rejected");
  assert.equal(afterMixed[extraOpen], "rejected");
  assert.equal((await entriesFromRequest(act, linkedId)).length, 1);

  // Esattamente 50 aperte: tutte rifiutate, con la nota interna.
  const topUp = await seedRequest(act, phone1, { who: WHO.paolo });
  const open = (await allDocs(requestsRef(act))).filter((request) => request.status === "open").map((request) => request.id);
  assert.equal(open.length, 50, `aperte prima del blocco da 50: ${open.length}`);
  assert.ok(open.includes(topUp));
  const res = await A(admin, act, "rejectRequests", { requestIds: open, note: "Doppioni." });
  assert.equal(res.ok, true);
  assert.equal(res.rejectedCount, 50);
  assert.equal(res.skippedCount, 0);
  const after = await allDocs(requestsRef(act));
  for (const id of open) {
    const request = after.find((item) => item.id === id);
    assert.equal(request.status, "rejected", id);
    assert.equal(request.staffNote, "Doppioni.");
    assert.equal(request.decidedBy, admin.uid);
  }
  // Ripetuto sulle stesse (già rifiutate) e su una sola collegata: tutte saltate, nessun errore, nessun cambio.
  const repeat = await A(admin, act, "rejectRequests", { requestIds: open.slice(0, 5), note: "Seconda volta." });
  assert.equal(repeat.rejectedCount, 0);
  assert.equal(repeat.skippedCount, 5);
  assert.equal((await requestData(act, open[0])).staffNote, "Doppioni.", "il blocco ripetuto non riscrive la nota");
  const onlyLinked = await A(admin, act, "rejectRequests", { requestIds: [linkedId] });
  assert.equal(onlyLinked.rejectedCount, 0);
  assert.equal(onlyLinked.skippedCount, 1);
  assert.equal((await requestData(act, linkedId)).status, "linked");
  // Doppioni nell'elenco: una richiesta sola.
  const dup = await seedRequest(act, phone1, { who: WHO.elena });
  assert.equal((await A(admin, act, "rejectRequests", { requestIds: [dup, dup] })).ok, true);
  assert.equal((await requestData(act, dup)).status, "rejected");
  await assertConsistent(act);
});

test("L3 reopenRequest: rejected e withdrawn -> open, il telefono torna a «received» identico a prima; ciò che è aperto o collegato non cambia", async () => {
  const { boyA, admin, leader } = pool;
  const phone = await newPhone();
  const act = await newActivity({ members: [boyA] });
  const created = await submit(phone, act, proposalRequest(WHO.maria));
  const before = (await mineById(phone, act)).get(created.requestId);
  assert.equal(before.state, "received");

  // Rifiutata per errore, poi riaperta.
  await rejectRequest(admin, act, created.requestId, "Per errore.");
  assert.equal(await stateOf(phone, act, created.requestId), "not_linked");
  assert.equal((await reopenRequest(leader, act, created.requestId)).ok, true);
  const request = await requestData(act, created.requestId);
  assert.equal(request.status, "open");
  assert.equal(request.decidedBy, leader.uid);
  const after = (await mineById(phone, act)).get(created.requestId);
  assert.deepEqual(stripVolatile(after), stripVolatile(before), "dopo Riapri il telefono non vede nulla di diverso");

  // Ritirata dal telefono, poi riaperta dallo staff (spec: rejected o withdrawn -> open).
  assert.equal((await withdraw(phone, act, created.requestId)).ok, true);
  assert.equal(await stateOf(phone, act, created.requestId), "withdrawn");
  assert.equal((await reopenRequest(admin, act, created.requestId)).ok, true);
  const reopened = await requestData(act, created.requestId);
  assert.equal(reopened.status, "open");
  assert.equal(reopened.decidedBy, admin.uid);
  const afterWithdraw = (await mineById(phone, act)).get(created.requestId);
  assert.equal(afterWithdraw.state, "received");
  assert.deepEqual(stripVolatile(afterWithdraw), stripVolatile(before), "una richiesta ritirata e riaperta torna com'era");
  // Il telefono può ritirare di nuovo (la finestra è aperta).
  assert.equal((await withdraw(phone, act, created.requestId)).ok, true);

  // Già aperta o collegata: non cambia (errore o nessun effetto).
  const openId = await seedRequest(act, phone, { who: WHO.luca });
  const linkedId = await seedRequest(act, phone, { who: WHO.paolo });
  await link(admin, act, linkedId, `user_${boyA.uid}`);
  for (const id of [openId, linkedId]) await capture(reopenRequest(admin, act, id));
  const statuses = await requestStatuses(act);
  assert.equal(statuses[openId], "open");
  assert.equal(statuses[linkedId], "linked");
  assert.equal((await entriesFromRequest(act, linkedId)).length, 1);
  await expectFail(reopenRequest(admin, act, "richiesta-che-non-esiste"), ["not-found", "failed-precondition"]);
  await assertConsistent(act);
});

test("L4 reopenRequest di una richiesta ritirata: anche a finestra chiusa e senza tetti (telefono e persona oltre il limite)", async () => {
  const { admin, leader } = pool;
  const phone = await newPhone();
  const act = await newActivity();
  const parked = (await submit(phone, act, proposalRequest(WHO.maria, { text: "Ritirata" }))).requestId;
  await withdraw(phone, act, parked);
  // Il telefono è al tetto (6 aperte) e la persona ha già 2 aperte.
  for (const [index, who] of [WHO.maria, WHO.maria, WHO.luca, WHO.luca, WHO.sara, WHO.sara].entries()) {
    await submit(phone, act, proposalRequest(who, { text: `Aperta ${index}` }));
  }
  await expectFail(restore(phone, act, parked), "any", MAX_PHONE_MSG);
  await setActivity(act, { recordsCloseAt: inPast(1) });
  await expectFail(restore(phone, act, parked), "any", CLOSED_MSG);

  assert.equal((await reopenRequest(leader, act, parked)).ok, true, "Riapri: nessun tetto e nessuna finestra");
  assert.equal((await requestData(act, parked)).status, "open");
  assert.equal((await requestData(act, parked)).decidedBy, leader.uid);
  const mine = await requestsOfPhone(act, phone);
  assert.equal(mine.filter((request) => request.status === "open").length, 7);
  assert.equal(mine.filter((request) => request.personKey === personKeyOf(WHO.maria) && request.status === "open").length, 3);
  assert.equal(await stateOf(phone, act, parked), "received");
  // Dopo la chiusura il telefono non la ritira; lo staff la vede in coda come aperta.
  await expectFail(withdraw(phone, act, parked), "any", CLOSED_MSG);
  assert.equal((await queueById(admin, act)).get(parked).status, "open");
  await assertConsistent(act);
});

// ---------------------------------------------------------------------------
// M. listRequests: duplicati e suggerimenti (solo per lo staff)
// ---------------------------------------------------------------------------

const dupCount = (item) => (Array.isArray(item.duplicates) ? item.duplicates.length : Number(item.duplicates ?? 0));
const suggestionIds = (item) => (item.suggestions ?? []).map((suggestion) => suggestion.registrationId);

test("M1 listRequests: tutte le richieste dell'attività con lo status, duplicati raggruppati e non rifiutati da soli, senza scadute né richieste di altre attività", async () => {
  const { boyA, admin, phone1, phone2 } = pool;
  const act = await newActivity({ members: [boyA] });
  const other = await newActivity({ members: [boyA] });
  const foreign = await seedRequest(other, phone1, { who: WHO.maria });
  const mariaOne = await seedRequest(act, phone1, { who: WHO.maria, text: "Prima" });
  const mariaTwo = await seedRequest(act, phone2, { who: person("MARIA", "Verdì"), text: "Seconda" });
  const lucaAlone = await seedRequest(act, phone1, { who: WHO.luca });
  const rejected = await seedRequest(act, phone1, { who: WHO.sara, status: "rejected" });
  const withdrawn = await seedRequest(act, phone1, { who: WHO.paolo, status: "withdrawn" });
  const linkedId = await seedRequest(act, phone1, { who: WHO.elena });
  await link(admin, act, linkedId, `user_${boyA.uid}`);
  const expired = await seedRequest(act, phone1, { who: WHO.marco, extra: { expiresAt: Timestamp.fromMillis(Date.now() - 60_000) } });

  const queue = await queueById(admin, act);
  assert.deepEqual([...queue.keys()].sort(), [mariaOne, mariaTwo, lucaAlone, rejected, withdrawn, linkedId].sort(), "elenco della coda");
  assert.ok(!queue.has(foreign) && !queue.has(expired));
  assert.equal(queue.get(mariaOne).status, "open");
  assert.equal(queue.get(rejected).status, "rejected");
  assert.equal(queue.get(withdrawn).status, "withdrawn");
  assert.equal(queue.get(linkedId).status, "linked");
  assert.equal(dupCount(queue.get(mariaOne)), 1, "duplicates: l'altra richiesta con lo stesso personKey");
  assert.equal(dupCount(queue.get(mariaTwo)), 1);
  assert.equal(dupCount(queue.get(lucaAlone)), 0);
  const statuses = await requestStatuses(act);
  assert.equal(statuses[mariaOne], "open", "i duplicati non si rifiutano da soli");
  assert.equal(statuses[mariaTwo], "open");
  // Un terzo duplicato da un terzo telefono.
  const mariaThree = await seedRequest(act, pool.phone3, { who: WHO.maria, text: "Terza" });
  const queue2 = await queueById(admin, act);
  for (const id of [mariaOne, mariaTwo, mariaThree]) assert.equal(dupCount(queue2.get(id)), 2, id);
});

test("M2a suggerimenti: l'unità coincidente porta in testa a parità di nome", async () => {
  const { admin, phone1 } = pool;
  const act = await newActivity();
  const gretaA = await enrollManual(act, "manual_greta_a", "Greta", "Fontana");
  const gretaB = await enrollManual(act, "manual_greta_b", "Greta", "Fontana", { unitId: UNITS.b.id, unitName: UNITS.b.name });
  const requestB = await seedRequest(act, phone1, { who: person("Greta", "Fontana", UNITS.b) });
  const requestA = await seedRequest(act, phone1, { who: person("Greta", "Fontana", UNITS.a) });
  const queue = await queueById(admin, act);
  const idsB = suggestionIds(queue.get(requestB));
  const idsA = suggestionIds(queue.get(requestA));
  assert.ok(idsB.includes(gretaA) && idsB.includes(gretaB) && idsA.includes(gretaA) && idsA.includes(gretaB), "entrambe le Greta fra i suggerimenti");
  assert.equal(idsB[0], gretaB, "stessa unità = in testa (richiesta dell'unità Beta)");
  assert.equal(idsA[0], gretaA, "stessa unità = in testa (richiesta dell'unità Alfa)");
});

test("M2b suggerimenti: mai guest_ né iscrizioni annullate, al massimo 3, campi dichiarati", async () => {
  const { admin, phone1 } = pool;
  const act = await newActivity();
  await enrollManual(act, "manual_greta_a", "Greta", "Fontana");
  await enrollManual(act, "manual_greta_b", "Greta", "Fontana", { unitId: UNITS.b.id, unitName: UNITS.b.name });
  const gretaGuest = await enrollRaw(act, "guest_greta", "Greta", "Fontana");
  const gretaCancelled = await enrollManual(act, "manual_greta_off", "Greta", "Fontana", { registrationStatus: "cancelled" });
  const requestB = await seedRequest(act, phone1, { who: person("Greta", "Fontana", UNITS.b) });
  const requestA = await seedRequest(act, phone1, { who: person("Greta", "Fontana", UNITS.a) });
  const queue = await queueById(admin, act);
  for (const id of [requestA, requestB]) {
    const ids = suggestionIds(queue.get(id));
    assert.ok(!ids.includes(gretaGuest), "guest_ non si suggerisce");
    assert.ok(!ids.includes(gretaCancelled), "un'iscrizione annullata non si suggerisce");
    assert.ok(ids.length >= 1 && ids.length <= 3);
  }
  for (const suggestion of queue.get(requestB).suggestions) {
    assert.equal(typeof suggestion.registrationId, "string");
    assert.equal(typeof suggestion.activeEntries, "number");
    assert.ok(!suggestion.alreadyOnRecord, "una proposta non è già su nessun record");
  }

  // Molti nomi simili: al massimo 3 suggerimenti.
  const crowded = await newActivity();
  for (const [index, [first, last]] of [["Greta", "Fontana"], ["Greta", "Fontanella"], ["Greta", "Fontani"], ["Gretta", "Fontana"], ["Greta", "Fontano"], ["Grete", "Fontana"]].entries()) {
    await enrollManual(crowded, `manual_simile_${index}`, first, last);
  }
  const crowdedRequest = await seedRequest(crowded, phone1, { who: person("Greta", "Fontana") });
  const crowdedIds = suggestionIds((await queueById(admin, crowded)).get(crowdedRequest));
  assert.ok(crowdedIds.length >= 1 && crowdedIds.length <= 3, `suggerimenti: ${crowdedIds.length}`);
});

test("M3 suggerimenti: tipo, tentativi attivi, già sul record; sconosciuto senza suggerimenti; richieste non aperte senza suggerimenti", async () => {
  const { boyA, boyF, parent, admin, phone1 } = pool;
  const act = await newActivity({ members: [boyA, boyF] });
  const r1 = await makeRecord(act, boyF, "Record dei suggerimenti");
  const r2 = await makeRecord(act, boyF, "Altro record dei suggerimenti");
  await P(boyA, act, "challenge", { recordId: r1.record.id });
  await P(boyA, act, "challenge", { recordId: r2.record.id });
  const childId = await enrollChild(act, parent, "kid1", "Dario", "Rossi");
  const manualId = await enrollManual(act, "manual_mario", "Mario", "Manuale");
  const challengeOfAnna = await seedRequest(act, phone1, { who: person("Anna", "Prima"), kind: "challenge", recordId: r1.record.id });
  const proposalOfAnna = await seedRequest(act, phone1, { who: person("Anna", "Prima"), text: "Idea di Anna" });
  const proposalOfChild = await seedRequest(act, phone1, { who: person("Dario", "Rossi") });
  const proposalOfManual = await seedRequest(act, phone1, { who: person("Mario", "Manuale") });
  const unknown = await seedRequest(act, phone1, { who: person("Qwxz", "Vkjh") });
  const rejected = await seedRequest(act, phone1, { who: person("Anna", "Prima"), status: "rejected" });
  const queue = await queueById(admin, act);
  const hasType = (suggestion, type) => Object.values(suggestion).some((value) => value === type || value === `${type}_`);

  const first = (id) => queue.get(id).suggestions[0];
  assert.equal(first(challengeOfAnna).registrationId, `user_${boyA.uid}`);
  assert.ok(hasType(first(challengeOfAnna), "user"), `tipo user nel suggerimento: ${JSON.stringify(first(challengeOfAnna))}`);
  assert.equal(first(challengeOfAnna).activeEntries, 2, "Anna ha già due tentativi attivi");
  assert.equal(first(challengeOfAnna).alreadyOnRecord, true, "Anna è già su questo record");
  assert.ok(JSON.stringify(first(challengeOfAnna)).includes("Anna"));
  assert.ok(JSON.stringify(first(challengeOfAnna)).includes(UNITS.a.name) || JSON.stringify(first(challengeOfAnna)).includes(UNITS.a.id), "unità nel suggerimento");
  assert.equal(first(proposalOfAnna).registrationId, `user_${boyA.uid}`);
  assert.ok(!first(proposalOfAnna).alreadyOnRecord);
  assert.equal(first(proposalOfChild).registrationId, childId);
  assert.ok(hasType(first(proposalOfChild), "child"));
  assert.equal(first(proposalOfChild).activeEntries, 0);
  assert.equal(first(proposalOfManual).registrationId, manualId);
  assert.ok(hasType(first(proposalOfManual), "manual"));
  assert.deepEqual(suggestionIds(queue.get(unknown)), [], "un nome sconosciuto non ha suggerimenti");
  assert.deepEqual(suggestionIds(queue.get(rejected)), [], "le richieste non aperte non hanno suggerimenti");
  // I suggerimenti sono solo dello staff: non passano al telefono.
  assertNoLeak(await G(phone1, act, "mine"), [`user_${boyA.uid}`, childId, manualId, boyA.uid], "mine");
});

// ---------------------------------------------------------------------------
// N. Trigger dell'iscrizione annullata e cleanup dell'attività
// ---------------------------------------------------------------------------

const registrationDoc = (activityId, registrationId) => adminDb.doc(`${activityPath(activityId)}/registrations/${registrationId}`);
const TRIGGER_VARIANTS = [
  ["registrationStatus cancelled", (act, id) => registrationDoc(act, id).update({ registrationStatus: "cancelled" })],
  ["registrationStatus rejected_by_parent", (act, id) => registrationDoc(act, id).update({ registrationStatus: "rejected_by_parent" })],
  ["iscrizione cancellata (delete)", (act, id) => registrationDoc(act, id).delete()],
];

for (const [label, apply] of TRIGGER_VARIANTS) {
  test(`N1 trigger: ${label}: i tentativi collegati vanno a withdrawn (system), la richiesta resta linked, mine dà removed, Scollega funziona`, async () => {
    const { boyA, boyF, admin, phone1 } = pool;
    const act = await newActivity({ members: [boyA, boyF] });
    const r1 = await makeRecord(act, boyF, "Record del trigger");
    const challengeId = await seedRequest(act, phone1, { who: WHO.maria, kind: "challenge", recordId: r1.record.id });
    const proposalId = await seedRequest(act, phone1, { who: WHO.luca, text: "Proposta del trigger" });
    await link(admin, act, challengeId, `user_${boyA.uid}`);
    await link(admin, act, proposalId, `user_${boyA.uid}`);
    const challengeEntryId = (await requestData(act, challengeId)).linkedEntryId;
    const proposalEntryId = (await requestData(act, proposalId)).linkedEntryId;
    const counter = async () => (await recordData(act, r1.record.id)).challengerCount;
    assert.equal(await counter(), 2);

    await apply(act, `user_${boyA.uid}`);
    await waitFor(
      async () => [(await entryData(act, challengeEntryId)).status, (await entryData(act, proposalEntryId)).status],
      (statuses) => statuses.every((status) => status === "withdrawn"),
      "il ritiro d'ufficio dei tentativi collegati",
    );
    for (const entryId of [challengeEntryId, proposalEntryId]) {
      const entry = await entryData(act, entryId);
      assert.equal(entry.withdrawnBy, "system");
      assert.equal(entry.statusBeforeWithdraw ?? null, null, "il ritiro d'ufficio non si annulla");
    }
    await waitFor(counter, (count) => count === 1, "il contatore a 1");
    // La richiesta resta collegata; il telefono vede «removed».
    for (const [requestId, entryId] of [[challengeId, challengeEntryId], [proposalId, proposalEntryId]]) {
      const request = await requestData(act, requestId);
      assert.equal(request.status, "linked");
      assert.equal(request.linkedEntryId, entryId);
      assert.equal(await stateOf(phone1, act, requestId), "removed");
    }
    // Idempotenza: nessun secondo decremento.
    await pause(1000);
    assert.equal(await counter(), 1);
    // Lo staff scollega: richieste di nuovo aperte, contatore invariato.
    await unlink(admin, act, challengeId);
    await unlink(admin, act, proposalId);
    assert.equal(await counter(), 1, "scollegare un tentativo già ritirato non scala il contatore");
    assert.equal((await requestData(act, challengeId)).status, "open");
    assert.equal((await requestData(act, proposalId)).status, "open");
    assert.equal(await stateOf(phone1, act, challengeId), "received");
    await assertConsistent(act);
  });
}

test("N2 trigger: iscrizioni child_ e manual_ annullate ritirano i tentativi collegati; il resto non si tocca", async () => {
  const { boyA, boyF, parent, admin, phone1 } = pool;
  const act = await newActivity({ members: [boyA, boyF] });
  const r1 = await makeRecord(act, boyF, "Record del trigger bis");
  const childId = await enrollChild(act, parent, "kid1", "Dario", "Rossi");
  const manualId = await enrollManual(act, "manual_mario", "Mario", "Manuale");
  const requests = {
    user: await seedRequest(act, phone1, { who: WHO.maria, kind: "challenge", recordId: r1.record.id }),
    child: await seedRequest(act, phone1, { who: WHO.luca, kind: "challenge", recordId: r1.record.id }),
    manual: await seedRequest(act, phone1, { who: WHO.sara, kind: "challenge", recordId: r1.record.id }),
  };
  await link(admin, act, requests.user, `user_${boyA.uid}`);
  await link(admin, act, requests.child, childId);
  await link(admin, act, requests.manual, manualId);
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 4);
  await registrationDoc(act, childId).update({ registrationStatus: "cancelled" });
  await registrationDoc(act, manualId).update({ registrationStatus: "cancelled" });
  await waitFor(async () => (await recordData(act, r1.record.id)).challengerCount, (count) => count === 2, "il contatore a 2");
  assert.equal(await stateOf(phone1, act, requests.child), "removed");
  assert.equal(await stateOf(phone1, act, requests.manual), "removed");
  assert.equal(await stateOf(phone1, act, requests.user), "approved", "chi è ancora iscritto non si tocca");
  assert.equal((await requestData(act, requests.child)).status, "linked");
  assert.equal((await requestData(act, requests.manual)).status, "linked");
  await assertConsistent(act);
});

test("N3 cleanup: cancellare l'attività elimina richieste, tentativi e record; le altre attività restano", async () => {
  const { boyA, boyF, admin, phone1 } = pool;
  const act = await newActivity({ members: [boyA, boyF] });
  const survivor = await newActivity({ members: [boyA] });
  const survivorRequest = await seedRequest(survivor, phone1, { who: WHO.maria });
  const r1 = await makeRecord(act, boyF, "Record da cancellare");
  await seedRequest(act, phone1, { who: WHO.luca });
  await seedRequest(act, phone1, { who: WHO.sara, status: "rejected" });
  const linkedId = await seedRequest(act, phone1, { who: WHO.paolo, kind: "challenge", recordId: r1.record.id });
  await link(admin, act, linkedId, `user_${boyA.uid}`);
  assert.equal((await requestsRef(act).get()).size, 3);
  assert.equal((await entriesRef(act).get()).size, 2);

  await adminDb.doc(activityPath(act)).delete();
  await waitFor(
    async () => [(await requestsRef(act).get()).size, (await entriesRef(act).get()).size, (await recordsRef(act).get()).size],
    (sizes) => sizes.every((size) => size === 0),
    "la pulizia di richieste, tentativi e record",
  );
  assert.equal((await requestsRef(survivor).doc(survivorRequest).get()).exists, true, "le richieste di un'altra attività restano");
});

// ---------------------------------------------------------------------------
// O. Sequenze casuali con seed fisso: link / unlink / withdraw / restore / reopen
//    (e le azioni esistenti sul tentativo), invarianti controllate a ogni passo
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Token del foglio deterministico (formato UUID) così la sequenza è riproducibile.
const fuzzSubmissionId = (seed, step) => `00000000-0000-4000-8000-${`${String(seed).padStart(4, "0")}${String(step).padStart(8, "0")}`.slice(-12)}`;

const GUEST_FUZZ_SEEDS = (process.env.RECORD_NIGHT_GUEST_FUZZ_SEEDS || "11,2027,1016").split(",").map(Number);
const GUEST_FUZZ_STEPS = Number(process.env.RECORD_NIGHT_GUEST_FUZZ_STEPS || 80);
const guestFuzzCoverage = {};
// Esiti ammessi: riuscito o rifiutato per regola (tetti, stato, unicità). Tutto il resto è un difetto.
const FUZZ_ALLOWED = new Set(["ok", "functions/failed-precondition", "functions/not-found", "functions/resource-exhausted"]);

for (const seed of GUEST_FUZZ_SEEDS) {
  test(`O1 sequenze casuali richieste senza account (seed ${seed}): contatori, limite di 2, nessun tentativo attivo orfano e stati di mine coerenti`, async (t) => {
    const rand = mulberry32(seed);
    const pick = (list) => list[Math.floor(rand() * list.length)];
    const { boyA, boyB, boyC, boyD, boyF, parent, admin, leader, phone1, phone2, phone3 } = pool;
    const act = await newActivity({ members: [boyA, boyB, boyC, boyD, boyF] });
    await makePickedStaff(act);
    const childId = await enrollChild(act, parent, "kid1", "Dario", "Rossi");
    const manualId = await enrollManual(act, `manual_fuzz_${seed}`, "Manuel", "Fuzzi");
    const registrationIds = [boyA, boyB, boyC, boyD].map((client) => `user_${client.uid}`).concat([childId, manualId]);
    await makeRecord(act, boyF, "Record uno");
    await makeRecord(act, boyD, "Record due");
    const phones = [phone1, phone2, phone3];
    const staffPool = [admin, leader, pool.picked];
    const owners = [boyA, boyB, boyC, boyD, parent];
    const people = [WHO.maria, WHO.luca, WHO.sara, WHO.paolo];
    await assertConsistent(act);

    const log = [];
    const tally = {};
    for (let step = 0; step < GUEST_FUZZ_STEPS; step += 1) {
      // Gli id Firestore sono casuali: si ordina per contenuto così la sequenza è riproducibile.
      const sortKey = (item) => [item.submissionId ?? "", item.createdAt ?? "", item.title ?? item.proposedText ?? "", item.ownerUid ?? "", item.recordId ?? "", item.status].join("|");
      const byKey = (left, right) => sortKey(left).localeCompare(sortKey(right));
      const [requestsNow, entriesNow, recordsNow] = (await Promise.all([allDocs(requestsRef(act)), allDocs(entriesRef(act)), allDocs(recordsRef(act))])).map((list) => list.sort(byKey));
      const phone = pick(phones);
      const staff = pick(staffPool);
      const who = pick(people);
      const submissionId = fuzzSubmissionId(seed, step);
      const own = requestsNow.filter((request) => request.anonUid === phone.uid);
      const candidates = [];
      const add = (name, run, weight = 1) => {
        for (let copy = 0; copy < weight; copy += 1) candidates.push([name, run]);
      };

      add("submit", () => submit(phone, act, proposalRequest(who, { submissionId, text: `Idea al passo ${step}` })), 2);
      if (recordsNow.length) {
        const record = pick(recordsNow);
        add("submit", () => submit(phone, act, challengeRequest(who, record.id, { submissionId })), 2);
      }
      if (own.length) {
        const target = pick(own);
        add("withdraw", () => withdraw(phone, act, target.id), 2);
        add("restore", () => restore(phone, act, target.id), 2);
      }
      if (requestsNow.length) {
        const target = pick(requestsNow);
        const registrationId = pick(registrationIds);
        add("link", () => link(staff, act, target.id, registrationId), 4);
        add("unlink", async () => {
          // Per ogni scollegamento riuscito: il tentativo collegato finisce withdrawn/staff, una volta sola.
          const before = await requestData(act, target.id);
          const entryBefore = before.linkedEntryId ? await entryData(act, before.linkedEntryId) : null;
          const recordBefore = entryBefore?.recordId ? await recordData(act, entryBefore.recordId) : null;
          const result = await unlink(staff, act, target.id);
          if (entryBefore) {
            const entryAfter = await entryData(act, before.linkedEntryId);
            assert.equal(entryAfter.status, "withdrawn");
            assert.equal(entryAfter.withdrawnBy, "staff");
            assert.equal(entryAfter.statusBeforeWithdraw ?? null, null);
            assert.ok(!entryAfter.withdrawnWithRecordHide);
            if (recordBefore) {
              const expected = recordBefore.challengerCount - (entryBefore.status === "approved" ? 1 : 0);
              assert.equal((await recordData(act, entryBefore.recordId)).challengerCount, expected, "contatore dopo lo scollegamento");
            }
          }
          return result;
        }, 3);
        add("rejectRequest", () => rejectRequest(staff, act, target.id, "Nota casuale."), 1);
        add("rejectRequests", () => A(staff, act, "rejectRequests", { requestIds: [target.id] }), 1);
        add("reopenRequest", () => reopenRequest(staff, act, target.id), 2);
      }
      // Azioni esistenti sul tentativo, per portarlo in tutti gli stati prima di scollegare.
      const pendingEntries = entriesNow.filter((entry) => entry.status === "pending");
      if (pendingEntries.length) {
        const entry = pick(pendingEntries);
        add("approve", () => A(staff, act, "approve", { entryId: entry.id, ...recordInput(`Titolo al passo ${step}`) }));
        add("rejectEntry", () => A(staff, act, "reject", { entryId: entry.id, reason: "Motivo casuale." }));
        if (recordsNow.length) {
          const record = pick(recordsNow);
          add("merge", () => A(staff, act, "merge", { entryId: entry.id, recordId: record.id }));
        }
      }
      if (entriesNow.length) {
        const entry = pick(entriesNow);
        add("withdrawEntry", () => A(staff, act, "withdrawEntry", { entryId: entry.id }));
        add("reopenEntry", () => A(staff, act, "reopen", { entryId: entry.id }));
        const owner = owners.find((client) => client.uid === entry.ownerUid);
        if (owner) {
          add("ownerWithdraw", () => P(owner, act, "withdraw", { entryId: entry.id }), 2);
          add("ownerRestore", () => P(owner, act, "restore", { entryId: entry.id }), 2);
        }
      }
      if (recordsNow.length) {
        const record = pick(recordsNow);
        const status = rand() < 0.3 ? "hidden" : "open";
        add("updateRecord", () => A(staff, act, "updateRecord", {
          recordId: record.id, title: record.title, category: record.category, measure: record.measure, durationSeconds: record.durationSeconds ?? null, status,
        }));
      }

      const [name, run] = pick(candidates);
      let outcome = "ok";
      try {
        await run();
      } catch (error) {
        // Solo i codici HTTPS delle callable sono esiti «normali»; un'asserzione fallita dentro il passo
        // (es. contatore dopo lo scollegamento) deve arrivare al report col suo messaggio.
        outcome = typeof error?.code === "string" && error.code.startsWith("functions/") ? error.code : `errore: ${error?.message}`;
      }
      log.push(`${step}: ${name} -> ${outcome}`);
      tally[name] = tally[name] ?? { ok: 0, rifiutate: 0 };
      if (outcome === "ok") tally[name].ok += 1;
      else tally[name].rifiutate += 1;
      const context = `seed ${seed}, passo ${step} (${name} -> ${outcome})\nUltimi passi:\n${log.slice(-8).join("\n")}`;
      assert.ok(FUZZ_ALLOWED.has(outcome), `Esito imprevisto: ${context}`);
      try {
        await assertConsistent(act);
        if (step % 5 === 4) for (const client of phones) await assertMineMatchesData(client, act);
      } catch (error) {
        error.message = `${error.message}\n${context}`;
        throw error;
      }
    }
    for (const client of phones) await assertMineMatchesData(client, act);
    t.diagnostic(`seed ${seed}: ${JSON.stringify(tally)}`);
    const okTotal = Object.values(tally).reduce((sum, item) => sum + item.ok, 0);
    assert.ok(okTotal >= GUEST_FUZZ_STEPS / 4, `la sequenza casuale è quasi tutta rifiutata (${okTotal}/${GUEST_FUZZ_STEPS} riuscite): test poco significativo`);
    for (const [name, counts] of Object.entries(tally)) guestFuzzCoverage[name] = (guestFuzzCoverage[name] ?? 0) + counts.ok;
    for (const required of ["submit", "link"]) {
      assert.ok((tally[required]?.ok ?? 0) >= 1, `nessuna azione "${required}" riuscita nella sequenza: copertura insufficiente`);
    }
  });
}

test("O2 sequenze casuali richieste senza account: nell'insieme dei seed ogni azione nuova è riuscita almeno una volta", () => {
  const missing = ["submit", "withdraw", "restore", "link", "unlink", "rejectRequest", "rejectRequests", "reopenRequest"].filter((name) => !(guestFuzzCoverage[name] > 0));
  assert.deepEqual(missing, [], `azioni mai riuscite nelle sequenze casuali: ${missing.join(", ")} (copertura: ${JSON.stringify(guestFuzzCoverage)})`);
});

// ===========================================================================
// P. Aggiornamenti della spec (revisione 2026-10-10 sera)
// ===========================================================================

// ---- C: linkRequest e rejectRequest idempotenti ----

test("P1 linkRequest è idempotente sulla stessa iscrizione (ok, nessun secondo tentativo, contatore invariato); con un'altra iscrizione dà errore", async () => {
  const { boyA, boyB, boyF, admin, leader, phone1 } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyF] });
  const r1 = await makeRecord(act, boyF, "Record dell'idempotenza");
  const proposalId = await seedRequest(act, phone1, { who: WHO.maria, text: "Torre di bicchieri" });
  const challengeId = await seedRequest(act, phone1, { who: WHO.luca, kind: "challenge", recordId: r1.record.id });
  await link(admin, act, proposalId, `user_${boyA.uid}`);
  await link(admin, act, challengeId, `user_${boyB.uid}`);
  const proposalEntry = (await requestData(act, proposalId)).linkedEntryId;
  const challengeEntry = (await requestData(act, challengeId)).linkedEntryId;
  const world = await snapshotWorld(act);
  const counter = async () => (await recordData(act, r1.record.id)).challengerCount;
  assert.equal(await counter(), 2);

  // Doppio tocco o risposta persa: stessa iscrizione = stato attuale.
  for (const [requestId, registrationId, entryId, staff] of [
    [proposalId, `user_${boyA.uid}`, proposalEntry, admin],
    [challengeId, `user_${boyB.uid}`, challengeEntry, leader],
  ]) {
    const again = await link(staff, act, requestId, registrationId);
    assert.equal(again.ok, true, "link ripetuto sulla stessa iscrizione");
    if (again.entry) assert.equal(again.entry.id, entryId, "restituisce il tentativo già creato");
    assert.equal((await requestData(act, requestId)).linkedEntryId, entryId);
    assert.equal((await entriesFromRequest(act, requestId)).length, 1, "nessun secondo tentativo");
  }
  assert.equal(await counter(), 2, "contatore invariato");
  assert.deepEqual(await snapshotWorld(act), world, "il collegamento ripetuto non cambia nulla");

  // Un'iscrizione diversa: errore (prima va scollegata).
  await expectFail(link(admin, act, proposalId, `user_${boyB.uid}`), "failed-precondition");
  await expectFail(link(admin, act, challengeId, `user_${boyA.uid}`), "failed-precondition");
  assert.equal((await requestData(act, proposalId)).linkedRegistrationId, `user_${boyA.uid}`);
  assert.equal((await requestData(act, challengeId)).linkedRegistrationId, `user_${boyB.uid}`);
  assert.deepEqual(await snapshotWorld(act), world);

  // Anche se il titolare ha ritirato il tentativo: stessa iscrizione = stato attuale, nessun tentativo nuovo.
  await P(boyA, act, "withdraw", { entryId: proposalEntry });
  assert.equal((await link(admin, act, proposalId, `user_${boyA.uid}`)).ok, true);
  assert.equal((await entriesFromRequest(act, proposalId)).length, 1);
  assert.equal((await entryData(act, proposalEntry)).status, "withdrawn");
  assert.equal(await stateOf(phone1, act, proposalId), "removed");
  await assertConsistent(act);
});

test("P2 due collegamenti insieme alla stessa iscrizione: riescono entrambi, un solo tentativo", async () => {
  const { boyA, boyF, admin, leader, phone1 } = pool;
  const act = await newActivity({ members: [boyA, boyF] });
  const r1 = await makeRecord(act, boyF, "Record del doppio tocco dello staff");
  const requestId = await seedRequest(act, phone1, { who: WHO.maria, kind: "challenge", recordId: r1.record.id });
  const settled = await Promise.allSettled([
    link(admin, act, requestId, `user_${boyA.uid}`),
    link(leader, act, requestId, `user_${boyA.uid}`),
    link(admin, act, requestId, `user_${boyA.uid}`),
  ]);
  assert.deepEqual(settled.map((item) => item.status), ["fulfilled", "fulfilled", "fulfilled"], JSON.stringify(settled.map((item) => (item.status === "fulfilled" ? "ok" : item.reason?.message))));
  assert.equal((await entriesFromRequest(act, requestId)).length, 1, "un solo tentativo");
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 2);
  await assertConsistent(act);
});

// ---- B: unlinkRequest nasconde il record rimasto a zero ----

const HIDE_UNLINK_CASES = [
  ["ritirato dal titolare", false, (c) => P(c.owner, c.act, "withdraw", { entryId: c.entryId })],
  ["ritirato dallo staff", false, (c) => A(c.admin, c.act, "withdrawEntry", { entryId: c.entryId })],
  [
    "ritirato d'ufficio (iscrizione annullata)",
    true,
    async (c) => {
      await registrationDoc(c.act, c.registrationId).update({ registrationStatus: "cancelled" });
      await waitFor(async () => (await entryData(c.act, c.entryId)).status, (status) => status === "withdrawn", "il ritiro d'ufficio");
    },
  ],
];
for (const [label, cancelled, prepare] of HIDE_UNLINK_CASES) {
  test(`P3 unlinkRequest su tentativo «${label}» che ha creato il record rimasto a zero: il record si nasconde, nessun doppione dopo il ricollegamento`, async () => {
    const { boyA, admin, phone1, signedOut } = pool;
    const act = await newActivity({ members: [boyA] });
    const registrationId = `user_${boyA.uid}`;
    const title = "Torre di bicchieri in 60 secondi";
    const requestId = await seedRequest(act, phone1, { who: WHO.maria, text: "Torre di bicchieri" });
    await link(admin, act, requestId, registrationId);
    const entryId = (await requestData(act, requestId)).linkedEntryId;
    const approved = await A(admin, act, "approve", { entryId, ...recordInput(title) });
    const recordId = approved.record.id;
    assert.equal((await recordData(act, recordId)).createdFromEntryId, entryId);
    await prepare({ act, admin, owner: boyA, entryId, registrationId });
    const before = await recordData(act, recordId);
    assert.equal(before.challengerCount, 0, "il tentativo ritirato ha lasciato il record a zero");
    assert.equal(before.status, "open");

    assert.equal((await unlink(admin, act, requestId)).ok, true);
    const hidden = await recordData(act, recordId);
    assert.equal(hidden.status, "hidden", "il record rimasto vuoto si nasconde");
    assert.equal(hidden.challengerCount, 0);
    const entry = await entryData(act, entryId);
    assert.equal(entry.status, "withdrawn");
    assert.equal(entry.withdrawnBy, "staff");
    assert.equal((await requestData(act, requestId)).status, "open");
    assert.ok(!(await G(signedOut, act, "context")).records.some((record) => record.title === title), "il titolo non è più pubblico");
    await assertConsistent(act);

    if (!cancelled) {
      // Collega di nuovo: tentativo nuovo, approvazione di nuovo: un record nuovo, il vecchio resta nascosto.
      await link(admin, act, requestId, registrationId);
      const relinked = (await requestData(act, requestId)).linkedEntryId;
      assert.notEqual(relinked, entryId);
      const again = await A(admin, act, "approve", { entryId: relinked, ...recordInput(title) });
      assert.notEqual(again.record.id, recordId);
      const sameTitle = (await allDocs(recordsRef(act))).filter((record) => record.title === title);
      assert.equal(sameTitle.length, 2);
      assert.deepEqual(sameTitle.map((record) => record.status).sort(), ["hidden", "open"], "un solo record visibile con quel titolo");
      assert.equal((await G(signedOut, act, "context")).records.filter((record) => record.title === title).length, 1, "nessun doppione pubblico");
      await assertConsistent(act);
    }
  });
}

test("P4 unlinkRequest non nasconde un record con altri sfidanti né uno che il tentativo non ha creato", async () => {
  const { boyA, boyB, boyF, admin, phone1 } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyF] });

  // (i) Il tentativo ha creato il record, ma c'è un altro sfidante.
  const proposalId = await seedRequest(act, phone1, { who: WHO.maria, text: "Torre di bicchieri" });
  await link(admin, act, proposalId, `user_${boyA.uid}`);
  const proposalEntry = (await requestData(act, proposalId)).linkedEntryId;
  const created = await A(admin, act, "approve", { entryId: proposalEntry, ...recordInput("Torre con due sfidanti") });
  await P(boyB, act, "challenge", { recordId: created.record.id });
  await P(boyA, act, "withdraw", { entryId: proposalEntry });
  assert.equal((await recordData(act, created.record.id)).challengerCount, 1);
  await unlink(admin, act, proposalId);
  assert.equal((await recordData(act, created.record.id)).status, "open", "con un altro sfidante il record resta aperto");
  assert.equal((await recordData(act, created.record.id)).challengerCount, 1);

  // (ii) Il record non è nato da questo tentativo: anche se resta a zero non si nasconde.
  const made = await makeRecord(act, boyF, "Record di Fiora");
  await P(boyF, act, "withdraw", { entryId: made.entry.id });
  const challengeId = await seedRequest(act, phone1, { who: WHO.luca, kind: "challenge", recordId: made.record.id });
  await link(admin, act, challengeId, `user_${boyA.uid}`);
  const challengeEntry = (await requestData(act, challengeId)).linkedEntryId;
  assert.equal((await recordData(act, made.record.id)).challengerCount, 1);
  await P(boyA, act, "withdraw", { entryId: challengeEntry });
  assert.equal((await recordData(act, made.record.id)).challengerCount, 0);
  await unlink(admin, act, challengeId);
  assert.equal((await recordData(act, made.record.id)).status, "open", "il tentativo non ha creato il record: resta com'era");
  await assertConsistent(act);
});

// ---- E: listRequests per le collegate ----

test("P5 listRequests: per le collegate entryStatus e withdrawnBy del tentativo", async () => {
  const { boyA, boyB, boyC, boyD, boyE, boyF, admin, phone1 } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyC, boyD, boyE, boyF] });
  const r1 = await makeRecord(act, boyF, "Record della coda");
  const manualId = await enrollManual(act, "manual_mario", "Mario", "Manuale");
  const make = async (who, kind, registrationId) => {
    const requestId = await seedRequest(act, phone1, { who, kind, recordId: kind === "challenge" ? r1.record.id : null });
    await link(admin, act, requestId, registrationId);
    return requestId;
  };
  const ids = {
    pending: await make(WHO.maria, "proposal", `user_${boyA.uid}`),
    approved: await make(WHO.luca, "challenge", `user_${boyB.uid}`),
    rejected: await make(WHO.sara, "proposal", `user_${boyC.uid}`),
    self: await make(WHO.paolo, "challenge", `user_${boyD.uid}`),
    staff: await make(WHO.elena, "challenge", manualId),
    system: await make(WHO.marco, "challenge", `user_${boyE.uid}`),
  };
  const open = await seedRequest(act, phone1, { who: WHO.giulia });
  await A(admin, act, "reject", { entryId: (await requestData(act, ids.rejected)).linkedEntryId, reason: "No." });
  await P(boyD, act, "withdraw", { entryId: (await requestData(act, ids.self)).linkedEntryId });
  await A(admin, act, "withdrawEntry", { entryId: (await requestData(act, ids.staff)).linkedEntryId });
  await registrationDoc(act, `user_${boyE.uid}`).update({ registrationStatus: "cancelled" });
  await waitFor(async () => (await entryData(act, (await requestData(act, ids.system)).linkedEntryId)).status, (status) => status === "withdrawn", "il ritiro d'ufficio");

  const queue = await queueById(admin, act);
  const expected = {
    pending: ["pending", null],
    approved: ["approved", null],
    rejected: ["rejected", null],
    self: ["withdrawn", "self"],
    staff: ["withdrawn", "staff"],
    system: ["withdrawn", "system"],
  };
  for (const [label, [entryStatus, withdrawnBy]] of Object.entries(expected)) {
    const item = queue.get(ids[label]);
    assert.equal(item.status, "linked", label);
    assert.equal(item.entryStatus, entryStatus, `${label}: entryStatus`);
    assert.equal(item.withdrawnBy ?? null, withdrawnBy, `${label}: withdrawnBy`);
  }
  assert.equal(queue.get(open).status, "open");
  assert.ok(queue.get(open).entryStatus === undefined || queue.get(open).entryStatus === null, "una richiesta aperta non ha un tentativo");
});

// ---- G: mine.recordTitle ----

test("P6 mine.recordTitle: c'è solo se il record è open, ha sfidanti e l'interruttore è acceso; altrimenti null", async () => {
  const { boyF, admin, phone1 } = pool;
  const act = await newActivity({ members: [boyF] });
  const title = "Titolo pubblico del record";
  const made = await makeRecord(act, boyF, title);
  const challenge = (await submit(phone1, act, challengeRequest(WHO.maria, made.record.id))).requestId;
  const proposalRes = (await submit(phone1, act, proposalRequest(WHO.luca))).requestId;
  const recordTitle = async (requestId) => (await mineById(phone1, act)).get(requestId).recordTitle ?? null;

  assert.equal(await recordTitle(challenge), title, "record open, con sfidanti, interruttore acceso");
  assert.equal(await recordTitle(proposalRes), null, "una proposta non ha un record");

  await setActivity(act, { recordsGuestEnabled: false });
  assert.equal(await recordTitle(challenge), null, "interruttore spento: il titolo non è pubblico");
  assert.equal((await mineItems(phone1, act)).length, 2, "le richieste si vedono lo stesso");
  await setActivity(act, { recordsGuestEnabled: true });
  assert.equal(await recordTitle(challenge), title);

  const recordInputFor = recordInput(title);
  await A(admin, act, "updateRecord", { recordId: made.record.id, ...recordInputFor, status: "hidden" });
  assert.equal(await recordTitle(challenge), null, "record nascosto");
  await A(admin, act, "updateRecord", { recordId: made.record.id, ...recordInputFor, status: "open" });
  assert.equal(await recordTitle(challenge), title);

  await P(pool.boyF, act, "withdraw", { entryId: made.entry.id });
  assert.equal((await recordData(act, made.record.id)).challengerCount, 0);
  assert.equal(await recordTitle(challenge), null, "record aperto ma senza sfidanti");
  // Il titolo mai nel resto della risposta quando è null.
  assert.ok(!JSON.stringify(await G(phone1, act, "mine")).includes(title));
});

// ---- H: scadenza già passata all'invio ----

test("P7 submit: con data d'inizio presente e inizio + 7 giorni già passato la richiesta non nasce («chiuse»); con inizio recente nasce", async () => {
  const phone = await newPhone();
  const daysAgo = (days) => new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  const tenDaysAgo = daysAgo(10);
  const late = await newActivity({ startDate: tenDaysAgo }); // finestra ancora aperta (recordsCloseAt fra 48 ore)
  await expectFail(submit(phone, late, proposalRequest(WHO.maria)), "any", CLOSED_MSG);
  assert.equal((await requestsOfPhone(late, phone)).length, 0, "la richiesta non deve nascere");
  assert.equal((await requestsRef(late).get()).size, 0);

  const threeDaysAgo = daysAgo(3);
  const recent = await newActivity({ startDate: threeDaysAgo });
  const created = await submit(phone, recent, proposalRequest(WHO.maria));
  const expires = (await requestData(recent, created.requestId)).expiresAt.toMillis();
  const start = Date.parse(`${threeDaysAgo}T00:00:00.000Z`);
  assert.ok(Math.abs(expires - (start + 7 * DAY)) <= 1.5 * DAY, `expiresAt ${new Date(expires).toISOString()} non è inizio + 7 giorni`);
  assert.ok(expires > Date.now(), "la richiesta nasce con una scadenza nel futuro");
});

// ---- F: tetti del telefono prima di quello della coda ----

test("P8 tetti: quello del telefono si controlla prima di quello della coda (solo l'esito)", async () => {
  const { boyA } = pool;
  const act = await newActivity({ members: [boyA] });
  // Telefono al tetto: una ritirata e dodici aperte (sei persone per due richieste).
  const atCap = await newPhone();
  const parked = (await submit(atCap, act, proposalRequest(WHO.tommaso, { text: "Ritirata" }))).requestId;
  await withdraw(atCap, act, parked);
  const sixPeople = [WHO.maria, WHO.luca, WHO.sara, WHO.paolo, WHO.elena, WHO.marco];
  for (const [index, who] of sixPeople.flatMap((person_) => [person_, person_]).entries()) {
    await submit(atCap, act, proposalRequest(who, { text: `Aperta ${index}` }));
  }
  // Telefono con due aperte della stessa persona.
  const twoOfOne = await newPhone();
  await submit(twoOfOne, act, proposalRequest(WHO.giulia, { text: "Prima" }));
  await submit(twoOfOne, act, proposalRequest(WHO.giulia, { text: "Seconda" }));
  // Telefono libero, con una richiesta ritirata.
  const free = await newPhone();
  const freeParked = (await submit(free, act, proposalRequest(WHO.elena, { text: "Libera" }))).requestId;
  await withdraw(free, act, freeParked);
  // La coda sale a 100 aperte (14 sono già dei telefoni sopra).
  await Promise.all(Array.from({ length: 86 }, (_, index) => seedRequest(act, { uid: `folla-${runId}-${index}` }, { who: WHO.giulia, text: `Folla ${index}` })));
  assert.equal((await requestsRef(act).where("status", "==", "open").get()).size, 100);

  // Coda piena e telefono al tetto: l'errore è quello del telefono.
  await expectFail(submit(atCap, act, proposalRequest(WHO.marco, { text: "Una nuova idea" })), "any", MAX_PHONE_MSG);
  await expectFail(submit(atCap, act, proposalRequest(person("Irene", "Celeste"))), "any", MAX_PHONE_MSG);
  await expectFail(restore(atCap, act, parked), "any", MAX_PHONE_MSG);
  await expectFail(submit(twoOfOne, act, proposalRequest(WHO.giulia, { text: "Terza" })), "any", MAX_PHONE_MSG);
  // Coda piena e telefono libero: l'errore neutro della coda.
  await expectFail(submit(free, act, proposalRequest(WHO.marco)), "any", CANNOT_RECEIVE_MSG);
  await expectFail(restore(free, act, freeParked), "any", CANNOT_RECEIVE_MSG);
  assert.equal((await requestsRef(act).where("status", "==", "open").get()).size, 100, "nessuna richiesta nata o riaperta");
});

// ===========================================================================
// Q. GARE VERE: chiamate simultanee nell'emulatore, poi le invarianti
// ===========================================================================
// Ogni esito ammesso dalla spec va bene, purché reggano: contatore == tentativi approved,
// al massimo 2 attivi per iscrizione, richiesta linked coerente con il tentativo, nessun
// tentativo attivo orfano (assertConsistent). Errori ammessi: failed-precondition e not-found.

const RACE_OK_CODES = new Set(["functions/failed-precondition", "functions/not-found"]);
// Il Firestore emulator risolve un deadlock fra due transazioni che leggono e poi scrivono lo stesso
// documento con un timeout dei lock di parecchi secondi, e il Admin SDK non lo riprova: arriva come
// INTERNAL dopo 4+ secondi. Su Firestore vero il conflitto è ABORTED e viene riprovato. Qui è un
// esito «nessun effetto» ammesso (si conta e si riporta), ma un INTERNAL veloce è un crash vero.
const LOCK_TIMEOUT_MS = 4000;
const race = (...promises) =>
  Promise.allSettled(
    promises.map((promise) => {
      const started = Date.now();
      return Promise.resolve(promise).catch((error) => {
        if (error && typeof error === "object") error.elapsedMs = Date.now() - started;
        throw error;
      });
    }),
  );
const raceOutcomes = (settled) => settled.map((item) => (item.status === "fulfilled" ? "ok" : item.reason?.code ?? "errore"));
const fulfilledCount = (settled) => settled.filter((item) => item.status === "fulfilled").length;
// Restituisce quante chiamate sono finite nel timeout dei lock dell'emulatore.
function assertRaceClean(settled, label) {
  let lockTimeouts = 0;
  for (const item of settled) {
    if (item.status !== "rejected") continue;
    const code = item.reason?.code;
    if (RACE_OK_CODES.has(code)) continue;
    if (code === "functions/internal" && (item.reason?.elapsedMs ?? 0) >= LOCK_TIMEOUT_MS) {
      lockTimeouts += 1;
      continue;
    }
    assert.fail(`${label}: esito imprevisto ${JSON.stringify(raceOutcomes(settled))}: ${item.reason?.message} (${item.reason?.elapsedMs} ms)`);
  }
  return lockTimeouts;
}
const RACE_NAMES = ["Alba", "Berta", "Cinzia", "Dora", "Elisa", "Fulvia", "Giada", "Irene", "Lidia", "Marta"];

test("Q1 gara vera: collegamento contro ritiro del telefono (10 giri): vince uno solo", async (t) => {
  const { boyF, admin } = pool;
  const act = await newActivity({ members: [boyF] });
  const r1 = await makeRecord(act, boyF, "Record della gara uno");
  const phone = await newPhone();
  const tally = { linked: 0, withdrawn: 0, lockTimeouts: 0 };
  for (let round = 0; round < 10; round += 1) {
    const registrationId = await enrollManual(act, `manual_gara_${round}`, "Gara", `Numero${RACE_NAMES[round]}`);
    const created = await submit(phone, act, challengeRequest(person(RACE_NAMES[round], "Lunari"), r1.record.id));
    const settled = await race(link(admin, act, created.requestId, registrationId), withdraw(phone, act, created.requestId));
    const timeouts = assertRaceClean(settled, `giro ${round}`);
    tally.lockTimeouts += timeouts;
    if (timeouts === 0) assert.equal(fulfilledCount(settled), 1, `giro ${round}: ${JSON.stringify(raceOutcomes(settled))}`);
    else assert.ok(fulfilledCount(settled) <= 1);
    const request = await requestData(act, created.requestId);
    if (request.status === "linked") {
      assert.equal((await entriesFromRequest(act, created.requestId)).length, 1);
      tally.linked += 1;
    } else {
      assert.ok(request.status === "withdrawn" || (request.status === "open" && timeouts > 0), `stato ${request.status} dopo ${JSON.stringify(raceOutcomes(settled))}`);
      assert.equal((await entriesFromRequest(act, created.requestId)).length, 0, "ritiro vinto: nessun tentativo");
      tally.withdrawn += 1;
    }
    await assertConsistent(act);
  }
  t.diagnostic(JSON.stringify(tally));
});

test("Q2 gara vera: collegamento contro rejectRequest e rejectRequests dello staff (10 giri ciascuno)", async (t) => {
  const { boyF, admin, leader, phone1 } = pool;
  const act = await newActivity({ members: [boyF] });
  const r1 = await makeRecord(act, boyF, "Record della gara due");
  const tally = { single: { linked: 0, rejected: 0 }, bulk: { linked: 0, rejected: 0 }, lockTimeouts: 0 };
  for (const variant of ["single", "bulk"]) {
    for (let round = 0; round < 10; round += 1) {
      const registrationId = await enrollManual(act, `manual_gara_${variant}_${round}`, "Gara", `Numero${RACE_NAMES[round]}`);
      const requestId = await seedRequest(act, phone1, { who: person(RACE_NAMES[round], "Lunari"), kind: "challenge", recordId: r1.record.id });
      const rejection = variant === "single" ? rejectRequest(leader, act, requestId, "Gara") : A(leader, act, "rejectRequests", { requestIds: [requestId] });
      const settled = await race(link(admin, act, requestId, registrationId), rejection);
      const timeouts = assertRaceClean(settled, `${variant} giro ${round}`);
      tally.lockTimeouts += timeouts;
      const request = await requestData(act, requestId);
      if (timeouts === 0) {
        if (variant === "single") assert.equal(fulfilledCount(settled), 1, `${variant} giro ${round}: ${JSON.stringify(raceOutcomes(settled))}`);
        else assert.ok(fulfilledCount(settled) >= 1, `${variant} giro ${round}: ${JSON.stringify(raceOutcomes(settled))}`);
      }
      if (request.status === "linked") {
        assert.equal((await entriesFromRequest(act, requestId)).length, 1);
        tally[variant].linked += 1;
      } else {
        assert.ok(request.status === "rejected" || (request.status === "open" && timeouts > 0), `stato ${request.status} dopo ${JSON.stringify(raceOutcomes(settled))}`);
        assert.equal((await entriesFromRequest(act, requestId)).length, 0, "rifiuto vinto: nessun tentativo");
        tally[variant].rejected += 1;
      }
      await assertConsistent(act);
    }
  }
  t.diagnostic(JSON.stringify(tally));
});

for (const [label, kind] of [["sfida approvata", "challenge"], ["proposta in attesa", "proposal"]]) {
  test(`Q3 gara vera: Scollega contro «Annulla» del titolare (${label}, 5 giri)`, async (t) => {
    const { boyA, boyB, boyC, boyD, boyE, boyF, admin, phone1 } = pool;
    const members = [boyA, boyB, boyC, boyD, boyE];
    const act = await newActivity({ members: [...members, boyF] });
    const r1 = await makeRecord(act, boyF, "Record della gara tre");
    const tally = { restoredThenUnlinked: 0, unlinkedFirst: 0, lockTimeouts: 0 };
    for (const [round, member] of members.entries()) {
      const requestId = await seedRequest(act, phone1, {
        who: person(RACE_NAMES[round], "Lunari"), kind, recordId: kind === "challenge" ? r1.record.id : null, text: `Idea della gara ${round}`,
      });
      await link(admin, act, requestId, `user_${member.uid}`);
      const entryId = (await requestData(act, requestId)).linkedEntryId;
      await P(member, act, "withdraw", { entryId });
      const settled = await race(unlink(admin, act, requestId), P(member, act, "restore", { entryId }));
      const timeouts = assertRaceClean(settled, `giro ${round}`);
      tally.lockTimeouts += timeouts;
      const entry = await entryData(act, entryId);
      if (settled[0].status === "fulfilled") {
        // Lo scollegamento è riuscito: in qualunque ordine il tentativo finisce ritirato dallo staff, senza «Annulla».
        assert.equal(entry.status, "withdrawn", "alla fine il tentativo scollegato è ritirato");
        assert.equal(entry.withdrawnBy, "staff");
        assert.equal(entry.statusBeforeWithdraw ?? null, null, "nessun «Annulla» residuo");
        assert.ok(!entry.withdrawnWithRecordHide);
        assert.equal((await requestData(act, requestId)).status, "open");
        if (settled[1].status === "fulfilled") tally.restoredThenUnlinked += 1;
        else tally.unlinkedFirst += 1;
      } else {
        assert.ok(timeouts > 0, `lo scollegamento deve riuscire in ogni ordine: ${JSON.stringify(raceOutcomes(settled))}`);
      }
      await assertConsistent(act);
    }
    t.diagnostic(JSON.stringify(tally));
  });
}

test("Q4 gara vera: Scollega contro «Mostra di nuovo» (updateRecord open su un record nascosto, 5 giri)", async (t) => {
  const { boyA, boyF, admin, leader, phone1 } = pool;
  const tally = { lockTimeouts: 0, bothOk: 0 };
  for (let round = 0; round < 5; round += 1) {
    const act = await newActivity({ members: [boyA, boyF] });
    const title = `Record nascosto ${round}`;
    const r1 = await makeRecord(act, boyF, title);
    const requestId = await seedRequest(act, phone1, { who: WHO.maria, kind: "challenge", recordId: r1.record.id });
    await link(admin, act, requestId, `user_${boyA.uid}`);
    const entryId = (await requestData(act, requestId)).linkedEntryId;
    await A(admin, act, "updateRecord", { recordId: r1.record.id, ...recordInput(title), status: "hidden" });
    assert.equal((await entryData(act, entryId)).withdrawnWithRecordHide, true);

    const settled = await race(
      unlink(admin, act, requestId),
      A(leader, act, "updateRecord", { recordId: r1.record.id, ...recordInput(title), status: "open" }),
    );
    const timeouts = assertRaceClean(settled, `giro ${round}`);
    tally.lockTimeouts += timeouts;
    if (timeouts === 0) {
      assert.deepEqual(raceOutcomes(settled), ["ok", "ok"], "scollegare e mostrare di nuovo riescono entrambi");
      tally.bothOk += 1;
    }
    const entry = await entryData(act, entryId);
    if (settled[0].status === "fulfilled") {
      assert.equal(entry.status, "withdrawn", "il tentativo scollegato non rientra con il record");
      assert.equal(entry.withdrawnBy, "staff");
      assert.equal(entry.statusBeforeWithdraw ?? null, null);
      assert.ok(!entry.withdrawnWithRecordHide);
      assert.equal((await requestData(act, requestId)).status, "open");
    }
    if (settled[1].status === "fulfilled") {
      const record = await recordData(act, r1.record.id);
      assert.equal(record.status, "open");
      assert.equal(record.challengerCount, settled[0].status === "fulfilled" ? 1 : 2, "rientra solo chi ha creato il record (e chi non è stato scollegato)");
    }
    await assertConsistent(act);
  }
  t.diagnostic(JSON.stringify(tally));
});

test("Q5 gara vera: Scollega contro il trigger dell'iscrizione annullata (5 giri)", async (t) => {
  const { boyA, boyB, boyC, boyD, boyE, boyF, admin, phone1 } = pool;
  const members = [boyA, boyB, boyC, boyD, boyE];
  const act = await newActivity({ members: [...members, boyF] });
  const r1 = await makeRecord(act, boyF, "Record della gara cinque");
  const tally = { lockTimeouts: 0 };
  for (const [round, member] of members.entries()) {
    const requestId = await seedRequest(act, phone1, { who: person(RACE_NAMES[round], "Lunari"), kind: "challenge", recordId: r1.record.id });
    await link(admin, act, requestId, `user_${member.uid}`);
    const entryId = (await requestData(act, requestId)).linkedEntryId;
    const settled = await race(
      unlink(admin, act, requestId),
      registrationDoc(act, `user_${member.uid}`).update({ registrationStatus: "cancelled" }),
    );
    tally.lockTimeouts += assertRaceClean(settled, `giro ${round}`);
    assert.equal(settled[1].status, "fulfilled", "l'annullamento dell'iscrizione è una scrittura normale");
    // Il trigger gira in coda: si attende che le invarianti tornino vere e restino tali.
    await waitFor(
      async () => {
        try {
          await assertConsistent(act);
          return (await entryData(act, entryId)).status === "withdrawn";
        } catch {
          return false;
        }
      },
      (done) => done === true,
      `invarianti dopo il trigger (giro ${round})`,
    );
    await pause(700);
    await assertConsistent(act);
    const entry = await entryData(act, entryId);
    assert.equal(entry.status, "withdrawn");
    assert.ok(["staff", "system"].includes(entry.withdrawnBy), `withdrawnBy ${entry.withdrawnBy}`);
    assert.equal(entry.statusBeforeWithdraw ?? null, null);
    if (settled[0].status === "fulfilled") assert.equal((await requestData(act, requestId)).status, "open", "lo scollegamento è riuscito");
    assert.equal((await recordData(act, r1.record.id)).challengerCount, 1, "il contatore è sceso una volta sola");
  }
  t.diagnostic(JSON.stringify(tally));
});

// ===========================================================================
// R. Più persone senza account dallo stesso telefono (spec: «Più persone dallo stesso telefono»)
// ===========================================================================
// Il telefono è la sessione anonima; la persona è il personKey. Tetti: 12 aperte per telefono, 2 per
// persona; submit è idempotente PER PERSONA (stessa persona + stesso contenuto già aperto = quella richiesta).

test("R1 due persone dallo stesso telefono propongono lo STESSO testo: due richieste; la stessa persona che ripete ottiene la sua", async () => {
  const { phone1 } = pool;
  const act = await newActivity();
  const first = await submit(phone1, act, proposalRequest(WHO.maria, { text: "Torre di bicchieri" }));
  const second = await submit(phone1, act, proposalRequest(WHO.luca, { text: "Torre di bicchieri" }));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(second.requestId, first.requestId, "persone diverse = richieste distinte, anche con lo stesso testo");
  const mine = await requestsOfPhone(act, phone1);
  assert.equal(mine.length, 2);
  assert.ok(mine.every((request) => request.status === "open" && request.proposedText === "Torre di bicchieri"));
  assert.notEqual(mine[0].personKey, mine[1].personKey);
  // La stessa persona che rimanda lo stesso foglio con un token nuovo: la sua richiesta, nessun documento.
  const again = await submit(phone1, act, proposalRequest(WHO.maria, { text: "Torre di bicchieri" }));
  assert.equal(again.requestId, first.requestId);
  assert.equal((await requestsOfPhone(act, phone1)).length, 2);
  assert.deepEqual((await mineItems(phone1, act)).map(idOf).sort(), [first.requestId, second.requestId].sort());
});

test("R2 due persone dallo stesso telefono sfidano lo STESSO record: due richieste; lo staff le collega a due iscrizioni e il contatore sale di 2", async () => {
  const { boyA, boyB, boyF, admin, phone1 } = pool;
  const act = await newActivity({ members: [boyA, boyB, boyF] });
  const r1 = await makeRecord(act, boyF, "Record sfidato in due");
  const first = await submit(phone1, act, challengeRequest(WHO.maria, r1.record.id));
  const second = await submit(phone1, act, challengeRequest(WHO.luca, r1.record.id));
  assert.notEqual(second.requestId, first.requestId);
  assert.equal((await requestsOfPhone(act, phone1)).length, 2);
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 1, "una richiesta non conta");

  await link(admin, act, first.requestId, `user_${boyA.uid}`);
  await link(admin, act, second.requestId, `user_${boyB.uid}`);
  assert.equal((await recordData(act, r1.record.id)).challengerCount, 3, "il contatore sale di 2");
  assert.equal(await stateOf(phone1, act, first.requestId), "approved");
  assert.equal(await stateOf(phone1, act, second.requestId), "approved");
  assert.equal((await entriesFromRequest(act, first.requestId)).length, 1);
  assert.equal((await entriesFromRequest(act, second.requestId)).length, 1);
  await assertConsistent(act);
  await assertMineMatchesData(phone1, act);
});

test("R3 la stessa persona che sfida due volte lo stesso record con un submissionId diverso: una sola richiesta, nessun errore anche con 12 aperte", async () => {
  const { boyF, phone1 } = pool;
  const act = await newActivity({ members: [boyF] });
  const r1 = await makeRecord(act, boyF, "Record della doppia sfida");
  const firstChallenge = await submit(phone1, act, challengeRequest(WHO.maria, r1.record.id));
  await submit(phone1, act, proposalRequest(WHO.maria, { text: "Idea di Maria" }));
  for (const who of [WHO.luca, WHO.sara, WHO.paolo, WHO.elena, WHO.marco]) {
    await submit(phone1, act, proposalRequest(who, { text: `Prima di ${who.firstName}` }));
    await submit(phone1, act, proposalRequest(who, { text: `Seconda di ${who.firstName}` }));
  }
  assert.equal((await requestsOfPhone(act, phone1)).length, 12);
  const again = await submit(phone1, act, challengeRequest(WHO.maria, r1.record.id));
  assert.equal(again.ok, true, "al tetto, ma è la stessa richiesta: nessun errore");
  assert.deepEqual(stripVolatile(again), stripVolatile(firstChallenge));
  assert.equal(again.requestId, firstChallenge.requestId);
  assert.equal((await requestsOfPhone(act, phone1)).length, 12, "nessun documento in più");
  // Un contenuto nuovo della stessa persona (già a 2) o una persona nuova trovano il tetto.
  await expectFail(submit(phone1, act, proposalRequest(WHO.maria, { text: "Una terza idea" })), "any", MAX_PHONE_MSG);
  await expectFail(submit(phone1, act, proposalRequest(WHO.giulia)), "any", MAX_PHONE_MSG);
});

test("R4 sei persone per due richieste (una proposta e una sfida) = 12; la tredicesima di un'altra persona è rifiutata col messaggio del telefono", async () => {
  const { boyF, phone1 } = pool;
  const act = await newActivity({ members: [boyF] });
  const r1 = await makeRecord(act, boyF, "Record delle sei persone");
  const people = [WHO.maria, WHO.luca, WHO.sara, WHO.paolo, WHO.elena, WHO.marco];
  for (const who of people) {
    assert.equal((await submit(phone1, act, proposalRequest(who, { text: `Idea di ${who.firstName}` }))).ok, true);
    assert.equal((await submit(phone1, act, challengeRequest(who, r1.record.id))).ok, true);
  }
  const mine = await requestsOfPhone(act, phone1);
  assert.equal(mine.length, 12);
  assert.equal(new Set(mine.map((request) => request.personKey)).size, 6);
  await expectFail(submit(phone1, act, proposalRequest(WHO.giulia)), "any", MAX_PHONE_MSG);
  await expectFail(submit(phone1, act, challengeRequest(WHO.giulia, r1.record.id)), "any", MAX_PHONE_MSG);
  await expectFail(submit(phone1, act, proposalRequest(WHO.maria, { text: "Una terza di Maria" })), "any", MAX_PHONE_MSG);
  assert.equal((await requestsOfPhone(act, phone1)).length, 12, "i rifiuti non lasciano dati");
  // Gli identici a quelli aperti passano (sono le stesse richieste).
  assert.equal((await submit(phone1, act, challengeRequest(WHO.paolo, r1.record.id))).ok, true);
  assert.equal((await requestsOfPhone(act, phone1)).length, 12);
});

for (const variant of ["ritirata", "rifiutata", "collegata"]) {
  for (const kind of ["proposal", "challenge"]) {
    test(`R5 una richiesta identica a una ${variant} (${kind}) non è un doppione: nasce una richiesta nuova`, async () => {
      const { boyA, boyF, admin, phone1 } = pool;
      const act = await newActivity({ members: [boyA, boyF] });
      const r1 = await makeRecord(act, boyF, "Record dell'identica");
      const payload = kind === "proposal" ? proposalRequest(WHO.maria, { text: "Torre di bicchieri" }) : challengeRequest(WHO.maria, r1.record.id);
      const first = await submit(phone1, act, payload);
      if (variant === "ritirata") await withdraw(phone1, act, first.requestId);
      else if (variant === "rifiutata") await rejectRequest(admin, act, first.requestId, "Non collegabile.");
      else await link(admin, act, first.requestId, `user_${boyA.uid}`);
      const expectedStatus = { ritirata: "withdrawn", rifiutata: "rejected", collegata: "linked" }[variant];
      assert.equal((await requestData(act, first.requestId)).status, expectedStatus);

      const second = await submit(phone1, act, { ...payload, submissionId: randomUUID() });
      assert.equal(second.ok, true);
      assert.notEqual(second.requestId, first.requestId, "la ritirata/rifiutata/collegata non conta come doppione");
      assert.equal((await requestData(act, second.requestId)).status, "open");
      assert.equal((await requestData(act, first.requestId)).status, expectedStatus, "la vecchia resta com'era");
      assert.equal((await requestsOfPhone(act, phone1)).length, 2);
      // Ora che quella nuova è aperta, un terzo invio identico è proprio quella.
      const third = await submit(phone1, act, { ...payload, submissionId: randomUUID() });
      assert.equal(third.requestId, second.requestId);
      assert.equal((await requestsOfPhone(act, phone1)).length, 2);
      await assertConsistent(act);
    });
  }
}

test("R6 a finestra chiusa, a interruttore spento o con la scadenza già passata un invio identico a uno aperto dà ancora l'errore di finestra o interruttore", async () => {
  const { phone1 } = pool;
  const act = await newActivity();
  const payload = proposalRequest(WHO.maria, { text: "Torre di bicchieri" });
  const first = await submit(phone1, act, payload);
  const identical = () => ({ ...payload, submissionId: randomUUID() });
  const daysAgo = (days) => new Date(Date.now() - days * DAY).toISOString().slice(0, 10);

  // Finestra chiusa.
  await setActivity(act, { recordsCloseAt: inPast(1) });
  await expectFail(submit(phone1, act, identical()), "any", CLOSED_MSG);
  // Finestra aperta, interruttore spento.
  await setActivity(act, { recordsCloseAt: inFuture(), recordsGuestEnabled: false });
  await expectFail(submit(phone1, act, identical()), "any", CANNOT_RECEIVE_MSG);
  // Interruttore acceso, inizio + 7 giorni già passato (la richiesta non nascerebbe).
  await setActivity(act, { recordsGuestEnabled: true, startDate: daysAgo(10) });
  await expectFail(submit(phone1, act, identical()), "any", CLOSED_MSG);
  assert.equal((await requestsOfPhone(act, phone1)).length, 1, "nessun documento in più");
  // Tutto a posto: l'identico torna a essere la stessa richiesta.
  await setActivity(act, { startDate: TRIP_DATE });
  assert.equal((await submit(phone1, act, identical())).requestId, first.requestId);
  assert.equal((await requestsOfPhone(act, phone1)).length, 1);
});

test("R7 mine mostra le richieste di entrambe le persone del telefono con stati indipendenti; il ritiro di una non tocca l'altra", async () => {
  const { boyA, boyF, admin, phone1 } = pool;
  const act = await newActivity({ members: [boyA, boyF] });
  const maria = (await submit(phone1, act, proposalRequest(WHO.maria, { text: "Idea di Maria" }))).requestId;
  const luca = (await submit(phone1, act, proposalRequest(WHO.luca, { text: "Idea di Luca" }))).requestId;
  const states = async () => {
    const items = await mineById(phone1, act);
    return { maria: items.get(maria)?.state, luca: items.get(luca)?.state, count: items.size };
  };
  assert.deepEqual(await states(), { maria: "received", luca: "received", count: 2 });
  const names = JSON.stringify(await mineItems(phone1, act));
  assert.ok(names.includes("Maria") && names.includes("Luca"), "chi usa il telefono vede le richieste di entrambe");

  await withdraw(phone1, act, maria);
  assert.deepEqual(await states(), { maria: "withdrawn", luca: "received", count: 2 });
  assert.equal((await requestData(act, luca)).status, "open", "il ritiro di una non tocca l'altra");
  await link(admin, act, luca, `user_${boyA.uid}`);
  assert.deepEqual(await states(), { maria: "withdrawn", luca: "pending", count: 2 });
  await restore(phone1, act, maria);
  assert.deepEqual(await states(), { maria: "received", luca: "pending", count: 2 });
  await rejectRequest(admin, act, maria, "Non collegabile.");
  assert.deepEqual(await states(), { maria: "not_linked", luca: "pending", count: 2 });
  // Il ritiro di una richiesta collegata resta impossibile dal telefono, senza toccare l'altra.
  await expectFail(withdraw(phone1, act, luca), "any");
  assert.deepEqual(await states(), { maria: "not_linked", luca: "pending", count: 2 });
  await assertMineMatchesData(phone1, act);
  await assertConsistent(act);
});
