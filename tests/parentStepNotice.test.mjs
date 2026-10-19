import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ISCRIZIONE } from "../src/copy/iscrizione.ts";
import {
  getParentStepNotice,
  parentStepNoticeSendsLink,
} from "../src/utils/parentStepNotice.ts";

// Avviso del passo "Genitore e sicurezza" nel modulo di iscrizione. Deve dire
// quello che il salvataggio fa DAVVERO, cioè la somma di tre cose:
//  1. lo stato dopo il salvataggio (src/utils/registrationStatus.ts: il modulo
//     chiede sempre "in attesa" con i dati del genitore);
//  2. se il trigger onRegistrationPendingParentAuth manda la mail
//     (functions/lib/parentAuthorization.js);
//  3. l'esito della mail mostrato all'utente (getParentEmailOutcome: "email_sent"
//     vale "partita" solo con brevoMessageId).
//
// Gli attesi sono scritti a mano da quelle tre regole, non copiati
// dall'implementazione di src/utils/parentStepNotice.ts.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FUNCTIONS_TESTO = readFileSync(
  path.join(ROOT, "functions", "lib", "parentAuthorization.js"),
  "utf8",
);

const TOKEN_ID = "tok_1";
const MAIL_ID = "msg_1";
const SELF_IL = "2026-10-19T10:00:00.000Z";

// Iscrizione già salvata, come la legge il modulo. `parentAuthorization` si
// passa così com'è: null e undefined sono due casi diversi dei dati vecchi.
const iscrizione = (registrationStatus, parentAuthorization) => ({
  registrationStatus,
  parentAuthorization,
});

// Stato dell'autorizzazione con i campi che contano per il trigger.
const firma = (status, extra = {}) => ({
  status,
  tokenId: null,
  brevoMessageId: null,
  selfTokenIssuedAt: null,
  emailRetryCount: 0,
  ...extra,
});

const IN_ATTESA = "pending_parent_authorization";

// Legge dal file delle functions le costanti che il trigger usa, senza
// importarlo (richiede firebase-admin). Se il file cambia forma il test si
// ferma qui invece di confrontare con un numero vecchio.
function leggiCostante(nome, formato) {
  const trovato = FUNCTIONS_TESTO.match(new RegExp(`const ${nome}\\s*=\\s*(${formato})\\s*;`));
  assert.ok(trovato, `${nome} non trovata in functions/lib/parentAuthorization.js`);
  return trovato[1];
}

const MAX_EMAIL_RETRIES = Number(leggiCostante("MAX_EMAIL_RETRIES", "\\d+"));
const DECIDED_PARENT_AUTH_STATUSES = JSON.parse(
  leggiCostante("DECIDED_PARENT_AUTH_STATUSES", "\\[[^\\]]*\\]"),
);

// --- Casi espliciti ---------------------------------------------------------
// [nome, iscrizione già salvata, avviso atteso]

