// Pure path derivation, shared by the migration guard and its independent tests.
export function mediaLifecyclePath(name) {
  const match = /^protected\/stakes\/([^/]+)\/galleries\/([^/]+)\/media\/([^/]+)\//.exec(name);
  return match ? `stakes/${match[1]}/galleries/${match[2]}/mediaLifecycle/${match[3]}` : null;
}
export async function guardMediaCopy({ name, readLifecycle, removeCopies, apply, copy, reconcileHide = async () => {} }) {
  const path = mediaLifecyclePath(name);
  const deleted = async () => path && (await readLifecycle(path))?.operation === "delete";
  if (await deleted()) {
    if (apply) await removeCopies(name);
    return { skipped: true };
  }
  const result = await copy();
  if (await deleted()) {
    if (apply) await removeCopies(name);
    return { skipped: true };
  }
  if (path && apply) await reconcileHide(name, path);
  return { skipped: false, result };
}
