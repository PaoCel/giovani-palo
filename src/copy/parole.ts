// Testi dell'interfaccia, un file per schermata (docs/FLUSSO_GENITORE.md,
// "Parole"; task gugd-i18n). Convenzioni:
// - ogni valore è la frase italiana definitiva, punto finale compreso: sarà la
//   chiave del catalogo quando arriveranno inglese e spagnolo;
// - una frase sola per un concetto solo: i termini del glossario stanno qui e
//   le schermate li riusano per riferimento, mai riscritti;
// - le parti variabili sono segnaposto `{nome}`, riempiti da `fillCopy`;
// - niente alias "@/" negli import: questi file li carica anche Node (test).

export const PAROLE = {
  accedi: "Accedi",
  creaUnAccount: "Crea un account",
  continuaConGoogle: "Continua con Google",
  esci: "Esci",
  cambiaAccount: "Cambia account",
  aggiungiFiglio: "Aggiungi un figlio o una figlia",
  autorizzaOra: "Autorizza ora",
  // Scrittura senza risposta dal server (offline): resta in coda e parte al
  // ritorno della rete; il pulsante si sblocca.
  erroreRete: "Il server non risponde: controlla la connessione e riprova.",
  // Pulsante di un foglio "Elimina" mentre la cancellazione è in corso.
  eliminazione: "Eliminazione...",
} as const;

// "Ciao {nome}" + { nome: "Marco" } → "Ciao Marco". Un segnaposto senza valore
// resta com'è, così un errore si vede a schermo invece di sparire.
export function fillCopy(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : placeholder,
  );
}
