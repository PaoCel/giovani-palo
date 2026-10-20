// Script S2-1 (functions/scripts/cleanupGalleryCodes.js) lanciato davvero, come
// processo, contro il Firestore emulator: dry-run che non scrive e stampa i
// conteggi, --apply che porta le gallerie `code_required` a `open` e cancella
// gallerySecrets, galleries/*/members e users/*/unlockedGalleries in due pali,
// secondo --apply che non trova più nulla, --expect-* sbagliati che fermano
// tutto con exit 2, e i `stakes/*/members` di S2 identici al byte. Regole:
// docs/APPARTENENZA_AL_PALO.md, «Script S2-1». Scritto prima del codice.
//
// Rilancio (basta l'emulatore Firestore; progetto demo-*):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --only firestore --config firebase.membership-functions-test.json --project demo-s2-functions \
//     'node --test --test-concurrency=1 functions/tests/galleryCodesCleanupEmulator.test.mjs'
// Senza FIRESTORE_EMULATOR_HOST il file si salta: lo script, fuori dall'emulatore,
// userebbe le credenziali vere, e qui non deve succedere mai.
//
// Interpretazioni scelte (la più stretta): `deletes` è la somma di
// gallerySecrets, galleryMembers e unlockedGalleries; una galleria senza
// `accessMode` conta in `codeGalleries` e diventa `open`; il dry-run stampa UNA
// riga JSON e basta; nell'emulatore gli --expect-* sono facoltativi ma, se
// passati e sbagliati, fermano lo script (exit 2) anche qui; fuori
// dall'emulatore `--apply` senza --expect-* esce con 2 PRIMA di qualunque
// lettura (provato senza FIRESTORE_EMULATOR_HOST e con credenziali
// inesistenti: nessuna rete verso un progetto vero); un argomento sconosciuto
// fa uscire con codice diverso da 0 senza scrivere.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const SCRIPT = fileURLToPath(new URL("../scripts/cleanupGalleryCodes.js", import.meta.url));

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
  adminDb = firestore.getFirestore(initializeApp({ projectId: PROJECT }, `s2-gallery-codes-${Date.now()}`));
}

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const STAKE_1 = `gc-a-${runId}`;
const STAKE_2 = `gc-b-${runId}`;
const uid = (name) => `${name}-${runId}`;
const iso = () => new Date().toISOString();

const EMULATOR_ENV = () => ({ PATH: process.env.PATH, FIRESTORE_EMULATOR_HOST: EMULATOR, GCLOUD_PROJECT: PROJECT });
// Fuori dall'emulatore, per la sola guardia di --apply: niente host, credenziali che non esistono.
const NO_EMULATOR_ENV = () => ({ PATH: process.env.PATH, GCLOUD_PROJECT: PROJECT, GOOGLE_APPLICATION_CREDENTIALS: "/nonexistent" });

