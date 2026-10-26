// "Chi iscrivi?" (docs/FLUSSO_GENITORE.md, E) e il foglio per aggiungere o
// modificare un figlio dentro l'iscrizione. Convenzioni in ./parole.ts.

import { FAMIGLIA } from "./famiglia.ts";
import { PAROLE } from "./parole.ts";
import { PROFILO } from "./profilo.ts";

export const CHI_ISCRIVI = {
  titolo: "Chi iscrivi?",
  lead: "Scegli chi partecipa a «{attivita}».",
  // Senza figli salvati il modulo di aggiunta è già aperto nella pagina.
  leadPrimo:
    "Aggiungi tuo figlio o tua figlia: i dati restano nel tuo account per le prossime iscrizioni.",
  salvaEContinua: "Salva e continua",
  continuaCon: "Continua con {nome}",
  continua: PROFILO.continua,
  aggiungiFiglio: PAROLE.aggiungiFiglio,

  // Scheda del figlio: età il primo giorno dell'attività e unità.
  etaAlMese: "{eta} anni {mese}",
  eta: "{eta} anni",
  giaIscritto: "Già iscritto",
  giaIscritta: "Già iscritta",
  apri: "Apri",
  apriIscrizioneDi: "Apri l'iscrizione di {nome}",
  modificaDi: FAMIGLIA.modificaProfilo,
  soloGiovaniDonne: "Attività solo per Giovani Donne",
  soloGiovaniUomini: "Attività solo per Giovani Uomini",
  gruppoMancante: "Manca il gruppo: aggiungilo con la matita.",
  // Avvisi morbidi: si può scegliere lo stesso.
  sotto11: "Le attività GU e GD sono dagli 11 anni: controlla la data.",
  maggiorenneSolo: "{nome} è maggiorenne: può iscriversi da solo con il suo account.",
  maggiorenneSola: "{nome} è maggiorenne: può iscriversi da sola con il suo account.",

  // "14 anni ad aprile": il mese del primo giorno, con la sua preposizione.
  meseGennaio: "a gennaio",
  meseFebbraio: "a febbraio",
  meseMarzo: "a marzo",
  meseAprile: "ad aprile",
  meseMaggio: "a maggio",
  meseGiugno: "a giugno",
  meseLuglio: "a luglio",
  meseAgosto: "ad agosto",
  meseSettembre: "a settembre",
  meseOttobre: "a ottobre",
  meseNovembre: "a novembre",
  meseDicembre: "a dicembre",

  // Foglio "Aggiungi" e modifica (stesso foglio).
  foglioTitolo: PAROLE.aggiungiFiglio,
  foglioTitoloModifica: FAMIGLIA.modificaProfilo,
  foglioLead: "I dati restano nel tuo account per le prossime iscrizioni.",
  foglioLeadModifica: "Le iscrizioni già inviate restano con i dati di quando sono partite.",
  chiudiSenzaSalvare: "Chiudi senza salvare",
  annulla: "Annulla",
  salva: "Salva",
  salvataggio: PROFILO.salvataggio,

  nome: PROFILO.nome,
  cognome: PROFILO.cognome,
  dataNascita: PROFILO.dataNascita,
  gruppo: "Gruppo",
  giovaneUomo: PROFILO.giovaneUomo,
  giovaneDonna: PROFILO.giovaneDonna,
  unita: "Unità",
  selezionaUnita: PROFILO.selezionaUnita,
  comeLaTua: "come la tua",
  nessunaUnita: PROFILO.nessunaUnita,

  erroreNome: PROFILO.erroreNome,
  erroreDataNascita: PROFILO.erroreDataNascita,
  erroreDataNonValida: PROFILO.erroreDataNonValida,
  erroreGruppo: "Scegli il gruppo.",
  erroreUnita: "Scegli l'unità.",
  erroreSalvataggio: FAMIGLIA.erroreSalvataggio,
  erroreRete: FAMIGLIA.erroreRete,
} as const;
