// Domande per il caminetto (QuestionsSection, nella scheda dell'attività).
// Solo le frasi del foglio "Elimina"; convenzioni in ./parole.ts.

import { PAROLE } from "./parole.ts";

export const DOMANDE = {
  // Foglio di conferma (mai un dialogo del browser): la scelta sicura viene prima.
  eliminaTitolo: "Eliminare questa domanda?",
  eliminaCorpo: "Sparisce anche per gli organizzatori e non si può recuperare.",
  tieni: "Tieni la domanda",
  conferma: "Sì, elimina la domanda",
  eliminazione: PAROLE.eliminazione,
  errore: "Impossibile eliminare la domanda.",
  erroreRete: PAROLE.erroreRete,
} as const;
