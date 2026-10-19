// Guardia adulto nella fase 5 del flusso genitore (docs/FLUSSO_GENITORE.md, G,
// D, "Account già esistente o sbagliato" e "Chi vede, chi scrive"): prova che
// le scritture del profilo che la guardia può far partire passano con le rules
// di oggi, senza una rule nuova, e che quelle che darebbero poteri o toccherebbero
// altri profili no. La guardia è solo lato client: un avviso, non un permesso.
//
// Le chiamate sono quelle di src/services/firestore/usersService.ts, campo per
// campo, con l'SDK client e utenti normali autenticati (token mock
// dell'emulatore): updateProfile (D-io, anche con il campo opzionale `role`
// che il client aggiunge solo se il profilo è `parent`) e updateParentProfile
// (D-genitore). Prima di ogni scrittura si fanno anche le letture del client
// (profilo, unità attive, palo), così una lettura negata si vede. L'Admin SDK
// serve solo per seminare palo e unità e per rileggere i documenti: ignora le
// rules.
//
// Casi della guardia (ognuno con il suo account):
// - «Partecipo come dirigente o accompagnatore» da un partecipante completo
//   (G): updateProfile con la categoria nuova, stessa unità, ruolo invariato;
// - «Ho sbagliato la data»: updateProfile con la data corretta;
// - «Confermo, partecipo io come giovane»: updateProfile con la data da adulto
//   e la categoria dei giovani, che le rules lasciano passare;
// - «Iscrivo mio figlio o mia figlia» da un account appena creato (G in D):
//   updateParentProfile, ruolo `parent`;
// - genitore senza figli che sceglie «Partecipo io» (tabella «Account già
//   esistente»): updateProfile con `role: "participant"`, anche con la
//   categoria dirigente scelta dalla guardia, e con un figlio già salvato.
//
// Già provati in functions/tests/accountTypeRulesEmulator.test.mjs, qui non
// ripetuti: «D-io da genitore completo (tabella «Account già esistente»):
// diventa participant, il comune resta» (parent completo → participant con
// updateProfile e `role`), «D-genitore da participant», «D-io da parent appena
// creato», i tentativi di promozione col solo `role` e il dirigente di unità
// che non cambia ruolo né unità.
//
// Rilancio dalla radice del repository (solo Firestore):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --only firestore --config firebase.room-test.json --project demo-adult-guard \
//     'node --test --test-concurrency=1 functions/tests/adultGuardRulesEmulator.test.mjs'
// Con le porte occupate da un'altra sessione non fermarla: copia la config su
// porte diverse (anche hub, logging e websocket di Firestore) in un file
// temporaneo e rimuovilo a fine prova; il test legge l'host da FIRESTORE_EMULATOR_HOST.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { deleteApp, initializeApp } from "firebase/app";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  getFirestore,
  query,
  setDoc,
  updateDoc,
  where,
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
const stakeId = `adult-guard-${runId}`;
const SEEDED_AT = "2026-10-01T08:00:00.000Z";

const STAKE = { name: "Palo di Prova", slug: `palo-prova-${runId}`, isActive: true };
const UNITS = {
  "unita-1": { name: "Unità Uno", type: "ward", isActive: true },
  "unita-2": { name: "Unità Due", type: "branch", isActive: true },
};

const clients = new Map();
const seededUids = new Set();

// ---------------------------------------------------------------------------
// Utenti: ogni caso ha il suo uid, quindi i test non dipendono l'uno dall'altro
// ---------------------------------------------------------------------------

let counter = 0;
/** Un utente normale autenticato (email o Google), con il suo client SDK. */
function newActor(label, { provider = "password", displayName = "" } = {}) {
  counter += 1;
  const uid = `${label}-${counter}-${runId}`;
  const email = `${label}-${counter}-${runId}@example.invalid`;
  const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT }, uid);
  const firestore = getFirestore(app);
  connectFirestoreEmulator(firestore, emulatorHost, Number(emulatorPort), {
    mockUserToken: {
      sub: uid,
      email,
      email_verified: true,
      firebase: { sign_in_provider: provider },
    },
  });
  const actor = { uid, email, displayName, firestore, app };
  clients.set(uid, actor);
  seededUids.add(uid);
  return actor;
}

