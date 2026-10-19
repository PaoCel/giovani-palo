// Pagina Accedi (/login, AuthAccessPanel). Convenzioni in ./parole.ts.

import { PAROLE } from "./parole.ts";

export const ACCEDI = {
  // Schede alla pari: il titolo segue la scheda scelta.
  titoloAccedi: PAROLE.accedi,
  titoloCrea: PAROLE.creaUnAccount,
  leadAccedi: "Con l'account che usi di solito: Google o email.",
  leadCrea: "Ti serve per seguire le iscrizioni e ritrovarle la prossima volta.",
  schede: "Accedi o crea un account",
  schedaAccedi: PAROLE.accedi,
  schedaCrea: PAROLE.creaUnAccount,
  google: PAROLE.continuaConGoogle,
  oppureConEmail: "oppure con email",
  email: "Email",
  emailPlaceholder: "nome@esempio.it",
  password: "Password",
  passwordPlaceholderAccedi: "La tua password",
  passwordPlaceholderCrea: "Almeno 6 caratteri",
  confermaPassword: "Conferma password",
  confermaPasswordPlaceholder: "Ripeti la password",
  mostraPassword: "Mostra password",
  nascondiPassword: "Nascondi password",
  mostra: "Mostra",
  nascondi: "Nascondi",
  passwordDimenticata: "Password dimenticata?",
  inviaAccedi: PAROLE.accedi,
  inviaCrea: PAROLE.creaUnAccount,
  attendi: "Un attimo...",
  notaAccedi: `Prima volta qui? Scegli «${PAROLE.creaUnAccount}».`,
  notaCrea: `Hai già un account? Scegli «${PAROLE.accedi}».`,
  // Sotto il modulo di "Crea un account": a cosa servono i dati.
  notaDati: "I dati servono solo per attività, presenze e comunicazioni collegate.",
  notaDatiDefault: "Pochi dati essenziali, poi puoi gestire tutto dal tuo profilo.",
  // Sessione anonima già aperta su questo telefono.
  ospiteIscrizione:
    "Hai già iniziato come ospite: se crei un account adesso, colleghiamo subito l'iscrizione appena fatta al tuo profilo.",
  ospiteRecord:
    "Se hai già inviato richieste da questo telefono, restano alla verifica degli adulti: non si spostano sull'account.",
  // Google già collegato a un altro account (anonymousAccountSwitch.ts).
  accountEsistenteRiprova: `Esiste già un account con questo accesso. Premi di nuovo «${PAROLE.continuaConGoogle}» per accedere.`,

  // Già entrato: mai un redirect muto.
  verificaSessione: "Verifica sessione...",
  giaDentro: "Sei già dentro",
  vaiAllaTuaPagina: "Vai alla tua pagina",
  esciECambiaAccount: "Esci e cambia account",
  ruoloEUnita: "{ruolo} · {unita}",

  // Completa il profilo, ultimo passo.
  salvaEContinua: "Salva e continua",

  // Controlli del modulo prima di chiamare Firebase.
  erroreEmail: "Inserisci un indirizzo email valido.",
  errorePassword: "La password deve avere almeno 6 caratteri.",
  errorePasswordDiverse: "Le password non coincidono.",
  erroreCampi: "Completa i campi richiesti per continuare.",
  erroreEmailPerReset: "Inserisci prima la tua email per ricevere il link di reset.",
  resetInviato: "Ti abbiamo inviato il link per reimpostare la password.",

  // Errori di Firebase Auth per codice (src/utils/authErrors.ts). La finestra
  // di Google chiusa non ha messaggio: si resta dove si era.
  erroreCredenziali: "Email o password non corretti.",
  erroreEmailGiaUsata: `Esiste già un account con questa email: scegli «${PAROLE.accedi}».`,
  erroreAltroAccesso: `Esiste già un account con questo accesso: scegli «${PAROLE.accedi}».`,
  erroreTroppiTentativi: "Troppi tentativi: riprova tra qualche minuto.",
  erroreRete: "Connessione assente: controlla la rete e riprova.",
  errorePopupBloccato:
    "Il browser ha bloccato la finestra di Google: consenti le finestre pop-up e riprova.",
  erroreAccountDisattivato: "Questo account è disattivato: scrivi ai dirigenti del palo.",
  erroreCreazioneChiusa: "Qui non si possono creare account nuovi.",
  erroreGenerico: "Non ci siamo riusciti: riprova tra poco.",
} as const;
