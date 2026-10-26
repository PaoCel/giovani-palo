#!/usr/bin/env node
// Enable/disable guest answers for one survey. Dry-run by default.
const fs = require("node:fs");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const argument = name => {
  const at = process.argv.indexOf(name);
  return at < 0 ? null : process.argv[at + 1];
};

async function main() {
  const projectId = argument("--project"), stakeId = argument("--stake"), eventId = argument("--event");
  const enabled = process.argv.includes("--enable"), disabled = process.argv.includes("--disable");
  const apply = process.argv.includes("--apply"), backup = argument("--backup");
  if (![projectId, stakeId, eventId].every(Boolean) || enabled === disabled
      || [stakeId, eventId].some(v => v.includes("/")) || (apply && !backup)) {
    throw new Error("Required: --project --stake --event, --enable or --disable; --apply requires --backup.");
  }
  initializeApp({ projectId });
  const db = getFirestore(), ref = db.doc(`stakes/${stakeId}/activities/${eventId}`);
  const before = await ref.get();
  const data = before.data();
  if (!before.exists) throw new Error("Activity not found.");
  if (enabled && (data.isPublic !== true || data.isVisible === false || data.status === "draft")) {
    throw new Error("Guest survey requires a public, visible activity.");
  }
  const questions = await ref.collection("surveyQuestions").where("status", "==", "active").count().get();
  if (enabled && !questions.data().count) throw new Error("No active questions.");
  const changed = data.surveyGuestEnabled !== enabled;
  console.log(JSON.stringify({ apply, enabled, changed, activeQuestions: questions.data().count }));
  if (!apply || !changed) return;
  fs.writeFileSync(backup, JSON.stringify({ path: ref.path, previous: data.surveyGuestEnabled ?? null }),
    { flag: "wx", mode: 0o600 });
  await db.runTransaction(async tx => {
    const fresh = await tx.get(ref);
    if (!fresh.exists || !fresh.updateTime.isEqual(before.updateTime)) throw new Error("Activity changed since preview.");
    tx.update(ref, { surveyGuestEnabled: enabled });
  });
  if ((await ref.get()).data()?.surveyGuestEnabled !== enabled) throw new Error("Read-back failed.");
  console.log("Verified guest survey setting.");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
