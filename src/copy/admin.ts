// Schermate admin: impostazioni del palo e del modulo, editor attività, scheda
// dell'attività, feed e gallerie. Solo le frasi già passate dal glossario;
// convenzioni in ./parole.ts.

import { ANNULLA } from "./annulla.ts";
import { DOMANDE } from "./domande.ts";
import { PAROLE } from "./parole.ts";

export const ADMIN = {
  // Interruttore `requireLoginForEdit`, uguale in tutte le schermate.
  richiediAccountPerModificare: "Richiedi un account per modificare l'iscrizione",
  // Impostazioni del palo, campo `accountHelpText`.
  testoGuidaAccountPlaceholder: "Testo guida nella pagina Accedi.",

  // Fogli di conferma dell'admin (mai un dialogo del browser): la scelta
  // sicura viene prima, il tasto che toglie qualcosa è rosso.
  eliminazione: PAROLE.eliminazione,
  erroreRete: PAROLE.erroreRete,

  // Iscrizioni (scheda dell'attività, tab Iscritti e Consensi).
  annullaIscrizioneTitolo: "Annullare l'iscrizione di {nome}?",
  annullaIscrizioneCorpo:
    "Non risulterà più tra gli iscritti di «{attivita}». Lo storico resta e puoi riattivarla da questa scheda.",
  tieniIscrizione: ANNULLA.tieniIscrizione,
  confermaAnnulla: ANNULLA.confermaAnnulla,
  annullamento: ANNULLA.annullamento,
  erroreAnnulla: ANNULLA.errore,
  eliminaIscrizioneTitolo: "Eliminare l'iscrizione di {nome}?",
  eliminaIscrizioneCorpo:
    "Il documento sparisce e non si può recuperare. Firme e PDF già salvati restano nell'archivio e vanno tolti a parte. Per toglierla solo dagli iscritti, annullala: si può riattivare.",
  confermaEliminaIscrizione: "Sì, elimina l'iscrizione",
  erroreEliminaIscrizione: "Impossibile eliminare l'iscrizione.",

  // Attività.
  eliminaAttivitaTitolo: "Eliminare «{attivita}»?",
  eliminaAttivitaCorpo:
    "Spariscono anche il modulo, le iscrizioni e le domande. Non si può recuperare.",
  tieniAttivita: "Tieni l'attività",
  confermaEliminaAttivita: "Sì, elimina l'attività",
  erroreEliminaAttivita: "Impossibile eliminare l'attività.",

  // Pattuglie del campeggio: "Elimina e salva" salva anche il resto della bozza.
  eliminaPattugliaTitolo: "Eliminare la pattuglia «{nome}»?",
  eliminaPattugliaCorpo: "I suoi membri tornano da assegnare. Comitati e pattuglie si salvano subito.",
  eliminaPattugliaCorpoBozza:
    "I suoi membri tornano da assegnare. Comitati e pattuglie si salvano subito, con le altre modifiche non ancora salvate.",
  tieniPattuglia: "Tieni la pattuglia",
  confermaEliminaPattuglia: "Sì, elimina e salva",
  salvataggio: "Salvataggio...",
  erroreSalvaCampo: "Impossibile salvare comitati e pattuglie.",

  // Domande per il caminetto, viste dall'admin.
  eliminaDomandaTitolo: DOMANDE.eliminaTitolo,
  eliminaDomandaCorpo: "Sparisce anche per chi l'ha scritta e non si può recuperare.",
  tieniDomanda: DOMANDE.tieni,
  confermaEliminaDomanda: DOMANDE.conferma,
  erroreEliminaDomanda: DOMANDE.errore,

  // Domande del sondaggio.
  eliminaDomandaSondaggioTitolo: "Eliminare la domanda del sondaggio?",
  eliminaDomandaSondaggioCorpo: "Sparisce dal sondaggio. Le risposte già inviate restano.",

  // Consensi: invii a persone reali, che non si annullano.
  moduliVecchioMetodoTitolo: "Generare i moduli per le approvazioni del vecchio metodo?",
  moduliVecchioMetodoCorpo:
    "Per ogni autorizzazione approvata col vecchio metodo preparo il modulo ufficiale e ne mando una copia al genitore. Chi ha già un modulo firmato viene saltato. Le email non si possono richiamare.",
  nonOra: "Non ora",
  confermaModuliVecchioMetodo: "Sì, genera e invia",
  generazione: "Generazione...",
  erroreModuliVecchioMetodo: "Impossibile generare i moduli del vecchio metodo.",
  completamentoTitoloUno: "Mandare 1 email al genitore?",
  completamentoTitoloPiu: "Mandare {n} email ai genitori?",
  completamentoCorpo:
    "È un invio a persone reali e non si può annullare. Ogni genitore riceve un link per completare le scelte su foto e social.",
  nonInviare: "Non inviare",
  confermaCompletamentoUno: "Sì, invia 1 email",
  confermaCompletamentoPiu: "Sì, invia {n} email",
  invio: "Invio...",
  erroreCompletamento: "Impossibile inviare le email ai genitori.",
  completamentoElencoCambiato:
    "L'elenco dei destinatari è cambiato dopo il controllo. Nessuna email è stata inviata: rifai il controllo e verifica l'elenco.",

  // Feed.
  eliminaPostTitolo: "Eliminare il post «{titolo}»?",
  eliminaPostCorpo: "Sparisce dal feed di tutti e non si può recuperare.",
  tieniPost: "Tieni il post",
  confermaEliminaPost: "Sì, elimina il post",
  erroreEliminaPost: "Impossibile eliminare il post.",
  errorePubblicaPost: "Impossibile cambiare lo stato del post.",

  // Gallerie (foto e video usano i testi di GALLERIA).
  eliminaGalleriaTitolo: "Eliminare la galleria «{titolo}»?",
  eliminaGalleriaCorpo:
    "Spariscono la galleria e i suoi post nel feed, e non si può recuperare. Foto e video caricati restano nell'archivio.",
  tieniGalleria: "Tieni la galleria",
  confermaEliminaGalleria: "Sì, elimina la galleria",
  erroreEliminaGalleria: "Impossibile eliminare la galleria.",
  erroreEliminaMedia: "Impossibile eliminare il file.",
  erroreCover: "Impossibile impostare la cover.",
  erroreSposta: "Impossibile spostare il file.",

  // Impostazioni del palo: unità, admin, profilo e moduli.
  erroreUnita: "Impossibile salvare l'unità.",
  erroreRimuoviUnita: "Impossibile rimuovere l'unità.",
  erroreAssegnaAdmin: "Impossibile assegnare il ruolo di admin.",
  erroreImpostazioni: "Impossibile salvare le impostazioni.",
} as const;
