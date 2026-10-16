// Migrazione di bucket Storage (tools/migrate-storage-bucket.mjs) provata end-to-end
// contro gli emulatori Firestore e Storage: seed con l'Admin SDK, poi la CLI vera
// lanciata come processo figlio (fasi sync / rewrite / verify, dry-run, --apply,
// checkpoint JSONL, --max-deletes). L'Admin SDK serve solo per seminare e per
// ispezionare lo stato; la CLI parla agli emulatori con il bearer "owner".
//
// Rilancio dalla radice del repository (Firestore 8180, Storage 9299; niente Auth né
// Functions, quindi `--only firestore,storage`). Progetto demo-storage-migration:
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --only firestore,storage --config firebase.multistake-test.json \
//     --project demo-storage-migration \
//     'node --test --test-concurrency=1 functions/tests/storageMigrationEmulator.test.mjs'
// Con le porte occupate da un'altra sessione non fermarla: copia la config su porte
// diverse in un file temporaneo (il test legge gli host dalle variabili d'ambiente che
// imposta emulators:exec) e rimuovilo a fine prova.
//
// I passi sono in sequenza e dipendono l'uno dall'altro (come i passaggi veri della
// migrazione): il checkpoint e i bucket restano fra un passo e il successivo.
// I bucket, i documenti e il checkpoint sono unici per esecuzione (runId) e vengono
// ripuliti alla fine, così il test si può lanciare anche su un emulatore già in uso.
//
// Nota sull'emulatore: su setMetadata lo Storage emulator ACCODA i token di download
// (firebaseStorageDownloadTokens) invece di sostituirli, come fa invece la produzione.
// Per questo i controlli sui token cambiati confrontano la destinazione con la
// sorgente (che è ciò che la sincronizzazione deve rispecchiare) e non con un
// valore fisso.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { deleteApp, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

// ---------------------------------------------------------------------------
// Guardie: mai fuori dagli emulatori locali
// ---------------------------------------------------------------------------
const PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
const STORAGE_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || "";
assert.equal(PROJECT, "demo-storage-migration", "Usare esclusivamente il progetto demo-storage-migration");
assert.match(FIRESTORE_HOST, /^(127\.0\.0\.1|localhost):\d+$/, "Firestore Emulator in locale");
assert.match(STORAGE_HOST, /^(127\.0\.0\.1|localhost):\d+$/, "Storage Emulator in locale");

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tools/migrate-storage-bucket.mjs");

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const OLD = `${PROJECT}-${runId}.appspot.com`;
const NEW = `${PROJECT}-${runId}-eu`;
const STAKE = `migr-${runId}`;
const USER_DOC = `users/migr-${runId}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "storage-migration-"));
// Cartella inesistente di proposito: il dry-run non deve crearla, l'apply sì.
const CK_DIR = path.join(TMP, "non-ancora-creata");
const CK = path.join(CK_DIR, "checkpoint.jsonl");

const app = initializeApp({ projectId: PROJECT, storageBucket: OLD }, `storage-migration-${runId}`);
const db = getFirestore(app);
const oldB = getStorage(app).bucket(OLD);
const newB = getStorage(app).bucket(NEW);

const emuUrl = (bucket, p, token) => `http://${STORAGE_HOST}/v0/b/${bucket}/o/${encodeURIComponent(p)}?alt=media&token=${token}`;
const prodUrl = (bucket, p, token) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(p)}?alt=media&token=${token}`;

/** Lancia la CLI contro gli emulatori. Ritorna { code, out } con stdout e stderr insieme. */
function run(extraArgs, { env = process.env, checkpoint = CK, base = ["--project", PROJECT, "--from", OLD, "--to", NEW] } = {}) {
  const args = [CLI, ...base, ...(checkpoint ? ["--checkpoint", checkpoint] : []), ...extraArgs];
  const r = spawnSync(process.execPath, args, { encoding: "utf8", env });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Riga di report "HH:MM:SS TAG {json}" scritta dalla CLI. */
function report(out, tag) {
  const m = out.match(new RegExp(`^\\d{2}:\\d{2}:\\d{2} ${tag} (\\{.*\\})$`, "m"));
  assert.ok(m, `riga ${tag} assente nell'output:\n${out}`);
  return JSON.parse(m[1]);
}

