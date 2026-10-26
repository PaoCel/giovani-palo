// Intestazione dei passi dell'iscrizione (ActivityRegisterPage, RegisterFlowHeader):
// attività, per chi, percorso e account con cui sei entrato. Convenzioni in ./parole.ts.

import { PAROLE } from "./parole.ts";

export const PERCORSO = {
  eyebrow: "Iscrizione",
  indietro: "Indietro",
  esci: PAROLE.esci,
  // "Per: te · Cambia": la scelta fatta in "Chi partecipa?", in ogni passo.
  perTe: "Per: te",
  perFiglio: "Per: un figlio o una figlia",
  cambia: "Cambia",
  cambiaPerChi: "Cambia per chi è l'iscrizione",
  // Modulo di un figlio: "Stai iscrivendo Marco Rossi · Cambia" (torna a "Chi iscrivi?").
  staiIscrivendo: "Stai iscrivendo",
  cambiaFiglio: "Cambia chi iscrivi",
  // Percorso in tre tappe.
  tappaAccount: "Il tuo account",
  tappaDati: "I tuoi dati",
  tappaFiglio: "Chi iscrivi",
  tappaIscrizione: "Iscrizione",
  // Chi sta usando l'account, prima di scegliere (telefono di famiglia).
  seiEntratoCome: "Sei entrato come",
  cambiaAccount: PAROLE.cambiaAccount,
  // Sotto "Esci" quando l'account è appena creato e il profilo è ancora vuoto.
  accountResta: "Il tuo account resta: lo ritrovi quando accedi di nuovo.",
  // Account di un minore: dritto al modulo, senza "Chi partecipa?".
  partecipiTu: "Partecipi tu: {nome}",
  nonSeiTu: "Non sei {nome}?",
} as const;