/** Lancia lo script come processo figlio, con il solo ambiente dell'emulatore (mai credenziali). */
function runScript(args, env = EMULATOR_ENV()) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}`, summary: null, lines: [] }));
    child.on("close", (code) => {
      const lines = stdout
        .split("\n")
        .filter((line) => line.trim().startsWith("{"))
        .map((line) => JSON.parse(line));
      resolve({ code, stdout, stderr, summary: lines[0] ?? null, lines });
    });
  });
}

const COUNT_KEYS = ["codeGalleries", "gallerySecrets", "galleryMembers", "unlockedGalleries", "deletes"];
// Gallerie con codice: g1 e g3 (`code_required`) più g4, senza `accessMode` (la PWA vecchia la tratta come con codice).
const EXPECTED = { codeGalleries: 3, gallerySecrets: 3, galleryMembers: 4, unlockedGalleries: 3, deletes: 10 };

// ---------------------------------------------------------------------------
// Seed: due pali, tre gallerie (due con codice), segreti, sblocchi, members di S2
// ---------------------------------------------------------------------------
const gallery = (stake, id, accessMode, extra = {}) =>
  adminDb.doc(`stakes/${stake}/galleries/${id}`).set({
    title: `Galleria ${id}`,
    description: "",
    activityId: `act-${id}`,
    createdBy: "seed",
    createdAt: iso(),
    updatedAt: iso(),
    published: true,
    mediaCount: 3,
    ...(accessMode === null ? {} : { accessMode }),
    codeStatus: accessMode === "code_required" ? "set" : "missing",
    likeCount: 0,
    ...extra,
  });

const memberS2 = (stake, id, status) =>
  adminDb.doc(`stakes/${stake}/members/${id}`).set({
    status,
    sources: [{ kind: "migration", ref: "a3-2026-10", at: Timestamp.fromMillis(1_700_000_000_000) }],
    previous: null,
    staffRole: null,
    claimedUnitId: "rione-1",
    claimedUnitName: "Rione Uno",
    displayName: "Persona Prova",
    birthYear: 2009,
    registrationHints: [],
    reviewNeeded: false,
    requestedAt: Timestamp.fromMillis(1_700_000_000_000),
    decidedAt: status === "active" ? Timestamp.fromMillis(1_700_000_100_000) : null,
    decidedBy: status === "active" ? "system" : null,
    declineCount: 0,
    version: 1,
  });

/** Profilo minimo, senza palo scelto: un eventuale trigger su users non ha nulla da fare. */
const user = (id) =>
  adminDb.doc(`users/${id}`).set({
    firstName: id,
    lastName: "Prova",
    fullName: `${id} Prova`,
    email: null,
    role: "participant",
    birthDate: "",
    genderRoleCategory: "",
    unitId: "",
    unitName: "",
    stakeId: "",
    stakeSlug: "",
    stakeName: "",
    mustChangePassword: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastLoginAt: "2026-01-01T00:00:00.000Z",
  });

async function seed() {
  await Promise.all([STAKE_1, STAKE_2].map((stake) => adminDb.doc(`stakes/${stake}`).set({ name: stake, slug: stake, isActive: true })));
  await Promise.all([
    gallery(STAKE_1, "g1", "code_required"),
    gallery(STAKE_1, "g2", "open"),
    gallery(STAKE_2, "g3", "code_required"),
    gallery(STAKE_2, "g4", null),
  ]);
  await Promise.all([
    // Segreti: due gallerie con codice e uno rimasto su una galleria già aperta.
    adminDb.doc(`stakes/${STAKE_1}/gallerySecrets/g1`).set({ code: "SEGRETO-1", createdAt: iso() }),
    adminDb.doc(`stakes/${STAKE_1}/gallerySecrets/g2`).set({ code: "VECCHIO", createdAt: iso() }),
    adminDb.doc(`stakes/${STAKE_2}/gallerySecrets/g3`).set({ code: "SEGRETO-3", createdAt: iso() }),
    // Sblocchi per galleria (codici vecchi): 4.
    adminDb.doc(`stakes/${STAKE_1}/galleries/g1/members/${uid("u1")}`).set({ unlockedAt: iso() }),
    adminDb.doc(`stakes/${STAKE_1}/galleries/g1/members/${uid("u2")}`).set({ unlockedAt: iso() }),
    adminDb.doc(`stakes/${STAKE_1}/galleries/g2/members/${uid("u3")}`).set({ unlockedAt: iso() }),
    adminDb.doc(`stakes/${STAKE_2}/galleries/g3/members/${uid("u4")}`).set({ unlockedAt: iso() }),
    // Un media: le altre sottocollezioni della galleria non si toccano.
    adminDb.doc(`stakes/${STAKE_1}/galleries/g1/media/m1`).set({ type: "image", uploadedBy: uid("u1"), createdAt: iso() }),
    // Profili e specchio degli sblocchi: 3.
    ...["u1", "u2", "u3", "u4", "u5"].map((name) => user(uid(name))),
    // Appartenenza S2: non si tocca.
    memberS2(STAKE_1, uid("u1"), "active"),
    memberS2(STAKE_1, uid("u5"), "active"),
    memberS2(STAKE_2, uid("u4"), "pending"),
  ]);
  await Promise.all([
    adminDb.doc(`users/${uid("u1")}/unlockedGalleries/g1`).set({ galleryId: "g1", stakeId: STAKE_1, unlockedAt: iso() }),
    adminDb.doc(`users/${uid("u1")}/unlockedGalleries/g3`).set({ galleryId: "g3", stakeId: STAKE_2, unlockedAt: iso() }),
    adminDb.doc(`users/${uid("u2")}/unlockedGalleries/g1`).set({ galleryId: "g1", stakeId: STAKE_1, unlockedAt: iso() }),
  ]);
}

/** Tutti i documenti del giro come {path: {data, updateTime}}, per confronti byte a byte. */
async function snapshotAll() {
  const out = {};
  const add = async (ref) => {
    const snap = await ref.get();
    if (snap.exists) out[ref.path] = { data: snap.data(), updateTime: snap.updateTime.toMillis() };
  };
  const addCollection = async (path) => {
    const snap = await adminDb.collection(path).get();
    for (const item of snap.docs) out[item.ref.path] = { data: item.data(), updateTime: item.updateTime.toMillis() };
    return snap.docs.map((item) => item.ref.path);
  };
  for (const stake of [STAKE_1, STAKE_2]) {
    await add(adminDb.doc(`stakes/${stake}`));
    const galleries = await addCollection(`stakes/${stake}/galleries`);
    for (const galleryPath of galleries) {
      await addCollection(`${galleryPath}/members`);
      await addCollection(`${galleryPath}/media`);
    }
    await addCollection(`stakes/${stake}/gallerySecrets`);
    await addCollection(`stakes/${stake}/members`);
  }
  for (const name of ["u1", "u2", "u3", "u4", "u5"]) {
    await add(adminDb.doc(`users/${uid(name)}`));
    await addCollection(`users/${uid(name)}/unlockedGalleries`);
  }
  return out;
}
const pick = (snapshot, matcher) => Object.fromEntries(Object.entries(snapshot).filter(([path]) => matcher(path)));
const isS2Member = (path) => /^stakes\/[^/]+\/members\//u.test(path);

before(async () => {
  if (!EMULATOR) return;
  await seed();
});

after(async () => {
  if (!adminDb) return;
  for (const stake of [STAKE_1, STAKE_2]) await adminDb.recursiveDelete(adminDb.doc(`stakes/${stake}`));
  for (const name of ["u1", "u2", "u3", "u4", "u5"]) await adminDb.recursiveDelete(adminDb.doc(`users/${uid(name)}`));
  await adminDb.terminate();
});

describe("cleanupGalleryCodes.js nell'emulatore", { skip: SKIP }, () => {
  let beforeAll;
  let afterApply;

  test("senza --apply è un dry-run: una riga JSON con i conteggi giusti e nessuna scrittura", async () => {
    beforeAll = await snapshotAll();
    const run = await runScript([]);
    assert.equal(run.code, 0, run.stderr);
    assert.ok(run.summary, `nessuna riga JSON: ${run.stdout}`);
    for (const key of COUNT_KEYS) assert.equal(run.summary[key], EXPECTED[key], `${key}: ${JSON.stringify(run.summary)}`);
    assert.equal(run.lines.length, 1, "il dry-run stampa una riga sola");
    assert.deepEqual(await snapshotAll(), beforeAll, "nessun documento è cambiato");
  });

  test("--apply con --expect-* diversi dal dry-run: exit 2 e niente scritto", async () => {
    const wrongGalleries = await runScript(["--apply", "--expect-galleries", "2", "--expect-deletes", "10"]);
    assert.equal(wrongGalleries.code, 2, wrongGalleries.stderr);
    const wrongDeletes = await runScript(["--apply", "--expect-galleries", "3", "--expect-deletes", "9"]);
    assert.equal(wrongDeletes.code, 2, wrongDeletes.stderr);
    assert.deepEqual(await snapshotAll(), beforeAll, "nessun documento è cambiato");
  });

  test("fuori dall'emulatore --apply senza --expect-* esce con 2 prima di qualunque lettura (credenziali inesistenti, nessuna rete)", async () => {
    const startedAt = Date.now();
    const run = await runScript(["--apply"], NO_EMULATOR_ENV());
    assert.equal(run.code, 2, `exit ${run.code}: ${run.stderr}`);
    assert.ok(Date.now() - startedAt < 15_000, "la guardia scatta subito, senza tentare la rete");
    assert.doesNotMatch(run.stderr, /nonexistent|ENOENT|credential/iu, `ha provato le credenziali prima della guardia: ${run.stderr}`);
    assert.deepEqual(await snapshotAll(), beforeAll, "nessun documento è cambiato nell'emulatore");
  });

  test("--apply con i numeri del dry-run: gallerie aperte (anche quella senza accessMode), segreti e sblocchi cancellati in tutti e due i pali", async () => {
    const run = await runScript(["--apply", "--expect-galleries", "3", "--expect-deletes", "10"]);
    assert.equal(run.code, 0, run.stderr);
    afterApply = await snapshotAll();

    assert.equal(beforeAll[`stakes/${STAKE_2}/galleries/g4`].data.accessMode, undefined, "premessa: g4 nasce senza accessMode");
    for (const [stake, id] of [[STAKE_1, "g1"], [STAKE_2, "g3"], [STAKE_2, "g4"]]) {
      const data = afterApply[`stakes/${stake}/galleries/${id}`]?.data;
      assert.ok(data, `${id}: galleria sparita`);
      assert.equal(data.accessMode, "open", `${id}: accessMode`);
      assert.equal(data.title, `Galleria ${id}`, `${id}: gli altri campi restano`);
      assert.equal(data.mediaCount, 3);
    }
    assert.deepEqual(afterApply[`stakes/${STAKE_1}/galleries/g2`], beforeAll[`stakes/${STAKE_1}/galleries/g2`], "la galleria già aperta non si riscrive");
    assert.ok(afterApply[`stakes/${STAKE_1}/galleries/g1/media/m1`], "i media restano");

    const gone = (path) => /\/gallerySecrets\/|\/galleries\/[^/]+\/members\/|\/unlockedGalleries\//u.test(path);
    assert.deepEqual(Object.keys(pick(afterApply, gone)), [], "segreti, sblocchi per galleria e specchio utente spariti");
    assert.equal(Object.keys(pick(beforeAll, gone)).length, EXPECTED.deletes, "premessa: il seed aveva proprio 10 documenti da cancellare");
    for (const name of ["u1", "u2", "u3", "u4", "u5"]) {
      assert.deepEqual(afterApply[`users/${uid(name)}`], beforeAll[`users/${uid(name)}`], `${name}: profilo intatto`);
    }
  });

  test("i members di S2 (stakes/*/members) restano identici al byte, anche l'ora di ultima modifica", () => {
    const before = pick(beforeAll, isS2Member);
    assert.equal(Object.keys(before).length, 3, "premessa: tre members di S2 nel seed");
    assert.deepEqual(pick(afterApply, isS2Member), before);
  });

  test("dopo l'apply il dry-run conta 0 e il secondo --apply (senza --expect-*, ammesso nell'emulatore) non cambia nulla", async () => {
    const dry = await runScript([]);
    assert.equal(dry.code, 0, dry.stderr);
    for (const key of COUNT_KEYS) assert.equal(dry.summary[key], 0, `${key}: ${JSON.stringify(dry.summary)}`);
    const again = await runScript(["--apply"]);
    assert.equal(again.code, 0, again.stderr);
    assert.deepEqual(await snapshotAll(), afterApply, "idempotente: dati e updateTime identici");
    const withExpect = await runScript(["--apply", "--expect-galleries", "0", "--expect-deletes", "0"]);
    assert.equal(withExpect.code, 0, withExpect.stderr);
    assert.deepEqual(await snapshotAll(), afterApply);
  });

  test("argomento sconosciuto: esce con errore e non scrive", async () => {
    await adminDb.doc(`stakes/${STAKE_1}/gallerySecrets/g9`).set({ code: "RIMASTO", createdAt: iso() });
    const reference = await snapshotAll();
    const run = await runScript(["--boh"]);
    assert.notEqual(run.code, 0, "argomento sconosciuto accettato");
    assert.deepEqual(await snapshotAll(), reference);
    await adminDb.doc(`stakes/${STAKE_1}/gallerySecrets/g9`).delete();
  });
});
