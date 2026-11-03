// Stanza assegnata e compagni di stanza (docs/ROOM_MANAGEMENT.md, «Compagni di
// stanza»): scheda del partecipante (/me) e Famiglia. Convenzioni in ./parole.ts.

import { CHI_PARTECIPA } from "./chiPartecipa.ts";

export const STANZA = {
  titolo: "La tua stanza",
  titoloFiglio: "La stanza di {nome}",
  // "Con Sara Conti e Marta Leone": gli adulti con l'etichetta della scheda
  // Gruppo, anche gli accompagnatori.
  con: "Con {nomi}",
  adulto: "{nome} ({ruolo})",
  dirigente: CHI_PARTECIPA.categoriaDirigente,
  // Ultimo separatore dell'elenco: "Sara Conti, Marta Leone e Anna Neri".
  ultimoSeparatore: " e ",
  postoLetto: "1 posto letto",
  postiLetto: "{n} posti letto",
  stanzaEPosti: "{stanza} · {posti}",
  nessunAltro: "Per ora nessun altro in stanza.",
  errore: "Non riesco a leggere i compagni di stanza adesso.",
} as const;