const nowIso = () => new Date().toISOString();
const userRef = (actor) => doc(actor.firestore, "users", actor.uid);
const stored = async (uid) => (await adminDb.doc(`users/${uid}`).get()).data();

// Stesse funzioni di usersService.ts (splitFullName, buildDisplayName).
function splitFullName(value) {
  const trimmed = value.trim();
  if (!trimmed) return { firstName: "", lastName: "" };
  const parts = trimmed.split(/\s+/);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}
const buildDisplayName = (actor) => actor.displayName.trim() || actor.email.split("@")[0] || "";

/** sanitizeRole di mapUserProfile. */
function sanitizeRole(value) {
  return ["admin", "super_admin", "unit_leader", "parent"].includes(value) ? value : "participant";
}

/** stakesService.getStakeById, letto come lo legge il client. */
async function readStake(actor) {
  const snapshot = await getDoc(doc(actor.firestore, "stakes", stakeId));
  assert.ok(snapshot.exists(), "palo seminato");
  const data = snapshot.data();
  return { id: snapshot.id, slug: data.slug, name: data.name };
}

/** organizationService.assertManagedUnit: unità attive del palo, per nome. */
async function readManagedUnit(actor, unitName) {
  const snapshot = await getDocs(
    query(collection(actor.firestore, "stakes", stakeId, "units"), where("isActive", "==", true)),
  );
  assert.ok(snapshot.size > 0, "unità attive leggibili dal client");
  const normalized = unitName.trim().toLocaleLowerCase("it-IT");
  const match = snapshot.docs.find(
    (item) => item.data().name.toLocaleLowerCase("it-IT") === normalized && item.data().isActive,
  );
  assert.ok(match, `unità ${unitName} configurata`);
  return { id: match.id, name: match.data().name };
}

/** Profilo letto dal client (getDoc + mapUserProfile, solo i campi che servono). */
async function readOwnProfile(actor) {
  const snapshot = await getDoc(userRef(actor));
  assert.ok(snapshot.exists(), "profilo esistente");
  const data = snapshot.data();
  return { ...data, role: sanitizeRole(data.role), unitId: typeof data.unitId === "string" ? data.unitId : "" };
}

// ---------------------------------------------------------------------------
// Le scritture del client, campo per campo
// ---------------------------------------------------------------------------

/** ensureProfileForUser, ramo "non esiste": il profilo nasce participant. */
async function createOwnProfile(actor, role = "participant") {
  const before = await getDoc(userRef(actor));
  assert.equal(before.exists(), false, "profilo ancora da creare");
  const stake = await readStake(actor);
  const displayName = buildDisplayName(actor);
  const names = splitFullName(displayName);
  const lastLoginAt = nowIso();
  const payload = {
    firstName: names.firstName,
    lastName: names.lastName,
    fullName: displayName,
    email: actor.email,
    phone: "",
    role,
    city: "",
    birthDate: "",
    genderRoleCategory: "",
    unitId: "",
    unitName: "",
    stakeId: stake?.id || "",
    stakeSlug: stake?.slug || "",
    stakeName: stake?.name || "",
    mustChangePassword: false,
    createdAt: lastLoginAt,
    updatedAt: lastLoginAt,
    lastLoginAt,
  };
  await setDoc(userRef(actor), payload);
  return payload;
}

/** setOwnAccountType: solo ruolo e updatedAt. */
async function setOwnAccountType(actor, role) {
  await updateDoc(userRef(actor), { role, updatedAt: nowIso() });
}

/**
 * updateParentProfile ("I tuoi dati" del genitore, D-genitore). `targetUid`
 * serve solo ai casi negativi: stesso payload, ma sul profilo di un altro.
 */
