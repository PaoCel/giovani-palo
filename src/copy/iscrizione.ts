// Iscrizione a un'attività (/activities/:id/register, ActivityRegisterPage).
// Solo le frasi già passate dal glossario; convenzioni in ./parole.ts.

import { PAROLE } from "./parole.ts";

export const ISCRIZIONE = {
  // Iscrizione da ospite appena inviata.
  completataSenzaAccount: "Se non crei un account, i tuoi dati restano salvati solo per questa attività.",
  creaUnAccount: PAROLE.creaUnAccount,
  // Nessuna sessione, attività che accetta ospiti.
  comeVuoiProcedere: "Puoi iscriverti senza account oppure accedere con il tuo account.",
  accedi: PAROLE.accedi,
  // Nessuna sessione, attività che chiede un account.
  serveAccountPernottamento:
    "Questa attività prevede pernottamento o trasferta: per motivi di sicurezza ci si iscrive solo con un account.",
  serveAccount: "Per iscriverti a questa attività accedi o crea un account.",
  // Sessione anonima: un'altra persona dallo stesso telefono.
  altraPersonaAiuto:
    "Stai per iscrivere un'altra persona (es. un secondo figlio o figlia) dallo stesso dispositivo? Usa «Iscrivi un'altra persona»: chiude questa sessione anonima e ne apre una nuova.",
  altraPersonaSalva: "Salva prima codice e PDF: senza non potrai più modificare l'iscrizione attuale.",
  altraPersonaDomanda:
    "Vuoi iscrivere un'altra persona dallo stesso dispositivo (es. un secondo figlio o figlia)?",
  altraPersonaSalvaCodice:
    "Salva prima codice di recupero e PDF dell'iscrizione attuale: una volta aperta la nuova sessione non potrai più modificarla da qui senza il codice.",
  // Account genitore.
  scegliFiglio: "Scegli quale figlio o figlia iscrivere a questa attività.",
  aggiungiFiglio: PAROLE.aggiungiFiglio,
  salvataSulProfilo:
    "L'iscrizione verrà salvata sul profilo di {nome} e resterà gestibile dalla tua dashboard famiglia.",
  tuoFiglio: "tuo figlio o tua figlia",
  // Modulo, note mediche: lo compila anche il genitore, quindi niente "minore".
  noteMedicheIntro:
    "Tutto facoltativo. Dichiara solo ciò che ritieni utile per la sicurezza di chi partecipa. Le informazioni sono visibili solo agli admin.",
  farmaciPlaceholder: "Nome e dosaggio dei farmaci da assumere durante l'attività.",
} as const;
