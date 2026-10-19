// Errori di Firebase Auth in italiano. Si decide sul codice, mai sul messaggio:
// il testo di Firebase ("Firebase: Error (auth/…)") non è copy per l'utente.
// Funzione pura, senza Firebase: la provano i test Node.

import { ACCEDI } from "../copy/accedi.ts";

// Finestra di Google chiusa o annullata: si resta dove si era, senza messaggi
// (docs/FLUSSO_GENITORE.md, C).
const SILENT_CODES: ReadonlySet<string> = new Set([
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
  "auth/user-cancelled",
]);

const MESSAGES: Readonly<Record<string, string>> = {
  "auth/invalid-credential": ACCEDI.erroreCredenziali,
  "auth/invalid-login-credentials": ACCEDI.erroreCredenziali,
  "auth/wrong-password": ACCEDI.erroreCredenziali,
  "auth/user-not-found": ACCEDI.erroreCredenziali,
  "auth/email-already-in-use": ACCEDI.erroreEmailGiaUsata,
  "auth/account-exists-with-different-credential": ACCEDI.erroreAltroAccesso,
  "auth/credential-already-in-use": ACCEDI.erroreAltroAccesso,
  "auth/invalid-email": ACCEDI.erroreEmail,
  "auth/missing-email": ACCEDI.erroreEmail,
  "auth/weak-password": ACCEDI.errorePassword,
  "auth/missing-password": ACCEDI.errorePassword,
  "auth/too-many-requests": ACCEDI.erroreTroppiTentativi,
  "auth/network-request-failed": ACCEDI.erroreRete,
  "auth/popup-blocked": ACCEDI.errorePopupBloccato,
  "auth/user-disabled": ACCEDI.erroreAccountDisattivato,
  "auth/operation-not-allowed": ACCEDI.erroreCreazioneChiusa,
  "auth/admin-restricted-operation": ACCEDI.erroreCreazioneChiusa,
  // Google già legato a un altro account (anonymousAccountSwitch.ts).
  "auth/existing-account-retry": ACCEDI.accountEsistenteRiprova,
  // Firestore, al salvataggio del profilo.
  unavailable: ACCEDI.erroreRete,
};

function readCode(error: unknown) {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : "";
}

function readMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "";
}

// Il messaggio da mostrare, oppure null quando non va mostrato niente.
export function getAuthErrorMessage(error: unknown): string | null {
  const code = readCode(error);

  if (SILENT_CODES.has(code)) {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(MESSAGES, code)) {
    return MESSAGES[code];
  }

  const message = readMessage(error).trim();

  // Un errore di Firebase che non conosciamo (ha sempre un codice) sarebbe in
  // inglese: meglio una frase generica. I messaggi scritti da noi, in
  // italiano e senza codice, passano com'erano.
  if (!message || code || /^firebase\b/iu.test(message)) {
    return ACCEDI.erroreGenerico;
  }

  return message;
}
