import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { initializeApp as initializeClientApp, deleteApp as deleteClientApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInAnonymously,
} from "firebase/auth";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const require = createRequire(import.meta.url);
const { initializeApp: initializeAdminApp, getApps } = require("firebase-admin/app");
const { getFirestore: getAdminFirestore, FieldValue } = require("firebase-admin/firestore");
const { HttpsError } = require("firebase-functions/v2/https");
const { resolveCampAccess, nextStaffUids, isAdultByAge } = require("../lib/campManagement.js");

const PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "";

// ---------------------------------------------------------------------------
// Parte pura: nessun emulatore necessario.
// ---------------------------------------------------------------------------

const STAKE = "palo-a";
const activeRegistration = { registrationStatus: "confirmed", genderRoleCategory: "accompagnatore" };

function access(overrides) {
  return resolveCampAccess({ profile: null, stakeId: STAKE, uid: "u1", staffUids: [], ownRegistration: null, ...overrides });
}

test("resolveCampAccess: super_admin è admin di qualunque palo", () => {
  assert.equal(access({ profile: { role: "super_admin" } }), "admin");
  assert.equal(access({ profile: { role: "super_admin", stakeId: "altro-palo" } }), "admin");
});

test("resolveCampAccess: admin dello stesso palo sì, di un altro palo no", () => {
  assert.equal(access({ profile: { role: "admin", stakeId: STAKE } }), "admin");
  assert.equal(access({ profile: { role: "admin", stakeId: "altro-palo" } }), null);
  assert.equal(access({ profile: { role: "admin" } }), null);
});

test("resolveCampAccess: unit_leader del palo è unit_leader, di un altro palo no", () => {
  assert.equal(access({ profile: { role: "unit_leader", stakeId: STAKE } }), "unit_leader");
  assert.equal(access({ profile: { role: "unit_leader", stakeId: "altro-palo" } }), null);
});

test("resolveCampAccess: la categoria autodichiarata non dà nessun permesso", () => {
  for (const genderRoleCategory of ["accompagnatore", "dirigente"]) {
    assert.equal(
      access({
        profile: { role: "participant", stakeId: STAKE, genderRoleCategory },
        ownRegistration: { ...activeRegistration, genderRoleCategory },
      }),
      null,
      `categoria ${genderRoleCategory} con iscrizione attiva ma fuori lista`,
    );
  }
  // Nemmeno una categoria sul profilo senza ruolo, né profilo assente.
  assert.equal(access({ profile: { genderRoleCategory: "dirigente", stakeId: STAKE } }), null);
  assert.equal(access({ profile: null, ownRegistration: activeRegistration }), null);
});

test("resolveCampAccess: uid in lista con iscrizione attiva è 'listed'", () => {
  assert.equal(access({ staffUids: ["u1"], ownRegistration: activeRegistration }), "listed");
  assert.equal(
    access({ profile: { role: "participant", stakeId: STAKE }, staffUids: ["x", "u1"], ownRegistration: { registrationStatus: "pending_parent_authorization" } }),
    "listed",
  );
  // Come le rules: senza `registrationStatus` (solo `status` legacy) niente accesso.
  assert.equal(access({ staffUids: ["u1"], ownRegistration: { status: "confirmed" } }), null);
});

test("resolveCampAccess: in lista ma iscrizione annullata non ha accesso (registrationStatus e legacy status)", () => {
  assert.equal(access({ staffUids: ["u1"], ownRegistration: { registrationStatus: "cancelled" } }), null);
  assert.equal(access({ staffUids: ["u1"], ownRegistration: { status: "cancelled" } }), null);
});

test("resolveCampAccess: in lista ma senza iscrizione non ha accesso", () => {
  assert.equal(access({ staffUids: ["u1"], ownRegistration: null }), null);
  assert.equal(access({ staffUids: ["u1"], ownRegistration: undefined }), null);
  assert.equal(access({ staffUids: ["u1"], ownRegistration: "confermata" }), null);
});

