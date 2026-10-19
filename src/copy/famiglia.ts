// Famiglia (/family, FamilyDashboardPage, e i profili dei figli in
// childrenService). Solo le frasi già passate dal glossario; convenzioni in
// ./parole.ts.

import { ANNULLA } from "./annulla.ts";
import { PAROLE } from "./parole.ts";

export const FAMIGLIA = {
  aggiungiFiglio: PAROLE.aggiungiFiglio,
  nessunFiglioDescrizione: "Aggiungi i tuoi figli per iscriverli alle attività e seguirne lo stato.",
  modificaProfilo: "Modifica il profilo di {nome}",
  rimuoviProfilo: "Rimuovere il profilo di {nome}?",
  // Foglio di conferma di "Rimuovi" (mai un dialogo del browser).
  rimuoviCorpo: "Il profilo sparisce dal tuo account. Puoi aggiungerlo di nuovo quando vuoi.",
  tieniProfilo: "Tieni il profilo",
  confermaRimuovi: "Sì, rimuovi il profilo",
  rimozione: "Rimozione...",
  erroreSalvataggio: "Impossibile salvare il profilo.",
  // Offline la scrittura resta in coda: si sblocca il pulsante e lo si dice.
  erroreRete: "Il server non risponde: controlla la connessione e riprova.",
  nomeObbligatorio: "Il nome è obbligatorio.",

  // Annullare l'iscrizione di un figlio (docs/FLUSSO_GENITORE.md, H e fase 2).
  // Stessi esiti di /me; la scelta sicura viene prima.
  annullaIscrizione: ANNULLA.annullaIscrizione,
  // Etichetta accessibile: più figli e più attività hanno lo stesso pulsante.
  annullaIscrizioneDi: "Annulla l'iscrizione di {nome} a «{attivita}»",
  annullamento: ANNULLA.annullamento,
  annullaTitolo: "Annulli l'iscrizione di {nome}?",
  annullaCorpoAperte:
    "Non risulterà più tra gli iscritti di «{attivita}». Lo storico resta, e puoi rifare l'iscrizione finché le iscrizioni sono aperte (fino al {data}).",
  annullaCorpoChiuse:
    "Non risulterà più tra gli iscritti di «{attivita}». Lo storico resta, ma le iscrizioni sono chiuse: non potrai rifarla.",
  // Attività non trovata (non pubblica o di un altro palo): niente promesse.
  annullaCorpoSenzaAttivita: "Non risulterà più tra gli iscritti. Lo storico resta.",
  tieniIscrizione: "Tieni l'iscrizione",
  confermaAnnulla: "Sì, annulla l'iscrizione",
  annullata: ANNULLA.annullata,
  erroreAnnulla: ANNULLA.errore,
  attivitaGenerica: "Attività",

  // Dopo "Autorizza ora" il link della mail non vale più.
  autorizzaOra: PAROLE.autorizzaOra,
  apertura: "Apertura...",
  riprendiFirma: `Firma lasciata a metà? Riprendi da «${PAROLE.autorizzaOra}»: il link della mail non vale più.`,

  // Home di un account adulto che non è da genitore (/me, /unit) con figli
  // salvati (docs/FLUSSO_GENITORE.md, fase 6): un rimando a Famiglia.
  homeEyebrow: "Famiglia",
  homeTitolo: "I tuoi figli",
  homeSottotitolo: "Le loro iscrizioni le segui in Famiglia.",
  homeNessuna: "Nessuna iscrizione attiva",
  homeUna: "1 iscrizione",
  homePiu: "{n} iscrizioni",
  homeDaAutorizzare: "da autorizzare",
  homeErrore: "Non riesco a leggere i tuoi figli adesso.",
  homeApri: "Apri",
} as const;
