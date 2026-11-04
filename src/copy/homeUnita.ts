// Home del dirigente di unità (/unit), fase 4b del restyling. Le code Persone
// usano i testi di ./palo.ts. Convenzioni in ./parole.ts.

export const HOME_UNITA = {
  titolo: "Benvenuto",
  // {unita}: nome dell'unità del profilo, oppure unitaDiRiserva.
  descrizione: "Vista per i dirigenti di {unita}",
  unitaDiRiserva: "la tua unità",

  senzaUnitaTitolo: "Nessuna unità collegata al tuo account",
  senzaUnitaCorpo:
    "Per vedere i giovani e le iscrizioni serve che un admin del palo assegni la tua unità al profilo. Contatta l'amministratore.",

  // Riquadri dei totali e indicatori delle righe: stessa icona, stessa parola.
  totali: "Totali delle ultime attività",
  iscritti: "Iscritti unità",
  passaggio: "Passaggio necessario",
  consensoFoto: "Consenso foto mancante",
  consensoGenitore: "Autorizzazione genitore mancante",
  // Testo per i lettori di schermo accanto al numero della riga: «3 Iscritti unità».
  indicatore: "{n} {cosa}",

  attivitaTitolo: "Attività del palo",
  attivitaDescrizione: "Le ultime 6 attività: tocca una riga per vedere i giovani della tua unità.",
  erroreAttivita: "Impossibile caricare le attività",
  caricamentoAttivita: "Caricamento attività...",
  vuotoTitolo: "Nessuna attività",
  vuotoCorpo: "Le attività del palo compariranno qui non appena pubblicate.",

  feedTitolo: "Dalle attività",
  feedDescrizione: "Ultime novità e gallerie del palo.",
};
