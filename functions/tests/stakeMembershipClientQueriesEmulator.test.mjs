// Appartenenza al palo (S2), fase 3: le rules Firestore provate con le query
// ESATTE del client nuovo (src/services/firestore/stakeMembersService.ts),
// DALLA SPEC di docs/APPARTENENZA_AL_PALO.md («Chi vede, chi scrive»,
// «Contratto di autorizzazione», «Client della fase 3»), da chi non ha scritto
// né le rules né il client: una cella rossa è un disaccordo fra spec e codice,
// e uno dei due è un bug.
//
// Letture del client:
//  - il proprio documento `stakes/{s}/members/{uid}` (subscribeOwn: onSnapshot
//    con includeMetadataChanges; qui getDocFromServer e il primo snapshot dal
//    server), anche quando non esiste;
//  - le code dello staff (subscribeQueue), sole uguaglianze:
//      [where('claimedUnitId','==',unità)] + where('status','==','pending')
//      [where('claimedUnitId','==',unità)] + where('status','==','declined')
//      [where('claimedUnitId','==',unità)] + where('reviewNeeded','==',true)
//    l'admin senza il filtro dell'unità, il dirigente sempre con il suo;
//  - la nota dello staff `members/{uid}/staff/note` (getStaffNoteKind), un
//    get per persona in coda: admin e dirigente dell'unità dichiarata, mai il
//    richiedente.
// Solo rules: utenti VERI dell'Auth emulator e SDK client; l'Admin SDK semina
// e basta (ignora le rules). Niente Functions emulator di proposito: il
// trigger su `users` riscriverebbe i members seminati.
//
// Rilancio (Auth 9419, Firestore 8419, hub 4419; progetto demo-*):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --only auth,firestore --config firebase.membership-test.json --project demo-s2-client-queries \
//     'node --test --test-concurrency=1 functions/tests/stakeMembershipClientQueriesEmulator.test.mjs'
// Sul Mac mini, da un worktree: `npm ci && (cd functions && npm ci)` prima.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInAnonymously } from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDocFromServer,
  getDocsFromServer,
  getFirestore,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import { buildUserDocument } from "../../tools/lib/stakes.mjs";

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
const adminApp = initializeAdminApp({ projectId: PROJECT }, `s2-client-queries-admin-${runId}`);
const adminDb = getAdminFirestore(adminApp);

const STAKE_A = `s2qa-${runId}`;
const STAKE_B = `s2qb-${runId}`;
const STAKES = {
  [STAKE_A]: { id: STAKE_A, slug: STAKE_A, name: "Palo A" },
  [STAKE_B]: { id: STAKE_B, slug: STAKE_B, name: "Palo B" },
};
const UNIT_U = { id: "unit-u", name: "Rione U" };
const UNIT_V = { id: "unit-v", name: "Rione V" };
const PASSWORD = `Pw-${runId}-s2q!`; // credenziale di test, vale solo nell'emulatore
const DAY = 24 * 3600 * 1000;
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const MEMBERS = `stakes/${STAKE_A}/members`;
const NOTE = { kind: "same_name_birth", matches: 1, at: Timestamp.now() };

