// «Chi sei?» dopo un account nuovo creato fuori da un'attività
// (docs/FLUSSO_GENITORE.md, I; al posto del vecchio dialogo del browser).
// Convenzioni in ./parole.ts.

import { PAROLE } from "./parole.ts";

export const CHI_SEI = {
  eyebrow: "Account creato",
  titolo: "Chi sei?",
  lead: "Così ti mostriamo le cose giuste. Puoi cambiarlo dal profilo.",
  ragazzo: "Sono un ragazzo o una ragazza",
  ragazzoDettaglio: "Mi iscrivo io alle attività.",
  genitore: "Sono un genitore",
  genitoreDettaglio: "Iscrivo i miei figli e seguo le loro iscrizioni.",
  dirigente: "Sono un dirigente o un accompagnatore",
  // Nessun permesso da qui: il ruolo da dirigente lo dà un admin.
  dirigenteDettaglio: "Partecipo da adulto. L'accesso da dirigente lo dà un admin del palo.",
  esci: PAROLE.esci,
  cambia: "Cambia",
  cambiaScelta: "Cambia la risposta a «Chi sei?»",
} as const;
