// "Accedi con Google" su un telefono che ha già una sessione anonima (iscrizione da
// ospite, richieste ai record senza account). Il primo tentativo collega Google alla
// sessione anonima (così l'iscrizione appena fatta resta sua); ma se quel Google ha
// già un account Firebase il collegamento è impossibile: l'SDK risponde
// `auth/credential-already-in-use` (o `auth/email-already-in-use`) e porta con sé la
// credenziale. Il passaggio standard è lasciare la sessione anonima ed entrare
// nell'account esistente con quella credenziale.
//
// Qui sta solo la decisione, senza importare Firebase: i test la provano con errori
// finti (tests/anonymousAccountSwitch.test.mjs). Il popup Google vero no.

const EXISTING_ACCOUNT_CODES: ReadonlySet<string> = new Set([
  "auth/credential-already-in-use",
  "auth/email-already-in-use",
]);

// Il collegamento è fallito perché esiste già un account con questo accesso.
export function isExistingAccountError(error: unknown) {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && EXISTING_ACCOUNT_CODES.has(code);
}

// Quando la credenziale non c'è: la sessione anonima è già stata lasciata, quindi
// al prossimo tentativo l'accesso con Google entra direttamente nell'account.
export const EXISTING_ACCOUNT_RETRY_MESSAGE =
  "Esiste già un account con questo accesso. Premi di nuovo «Accedi con Google» per entrare.";

export const EXISTING_ACCOUNT_RETRY_CODE = "auth/existing-account-retry";

export async function linkOrSwitchToExistingAccount<TResult, TCredential>(deps: {
  // Il collegamento alla sessione anonima (linkWithPopup).
  link: () => Promise<TResult>;
  // La credenziale portata dall'errore, o null (GoogleAuthProvider.credentialFromError).
  readCredential: (error: unknown) => TCredential | null;
  // Lascia la sessione anonima (come resetAnonymousSessionIfNeeded).
  discardAnonymousSession: () => Promise<void>;
  signInWithCredential: (credential: TCredential) => Promise<TResult>;
}): Promise<TResult> {
  try {
    return await deps.link();
  } catch (error) {
    // Popup chiuso, rete, permessi: restano gli errori di sempre, e la sessione anonima intatta.
    if (!isExistingAccountError(error)) throw error;

    let credential: TCredential | null = null;
    try {
      credential = deps.readCredential(error);
    } catch {
      credential = null;
    }
    await deps.discardAnonymousSession();
    if (!credential) {
      throw Object.assign(new Error(EXISTING_ACCOUNT_RETRY_MESSAGE), {
        code: EXISTING_ACCOUNT_RETRY_CODE,
      });
    }
    return deps.signInWithCredential(credential);
  }
}
