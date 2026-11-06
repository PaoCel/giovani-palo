// Modalità rapida e attività annunciata (docs/ATTIVITA_MODULARI.md, «Settimo
// incremento»). Annunciata = status "planned" + isPublic + isVisible: la
// vedono tutti, nessuno può ancora iscriversi. Una frase per concetto:
// allo staff «Annunciata», a ragazzi e famiglie «Iscrizioni a breve».
// Convenzioni in ./parole.ts.

export const ANNUNCIATA = {
  // Stato, allo staff e al pubblico.
  statoStaff: "Annunciata",
  iscrizioniABreve: "Iscrizioni a breve",
  registerChiuso: "Iscrizioni a breve: il modulo non è ancora aperto.",
  registerTornaScheda: "Torna all'attività",
  schedaRiquadroTesto: "Lo staff sta preparando il modulo. Torna qui nei prossimi giorni.",
  condividi: "Guarda questa attività: le iscrizioni aprono a breve.",

  // Dati che mancano.
  luogoDaDefinire: "Luogo da definire",
  oraDaDefinire: "ora da definire",
  dalle: "dalle {ora}",
  daScegliere: "Da scegliere",

  // Foglio rapido.
  rapidaTitolo: "Nuova attività",
  rapidaKicker: "Nel calendario",
  rapidaTesta: "Mettila in calendario",
  rapidaTestaTesto: "Bastano nome, tipo e data. Il resto lo aggiungi quando lo sai.",
  dal: "Dal",
  oraSuggerimento: "L'ora è facoltativa: senza, scriviamo «ora da definire».",
  aggiungiInMese: "Aggiungi in {mese}",
  nome: "Nome",
  nomePlaceholder: "Es. Serata giochi",
  tipo: "Tipo",
  quando: "Quando",
  data: "Giorno",
  ora: "Ora d'inizio",
  oraFacoltativa: "facoltativa",
  finoAl: "Fino al",
  luogo: "Luogo",
  luogoFacoltativo: "facoltativo",
  luogoPlaceholder: "Es. Cappella di via Roma",
  piedeAnnuncio: "Salvando, ragazzi e famiglie la vedono subito, con le iscrizioni non ancora aperte.",
  salva: "Salva nel calendario",
  aggiungiDettagli: "Aggiungi i dettagli adesso",
  salvataggio: "Salvataggio…",
  dataPassata: "Questo giorno è già passato: ragazzi e famiglie la vedranno come conclusa.",
  doppione: "C'è già «{titolo}» in questo giorno.",
  erroreNome: "Scrivi il nome dell'attività.",
  erroreData: "Scegli il giorno.",
  erroreFine: "Scegli fino a quando dura.",
  erroreFinePrima: "La fine deve venire dopo l'inizio.",
  erroreRete: "Non è stata salvata. Controlla la connessione e riprova: quello che hai scritto resta qui.",
  riprova: "Riprova",

  // Dopo il salvataggio.
  salvataTitolo: "È nel calendario",
  salvataTesto: "Ragazzi e famiglie la vedono con «Iscrizioni a breve».",
  aggiungineUnAltra: "Aggiungine un'altra",
  completaDettagli: "Completa i dettagli",
  correggi: "Correggi",
  elimina: "Elimina",
  eliminata: "Eliminata · Ragazzi e famiglie non la vedono più",
  rimetti: "Rimetti",
  fatto: "Fatto",
  aggiunteAdesso: "Aggiunte adesso",
  cambiataNelFrattempo: "Nel frattempo è cambiata: aprila dalla scheda.",
  correzioneSalva: "Salva le correzioni",

  // Uscita con dati non salvati.
  uscitaTitolo: "Questa attività non è ancora nel calendario",
  uscitaTesto: "Quello che hai scritto qui non è salvato.",
  uscitaGiroUna: "L'attività già salvata in questo giro resta nel calendario.",
  uscitaGiro: "Le {n} attività già salvate in questo giro restano nel calendario.",
  continuaCompilare: "Continua a compilare",
  salvaEdEsci: "Salva ed esci",
  scartaCampi: "Scarta i campi",

  // Scheda admin e passi.
  daCompletareTitolo: "Da completare per aprire le iscrizioni",
  apriIscrizioni: "Apri le iscrizioni",
  apriIscrizioniEffetto: "Da adesso ragazzi e famiglie possono iscriversi.",
  passiKicker: "Annunciata · {titolo}",
  passiAvviso: "La vedono già ragazzi e famiglie: ogni passo salvato si vede subito.",
  esciSalvata: "Salvata. Resta annunciata.",
  togliSceltaSicura: "Lasciala annunciata",
  togliFatto: "È in bozza: la vede solo lo staff.",

  // «Annuncia», da una bozza o dalle iscrizioni aperte.
  annuncia: "Annuncia",
  annunciaDaBozzaTitolo: "Annunciare l'attività?",
  annunciaDaBozzaTesto: "Ragazzi e famiglie la vedono subito, con le iscrizioni non ancora aperte.",
  lasciaInBozza: "Lascia in bozza",
  annunciaDaAperteTitolo: "Rimettere l'attività annunciata?",
  annunciaDaAperteTesto: "Le iscrizioni si chiudono, ragazzi e famiglie continuano a vederla.",
  lasciaAperte: "Lascia aperte le iscrizioni",
  annunciaConIscritti: "Ci sono già iscritti: per chiudere le iscrizioni usa «Togli dal catalogo».",
  annunciaFatto: "È annunciata: la vedono tutti, le iscrizioni non sono aperte.",
  annunciaSenzaDati: "Per annunciarla servono il nome e il giorno.",
} as const;
