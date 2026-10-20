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
//     chiede sempre "in attesa" con i dati del genitore; un'iscrizione attiva
//     senza firma né rifiuto passa in attesa, le altre conservano lo stato);
//  2. se il trigger onRegistrationPendingParentAuth manda la mail
//     (functions/lib/parentAuthorization.js). Ogni ingresso in attesa da un
//     altro stato (annullata, ma anche attiva che ora chiede il genitore) è una
//     richiesta nuova: link nuovo e mail comunque
//     (restartParentAuthorizationAfterCancellation), qualunque fosse lo stato
//     dell'autorizzazione tranne "authorized", che torna attiva senza mail;
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

  // Annullata senza firma: il salvataggio la rimette in attesa e il trigger
  // vede annullata -> in attesa, cioè una reiscrizione: link nuovo e mail
  // SEMPRE, qualunque fosse lo stato dell'autorizzazione (anche un link già
  // partito, un invio fallito, "Autorizza ora" o un rifiuto del genitore).
  ["annullata senza parentAuthorization (null)", iscrizione("cancelled", null), "nuovo_link"],
  [
    "annullata senza parentAuthorization (campo assente)",
    iscrizione("cancelled", undefined),
    "nuovo_link",
  ],
  [
    "annullata con email_sent, brevoMessageId e tokenId (link già partito: ne parte uno nuovo)",
    iscrizione("cancelled", firma("email_sent", { tokenId: TOKEN_ID, brevoMessageId: MAIL_ID })),
    "nuovo_link",
  ],
  [
    "annullata con email_sent e tokenId ma senza brevoMessageId",
    iscrizione("cancelled", firma("email_sent", { tokenId: TOKEN_ID })),
    "nuovo_link",
  ],
  [
    "annullata con email_sent e brevoMessageId ma tokenId null",
    iscrizione("cancelled", firma("email_sent", { brevoMessageId: MAIL_ID })),
    "nuovo_link",
  ],
  [
    "annullata con email_error (il tetto dei riprovi non c'entra: è un gesto della persona)",
    iscrizione("cancelled", firma("email_error", { tokenId: TOKEN_ID, emailRetryCount: 1 })),
    "nuovo_link",
  ],
  [
    "annullata con email_error esattamente al tetto dei tentativi",
    iscrizione(
      "cancelled",
      firma("email_error", { tokenId: TOKEN_ID, emailRetryCount: MAX_EMAIL_RETRIES }),
    ),
    "nuovo_link",
  ],
  [
    "annullata con email_error oltre il tetto dei tentativi",
    iscrizione(
      "cancelled",
      firma("email_error", { tokenId: TOKEN_ID, emailRetryCount: MAX_EMAIL_RETRIES + 2 }),
    ),
    "nuovo_link",
  ],
  [
    "annullata con email_error oltre il tetto e senza tokenId",
    iscrizione(
      "cancelled",
      firma("email_error", { tokenId: null, emailRetryCount: MAX_EMAIL_RETRIES + 2 }),
    ),
    "nuovo_link",
  ],
  [
    "annullata con selfTokenIssuedAt (link di \"Autorizza ora\": se ne emette uno nuovo)",
    iscrizione(
      "cancelled",
      firma("pending_parent_authorization", { tokenId: TOKEN_ID, selfTokenIssuedAt: SELF_IL }),
    ),
    "nuovo_link",
  ],
  [
    "annullata con autorizzazione ancora senza link",
    iscrizione("cancelled", firma("pending_request")),
    "nuovo_link",
  ],
  [
    "annullata con pending_request e tokenId",
    iscrizione("cancelled", firma("pending_request", { tokenId: TOKEN_ID })),
    "nuovo_link",
  ],
  [
    // `invalidated` è uno stato dei token, non di parentAuthorization (il tipo
    // non lo prevede): è il caso di un link invalidato che il trigger non
    // riconosce come decisione, quindi manda comunque la richiesta.
    "annullata con status invalidated e tokenId null",
    iscrizione("cancelled", firma("invalidated", { tokenId: null })),
    "nuovo_link",
  ],
  [
    "annullata con status invalidated e tokenId vecchio",
    iscrizione("cancelled", firma("invalidated", { tokenId: TOKEN_ID })),
    "nuovo_link",
  ],
  [
    "annullata con link scaduto (expired)",
    iscrizione("cancelled", firma("expired", { tokenId: TOKEN_ID })),
    "nuovo_link",
  ],
  [
    "annullata dopo il rifiuto del genitore (il genitore riceve una richiesta nuova)",
    iscrizione("cancelled", firma("rejected_by_parent", { tokenId: TOKEN_ID })),
    "nuovo_link",
  ],
  [
    "annullata dopo il rifiuto, senza tokenId",
    iscrizione("cancelled", firma("rejected_by_parent")),
    "nuovo_link",
  ],
  [
    "annullata dopo il rifiuto, con brevoMessageId dell'invio precedente",
    iscrizione(
      "cancelled",
      firma("rejected_by_parent", { tokenId: TOKEN_ID, brevoMessageId: MAIL_ID }),
    ),
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

  // Rifiuto su un'iscrizione NON annullata: nessuna mail, nemmeno con un
  // indirizzo nuovo (il trigger salta una decisione già presa).
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
  // (L'annullata dopo un rifiuto non sta qui: reiscriversi riapre la richiesta,
  // vedi sopra.)

  // Attiva senza firma né rifiuto: il salvataggio la mette in attesa e il
  // trigger vede un ingresso in attesa da un altro stato, cioè una richiesta
  // nuova: link nuovo e mail, qualunque fosse lo stato dell'autorizzazione.
  ["active senza autorizzazione (null)", iscrizione("active", null), "nuovo_link"],
  ["active senza autorizzazione (campo assente)", iscrizione("active", undefined), "nuovo_link"],
  [
    "active con un link emesso ma non firmato (ne parte uno nuovo)",
    iscrizione("active", firma("email_sent", { tokenId: TOKEN_ID, brevoMessageId: MAIL_ID })),
    "nuovo_link",
  ],
  [
    "active con email_error (il tetto dei riprovi non c'entra)",
    iscrizione("active", firma("email_error", { tokenId: TOKEN_ID, emailRetryCount: 1 })),
    "nuovo_link",
  ],
  [
    "active con email_error oltre il tetto dei tentativi",
    iscrizione(
      "active",
      firma("email_error", { tokenId: TOKEN_ID, emailRetryCount: MAX_EMAIL_RETRIES + 2 }),
    ),
    "nuovo_link",
  ],
  [
    "active con selfTokenIssuedAt (non è \"autorizza ora\": è un ingresso in attesa, link nuovo)",
    iscrizione(
      "active",
      firma("pending_parent_authorization", { tokenId: TOKEN_ID, selfTokenIssuedAt: SELF_IL }),
    ),
    "nuovo_link",
  ],
  [
    "active con pending_request e tokenId",
    iscrizione("active", firma("pending_request", { tokenId: TOKEN_ID })),
    "nuovo_link",
  ],
  [
    "active con link scaduto (expired)",
    iscrizione("active", firma("expired", { tokenId: TOKEN_ID })),
    "nuovo_link",
  ],

  // Gli altri stati si conservano senza firma né mail.
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

test("annullata con email_error, sotto o oltre il tetto: la reiscrizione riparte da zero", () => {
  // Il trigger guarda la reiscrizione prima di retryCapReached e l'invio
  // azzera emailRetryCount: non esiste un "mail_fallita" per un'annullata.
  for (const emailRetryCount of [0, 1, MAX_EMAIL_RETRIES - 1, MAX_EMAIL_RETRIES, MAX_EMAIL_RETRIES + 5]) {
    for (const tokenId of [null, TOKEN_ID]) {
      const esistente = iscrizione("cancelled", firma("email_error", { tokenId, emailRetryCount }));
      assert.equal(
        getParentStepNotice(esistente),
        "nuovo_link",
        `emailRetryCount ${emailRetryCount}, tokenId ${tokenId}`,
      );
    }
  }
  // Senza conteggio.
  assert.equal(
    getParentStepNotice(iscrizione("cancelled", { status: "email_error", tokenId: TOKEN_ID })),
    "nuovo_link",
  );
});

// --- Reiscrizione di un'annullata --------------------------------------------

// Tutti gli stati che l'autorizzazione di un'annullata può avere, compresi
// quelli che nessuno scrive più o che sono stati dei token (`invalidated`):
// il trigger li tratta da "non decisi" e li sostituisce.
const AUTORIZZAZIONI_NON_FIRMATE = [
  null,
  undefined,
  firma("not_required"),
  firma("pending_request"),
  firma("pending_request", { tokenId: TOKEN_ID }),
  firma("pending_parent_authorization"),
  firma("pending_parent_authorization", { tokenId: TOKEN_ID }),
  firma("pending_parent_authorization", { tokenId: TOKEN_ID, selfTokenIssuedAt: SELF_IL }),
  firma("email_sent"),
  firma("email_sent", { tokenId: TOKEN_ID }),
  firma("email_sent", { tokenId: TOKEN_ID, brevoMessageId: MAIL_ID }),
  firma("email_error", { tokenId: TOKEN_ID, emailRetryCount: MAX_EMAIL_RETRIES }),
  firma("expired", { tokenId: TOKEN_ID }),
  firma("revoked", { tokenId: TOKEN_ID }),
  firma("invalidated"),
  firma("invalidated", { tokenId: TOKEN_ID }),
  firma("rejected_by_parent"),
  firma("rejected_by_parent", { tokenId: TOKEN_ID, brevoMessageId: MAIL_ID }),
];

test("annullata non firmata: reiscriversi manda sempre un link nuovo e il suggerimento sotto l'email lo promette", () => {
  for (const autorizzazione of AUTORIZZAZIONI_NON_FIRMATE) {
    const esistente = congela(structuredClone(iscrizione("cancelled", autorizzazione)));
    const avviso = getParentStepNotice(esistente);
    const dove = JSON.stringify(autorizzazione) ?? "undefined";
    assert.equal(avviso, "nuovo_link", dove);
    assert.equal(parentStepNoticeSendsLink(avviso), true, dove);
  }
});

test("annullata firmata: resta autorizzata, torna attiva e nessuna mail parte", () => {
  const firmate = [
    firma("authorized"),
    firma("authorized", { tokenId: TOKEN_ID }),
    firma("authorized", { tokenId: TOKEN_ID, brevoMessageId: MAIL_ID }),
    firma("authorized", { tokenId: TOKEN_ID, selfTokenIssuedAt: SELF_IL }),
    firma("authorized", { tokenId: TOKEN_ID, emailRetryCount: MAX_EMAIL_RETRIES }),
  ];
  for (const autorizzazione of firmate) {
    const avviso = getParentStepNotice(iscrizione("cancelled", autorizzazione));
    assert.equal(avviso, "autorizzata", JSON.stringify(autorizzazione));
    assert.equal(parentStepNoticeSendsLink(avviso), false, JSON.stringify(autorizzazione));
  }
});

test("attiva senza firma né rifiuto: entra in attesa, link nuovo qualunque fosse l'autorizzazione", () => {
  for (const autorizzazione of AUTORIZZAZIONI_NON_FIRMATE) {
    if (autorizzazione?.status === "rejected_by_parent") continue;
    const esistente = congela(structuredClone(iscrizione("active", autorizzazione)));
    const avviso = getParentStepNotice(esistente);
    const dove = JSON.stringify(autorizzazione) ?? "undefined";
    assert.equal(avviso, "nuovo_link", dove);
    assert.equal(parentStepNoticeSendsLink(avviso), true, dove);
  }
});

test("attiva con la decisione del genitore: resta attiva, firma e rifiuto si dicono e nessuna mail parte", () => {
  const firmate = [
    firma("authorized"),
    firma("authorized", { tokenId: TOKEN_ID, brevoMessageId: MAIL_ID }),
    firma("authorized", { tokenId: TOKEN_ID, selfTokenIssuedAt: SELF_IL }),
  ];
  for (const autorizzazione of firmate) {
    const avviso = getParentStepNotice(iscrizione("active", autorizzazione));
    assert.equal(avviso, "autorizzata", JSON.stringify(autorizzazione));
    assert.equal(parentStepNoticeSendsLink(avviso), false, JSON.stringify(autorizzazione));
  }
  const rifiuti = [
    firma("rejected_by_parent"),
    firma("rejected_by_parent", { tokenId: TOKEN_ID, brevoMessageId: MAIL_ID }),
  ];
  for (const autorizzazione of rifiuti) {
    const avviso = getParentStepNotice(iscrizione("active", autorizzazione));
    assert.equal(avviso, "rifiutata", JSON.stringify(autorizzazione));
    assert.equal(parentStepNoticeSendsLink(avviso), false, JSON.stringify(autorizzazione));
  }
});

test("solo l'attiva e l'annullata entrano in attesa: gli altri stati si conservano senza link nuovo", () => {
  for (const stato of ["draft", "submitted", "waitlist"]) {
    for (const autorizzazione of AUTORIZZAZIONI_NON_FIRMATE) {
      if (autorizzazione?.status === "rejected_by_parent") continue;
      const avviso = getParentStepNotice(iscrizione(stato, autorizzazione));
      assert.equal(avviso, "nessuno", `${stato} + ${JSON.stringify(autorizzazione) ?? "undefined"}`);
    }
  }
  // Confermata e rifiutata (come stato dell'iscrizione) non tornano in attesa
  // nemmeno senza firma.
  for (const autorizzazione of AUTORIZZAZIONI_NON_FIRMATE) {
    assert.notEqual(getParentStepNotice(iscrizione("confirmed", autorizzazione)), "nuovo_link");
    assert.equal(getParentStepNotice(iscrizione("rejected_by_parent", autorizzazione)), "rifiutata");
  }
});

test("il rifiuto vale solo finché l'iscrizione non è annullata: dopo l'annullamento la richiesta si riapre", () => {
  const rifiuto = firma("rejected_by_parent", { tokenId: TOKEN_ID });
  for (const stato of ["active", IN_ATTESA, "waitlist", "submitted"]) {
    assert.equal(getParentStepNotice(iscrizione(stato, rifiuto)), "rifiutata", stato);
  }
  assert.equal(getParentStepNotice(iscrizione("cancelled", rifiuto)), "nuovo_link");
  // Un'iscrizione che ha come stato "rifiutata" (non annullata) resta rifiutata.
  assert.equal(getParentStepNotice(iscrizione("rejected_by_parent", rifiuto)), "rifiutata");
  assert.equal(getParentStepNotice(iscrizione("rejected_by_parent", null)), "rifiutata");
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

// Stati che le functions scrivono davvero sull'autorizzazione.
const STATI_AUTORIZZAZIONE = [
  "pending_request",
  "pending_parent_authorization",
  "email_sent",
  "email_error",
  "authorized",
  "rejected_by_parent",
];

// Stati che nessuno scrive più o che sono stati dei token ("invalidated" non
// è nemmeno nel tipo ParentAuthorizationStatus): il trigger non li riconosce
// come decisioni, quindi per lui sono "non decisi".
const STATI_AUTORIZZAZIONE_RESIDUI = ["not_required", "expired", "revoked", "invalidated"];

function tutteLeAutorizzazioni() {
  const stati = [null];
  for (const status of STATI_AUTORIZZAZIONE_RESIDUI) {
    for (const tokenId of [null, TOKEN_ID]) {
      for (const brevoMessageId of [null, MAIL_ID]) {
        stati.push(firma(status, { tokenId, brevoMessageId }));
      }
    }
  }
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
//  - l'annullata, che torna attiva se la firma c'era e in attesa altrimenti;
//  - l'attiva senza firma né rifiuto, che passa in attesa (il modulo ora
//    raccoglie il genitore: meno di 18 anni in un'attività che lo chiede).
// Una decisione del genitore (firma o rifiuto) lascia l'attiva com'è.
function statoDopoIlSalvataggio(esistente) {
  if (!esistente) return IN_ATTESA;
  const deciso = DECIDED_PARENT_AUTH_STATUSES.includes(esistente.parentAuthorization?.status);
  if (esistente.registrationStatus === "cancelled") {
    return esistente.parentAuthorization?.status === "authorized" ? "active" : IN_ATTESA;
  }
  if (esistente.registrationStatus === "active" && !deciso) return IN_ATTESA;
  return esistente.registrationStatus;
}

// Ingresso in attesa da un altro stato: il trigger vede before non in attesa
// (annullata, ma anche attiva) e after in attesa
// (onRegistrationPendingParentAuth, entersPendingAsNewRequest: da annullata,
// o da uno stato che non è attesa né rifiuto; il modulo non porta mai un
// rifiuto in attesa, quindi qui il rifiuto non entra).
function eUnIngressoInAttesa(esistente) {
  return (
    Boolean(esistente) &&
    esistente.registrationStatus !== IN_ATTESA &&
    statoDopoIlSalvataggio(esistente) === IN_ATTESA
  );
}

// Ingresso in attesa: restartParentAuthorizationAfterCancellation chiama
// sendInitialAuthorizationEmail con `restart`, e la transazione si ferma solo
// davanti a una decisione già presa. L'eccezione è il rifiuto che l'evento ha
// visto (`reopenRejection`), che si sostituisce (solo da annullata: da attiva
// il rifiuto lascia l'iscrizione com'è). Niente tetto dei riprovi, niente
// "link già emesso", niente selfTokenIssuedAt: la richiesta riparte da zero.
// Si assume che il modulo abbia scritto i dati del genitore (parentEmail
// compresa), altrimenti l'invio salta con missing_request_payload.
function laReiscrizioneScrive(stato) {
  const riapreIlRifiuto = stato?.status === "rejected_by_parent";
  return !DECIDED_PARENT_AUTH_STATUSES.includes(stato?.status) || riapreIlRifiuto;
}

// Il trigger scrive al genitore, con lo stesso indirizzo di prima?
// onRegistrationPendingParentAuth: solo iscrizioni in attesa; l'ingresso in
// attesa passa prima di tutto il resto; mai su una decisione già presa; si ferma al
// tetto dei tentativi; con un link già emesso non rimanda, tranne dopo un
// invio fallito.
function ilTriggerScrive(esistente) {
  if (statoDopoIlSalvataggio(esistente) !== IN_ATTESA) return false;
  const stato = esistente?.parentAuthorization;
  if (eUnIngressoInAttesa(esistente)) return laReiscrizioneScrive(stato);
  if (!stato) return true;
  if (DECIDED_PARENT_AUTH_STATUSES.includes(stato.status)) return false;
  if (stato.status === "email_error") return stato.emailRetryCount < MAX_EMAIL_RETRIES;
  return !stato.tokenId;
}

// Può partire un link, magari solo con un indirizzo diverso? Il trigger
// rimette in gioco solo le autorizzazioni non ancora decise, più il rifiuto
// di una reiscrizione.
function unLinkPuoPartire(esistente) {
  if (statoDopoIlSalvataggio(esistente) !== IN_ATTESA) return false;
  const stato = esistente?.parentAuthorization;
  if (eUnIngressoInAttesa(esistente)) return laReiscrizioneScrive(stato);
  return !stato || !DECIDED_PARENT_AUTH_STATUSES.includes(stato.status);
}

test("il trigger gestisce ogni ingresso in attesa prima del tetto dei riprovi e del link già emesso", () => {
  // Il modello sopra riproduce questo ordine: se il codice delle functions
  // cambia forma, il test si ferma qui invece di confrontare con un modello
  // vecchio.
  const inizio = FUNCTIONS_TESTO.indexOf("const onRegistrationPendingParentAuth");
  assert.ok(inizio > 0, "onRegistrationPendingParentAuth non trovato");
  const trigger = FUNCTIONS_TESTO.slice(inizio);

  const condizione = trigger.match(
    /if \(\s*entersPendingAsNewRequest\(before\)\s*\)\s*\{\s*await restartParentAuthorizationAfterCancellation\(/,
  );
  // La condizione: da annullata, o da uno stato che non è attesa né rifiuto.
  const helper = FUNCTIONS_TESTO.match(
    /function entersPendingAsNewRequest\(before\) \{[\s\S]*?isCancelledRegistration\(before\)[\s\S]*?!isAwaitingParentAuthorization\(before\)\s*&&\s*before\.registrationStatus !== "rejected_by_parent"/,
  );
  assert.ok(helper, "entersPendingAsNewRequest non ha più la forma del modello sotto");
  assert.ok(
    condizione,
    "il trigger non riparte più per ogni ingresso in attesa (annullata o non in attesa): il modello sotto è da rifare",
  );
  const ingresso = condizione.index;
  const ripartenza = trigger.indexOf("restartParentAuthorizationAfterCancellation(");
  const tetto = trigger.indexOf("retryCapReached(after)");
  const linkEmesso = trigger.indexOf("after.parentAuthorization.tokenId");

  assert.ok(ingresso > 0, "il trigger non guarda più lo stato precedente");
  assert.ok(ripartenza > ingresso, "la ripartenza non segue il controllo dello stato precedente");
  assert.ok(tetto > ingresso, "il tetto dei riprovi viene prima dell'ingresso in attesa");
  assert.ok(linkEmesso > ingresso, "il link già emesso viene prima dell'ingresso in attesa");

  // La reiscrizione riapre solo il rifiuto: la firma non si tocca mai.
  assert.ok(DECIDED_PARENT_AUTH_STATUSES.includes("authorized"));
  assert.ok(DECIDED_PARENT_AUTH_STATUSES.includes("rejected_by_parent"));
  assert.match(
    FUNCTIONS_TESTO,
    /reopenRejection:\s*registration\.parentAuthorization\?\.status\s*===\s*"rejected_by_parent"/,
  );
});

test("su tutte le combinazioni l'avviso non contraddice salvataggio e trigger", () => {
  const autorizzazioni = tutteLeAutorizzazioni();
  let verificate = 0;
  const viste = {
    reiscrizioni: 0,
    dopoRifiuto: 0,
    oltreTetto: 0,
    conSelfToken: 0,
    firmateAnnullate: 0,
    attiveInAttesa: 0,
    attiveDecise: 0,
  };

  for (const registrationStatus of STATI_ISCRIZIONE) {
    for (const parentAuthorization of autorizzazioni) {
      const esistente = congela(structuredClone(iscrizione(registrationStatus, parentAuthorization)));
      const avviso = getParentStepNotice(esistente);
      const dove = `${registrationStatus} + ${JSON.stringify(parentAuthorization)} => ${avviso}`;
      const stato = parentAuthorization;
      const reiscrizione = eUnIngressoInAttesa(esistente);
      // Un rifiuto conta finché l'iscrizione non è annullata: dopo, reiscriversi
      // lo riapre.
      const rifiuto =
        !reiscrizione &&
        (registrationStatus === "rejected_by_parent" || stato?.status === "rejected_by_parent");
      const firmata =
        !rifiuto && (registrationStatus === "confirmed" || stato?.status === "authorized");

      // Ingresso in attesa (annullata o attiva): link nuovo e mail, qualunque
      // cosa ci fosse prima (tranne la firma, che lascia l'iscrizione attiva
      // senza mail).
      if (reiscrizione) {
        assert.equal(ilTriggerScrive(esistente), true, `ingresso in attesa senza mail: ${dove}`);
        assert.equal(avviso, "nuovo_link", `ingresso in attesa senza nuovo_link: ${dove}`);
        viste.reiscrizioni += 1;
        if (registrationStatus === "active") viste.attiveInAttesa += 1;
        if (stato?.status === "rejected_by_parent") viste.dopoRifiuto += 1;
        if (stato?.status === "email_error" && stato.emailRetryCount >= MAX_EMAIL_RETRIES) {
          viste.oltreTetto += 1;
        }
        if (stato?.selfTokenIssuedAt) viste.conSelfToken += 1;
      }
      // Attiva con una decisione del genitore: resta attiva, nessuna mail.
      if (registrationStatus === "active" && DECIDED_PARENT_AUTH_STATUSES.includes(stato?.status)) {
        assert.equal(statoDopoIlSalvataggio(esistente), "active", `attiva decisa che cambia stato: ${dove}`);
        assert.equal(ilTriggerScrive(esistente), false, `attiva decisa con mail: ${dove}`);
        assert.equal(avviso, stato.status === "authorized" ? "autorizzata" : "rifiutata", dove);
        viste.attiveDecise += 1;
      }
      if (registrationStatus === "cancelled" && stato?.status === "authorized") {
        assert.equal(ilTriggerScrive(esistente), false, `annullata firmata con mail: ${dove}`);
        assert.equal(avviso, "autorizzata", `annullata firmata: ${dove}`);
        viste.firmateAnnullate += 1;
      }

      // Se il trigger scrive, l'avviso non può dire che nessuno scriverà.
      if (ilTriggerScrive(esistente)) {
        assert.ok(["nuovo_link", "mail_fallita"].includes(avviso), `trigger scrive: ${dove}`);
      }

      // "Nuovo link" vale solo dove il trigger scrive davvero.
      if (avviso === "nuovo_link") {
        assert.equal(ilTriggerScrive(esistente), true, `nuovo_link senza mail: ${dove}`);
      }

      // Un invio fallito: o il trigger riprova, o siamo al tetto dei tentativi.
      // Mai per un'annullata o un'attiva: l'ingresso in attesa riparte da zero.
      if (avviso === "mail_fallita") {
        assert.equal(stato?.status, "email_error", `mail_fallita senza errore: ${dove}`);
        assert.equal(statoDopoIlSalvataggio(esistente), IN_ATTESA, `mail_fallita fuori attesa: ${dove}`);
        assert.equal(reiscrizione, false, `mail_fallita su un ingresso in attesa: ${dove}`);
        if (!ilTriggerScrive(esistente)) {
          assert.ok(stato.emailRetryCount >= MAX_EMAIL_RETRIES, `mail_fallita senza tetto: ${dove}`);
        }
      }

      // Link già emesso (scritto, in invio, autorizza ora): nessuna mail nuova.
      if (["scritto", "in_invio", "autorizza_ora"].includes(avviso)) {
        assert.equal(ilTriggerScrive(esistente), false, `mail nuova sotto "${avviso}": ${dove}`);
        assert.ok(stato?.tokenId, `${avviso} senza link emesso: ${dove}`);
        assert.equal(statoDopoIlSalvataggio(esistente), IN_ATTESA, `${avviso} fuori attesa: ${dove}`);
        assert.equal(reiscrizione, false, `${avviso} su un ingresso in attesa: ${dove}`);
      }

      // "scritto" solo con la conferma del provider.
      if (avviso === "scritto") {
        assert.equal(stato.status, "email_sent", dove);
        assert.ok(stato.brevoMessageId, `scritto senza brevoMessageId: ${dove}`);
      }

      // "Autorizza ora" solo se è stato usato, e se è stato usato lo dice (una
      // reiscrizione lo sostituisce con un link nuovo).
      if (avviso === "autorizza_ora") {
        assert.ok(stato?.selfTokenIssuedAt, `autorizza_ora senza selfTokenIssuedAt: ${dove}`);
      }
      if (
        stato?.selfTokenIssuedAt &&
        statoDopoIlSalvataggio(esistente) === IN_ATTESA &&
        !reiscrizione &&
        !rifiuto &&
        !firmata
      ) {
        assert.equal(avviso, "autorizza_ora", `autorizza_ora ignorato: ${dove}`);
      }

      // Firma presente (e nessun rifiuto): l'avviso lo dice.
      if (firmata) {
        assert.equal(avviso, "autorizzata", `firma ignorata: ${dove}`);
      }
      if (avviso === "autorizzata") {
        assert.equal(firmata, true, `firma inventata: ${dove}`);
      }

      // Rifiuto: solo su un'iscrizione che non si sta reiscrivendo.
      assert.equal(avviso === "rifiutata", rifiuto, dove);

      // Il suggerimento promette un link solo dove ne può partire uno.
      assert.equal(parentStepNoticeSendsLink(avviso), unLinkPuoPartire(esistente) && !rifiuto && !firmata, dove);

      verificate += 1;
    }
  }

  assert.equal(verificate, STATI_ISCRIZIONE.length * autorizzazioni.length);
  assert.ok(verificate > 200, `combinazioni verificate: ${verificate}`);
  // Il generatore non deve perdere per strada i casi che contano.
  for (const [nome, quante] of Object.entries(viste)) {
    assert.ok(quante > 0, `nessuna combinazione "${nome}" verificata`);
  }
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
