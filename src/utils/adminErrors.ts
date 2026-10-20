// Messaggio per un'azione dell'admin non riuscita, mostrato dentro il foglio o
// il modale aperto. Gli errori di Firestore arrivano in inglese ("Missing or
// insufficient permissions."): al loro posto la frase italiana dell'azione con
// il codice, così chi chiede aiuto sa cosa riferire. Le callable del progetto
// rispondono già in italiano (HttpsError) e restano come sono; gli errori
// scritti dal client (`new Error("...")`, senza codice) pure.
//
// Questo file lo carica anche Node (tests/): niente alias "@/".

import { PAROLE } from "../copy/parole.ts";
import { isConnectionError } from "./writeTimeout.ts";

// Codici delle callable con un messaggio generico in inglese, non nostro.
const GENERIC_CALLABLE_CODES = new Set(["functions/internal", "functions/unknown"]);

export function getAdminActionError(error: unknown, fallback: string): string {
  if (isConnectionError(error)) {
    return PAROLE.erroreRete;
  }

  const code = String((error as { code?: unknown } | null | undefined)?.code ?? "");
  const message = error instanceof Error ? error.message.trim() : "";

  if (code.startsWith("functions/") && !GENERIC_CALLABLE_CODES.has(code) && message) {
    return message;
  }

  if (code) {
    return `${fallback} (codice: ${code})`;
  }

  return message || fallback;
}
