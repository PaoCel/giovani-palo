// Letture cache-first (stale-while-revalidate) sopra persistentLocalCache.
//
// Firestore, quando è online, esegue getDoc/getDocs SEMPRE server-first: la
// pagina resta bianca finché non torna il round-trip di rete, anche se il dato
// è già nella cache IndexedDB. Su connessioni lente/instabili questo faceva
// "non caricare mai" le pagine.
//
// Questi helper dipingono SUBITO dal contenuto già in cache (getDoc*FromCache)
// e in background rinfrescano la cache dal server (getDoc*FromServer). Se il
// dato del server è DIVERSO da quello servito dalla cache viene notificata una
// revalidazione (onCacheRevalidated): i loader in ascolto rileggono e la UI si
// aggiorna da sola. Senza questa notifica la schermata restava indietro di una
// visita: un'attività creata da un altro dispositivo non compariva finché
// l'utente non ricaricava una seconda volta.
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

import { invalidateCache } from "@/utils/sessionCache";

type RevalidationListener = () => void;

const listeners = new Set<RevalidationListener>();

// Anti-tempesta: le notifiche sono accorpate (una per burst di revalidazioni)
// e limitate in frequenza, così un dato che dovesse risultare sempre "diverso"
// non può innescare un ciclo infinito di ricariche.
const NOTIFY_DEBOUNCE_MS = 150;
const NOTIFY_WINDOW_MS = 60 * 1000;
const NOTIFY_MAX_PER_WINDOW = 8;

let notifyTimer: ReturnType<typeof setTimeout> | null = null;
let notifyTimestamps: number[] = [];

/**
 * Si registra per sapere quando una lettura cache-first ha scoperto dati più
 * recenti sul server. Ritorna la funzione di unsubscribe.
 */
export function onCacheRevalidated(listener: RevalidationListener) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function notifyRevalidated() {
  const now = Date.now();
  notifyTimestamps = notifyTimestamps.filter((value) => now - value < NOTIFY_WINDOW_MS);

  if (notifyTimestamps.length >= NOTIFY_MAX_PER_WINDOW) {
    return;
  }

  notifyTimestamps.push(now);

  // La cache di sessione conserva i risultati GIÀ mappati (es. la lista
  // attività pubbliche per 60s): va svuotata prima di risvegliare i loader,
  // altrimenti rileggerebbero lo stesso dato stale per tutto il TTL.
  invalidateCache("");

  if (notifyTimer) {
    return;
  }

  notifyTimer = setTimeout(() => {
    notifyTimer = null;

    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // Un listener rotto non deve impedire il refresh degli altri.
      }
    }
  }, NOTIFY_DEBOUNCE_MS);
}

function fingerprint(value: unknown) {
  const text = JSON.stringify(value) ?? "";
  let hash = 5381;

  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }

  return `${text.length}:${hash}`;
}

function querySnapshotFingerprint(snapshot: QuerySnapshot<DocumentData>) {
  return fingerprint(snapshot.docs.map((document) => [document.id, document.data()]));
}

function docSnapshotFingerprint(snapshot: DocumentSnapshot<DocumentData>) {
  return fingerprint([snapshot.exists(), snapshot.data() ?? null]);
}

function isOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

// Revalidazione in background: aggiorna la cache IndexedDB per la prossima
// lettura e notifica la UI se il server ha dati diversi. Gli errori (offline,
// permessi, indice mancante) sono ignorati: il dato è già stato servito dalla
// cache.
function revalidate(task: () => Promise<unknown>) {
  if (!isOnline()) return;
  void task().catch(() => undefined);
}

export async function getDocCacheFirst<T = DocumentData>(
  reference: DocumentReference<T>,
): Promise<DocumentSnapshot<T>> {
  try {
    const cached = await getDocFromCache(reference);
    const cachedFingerprint = docSnapshotFingerprint(
      cached as DocumentSnapshot<DocumentData>,
    );

    revalidate(async () => {
      const fresh = await getDocFromServer(reference);

      if (docSnapshotFingerprint(fresh as DocumentSnapshot<DocumentData>) !== cachedFingerprint) {
        notifyRevalidated();
      }
    });

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
      const cachedFingerprint = querySnapshotFingerprint(
        cached as QuerySnapshot<DocumentData>,
      );

      revalidate(async () => {
        const fresh = await getDocsFromServer(queryRef);

        if (querySnapshotFingerprint(fresh as QuerySnapshot<DocumentData>) !== cachedFingerprint) {
          notifyRevalidated();
        }
      });

      return cached;
    }
  } catch {
    // Cache non disponibile: fallback al path normale.
  }
  return getDocs(queryRef);
}
