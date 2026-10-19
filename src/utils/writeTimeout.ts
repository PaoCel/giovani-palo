// Scritture Firestore senza rete: con la cache persistente la promessa resta
// in sospeso finché il server non risponde, e il pulsante resterebbe bloccato
// per sempre. Dopo questo tempo si sblocca e si dice di controllare la rete;
// la scrittura resta in coda e parte da sola al ritorno della connessione.
//
// Questo file lo carica anche Node (tests/): niente alias "@/".

export const WRITE_TIMEOUT_MS = 15000;
export const WRITE_TIMEOUT_CODE = "write-timeout";

export function withWriteTimeout<T>(promise: Promise<T>, ms = WRITE_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Object.assign(new Error("write-timeout"), { code: WRITE_TIMEOUT_CODE })),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// Errori di rete (o di tempo scaduto), da distinguere dagli altri per il
// messaggio: "controlla la connessione" invece di "riprova".
export function isConnectionError(error: unknown) {
  const code = String((error as { code?: unknown } | null | undefined)?.code ?? "");
  return (
    code === WRITE_TIMEOUT_CODE ||
    code === "unavailable" ||
    code === "deadline-exceeded" ||
    code === "firestore/unavailable" ||
    code === "firestore/deadline-exceeded" ||
    code === "functions/unavailable" ||
    code === "functions/deadline-exceeded"
  );
}

export function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}
