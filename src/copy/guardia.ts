// Guardia adulto (docs/FLUSSO_GENITORE.md, G): chi partecipa a un'attività per
// i giovani con almeno 19 anni il primo giorno. Convenzioni in ./parole.ts.

import { CHI_PARTECIPA } from "./chiPartecipa.ts";

export const GUARDIA = {
  titolo: "Attività per i giovani",
  // "Il 24 aprile 2027 avrai 47 anni.": `{anni}` è "47 anni", in grassetto.
  avrai: "Il {giorno} avrai {anni}.",
  anni: "{eta} anni",
  chiPartecipa: CHI_PARTECIPA.titolo,
  iscrivoFiglio: CHI_PARTECIPA.iscrivoFiglio,
  // Account appena creato: si passa ai dati da genitore, nome e cognome restano.
  iscrivoFiglioNuovo: "Nome e cognome restano i tuoi.",
  // Account già esistente: nessun cambio di tipo.
  iscrivoFiglioEsistente: "Il tuo account resta com'è.",
  dirigente: "Partecipo come dirigente o accompagnatore",
  dirigenteDettaglio: "Al passo dopo è già scelto.",
  dataSbagliata: "Ho sbagliato la data",
  dataSbagliataDettaglio: "Torni sul campo, niente salvato.",
  // Account già esistente: la data si corregge in «I tuoi dati».
  dataSbagliataEsistente: "La correggi nei tuoi dati, niente salvato.",
  confermo: "Confermo, partecipo io come giovane",
} as const;
