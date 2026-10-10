// Frasi che compaiono in più punti della scheda: una sola formulazione per
// concetto, così non divergono.

// Un record nascosto: conferma in riga e avviso nella sezione "Record nascosti".
export const HIDE_RECORD_EFFECT =
  "Il record sparisce dall'elenco e chi ci è iscritto viene ritirato.";
export const SHOW_RECORD_EFFECT = "Se lo mostri di nuovo, rientra chi ha ancora posto.";

// Un record senza iscritti: modulo "Nuovo record" e sezione "Senza iscritti".
export const EMPTY_RECORD_EFFECT =
  "Un record senza iscritti non compare ai ragazzi finché qualcuno si iscrive.";

// Come si torna indietro dopo Approva, Unisci e Rifiuta.
export const UNDO_DECISION_HINT = "Si annulla con “Riporta in attesa”.";

// Richieste senza account (coda "Da collegare").
export const REQUESTS_INTRO =
  "Persone senza account che si sono segnate da un telefono. Non contano finché non le colleghi a un'iscrizione.";
export const REQUESTS_EMPTY =
  "Nessuna richiesta da collegare. Quando qualcuno si segna senza account, la trovi qui.";
export const REJECT_REQUEST_EFFECT = "Il telefono vede un testo neutro, qualunque sia il motivo.";
export const UNDO_REJECT_REQUEST_HINT = "Si annulla con “Riapri”.";
// Lunghezza massima della nota interna di "Non collegabile" (la applica il server).
export const STAFF_NOTE_LIMIT = 200;

// Dove si annulla ciò che si è appena fatto sulle richieste (messaggio dopo l'azione).
export const UNDO_LINK_HINT = "Si annulla con «Scollega» in «Collegate».";
export const UNDO_REJECT_REQUEST_WHERE = "Si annulla con «Riapri» in «Non collegate».";
export const UNLINK_AGAIN_HINT = "Per collegarla di nuovo usa «Collega».";

// Richieste ritirate: si riaprono solo se la persona lo chiede.
export const REOPEN_WITHDRAWN_HINT =
  "Richieste ritirate da chi le ha inviate. Riapri solo se la persona lo chiede (per esempio dopo la chiusura, o se ha perso il telefono): l'ha ritirata lei. Con Riapri la richiesta torna in «Da collegare».";