test("resolveCampAccess: iscrizione attiva ma uid assente dalla lista o lista non valida", () => {
  assert.equal(access({ staffUids: ["altro"], ownRegistration: activeRegistration }), null);
  assert.equal(access({ staffUids: undefined, ownRegistration: activeRegistration }), null);
  assert.equal(access({ staffUids: "u1", ownRegistration: activeRegistration }), null);
  assert.equal(access({ uid: "", staffUids: [""], ownRegistration: activeRegistration }), null);
  assert.equal(access({ uid: undefined, staffUids: [undefined], ownRegistration: activeRegistration }), null);
});

test("nextStaffUids: aggiunta ordinata e senza doppioni", () => {
  assert.deepEqual(nextStaffUids(["b", "d"], "c", true), ["b", "c", "d"]);
  assert.deepEqual(nextStaffUids(["b", "d"], "b", true), ["b", "d"]);
  assert.deepEqual(nextStaffUids(["b", "b", "a"], "c", true), ["a", "b", "c"]);
  assert.deepEqual(nextStaffUids([], "z", true), ["z"]);
});

test("nextStaffUids: togliere chi non c'è è un no-op, togliere chi c'è lo rimuove", () => {
  assert.deepEqual(nextStaffUids(["a", "b"], "zzz", false), ["a", "b"]);
  assert.deepEqual(nextStaffUids(["b", "a"], "a", false), ["b"]);
  assert.deepEqual(nextStaffUids([], "a", false), []);
});

test("nextStaffUids: il limite di 100 persone dà failed-precondition", () => {
  const hundred = Array.from({ length: 100 }, (_, index) => `u${String(index).padStart(3, "0")}`);
  assert.equal(nextStaffUids(hundred, "nuovo", false).length, 100);
  assert.equal(nextStaffUids(hundred, "u007", true).length, 100, "già presente: nessun superamento");
  assert.throws(
    () => nextStaffUids(hundred, "u100", true),
    (error) => {
      assert.ok(error instanceof HttpsError);
      assert.equal(error.code, "failed-precondition");
      return true;
    },
  );
  // 99 + 1 = 100 è ancora ammesso.
  assert.equal(nextStaffUids(hundred.slice(0, 99), "u100", true).length, 100);
});

test("isAdultByAge: confini del diciottesimo compleanno", () => {
  const now = new Date(Date.UTC(2026, 9, 10, 15, 30));
  assert.equal(isAdultByAge("2008-10-10", now), true, "compie 18 anni oggi");
  assert.equal(isAdultByAge("2008-10-11", now), false, "compie 18 anni domani");
  assert.equal(isAdultByAge("2008-10-09", now), true, "ha compiuto 18 anni ieri");
  assert.equal(isAdultByAge("1980-05-17", now), true);
  assert.equal(isAdultByAge("2015-01-01", now), false);
  // Le ore del giorno non spostano il confine.
  assert.equal(isAdultByAge("2008-10-10", new Date(Date.UTC(2026, 9, 10, 0, 0, 1))), true);
  assert.equal(isAdultByAge("2008-10-11", new Date(Date.UTC(2026, 9, 10, 23, 59, 59))), false);
});

test("isAdultByAge: date malformate o non stringhe non sono adulte", () => {
  const now = new Date(Date.UTC(2026, 9, 10));
  for (const value of ["", "2008-10", "10/10/2008", "2008-1-1", "20081010", " 2008-10-10", "2008-10-10 ", "abcd-ef-gh", null, undefined, 20081010, {}, []]) {
    assert.equal(isAdultByAge(value, now), false, `valore ${JSON.stringify(value)}`);
  }
});

// ---------------------------------------------------------------------------
// Parte con emulatori: Auth + Firestore + Functions, utenti veri.
// ---------------------------------------------------------------------------

