// Cambio del tipo di account dal profilo (/me/profile, /family/profile): è il
// modo di cambiare la risposta a «Chi sei?». Convenzioni in ./parole.ts.

export const TIPO_ACCOUNT = {
  passaGenitore: "Passa ad account genitore",
  passaGenitoreTitolo: "Passare ad account genitore?",
  passaGenitoreTesto: "Potrai sempre tornare ad account partecipante dal profilo.",
  passaGenitoreInCorso: "Attivazione...",
  passaPartecipante: "Passa ad account partecipante",
  passaPartecipanteTitolo: "Tornare a un account partecipante?",
  passaPartecipanteTesto: "I profili dei figli e le loro iscrizioni restano salvati.",
  passaPartecipanteInCorso: "Cambio in corso...",
  restaComeSei: "Lascia com'è",
} as const;