const CASI = [
  // Nessuna iscrizione: il salvataggio la crea in attesa e il trigger scrive.
  ["nessuna iscrizione (null)", null, "nuovo_link"],
  ["nessuna iscrizione (undefined)", undefined, "nuovo_link"],

  // Firma presente: lo stato resta (o l'annullata torna attiva), nessuna mail.
  [
    "confirmed con firma",
    iscrizione("confirmed", firma("authorized", { tokenId: TOKEN_ID, brevoMessageId: MAIL_ID })),
    "autorizzata",
  ],
  [
    "confirmed senza parentAuthorization (null, vecchio flusso con documento caricato)",
    iscrizione("confirmed", null),
    "autorizzata",
  ],
  [
    "confirmed senza parentAuthorization (campo assente)",
    iscrizione("confirmed", undefined),
    "autorizzata",
  ],
  [
    "active con firma",
    iscrizione("active", firma("authorized", { tokenId: TOKEN_ID })),
    "autorizzata",
  ],
  [
    "in attesa con firma già arrivata (il trigger non riscrive una firma)",
    iscrizione(IN_ATTESA, firma("authorized", { tokenId: TOKEN_ID })),
    "autorizzata",
  ],
  [
    "annullata con firma (risalvata torna active, senza mail)",
    iscrizione("cancelled", firma("authorized", { tokenId: TOKEN_ID, brevoMessageId: MAIL_ID })),
    "autorizzata",
  ],
  [
    "annullata con firma e senza tokenId",
    iscrizione("cancelled", firma("authorized")),
    "autorizzata",
  ],

  // Annullata senza firma: il salvataggio la rimette in attesa.
  ["annullata senza parentAuthorization (null)", iscrizione("cancelled", null), "nuovo_link"],
  [
    "annullata senza parentAuthorization (campo assente)",
    iscrizione("cancelled", undefined),
    "nuovo_link",
  ],
  [
    "annullata con email_sent, brevoMessageId e tokenId (torna in attesa, nessuna mail nuova)",
    iscrizione("cancelled", firma("email_sent", { tokenId: TOKEN_ID, brevoMessageId: MAIL_ID })),
    "scritto",
  ],
  [
    "annullata con email_sent e tokenId ma senza brevoMessageId",
    iscrizione("cancelled", firma("email_sent", { tokenId: TOKEN_ID })),
    "in_invio",
  ],
  [
    "annullata con email_error",
    iscrizione("cancelled", firma("email_error", { tokenId: TOKEN_ID, emailRetryCount: 1 })),
    "mail_fallita",
  ],
  [
    "annullata con autorizzazione ancora senza link",
    iscrizione("cancelled", firma("pending_request")),
    "nuovo_link",
  ],

  // In attesa senza un link emesso: il trigger scrive al genitore.
  ["in attesa senza parentAuthorization (null)", iscrizione(IN_ATTESA, null), "nuovo_link"],
  [
    "in attesa senza parentAuthorization (campo assente)",
    iscrizione(IN_ATTESA, undefined),
    "nuovo_link",
  ],
  [
    "in attesa con tokenId null",
    iscrizione(IN_ATTESA, firma("pending_parent_authorization", { tokenId: null })),
    "nuovo_link",
  ],
  [
    "in attesa con email_sent e brevoMessageId ma tokenId null",
    iscrizione(IN_ATTESA, firma("email_sent", { tokenId: null, brevoMessageId: MAIL_ID })),
    "nuovo_link",
  ],
  [
    "in attesa con pending_request e tokenId null",
    iscrizione(IN_ATTESA, firma("pending_request", { tokenId: null })),
    "nuovo_link",
  ],

  // In attesa con un link già emesso: nessuna mail nuova, salvo indirizzo cambiato.
  [
    "in attesa con email_sent e brevoMessageId (mail partita)",
    iscrizione(IN_ATTESA, firma("email_sent", { tokenId: TOKEN_ID, brevoMessageId: MAIL_ID })),
    "scritto",
  ],
  [
    "in attesa con email_sent senza brevoMessageId (non ancora confermata)",
    iscrizione(IN_ATTESA, firma("email_sent", { tokenId: TOKEN_ID, brevoMessageId: null })),
    "in_invio",
  ],
  [
    "in attesa con email_sent e brevoMessageId stringa vuota",
    iscrizione(IN_ATTESA, firma("email_sent", { tokenId: TOKEN_ID, brevoMessageId: "" })),
    "in_invio",
  ],
  [
    "in attesa con pending_request e tokenId",
    iscrizione(IN_ATTESA, firma("pending_request", { tokenId: TOKEN_ID })),
    "in_invio",
  ],
  [
    "in attesa con pending_parent_authorization e tokenId",
    iscrizione(IN_ATTESA, firma("pending_parent_authorization", { tokenId: TOKEN_ID })),
    "in_invio",
  ],

  // Invio fallito: il trigger riprova (anche se il tokenId c'è già).
  [
    "in attesa con email_error e tokenId",
    iscrizione(IN_ATTESA, firma("email_error", { tokenId: TOKEN_ID, emailRetryCount: 1 })),
    "mail_fallita",
  ],
  [
    "in attesa con email_error senza tokenId",
    iscrizione(IN_ATTESA, firma("email_error", { tokenId: null, emailRetryCount: 1 })),
    "mail_fallita",
  ],
  [
    "in attesa con email_error e brevoMessageId di un invio precedente",
    iscrizione(
      IN_ATTESA,
      firma("email_error", { tokenId: TOKEN_ID, brevoMessageId: MAIL_ID, emailRetryCount: 1 }),
    ),
    "mail_fallita",
  ],

  // Il genitore con account ha già usato "Autorizza ora".
  [
    "in attesa con selfTokenIssuedAt",
    iscrizione(
      IN_ATTESA,
      firma("pending_parent_authorization", { tokenId: TOKEN_ID, selfTokenIssuedAt: SELF_IL }),
    ),
    "autorizza_ora",
  ],

  // Rifiuto: nessuna mail, nemmeno con un indirizzo nuovo.
  ["rejected_by_parent come stato dell'iscrizione, senza autorizzazione", iscrizione("rejected_by_parent", null), "rifiutata"],
  [
    "rejected_by_parent come stato dell'iscrizione, con autorizzazione ancora in corso",
    iscrizione("rejected_by_parent", firma("email_sent", { tokenId: TOKEN_ID, brevoMessageId: MAIL_ID })),
    "rifiutata",
  ],
  [
    "rejected_by_parent come stato dell'autorizzazione, iscrizione in attesa",
    iscrizione(IN_ATTESA, firma("rejected_by_parent", { tokenId: TOKEN_ID })),
    "rifiutata",
  ],
  [
    "rejected_by_parent come stato dell'autorizzazione, senza tokenId (il trigger salta una decisione già presa)",
    iscrizione(IN_ATTESA, firma("rejected_by_parent", { tokenId: null })),
    "rifiutata",
  ],
  [
    "rejected_by_parent come stato dell'autorizzazione, iscrizione attiva",
    iscrizione("active", firma("rejected_by_parent", { tokenId: TOKEN_ID })),
    "rifiutata",
  ],
  [
    "annullata con autorizzazione rejected_by_parent",
    iscrizione("cancelled", firma("rejected_by_parent", { tokenId: TOKEN_ID })),
    "rifiutata",
  ],
  [
    "annullata con autorizzazione rejected_by_parent e senza tokenId",
    iscrizione("cancelled", firma("rejected_by_parent")),
    "rifiutata",
  ],

  // Lo stato resta com'è, senza firma né mail.
  ["active senza autorizzazione (null)", iscrizione("active", null), "nessuno"],
  ["active senza autorizzazione (campo assente)", iscrizione("active", undefined), "nessuno"],
  [
    "active con un link emesso ma non firmato (il trigger guarda solo le iscrizioni in attesa)",
    iscrizione("active", firma("email_sent", { tokenId: TOKEN_ID, brevoMessageId: MAIL_ID })),
    "nessuno",
  ],
  [
    "active con email_error",
    iscrizione("active", firma("email_error", { tokenId: TOKEN_ID, emailRetryCount: 1 })),
    "nessuno",
  ],
  ["waitlist senza autorizzazione", iscrizione("waitlist", null), "nessuno"],
  ["submitted senza autorizzazione", iscrizione("submitted", null), "nessuno"],
  ["draft senza autorizzazione", iscrizione("draft", null), "nessuno"],
];

