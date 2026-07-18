// Letture cache-first (stale-while-revalidate) sopra persistentLocalCache.
//
// Firestore, quando è online, esegue getDoc/getDocs SEMPRE server-first: la
// pagina resta bianca finché non torna il round-trip di rete, anche se il dato
// è già nella cache IndexedDB. Su connessioni lente/instabili questo faceva
// "non caricare mai" le pagine.
//
// Questi helper dipingono SUBITO dal contenuto già in cache (getDoc*FromCache)
// e in background rinfrescano la cache dal server (getDoc*FromServer) così la
// lettura successiva è aggiornata. Se il dato non è in cache si cade sul path
// normale (getDoc/getDocs) — identico al comportamento odierno.
//
// Ritornano lo STESSO tipo di getDoc/getDocs (DocumentSnapshot/QuerySnapshot):
// i chiamanti non cambiano, mappano `.data()`/`.exists()`/`.docs` come prima.
//
// ATTENZIONE: usare SOLO per letture di visualizzazione. Le letture
// read-before-write (guardie di esistenza, merge di campi prima di uno
// setDoc/updateDoc) devono restare server-first: una cache stale porterebbe a
// riscrivere dati vecchi. Vedi i commenti nei singoli service.

import {
  getDoc,
  getDocFromCache,
  getDocFromServer,
  getDocs,
  getDocsFromCache,
  getDocsFromServer,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  type QuerySnapshot,
} from "firebase/firestore";

function isOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

// Revalidazione in background: aggiorna la cache IndexedDB per la prossima
// lettura. Gli errori (offline, permessi, indice mancante) sono ignorati: il
// dato è già stato servito dalla cache.
function revalidate(task: () => Promise<unknown>) {
  if (!isOnline()) return;
  void task().catch(() => undefined);
}

export async function getDocCacheFirst<T = DocumentData>(
  reference: DocumentReference<T>,
): Promise<DocumentSnapshot<T>> {
  try {
    const cached = await getDocFromCache(reference);
    revalidate(() => getDocFromServer(reference));
    return cached;
  } catch {
    // Non in cache (o cache non disponibile): lettura normale (server se online,
    // cache se offline — come getDoc).
    return getDoc(reference);
  }
}

export async function getDocsCacheFirst<T = DocumentData>(
  queryRef: Query<T>,
): Promise<QuerySnapshot<T>> {
  try {
    const cached = await getDocsFromCache(queryRef);
    // Cache vuota = trattata come miss: potrebbe essere "mai messa in cache"
    // (non "davvero vuota"). Si va al server per non mostrare una lista vuota
    // quando invece esistono documenti.
    if (!cached.empty) {
      revalidate(() => getDocsFromServer(queryRef));
      return cached;
    }
  } catch {
    // Cache non disponibile: fallback al path normale.
  }
  return getDocs(queryRef);
}
