// Appartenenza al palo (S2), fase 2: il trigger `onUserStakeMembership` su
// `users/{uid}` provato nell'emulatore Functions DAL CONTRATTO di
// docs/APPARTENENZA_AL_PALO.md («Callable e trigger: interfaccia (fase 2,
// 2026-10-20)», regole 1-4 del trigger). Utenti VERI dell'Auth emulator; le
// scritture del profilo sono quelle ESATTE del client (usersService:
// ensureProfileForUser, updateProfile, updateParentProfile, updateBasicProfile,
// assignAdminRole) e passano dalle rules; l'Admin SDK serve per seminare i
// members, i profili "da console" e per ispezionare. Scritto prima del codice,
// da chi non lo ha letto.
//
// Rilancio (Auth 9429, Firestore 8429, Functions 5429, Storage 9529, hub 4429;
// progetto demo-*):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --config firebase.membership-functions-test.json --project demo-s2-functions \
//     'node --test --test-concurrency=1 functions/tests/stakeMembershipTriggerEmulator.test.mjs'
// Sul Mac mini, da un worktree: `npm ci && (cd functions && npm ci)` nello
// stesso comando (ogni sync cancella i node_modules ignorati).
//
// Il trigger è asincrono: ogni attesa è a polling con un tetto (waitFor), e
// «non deve scrivere» si prova con una quiete prolungata di tutti i members del
// giro (settleAll). Si semina PRIMA il members e POI il profilo coerente.
//
// Interpretazioni scelte (la più stretta):
//  - un ruolo staff si assegna dal client solo con la forma di assignAdminRole
//    (`updateDoc` di `role` e `updatedAt`); per `unit_leader` e per togliere il
//    ruolo oggi non c'è una UI, si usa la stessa forma (le rules la ammettono);
//  - un documento nuovo creato dal trigger nasce con `version: 1`; la copia in
//    `staffRole` di un `super_admin` con il palo nel profilo è `admin`;
//  - regola 4 letta alla lettera: lo staff spostato di palo dalla console resta
//    `active` nel palo vecchio ma con `staffRole: null`, e nel nuovo nasce
//    `active` con `staffRole`;
//  - dopo A→B→A rapido il documento in A può essere `pending` (il trigger non
//    ha visto B) oppure `withdrawn` (lo ha visto, e un documento esistente non
//    si tocca mai); in B non resta nessun `pending`.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInAnonymously,
} from "firebase/auth";
import { connectFirestoreEmulator, doc, getFirestore, setDoc, updateDoc } from "firebase/firestore";

const require = createRequire(import.meta.url);
const { initializeApp: initializeAdminApp } = require("firebase-admin/app");
const { Timestamp, getFirestore: getAdminFirestore } = require("firebase-admin/firestore");

// ---------------------------------------------------------------------------
// Guardie: mai fuori dagli emulatori locali
// ---------------------------------------------------------------------------
const PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
assert.match(PROJECT, /^demo-/u, "Usare esclusivamente un progetto demo-*");
const hostOf = (value, label) => {
  assert.match(value || "", /^(127\.0\.0\.1|localhost):\d+$/u, `${label}: emulatore locale richiesto`);
  const [host, port] = value.split(":");
  return { host, port: Number(port), raw: value };
};
const FIRESTORE = hostOf(process.env.FIRESTORE_EMULATOR_HOST, "Firestore");
const AUTH = hostOf(process.env.FIREBASE_AUTH_EMULATOR_HOST, "Auth");

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const adminApp = initializeAdminApp({ projectId: PROJECT }, `s2-trigger-admin-${runId}`);
const adminDb = getAdminFirestore(adminApp);

const PASSWORD = `Pw-${runId}-s2t!`; // credenziale di test, vale solo nell'emulatore
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const UNIT1 = { id: "unit-1", name: "Rione Uno" };
const UNIT2 = { id: "unit-2", name: "Rione Due" };
const UNIT_B1 = { id: "unit-b1", name: "Rione B Uno" };