async function updateParentProfile(actor, input, { targetUid } = {}) {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const city = input.city.trim();
  const unitName = input.unitName.trim();
  await readOwnProfile(actor);
  const matchedUnit = await readManagedUnit(actor, unitName);
  const stake = await readStake(actor);
  const reference = targetUid ? doc(actor.firestore, "users", targetUid) : userRef(actor);
  return updateDoc(reference, {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    role: "parent",
    city,
    unitId: matchedUnit?.id ?? "",
    unitName: matchedUnit?.name ?? unitName,
    stakeId: input.stakeId,
    stakeSlug: stake?.slug ?? "",
    stakeName: stake?.name ?? "",
    birthDate: "",
    genderRoleCategory: "",
    updatedAt: nowIso(),
    lastLoginAt: nowIso(),
  });
}

/**
 * updateProfile ("I tuoi dati", D-io). Il ruolo `participant` va nella stessa
 * scrittura solo se il profilo attuale è `parent` (condizione del client).
 * `forceRole` e `targetUid` servono solo ai casi negativi: un client manomesso
 * che aggiunge un ruolo, o che scrive il profilo di un altro.
 */
async function updateProfile(actor, input, { forceRole, targetUid } = {}) {
  const currentProfile = await readOwnProfile(actor);
  const normalizedUnitName = input.unitName.trim();
  const matchedUnit = normalizedUnitName ? await readManagedUnit(actor, normalizedUnitName) : null;
  const stake = await readStake(actor);
  const fullName = `${input.firstName.trim()} ${input.lastName.trim()}`.trim();
  const reference = targetUid ? doc(actor.firestore, "users", targetUid) : userRef(actor);
  return updateDoc(reference, {
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    fullName,
    unitId: matchedUnit?.id ?? currentProfile.unitId,
    unitName: normalizedUnitName,
    birthDate: input.birthDate,
    genderRoleCategory: input.genderRoleCategory,
    stakeId: input.stakeId,
    stakeSlug: stake?.slug ?? "",
    ...(input.role && currentProfile.role === "parent" ? { role: input.role } : {}),
    ...(forceRole ? { role: forceRole } : {}),
    updatedAt: nowIso(),
    lastLoginAt: nowIso(),
  });
}

async function expectDenied(promise, uid, before) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, "permission-denied", `${error?.code}: ${error?.message}`);
    return true;
  });
  // Un'operazione negata non lascia traccia.
  assert.deepEqual(await stored(uid), before);
}

// Figli: childrenService.createChild / updateChild (payload di buildPayload).
const childrenCollection = (actor) => collection(actor.firestore, "users", actor.uid, "children");

function buildChildPayload(input) {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    birthDate: input.birthDate,
    genderRoleCategory: input.genderRoleCategory,
    unitId: input.unitId,
    unitName: input.unitName.trim(),
    stakeId: input.stakeId,
  };
}

async function createChild(actor, input) {
  const reference = doc(childrenCollection(actor));
  const timestamp = nowIso();
  const payload = { ...buildChildPayload(input), createdAt: timestamp, updatedAt: timestamp };
  await setDoc(reference, payload);
  return { id: reference.id, ...payload };
}

const CHILD_INPUT = {
  firstName: "Giulia",
  lastName: "Rossi",
  birthDate: "2012-05-09",
  genderRoleCategory: "giovane_donna",
  unitId: "unita-1",
  unitName: "Unità Uno",
  stakeId,
};

// Dati che la persona scrive in D.
const PARENT_INPUT = { firstName: "Paola", lastName: "Rossi", unitName: "Unità Uno", city: "Roma", stakeId };
// Giovane Uomo, nato nel 1980 (il caso della spec: «Il 24 aprile 2027 avrai 47 anni»).
const GU_INPUT = {
  firstName: "Marco",
  lastName: "Bianchi",
  unitName: "Unità Uno",
  birthDate: "1980-04-24",
  genderRoleCategory: "giovane_uomo",
  stakeId,
};

/** Partecipante col profilo completo (GU, 1980), come lo vede la guardia in cima al modulo. */
async function seedCompleteParticipant(label = "partecipante") {
  const actor = newActor(label, { displayName: "Marco Bianchi" });
  await createOwnProfile(actor);
  await updateProfile(actor, GU_INPUT);
  return actor;
}

