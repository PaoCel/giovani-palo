// Tipo di account e profilo nella fase 3 del flusso genitore
// (docs/FLUSSO_GENITORE.md, C, D, "Account già esistente o sbagliato" e
// "Chi vede, chi scrive"): prova che le scritture del profilo della fase 3
// passano con le rules di oggi, senza una rule nuova, e che i ruoli
// privilegiati restano fuori portata.
//
// Le chiamate sono quelle di src/services/firestore/usersService.ts, campo per
// campo, con l'SDK client e utenti normali autenticati (token mock
// dell'emulatore): ensureProfileForUser (ramo "non esiste" e ramo "esiste"),
// setOwnAccountType, updateParentProfile e updateProfile con il campo
// opzionale `role`. Prima di ogni scrittura si fanno anche le letture del
// client (profilo, unità attive, palo), così una lettura negata si vede.
// L'Admin SDK serve solo per seminare palo, unità e il profilo del dirigente,
// e per rileggere i documenti: ignora le rules.
//
// Gara all'accesso (collaudo 2026-10-19): partono due ensureProfileForUser
// (accesso e osservatore della sessione) e il ramo "esiste" riscriveva il
// ruolo letto prima di setOwnAccountType(parent), rimettendo `participant`.
// Ora quel ramo scrive `role` e `mustChangePassword` solo se mancano: qui il
// payload nuovo, quello vecchio per confronto e i documenti vecchi.
//
// Rilancio dalla radice del repository (solo Firestore):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --only firestore --config firebase.room-test.json --project demo-account-type \
//     'node --test --test-concurrency=1 functions/tests/accountTypeRulesEmulator.test.mjs'
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
  getDocs,
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
const stakeId = `account-type-${runId}`;
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

/**
 * ensureProfileForUser, ramo "non esiste": letture del client, poi il payload
 * di setDoc. Il ruolo è sempre "participant" nel client; qui si può forzare
 * per provare cosa accettano le rules.
 */
async function prepareNewProfile(actor, role = "participant") {
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
  return { ref: userRef(actor), payload };
}

async function createOwnProfile(actor, role = "participant") {
  const { ref, payload } = await prepareNewProfile(actor, role);
  await setDoc(ref, payload);
  return payload;
}

const GENDER_ROLE_CATEGORIES = ["giovane_uomo", "giovane_donna", "dirigente", "accompagnatore"];
const GENDER_LABELS = {
  "Giovani Uomini": "giovane_uomo",
  "Giovani Donne": "giovane_donna",
  Dirigente: "dirigente",
  Accompagnatore: "accompagnatore",
};
const str = (value) => (typeof value === "string" ? value : "");

/** mapUserProfile di usersService.ts, campi usati dal ramo "esiste". */
function mapUserProfile(data) {
  const fullName = str(data.fullName).trim();
  const names = splitFullName(fullName);
  const rawGender = typeof data.genderRoleCategory === "string" ? data.genderRoleCategory : str(data.youthGroup);
  return {
    firstName: str(data.firstName).trim() || names.firstName,
    lastName: str(data.lastName).trim() || names.lastName,
    fullName,
    email: typeof data.email === "string" ? data.email : null,
    phone: str(data.phone),
    role: sanitizeRole(data.role),
    city: str(data.city),
    birthDate: str(data.birthDate),
    genderRoleCategory: GENDER_ROLE_CATEGORIES.includes(rawGender) ? rawGender : GENDER_LABELS[rawGender] ?? "",
    unitId: str(data.unitId),
    unitName: str(data.unitName),
    stakeId: str(data.stakeId),
    stakeSlug: str(data.stakeSlug),
    stakeName: str(data.stakeName),
    mustChangePassword: Boolean(data.mustChangePassword),
    createdAt: typeof data.createdAt === "string" ? data.createdAt : nowIso(),
  };
}

/**
 * Payload di ensureProfileForUser, ramo "esiste" (setDoc merge a ogni accesso),
 * costruito dai dati letti in `storedData`.
 * - payload nuovo (default): `role` e `mustChangePassword` solo se mancano
 *   nel documento letto (documenti vecchi);
 * - `legacy: true`: il payload di prima della correzione, che li riscriveva
 *   sempre col valore letto.
 */