// ---------------------------------------------------------------------------
// Pali
// ---------------------------------------------------------------------------
const STAKES = new Map();
async function newStake(label, units) {
  const id = `s2t-${label}-${runId}`;
  const stake = { id, slug: id, name: `Palo ${label}` };
  STAKES.set(id, stake);
  await adminDb.doc(`stakes/${id}`).set({ name: stake.name, slug: id, isActive: true });
  await Promise.all(units.map((unit) =>
    adminDb.doc(`stakes/${id}/units/${unit.id}`).set({ name: unit.name, type: "rione", isActive: true, stakeId: id }),
  ));
  return id;
}
const STAKE_A = await newStake("a", [UNIT1, UNIT2]);
const STAKE_B = await newStake("b", [UNIT_B1]);

// ---------------------------------------------------------------------------
// Documenti seminati (Admin SDK)
// ---------------------------------------------------------------------------
const memberPath = (stake, uid) => `stakes/${stake}/members/${uid}`;
const memberData = (extra = {}) => ({
  status: "active",
  sources: [{ kind: "migration", ref: "a3-2026-10", at: Timestamp.now() }],
  previous: null,
  staffRole: null,
  claimedUnitId: "",
  claimedUnitName: "",
  displayName: "Persona Prova",
  birthYear: 2009,
  registrationHints: [],
  reviewNeeded: false,
  requestedAt: Timestamp.now(),
  decidedAt: Timestamp.now(),
  decidedBy: "system",
  declineCount: 0,
  version: 1,
  ...extra,
});
const pendingData = (unit = UNIT1, extra = {}) =>
  memberData({ status: "pending", claimedUnitId: unit.id, claimedUnitName: unit.name, sources: [], decidedAt: null, decidedBy: null, ...extra });

/** Profilo `users/{uid}` con le sole chiavi di validUserPayload. */
function profileData({ role = "participant", stakeId = STAKE_A, unit = UNIT1, label, email = null, complete = true, over = {} }) {
  const stake = STAKES.get(stakeId);
  const now = iso();
  const staff = role === "admin" || role === "unit_leader" || role === "super_admin";
  const base = {
    email,
    phone: "",
    role,
    city: role === "parent" ? "Roma" : "",
    mustChangePassword: false,
    stakeId,
    stakeSlug: stake.slug,
    stakeName: stake.name,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  };
  const body = complete
    ? {
        firstName: "Prova",
        lastName: label,
        fullName: `Prova ${label}`,
        birthDate: role === "parent" ? "" : staff ? "1985-01-30" : "2009-04-21",
        genderRoleCategory: role === "parent" ? "" : staff ? "dirigente" : "giovane_uomo",
        unitId: unit?.id ?? "",
        unitName: unit?.name ?? "",
      }
    : { firstName: label, lastName: "", fullName: label, birthDate: "", genderRoleCategory: "", unitId: "", unitName: "" };
  return { ...base, ...body, ...over };
}

const adminData = async (path) => {
  const snap = await adminDb.doc(path).get();
  return snap.exists ? snap.data() : null;
};
const memberOf = (stake, uid) => adminData(memberPath(stake, uid));
async function memberMeta(stake, uid) {
  const snap = await adminDb.doc(memberPath(stake, uid)).get();
  return snap.exists ? { data: snap.data(), updateTime: snap.updateTime.toMillis() } : null;
}

// ---------------------------------------------------------------------------
// Persone (SDK client)
// ---------------------------------------------------------------------------
const apps = [];
const seededUids = [];
let personSeq = 0;

/** Utente vero dell'Auth emulator. `member(s)` si seminano prima del profilo; `profile`: "complete" | "incomplete" | null. */
async function newPerson({ mode = "password", role = "participant", stake = STAKE_A, unit = UNIT1, member = null, members = [], profile = "complete", label, over = {} } = {}) {
  const index = ++personSeq;
  const name = label ?? `p${index}`;
  const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT }, `${name}-${index}-${runId}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH.raw}`, { disableWarnings: true });
  const email = `${name}-${index}-${runId}@example.invalid`.toLowerCase();
  if (mode === "anonymous") await signInAnonymously(auth);
  else await createUserWithEmailAndPassword(auth, email, PASSWORD);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, FIRESTORE.host, FIRESTORE.port);
  const uid = auth.currentUser.uid;
  seededUids.push(uid);
  const seeds = member ? [{ stake, ...member }, ...members] : members;
  for (const seed of seeds) {
    const { stake: seedStake, ...fields } = seed;
    await adminDb.doc(memberPath(seedStake, uid)).set(memberData(fields));
  }
  if (profile) {
    await adminDb.doc(`users/${uid}`).set(profileData({ role, stakeId: stake, unit, label: name, email: mode === "password" ? email : null, complete: profile === "complete", over }));
  }
  return { name, uid, email: mode === "password" ? email : null, db, stake };
}