/** Account da genitore col profilo completo (nome, unità, comune), senza figli. */
async function seedCompleteParent(label = "genitore") {
  const actor = newActor(label, { displayName: "Paola Rossi" });
  await createOwnProfile(actor);
  await setOwnAccountType(actor, "parent");
  await updateParentProfile(actor, PARENT_INPUT);
  return actor;
}

/** Cambia solo ciò che deve: il resto del documento, tranne gli orari, resta uguale. */
function assertOnlyChanged(before, after, changedKeys, label) {
  const ignored = new Set(["updatedAt", "lastLoginAt", ...changedKeys]);
  const pick = (data) => Object.fromEntries(Object.entries(data).filter(([key]) => !ignored.has(key)));
  assert.deepEqual(pick(after), pick(before), label);
  assert.ok(after.updatedAt >= before.updatedAt, `${label}: updatedAt non indietro`);
}

before(async () => {
  await adminDb.doc(`stakes/${stakeId}`).set({ ...STAKE, createdAt: SEEDED_AT, updatedAt: SEEDED_AT });
  await Promise.all(
    Object.entries(UNITS).map(([unitId, unit]) =>
      adminDb.doc(`stakes/${stakeId}/units/${unitId}`).set({ ...unit, stakeId, createdAt: SEEDED_AT, updatedAt: SEEDED_AT }),
    ),
  );
});

after(async () => {
  try {
    await adminDb.recursiveDelete(adminDb.doc(`stakes/${stakeId}`));
    for (const uid of seededUids) {
      await adminDb.recursiveDelete(adminDb.doc(`users/${uid}`));
    }
  } finally {
    await Promise.all([...clients.values()].map(({ app }) => deleteApp(app)));
    await adminDb.terminate();
  }
});

// ===========================================================================
// G in cima al modulo: partecipante completo (GU, nato nel 1980)
// ===========================================================================

test("G «Partecipo come dirigente o accompagnatore»: updateProfile con la categoria nuova e la stessa unità, consentito, il ruolo resta participant", async () => {
  for (const genderRoleCategory of ["dirigente", "accompagnatore"]) {
    const actor = await seedCompleteParticipant(`guardia-${genderRoleCategory}`);
    const before = await stored(actor.uid);
    assert.equal(before.role, "participant");
    assert.equal(before.genderRoleCategory, "giovane_uomo");
    assert.equal(before.birthDate, "1980-04-24");

    await updateProfile(actor, { ...GU_INPUT, genderRoleCategory });

    const after = await stored(actor.uid);
    assert.equal(after.role, "participant", `${genderRoleCategory}: il ruolo non cambia`);
    assert.equal(after.genderRoleCategory, genderRoleCategory);
    assert.equal(after.unitId, "unita-1", "stessa unità");
    assert.equal(after.unitName, "Unità Uno");
    assert.equal(after.birthDate, "1980-04-24");
    assert.equal(after.createdAt, before.createdAt);
    assertOnlyChanged(before, after, ["genderRoleCategory"], genderRoleCategory);
    // Lo legge anche il client, come lo rilegge la pagina (getProfile).
    assert.equal((await readOwnProfile(actor)).role, "participant");
  }
});

test("G «Ho sbagliato la data»: updateProfile con la data corretta, consentito, il resto resta com'è", async () => {
  const actor = await seedCompleteParticipant("guardia-data");
  const before = await stored(actor.uid);

  await updateProfile(actor, { ...GU_INPUT, birthDate: "2010-04-24" });

  const after = await stored(actor.uid);
  assert.equal(after.birthDate, "2010-04-24");
  assert.equal(after.role, "participant");
  assert.equal(after.genderRoleCategory, "giovane_uomo");
  assert.equal(after.unitId, "unita-1");
  assertOnlyChanged(before, after, ["birthDate"], "data corretta");
});

test("G «Ho sbagliato la data» e poi «Partecipo come dirigente»: due scritture di fila, consentite", async () => {
  // La guardia riapre D (passo=dati con editOwnData), la persona corregge la
  // data, la guardia scatta di nuovo e sceglie dirigente: due updateProfile.
  const actor = await seedCompleteParticipant("guardia-doppia");
  await updateProfile(actor, { ...GU_INPUT, birthDate: "1979-04-24" });
  await updateProfile(actor, { ...GU_INPUT, birthDate: "1979-04-24", genderRoleCategory: "dirigente" });

  const after = await stored(actor.uid);
  assert.equal(after.role, "participant");
  assert.equal(after.birthDate, "1979-04-24");
  assert.equal(after.genderRoleCategory, "dirigente");
});