// ---------------------------------------------------------------------------
// Persone (ognuna un'app client con il proprio uid)
// ---------------------------------------------------------------------------
// role + profileStake (+ unit) = profilo users/{uid}; member = documento
// members (in `memberStake`, default palo A); note = nota dello staff su di sé.
const PERSONS = [
  { key: "admin del palo", role: "admin", profileStake: STAKE_A, member: { status: "active", staffRole: "admin" } },
  {
    key: "dirigente di U",
    role: "unit_leader",
    profileStake: STAKE_A,
    unit: UNIT_U,
    member: { status: "active", staffRole: "unit_leader", claimedUnitId: UNIT_U.id, claimedUnitName: UNIT_U.name },
  },
  {
    key: "dirigente di V",
    role: "unit_leader",
    profileStake: STAKE_A,
    unit: UNIT_V,
    member: { status: "active", staffRole: "unit_leader", claimedUnitId: UNIT_V.id, claimedUnitName: UNIT_V.name },
  },
  // Dirigente dell'unità con lo stesso id, ma di un altro palo.
  {
    key: "dirigente di un altro palo",
    role: "unit_leader",
    profileStake: STAKE_B,
    unit: UNIT_U,
    memberStake: STAKE_B,
    member: { status: "active", staffRole: "unit_leader", claimedUnitId: UNIT_U.id, claimedUnitName: UNIT_U.name },
  },
  { key: "membro attivo", role: "participant", profileStake: STAKE_A, member: { status: "active", claimedUnitId: UNIT_U.id, claimedUnitName: UNIT_U.name } },
  {
    key: "in attesa",
    role: "participant",
    profileStake: STAKE_A,
    member: { status: "pending", claimedUnitId: UNIT_U.id, claimedUnitName: UNIT_U.name, requestedAt: Timestamp.fromMillis(Date.now() - DAY) },
    note: true,
  },
  { key: "senza documento", role: "participant", profileStake: STAKE_A },
  // Sessione anonima con un profilo da admin e un members attivo da admin,
  // scritti per errore: il contratto nega lo stesso («qualunque documento abbia»).
  { key: "anonimo", mode: "anonymous", role: "admin", profileStake: STAKE_A, member: { status: "active", staffRole: "admin" } },
];
for (const def of PERSONS) def.mode ??= "password";

// Documenti bersaglio nel palo A (uid finti: nessuna di queste persone esiste in Auth).
const TARGETS = {
  "p-u-vecchia": { status: "pending", claimedUnitId: UNIT_U.id, claimedUnitName: UNIT_U.name, requestedAt: Timestamp.fromMillis(Date.now() - 3 * DAY), note: true },
  "p-v": { status: "pending", claimedUnitId: UNIT_V.id, claimedUnitName: UNIT_V.name, note: true },
  // "Non è della mia unità": claimedUnitId svuotato, il nome resta, la vedono solo gli admin.
  "p-passata": {
    status: "pending",
    claimedUnitId: "",
    claimedUnitName: UNIT_U.name,
    previous: { action: "notMyUnit", by: "uid-dirigente-u", status: "pending" },
    note: true,
  },
  "d-u": { status: "declined", claimedUnitId: UNIT_U.id, claimedUnitName: UNIT_U.name, declineCount: 1, decidedAt: Timestamp.fromMillis(Date.now() - DAY), decidedBy: "uid-dirigente-u" },
  "d-v": { status: "declined", claimedUnitId: UNIT_V.id, claimedUnitName: UNIT_V.name, declineCount: 1, decidedAt: Timestamp.fromMillis(Date.now() - DAY), decidedBy: "uid-admin" },
  "r-u": { status: "active", reviewNeeded: true, claimedUnitId: UNIT_U.id, claimedUnitName: UNIT_U.name },
  "r-v": { status: "active", reviewNeeded: true, claimedUnitId: UNIT_V.id, claimedUnitName: UNIT_V.name },
  // Migrato senza unità nel profilo: solo gli admin lo vedono.
  "r-senza-unita": { status: "active", reviewNeeded: true, claimedUnitId: "", claimedUnitName: "" },
  "a-u": { status: "active", claimedUnitId: UNIT_U.id, claimedUnitName: UNIT_U.name },
  "b-u": { status: "blocked", claimedUnitId: UNIT_U.id, claimedUnitName: UNIT_U.name },
  "w-u": { status: "withdrawn", claimedUnitId: UNIT_U.id, claimedUnitName: UNIT_U.name },
};

const apps = [];
const P = {};

async function makeActor(def, index) {
  const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT }, `q${index}-${runId}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH.raw}`, { disableWarnings: true });
  if (def.mode === "anonymous") await signInAnonymously(auth);
  else await createUserWithEmailAndPassword(auth, `q${index}-${runId}@example.invalid`, PASSWORD);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, FIRESTORE.host, FIRESTORE.port);
  return { ...def, index, db, uid: auth.currentUser.uid };
}