async function snapshotMembers() {
  const rows = [];
  for (const stakeId of STAKES.keys()) {
    const snap = await adminDb.collection(`stakes/${stakeId}/members`).get();
    for (const item of snap.docs) rows.push(`${stakeId}/${item.id}:${item.data().version}:${item.updateTime.toMillis()}`);
  }
  return rows.sort().join("|");
}

/** Quiete del trigger: nessun members dei pali del giro cambia per `quietMs` di fila. */
async function settleAll({ quietMs = 1500, timeoutMs = 45_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let ultima = await snapshotMembers();
  let fermaDa = Date.now();
  while (Date.now() < deadline) {
    await pausa(200);
    const attuale = await snapshotMembers();
    if (attuale !== ultima) {
      ultima = attuale;
      fermaDa = Date.now();
    } else if (Date.now() - fermaDa >= quietMs) {
      return;
    }
  }
  assert.fail(`members ancora in movimento dopo ${timeoutMs} ms`);
}

async function waitFor(read, predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await pausa(250);
  }
  assert.fail(`${label}: condizione non raggiunta in ${timeoutMs} ms. Ultimo stato: ${JSON.stringify(last)}`);
}

async function fresh(defs) {
  const people = await Promise.all(defs.map((def) => newPerson(def)));
  await settleAll();
  return people;
}

async function expectDenied(promise) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, "permission-denied", `${error?.code}: ${error?.message}`);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Scritture ESATTE del client (src/services/firestore/usersService.ts)
// ---------------------------------------------------------------------------
const userRef = (person, uid = person.uid) => doc(person.db, `users/${uid}`);

/** ensureProfileForUser: primo setDoc dopo la registrazione (nome dalla parte locale dell'email). */
async function createInitialProfile(person, stakeId = STAKE_A) {
  const stake = STAKES.get(stakeId);
  const local = person.email.split("@")[0];
  const now = iso();
  await setDoc(userRef(person), {
    firstName: local,
    lastName: "",
    fullName: local,
    email: person.email,
    phone: "",
    role: "participant",
    city: "",
    birthDate: "",
    genderRoleCategory: "",
    unitId: "",
    unitName: "",
    stakeId,
    stakeSlug: stake.slug,
    stakeName: stake.name,
    mustChangePassword: false,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  });
}

/** updateProfile («I tuoi dati» del partecipante). */
async function completeProfile(person, { firstName = "Marco", lastName = "Prova", stakeId = STAKE_A, unit = UNIT1, birthDate = "2009-04-21", genderRoleCategory = "giovane_uomo" } = {}) {
  await updateDoc(userRef(person), {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    unitId: unit.id,
    unitName: unit.name,
    birthDate,
    genderRoleCategory,
    stakeId,
    stakeSlug: STAKES.get(stakeId).slug,
    updatedAt: iso(),
    lastLoginAt: iso(),
  });
}

/** updateParentProfile («I tuoi dati» del genitore). */
async function completeParentProfile(person, { firstName = "Paola", lastName = "Prova", stakeId = STAKE_A, unit = UNIT1, city = "Roma" } = {}) {
  const stake = STAKES.get(stakeId);
  await updateDoc(userRef(person), {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    role: "parent",
    city,
    unitId: unit.id,
    unitName: unit.name,
    stakeId,
    stakeSlug: stake.slug,
    stakeName: stake.name,
    birthDate: "",
    genderRoleCategory: "",
    updatedAt: iso(),
    lastLoginAt: iso(),
  });
}

/** updateBasicProfile (solo nome e cognome). */
async function renameProfile(person, firstName, lastName) {
  await updateDoc(userRef(person), { firstName, lastName, fullName: `${firstName} ${lastName}`.trim(), updatedAt: iso() });
}

/** assignAdminRole, e la stessa forma per unit_leader e participant (le rules la ammettono, oggi senza UI). */
async function setRoleAs(admin, targetUid, role) {
  await updateDoc(userRef(admin, targetUid), { role, updatedAt: iso() });
}

// ---------------------------------------------------------------------------
// Avvio e chiusura
// ---------------------------------------------------------------------------
let AD; // admin del palo A che assegna i ruoli dal client
let triggerAlive = false;

