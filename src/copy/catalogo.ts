// Catalogo pubblico (/activities, ActivitiesPage) e stato di un'attività
// mostrato a chi non è iscritto (card del catalogo, /activities/:id,
// /me/activities). Convenzioni in ./parole.ts.

export const CATALOGO = {
  titolo: "Attività",
  descrizione: "Apri un'attività per vedere programma, dettagli e iscrizione.",
  periodo: "Periodo",
  inProgramma: "In programma",
  passate: "Passate",
  tutte: "Tutte",
  conteggioUna: "1 attività",
  conteggio: "{numero} attività",
  vuotoInProgramma: "Nessuna attività in programma",
  vuotoInProgrammaTesto:
    "Le prossime attività del palo compariranno qui. Intanto puoi rivedere quelle passate.",
  mostraPassate: "Mostra le attività passate",
  vuotoFiltri: "Nessuna attività con questi filtri",
  vuotoFiltriTesto: "Prova a cambiare organizzazione o iscrizioni.",
  togliFiltri: "Togli i filtri",
  vuotoPassate: "Nessuna attività passata",
  vuotoPassateTesto: "Qui compariranno le attività concluse.",
  mostraInProgramma: "Mostra le attività in programma",
  vuotoPalo: "Ancora nessuna attività",
  vuotoPaloTesto: "Le attività del palo compariranno qui appena pubblicate.",
  palo: "Palo",
  mese: "Mese",
  tuttiIMesi: "Tutti i mesi",
  tipo: "Tipo",
  tuttiITipi: "Tutti i tipi",
  tipi: {
    standard: "Attività",
    overnight: "Pernottamento",
    trip: "Gita",
    camp: "Campeggio",
    multi_day: "Più giorni",
  },
  dettagli: "Dettagli",
  dettagliIscrizione: "Dettagli e iscrizione",
  legenda:
    "Attività pubbliche dei pali d'Italia. Un palo senza attività pubblicate resta vuoto.",
  caricamento: "Caricamento delle attività.",
  // Stato dell'attività per chi non è iscritto (src/utils/publicEventState.ts).
  // «Iscrizioni chiuse» e «Iscrizioni dal {data}» sono quelle dei momenti.
  iscrizioniAperte: "Iscrizioni aperte",
  conclusa: "Conclusa",
  annullata: "Annullata",
  // Solo lo staff vede le bozze (/me/activities).
  bozza: "Bozza",
  // "Le iscrizioni chiudono {quando}" + "tra 3 giorni".
  chiudonoTra: "Le iscrizioni chiudono {quando}",
  traUnGiorno: "tra 1 giorno",
  traGiorni: "tra {numero} giorni",
  traUnOra: "tra 1 ora",
  traOre: "tra {numero} ore",
  traUnMinuto: "tra 1 minuto",
  traMinuti: "tra {numero} minuti",
} as const;