for (const [nome, esistente, atteso] of CASI) {
  test(`${nome}: ${atteso}`, () => {
    assert.equal(getParentStepNotice(esistente), atteso);
  });
}

// --- Tetto dei tentativi ----------------------------------------------------

test("email_error oltre il tetto dei tentativi resta mail_fallita: il trigger riparte solo con un indirizzo diverso", () => {
  // retryCapReached ferma i riprovi automatici se l'indirizzo non cambia, ma
  // una mail corretta nel modulo vale un tentativo in più. L'avviso non vede
  // l'indirizzo nuovo, quindi dice "se cambi l'indirizzo, nuovo link": vero
  // in entrambi i casi, e il suggerimento sotto il campo resta acceso.
  const esistente = iscrizione(
    IN_ATTESA,
    firma("email_error", { tokenId: TOKEN_ID, emailRetryCount: MAX_EMAIL_RETRIES }),
  );
  assert.equal(getParentStepNotice(esistente), "mail_fallita");
  assert.equal(parentStepNoticeSendsLink(getParentStepNotice(esistente)), true);

  const sopra = iscrizione(
    IN_ATTESA,
    firma("email_error", { tokenId: TOKEN_ID, emailRetryCount: MAX_EMAIL_RETRIES + 2 }),
  );
  assert.equal(getParentStepNotice(sopra), "mail_fallita");
});