before(async () => {
  const warm = await newPerson({ label: "scaldamento" });
  try {
    await waitFor(() => memberOf(STAKE_A, warm.uid), (data) => data?.status === "pending", "trigger (scaldamento)", 60_000);
    triggerAlive = true;
  } catch {
    triggerAlive = false;
  }
  [AD] = await fresh([{ label: "admin", role: "admin", unit: null, member: { status: "active", staffRole: "admin" } }]);
});

after(async () => {
  try {
    for (const stakeId of STAKES.keys()) await adminDb.recursiveDelete(adminDb.doc(`stakes/${stakeId}`));
    await Promise.all(seededUids.map((uid) => adminDb.doc(`users/${uid}`).delete()));
  } finally {
    await Promise.all(apps.map((app) => deleteApp(app)));
    await adminDb.terminate();
  }
});

// ===========================================================================
// Controllo
// ===========================================================================
describe("controllo", () => {
  test("le rules sono caricate: nessuno si dà un ruolo staff da solo", async () => {
    const [who] = await fresh([{ label: "furbo" }]);
    await expectDenied(updateDoc(userRef(who), { role: "admin", updatedAt: iso() }));
  });

  test("il trigger su users ha risposto allo scaldamento", (t) => {
    t.diagnostic(`trigger osservato: ${triggerAlive}`);
    assert.equal(triggerAlive, true, "nessun pending creato dal trigger entro 60 s");
  });
});

