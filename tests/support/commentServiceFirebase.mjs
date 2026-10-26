// Controlled transport for the real comments service; no Firebase app is created.
export const db = {};
export const calls = { writes: [], deletes: [], reads: [] };
let sequence = 0;
let readResult = [];
let readFailure;
export function reset() { calls.writes.length = calls.deletes.length = calls.reads.length = 0; sequence = 0; readResult = []; readFailure = undefined; }
export function collection(_db, ...segments) { return { path: segments.join("/") }; }
export function doc(parent, id = `generated-${++sequence}`) { return { path: `${parent.path}/${id}`, id }; }
function pending(list, ref, data) {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  list.push({ path: ref.path, data, resolve, reject });
  return promise;
}
export function setDoc(ref, data) { return pending(calls.writes, ref, structuredClone(data)); }
export function deleteDoc(ref) { return pending(calls.deletes, ref); }
export function setRead(items, error) { readResult = items; readFailure = error; }
export async function getDocsFromServer(ref) { calls.reads.push(ref.path); if (readFailure) throw readFailure; return { docs: readResult.map(item => ({ id: item.id, data: () => item.data })) }; }