test("G «Confermo, partecipo io come giovane»: nessuna rule guarda l'età, la guardia è solo del client", async () => {
  // Account appena creato: a D arriva con la data da adulto e la categoria dei
  // giovani; il link «Confermo» prosegue e il «Continua» finale salva così.
  const actor = newActor("guardia-conferma", { displayName: "Marco Bianchi" });
  await createOwnProfile(actor);

  await updateProfile(actor, GU_INPUT);

  const after = await stored(actor.uid);
  assert.equal(after.role, "participant");
  assert.equal(after.birthDate, "1980-04-24");
  assert.equal(after.genderRoleCategory, "giovane_uomo");
  assert.equal(after.unitId, "unita-1");
});

test("G «Partecipo come dirigente» non dà poteri: il profilo degli altri resta illeggibile", async () => {
  // La categoria la scrive chiunque nel proprio profilo (rules: «Non conta
  // genderRoleCategory»): scegliere dirigente non apre le letture del palo.
  const actor = await seedCompleteParticipant("guardia-poteri");
  await updateProfile(actor, { ...GU_INPUT, genderRoleCategory: "dirigente" });
  const other = await seedCompleteParticipant("guardia-altro");
  const otherBefore = await stored(other.uid);

  await assert.rejects(getDocFromServer(doc(actor.firestore, "users", other.uid)), (error) => {
    assert.equal(error?.code, "permission-denied", `${error?.code}: ${error?.message}`);
    return true;
  });
  await assert.rejects(
    getDocsFromServer(query(collection(actor.firestore, "users"), where("stakeId", "==", stakeId))),
    (error) => {
      assert.equal(error?.code, "permission-denied", `${error?.code}: ${error?.message}`);
      return true;
    },
  );
  assert.deepEqual(await stored(other.uid), otherBefore);
  // Il proprio profilo si legge, e dice participant.
  assert.equal((await getDocFromServer(userRef(actor))).data().role, "participant");
});

// ===========================================================================
// G in D: account appena creato, «Iscrivo mio figlio o mia figlia»
// ===========================================================================

test("G in D «Iscrivo mio figlio»: da un account appena creato, updateParentProfile, consentito, ruolo parent (come «D-genitore da participant»)", async () => {
  // La persona ha scritto la data in D e la guardia ha scattato: finché non
  // preme «Continua» niente è salvato (spec, D), quindi il profilo è ancora
  // quello creato all'accesso, e la prima scrittura è quella da genitore.
  const actor = newActor("guardia-figlio", { displayName: "Paola Rossi", provider: "google.com" });
  const created = await createOwnProfile(actor);
  assert.deepEqual(await stored(actor.uid), created);

  await updateParentProfile(actor, PARENT_INPUT);

  const after = await stored(actor.uid);
  assert.equal(after.role, "parent");
  assert.equal(after.fullName, "Paola Rossi");
  assert.equal(after.city, "Roma");
  assert.equal(after.unitId, "unita-1");
  // La data da adulto che ha fatto scattare la guardia non è mai arrivata nel documento.
  assert.equal(after.birthDate, "");
  assert.equal(after.genderRoleCategory, "");
  assert.equal(after.createdAt, created.createdAt);
  assert.equal((await readOwnProfile(actor)).role, "parent");
});

// ===========================================================================
// Genitore che sceglie «Partecipo io» (tabella «Account già esistente»)
// ===========================================================================

