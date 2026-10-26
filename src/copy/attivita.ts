// Pagina attività (/activities/:id, ActivityDetailPage): ingresso
// all'iscrizione (docs/FLUSSO_GENITORE.md, A). Convenzioni in ./parole.ts.

export const ATTIVITA = {
  iscriviti: "Iscriviti",
  iscriviFiglio: "Iscrivi tuo figlio o tua figlia",
  // "Sei un genitore? {link} da qui.": il link porta all'iscrizione con la
  // scelta del figlio già fatta.
  rigaGenitore: "Sei un genitore? {link} da qui.",
} as const;