const exists = async (bucket, p) => (await bucket.file(p).exists())[0];
const meta = async (bucket, p) => (await bucket.file(p).getMetadata())[0];
const checkpointLines = () =>
  fs.existsSync(CK) ? fs.readFileSync(CK, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

// ---------------------------------------------------------------------------
// Dati di partenza
// ---------------------------------------------------------------------------
const tokens = {};
const media = [];
for (let i = 0; i < 6; i++) media.push(`protected/stakes/${STAKE}/galleries/g1/media/m${i}/foto ${i}.jpg`);
const PDF = `protected/stakes/${STAKE}/activities/a1/parent-authorization-pdfs/r1/autorizzazione.pdf`;
const CONSENT = `protected/stakes/${STAKE}/activities/a1/parent-consents/r1/consenso.pdf`;
const HERO = `public/stakes/${STAKE}/activities/a1/hero.png`;
const LATE = `protected/stakes/${STAKE}/galleries/g1/media/m9/tardiva.jpg`;
const FRESH = `protected/stakes/${STAKE}/galleries/g1/media/m20/nuova.jpg`;
const ALL_SEEDED = [...media, PDF, CONSENT, HERO];

const gallery = () => db.doc(`stakes/${STAKE}/galleries/g1`);
const registration = () => db.doc(`stakes/${STAKE}/activities/a1/registrations/r1`);

async function put(bucket, p, body, contentType, metadata) {
  await bucket.file(p).save(Buffer.from(body), { contentType, ...(metadata ? { metadata: { metadata } } : {}) });
}

let untouchedBefore;
let destSideToken;

describe("migrate-storage-bucket contro gli emulatori", () => {
  before(async () => {
    for (const [i, p] of media.entries()) {
      tokens[p] = randomUUID();
      await put(oldB, p, `img-${i}-` + "x".repeat(1000 * i), "image/jpeg", {
        firebaseStorageDownloadTokens: tokens[p],
        uploadedBy: "u1",
        mediaId: `m${i}`,
      });
    }
    await put(oldB, PDF, "%PDF-1.4 test", "application/pdf", { documentKind: "official" });
    tokens[CONSENT] = randomUUID();
    await put(oldB, CONSENT, "%PDF consent", "application/pdf", { firebaseStorageDownloadTokens: tokens[CONSENT] });
    tokens[HERO] = randomUUID();
    await put(oldB, HERO, "png", "image/png", { firebaseStorageDownloadTokens: tokens[HERO] });

    // Il documento stakes/<STAKE> NON esiste: le sottocollection sotto un genitore
    // "mancante" devono essere raggiunte lo stesso (showMissing nella CLI).
    await gallery().set({ title: "Viaggio", coverImageUrl: prodUrl(OLD, media[0], tokens[media[0]]) });
    for (const [i, p] of media.entries()) {
      await gallery().collection("media").doc(`m${i}`).set({
        storagePath: p,
        storageUrl: emuUrl(OLD, p, tokens[p]),
        thumbnailUrl: emuUrl(OLD, p, tokens[p]),
        likeCount: i,
      });
    }
    await gallery().collection("hiddenMedia").doc("m5").set({ storageUrl: emuUrl(OLD, media[5], tokens[media[5]]) });
    await db.doc(`stakes/${STAKE}/activities/a1`).set({
      heroImagePath: HERO,
      heroImageUrl: prodUrl(OLD, HERO, tokens[HERO]),
      title: "Tempio",
    });
    await registration().set({
      registrationStatus: "confirmed",
      parentConsentDocumentPath: CONSENT,
      parentConsentDocumentUrl: prodUrl(OLD, CONSENT, tokens[CONSENT]),
      parentAuthorization: { pdfPath: PDF, status: "authorized", nested: { docUrl: `gs://${OLD}/${PDF}`, keep: "x" } },
      attachments: [prodUrl(OLD, HERO, tokens[HERO]), "testo libero"],
      "weird-key": `https://storage.googleapis.com/${OLD}/${PDF}`,
    });
    await db.doc(USER_DOC).set({ name: "Nessun URL" });
    untouchedBefore = (await db.doc(USER_DOC).get()).updateTime.toMillis();
  });

  after(async () => {
    try {
      await db.recursiveDelete(db.doc(`stakes/${STAKE}`));
      await db.doc(USER_DOC).delete();
      await oldB.deleteFiles({ force: true });
      await newB.deleteFiles({ force: true });
    } catch (e) {
      console.warn("pulizia incompleta:", e.message);
    }
    fs.rmSync(TMP, { recursive: true, force: true });
    await deleteApp(app);
  });

  // -------------------------------------------------------------------------
  test("argomenti: senza --project, con --from uguale a --to o con una fase sconosciuta esce con 2 e non tocca niente", () => {
    const base = ["--project", PROJECT, "--from", OLD, "--to", NEW];
    for (const args of [
      [CLI, "--from", OLD, "--to", NEW],
      [CLI, "--project", PROJECT, "--to", NEW],
      [CLI, "--project", PROJECT, "--from", OLD],
      [CLI, "--project", PROJECT, "--from", OLD, "--to", OLD],
      [CLI, ...base, "--phase", "inesistente"],
    ]) {
      const r = spawnSync(process.execPath, args, { encoding: "utf8", env: process.env });
      assert.equal(r.status, 2, `${args.slice(1).join(" ")}\n${r.stderr}`);
      assert.match(r.stderr, /Uso:/);
    }
    assert.equal(fs.existsSync(CK_DIR), false);
  });

  test("emulatori: con una sola delle due variabili d'ambiente rifiuta di partire (mai verso la produzione)", () => {
    const onlyFirestore = { ...process.env };
    delete onlyFirestore.FIREBASE_STORAGE_EMULATOR_HOST;
    const a = run(["--phase", "sync"], { env: onlyFirestore });
    assert.equal(a.code, 2, a.out);
    assert.match(a.out, /servono sia FIRESTORE_EMULATOR_HOST sia FIREBASE_STORAGE_EMULATOR_HOST/);

    const onlyStorage = { ...process.env };
    delete onlyStorage.FIRESTORE_EMULATOR_HOST;
    const b = run(["--phase", "sync"], { env: onlyStorage });
    assert.equal(b.code, 2, b.out);
    assert.match(b.out, /servono sia FIRESTORE_EMULATOR_HOST sia FIREBASE_STORAGE_EMULATOR_HOST/);
  });

  // -------------------------------------------------------------------------
  test("1. il dry-run non scrive niente (né file, né documenti, né checkpoint)", async () => {
    const r = run(["--phase", "all"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /dry-run/);
    const sync = report(r.out, "SYNC");
    assert.equal(sync.source, 9);
    assert.equal(sync.copy, 9);
    assert.equal(report(r.out, "REWRITE").docs, 10, r.out);
    assert.match(r.out, /iscrizioni toccate per registrationStatus \{"confirmed":1\}/);
    assert.ok(!r.out.includes("VERIFY"), "la verifica gira solo con --apply (o con --phase verify)");

    assert.equal((await newB.getFiles())[0].length, 0, "il dry-run non deve copiare");
    assert.equal(fs.existsSync(CK_DIR), false, "il dry-run non deve creare checkpoint né la sua cartella");
    assert.ok((await registration().get()).data().parentConsentDocumentUrl.includes(OLD), "il dry-run non deve riscrivere i documenti");
  });

  test("2. --apply: copia, riscrive, verifica; i token di download funzionano sul bucket nuovo", async () => {
    const r = run(["--phase", "all", "--apply"]);
    assert.equal(r.code, 0, r.out);
    assert.ok(r.out.includes("VERIFY_OK"), r.out);
    const v = report(r.out, "VERIFY");
    assert.deepEqual([v.missing, v.differentContent, v.oldRefs], [0, 0, 0]);
    assert.ok(v.downloads.length > 0 && v.downloads.every((s) => s === 200 || s === 206), JSON.stringify(v.downloads));
    assert.equal(fs.existsSync(CK), true, "con --apply il checkpoint (e la sua cartella) viene creato");

    for (const p of ALL_SEEDED) {
      const [a, b] = await Promise.all([meta(oldB, p), meta(newB, p)]);
      assert.equal(b.crc32c, a.crc32c, p);
      assert.deepEqual(b.metadata, a.metadata, p);
      assert.equal(b.contentType, a.contentType, p);
    }

    const data = (await registration().get()).data();
    assert.equal(data.parentConsentDocumentUrl, prodUrl(NEW, CONSENT, tokens[CONSENT]));
    assert.equal(data.parentAuthorization.nested.docUrl, `gs://${NEW}/${PDF}`);
    assert.equal(data.parentAuthorization.nested.keep, "x");
    assert.equal(data.parentAuthorization.status, "authorized");
    assert.equal(data.parentAuthorization.pdfPath, PDF);
    assert.equal(data.attachments[0], prodUrl(NEW, HERO, tokens[HERO]));
    assert.equal(data.attachments[1], "testo libero");
    assert.equal(data["weird-key"], `https://storage.googleapis.com/${NEW}/${PDF}`);
    assert.equal(data.registrationStatus, "confirmed");
    assert.equal((await gallery().get()).data().coverImageUrl, prodUrl(NEW, media[0], tokens[media[0]]));
    assert.equal((await gallery().collection("media").doc("m3").get()).data().likeCount, 3);
    assert.equal(
      (await gallery().collection("media").doc("m3").get()).data().storageUrl,
      emuUrl(NEW, media[3], tokens[media[3]]),
    );
    assert.equal((await db.doc(USER_DOC).get()).updateTime.toMillis(), untouchedBefore, "un documento senza URL non va riscritto");

    // Download con token sul bucket nuovo, come farebbe il browser.
    const ok = await fetch(emuUrl(NEW, media[2], tokens[media[2]]));
    assert.equal(ok.status, 200);
    assert.equal((await ok.text()).slice(0, 6), "img-2-");
    const wrong = await fetch(emuUrl(NEW, media[2], "token-sbagliato"));
    assert.notEqual(wrong.status, 200, "un token sbagliato non deve scaricare");
  });

  test("3. il rilancio è idempotente: niente da copiare, niente da riscrivere", () => {
    const r = run(["--phase", "all", "--apply"]);
    assert.equal(r.code, 0, r.out);
    const sync = report(r.out, "SYNC");
    assert.equal(sync.copy, 0);
    assert.equal(sync.unchanged, 9);
    assert.equal(sync.conflict, 0);
    assert.equal(report(r.out, "REWRITE").docs, 0);
    assert.ok(r.out.includes("VERIFY_OK"));
  });

  test("4. delta fra due passaggi: upload tardivo, token cambiato, file cancellato, file nato nel nuovo, destinazione più nuova", async () => {
    // (a) upload tardivo di un vecchio client sul vecchio bucket, con un documento che punta ancora lì
    tokens[LATE] = randomUUID();
    await put(oldB, LATE, "late", "image/jpeg", { firebaseStorageDownloadTokens: tokens[LATE] });
    await gallery().collection("media").doc("m9").set({ storagePath: LATE, storageUrl: emuUrl(OLD, LATE, tokens[LATE]) });
    // (b) token cambiato nella sorgente dopo la copia (l'emulatore lo accoda, vedi nota in testa)
    const changedToken = randomUUID();
    await oldB.file(media[1]).setMetadata({ metadata: { firebaseStorageDownloadTokens: changedToken } });
    // (c) media cancellato nella sorgente dopo la copia
    await oldB.file(media[4]).delete();
    // (d) oggetto nato nel bucket nuovo dopo il passaggio
    await put(newB, FRESH, "fresh", "image/jpeg");
    // (e) token cambiato nel bucket nuovo dopo il passaggio: la destinazione è quella viva
    destSideToken = randomUUID();
    await newB.file(media[3]).setMetadata({ metadata: { firebaseStorageDownloadTokens: destSideToken } });

    const r = run(["--phase", "sync", "--apply"]);
    assert.equal(r.code, 0, r.out);
    const s = report(r.out, "SYNC");
    assert.deepEqual(
      [s.copy, s.patchMetadata, s.deleteFromDest, s.destNewer, s.conflict, s.recopy],
      [1, 1, 1, 1, 0, 0],
      JSON.stringify(s),
    );

    assert.equal(await exists(newB, LATE), true, "(a) l'upload tardivo è stato copiato");
    const sourceTokens = (await meta(oldB, media[1])).metadata.firebaseStorageDownloadTokens;
    assert.ok(sourceTokens.includes(changedToken));
    assert.equal((await meta(newB, media[1])).metadata.firebaseStorageDownloadTokens, sourceTokens, "(b) la destinazione rispecchia la sorgente");
    assert.equal(await exists(newB, media[4]), false, "(c) cancellato nella sorgente = tolto dalla destinazione");
    assert.equal(await exists(newB, FRESH), true, "(d) l'oggetto nato solo nella destinazione non si tocca mai");
    assert.ok(
      (await meta(newB, media[3])).metadata.firebaseStorageDownloadTokens.includes(destSideToken),
      "(e) la modifica fatta sulla destinazione resta",
    );

    // Il documento dell'upload tardivo punta ancora al vecchio bucket: la verifica lo vede...
    const early = run(["--phase", "verify"]);
    assert.equal(early.code, 1, early.out);
    assert.ok(early.out.includes("VERIFY_FAIL"), early.out);
    assert.equal(report(early.out, "VERIFY").oldRefs, 1);

    // ...e la riscrittura lo sistema.
    const rw = run(["--phase", "rewrite", "--apply"]);
    assert.equal(rw.code, 0, rw.out);
    assert.equal(report(rw.out, "REWRITE").docs, 1);
    assert.equal((await gallery().collection("media").doc("m9").get()).data().storageUrl, emuUrl(NEW, LATE, tokens[LATE]));

    const late = run(["--phase", "verify"]);
    assert.equal(late.code, 0, late.out);
    assert.ok(late.out.includes("VERIFY_OK"), late.out);
    const v = report(late.out, "VERIFY");
    assert.deepEqual([v.missing, v.differentContent, v.oldRefs], [0, 0, 0]);
    assert.equal(v.onlyInDest, 1, "FRESH è solo nella destinazione");
    assert.equal(v.differentMetadata, 1, "media[3] ha il token cambiato solo nella destinazione");
  });

  test("4b. rilancio dopo il delta: niente da fare, la destinazione più nuova resta (destNewer)", () => {
    const r = run(["--phase", "sync", "--apply"]);
    assert.equal(r.code, 0, r.out);
    const s = report(r.out, "SYNC");
    assert.deepEqual(
      [s.copy, s.recopy, s.patchMetadata, s.deleteFromDest, s.conflict, s.adopt, s.destNewer, s.unchanged],
      [0, 0, 0, 0, 0, 0, 1, 8],
      JSON.stringify(s),
    );
  });

  test("5. checkpoint perso: non si copia niente di nuovo e non si cancella niente", async () => {
    fs.rmSync(CK);
    const r = run(["--phase", "sync", "--apply"]);
    assert.equal(r.code, 0, r.out);
    const s = report(r.out, "SYNC");
    assert.equal(s.checkpoint, 0);
    assert.equal(s.copy, 0, JSON.stringify(s));
    assert.equal(s.recopy, 0);
    assert.equal(s.deleteFromDest, 0);
    assert.equal(s.adopt, 8, "gli oggetti uguali nei due bucket si riadottano nel checkpoint");
    // media[3] ha un token diverso nei due bucket e senza checkpoint non si sa chi è cambiato.
    assert.equal(s.conflict, 1);
    assert.match(r.out, new RegExp(`CONFLICT .*foto 3\\.jpg`));
    assert.equal(await exists(newB, FRESH), true);
    assert.ok(
      (await meta(newB, media[3])).metadata.firebaseStorageDownloadTokens.includes(destSideToken),
      "il conflitto non si risolve da solo: la destinazione resta com'è",
    );
    assert.equal(checkpointLines().length, 8);
  });

  describe("6. guardia --max-deletes", () => {
    before(async () => {
      for (let i = 0; i < 3; i++) await oldB.file(media[i]).delete();
    });

    test("sopra il tetto la CLI si ferma prima di cancellare, anche in dry-run", async () => {
      for (const extra of [["--apply"], []]) {
        const r = run(["--phase", "sync", ...extra, "--max-deletes", "2"]);
        assert.notEqual(r.code, 0, r.out);
        assert.ok(r.out.includes("--max-deletes"), r.out);
        for (let i = 0; i < 3; i++) assert.equal(await exists(newB, media[i]), true, `la guardia deve fermarsi prima di cancellare media[${i}]`);
      }
      assert.equal(checkpointLines().some((l) => l.deleted), false);
    });

    test(
      "un valore non numerico di --max-deletes non deve spegnere la guardia",
      () => {
        const r = run(["--phase", "sync", "--max-deletes", "abc"]);
        assert.notEqual(r.code, 0, r.out);
      },
    );

    test("al tetto esatto (3 cancellazioni, --max-deletes 3) passa e cancella solo quelle", async () => {
      const r = run(["--phase", "sync", "--apply", "--max-deletes", "3"]);
      assert.equal(r.code, 0, r.out);
      assert.equal(report(r.out, "SYNC").deleteFromDest, 3);
      for (let i = 0; i < 3; i++) assert.equal(await exists(newB, media[i]), false);
      assert.equal(await exists(newB, FRESH), true, "l'oggetto solo nella destinazione resta");
      assert.equal(await exists(newB, PDF), true);
      const deleted = checkpointLines().filter((l) => l.deleted).map((l) => l.name).sort();
      assert.deepEqual(deleted, media.slice(0, 3).sort());
    });

    test("rilanciato dopo le cancellazioni non ne trova altre", () => {
      const r = run(["--phase", "sync", "--apply"]);
      assert.equal(r.code, 0, r.out);
      assert.equal(report(r.out, "SYNC").deleteFromDest, 0);
    });
  });

  test("7. sorgente vuota con checkpoint pieno: la CLI si ferma, non svuota la destinazione", async () => {
    const [sourceFiles] = await oldB.getFiles();
    for (const f of sourceFiles) await f.delete();
    assert.ok(checkpointLines().length > 0);

    const r = run(["--phase", "sync", "--apply"]);
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /Sorgente vuota ma checkpoint pieno/);
    for (const p of [PDF, CONSENT, HERO, FRESH]) assert.equal(await exists(newB, p), true, p);
  });
});
