#!/usr/bin/env node
// Staff-confirmed winners only. Input and backup contain personal data: keep
// both outside the public repository. Dry-run unless --apply is explicit.
const fs = require("node:fs");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

function argument(name) {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : process.argv[i + 1];
}

function validResult(result) {
  return result && typeof result.winnerName === "string"
    && result.winnerName === result.winnerName.trim()
    && result.winnerName.length > 0 && result.winnerName.length <= 100
    && typeof result.value === "number" && Number.isFinite(result.value) && result.value > 0;
}

function sameResult(left, right) {
  if (left == null || right == null) return left == null && right == null;
  return left?.winnerName === right?.winnerName && left?.value === right?.value;
}

async function main() {
  const projectId = argument("--project");
  const stake = argument("--stake");
  const activity = argument("--activity");
  const input = argument("--input");
  const backup = argument("--backup");
  const apply = process.argv.includes("--apply");
  if (![projectId, stake, activity, input].every(Boolean) || [stake, activity].some(v => v.includes("/"))) {
    throw new Error("Required: --project --stake --activity --input; --apply requires --backup.");
  }
  if (apply && !backup) throw new Error("Backup path required for --apply.");
  const rows = JSON.parse(fs.readFileSync(input, "utf8"));
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) throw new Error("Expected 1–100 results.");
  if (new Set(rows.map(row => row.recordId)).size !== rows.length) throw new Error("Duplicate record ids.");
  for (const row of rows) {
    if (!row.recordId || typeof row.recordId !== "string" || row.recordId.includes("/")
      || !validResult(row.result)) throw new Error("Invalid record/result.");
  }
  initializeApp({ projectId });
  const db = getFirestore();
  const activityRef = db.doc(`stakes/${stake}/activities/${activity}`);
  const refs = rows.map(row => activityRef.collection("records").doc(row.recordId));
  const activitySnap = await activityRef.get();
  const end = new Date(activitySnap.data()?.endDate).getTime();
  if (!activitySnap.exists || !Number.isFinite(end) || end >= Date.now()) throw new Error("Activity must exist and be finished.");
  const before = await db.getAll(...refs);
  function check(snap, row) {
    if (!snap.exists || snap.data().status !== "open") throw new Error(`Record unavailable: ${row.recordId}`);
    if (sameResult(snap.data().result, row.result)) return false;
    if (!sameResult(snap.data().result, row.previousResult ?? null)) throw new Error(`Result changed: ${row.recordId}`);
    return true;
  }
  const count = before.filter((snap, i) => check(snap, rows[i])).length;
  console.log(JSON.stringify({ apply, records: rows.length, changes: count }));
  if (!apply || !count) return;
  // Exclusive creation prevents accidentally replacing an earlier backup.
  fs.writeFileSync(backup, JSON.stringify(before.map(snap => ({
    path: snap.ref.path, data: snap.data(), updateTime: snap.updateTime.toDate().toISOString(),
  })), null, 2), { flag: "wx", mode: 0o600 });
  await db.runTransaction(async tx => {
    const freshActivity = await tx.get(activityRef);
    if (!freshActivity.exists || !freshActivity.updateTime.isEqual(activitySnap.updateTime)) {
      throw new Error("Activity changed since preview.");
    }
    const fresh = await tx.getAll(...refs);
    const changes = fresh.map((snap, i) => check(snap, rows[i]));
    fresh.forEach((snap, i) => {
      if (!changes[i]) return;
      if (!snap.updateTime.isEqual(before[i].updateTime)) throw new Error("Record changed since preview.");
      tx.update(snap.ref, {
        result: { winnerName: rows[i].result.winnerName, value: rows[i].result.value },
        resultRecordedAt: FieldValue.serverTimestamp(),
        resultRecordedBy: "staff-confirmed",
      });
    });
  });
  const after = await db.getAll(...refs);
  if (!after.every((snap, i) => sameResult(snap.data().result, rows[i].result))) throw new Error("Read-back failed.");
  console.log("Verified: all results match the approved input.");
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