const memberData = (extra = {}) => {
  const { note: _note, ...fields } = extra;
  return {
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
    decidedAt: null,
    decidedBy: "",
    declineCount: 0,
    version: 1,
    ...fields,
  };
};
const profileData = (role, stakeId, unit, label) =>
  buildUserDocument({
    firstName: "Prova",
    lastName: label,
    email: `${label.replace(/[^a-z0-9]+/giu, "-").toLowerCase()}@example.invalid`,
    role,
    stake: STAKES[stakeId],
    unit: unit ?? null,
    now: iso(),
  });

before(async () => {
  const made = await Promise.all(PERSONS.map((def, index) => makeActor(def, index)));
  for (const actor of made) P[actor.key] = actor;

  await Promise.all(Object.values(STAKES).map((stake) =>
    adminDb.doc(`stakes/${stake.id}`).set({ name: stake.name, slug: stake.slug, isActive: true }),
  ));
  await Promise.all(made.map(async (p) => {
    if (p.role) await adminDb.doc(`users/${p.uid}`).set(profileData(p.role, p.profileStake, p.unit, p.key));
    if (p.member) {
      const stake = p.memberStake ?? STAKE_A;
      await adminDb.doc(`stakes/${stake}/members/${p.uid}`).set(memberData(p.member));
      if (p.note) await adminDb.doc(`stakes/${stake}/members/${p.uid}/staff/note`).set(NOTE);
    }
  }));
  await Promise.all(Object.entries(TARGETS).map(async ([id, fields]) => {
    await adminDb.doc(`${MEMBERS}/${id}`).set(memberData(fields));
    if (fields.note) await adminDb.doc(`${MEMBERS}/${id}/staff/note`).set(NOTE);
  }));
});

after(async () => {
  await Promise.all(apps.map((app) => deleteApp(app)));
  await adminDb.recursiveDelete(adminDb.doc(`stakes/${STAKE_A}`));
  await adminDb.recursiveDelete(adminDb.doc(`stakes/${STAKE_B}`));
  await Promise.all(Object.values(P).filter((p) => p.role).map((p) => adminDb.recursiveDelete(adminDb.doc(`users/${p.uid}`))));
  await adminDb.terminate();
});

// ---------------------------------------------------------------------------
// Le letture del client, nella stessa forma del servizio
// ---------------------------------------------------------------------------
/** stakeMembersService.queueConstraints: sole uguaglianze. */
function queueConstraints(kind, unitId) {
  const scope = unitId ? [where("claimedUnitId", "==", unitId)] : [];
  if (kind === "review") return [...scope, where("reviewNeeded", "==", true)];
  return [...scope, where("status", "==", kind)];
}
const queueQuery = (p, kind, unitId) => query(collection(p.db, MEMBERS), ...queueConstraints(kind, unitId));
const readQueue = (p, kind, unitId) => getDocsFromServer(queueQuery(p, kind, unitId));

/**
 * Primo snapshot DAL SERVER di un listener (subscribeOwn, subscribeQueue):
 * rifiuta con l'errore del listener. Un `onSnapshot` emette prima uno snapshot
 * dalla cache locale se ha già documenti di quella collection (per esempio la
 * coda filtrata letta un attimo prima): quello non dice niente delle rules,
 * quindi si aspetta `fromCache: false` o l'errore che il server manda dopo.
 */
function firstServerSnapshot(reference) {
  return new Promise((resolve, reject) => {
    const unsubscribe = onSnapshot(
      reference,
      { includeMetadataChanges: true },
      (snapshot) => {
        if (snapshot.metadata.fromCache) return;
        unsubscribe();
        resolve(snapshot);
      },
      (error) => {
        unsubscribe();
        reject(error);
      },
    );
  });
}
const ownDoc = (p) => doc(p.db, `${MEMBERS}/${p.uid}`);
const noteDoc = (p, uid) => doc(p.db, `${MEMBERS}/${uid}/staff/note`);

async function expectDenied(attempt, label = "") {
  await assert.rejects(attempt, (error) => {
    assert.equal(error?.code, "permission-denied", `${label}: atteso permission-denied, ricevuto ${error?.code}: ${error?.message}`);
    return true;
  });
}
const ids = (snapshot) => snapshot.docs.map((item) => item.id).sort();

