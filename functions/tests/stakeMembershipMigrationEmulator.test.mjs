// Script di migrazione A3 (functions/scripts/migrateStakeMembers.js) lanciato
// davvero, come processo, contro il Firestore emulator: dry-run che non scrive,
// --apply che crea i documenti attesi, secondo --apply che ne crea 0, members
// esistenti lasciati identici al byte. Regole della spec: docs/APPARTENENZA_AL_PALO.md,
// "### Migrazione (scelta A3)". La logica pura è in stakeMembershipMigration.test.mjs.
//
// Rilancio (solo emulatore Firestore, progetto demo-*):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --config firebase.membership-test.json --project demo-s2-migration \
//     'node --test --test-concurrency=1 functions/tests/stakeMembershipMigrationEmulator.test.mjs'
// Senza FIRESTORE_EMULATOR_HOST il file si salta: lo script, fuori dall'emulatore,
// userebbe le credenziali vere, e qui non deve succedere mai.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const SCRIPT = fileURLToPath(new URL("../scripts/migrateStakeMembers.js", import.meta.url));

const PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST || "";
const SKIP = EMULATOR ? false : "serve FIRESTORE_EMULATOR_HOST (firebase emulators:exec): mai contro credenziali vere";
if (EMULATOR) {
  assert.match(PROJECT, /^demo-/u, "Usare esclusivamente un progetto demo-*");
  assert.match(EMULATOR, /^(127\.0\.0\.1|localhost):\d+$/u, "Firestore Emulator locale richiesto");
}

let adminDb = null;
let Timestamp = null;
if (EMULATOR) {
  const { initializeApp } = require("firebase-admin/app");
  const firestore = require("firebase-admin/firestore");
  Timestamp = firestore.Timestamp;
  adminDb = firestore.getFirestore(initializeApp({ projectId: PROJECT }, `s2-migration-${Date.now()}`));
}

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const STAKE = `mig-a-${runId}`; // palo migrato
const OTHER = `mig-b-${runId}`; // palo vicino: non si deve toccare
const RACE = `mig-c-${runId}`; // palo per i due --apply in parallelo
const MISSING = `mig-assente-${runId}`;
const uid = (name) => `${name}-${runId}`;
const members = (stake) => adminDb.collection(`stakes/${stake}/members`);
const tmp = mkdtempSync(join(tmpdir(), "s2-migration-"));

/** Lancia lo script come processo figlio, con il solo ambiente dell'emulatore (mai credenziali). */
function runScript(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: { PATH: process.env.PATH, FIRESTORE_EMULATOR_HOST: EMULATOR, GCLOUD_PROJECT: PROJECT },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => {
      const lines = stdout.split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line));
      resolve({ code, stdout, stderr, summary: lines[0] ?? null, result: lines[1] ?? null });
    });
  });
}

