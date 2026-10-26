// Annullare un'iscrizione: le stesse parole in Famiglia, nella propria scheda
// (/me) e nell'admin. Convenzioni in ./parole.ts.

export const ANNULLA = {
  annullaIscrizione: "Annulla l'iscrizione",
  annullamento: "Annullamento...",
  annullata: "Iscrizione annullata correttamente.",
  errore: "Impossibile annullare l'iscrizione.",
  // Foglio di conferma, in Famiglia e nella propria scheda: la scelta sicura
  // viene prima.
  tieniIscrizione: "Tieni l'iscrizione",
  confermaAnnulla: "Sì, annulla l'iscrizione",
  // La propria iscrizione (/me/activities/:id): dice se si potrà rifare.
  titoloTua: "Annulli la tua iscrizione?",
  corpoAperteTua:
    "Non risulterai più tra gli iscritti di «{attivita}». Lo storico resta, e puoi rifare l'iscrizione finché le iscrizioni sono aperte (fino al {data}).",
  corpoChiuseTua:
    "Non risulterai più tra gli iscritti di «{attivita}». Lo storico resta, ma le iscrizioni sono chiuse: non potrai rifarla.",
  // Nessuna risposta dal server: la scrittura può partire al ritorno della rete.
  erroreRete:
    "Il server non risponde: controlla la connessione. Se l'annullamento è partito, lo vedi qui appena torna la rete.",
} as const;
