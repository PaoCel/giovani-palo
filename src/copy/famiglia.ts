// Famiglia (/family, FamilyDashboardPage, e i profili dei figli in
// childrenService). Solo le frasi già passate dal glossario; convenzioni in
// ./parole.ts.

import { PAROLE } from "./parole.ts";

export const FAMIGLIA = {
  aggiungiFiglio: PAROLE.aggiungiFiglio,
  nessunFiglioDescrizione: "Aggiungi i tuoi figli per iscriverli alle attività e seguirne lo stato.",
  modificaProfilo: "Modifica il profilo di {nome}",
  rimuoviProfilo: "Rimuovere il profilo di {nome}?",
  erroreSalvataggio: "Impossibile salvare il profilo.",
  nomeObbligatorio: "Il nome è obbligatorio.",
} as const;
