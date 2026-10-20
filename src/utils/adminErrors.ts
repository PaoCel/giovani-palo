// Messaggio per un'azione dell'admin non riuscita, mostrato dentro il foglio o
// il modale aperto. Gli errori di Firestore arrivano in inglese ("Missing or
// insufficient permissions."): al loro posto la frase italiana dell'azione con
// il codice, così chi chiede aiuto sa cosa riferire. Le callable del progetto
// rispondono già in italiano (HttpsError) e restano come sono; gli errori
// scritti dal client (`new Error("...")`, senza codice) pure.
//
// Questo file lo carica anche Node (tests/): niente alias "@/".

import { PAROLE } from "../copy/parole.ts";
import { WRITE_TIMEOUT_CODE, isConnectionError, isOffline } from "./writeTimeout.ts";

// Codici delle callable con un messaggio generico in inglese, non nostro.
const GENERIC_CALLABLE_CODES = new Set(["functions/internal", "functions/unknown"]);

// Senza un messaggio applicativo lo SDK usa il codice ("unauthenticated") o lo
// stato HTTP della risposta ("UNAUTHENTICATED") come messaggio: non è nostro.
function isGenericCallableMessage(code: string, message: string) {
  const suffix = code.slice("functions/".length);
  return message.toLowerCase().replace(/_/g, "-") === suffix;
}

export function getAdminActionError(error: unknown, fallback: string): string {
  const code = String((error as { code?: unknown } | null | undefined)?.code ?? "");

  // Una scrittura di Firestore scaduta non è annullata: parte al ritorno della
  // rete. Il messaggio non deve far credere che "Tieni" la fermi.
  if (code === WRITE_TIMEOUT_CODE) {
    return PAROLE.erroreReteInCoda;
  }

  // Senza rete una callable risponde "functions/internal": lo dice il browser.
  if (isConnectionError(error) || isOffline()) {
    return PAROLE.erroreRete;
  }

  // Errori del browser (rete, modulo non più sul server dopo un
  // aggiornamento): in inglese e tecnici, non per l'admin.
  if (error instanceof TypeError) {
    return fallback;
  }

  const message = error instanceof Error ? error.message.trim() : "";

  if (
    code.startsWith("functions/") &&
    !GENERIC_CALLABLE_CODES.has(code) &&
    message &&
    !isGenericCallableMessage(code, message)
  ) {
    return message;
  }

  if (code) {
    return `${fallback} (codice: ${code})`;
  }

  return message || fallback;
}
