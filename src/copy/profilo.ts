// "I tuoi dati": profilo da completare dopo un account nuovo, dentro
// l'iscrizione (docs/FLUSSO_GENITORE.md, D) e in Accedi dopo «Chi sei?».
// Convenzioni in ./parole.ts.

export const PROFILO = {
  // Dentro l'iscrizione, "Partecipo io": chi compila è chi partecipa.
  titoloIo: "Sei tu a partecipare",
  titoloDati: "I tuoi dati",
  leadIo: "Ti chiediamo solo ciò che serve per velocizzare le prossime iscrizioni.",
  leadGenitore: "Servono ai dirigenti per contattarti. Poi aggiungi i tuoi figli.",
  leadGenitoreAccedi: "Ti chiediamo solo ciò che serve per gestire le iscrizioni dei tuoi figli.",
  passoDi: "Passo {n} di {totale}",

  nome: "Nome",
  cognome: "Cognome",
  dataNascita: "Data di nascita",
  organizzazione: "Organizzazione",
  giovaneUomo: "Giovane uomo",
  giovaneDonna: "Giovane donna",
  dirigente: "Dirigente",
  accompagnatore: "Accompagnatore",
  unita: "La tua unità",
  selezionaUnita: "Seleziona un'unità",
  unitaNonInElenco: "Unità non in elenco",
  scriviUnita: "Scrivi la tua unità",
  aiutoUnitaManuale: "Se la tua unità non è ancora in elenco, scrivila qui.",
  aiutoPalo: "Palo: {palo}.",
  nessunaUnita: "Nessuna unità configurata",
  aiutoNessunaUnita: "L'amministratore deve prima configurare almeno un'unità.",
  comune: "Comune",
  comunePlaceholder: "Seleziona o scrivi un comune",

  // Un ragazzo che ha scelto per sbaglio "Iscrivo mio figlio o mia figlia".
  menoDi18: "Hai meno di 18 anni?",
  seiTuAPartecipare: "Sei tu a partecipare",

  continua: "Continua",
  indietro: "Indietro",
  salvataggio: "Salvataggio...",
  piede: "Puoi cambiarli quando vuoi dal profilo.",

  erroreNome: "Inserisci nome e cognome.",
  erroreDataNascita: "Inserisci la data di nascita.",
  erroreDataNonValida: "Controlla la data di nascita: non può essere nel futuro né prima del 1920.",
  erroreOrganizzazione: "Seleziona la tua organizzazione.",
  erroreUnita: "Indica il tuo rione o ramo.",
  erroreComune: "Indica il comune di riferimento.",
  erroreUnitaElenco: "Seleziona un'unità valida dall'elenco configurato.",
} as const;