function requireLocalEmulators() {
  assert.equal(PROJECT, "demo-room-planner", "Usare esclusivamente il progetto demo-room-planner");
  assert.match(FIRESTORE_HOST, /^(127\.0\.0\.1|localhost):8180$/, "Firestore Emulator richiesto sulla porta 8180");
  assert.match(AUTH_HOST, /^(127\.0\.0\.1|localhost):9199$/, "Auth Emulator richiesto sulla porta 9199");
}

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const stakeId = `camp-staff-test-${runId}`;
const campId = "camp";
const tripId = "trip";
const campPath = `stakes/${stakeId}/activities/${campId}`;
const tripPath = `stakes/${stakeId}/activities/${tripId}`;

async function client(name, mode) {
  const app = initializeClientApp({ apiKey: "demo-key", projectId: PROJECT }, `${name}-${runId}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9199", { disableWarnings: true });
  if (mode === "anonymous") {
    await signInAnonymously(auth);
  } else if (mode === "password") {
    await createUserWithEmailAndPassword(auth, `${name}-${runId}@example.invalid`, "camp-staff-test-password");
  }
  const functions = getFunctions(app, "europe-west1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5101);
  const staff = httpsCallable(functions, "campManagementStaff");
  const save = httpsCallable(functions, "campManagementSave");
  return {
    app,
    auth,
    uid: auth.currentUser?.uid ?? null,
    staff: async (data, activity = campId) => (await staff({ stakeId, activityId: activity, ...data })).data,
    save: async (data = {}) =>
      (await save({ stakeId, activityId: campId, plan: { committees: [], patrols: [], manualLeaders: [] }, ...data })).data,
  };
}

async function expectCode(promise, suffix) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, `functions/${suffix}`, `atteso ${suffix}, ricevuto ${error?.code}: ${error?.message}`);
    return true;
  });
}

test("campManagementStaff e campManagementSave: solo staff reale, mai la categoria autodichiarata", async () => {
  requireLocalEmulators();
  if (getApps().length === 0) initializeAdminApp({ projectId: PROJECT });
  const adminDb = getAdminFirestore();

  const clients = {};
  try {
    for (const [name, mode] of [
      ["admin", "password"],
      ["leader", "password"],
      ["a", "password"],
      ["b", "password"],
      ["c", "password"],
      ["anon", "anonymous"],
      ["out", "none"],
    ]) {
      clients[name] = await client(name, mode);
    }
    const { admin, leader, a, b, c, anon, out } = clients;

    await Promise.all([
      adminDb.doc(`users/${admin.uid}`).set({ role: "admin", stakeId }),
      adminDb.doc(`users/${leader.uid}`).set({ role: "unit_leader", stakeId }),
      // Categoria autodichiarata sul profilo: non deve valere nulla.
      adminDb.doc(`users/${a.uid}`).set({ role: "participant", stakeId, genderRoleCategory: "accompagnatore" }),
      adminDb.doc(`users/${b.uid}`).set({ role: "participant", stakeId }),
      adminDb.doc(`users/${c.uid}`).set({ role: "participant", stakeId }),
      adminDb.doc(campPath).set({ title: "Campeggio test", activityType: "camp", startDate: "2026-07-15" }),
      adminDb.doc(tripPath).set({ title: "Gita test", activityType: "trip", startDate: "2026-07-15" }),
    ]);

    const registration = (fullName, extra) => ({
      fullName,
      birthDate: "1985-04-02",
      genderRoleCategory: "giovane_uomo",
      registrationStatus: "confirmed",
      answers: {},
      ...extra,
    });
    await Promise.all([
      adminDb.doc(`${campPath}/registrations/user_${a.uid}`).set(registration("Anna Accompagnatrice", { genderRoleCategory: "accompagnatore" })),
      adminDb.doc(`${campPath}/registrations/user_${b.uid}`).set(registration("Bruno Berti", { birthDate: "2009-06-01" })),
      // Per la trip B è iscritto, per provare che l'attività non-camp è rifiutata anche a chi è in regola.
      adminDb.doc(`${tripPath}/registrations/user_${b.uid}`).set(registration("Bruno Berti")),
      // Candidati speciali: minorenne che si dichiara accompagnatore, dirigente adulto, iscrizioni da escludere.
      adminDb.doc(`${campPath}/registrations/user_minor`).set(
        registration("Zeno Minorenne", { genderRoleCategory: "accompagnatore", birthDate: "2015-03-01" }),
      ),
      adminDb.doc(`${campPath}/registrations/user_adult`).set(
        registration("Carla Dirigente", { genderRoleCategory: "dirigente", birthDate: "1975-01-20" }),
      ),
      adminDb.doc(`${campPath}/registrations/user_cancelled`).set(
        registration("Dario Annullato", { genderRoleCategory: "dirigente", registrationStatus: "cancelled" }),
      ),
      adminDb.doc(`${campPath}/registrations/user_legacycancelled`).set({
        fullName: "Elena Legacy",
        genderRoleCategory: "dirigente",
        birthDate: "1980-01-01",
        status: "cancelled",
      }),
      adminDb.doc(`${campPath}/registrations/guest-no-user`).set(registration("Fabio Senzaaccount", { genderRoleCategory: "dirigente" })),
    ]);

    // --- context prima di qualunque impostazione ---------------------------
    assert.deepEqual(await admin.staff({ action: "context" }), { ok: true, isStaff: true, canManageStaff: true });
    assert.deepEqual(await leader.staff({ action: "context" }), { ok: true, isStaff: true, canManageStaff: false });
    assert.deepEqual(await a.staff({ action: "context" }), { ok: true, isStaff: false, canManageStaff: false });
    assert.deepEqual(await b.staff({ action: "context" }), { ok: true, isStaff: false, canManageStaff: false });
    assert.deepEqual(await c.staff({ action: "context" }), { ok: true, isStaff: false, canManageStaff: false });
    await expectCode(anon.staff({ action: "context" }), "permission-denied");
    await expectCode(out.staff({ action: "context" }), "unauthenticated");

    // --- list/set riservate agli admin --------------------------------------
    for (const [who, user] of [["A", a], ["C", c], ["unit_leader", leader], ["anonimo", anon]]) {
      await assert.rejects(user.staff({ action: "list" }), (error) => {
        assert.equal(error?.code, "functions/permission-denied", `list da ${who}`);
        return true;
      });
      await expectCode(user.staff({ action: "set", uid: b.uid, enabled: true }), "permission-denied");
    }
    await expectCode(out.staff({ action: "list" }), "unauthenticated");
    await expectCode(out.staff({ action: "set", uid: b.uid, enabled: true }), "unauthenticated");
    assert.equal((await adminDb.doc(`${campPath}/management/campStaff`).get()).exists, false, "i rifiuti non scrivono nulla");

    // --- set: validazione e precondizioni -----------------------------------
    await expectCode(admin.staff({ action: "set", uid: c.uid, enabled: true }), "failed-precondition");
    await expectCode(admin.staff({ action: "set", uid: "user-che-non-esiste", enabled: true }), "failed-precondition");
    await expectCode(admin.staff({ action: "set", uid: "cancelled", enabled: true }), "failed-precondition");
    await expectCode(admin.staff({ action: "set", uid: "legacycancelled", enabled: true }), "failed-precondition");
    await expectCode(admin.staff({ action: "set", uid: b.uid }), "invalid-argument");
    await expectCode(admin.staff({ action: "set", uid: b.uid, enabled: "true" }), "invalid-argument");
    await expectCode(admin.staff({ action: "set", enabled: true }), "invalid-argument");
    assert.equal((await adminDb.doc(`${campPath}/management/campStaff`).get()).exists, false, "nessuna scrittura dopo i rifiuti");

    // --- set di B e verifica ------------------------------------------------
    const added = await admin.staff({ action: "set", uid: b.uid, enabled: true });
    assert.deepEqual(added, { ok: true, staffUids: [b.uid] });
    const again = await admin.staff({ action: "set", uid: b.uid, enabled: true });
    assert.deepEqual(again, { ok: true, staffUids: [b.uid] }, "idempotente: nessun doppione");
    const stored = (await adminDb.doc(`${campPath}/management/campStaff`).get()).data();
    assert.deepEqual(stored.staffUids, [b.uid]);
    assert.equal(stored.updatedBy, admin.uid);

    let listed = await admin.staff({ action: "list" });
    assert.equal(listed.ok, true);
    assert.equal(listed.candidates.find((candidate) => candidate.uid === b.uid).isStaff, true);
    assert.equal(listed.candidates.find((candidate) => candidate.uid === a.uid).isStaff, false);

    assert.deepEqual(await b.staff({ action: "context" }), { ok: true, isStaff: true, canManageStaff: false });
    assert.deepEqual(await a.staff({ action: "context" }), { ok: true, isStaff: false, canManageStaff: false }, "A resta fuori anche dopo il set di B");
    assert.deepEqual(await c.staff({ action: "context" }), { ok: true, isStaff: false, canManageStaff: false });

    // B (staff) non può elencare né modificare l'elenco.
    await expectCode(b.staff({ action: "list" }), "permission-denied");
    await expectCode(b.staff({ action: "set", uid: a.uid, enabled: true }), "permission-denied");
    await expectCode(b.staff({ action: "set", uid: b.uid, enabled: false }), "permission-denied");
    assert.deepEqual((await adminDb.doc(`${campPath}/management/campStaff`).get()).data().staffUids, [b.uid]);

    // --- candidati ----------------------------------------------------------
    listed = await admin.staff({ action: "list" });
    const byUid = new Map(listed.candidates.map((candidate) => [candidate.uid, candidate]));
    assert.deepEqual(
      [...byUid.keys()].sort(),
      [a.uid, b.uid, "adult", "minor"].sort(),
      "solo iscrizioni user_ non annullate (esclusi annullati, legacy annullati e senza account)",
    );
    assert.equal(byUid.get("minor").isAdult, false, "minorenne che si dichiara accompagnatore");
    assert.equal(byUid.get("adult").isAdult, true, "adulto con categoria adulta");
    assert.equal(byUid.get(a.uid).isAdult, true);
    assert.equal(byUid.get(b.uid).isAdult, false, "giovane: categoria non adulta");
    assert.equal(byUid.get("adult").name, "Carla Dirigente");
    assert.equal(byUid.get("adult").registrationId, "user_adult");
    const flags = listed.candidates.map((candidate) => candidate.isAdult);
    assert.deepEqual(flags, [...flags].sort((left, right) => Number(right) - Number(left)), "gli adulti vengono prima");
    assert.deepEqual(
      listed.candidates.filter((candidate) => candidate.isAdult).map((candidate) => candidate.name),
      ["Anna Accompagnatrice", "Carla Dirigente"],
      "ordine alfabetico tra gli adulti",
    );

    // --- togliere B ---------------------------------------------------------
    assert.deepEqual(await admin.staff({ action: "set", uid: b.uid, enabled: false }), { ok: true, staffUids: [] });
    assert.deepEqual(await admin.staff({ action: "set", uid: b.uid, enabled: false }), { ok: true, staffUids: [] }, "togliere chi non c'è è un no-op");
    assert.deepEqual(await b.staff({ action: "context" }), { ok: true, isStaff: false, canManageStaff: false });
    await expectCode(b.save(), "permission-denied");

    // --- azione sconosciuta e attività non camp -----------------------------
    await expectCode(admin.staff({ action: "boh" }), "invalid-argument");
    await expectCode(admin.staff({}), "invalid-argument");
    await expectCode(admin.staff({ action: "context", stakeId: "", activityId: "" }), "invalid-argument");
    for (const action of ["context", "list"]) {
      await expectCode(admin.staff({ action }, tripId), "failed-precondition");
    }
    await expectCode(admin.staff({ action: "set", uid: b.uid, enabled: true }, tripId), "failed-precondition");
    await expectCode(admin.staff({ action: "context" }, "attivita-inesistente"), "failed-precondition");
    assert.equal((await adminDb.doc(`${tripPath}/management/campStaff`).get()).exists, false, "nessun elenco staff su un'attività non camp");

    // --- campManagementSave: A rifiutata, B (in lista), leader e admin accettati
    await expectCode(a.save(), "permission-denied");
    await expectCode(c.save(), "permission-denied");
    await expectCode(anon.save(), "permission-denied");
    await expectCode(out.save(), "unauthenticated");
    await expectCode(b.save(), "permission-denied");
    await admin.staff({ action: "set", uid: b.uid, enabled: true });
    await expectCode(a.save(), "permission-denied");
    const savedByB = await b.save();
    assert.equal(savedByB.ok, true);
    const savedByAdmin = await admin.save();
    assert.equal(savedByAdmin.ok, true);
    const savedByLeader = await leader.save();
    assert.equal(savedByLeader.ok, true);
    assert.equal((await adminDb.doc(`${campPath}/management/camp`).get()).exists, true);
    // L'elenco vale per un solo campeggio: B non è staff dell'altra attività, e su una non camp
    // nemmeno l'admin può salvare i comitati.
    await expectCode(b.save({ activityId: tripId }), "permission-denied");
    await expectCode(admin.save({ activityId: tripId }), "failed-precondition");

    // --- iscrizione annullata: l'accesso cade anche con uid ancora in lista ---
    await adminDb.doc(`${campPath}/registrations/user_${b.uid}`).update({ registrationStatus: "cancelled" });
    assert.deepEqual(
      (await adminDb.doc(`${campPath}/management/campStaff`).get()).data().staffUids,
      [b.uid],
      "B è ancora in lista",
    );
    assert.deepEqual(await b.staff({ action: "context" }), { ok: true, isStaff: false, canManageStaff: false });
    await expectCode(b.save(), "permission-denied");
    await expectCode(b.staff({ action: "list" }), "permission-denied");
    // Lo stesso vale per lo status legacy.
    await adminDb.doc(`${campPath}/registrations/user_${b.uid}`).update({ registrationStatus: "confirmed", status: "cancelled" });
    // registrationStatus ha la precedenza sullo status legacy: confermata => attiva.
    assert.deepEqual(await b.staff({ action: "context" }), { ok: true, isStaff: true, canManageStaff: false });
    await adminDb.doc(`${campPath}/registrations/user_${b.uid}`).update({ registrationStatus: FieldValue.delete() });
    assert.deepEqual(await b.staff({ action: "context" }), { ok: true, isStaff: false, canManageStaff: false }, "solo status legacy annullato");

    // B senza iscrizione attiva resta visibile in elenco, segnato, così l'admin lo può togliere.
    listed = await admin.staff({ action: "list" });
    const stale = listed.candidates.find((candidate) => candidate.uid === b.uid);
    assert.ok(stale && stale.isStaff === true && /annullata/u.test(stale.name), "B annullato resta visibile");
    assert.deepEqual(await admin.staff({ action: "set", uid: b.uid, enabled: false }), { ok: true, staffUids: [] });
    listed = await admin.staff({ action: "list" });
    assert.equal(listed.candidates.some((candidate) => candidate.uid === b.uid), false, "tolto B sparisce");
    await expectCode(admin.staff({ action: "set", uid: b.uid, enabled: true }), "failed-precondition");
  } finally {
    // Pulizia: dati di test e client (gli emulatori restano puliti per i test successivi).
    const uids = Object.values(clients).map((entry) => entry.uid).filter(Boolean);
    await Promise.allSettled([
      adminDb.recursiveDelete(adminDb.doc(campPath)),
      adminDb.recursiveDelete(adminDb.doc(tripPath)),
      ...uids.map((uid) => adminDb.doc(`users/${uid}`).delete()),
    ]);
    await Promise.allSettled(Object.values(clients).map((entry) => deleteClientApp(entry.app)));
  }
});