function existingBranchPayload(actor, storedData, { legacy = false } = {}) {
  const profile = mapUserProfile(storedData);
  const fullName = profile.fullName || buildDisplayName(actor);
  const names = splitFullName(fullName);
  const lastLoginAt = nowIso();
  return {
    firstName: profile.firstName || names.firstName,
    lastName: profile.lastName || names.lastName,
    fullName,
    email: actor.email ?? profile.email,
    phone: profile.phone,
    ...(!legacy && typeof storedData.role === "string" ? {} : { role: profile.role }),
    city: profile.city,
    birthDate: profile.birthDate,
    genderRoleCategory: profile.genderRoleCategory,
    unitId: profile.unitId,
    unitName: profile.unitName,
    stakeId: profile.stakeId,
    stakeSlug: profile.stakeSlug,
    stakeName: profile.stakeName,
    ...(!legacy && typeof storedData.mustChangePassword === "boolean"
      ? {}
      : { mustChangePassword: profile.mustChangePassword }),
    createdAt: profile.createdAt,
    updatedAt: lastLoginAt,
    lastLoginAt,
  };
}

/** Lettura del client (getDoc) e scrittura del ramo "esiste". */
async function readForExistingBranch(actor) {
  const snapshot = await getDoc(userRef(actor));
  assert.ok(snapshot.exists(), "profilo esistente");
  return snapshot.data();
}

async function ensureExistingProfile(actor, options) {
  const storedData = await readForExistingBranch(actor);
  const payload = existingBranchPayload(actor, storedData, options);
  await setDoc(userRef(actor), payload, { merge: true });
  return payload;
}

/** setOwnAccountType: solo ruolo e updatedAt, poi getProfile. */
async function setOwnAccountType(actor, role) {
  await updateDoc(userRef(actor), { role, updatedAt: nowIso() });
  return readOwnProfile(actor);
}

/**
 * updateParentProfile ("I tuoi dati" del genitore, D-genitore). `overrides`
 * serve solo ai controlli positivi (stesso payload con un campo cambiato).
 */
async function updateParentProfile(actor, input, overrides = {}) {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const city = input.city.trim();
  const unitName = input.unitName.trim();
  await readOwnProfile(actor);
  const matchedUnit = await readManagedUnit(actor, unitName);
  const stake = await readStake(actor);
  return updateDoc(userRef(actor), {
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
    ...overrides,
  });
}

/**
 * updateProfile ("I tuoi dati", D-io). Il ruolo `participant` va nella stessa
 * scrittura solo se il profilo attuale è `parent` (condizione del client).
 */