test("emailRetryCount mancante o non numerico non cambia l'avviso", () => {
  const senzaConteggio = iscrizione(IN_ATTESA, {
    status: "email_error",
    tokenId: TOKEN_ID,
  });
  assert.equal(getParentStepNotice(senzaConteggio), "mail_fallita");
});

// --- Funzione pura ----------------------------------------------------------

function congela(valore) {
  if (valore && typeof valore === "object") {
    for (const figlio of Object.values(valore)) {
      congela(figlio);
    }
    Object.freeze(valore);
  }
  return valore;
}

test("l'iscrizione passata non viene modificata e il risultato non dipende da chiamate precedenti", () => {
  const esistente = congela(
    iscrizione("cancelled", firma("email_sent", { tokenId: TOKEN_ID, brevoMessageId: MAIL_ID })),
  );
  const prima = getParentStepNotice(esistente);
  getParentStepNotice(null);
  getParentStepNotice(iscrizione("confirmed", null));
  assert.equal(getParentStepNotice(esistente), prima);
  assert.equal(esistente.registrationStatus, "cancelled");
  assert.equal(esistente.parentAuthorization.status, "email_sent");
});

// --- parentStepNoticeSendsLink ----------------------------------------------

test("il suggerimento sotto l'email promette un link solo dove ne può ancora partire uno", () => {
  const atteso = {
    nuovo_link: true,
    scritto: true,
    in_invio: true,
    mail_fallita: true,
    autorizza_ora: true,
    autorizzata: false,
    rifiutata: false,
    nessuno: false,
  };

  for (const [avviso, promette] of Object.entries(atteso)) {
    assert.equal(parentStepNoticeSendsLink(avviso), promette, avviso);
  }
});

test("ogni caso esplicito ha un avviso che il suggerimento sa leggere", () => {
  const senzaLink = new Set(["autorizzata", "rifiutata", "nessuno"]);
  for (const [nome, esistente, atteso] of CASI) {
    assert.equal(
      parentStepNoticeSendsLink(getParentStepNotice(esistente)),
      !senzaLink.has(atteso),
      nome,
    );
  }
});

// --- Confronto con salvataggio e trigger su tutte le combinazioni ----------
// Modello del salvataggio e del trigger scritto dalle regole sopra, senza
// guardare parentStepNotice.ts. Non ricalcola l'avviso: controlla le
// proprietà che l'avviso non può violare senza mentire all'utente.

const STATI_ISCRIZIONE = [
  "draft",
  "submitted",
  "confirmed",
  "waitlist",
  "active",
  "cancelled",
  IN_ATTESA,
  "rejected_by_parent",
];

// Stati che le functions scrivono davvero sull'autorizzazione ("expired",
// "revoked" e "not_required" restano nel tipo ma nessuno li scrive).
const STATI_AUTORIZZAZIONE = [
  "pending_request",
  "pending_parent_authorization",
  "email_sent",
  "email_error",
  "authorized",
  "rejected_by_parent",
];

