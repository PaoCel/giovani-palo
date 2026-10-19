// "Iscrizione inviata" (docs/FLUSSO_GENITORE.md, H), al posto del ritorno
// muto in Famiglia o nella propria scheda. Convenzioni in ./parole.ts.

import { ATTIVITA } from "./attivita.ts";
import { FAMIGLIA } from "./famiglia.ts";
import { ISCRIZIONE } from "./iscrizione.ts";
import { PAROLE } from "./parole.ts";

export const INVIATA = {
  titolo: "Iscrizione inviata",
  chiudi: "Chiudi",
  cosaSuccede: "Cosa succede dopo",

  // Genitore, autorizzazione da dare (G5: "Autorizza ora" apre la firma di oggi).
  attesaTua: "In attesa della tua autorizzazione",
  autorizzaTitolo: "Autorizza la partecipazione di {nome}",
  autorizzaTesto: "Leggi i dettagli dell'attività e confermi. Ci vogliono un paio di minuti.",
  autorizzaOra: PAROLE.autorizzaOra,
  apertura: FAMIGLIA.apertura,
  erroreAutorizza: "Non siamo riusciti ad aprire l'autorizzazione: riprova.",

  dirigentiTitolo: "I dirigenti vedono già l'iscrizione",
  dirigentiTesto: "La trovano nell'elenco dell'attività.",
  autorizziTitolo: "Autorizzi tu",
  // L'esito della mail si legge dall'iscrizione: mai promettere un link che non è partito.
  autorizziMandato: "Ora, o dal link mandato a {email}, valido 14 giorni.",
  autorizziInInvio: "Ora, o dal link che ti mandiamo a {email}, valido 14 giorni.",
  autorizziMailFallita: "Ora, da qui: la mail a {email} non è partita.",
  // Dopo "Autorizza ora" il link della mail non vale più.
  riprendiFirma: FAMIGLIA.riprendiFirma,
  autorizzataTitolo: "Partecipazione autorizzata",
  autorizzataTesto: "Lo stato dell'iscrizione lo trovi in Famiglia.",
  famigliaTitolo: "Segui tutto da Famiglia",
  famigliaTesto: "Stato, modifiche e annullamento, per ognuno dei tuoi figli.",
  iscriviAltro: "Iscrivi un altro figlio o figlia",
  vaiAFamiglia: ISCRIZIONE.vaiAFamiglia,

  // Partecipo io.
  attesaGenitore: "In attesa dell'autorizzazione del tuo genitore",
  genitoreTitolo: "Il tuo genitore autorizza",
  genitoreScritto: "Abbiamo scritto al tuo genitore a {email}.",
  genitoreInInvio: "Stiamo scrivendo al tuo genitore a {email}.",
  genitoreMailFallita: "La mail non è partita: controlla l'indirizzo.",
  modifica: "Modifica",
  autorizzataIo: "Il tuo genitore ha autorizzato la partecipazione.",
  schedaTitolo: "La ritrovi nella tua scheda",
  schedaTesto: "Hai sbagliato qualcosa? Modifica o annulla dalla tua scheda.",
  vaiAllaScheda: "Vai alla tua scheda",
  // Adulto che si è iscritto lui (per esempio un dirigente): poi un figlio.
  iscriviFiglio: ATTIVITA.iscriviFiglio,
} as const;