// ---------------------------------------------------------------------------
// Il proprio documento
// ---------------------------------------------------------------------------
describe("il proprio members/{uid}: lo legge il titolare, anche quando non esiste", () => {
  test("in attesa: legge il proprio documento pending, senza la nota dello staff", async () => {
    const p = P["in attesa"];
    const snap = await getDocFromServer(ownDoc(p));
    assert.equal(snap.exists(), true);
    assert.equal(snap.get("status"), "pending");
    assert.equal(snap.get("claimedUnitId"), UNIT_U.id);
    assert.equal(snap.get("staffNote"), undefined, "la nota vive in staff/note, non nel documento");
    assert.equal(snap.get("previous"), null);
  });

  test("in attesa: lo stesso con il listener di subscribeOwn (includeMetadataChanges, dal server)", async () => {
    const snap = await firstServerSnapshot(ownDoc(P["in attesa"]));
    assert.equal(snap.exists(), true);
    assert.equal(snap.metadata.fromCache, false);
    assert.equal(snap.get("status"), "pending");
  });

  test("membro attivo: legge il proprio documento active", async () => {
    const snap = await getDocFromServer(ownDoc(P["membro attivo"]));
    assert.equal(snap.exists(), true);
    assert.equal(snap.get("status"), "active");
  });

  test("senza documento: la lettura è permessa e dice «non esiste» (nessuna richiesta ancora)", async () => {
    const p = P["senza documento"];
    const snap = await getDocFromServer(ownDoc(p));
    assert.equal(snap.exists(), false);
    const live = await firstServerSnapshot(ownDoc(p));
    assert.equal(live.exists(), false);
    assert.equal(live.metadata.fromCache, false);
  });

  test("dirigente di un altro palo: il proprio documento nel palo A non esiste, la lettura è permessa", async () => {
    const snap = await getDocFromServer(ownDoc(P["dirigente di un altro palo"]));
    assert.equal(snap.exists(), false);
  });

  test("staff del palo: legge il proprio documento con staffRole", async () => {
    assert.equal((await getDocFromServer(ownDoc(P["admin del palo"]))).get("staffRole"), "admin");
    assert.equal((await getDocFromServer(ownDoc(P["dirigente di U"]))).get("staffRole"), "unit_leader");
  });

  test("sessione anonima: get del proprio documento permesso (contratto: O legge members/{sé})", async () => {
    const snap = await getDocFromServer(ownDoc(P.anonimo));
    assert.equal(snap.exists(), true, "il documento scritto per errore esiste, ma non dà nessun potere (vedi le code)");
  });

  for (const key of ["in attesa", "membro attivo", "senza documento", "anonimo"]) {
    test(`${key}: il documento di un altro è negato`, async () => {
      for (const other of ["p-u-vecchia", "a-u", "d-u"]) {
        await expectDenied(getDocFromServer(doc(P[key].db, `${MEMBERS}/${other}`)), `${key} legge ${other}`);
      }
    });
  }

  test("membro attivo: il documento della persona in attesa (account vero) è negato", async () => {
    await expectDenied(getDocFromServer(doc(P["membro attivo"].db, `${MEMBERS}/${P["in attesa"].uid}`)));
  });

  test("dirigente di un altro palo: un documento del palo A è negato anche se dichiara «la sua» unità", async () => {
    await expectDenied(getDocFromServer(doc(P["dirigente di un altro palo"].db, `${MEMBERS}/p-u-vecchia`)));
  });
});

// ---------------------------------------------------------------------------
// Le code dello staff: pending, declined, review
// ---------------------------------------------------------------------------
const PENDING_ALL = () => ["p-u-vecchia", "p-v", "p-passata", P["in attesa"].uid].sort();
const PENDING_U = () => ["p-u-vecchia", P["in attesa"].uid].sort();
const EXPECTED = {
  pending: { all: PENDING_ALL, [UNIT_U.id]: PENDING_U, [UNIT_V.id]: () => ["p-v"] },
  declined: { all: () => ["d-u", "d-v"], [UNIT_U.id]: () => ["d-u"], [UNIT_V.id]: () => ["d-v"] },
  review: { all: () => ["r-senza-unita", "r-u", "r-v"], [UNIT_U.id]: () => ["r-u"], [UNIT_V.id]: () => ["r-v"] },
};