function tutteLeAutorizzazioni() {
  const stati = [null];
  for (const status of STATI_AUTORIZZAZIONE) {
    for (const tokenId of [null, TOKEN_ID]) {
      for (const brevoMessageId of [null, MAIL_ID]) {
        // "Autorizza ora" emette un link e scrive questo stato.
        const selfValori =
          status === "pending_parent_authorization" && tokenId ? [null, SELF_IL] : [null];
        const tentativi = status === "email_error" ? [0, 1, MAX_EMAIL_RETRIES] : [0];
        for (const selfTokenIssuedAt of selfValori) {
          for (const emailRetryCount of tentativi) {
            stati.push(firma(status, { tokenId, brevoMessageId, selfTokenIssuedAt, emailRetryCount }));
          }
        }
      }
    }
  }
  return stati;
}

// Stato dell'iscrizione dopo il salvataggio del modulo (che chiede sempre
// "in attesa" con i dati del genitore): chi esiste lo conserva, tranne
// l'annullata, che torna attiva se la firma c'era e in attesa altrimenti.
function statoDopoIlSalvataggio(esistente) {
  if (!esistente) return IN_ATTESA;
  if (esistente.registrationStatus !== "cancelled") return esistente.registrationStatus;
  return esistente.parentAuthorization?.status === "authorized" ? "active" : IN_ATTESA;
}

// Il trigger scrive al genitore, con lo stesso indirizzo di prima?
// onRegistrationPendingParentAuth: solo iscrizioni in attesa; mai su una
// decisione già presa; si ferma al tetto dei tentativi; con un link già
// emesso non rimanda, tranne dopo un invio fallito.
function ilTriggerScrive(esistente) {
  if (statoDopoIlSalvataggio(esistente) !== IN_ATTESA) return false;
  const stato = esistente?.parentAuthorization;
  if (!stato) return true;
  if (DECIDED_PARENT_AUTH_STATUSES.includes(stato.status)) return false;
  if (stato.status === "email_error") return stato.emailRetryCount < MAX_EMAIL_RETRIES;
  return !stato.tokenId;
}

// Può partire un link, magari solo con un indirizzo diverso? Il trigger
// rimette in gioco solo le autorizzazioni non ancora decise.
function unLinkPuoPartire(esistente) {
  if (statoDopoIlSalvataggio(esistente) !== IN_ATTESA) return false;
  const stato = esistente?.parentAuthorization;
  return !stato || !DECIDED_PARENT_AUTH_STATUSES.includes(stato.status);
}