test("genitore senza figli «Partecipo io» e poi dirigente dalla guardia: una scrittura, role participant e categoria dirigente", async () => {
  // parent completo → D-io (nome e cognome già scritti) → data da adulto →
  // guardia → «Partecipo come dirigente» → «Continua»: un solo updateProfile
  // con `role: "participant"`, che il client aggiunge perché il profilo è parent.
  const actor = await seedCompleteParent("genitore-dirigente");
  const before = await stored(actor.uid);
  assert.equal(before.role, "parent");
  assert.equal(before.city, "Roma");

  await updateProfile(actor, {
    firstName: "Paola",
    lastName: "Rossi",
    unitName: "Unità Uno",
    birthDate: "1982-06-01",
    genderRoleCategory: "dirigente",
    stakeId,
    role: "participant",
  });

  const after = await stored(actor.uid);
  assert.equal(after.role, "participant", "diventa participant, non unit_leader");
  assert.equal(after.genderRoleCategory, "dirigente");
  assert.equal(after.birthDate, "1982-06-01");
  assert.equal(after.city, "Roma", "il comune resta");
  assert.equal(after.unitId, "unita-1");
  assertOnlyChanged(before, after, ["role", "genderRoleCategory", "birthDate"], "parent → participant");
});

test("genitore «Partecipo io» con un figlio già salvato: diventa participant e il figlio resta (spec: «i figli restano»)", async () => {
  // Oggi il client manda questo genitore alla scheda «solo-figli»; la fase 6
  // lo porta a D-io. Le rules devono già permetterlo e non toccare i figli.
  const actor = await seedCompleteParent("genitore-con-figlio");
  const child = await createChild(actor, CHILD_INPUT);
  const childBefore = (await adminDb.doc(`users/${actor.uid}/children/${child.id}`).get()).data();
  assert.ok(childBefore, "figlio salvato");

  await updateProfile(actor, {
    firstName: "Paola",
    lastName: "Rossi",
    unitName: "Unità Uno",
    birthDate: "1982-06-01",
    genderRoleCategory: "accompagnatore",
    stakeId,
    role: "participant",
  });

  assert.equal((await stored(actor.uid)).role, "participant");
  // Il figlio è ancora lì, uguale, e il titolare lo legge, lo elenca e lo modifica.
  assert.deepEqual((await adminDb.doc(`users/${actor.uid}/children/${child.id}`).get()).data(), childBefore);
  const listed = await getDocsFromServer(childrenCollection(actor));
  assert.deepEqual(
    listed.docs.map((item) => item.id),
    [child.id],
  );
  await updateDoc(doc(childrenCollection(actor), child.id), {
    ...buildChildPayload({ ...CHILD_INPUT, firstName: "Giulietta" }),
    updatedAt: nowIso(),
  });
  assert.equal((await adminDb.doc(`users/${actor.uid}/children/${child.id}`).get()).data().firstName, "Giulietta");
  // E può aggiungerne un altro: la famiglia non dipende dal ruolo (G2).
  await createChild(actor, { ...CHILD_INPUT, firstName: "Pietro", genderRoleCategory: "giovane_uomo" });
  assert.equal((await getDocsFromServer(childrenCollection(actor))).size, 2);
});

// ===========================================================================
// Negativi: nessuna promozione dalla guardia, nessuna scrittura sul profilo di altri
// ===========================================================================

test("partecipante completo: il payload della guardia con role unit_leader, admin o super_admin, negato", async () => {
  const actor = await seedCompleteParticipant("negato-participant");
  const before = await stored(actor.uid);

  for (const forceRole of ["unit_leader", "admin", "super_admin"]) {
    // «Partecipo come dirigente» manomesso: la categoria più un ruolo da staff.
    await expectDenied(
      updateProfile(actor, { ...GU_INPUT, genderRoleCategory: "dirigente" }, { forceRole }),
      actor.uid,
      before,
    );
    // E «Ho sbagliato la data» manomesso.
    await expectDenied(updateProfile(actor, { ...GU_INPUT, birthDate: "2010-04-24" }, { forceRole }), actor.uid, before);
  }
  // Controllo: lo stesso payload senza il ruolo extra passa, quindi il rifiuto viene dal ruolo.
  await updateProfile(actor, { ...GU_INPUT, genderRoleCategory: "dirigente" });
  assert.equal((await stored(actor.uid)).role, "participant");
});