// who, unit (filtro claimedUnitId; null = senza), allow.
const QUEUE_CELLS = [
  { who: "admin del palo", unit: null, allow: true },
  { who: "dirigente di U", unit: UNIT_U.id, allow: true },
  { who: "dirigente di V", unit: UNIT_V.id, allow: true },
  { who: "dirigente di U", unit: UNIT_V.id, allow: false },
  { who: "dirigente di V", unit: UNIT_U.id, allow: false },
  { who: "dirigente di U", unit: null, allow: false },
  { who: "dirigente di un altro palo", unit: UNIT_U.id, allow: false },
  { who: "dirigente di un altro palo", unit: null, allow: false },
  { who: "membro attivo", unit: null, allow: false },
  { who: "membro attivo", unit: UNIT_U.id, allow: false },
  { who: "in attesa", unit: null, allow: false },
  { who: "in attesa", unit: UNIT_U.id, allow: false },
  { who: "senza documento", unit: null, allow: false },
  { who: "senza documento", unit: UNIT_U.id, allow: false },
  { who: "anonimo", unit: null, allow: false },
  { who: "anonimo", unit: UNIT_U.id, allow: false },
];
const QUEUE_LABEL = {
  pending: "where('status','==','pending')",
  declined: "where('status','==','declined')",
  review: "where('reviewNeeded','==',true)",
};

for (const kind of ["pending", "declined", "review"]) {
  describe(`coda ${kind}: ${QUEUE_LABEL[kind]}`, () => {
    for (const cell of QUEUE_CELLS) {
      const scope = cell.unit ? `con where('claimedUnitId','==','${cell.unit}')` : "senza il filtro dell'unità";
      test(`${cell.who}, ${scope}: ${cell.allow ? "permesso, con esattamente i documenti attesi" : "negato"}`, async () => {
        const p = P[cell.who];
        if (!cell.allow) {
          await expectDenied(readQueue(p, kind, cell.unit), `${kind} ${cell.who} ${scope}`);
          return;
        }
        const snap = await readQueue(p, kind, cell.unit);
        assert.deepEqual(ids(snap), EXPECTED[kind][cell.unit ?? "all"](), "la coda restituisce esattamente i documenti della spec");
        for (const item of snap.docs) {
          assert.equal(item.get("staffNote"), undefined, "la nota dello staff non viaggia nel documento");
          if (kind === "review") assert.equal(item.get("status"), "active");
          else assert.equal(item.get("status"), kind);
          if (cell.unit) assert.equal(item.get("claimedUnitId"), cell.unit);
        }
      });
    }

    test(`dirigente di U, con il listener di subscribeQueue: gli stessi documenti`, async () => {
      const snap = await firstServerSnapshot(queueQuery(P["dirigente di U"], kind, UNIT_U.id));
      assert.deepEqual(ids(snap), EXPECTED[kind][UNIT_U.id]());
    });

    test(`dirigente di U, listener senza il filtro dell'unità: l'errore arriva al listener`, async () => {
      await expectDenied(firstServerSnapshot(queueQuery(P["dirigente di U"], kind, null)), `listener ${kind}`);
    });

    test(`admin del palo, con il listener di subscribeQueue senza filtro: tutto il palo`, async () => {
      const snap = await firstServerSnapshot(queueQuery(P["admin del palo"], kind, null));
      assert.deepEqual(ids(snap), EXPECTED[kind].all());
    });
  });
}

