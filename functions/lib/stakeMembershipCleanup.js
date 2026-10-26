// Only membership data belongs to this cleanup. Registrations and consent
// documents keep their existing retention policy (see APPARTENENZA_AL_PALO).

const DELETE_BATCH_SIZE = 400;

function cleanupError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validateUid(uid) {
  if (typeof uid !== "string" || !uid.trim() || uid.length > 128 || uid.includes("/")) {
    throw cleanupError("invalid_uid");
  }
}

async function assertDeletedIdentity({ db, auth, uid, tx }) {
  try {
    await auth.getUser(uid);
  } catch (error) {
    if (error?.code !== "auth/user-not-found") throw error;
    const ref = db.doc(`users/${uid}`);
    const profile = tx ? await tx.get(ref) : await ref.get();
    if (profile.exists) throw cleanupError("profile_exists");
    return;
  }
  throw cleanupError("account_exists");
}

async function collectExistingDocuments(ref, result) {
  const snapshot = await ref.get();
  // Visit the children even when their parent is a missing document.
  for (const collection of await ref.listCollections()) {
    for (const child of await collection.listDocuments()) {
      await collectExistingDocuments(child, result);
    }
  }
  // Descendants first: a partially completed run remains discoverable.
  if (snapshot.exists) result.push(ref);
}

async function readMembershipPlan(db, uid) {
  const stakes = await db.collection("stakes").select().get();
  const plan = [];
  for (const stake of stakes.docs) {
    const refs = [];
    await collectExistingDocuments(stake.ref.collection("members").doc(uid), refs);
    if (refs.length) plan.push(refs);
  }
  return plan;
}

async function cleanupDeletedUserMemberships({ db, auth, uid, dryRun = true, expectedMemberships } = {}) {
  validateUid(uid);
  if (!dryRun && (!Number.isInteger(expectedMemberships) || expectedMemberships < 0)) {
    throw cleanupError("expected_memberships_required");
  }
  await assertDeletedIdentity({ db, auth, uid });
  const plan = await readMembershipPlan(db, uid);
  const result = {
    dryRun,
    memberships: plan.length,
    documents: plan.reduce((count, refs) => count + refs.length, 0),
    deletedMemberships: 0,
    deletedDocuments: 0,
  };
  if (dryRun) return result;
  if (expectedMemberships !== result.memberships) throw cleanupError("membership_count_changed");

  for (const refs of plan) {
    let deleted = 0;
    for (let start = 0; start < refs.length; start += DELETE_BATCH_SIZE) {
      const batch = refs.slice(start, start + DELETE_BATCH_SIZE);
      deleted += await db.runTransaction(async (tx) => {
        // The profile read participates in the same transaction as all deletes.
        // Every writer also reads that profile before creating membership data.
        await assertDeletedIdentity({ db, auth, uid, tx });
        const snapshots = await tx.getAll(...batch);
        const existing = snapshots.filter((snapshot) => snapshot.exists);
        existing.forEach((snapshot) => tx.delete(snapshot.ref));
        return existing.length;
      });
    }
    result.deletedDocuments += deleted;
    if (deleted) result.deletedMemberships += 1;
  }
  return result;
}

module.exports = { cleanupDeletedUserMemberships };