test("genitore completo: «Partecipo io» con role unit_leader, admin o super_admin, negato", async () => {
  const actor = await seedCompleteParent("negato-genitore");
  const before = await stored(actor.uid);
  const input = {
    firstName: "Paola",
    lastName: "Rossi",
    unitName: "Unità Uno",
    birthDate: "1982-06-01",
    genderRoleCategory: "dirigente",
    stakeId,
  };

  for (const forceRole of ["unit_leader", "admin", "super_admin"]) {
    await expectDenied(updateProfile(actor, { ...input, role: "participant" }, { forceRole }), actor.uid, before);
  }
  // Controllo: con `participant`, il ruolo vero del client, passa.
  await updateProfile(actor, { ...input, role: "participant" });
  assert.equal((await stored(actor.uid)).role, "participant");
});

test("account appena creato: la scrittura della guardia con un ruolo da staff, negata", async () => {
  const actor = newActor("negato-nuovo", { displayName: "Marco Bianchi" });
  const created = await createOwnProfile(actor);
  for (const forceRole of ["unit_leader", "admin"]) {
    await expectDenied(updateProfile(actor, GU_INPUT, { forceRole }), actor.uid, created);
  }
});

test("partecipante: le scritture della guardia sul profilo di un altro uid, negate", async () => {
  const actor = await seedCompleteParticipant("negato-attore");
  const other = await seedCompleteParticipant("negato-vittima");
  const actorBefore = await stored(actor.uid);
  const otherBefore = await stored(other.uid);

  const attempts = [
    ["«Partecipo come dirigente»", () => updateProfile(actor, { ...GU_INPUT, genderRoleCategory: "dirigente" }, { targetUid: other.uid })],
    ["«Ho sbagliato la data»", () => updateProfile(actor, { ...GU_INPUT, birthDate: "2010-04-24" }, { targetUid: other.uid })],
    ["«Partecipo io» con role participant", () => updateProfile(actor, GU_INPUT, { forceRole: "participant", targetUid: other.uid })],
    ["«Iscrivo mio figlio» (updateParentProfile)", () => updateParentProfile(actor, PARENT_INPUT, { targetUid: other.uid })],
  ];

  for (const [label, attempt] of attempts) {
    await assert.rejects(attempt(), (error) => {
      assert.equal(error?.code, "permission-denied", `${label}: ${error?.code}: ${error?.message}`);
      return true;
    });
    assert.deepEqual(await stored(other.uid), otherBefore, label);
    assert.deepEqual(await stored(actor.uid), actorBefore, label);
  }
});

test("genitore: «Partecipo io» sul profilo di un altro uid, negato", async () => {
  const actor = await seedCompleteParent("negato-genitore-attore");
  const other = await seedCompleteParent("negato-genitore-vittima");
  const actorBefore = await stored(actor.uid);
  const otherBefore = await stored(other.uid);

  await expectDenied(
    updateProfile(
      actor,
      { ...GU_INPUT, genderRoleCategory: "dirigente", role: "participant" },
      { targetUid: other.uid },
    ),
    other.uid,
    otherBefore,
  );
  assert.deepEqual(await stored(actor.uid), actorBefore);
});

test("creare il profilo di un altro uid con la scrittura della guardia, negato", async () => {
  const actor = await seedCompleteParticipant("negato-creazione");
  const strangerUid = `senza-profilo-${runId}`;
  seededUids.add(strangerUid);
  const stake = await readStake(actor);
  const lastLoginAt = nowIso();

  await expectDenied(
    setDoc(doc(actor.firestore, "users", strangerUid), {
      firstName: "Marco",
      lastName: "Bianchi",
      fullName: "Marco Bianchi",
      email: actor.email,
      phone: "",
      role: "participant",
      city: "",
      birthDate: "1980-04-24",
      genderRoleCategory: "dirigente",
      unitId: "unita-1",
      unitName: "Unità Uno",
      stakeId: stake.id,
      stakeSlug: stake.slug,
      stakeName: stake.name,
      mustChangePassword: false,
      createdAt: lastLoginAt,
      updatedAt: lastLoginAt,
      lastLoginAt,
    }),
    strangerUid,
    undefined,
  );
});