describe("le code non si mescolano", () => {
  test("admin: la coda pending non contiene declined, active, blocked né withdrawn", async () => {
    const pending = ids(await readQueue(P["admin del palo"], "pending", null));
    for (const id of ["d-u", "d-v", "r-u", "r-v", "r-senza-unita", "a-u", "b-u", "w-u", P["membro attivo"].uid, P["admin del palo"].uid]) {
      assert.ok(!pending.includes(id), `${id} non è in coda`);
    }
  });

  test("admin: la coda review contiene solo gli active con reviewNeeded, anche chi non ha unità", async () => {
    const review = ids(await readQueue(P["admin del palo"], "review", null));
    assert.ok(review.includes("r-senza-unita"), "il migrato senza unità lo vede l'admin");
    assert.ok(!review.includes("a-u"), "un attivo già confermato no");
    assert.ok(!review.includes("p-u-vecchia"), "un pending no");
  });

  test("dirigente di U: la richiesta passata agli admin (claimedUnitId vuoto) non è più nella sua coda", async () => {
    const pending = ids(await readQueue(P["dirigente di U"], "pending", UNIT_U.id));
    assert.ok(!pending.includes("p-passata"));
    assert.ok(ids(await readQueue(P["admin del palo"], "pending", null)).includes("p-passata"), "la vedono gli admin");
  });

  test("dirigente di U: il migrato senza unità non è nella sua coda da confermare", async () => {
    assert.ok(!ids(await readQueue(P["dirigente di U"], "review", UNIT_U.id)).includes("r-senza-unita"));
  });
});

// ---------------------------------------------------------------------------
// La nota dello staff: members/{uid}/staff/note
// ---------------------------------------------------------------------------
describe("nota dello staff: get per persona in coda", () => {
  const cells = [
    // who, uid della persona in coda, allow, (exists)
    ["admin del palo", "p-u-vecchia", true, true],
    ["admin del palo", "p-v", true, true],
    ["admin del palo", "p-passata", true, true],
    ["admin del palo", "d-u", true, false],
    ["dirigente di U", "p-u-vecchia", true, true],
    ["dirigente di U", "d-u", true, false],
    ["dirigente di U", "p-v", false],
    ["dirigente di U", "p-passata", false],
    ["dirigente di V", "p-v", true, true],
    ["dirigente di V", "p-u-vecchia", false],
    ["dirigente di un altro palo", "p-u-vecchia", false],
    ["membro attivo", "p-u-vecchia", false],
    ["in attesa", "p-u-vecchia", false],
    ["senza documento", "p-u-vecchia", false],
    ["anonimo", "p-u-vecchia", false],
  ];
  for (const [who, uid, allow, exists] of cells) {
    test(`${who} legge la nota di ${uid}: ${allow ? "permesso" : "negato"}`, async () => {
      const p = P[who];
      if (!allow) {
        await expectDenied(getDocFromServer(noteDoc(p, uid)), `${who} nota di ${uid}`);
        return;
      }
      const snap = await getDocFromServer(noteDoc(p, uid));
      assert.equal(snap.exists(), exists);
      if (exists) assert.equal(snap.get("kind"), "same_name_birth");
    });
  }

  test("admin e dirigente di U leggono la nota della persona in attesa (account vero)", async () => {
    const uid = P["in attesa"].uid;
    assert.equal((await getDocFromServer(noteDoc(P["admin del palo"], uid))).get("kind"), "same_name_birth");
    assert.equal((await getDocFromServer(noteDoc(P["dirigente di U"], uid))).get("kind"), "same_name_birth");
    await expectDenied(getDocFromServer(noteDoc(P["dirigente di V"], uid)), "dirigente di V");
  });

  test("il richiedente non legge mai la nota su di sé", async () => {
    const p = P["in attesa"];
    await expectDenied(getDocFromServer(noteDoc(p, p.uid)), "richiedente");
    await expectDenied(getDocFromServer(doc(p.db, `${MEMBERS}/${p.uid}/staff/qualunque`)), "richiedente, altro id");
  });

  test("nota di una persona senza documento members: admin permesso (non esiste), dirigente negato", async () => {
    const snap = await getDocFromServer(noteDoc(P["admin del palo"], "nessuno"));
    assert.equal(snap.exists(), false);
    await expectDenied(getDocFromServer(noteDoc(P["dirigente di U"], "nessuno")), "dirigente, members mancante");
  });

  test("le note non si elencano (list su staff): dirigente negato", async () => {
    await expectDenied(getDocsFromServer(collection(P["dirigente di U"].db, `${MEMBERS}/p-u-vecchia/staff`)), "list staff");
  });
});
