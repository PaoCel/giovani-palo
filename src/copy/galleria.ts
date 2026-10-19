// Galleria dell'attività e lightbox (ActivityGallery, MediaLightbox): solo le
// frasi dei fogli "Elimina"; convenzioni in ./parole.ts.

import { PAROLE } from "./parole.ts";

export const GALLERIA = {
  // Fogli di conferma (mai un dialogo del browser): la scelta sicura viene prima.
  eliminaFotoTitolo: "Eliminare questa foto?",
  eliminaVideoTitolo: "Eliminare questo video?",
  eliminaContenutoCorpo: "Sparisce dalla galleria per tutti e non si può recuperare.",
  tieniFoto: "Tieni la foto",
  tieniVideo: "Tieni il video",
  confermaEliminaFoto: "Sì, elimina la foto",
  confermaEliminaVideo: "Sì, elimina il video",
  eliminaCommentoTitolo: "Eliminare questo commento?",
  eliminaCommentoCorpo: "Sparisce per tutti e non si può recuperare.",
  tieniCommento: "Tieni il commento",
  confermaEliminaCommento: "Sì, elimina il commento",
  eliminazione: "Eliminazione...",
  erroreElimina: "Non sono riuscito a eliminarlo. Riprova.",
  erroreRete: PAROLE.erroreRete,
} as const;
