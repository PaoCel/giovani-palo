// Annullare un'iscrizione: le stesse parole in Famiglia, nella propria scheda
// (/me) e nell'admin. Convenzioni in ./parole.ts.

export const ANNULLA = {
  annullaIscrizione: "Annulla l'iscrizione",
  annullamento: "Annullamento...",
  annullata: "Iscrizione annullata correttamente.",
  errore: "Impossibile annullare l'iscrizione.",
  // Nessuna risposta dal server: la scrittura può partire al ritorno della rete.
  erroreRete:
    "Il server non risponde: controlla la connessione. Se l'annullamento è partito, lo vedi qui appena torna la rete.",
} as const;
