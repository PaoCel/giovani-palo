// Iscrizione a un'attività (/activities/:id/register, ActivityRegisterPage).
// Solo le frasi già passate dal glossario; convenzioni in ./parole.ts.

import { PAROLE } from "./parole.ts";

export const ISCRIZIONE = {
  // Iscrizione da ospite appena inviata.
  completataSenzaAccount: "Se non crei un account, i tuoi dati restano salvati solo per questa attività.",
  creaUnAccount: PAROLE.creaUnAccount,
  // Nessuna sessione, attività che accetta ospiti.
  comeVuoiProcedere: "Puoi iscriverti senza account oppure accedere con il tuo account.",
  accedi: PAROLE.accedi,
  // Nessuna sessione, attività che chiede un account.
  serveAccountPernottamento:
    "Questa attività prevede pernottamento o trasferta: per motivi di sicurezza ci si iscrive solo con un account.",
  serveAccount: "Per iscriverti a questa attività accedi o crea un account.",
  // Sessione anonima: un'altra persona dallo stesso telefono.
  altraPersonaAiuto:
    "Stai per iscrivere un'altra persona (es. un secondo figlio o figlia) dallo stesso dispositivo? Usa «Iscrivi un'altra persona»: chiude questa sessione anonima e ne apre una nuova.",
  altraPersonaSalva: "Salva prima codice e PDF: senza non potrai più modificare l'iscrizione attuale.",
  altraPersonaDomanda:
    "Vuoi iscrivere un'altra persona dallo stesso dispositivo (es. un secondo figlio o figlia)?",
  altraPersonaSalvaCodice:
    "Salva prima codice di recupero e PDF dell'iscrizione attuale: una volta aperta la nuova sessione non potrai più modificarla da qui senza il codice.",
  // Account genitore.
  scegliFiglio: "Scegli quale figlio o figlia iscrivere a questa attività.",
  aggiungiFiglio: PAROLE.aggiungiFiglio,
  salvataSulProfilo:
    "L'iscrizione verrà salvata sul profilo di {nome} e resterà gestibile dalla tua dashboard famiglia.",
  tuoFiglio: "tuo figlio o tua figlia",
  // Modulo, note mediche: lo compila anche il genitore, quindi niente "minore".
  noteMedicheIntro:
    "Tutto facoltativo. Dichiara solo ciò che ritieni utile per la sicurezza di chi partecipa. Le informazioni sono visibili solo agli admin.",
  farmaciPlaceholder: "Nome e dosaggio dei farmaci da assumere durante l'attività.",

  // "Il tuo account" dentro l'iscrizione (docs/FLUSSO_GENITORE.md, C).
  accountTitoloGenitore: "Il tuo account da genitore",
  accountLeadGenitore: "Iscrivi i tuoi figli e segui le loro iscrizioni da qui: a loro non serve un account.",
  accountPiedeGenitore: "Poi aggiungi tuo figlio o tua figlia.",
  accountTitoloIo: "Il tuo account",
  accountLeadIo: "Ti serve per seguire l'iscrizione e ritrovarla la prossima volta.",
  continuaSenzaAccount: "Continua senza account",
  // Ospite che apre una nuova sessione per un'altra persona (foglio di conferma).
  altraPersonaTitolo: "Iscrivere un'altra persona?",
  altraPersonaConferma:
    "Conferma di aver già salvato il codice di recupero o il PDF dell'iscrizione precedente: senza quelli non potrai più modificarla. Le richieste ai record fatte da questo telefono non si vedranno più.",
  altraPersonaResta: "Resta su questa iscrizione",
  altraPersonaVai: "Iscrivi un'altra persona",
  altraPersonaInCorso: "Apertura sessione...",
  // Uscita dal modulo con risposte non inviate (FLUSSO_GENITORE.md, F).
  esciTitolo: "Esci dall'iscrizione?",
  esciTesto: "Le risposte non inviate si perdono.",
  continuaACompilare: "Continua a compilare",
  esci: PAROLE.esci,
  vaiAFamiglia: "Vai a Famiglia",
  // Passo "Genitore e sicurezza" compilato da un account che iscrive un figlio.
  datiAccountInseriti: "Abbiamo inserito i dati del tuo account: controllali.",
  linkDopoInvio:
    "Dopo l'invio ti mandiamo un link per autorizzare la partecipazione di {nome}. Puoi farlo anche subito, alla fine.",
  // Invio senza rete o senza risposta: le risposte restano nel modulo.
  invioRete: "Il server non risponde: controlla la connessione e riprova. Le risposte restano qui.",
  invioErrore: "Non siamo riusciti a inviare l'iscrizione: riprova.",
  // Lettura dell'attività, dei figli o dell'iscrizione non riuscita.
  caricamentoTitolo: "Caricamento non riuscito",
  caricamentoTesto: "Non riusciamo a leggere l'attività: controlla la connessione e riprova.",
  riprova: "Riprova",
  supporto: "Per supporto rapido puoi contattare: {contatto}.",
  apriSessione: "Apertura sessione...",
} as const;