test("su tutte le combinazioni l'avviso non contraddice salvataggio e trigger", () => {
  const autorizzazioni = tutteLeAutorizzazioni();
  let verificate = 0;

  for (const registrationStatus of STATI_ISCRIZIONE) {
    for (const parentAuthorization of autorizzazioni) {
      const esistente = congela(structuredClone(iscrizione(registrationStatus, parentAuthorization)));
      const avviso = getParentStepNotice(esistente);
      const dove = `${registrationStatus} + ${JSON.stringify(parentAuthorization)} => ${avviso}`;
      const stato = parentAuthorization;
      const rifiuto =
        registrationStatus === "rejected_by_parent" || stato?.status === "rejected_by_parent";
      const firmata =
        !rifiuto && (registrationStatus === "confirmed" || stato?.status === "authorized");

      // Se il trigger scrive, l'avviso non può dire che nessuno scriverà.
      if (ilTriggerScrive(esistente)) {
        assert.ok(["nuovo_link", "mail_fallita"].includes(avviso), `trigger scrive: ${dove}`);
      }

      // "Nuovo link" vale solo dove il trigger scrive davvero.
      if (avviso === "nuovo_link") {
        assert.equal(ilTriggerScrive(esistente), true, `nuovo_link senza mail: ${dove}`);
      }

      // Un invio fallito: o il trigger riprova, o siamo al tetto dei tentativi.
      if (avviso === "mail_fallita") {
        assert.equal(stato?.status, "email_error", `mail_fallita senza errore: ${dove}`);
        assert.equal(statoDopoIlSalvataggio(esistente), IN_ATTESA, `mail_fallita fuori attesa: ${dove}`);
        if (!ilTriggerScrive(esistente)) {
          assert.ok(stato.emailRetryCount >= MAX_EMAIL_RETRIES, `mail_fallita senza tetto: ${dove}`);
        }
      }

      // Link già emesso (scritto, in invio, autorizza ora): nessuna mail nuova.
      if (["scritto", "in_invio", "autorizza_ora"].includes(avviso)) {
        assert.equal(ilTriggerScrive(esistente), false, `mail nuova sotto "${avviso}": ${dove}`);
        assert.ok(stato?.tokenId, `${avviso} senza link emesso: ${dove}`);
        assert.equal(statoDopoIlSalvataggio(esistente), IN_ATTESA, `${avviso} fuori attesa: ${dove}`);
      }

      // "scritto" solo con la conferma del provider.
      if (avviso === "scritto") {
        assert.equal(stato.status, "email_sent", dove);
        assert.ok(stato.brevoMessageId, `scritto senza brevoMessageId: ${dove}`);
      }

      // "Autorizza ora" solo se è stato usato, e se è stato usato lo dice.
      if (avviso === "autorizza_ora") {
        assert.ok(stato?.selfTokenIssuedAt, `autorizza_ora senza selfTokenIssuedAt: ${dove}`);
      }
      if (stato?.selfTokenIssuedAt && statoDopoIlSalvataggio(esistente) === IN_ATTESA && !rifiuto && !firmata) {
        assert.equal(avviso, "autorizza_ora", `autorizza_ora ignorato: ${dove}`);
      }

      // Firma presente (e nessun rifiuto): l'avviso lo dice.
      if (firmata) {
        assert.equal(avviso, "autorizzata", `firma ignorata: ${dove}`);
      }
      if (avviso === "autorizzata") {
        assert.equal(firmata, true, `firma inventata: ${dove}`);
      }

      // Rifiuto, anche annullato.
      assert.equal(avviso === "rifiutata", rifiuto, dove);

      // Il suggerimento promette un link solo dove ne può partire uno.
      assert.equal(parentStepNoticeSendsLink(avviso), unLinkPuoPartire(esistente) && !rifiuto && !firmata, dove);

      verificate += 1;
    }
  }

  assert.equal(verificate, STATI_ISCRIZIONE.length * autorizzazioni.length);
  assert.ok(verificate > 200, `combinazioni verificate: ${verificate}`);
});

// --- Frasi condivise con il server e con il modulo -------------------------

test("ISCRIZIONE.genitoreHaRifiutato è identica alla frase del server", () => {
  const letta = FUNCTIONS_TESTO.match(
    /const ALREADY_REJECTED_MESSAGE\s*=\s*("(?:[^"\\]|\\.)*")\s*;/,
  );
  assert.ok(letta, "ALREADY_REJECTED_MESSAGE non trovata in functions/lib/parentAuthorization.js");

  const frase = JSON.parse(letta[1]);
  assert.equal(typeof frase, "string");
  assert.ok(frase.length > 0);
  assert.equal(ISCRIZIONE.genitoreHaRifiutato, frase);
});

for (const chiave of ["nuovoLinkSeCambi", "emailGenitoreSuggerimento"]) {
  test(`ISCRIZIONE.${chiave} esiste e finisce col punto`, () => {
    const frase = ISCRIZIONE[chiave];
    assert.equal(typeof frase, "string", `${chiave} non è una stringa`);
    assert.ok(frase.length > 0, `${chiave} è vuota`);
    assert.equal(frase, frase.trim(), `${chiave} ha spazi ai bordi`);
    assert.ok(frase.endsWith("."), `${chiave} non finisce col punto: ${frase}`);
  });
}
