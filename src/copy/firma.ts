// Pagina di firma dell'autorizzazione (/parent-confirm/:token,
// ParentConfirmPage). Solo le frasi toccate dal flusso genitore; convenzioni in
// ./parole.ts.

import { PAROLE } from "./parole.ts";

const RIPRENDI = `riprendi da «${PAROLE.autorizzaOra}» nella pagina Famiglia`;

export const FIRMA = {
  tornaAllaFamiglia: "Torna alla tua famiglia",
  // Link di "Autorizza ora" ancora valido.
  notaLinkAutorizzaOra: `Questo link vale 60 minuti. Se ti fermi a metà, ${RIPRENDI}.`,
  // Link sostituito da uno nuovo (mail nuova o "Autorizza ora").
  linkSostituitoTitolo: "Link non più valido",
  linkSostituitoConAccount: `Questo link è stato sostituito da uno nuovo. Per firmare, ${RIPRENDI}.`,
  linkSostituitoSenzaAccount: `Questo link è stato sostituito da uno nuovo. Usa il link dell'email più recente; se hai iscritto tu tuo figlio o tua figlia dal tuo account, ${RIPRENDI}.`,
  // Link scaduto, genitore entrato: "Autorizza ora" ne crea uno nuovo.
  linkScadutoTitolo: "Link scaduto",
  linkScadutoConAccount: `Questo link è scaduto. Per firmare, ${RIPRENDI}: ne crea uno nuovo.`,
  // Iscrizione annullata: il link non serve più.
  iscrizioneAnnullataTitolo: "Iscrizione annullata",
  iscrizioneAnnullataCorpo:
    "L'iscrizione è stata annullata, quindi non serve più autorizzarla. Se è un errore, rifai l'iscrizione dalla pagina dell'attività o contatta il dirigente della tua unità.",
} as const;
