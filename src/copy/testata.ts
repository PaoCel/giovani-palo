// Testata comune e navigazione (task gugd-restyling, fase 4). Convenzioni in
// ./parole.ts: frase definitiva come valore, segnaposto `{nome}`.

export const TESTATA = {
  // Riga piccola sopra il nome del palo o dell'unità: "GUGD Italia · Admin".
  contesto: "GUGD Italia · {ruolo}",
  // Al posto del nome del palo quando il profilo non lo ha.
  ilMioPalo: "Il mio palo",
  apriMenuAccount: "Apri il menu dell'account",
  vistaGiovane: "Vista giovane",
  vistaAdmin: "Vista admin",
  aggiornaApp: "Aggiorna l'app",
  navigazione: "Navigazione",
} as const;