// ===========================================================================
// Regola 1 e 2: ruolo staff
// ===========================================================================
describe("regole 1 e 2: ruolo staff assegnato o tolto da un admin", () => {
  test("admin assegnato a chi non ha members (assignAdminRole): active con staffRole admin e motivo staff_approval ref role", async () => {
    const [who] = await fresh([{ label: "nuovo-admin" }]);
    // Con la history: un `delete()` del solo documento lascerebbe le righe del pending appena tolto.
    await adminDb.recursiveDelete(adminDb.doc(memberPath(STAKE_A, who.uid)));
    await setRoleAs(AD, who.uid, "admin");
    const data = await waitFor(() => memberOf(STAKE_A, who.uid), (item) => item?.status === "active", "members attivo dopo il ruolo");
    assert.equal(data.staffRole, "admin");
    assert.equal(data.reviewNeeded, false);
    assert.equal(data.version, 1);
    assert.equal(data.declineCount, 0);
    assert.ok(data.sources.some((source) => source.kind === "staff_approval" && source.ref === "role"), JSON.stringify(data.sources));
    assert.ok(data.sources.every((source) => source.at instanceof Timestamp));
    assert.ok(data.requestedAt instanceof Timestamp);
    assert.equal(data.displayName, (await adminData(`users/${who.uid}`)).fullName);
    await settleAll();
    assert.equal((await memberOf(STAKE_A, who.uid)).version, 1, "una sola scrittura");
  });

  test("unit_leader a chi è pending: active con staffRole unit_leader, reviewNeeded false, version +1", async () => {
    const [who] = await fresh([{ label: "nuovo-dirigente", member: pendingData(UNIT1) }]);
    await setRoleAs(AD, who.uid, "unit_leader");
    const data = await waitFor(() => memberOf(STAKE_A, who.uid), (item) => item?.status === "active", "members attivo dopo il ruolo");
    assert.equal(data.staffRole, "unit_leader");
    assert.equal(data.reviewNeeded, false);
    assert.equal(data.version, 2);
    assert.equal(data.claimedUnitId, UNIT1.id, "la richiesta conserva l'unità");
    await settleAll();
    assert.equal((await memberOf(STAKE_A, who.uid)).version, 2);
  });

  test("admin a un membro attivo da confermare: staffRole admin e reviewNeeded false", async () => {
    const [who] = await fresh([{ label: "migrato-promosso", member: { status: "active", reviewNeeded: true } }]);
    await setRoleAs(AD, who.uid, "admin");
    const data = await waitFor(() => memberOf(STAKE_A, who.uid), (item) => item?.staffRole === "admin", "staffRole admin");
    assert.equal(data.status, "active");
    assert.equal(data.reviewNeeded, false);
    assert.equal(data.version, 2);
  });

  test("regola 1 per super_admin con il palo nel profilo: members assente → active con staffRole admin e motivo staff_approval ref role; da pending → active", async () => {
    const [fromNothing, fromPending] = await fresh([
      { label: "super-nuovo", role: "super_admin", unit: null },
      { label: "super-pending", role: "super_admin", unit: null, member: pendingData(UNIT1) },
    ]);
    const created = await waitFor(() => memberOf(STAKE_A, fromNothing.uid), (item) => item?.status === "active", "members attivo del super admin");
    assert.equal(created.staffRole, "admin", "la copia in staffRole di un super_admin è admin (il ruolo che dà i poteri dello staff)");
    assert.equal(created.reviewNeeded, false);
    assert.equal(created.version, 1);
    assert.ok(created.sources.some((source) => source.kind === "staff_approval" && source.ref === "role"), JSON.stringify(created.sources));
    const promoted = await waitFor(() => memberOf(STAKE_A, fromPending.uid), (item) => item?.status === "active", "pending del super admin attivato");
    assert.equal(promoted.staffRole, "admin");
    assert.equal(promoted.reviewNeeded, false);
    assert.equal(promoted.version, 2);
    await settleAll();
    assert.equal((await memberOf(STAKE_A, fromNothing.uid)).version, 1, "una sola scrittura");
    assert.equal((await memberOf(STAKE_A, fromPending.uid)).version, 2, "una sola scrittura");
  });

  test("ruolo tolto (participant): staffRole null, stato invariato, version +1", async () => {
    const [who] = await fresh([{ label: "ex-dirigente", role: "unit_leader", member: { status: "active", staffRole: "unit_leader", claimedUnitId: UNIT1.id } }]);
    assert.equal((await memberOf(STAKE_A, who.uid)).version, 1, "il seed coerente non fa scrivere il trigger");
    await setRoleAs(AD, who.uid, "participant");
    const data = await waitFor(() => memberOf(STAKE_A, who.uid), (item) => item?.staffRole === null, "staffRole azzerato");
    assert.equal(data.status, "active", "l'appartenenza resta");
    assert.equal(data.version, 2);
    await settleAll();
    assert.equal((await memberOf(STAKE_A, who.uid)).version, 2);
  });

  test("ruolo staff a chi è declined, withdrawn, removed o blocked: le rules lo negano; dalla console il trigger non scrive", async () => {
    const states = ["declined", "withdrawn", "removed", "blocked"];
    const people = await fresh(states.map((status) => ({ label: `fuori-${status}`, member: { status } })));
    for (const [index, person] of people.entries()) {
      const before = await memberMeta(STAKE_A, person.uid);
      await expectDenied(setRoleAs(AD, person.uid, "admin"));
      await expectDenied(setRoleAs(AD, person.uid, "unit_leader"));
      // Console: il ruolo arriva lo stesso. Il trigger non tocca gli altri stati.
      await adminDb.doc(`users/${person.uid}`).update({ role: "admin", updatedAt: iso() });
      await settleAll({ quietMs: 2500 });
      assert.deepEqual(await memberMeta(STAKE_A, person.uid), before, `${states[index]}: il documento non cambia`);
    }
  });
});

