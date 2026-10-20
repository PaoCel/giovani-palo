#!/usr/bin/env node
/*
 * Scelta S2-1 (docs/APPARTENENZA_AL_PALO.md, «Callable e trigger: interfaccia»,
 * "Script S2-1"): via i resti dei codici galleria, che non aprono più niente
 * (l'accesso lo decide l'appartenenza al palo).
 *   - ogni galleria `accessMode: "code_required"` diventa `"open"`;
 *   - si cancellano `stakes/{s}/gallerySecrets/*`,
 *     `stakes/{s}/galleries/{g}/members/*` e `users/{uid}/unlockedGalleries/*`.
 * Non tocca mai `stakes/{s}/members` (l'appartenenza di S2): per questo scorre
 * le gallerie di ogni palo e non usa `collectionGroup("members")`.
 * Idempotente. Di default è un dry-run che stampa solo conteggi.
 *
 * Uso:
 *   node scripts/cleanupGalleryCodes.js
 *   node scripts/cleanupGalleryCodes.js --apply --expect-galleries <n> --expect-deletes <m>
 *
 * Fuori dall'emulatore `--apply` vuole i due numeri visti nel dry-run: se il
 * piano è cambiato lo script esce con 2 senza scrivere. Le due callable live
 * dei codici si cancellano a parte, per nome, nel rilascio.
 *
 * Emulatore: FIRESTORE_EMULATOR_HOST=127.0.0.1:8429 GCLOUD_PROJECT=demo-...
 * Produzione: GOOGLE_APPLICATION_CREDENTIALS o ADC, e conferma esplicita di Paolo.
 */

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const BATCH_SIZE = 400;
const UNLOCKED_PATH = /^users\/[^/]+\/unlockedGalleries\/[^/]+$/u;

function parseArgs(argv) {
  const out = { apply: false, expectGalleries: null, expectDeletes: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--expect-galleries") out.expectGalleries = Number(argv[++i]);
    else if (a === "--expect-deletes") out.expectDeletes = Number(argv[++i]);
    else {
      console.error(`Argomento sconosciuto: ${a}`);
      process.exit(1);
    }
  }
  return out;
}

async function readPlan(db) {
  const codeGalleries = [];
  const gallerySecrets = [];
  const galleryMembers = [];
  // listDocuments, non get: prende anche pali e gallerie cancellati che hanno
  // ancora sotto-collezioni.
  const stakes = await db.collection("stakes").listDocuments();
  for (const stake of stakes) {
    const [secrets, galleries] = await Promise.all([
      stake.collection("gallerySecrets").listDocuments(),
      stake.collection("galleries").listDocuments(),
    ]);
    gallerySecrets.push(...secrets);
    const snaps = galleries.length ? await db.getAll(...galleries) : [];
    for (const snap of snaps) {
      if (snap.exists && snap.get("accessMode") === "code_required") codeGalleries.push(snap.ref);
    }
    for (const gallery of galleries) {
      galleryMembers.push(...(await gallery.collection("members").listDocuments()));
    }
  }
  const unlocked = await db.collectionGroup("unlockedGalleries").select().get();
  const unlockedGalleries = unlocked.docs.map((doc) => doc.ref).filter((ref) => UNLOCKED_PATH.test(ref.path));
  return { codeGalleries, gallerySecrets, galleryMembers, unlockedGalleries };
}

async function commitInBatches(db, operations) {
  for (let i = 0; i < operations.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const apply of operations.slice(i, i + BATCH_SIZE)) apply(batch);
    await batch.commit();
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  initializeApp(
    emulator ? { projectId: process.env.GCLOUD_PROJECT || "demo-room-planner" } : { credential: applicationDefault() },
  );
  const db = getFirestore();
  const plan = await readPlan(db);
  const deletes = plan.gallerySecrets.length + plan.galleryMembers.length + plan.unlockedGalleries.length;

  console.log(
    JSON.stringify({
      mode: args.apply ? "apply" : "dry-run",
      project: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "(adc)",
      codeGalleries: plan.codeGalleries.length,
      gallerySecrets: plan.gallerySecrets.length,
      galleryMembers: plan.galleryMembers.length,
      unlockedGalleries: plan.unlockedGalleries.length,
      deletes,
    }),
  );

  if (!args.apply) return;
  const missing = args.expectGalleries === null || args.expectDeletes === null;
  if (missing && !emulator) {
    console.error("--apply fuori dall'emulatore vuole --expect-galleries <n> --expect-deletes <m> (i numeri del dry-run).");
    process.exit(2);
  }
  if (
    (args.expectGalleries !== null && args.expectGalleries !== plan.codeGalleries.length) ||
    (args.expectDeletes !== null && args.expectDeletes !== deletes)
  ) {
    console.error(
      `Il piano è cambiato dal dry-run: attese ${args.expectGalleries} gallerie e ${args.expectDeletes} cancellazioni, ` +
        `ora ${plan.codeGalleries.length} e ${deletes}. Nessuna scrittura.`,
    );
    process.exit(2);
  }

  const updatedAt = new Date().toISOString();
  const operations = [
    ...plan.codeGalleries.map((ref) => (batch) => batch.update(ref, { accessMode: "open", updatedAt })),
    ...[...plan.gallerySecrets, ...plan.galleryMembers, ...plan.unlockedGalleries].map((ref) => (batch) => batch.delete(ref)),
  ];
  await commitInBatches(db, operations);
  console.log(JSON.stringify({ updated: plan.codeGalleries.length, deleted: deletes }));
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exitCode = 1;
});
