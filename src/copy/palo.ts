// Appartenenza al palo (docs/APPARTENENZA_AL_PALO.md, «Client della fase 3»):
// banner per chi aspetta o è fuori, superfici dei membri chiuse, uscita dal
// palo nel profilo, pagina "Persone" dello staff. Convenzioni in ./parole.ts.

import { ISCRIZIONE } from "./iscrizione.ts";
import { INVIATA } from "./inviata.ts";
import { PAROLE } from "./parole.ts";

// Senza codici di collegamento (arrivano con S3) e senza un contatto per
// persona, chi è fuori parla con il dirigente della sua unità.
const PARLANE_CON_UN_DIRIGENTE = "Se pensi sia un errore, parlane con un dirigente della tua unità.";

export const PALO = {
  // Banner, richiesta in attesa.
  attesaTitolo: "Stiamo verificando che tu faccia parte del palo",
  attesaCorpoUnita: "Lo conferma un dirigente di {unita} o un admin del palo. Intanto puoi iscriverti alle attività.",
  attesaCorpo: "Lo conferma un dirigente della tua unità o un admin del palo. Intanto puoi iscriverti alle attività.",
  // Richiesta senza unità (passata agli admin, o profilo senza unità).
  attesaCorpoAdmin: "Lo conferma un admin del palo. Intanto puoi iscriverti alle attività.",
  chiVerifica: "Chi verifica?",
  chiVerificaCorpo:
    "Un dirigente della tua unità o un admin del palo conferma che ti conosce: da quel momento vedi foto, record e sondaggi. Se aspetti da qualche giorno, parlane con un dirigente alla prossima attività.",
  chiVerificaCorpoAdmin:
    "Un admin del palo conferma che ti conosce: da quel momento vedi foto, record e sondaggi. Se aspetti da qualche giorno, parlane con un dirigente alla prossima attività.",
  ritiraRichiesta: "Ritira la richiesta",
  ritiraTitolo: "Ritirare la richiesta?",
  ritiraCorpo: "Non sarai più in coda per entrare nel palo. Potrai chiedere di nuovo quando vuoi.",
  tieniRichiesta: "Tieni la richiesta",
  confermaRitira: "Sì, ritira la richiesta",
  ritiro: "Ritiro...",
  chiudi: INVIATA.chiudi,

  // Banner, rifiuto: un testo solo, mai il motivo.
  rifiutoTitolo: "Non siamo riusciti a confermare che fai parte del palo",
  rifiutoCorpo: PARLANE_CON_UN_DIRIGENTE,
  // {dal}: "dal 28 ottobre", "dall'8 ottobre" (dateLabels in utils/stakeMembership.ts).
  potraiChiedereDiNuovo: "Potrai chiedere di nuovo {dal}.",
  chiediDiNuovo: "Chiedi di nuovo",
  nonRicordiAccount: "Non ricordi con quale account sei entrato?",
  nonRicordiCorpo:
    "Se avevi già un account, entra con quello: con Google o con l'email che usi di solito. Questo account puoi lasciarlo com'è.",
  cambiaAccount: PAROLE.cambiaAccount,

  // Banner, fuori dal palo.
  fuoriTitolo: "Non fai parte di nessun palo",
  fuoriCorpo: "Chiedi di entrare: un dirigente della tua unità conferma che ti conosce.",
  chiediDiEntrare: "Chiedi di entrare",
  invio: PAROLE.invio,
  rimossoTitolo: "Non fai più parte di questo palo",
  rimossoCorpo: PARLANE_CON_UN_DIRIGENTE,
  // Contatto di supporto del palo (impostazioni), la stessa frase dell'iscrizione.
  supporto: ISCRIZIONE.supporto,

  // Superfici dei membri chiuse (al posto degli errori della PWA vecchia).
  siSbloccano: "Si sbloccano dopo la verifica.",
  soloMembriFoto: "Foto e video sono visibili solo ai membri del palo.",
  soloMembriRecord: "I record sono visibili solo ai membri del palo.",
  soloMembriSondaggi: "I sondaggi sono solo per i membri del palo.",

  // Profilo, blocco "Palo".
  statoMembro: "Membro",
  statoInAttesa: "In attesa di verifica",
  statoFuori: "Non sei nel palo",
  esciDalPalo: "Esci dal palo",
  esciTitolo: "Uscire dal palo {palo}?",
  esciCorpo:
    "Non vedrai più foto, record e sondaggi del palo. Per rientrare dovrai chiedere di nuovo e aspettare la conferma di un dirigente.",
  // {ruolo}: "admin", "dirigente di unità".
  esciCorpoStaff: "Perdi anche il ruolo di {ruolo}.",
  ruoloAdmin: "admin",
  ruoloDirigente: "dirigente di unità",
  restaNelPalo: "Resta nel palo",
  confermaEsci: "Sì, esci dal palo",
  uscita: "Uscita...",

  // Errori della callable, per `details.reason`.
  erroreUltimoAdminTuo: "Sei l'ultimo admin del palo: prima nominane un altro.",
  erroreTroppiRifiuti: "Per entrare ora parlane con un dirigente della tua unità.",
  erroreVersione: "Nel frattempo qualcuno ha cambiato questa persona.",
  erroreNienteDaAnnullare: "Non c'è niente da annullare.",
  erroreStato: "Nel frattempo la situazione è cambiata: ricarica la pagina.",
  erroreProfilo: "Completa il profilo prima di chiedere di entrare.",
  erroreGenerico: "Non sono riuscito a completare l'azione. Riprova.",
  erroreRete: PAROLE.erroreRete,

  // Staff, pagina "Persone".
  persone: "Persone",
  personeAdminDescrizione:
    "Chi chiede di entrare nel palo, chi c'era già e va confermato, e le richieste rifiutate.",
  personeUnitaDescrizione: "Le persone che hanno dichiarato {unita}: approva chi conosci, il resto lo vedono gli admin.",
  schedaRichieste: "Richieste",
  schedaDaConfermare: "Da confermare",
  schedaRifiutate: "Rifiutate",
  approva: "Approva",
  nonLoConosco: "Non lo conosco",
  loConosco: "Lo conosco",
  altreAzioni: "Altre azioni",
  nonDellaMiaUnita: "Non è della mia unità",
  haGiaUnAccount: "Ha già un account",
  annullaRifiuto: "Annulla rifiuto",
  annulla: "Annulla",
  inAttesaOggi: "da oggi",
  inAttesaIeri: "da ieri",
  inAttesaGiorni: "da {n} giorni",
  // {il}: "il 18 ottobre", "l'8 ottobre".
  rifiutataIl: "rifiutata {il}",
  iscrizioni: "Iscrizioni: {attivita}",
  nessunaIscrizione: "Nessuna iscrizione",
  accountEsistente: "Account esistente",
  senzaUnita: "Senza unità",
  passataDalDirigente: "Passata dal dirigente",
  // Membro migrato segnato "Non lo conosco" dal dirigente (scelta S2-3).
  nonLoConosceIlDirigente: "Il dirigente non lo conosce",
  unitaDichiarata: "Unità dichiarata: {unita}",
  notaStessoNome: "Stesso nome e data di nascita di un membro attivo.",
  daConfermareSpiega:
    "Erano già nel palo prima della verifica. Conferma chi conosci: chi non conosci torna in coda e non vede più foto e record finché qualcuno lo approva.",
  daConfermareSpiegaDirigente:
    "Erano già nel palo prima della verifica. Conferma chi conosci: chi non conosci passa agli admin e non vede più foto e record finché un admin lo approva.",
  daConfermareDaTempo: "Da confermare da più di 30 giorni",
  rifiutateSpiega: "Le richieste rifiutate negli ultimi 30 giorni. «Annulla rifiuto» la rimette in coda.",
  vuotoRichiesteTitolo: "Nessuna richiesta in attesa",
  vuotoRichiesteCorpo: "Quando qualcuno chiede di entrare nel palo, la richiesta arriva qui.",
  vuotoDaConfermareTitolo: "Nessuno da confermare",
  vuotoDaConfermareCorpo: "Tutte le persone che erano già nel palo sono state confermate.",
  vuotoRifiutateTitolo: "Nessuna richiesta rifiutata",
  vuotoRifiutateCorpo: "Qui trovi le richieste rifiutate negli ultimi 30 giorni.",
  erroreCoda: "Non riesco a caricare le richieste. Controlla la connessione e riprova.",
  caricamentoCoda: "Sto caricando le richieste...",
  senzaNome: "Senza nome",
  senzaUnitaProfilo: "Il tuo profilo non ha un'unità: le richieste della tua unità arriveranno quando un admin te la assegna.",

  // Toast dopo un'azione dello staff, con "Annulla" per 5 secondi.
  toastApprovato: "Hai approvato {nome}",
  toastRifiutato: "Hai rifiutato la richiesta di {nome}",
  toastPassata: "Hai passato {nome} agli admin",
  toastConfermato: "Hai confermato {nome}",
  toastInCoda: "{nome} torna in coda",
  toastAnnullato: "Azione annullata.",

  // Dashboard dello staff.
  richiesteTitolo: "Richieste di accesso",
  richiesteUna: "1 persona aspetta una conferma.",
  richiestePiu: "{n} persone aspettano una conferma.",
  daConfermareTitolo: "Conferma i membri della tua unità",
  daConfermareUno: "1 persona da confermare.",
  daConfermarePiu: "{n} persone da confermare.",
  apriPersone: "Apri Persone",
} as const;
