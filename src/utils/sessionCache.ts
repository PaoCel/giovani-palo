// Cache in memoria con TTL per dati quasi-statici (lista pali, profilo
// organizzazione, attività pubbliche). Firestore esegue le get sempre
// server-first quando è online: senza questa cache ogni navigazione SPA
// ripaga la stessa query. La cache vive per la sessione della tab.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();
const pending = new Map<string, Promise<unknown>>();

export async function cachedFetch<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const cached = store.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }

  // Dedupa richieste concorrenti per la stessa chiave (es. due componenti
  // della stessa pagina che chiedono entrambi la lista pali).
  const inFlight = pending.get(key);
  if (inFlight) {
    return inFlight as Promise<T>;
  }

  const request = loader()
    .then((value) => {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      pending.delete(key);
    });

  pending.set(key, request);
  return request;
}

export function invalidateCache(prefix: string) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}