// ===========================================================================
// Regola 3: profilo completo senza members
// ===========================================================================
describe("regola 3: profilo completo senza members", () => {
  test("account nuovo dal client: il profilo iniziale non crea nulla; completato con «I tuoi dati» nasce pending", async () => {
    const who = await newPerson({ label: "registrazione", profile: null });
    await createInitialProfile(who);
    await settleAll({ quietMs: 2500 });
    assert.equal(await memberOf(STAKE_A, who.uid), null, "profilo incompleto: niente coda");

    await completeProfile(who, { firstName: "Marco", lastName: "Verdi", unit: UNIT2 });
    const data = await waitFor(() => memberOf(STAKE_A, who.uid), (item) => item?.status === "pending", "pending dopo il profilo completo");
    assert.equal(data.claimedUnitId, UNIT2.id);
    assert.equal(data.claimedUnitName, UNIT2.name);
    assert.equal(data.displayName, "Marco Verdi");
    assert.equal(data.birthYear, 2009);
    assert.equal(data.reviewNeeded, false);
    assert.equal(data.staffRole, null);
    assert.equal(data.declineCount, 0);
    assert.equal(data.version, 1);
    assert.equal(data.previous, null);
    assert.ok(data.requestedAt instanceof Timestamp);
    assert.equal(JSON.stringify(data).includes("2009-04-21"), false, "niente data di nascita completa");
    await settleAll();
    assert.equal((await memberOf(STAKE_A, who.uid)).version, 1, "una sola scrittura");
  });

  test("genitore: «I tuoi dati» con il comune nasce pending con birthYear null", async () => {
    const who = await newPerson({ label: "genitore", profile: null });
    await createInitialProfile(who);
    await completeParentProfile(who, { firstName: "Paola", lastName: "Rossi" });
    const data = await waitFor(() => memberOf(STAKE_A, who.uid), (item) => item?.status === "pending", "pending del genitore");
    assert.equal(data.birthYear, null);
    assert.equal(data.displayName, "Paola Rossi");
    assert.equal(data.claimedUnitId, UNIT1.id);
  });

  test("profilo incompleto (senza gruppo, senza unità, genitore senza comune, nome segnaposto): niente", async () => {
    const people = await Promise.all([
      newPerson({ label: "senza-gruppo", over: { genderRoleCategory: "" } }),
      newPerson({ label: "senza-unita", over: { unitId: "", unitName: "" } }),
      newPerson({ label: "genitore-senza-comune", role: "parent", over: { city: "" } }),
      newPerson({ label: "segnaposto", over: { fullName: "Partecipante", firstName: "Partecipante", lastName: "" } }),
      newPerson({ label: "nato-incompleto", profile: "incomplete" }),
    ]);
    await settleAll({ quietMs: 3000 });
    for (const person of people) assert.equal(await memberOf(STAKE_A, person.uid), null, `${person.name}: nessun members`);
  });

  test("sessione anonima: niente, anche con profilo completo o da staff scritto da console", async () => {
    const anon = await newPerson({ label: "anonimo", mode: "anonymous" });
    await settleAll({ quietMs: 2500 });
    assert.equal(await memberOf(STAKE_A, anon.uid), null);
    await adminDb.doc(`users/${anon.uid}`).update({ role: "admin", updatedAt: iso() });
    await settleAll({ quietMs: 2500 });
    assert.equal(await memberOf(STAKE_A, anon.uid), null, "nemmeno con un ruolo staff");
  });

  test("un documento esistente non si tocca: declined, withdrawn, removed, blocked e una pending con unità diversa restano identici dopo le modifiche del profilo", async () => {
    const defs = [
      ["declined", { status: "declined", declineCount: 2 }],
      ["withdrawn", { status: "withdrawn" }],
      ["removed", { status: "removed" }],
      ["blocked", { status: "blocked" }],
      ["pending-altra-unita", pendingData(UNIT2)],
    ];
    const people = await fresh(defs.map(([label, member]) => ({ label: `fermo-${label}`, member })));
    const before = await Promise.all(people.map((person) => memberMeta(STAKE_A, person.uid)));
    for (const person of people) {
      await renameProfile(person, "Nome", "Nuovo");
      await completeProfile(person, { firstName: "Nome", lastName: "Nuovo", unit: UNIT1 });
    }
    await settleAll({ quietMs: 2500 });
    for (const [index, person] of people.entries()) {
      assert.deepEqual(await memberMeta(STAKE_A, person.uid), before[index], `${person.name}: riscritto`);
    }
    assert.equal(before[0].data.status, "declined");
    assert.equal(before[4].data.claimedUnitId, UNIT2.id, "la richiesta aperta non si riallinea al profilo");
  });
});

