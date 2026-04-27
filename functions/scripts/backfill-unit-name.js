#!/usr/bin/env node
/*
 * Backfill: rinomina un'unità e propaga il nuovo nome a tutti i record storici
 * (registrazioni.unitNameSnapshot + users.unitName).
 *
 * Uso:
 *   # default: cerca unità con "sabin" nel nome nello stake roma-est, dry-run
 *   node scripts/backfill-unit-name.js
 *
 *   # specifica id unità e nuovo nome, dry-run
 *   node scripts/backfill-unit-name.js --stake roma-est --unit-id ramo-delle-sabine --new-name "La Sabina"
 *
 *   # esegui davvero
 *   node scripts/backfill-unit-name.js --stake roma-est --unit-id ramo-delle-sabine --new-name "La Sabina" --apply
 *
 * Credenziali: GOOGLE_APPLICATION_CREDENTIALS=/path/serviceAccount.json
 *              oppure `gcloud auth application-default login`.
 */

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, FieldPath } = require("firebase-admin/firestore");

function parseArgs(argv) {
  const out = {
    stake: "roma-est",
    unitId: null,
    newName: "La Sabina",
    search: "sabin",
    apply: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--stake") out.stake = argv[++i];
    else if (a === "--unit-id") out.unitId = argv[++i];
    else if (a === "--new-name") out.newName = argv[++i];
    else if (a === "--search") out.search = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv);

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

function nowIso() {
  return new Date().toISOString();
}

async function commitInChunks(refs, mutator) {
  const CHUNK = 400;
  let total = 0;
  for (let i = 0; i < refs.length; i += CHUNK) {
    const slice = refs.slice(i, i + CHUNK);
    const batch = db.batch();
    for (const ref of slice) batch.update(ref, mutator(ref));
    if (args.apply) await batch.commit();
    total += slice.length;
  }
  return total;
}

async function findUnit() {
  if (args.unitId) {
    const snap = await db.doc(`stakes/${args.stake}/units/${args.unitId}`).get();
    if (!snap.exists) throw new Error(`Unit ${args.unitId} non trovata in stake ${args.stake}.`);
    return [{ id: snap.id, data: snap.data() }];
  }
  const all = await db.collection(`stakes/${args.stake}/units`).get();
  const needle = args.search.toLowerCase();
  return all.docs
    .map((d) => ({ id: d.id, data: d.data() || {} }))
    .filter(
      (u) =>
        u.id.toLowerCase().includes(needle) ||
        (typeof u.data.name === "string" && u.data.name.toLowerCase().includes(needle)),
    );
}

async function collectRegistrations(stakeId, unitId) {
  const refs = [];
  const activities = await db.collection(`stakes/${stakeId}/activities`).select().get();
  for (const act of activities.docs) {
    const regs = await act.ref
      .collection("registrations")
      .where("unitId", "==", unitId)
      .select("unitId")
      .get();
    for (const r of regs.docs) refs.push(r.ref);
  }
  return refs;
}

async function collectUsers(unitId) {
  const snap = await db.collection("users").where("unitId", "==", unitId).select("unitId").get();
  return snap.docs.map((d) => d.ref);
}

async function main() {
  console.log(
    `Modalità: ${args.apply ? "APPLY (scrive)" : "DRY-RUN (nessuna scrittura)"} | stake=${args.stake} new-name="${args.newName}"`,
  );

  const candidates = await findUnit();
  if (candidates.length === 0) {
    console.log(`Nessuna unità trovata. Search="${args.search}".`);
    process.exit(1);
  }
  if (candidates.length > 1) {
    console.log("Più unità candidate — passa --unit-id <id>:");
    for (const c of candidates) console.log(`  - ${c.id}  (name="${c.data.name}")`);
    process.exit(1);
  }

  const unit = candidates[0];
  console.log(`Unità: id=${unit.id}  name attuale="${unit.data.name}"`);

  const [regRefs, userRefs] = await Promise.all([
    collectRegistrations(args.stake, unit.id),
    collectUsers(unit.id),
  ]);
  console.log(`Registrazioni da aggiornare: ${regRefs.length}`);
  console.log(`Utenti da aggiornare:       ${userRefs.length}`);

  const ts = nowIso();

  if (unit.data.name !== args.newName) {
    if (args.apply) {
      await db
        .doc(`stakes/${args.stake}/units/${unit.id}`)
        .update({ name: args.newName, updatedAt: ts });
    }
    console.log(`Unit doc: name "${unit.data.name}" -> "${args.newName}"`);
  } else {
    console.log("Unit doc: name già corretto, salto.");
  }

  const regCount = await commitInChunks(regRefs, () => ({
    unitNameSnapshot: args.newName,
    updatedAt: ts,
  }));
  const userCount = await commitInChunks(userRefs, () => ({
    unitName: args.newName,
    updatedAt: ts,
  }));

  console.log(
    `Fatto. ${args.apply ? "Scritti" : "(dry) Avrei scritto"}: ${regCount} reg + ${userCount} user.`,
  );
  if (!args.apply) console.log("Rilancia con --apply per applicare.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
