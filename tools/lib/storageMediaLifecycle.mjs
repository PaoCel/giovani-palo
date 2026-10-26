// Pure path derivation, shared by the migration guard and its independent tests.
export function mediaLifecyclePath(name) {
  const match = /^protected\/stakes\/([^/]+)\/galleries\/([^/]+)\/media\/([^/]+)\//.exec(name);
  return match ? `stakes/${match[1]}/galleries/${match[2]}/mediaLifecycle/${match[3]}` : null;
}
export async function guardMediaCopy({ name, readLifecycle, removeCopies, apply, copy, reconcileHide = async () => {} }) {
  const path = mediaLifecyclePath(name);
  const deleted = async () => path && (await readLifecycle(path))?.operation === "delete";
  async function finalize() {
    if (await deleted()) {
      if (apply) await removeCopies(name);
      return true;
    }
    if (path && apply) await reconcileHide(name, path);
    return false;
  }
  if (await deleted()) {
    if (apply) await removeCopies(name);
    return { skipped: true };
  }
  // The transport calls this again before each HTTP retry. A failed response
  // does not prove that GCS has not already applied the previous request.
  const beforeAttempt = async () => {
    if (await deleted()) throw new Error("Media cancellato durante il sync.");
  };
  let result;
  try { result = await copy(beforeAttempt); }
  catch (error) {
    if (await finalize()) return { skipped: true };
    throw error;
  }
  if (await finalize()) return { skipped: true };
  return { skipped: false, result };
}