async function updateProfile(actor, input) {
  const currentProfile = await readOwnProfile(actor);
  const normalizedUnitName = input.unitName.trim();
  const matchedUnit = normalizedUnitName ? await readManagedUnit(actor, normalizedUnitName) : null;
  const stake = await readStake(actor);
  const fullName = `${input.firstName.trim()} ${input.lastName.trim()}`.trim();
  return updateDoc(userRef(actor), {
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

// Dati che la persona scrive in D.
const PARENT_INPUT = { firstName: "Paola", lastName: "Rossi", unitName: "Unità Uno", city: "Roma", stakeId };
const YOUTH_INPUT = {
  firstName: "Marco",
  lastName: "Rossi",
  unitName: "Unità Due",
  birthDate: "2011-03-14",
  genderRoleCategory: "giovane_uomo",
  stakeId,
};

/** Profilo completo con la forma reale, da seminare con l'Admin SDK. */
const seededProfile = (actor, overrides = {}) => ({
  firstName: "Luca",
  lastName: "Bianchi",
  fullName: "Luca Bianchi",
  email: actor.email,
  phone: "",
  role: "unit_leader",
  city: "",
  birthDate: "1980-04-24",
  genderRoleCategory: "dirigente",
  unitId: "unita-1",
  unitName: "Unità Uno",
  stakeId,
  stakeSlug: STAKE.slug,
  stakeName: STAKE.name,
  mustChangePassword: false,
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  lastLoginAt: SEEDED_AT,
  ...overrides,
});

/** Dirigente di unità preparato con l'Admin SDK (il ruolo lo dà un admin). */
async function seedUnitLeader(overrides = {}) {
  const actor = newActor("dirigente", { displayName: "Luca Bianchi" });
  await adminDb.doc(`users/${actor.uid}`).set(seededProfile(actor, overrides));
  return actor;
}

/** Admin del palo, preparato con l'Admin SDK. */
async function seedAdmin(overrides = {}) {
  const actor = newActor("admin", { displayName: "Anna Verdi" });
  await adminDb.doc(`users/${actor.uid}`).set(
    seededProfile(actor, {
      firstName: "Anna",
      lastName: "Verdi",
      fullName: "Anna Verdi",
      role: "admin",
      genderRoleCategory: "accompagnatore",
      ...overrides,
    }),
  );
  return actor;
}

/** Il ramo "esiste" non cambia niente oltre agli orari d'accesso. */
function assertOnlyLoginTimes(before, after, label) {
  const { updatedAt: _u1, lastLoginAt: _l1, ...restBefore } = before;
  const { updatedAt: _u2, lastLoginAt: _l2, ...restAfter } = after;
  assert.deepEqual(restAfter, restBefore, label);
  assert.ok(after.lastLoginAt > before.lastLoginAt, `${label}: lastLoginAt nuovo`);
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
// C: account nuovo
// ===========================================================================

test("C: account nuovo, il profilo nasce participant (ensureProfileForUser)", async () => {
  const actor = newActor("nuovo", { displayName: "Marco Rossi", provider: "google.com" });
  const payload = await createOwnProfile(actor);
  assert.deepEqual(await stored(actor.uid), payload);
});

test("C: stesso payload con role parent, consentito", async () => {
  const actor = newActor("nuovo-genitore");
  const payload = await createOwnProfile(actor, "parent");
  assert.equal((await stored(actor.uid)).role, "parent");
  assert.deepEqual(await stored(actor.uid), payload);
});

test("C: stesso payload con un ruolo privilegiato, negato", async () => {
  for (const role of ["unit_leader", "admin", "super_admin"]) {
    const actor = newActor(`nuovo-${role.replace("_", "-")}`);
    const { ref, payload } = await prepareNewProfile(actor, role);
    await expectDenied(setDoc(ref, payload), actor.uid, undefined);
  }
});

test("C per=figlio: dopo la creazione setOwnAccountType(parent), consentito", async () => {
  const actor = newActor("figlio-nuovo");
  const created = await createOwnProfile(actor);
  const profile = await setOwnAccountType(actor, "parent");
  assert.equal(profile.role, "parent");
  const after = await stored(actor.uid);
  assert.equal(after.role, "parent");
  // Cambiano solo ruolo e updatedAt.
  const { role: _r1, updatedAt: _u1, ...restBefore } = created;
  const { role: _r2, updatedAt: _u2, ...restAfter } = after;
  assert.deepEqual(restAfter, restBefore);
});

// ===========================================================================
// C: accesso a un account esistente (ensureProfileForUser, ramo "esiste")
// ===========================================================================

test("accesso, payload nuovo: participant, parent, unit_leader e admin restano com'erano", async () => {
  const participantActor = newActor("esistente-participant", { displayName: "Marco Rossi" });
  await createOwnProfile(participantActor);
  await updateProfile(participantActor, YOUTH_INPUT);

  const parentActor = newActor("esistente-parent");
  await createOwnProfile(parentActor);
  await setOwnAccountType(parentActor, "parent");
  await updateParentProfile(parentActor, PARENT_INPUT);

  const leader = await seedUnitLeader();
  // Admin creato con password provvisoria: il flag non si tocca entrando.
  const admin = await seedAdmin({ mustChangePassword: true });

  for (const [label, actor, role] of [
    ["participant", participantActor, "participant"],
    ["parent", parentActor, "parent"],
    ["unit_leader", leader, "unit_leader"],
    ["admin", admin, "admin"],
  ]) {
    const before = await stored(actor.uid);
    const payload = await ensureExistingProfile(actor);
    assert.equal("role" in payload, false, `${label}: role fuori dal payload`);
    assert.equal("mustChangePassword" in payload, false, `${label}: mustChangePassword fuori dal payload`);
    const after = await stored(actor.uid);
    assert.equal(after.role, role, label);
    assertOnlyLoginTimes(before, after, label);
  }
  assert.equal((await stored(admin.uid)).mustChangePassword, true);
});

test("gara all'accesso: ramo «esiste» col profilo letto prima di setOwnAccountType(parent), il ruolo resta parent", async () => {
  const actor = newActor("gara-nuovo");
  await createOwnProfile(actor);
  // Seconda ensureProfileForUser (osservatore della sessione): legge prima del cambio...
  const staleData = await readForExistingBranch(actor);
  assert.equal(staleData.role, "participant");
  // ...intanto "Iscrivo mio figlio" applica il tipo scelto...
  await setOwnAccountType(actor, "parent");
  // ...e poi scrive con i dati vecchi.
  const payload = existingBranchPayload(actor, staleData);
  assert.equal("role" in payload, false);
  await setDoc(userRef(actor), payload, { merge: true });
  assert.equal((await stored(actor.uid)).role, "parent");
  assert.equal((await readOwnProfile(actor)).role, "parent");
});

test("gara all'accesso, payload vecchio (per confronto): consentito, ma riporta il ruolo a participant", async () => {
  const actor = newActor("gara-vecchio");
  await createOwnProfile(actor);
  const staleData = await readForExistingBranch(actor);
  await setOwnAccountType(actor, "parent");
  const payload = existingBranchPayload(actor, staleData, { legacy: true });
  assert.equal(payload.role, "participant");
  // Le rules lo consentono (participant <-> parent è uno scambio permesso):
  // per questo la correzione doveva stare nel client.
  await setDoc(userRef(actor), payload, { merge: true });
  assert.equal((await stored(actor.uid)).role, "participant");
});

// Documenti vecchi senza `role` o `mustChangePassword`: in sospeso (todo).
// Il ramo "esiste" li scriverebbe (participant, false), ma le rules lo
// rifiutano: canUpdateOwnUser legge `resource.data.role` e
// `resource.data.mustChangePassword` senza `.get()`, e su un documento che non
// li ha la valutazione va in errore ("Property role is undefined on object",
// emulatore 2026-10-19). Lettura in produzione del 2026-10-19: 0 profili su 180
// senza `role`, 0 su 180 senza `mustChangePassword`, quindi oggi il caso non
// esiste. Se mai comparissero, la correzione va nelle rules (per esempio
// `resource.data.get('role', 'participant')` e
// `resource.data.get('mustChangePassword', false)` in canUpdateOwnUser), non
// nel client. I test girano lo stesso: se diventano verdi il todo si toglie.
const LEGACY_TODO =
  "rules: canUpdateOwnUser legge role/mustChangePassword senza get(); 0/180 profili senza i campi in produzione (2026-10-19)";

test("accesso con un documento vecchio senza role né mustChangePassword: li scrive (participant, false)", { todo: LEGACY_TODO }, async () => {
  const actor = newActor("vecchio-senza-campi", { displayName: "Giulia Neri" });
  const { role: _role, mustChangePassword: _flag, ...legacyDoc } = seededProfile(actor, {
    firstName: "Giulia",
    lastName: "Neri",
    fullName: "Giulia Neri",
    birthDate: "2010-09-01",
    genderRoleCategory: "giovane_donna",
  });
  await adminDb.doc(`users/${actor.uid}`).set(legacyDoc);
  const payload = await ensureExistingProfile(actor);
  assert.equal(payload.role, "participant");
  assert.equal(payload.mustChangePassword, false);
  const after = await stored(actor.uid);
  assert.equal(after.role, "participant");
  assert.equal(after.mustChangePassword, false);
});

test("accesso con un documento vecchio senza role (mustChangePassword presente): lo scrive", { todo: LEGACY_TODO }, async () => {
  const actor = newActor("vecchio-senza-role");
  const { role: _role, ...legacyDoc } = seededProfile(actor, { genderRoleCategory: "giovane_uomo", birthDate: "2010-09-01" });
  await adminDb.doc(`users/${actor.uid}`).set(legacyDoc);
  const payload = await ensureExistingProfile(actor);
  assert.equal(payload.role, "participant");
  assert.equal("mustChangePassword" in payload, false);
  assert.equal((await stored(actor.uid)).role, "participant");
});

test("accesso con un documento vecchio senza mustChangePassword (role presente): lo scrive", { todo: LEGACY_TODO }, async () => {
  const actor = newActor("vecchio-senza-flag");
  const { mustChangePassword: _flag, ...legacyDoc } = seededProfile(actor, {
    role: "participant",
    genderRoleCategory: "giovane_uomo",
    birthDate: "2010-09-01",
  });
  await adminDb.doc(`users/${actor.uid}`).set(legacyDoc);
  const payload = await ensureExistingProfile(actor);
  assert.equal("role" in payload, false);
  assert.equal(payload.mustChangePassword, false);
  assert.equal((await stored(actor.uid)).mustChangePassword, false);
});

// ===========================================================================
// D: i tuoi dati
// ===========================================================================

test("D-genitore da participant: updateParentProfile, consentito", async () => {
  const actor = newActor("d-genitore");
  const created = await createOwnProfile(actor);
  await updateParentProfile(actor, PARENT_INPUT);
  const after = await stored(actor.uid);
  assert.equal(after.role, "parent");
  assert.equal(after.fullName, "Paola Rossi");
  assert.equal(after.city, "Roma");
  assert.equal(after.unitId, "unita-1");
  assert.equal(after.unitName, "Unità Uno");
  assert.equal(after.stakeId, stakeId);
  assert.equal(after.stakeSlug, STAKE.slug);
  assert.equal(after.stakeName, STAKE.name);
  assert.equal(after.birthDate, "");
  assert.equal(after.genderRoleCategory, "");
  assert.equal(after.createdAt, created.createdAt);
});

test("D-genitore da parent appena creato (per=figlio): updateParentProfile, consentito", async () => {
  const actor = newActor("d-genitore-parent");
  await createOwnProfile(actor);
  await setOwnAccountType(actor, "parent");
  await updateParentProfile(actor, PARENT_INPUT);
  assert.equal((await stored(actor.uid)).role, "parent");
});

test("D-io da parent appena creato («Hai meno di 18 anni? Sei tu a partecipare»): updateProfile con role participant, consentito", async () => {
  const actor = newActor("d-io-da-parent");
  const created = await createOwnProfile(actor);
  await setOwnAccountType(actor, "parent");
  await updateProfile(actor, { ...YOUTH_INPUT, role: "participant" });
  const after = await stored(actor.uid);
  assert.equal(after.role, "participant");
  assert.equal(after.fullName, "Marco Rossi");
  assert.equal(after.birthDate, "2011-03-14");
  assert.equal(after.genderRoleCategory, "giovane_uomo");
  assert.equal(after.unitId, "unita-2");
  assert.equal(after.unitName, "Unità Due");
  assert.equal(after.createdAt, created.createdAt);
});

test("D-io da genitore completo (tabella «Account già esistente»): diventa participant, il comune resta", async () => {
  const actor = newActor("d-io-genitore-completo");
  await createOwnProfile(actor);
  await setOwnAccountType(actor, "parent");
  await updateParentProfile(actor, PARENT_INPUT);
  await updateProfile(actor, {
    firstName: "Paola",
    lastName: "Rossi",
    unitName: "Unità Uno",
    birthDate: "1982-06-01",
    genderRoleCategory: "accompagnatore",
    stakeId,
    role: "participant",
  });
  const after = await stored(actor.uid);
  assert.equal(after.role, "participant");
  assert.equal(after.city, "Roma");
  assert.equal(after.birthDate, "1982-06-01");
});

test("D-io da participant: updateProfile senza ruolo nel payload, consentito", async () => {
  const actor = newActor("d-io");
  await createOwnProfile(actor);
  // Il client manda il ruolo solo da parent: qui resta fuori dal payload.
  await updateProfile(actor, { ...YOUTH_INPUT, role: "participant" });
  const after = await stored(actor.uid);
  assert.equal(after.role, "participant");
  assert.equal(after.unitId, "unita-2");
});

// ===========================================================================
// Dirigente di unità: nessun cambio di ruolo né di unità da solo
// ===========================================================================

test("dirigente: updateParentProfile (role parent), negato", async () => {
  const leader = await seedUnitLeader();
  const before = await stored(leader.uid);
  // Stessa unità: l'unico cambio vietato è il ruolo.
  await expectDenied(updateParentProfile(leader, { ...PARENT_INPUT, unitName: before.unitName }), leader.uid, before);
  // Controllo: lo stesso payload col ruolo di sempre passa, quindi il rifiuto
  // viene solo dal cambio di ruolo.
  await updateParentProfile(leader, { ...PARENT_INPUT, unitName: before.unitName }, { role: "unit_leader" });
  const after = await stored(leader.uid);
  assert.equal(after.role, "unit_leader");
  assert.equal(after.city, "Roma");
});

test("dirigente: updateProfile senza ruolo e con la stessa unità, consentito", async () => {
  const leader = await seedUnitLeader();
  await updateProfile(leader, {
    firstName: "Luca",
    lastName: "Bianchi Verdi",
    unitName: "Unità Uno",
    birthDate: "1980-04-24",
    genderRoleCategory: "dirigente",
    stakeId,
    // Il client lo scarta: il profilo non è parent.
    role: "participant",
  });
  const after = await stored(leader.uid);
  assert.equal(after.role, "unit_leader");
  assert.equal(after.lastName, "Bianchi Verdi");
  assert.equal(after.unitId, "unita-1");
});

test("dirigente: updateProfile verso un'altra unità, negato", async () => {
  const leader = await seedUnitLeader();
  const before = await stored(leader.uid);
  await expectDenied(
    updateProfile(leader, {
      firstName: "Luca",
      lastName: "Bianchi",
      unitName: "Unità Due",
      birthDate: "1980-04-24",
      genderRoleCategory: "dirigente",
      stakeId,
    }),
    leader.uid,
    before,
  );
});

test("dirigente: role participant scritto a mano (client manomesso), negato", async () => {
  const leader = await seedUnitLeader();
  const before = await stored(leader.uid);
  await expectDenied(updateDoc(userRef(leader), { role: "participant", updatedAt: nowIso() }), leader.uid, before);
  await expectDenied(updateDoc(userRef(leader), { role: "parent", updatedAt: nowIso() }), leader.uid, before);
});

// ===========================================================================
// Nessuna promozione da soli
// ===========================================================================

test("participant che si dà un ruolo privilegiato, negato", async () => {
  const actor = newActor("promozione");
  await createOwnProfile(actor);
  const before = await stored(actor.uid);
  for (const role of ["admin", "unit_leader", "super_admin"]) {
    await expectDenied(updateDoc(userRef(actor), { role, updatedAt: nowIso() }), actor.uid, before);
  }
});

test("parent che si dà un ruolo privilegiato, negato", async () => {
  const actor = newActor("promozione-genitore");
  await createOwnProfile(actor);
  await setOwnAccountType(actor, "parent");
  const before = await stored(actor.uid);
  for (const role of ["admin", "unit_leader"]) {
    await expectDenied(updateDoc(userRef(actor), { role, updatedAt: nowIso() }), actor.uid, before);
  }
});

test("participant: ruolo privilegiato dentro il payload di updateProfile, negato", async () => {
  const actor = newActor("promozione-modulo");
  await createOwnProfile(actor);
  const before = await stored(actor.uid);
  const stake = await readStake(actor);
  await expectDenied(
    updateDoc(userRef(actor), {
      firstName: "Marco",
      lastName: "Rossi",
      fullName: "Marco Rossi",
      unitId: "unita-2",
      unitName: "Unità Due",
      birthDate: "2011-03-14",
      genderRoleCategory: "giovane_uomo",
      stakeId,
      stakeSlug: stake.slug,
      role: "unit_leader",
      updatedAt: nowIso(),
      lastLoginAt: nowIso(),
    }),
    actor.uid,
    before,
  );
});