// ===========================================================================
// Regola 4: cambio di palo
// ===========================================================================
describe("regola 4: cambio di palo", () => {
  test("partecipante in attesa cambia palo da «I tuoi dati»: pending nel nuovo, il pending vecchio passa a withdrawn", async () => {
    const [who] = await fresh([{ label: "trasloco-pending" }]);
    assert.equal((await memberOf(STAKE_A, who.uid))?.status, "pending", "premessa: il trigger lo ha messo in coda in A");
    await completeProfile(who, { firstName: "Prova", lastName: who.name, stakeId: STAKE_B, unit: UNIT_B1 });
    const b = await waitFor(() => memberOf(STAKE_B, who.uid), (item) => item?.status === "pending", "pending in B");
    assert.equal(b.claimedUnitId, UNIT_B1.id);
    assert.equal(b.claimedUnitName, UNIT_B1.name);
    const a = await waitFor(() => memberOf(STAKE_A, who.uid), (item) => item?.status === "withdrawn", "withdrawn in A");
    assert.equal(a.version, 2);
    await settleAll();
    assert.equal((await memberOf(STAKE_A, who.uid)).version, 2);
    assert.equal((await memberOf(STAKE_B, who.uid)).version, 1);
  });

  test("membro attivo cambia palo: pending nel nuovo, l'active vecchio resta finché il nuovo non è approvato", async () => {
    const [who] = await fresh([{ label: "trasloco-active", member: { status: "active" } }]);
    const before = await memberMeta(STAKE_A, who.uid);
    await completeProfile(who, { firstName: "Prova", lastName: who.name, stakeId: STAKE_B, unit: UNIT_B1 });
    await waitFor(() => memberOf(STAKE_B, who.uid), (item) => item?.status === "pending", "pending in B");
    await settleAll();
    assert.deepEqual(await memberMeta(STAKE_A, who.uid), before, "l'appartenenza attiva in A non si tocca");
  });

  test("staff spostato di palo dalla console: staffRole null nel palo vecchio, active con staffRole nel nuovo", async () => {
    const [leader] = await fresh([{ label: "dirigente-trasloca", role: "unit_leader", member: { status: "active", staffRole: "unit_leader", claimedUnitId: UNIT1.id } }]);
    const stakeB = STAKES.get(STAKE_B);
    await adminDb.doc(`users/${leader.uid}`).update({ stakeId: STAKE_B, stakeSlug: stakeB.slug, stakeName: stakeB.name, unitId: UNIT_B1.id, unitName: UNIT_B1.name, updatedAt: iso() });
    const b = await waitFor(() => memberOf(STAKE_B, leader.uid), (item) => item?.status === "active", "active in B");
    assert.equal(b.staffRole, "unit_leader");
    const a = await waitFor(() => memberOf(STAKE_A, leader.uid), (item) => item?.staffRole === null, "staffRole azzerato in A");
    assert.equal(a.status, "active", "regola 4: un active di un altro palo resta");
  });
});

// ===========================================================================
// Eventi doppi e fuori ordine
// ===========================================================================
describe("eventi doppi e fuori ordine", () => {
  test("scritture identiche ripetute del profilo non fanno salire version", async () => {
    const [who] = await fresh([{ label: "ripetuto" }]);
    const before = await memberMeta(STAKE_A, who.uid);
    assert.equal(before?.data.status, "pending");
    const profile = await adminData(`users/${who.uid}`);
    for (let i = 0; i < 3; i += 1) {
      await adminDb.doc(`users/${who.uid}`).set({ ...profile, updatedAt: iso(), lastLoginAt: iso() });
    }
    await renameProfile(who, "Prova", who.name);
    await settleAll({ quietMs: 2500 });
    assert.deepEqual(await memberMeta(STAKE_A, who.uid), before, "nessuna riscrittura");
  });

  test("A→B→A rapido: nessun pending in B, il documento in A è pending o withdrawn, e una riscrittura dopo non cambia nulla", async () => {
    const [who] = await fresh([{ label: "avanti-indietro" }]);
    assert.equal((await memberOf(STAKE_A, who.uid))?.status, "pending");
    await completeProfile(who, { firstName: "Prova", lastName: who.name, stakeId: STAKE_B, unit: UNIT_B1 });
    await completeProfile(who, { firstName: "Prova", lastName: who.name, stakeId: STAKE_A, unit: UNIT1 });
    await settleAll({ quietMs: 2500 });
    const [a, b] = await Promise.all([memberOf(STAKE_A, who.uid), memberOf(STAKE_B, who.uid)]);
    assert.equal((await adminData(`users/${who.uid}`)).stakeId, STAKE_A, "premessa: il profilo è tornato su A");
    assert.ok(a, "il documento in A esiste");
    assert.ok(["pending", "withdrawn"].includes(a.status), `A: ${a.status}`);
    assert.equal(a.staffRole, null);
    if (b) assert.notEqual(b.status, "pending", "nessuna richiesta aperta nel palo non scelto");
    const settled = await snapshotMembers();
    await completeProfile(who, { firstName: "Prova", lastName: who.name, stakeId: STAKE_A, unit: UNIT1 });
    await settleAll({ quietMs: 2500 });
    assert.equal(await snapshotMembers(), settled, "lo stato è già coerente: nessuna scrittura in più");
  });
});
