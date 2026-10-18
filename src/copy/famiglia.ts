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
  erroreSalvataggio: "Impossibile salvare il profilo.",
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
} as const;