const profile = (name, over = {}) => ({
  firstName: name,
  lastName: "Prova",
  fullName: `${name} Prova`,
  email: `${name}-${runId}@example.invalid`,
  role: "participant",
  birthDate: "2009-04-21",
  genderRoleCategory: "",
  unitId: "rione-1",
  unitName: "Rione Uno",
  stakeId: STAKE,
  stakeSlug: STAKE,
  stakeName: "Palo migrato",
  mustChangePassword: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastLoginAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

// Palo STAKE: 9 profili.
//   staff nuovi: admin, leader                         -> active + staffRole
//   con iscrizione viva: youthOwn (userId), parentChild (parentUid), guestLinked (anonymousUid)
//                                                        -> active + reviewNeeded
//   senza iscrizione viva: youthCancelled, youthNone     -> pending
//   già con members (da non toccare): decided (declined, decisione dello staff), staffRemoved (removed)
const EXPECTED = {
  admin: { status: "active", staffRole: "admin", reviewNeeded: false },
  leader: { status: "active", staffRole: "unit_leader", reviewNeeded: false },
  youthOwn: { status: "active", staffRole: null, reviewNeeded: true },
  parentChild: { status: "active", staffRole: null, reviewNeeded: true },
  guestLinked: { status: "active", staffRole: null, reviewNeeded: true },
  youthCancelled: { status: "pending", staffRole: null, reviewNeeded: false },
  youthNone: { status: "pending", staffRole: null, reviewNeeded: false },
};
const PRE_EXISTING = ["decided", "staffRemoved"];

async function seedStake(stake, { withRegistrations = true } = {}) {
  await adminDb.doc(`stakes/${stake}`).set({ name: stake, slug: stake, isActive: true });
  await adminDb.doc(`stakes/${stake}/activities/viaggio`).set({ title: "Viaggio al tempio", activityType: "trip", isPublic: true });
  await adminDb.doc(`stakes/${stake}/activities/campo`).set({ title: "Campo estivo", activityType: "camp", isPublic: true });
  const people = [
    ["admin", { role: "admin", unitId: "", unitName: "" }],
    ["leader", { role: "unit_leader" }],
    ["youthOwn", {}],
    ["parentChild", { role: "parent", birthDate: "" }],
    ["guestLinked", {}],
    ["youthCancelled", {}],
    ["youthNone", { unitId: "", unitName: "" }],
    ["decided", {}],
    ["staffRemoved", { role: "admin" }],
  ];
  await Promise.all(people.map(([name, over]) => adminDb.doc(`users/${uid(`${stake}-${name}`)}`).set(profile(name, { ...over, stakeId: stake }))));
  if (!withRegistrations) return;
  const reg = (activityId, id, data) => adminDb.doc(`stakes/${stake}/activities/${activityId}/registrations/${id}`).set({ registrationStatus: "confirmed", ...data });
  await Promise.all([
    reg("viaggio", `user_${uid(`${stake}-youthOwn`)}`, { userId: uid(`${stake}-youthOwn`) }),
    reg("campo", `user_${uid(`${stake}-youthOwn`)}`, { userId: uid(`${stake}-youthOwn`) }),
    reg("viaggio", `child_${uid(`${stake}-parentChild`)}_k1`, { parentUid: uid(`${stake}-parentChild`) }),
    reg("viaggio", `guest_${uid(`${stake}-guestLinked`)}`, { anonymousUid: uid(`${stake}-guestLinked`) }),
    reg("viaggio", `user_${uid(`${stake}-youthCancelled`)}`, { userId: uid(`${stake}-youthCancelled`), registrationStatus: "cancelled" }),
    reg("viaggio", `guest_ospite-senza-profilo`, { anonymousUid: `ospite-senza-profilo-${runId}` }),
    reg("viaggio", `manual_${runId}`, { fullName: "Iscritto a mano" }),
    reg("viaggio", `user_${uid(`${stake}-decided`)}`, { userId: uid(`${stake}-decided`) }),
  ]);
}

/** Tutti i documenti members di un palo come {id: {data, updateTime}}, per confronti byte a byte. */
async function snapshotMembers(stake) {
  const snap = await members(stake).get();
  return Object.fromEntries(snap.docs.map((item) => [item.id, { data: item.data(), updateTime: item.updateTime.toMillis() }]));
}

before(async () => {
  await seedStake(STAKE);
  await seedStake(OTHER);
  await seedStake(RACE);
  // Due documenti già decisi dallo staff: la migrazione non deve né toccarli né ricrearli.
  await members(STAKE).doc(uid(`${STAKE}-decided`)).set({
    status: "declined", sources: [{ kind: "staff_approval", ref: "x", at: Timestamp.fromMillis(1_700_000_000_000) }], previous: null,
    staffRole: null, claimedUnitId: "rione-9", claimedUnitName: "Rione Nove", displayName: "Deciso Dallo Staff", birthYear: 2001,
    registrationHints: [], reviewNeeded: false, requestedAt: Timestamp.fromMillis(1_700_000_000_000), decidedAt: Timestamp.fromMillis(1_700_000_100_000),
    decidedBy: "admin-x", declineCount: 2, version: 7,
  });
  await members(STAKE).doc(uid(`${STAKE}-staffRemoved`)).set({
    status: "removed", sources: [], previous: { status: "active" }, staffRole: "admin", claimedUnitId: "", claimedUnitName: "",
    displayName: "Admin Rimosso", birthYear: null, registrationHints: [], reviewNeeded: false,
    requestedAt: Timestamp.fromMillis(1_700_000_000_000), decidedAt: Timestamp.fromMillis(1_700_000_200_000), decidedBy: "admin-y", declineCount: 0, version: 3,
  });
});

after(async () => {
  for (const stake of [STAKE, OTHER, RACE]) {
    await adminDb.recursiveDelete(adminDb.doc(`stakes/${stake}`));
    const users = await adminDb.collection("users").where("stakeId", "==", stake).get();
    await Promise.all(users.docs.map((item) => item.ref.delete()));
  }
  rmSync(tmp, { recursive: true, force: true });
  if (adminDb) await adminDb.terminate();
});

describe("migrateStakeMembers.js nell'emulatore", { skip: SKIP }, () => {
  let beforeAll;
  let afterFirstApply;

  test("senza --apply è un dry-run: stampa i conteggi e non scrive niente", async () => {
    beforeAll = await snapshotMembers(STAKE);
    assert.deepEqual(Object.keys(beforeAll).sort(), PRE_EXISTING.map((name) => uid(`${STAKE}-${name}`)).sort());
    const run = await runScript(["--stake", STAKE]);
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.summary.mode, "dry-run");
    assert.equal(run.summary.stake, STAKE);
    assert.equal(run.summary.project, PROJECT);
    assert.equal(run.summary.users, 9);
    assert.equal(run.summary.staff, 2);
    assert.equal(run.summary.registered, 3);
    assert.equal(run.summary.queued, 2);
    assert.equal(run.summary.alreadyMember, 2);
    assert.equal(run.summary.toCreate, 7);
    assert.equal(run.result, null, "il dry-run non stampa il risultato di una scrittura");
    assert.deepEqual(await snapshotMembers(STAKE), beforeAll, "nessun documento members è nato o cambiato");
    assert.equal((await members(OTHER).get()).size, 0);
  });

  test("--report scrive il piano in un file riservato (0600) e non scrive su Firestore", async () => {
    const report = join(tmp, "piano.json");
    const run = await runScript(["--stake", STAKE, "--report", report]);
    assert.equal(run.code, 0, run.stderr);
    const content = JSON.parse(readFileSync(report, "utf8"));
    assert.equal(content.stake, STAKE);
    assert.equal(content.rows.length, 7);
    assert.equal(statSync(report).mode & 0o777, 0o600);
    assert.deepEqual(await snapshotMembers(STAKE), beforeAll);
  });

  test("--apply con --expect-create sbagliato si ferma senza scrivere", async () => {
    const run = await runScript(["--stake", STAKE, "--apply", "--expect-create", "5"]);
    assert.equal(run.code, 1);
    assert.match(run.stderr, /Nessuna scrittura/u);
    assert.deepEqual(await snapshotMembers(STAKE), beforeAll);
  });

  test("--apply --expect-create 7 crea i 7 documenti attesi, sources[0].at e requestedAt sono Timestamp", async () => {
    const startedAt = Date.now();
    const run = await runScript(["--stake", STAKE, "--apply", "--expect-create", "7"]);
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.summary.mode, "apply");
    assert.deepEqual(run.result, { created: 7, alreadyExisting: 0 });
    afterFirstApply = await snapshotMembers(STAKE);
    assert.equal(Object.keys(afterFirstApply).length, 9);

    for (const [name, expected] of Object.entries(EXPECTED)) {
      const doc = afterFirstApply[uid(`${STAKE}-${name}`)]?.data;
      assert.ok(doc, `${name}: documento mancante`);
      assert.equal(doc.status, expected.status, `${name}: status`);
      assert.equal(doc.staffRole, expected.staffRole, `${name}: staffRole`);
      assert.equal(doc.reviewNeeded, expected.reviewNeeded, `${name}: reviewNeeded`);
      assert.equal(doc.version, 1);
      assert.equal(doc.declineCount, 0);
      assert.equal(doc.previous, null);
      // Dentro un array non c'è il segnaposto serverTimestamp: un Timestamp vero.
      assert.equal(doc.sources.length, 1);
      assert.equal(doc.sources[0].kind, "migration");
      assert.equal(doc.sources[0].ref, "a3-2026-10");
      assert.ok(doc.sources[0].at instanceof Timestamp, `${name}: sources[0].at deve essere un Timestamp`);
      assert.ok(doc.sources[0].at.toMillis() >= startedAt - 5_000 && doc.sources[0].at.toMillis() <= Date.now() + 5_000, `${name}: sources[0].at recente`);
      // Primo livello: timestamp del server.
      assert.ok(doc.requestedAt instanceof Timestamp, `${name}: requestedAt deve essere un Timestamp`);
      assert.ok(Math.abs(doc.requestedAt.toMillis() - Date.now()) < 60_000, `${name}: requestedAt dal server, recente`);
      if (expected.status === "active") {
        assert.ok(doc.decidedAt instanceof Timestamp);
        assert.equal(doc.decidedBy, "system");
        assert.ok(doc.decidedAt.isEqual(doc.requestedAt), `${name}: stessa scrittura, stesso timestamp del server`);
      } else {
        assert.equal(doc.decidedAt, null);
        assert.equal(doc.decidedBy, null);
      }
    }
  });

  test("i documenti hanno i dati copiati dal profilo e i suggerimenti di iscrizione", async () => {
    const docOf = (name) => afterFirstApply[uid(`${STAKE}-${name}`)].data;
    assert.equal(docOf("youthOwn").displayName, "youthOwn Prova");
    assert.equal(docOf("youthOwn").birthYear, 2009);
    assert.equal(docOf("youthOwn").claimedUnitId, "rione-1");
    assert.equal(docOf("youthOwn").claimedUnitName, "Rione Uno");
    assert.deepEqual(docOf("youthOwn").registrationHints.map((hint) => hint.activityId).sort(), ["campo", "viaggio"]);
    assert.deepEqual(
      docOf("youthOwn").registrationHints.map((hint) => hint.title).sort(),
      ["Campo estivo", "Viaggio al tempio"],
    );
    assert.deepEqual(docOf("parentChild").registrationHints, [{ activityId: "viaggio", title: "Viaggio al tempio" }]);
    assert.equal(docOf("parentChild").birthYear, null, "data di nascita vuota -> null");
    assert.deepEqual(docOf("guestLinked").registrationHints, [{ activityId: "viaggio", title: "Viaggio al tempio" }]);
    assert.deepEqual(docOf("youthCancelled").registrationHints, [], "l'iscrizione annullata non è un suggerimento");
    assert.equal(docOf("youthNone").claimedUnitId, "");
    assert.equal(docOf("admin").claimedUnitId, "");
    assert.equal(docOf("leader").staffRole, "unit_leader");
    assert.equal(JSON.stringify(docOf("youthOwn")).includes("2009-04-21"), false, "niente data completa");
  });

  test("i members già esistenti restano identici al byte, anche l'ora di ultima modifica", async () => {
    for (const name of PRE_EXISTING) {
      const id = uid(`${STAKE}-${name}`);
      assert.deepEqual(afterFirstApply[id].data, beforeAll[id].data, `${name}: dati`);
      assert.equal(afterFirstApply[id].updateTime, beforeAll[id].updateTime, `${name}: updateTime`);
    }
    assert.equal(afterFirstApply[uid(`${STAKE}-decided`)].data.status, "declined");
    assert.equal(afterFirstApply[uid(`${STAKE}-decided`)].data.version, 7);
    assert.equal(afterFirstApply[uid(`${STAKE}-staffRemoved`)].data.status, "removed");
  });

  test("il palo vicino e le sessioni ospite senza profilo non ricevono nessun documento", async () => {
    assert.equal((await members(OTHER).get()).size, 0);
    assert.equal((await members(RACE).get()).size, 0);
    const ids = Object.keys(afterFirstApply);
    assert.equal(ids.some((id) => id.startsWith("ospite-senza-profilo")), false);
  });

  test("secondo --apply: 0 documenti da creare, niente cambia", async () => {
    const run = await runScript(["--stake", STAKE, "--apply", "--expect-create", "0"]);
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.summary.toCreate, 0);
    assert.equal(run.summary.alreadyMember, 9);
    assert.deepEqual(run.result, { created: 0, alreadyExisting: 0 });
    assert.deepEqual(await snapshotMembers(STAKE), afterFirstApply, "dati e updateTime identici");
  });

  test("anche un --apply senza --expect-create (facoltativo nell'emulatore) non crea nulla di nuovo", async () => {
    const run = await runScript(["--stake", STAKE, "--apply"]);
    assert.equal(run.code, 0, run.stderr);
    assert.deepEqual(run.result, { created: 0, alreadyExisting: 0 });
    assert.deepEqual(await snapshotMembers(STAKE), afterFirstApply);
  });

  test("dopo --apply un nuovo account entra nel piano successivo e gli altri restano com'erano", async () => {
    const fresh = uid("nuovo-account");
    await adminDb.doc(`users/${fresh}`).set(profile("nuovo", { stakeId: STAKE }));
    const dry = await runScript(["--stake", STAKE]);
    assert.equal(dry.summary.toCreate, 1);
    assert.equal(dry.summary.queued, 1);
    const run = await runScript(["--stake", STAKE, "--apply", "--expect-create", "1"]);
    assert.deepEqual(run.result, { created: 1, alreadyExisting: 0 });
    const now = await snapshotMembers(STAKE);
    assert.equal(now[fresh].data.status, "pending");
    for (const [id, value] of Object.entries(afterFirstApply)) assert.deepEqual(now[id], value, `${id} invariato`);
    await adminDb.doc(`users/${fresh}`).delete();
  });

  test("due --apply in parallelo non si sovrascrivono: create() fallisce sul documento nato nel frattempo", async () => {
    const [first, second] = await Promise.all([runScript(["--stake", RACE, "--apply"]), runScript(["--stake", RACE, "--apply"])]);
    assert.equal(first.code, 0, first.stderr);
    assert.equal(second.code, 0, second.stderr);
    // Nel palo RACE nessuno ha già un members: 9 profili, 9 documenti, ognuno nato una volta sola.
    assert.equal(first.result.created + second.result.created, 9, "ogni documento nasce una volta sola");
    for (const run of [first, second]) {
      assert.equal(run.result.created + run.result.alreadyExisting, run.summary.toCreate, "ogni create() o riesce o trova il documento già nato");
    }
    const docs = await snapshotMembers(RACE);
    assert.equal(Object.keys(docs).length, 9);
    for (const [id, value] of Object.entries(docs)) assert.equal(value.data.version, 1, `${id}: scritto una volta sola`);
  });

  test("argomenti sbagliati: nessun default, nessuna scrittura", async () => {
    const reference = await snapshotMembers(STAKE);
    const missing = await runScript([]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /--stake/u);
    const slash = await runScript(["--stake", "a/b"]);
    assert.equal(slash.code, 1);
    const unknown = await runScript(["--stake", STAKE, "--boh"]);
    assert.equal(unknown.code, 1);
    assert.match(unknown.stderr, /sconosciuto/u);
    assert.deepEqual(await snapshotMembers(STAKE), reference);
  });

  test("palo inesistente: errore, exit 1 e nessun documento", async () => {
    const run = await runScript(["--stake", MISSING, "--apply"]);
    assert.equal(run.code, 1);
    assert.match(run.stderr, /Palo non trovato/u);
    assert.equal((await members(MISSING).get()).size, 0);
  });
});
