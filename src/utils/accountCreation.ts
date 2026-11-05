// Sullo staging (demo.gugditalia.it) la registrazione Firebase Auth è chiusa:
// gli account li crea solo il seed (docs/MULTI_PALO_DEMO.md). "Crea un account"
// e "Continua con Google" lì fallirebbero, quindi non si mostrano
// (docs/KIT_DEMO.md, sezione 2, punto 5). In produzione `VITE_APP_ENV` non è
// "staging" e Vite elimina il ramo.
export function isAccountCreationClosed(appEnv: string | undefined): boolean {
  return appEnv === "staging";
}

export const ACCOUNT_CREATION_CLOSED = isAccountCreationClosed(import.meta.env?.VITE_APP_ENV);
