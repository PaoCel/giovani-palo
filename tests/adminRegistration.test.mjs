import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ISCRITTI } from "../src/copy/iscritti.ts";
import { fillCopy } from "../src/copy/parole.ts";
import {
  MANUAL_REGISTRATION_PREFIX,
  buildAdminEditPatch,
  buildManualRegistrationDoc,
  buildRequestAuthorizationPatch,
  findPossibleDuplicates,
  getManualAddOutcome,
  getRequestParentEmail,
  isManualRegistration,
  isMissingParentEmail,
  isValidBirthDate,
  isValidEmail,
  needsParentAuthorization,
  newManualRegistrationId,
  parentRequestPatch,
  personDraftFromRegistration,
  planAdminEdit,
  planAdminReactivate,
  validateAdminEdit,
  validateManualAdd,
} from "../src/utils/adminRegistration.ts";

// Iscrizione a mano e correzione dei dati dall'admin
// (`src/utils/adminRegistration.ts`, spec in `docs/ADMIN_ISCRITTI.md`).
//
// Gli attesi vengono da tre fonti, mai dall'implementazione:
//  1. la spec: la tabella B (esito dell'aggiunta), la tabella "Cosa succede se
//     cambiano data di nascita, unità o nome" e "Stati e ritorni" (Riattiva);
//  2. `firestore.rules`, letto da questo file: l'elenco dei campi di
//     `validRegistrationPayload`, quello che l'admin può scrivere in
//     `validAdminRegistrationUpdate`, il formato dell'id in
//     `validAdminManualCreate`, il limite di età. Se le rules cambiano forma il
//     test si ferma qui invece di confrontare con un elenco vecchio;
//  3. il glossario: minorenne = meno di 18 anni oggi.
//
// Le date di nascita sono sempre relative a oggi: una data fissa a un certo
// punto cambia età e il test comincia a mentire.
//
// Un test marcato `todo` dimostra un difetto del modulo: resta rosso finché
// `src/` non si corregge, ma non ferma la suite.
//
// Comando: node --test tests/adminRegistration.test.mjs

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ATTESA = "pending_parent_authorization";

// ---------------------------------------------------------------------------
// Date relative a oggi
// ---------------------------------------------------------------------------

const due = (n) => String(n).padStart(2, "0");
const isoLocale = (data) => `${data.getFullYear()}-${due(data.getMonth() + 1)}-${due(data.getDate())}`;

// Data di nascita di chi compie `anni` anni oggi, spostata di `giorni`
// (-1 = li ha compiuti ieri, +1 = li compie domani). Il 29 febbraio degli
// anni non bisestili diventa il 28.
function nascita(anni, giorni = 0) {
  const oggi = new Date();
  const ultimoGiorno = new Date(oggi.getFullYear() - anni, oggi.getMonth() + 1, 0).getDate();
  const data = new Date(
    oggi.getFullYear() - anni,
    oggi.getMonth(),
    Math.min(oggi.getDate(), ultimoGiorno),
  );
  data.setDate(data.getDate() + giorni);
  return isoLocale(data);
}

// Fra due giorni è futuro in qualunque fuso orario.
const traDueGiorni = () => {
  const data = new Date();
  data.setDate(data.getDate() + 2);
  return isoLocale(data);
};

// Oggi secondo UTC: `isValidBirthDate` confronta la mezzanotte UTC con l'ora
// attuale, quindi questa data è valida a ogni ora e in ogni fuso.
const oggiUtc = () => new Date().toISOString().slice(0, 10);

// L'età si conta con `new Date("AAAA-MM-GG")` (mezzanotte UTC) e il giorno
// locale: nei fusi a ovest di UTC chi compie 18 anni domani risulta già
// maggiorenne. Il progetto gira in Italia (UTC+1/+2), lì il confine è esatto.
const FUSO_NON_A_OVEST = new Date().getTimezoneOffset() <= 0;
const SOLO_FUSO_NON_A_OVEST = FUSO_NON_A_OVEST
  ? false
  : "il fuso locale è a ovest di UTC: il confine dei 18 anni slitta di un giorno (src/utils/age.ts)";

const ADULTO = nascita(30);
const MINORE = nascita(15);

// ---------------------------------------------------------------------------
// Le rules lette dal file
// ---------------------------------------------------------------------------

const RULES = readFileSync(path.join(ROOT, "firestore.rules"), "utf8").replace(
  /(^|\s)\/\/[^\n]*/gu,
  "$1",
);

function corpoFunzione(nome) {
  const inizio = RULES.indexOf(`function ${nome}(`);
  assert.notEqual(inizio, -1, `firestore.rules: function ${nome} non trovata`);
  const apertura = RULES.indexOf("{", RULES.indexOf(")", inizio));
  let profondita = 0;
  for (let i = apertura; i < RULES.length; i += 1) {
    if (RULES[i] === "{") profondita += 1;
    if (RULES[i] === "}") {
      profondita -= 1;
      if (profondita === 0) return RULES.slice(apertura + 1, i);
    }
  }
  throw new Error(`firestore.rules: function ${nome} non si chiude`);
}

const chiaviDi = (testo) => [...testo.matchAll(/'([A-Za-z0-9_]+)'/gu)].map((match) => match[1]);

function elencoDa(corpo, espressione, descrizione) {
  const trovato = corpo.match(espressione);
  assert.ok(trovato, `firestore.rules: ${descrizione} non trovato`);
  return chiaviDi(trovato[1]);
}

const PAYLOAD = corpoFunzione("validRegistrationPayload");
const CHIAVI_PAYLOAD = elencoDa(
  PAYLOAD,
  /data\.keys\(\)\.hasOnly\(\[([^\]]*)\]\)/u,
  "l'elenco di validRegistrationPayload",
);

const AGGIORNAMENTO_ADMIN = corpoFunzione("validAdminRegistrationUpdate");
const ADMIN = {
  chiavi: elencoDa(AGGIORNAMENTO_ADMIN, /changed\.hasOnly\(\[([^\]]*)\]\)/u, "la lista admin"),
  risposte: elencoDa(
    AGGIORNAMENTO_ADMIN,
    /next\.answers\.diff\(prev\.answers\)\.affectedKeys\(\)\.hasOnly\(\[([^\]]*)\]\)/u,
    "le chiavi ammesse di answers",
  ),
  autorizzazione: elencoDa(
    AGGIORNAMENTO_ADMIN,
    /next\.parentAuthorization\.diff\(prev\.parentAuthorization\)\.affectedKeys\(\)\s*\.hasOnly\(\[([^\]]*)\]\)/u,
    "le chiavi ammesse di parentAuthorization",
  ),
  statiSempreAmmessi: elencoDa(
    AGGIORNAMENTO_ADMIN,
    /next\.registrationStatus in \[([^\]]*)\]/u,
    "gli stati sempre ammessi",
  ),
};

const CREAZIONE_MANUALE = corpoFunzione("validAdminManualCreate");
const FORMATO_ID_MANUALE = new RegExp(
  `^${CREAZIONE_MANUALE.match(/registrationId\.matches\('([^']+)'\)/u)?.[1] ?? "(?!)"}$`,
  "u",
);
// I campi che alla creazione devono restare vuoti, con il valore atteso.
const VUOTI_ALLA_CREAZIONE = [
  ...(CREAZIONE_MANUALE.match(/next\.diff\(\{([^}]*)\}\)/u)?.[1] ?? "").matchAll(
    /'(\w+)':\s*(null|\[\]|false|true)/gu,
  ),
].map((match) => [match[1], JSON.parse(match[2])]);

const GIORNI_LIMITE = Number(
  corpoFunzione("isMinorForParentAuthorization").match(/duration\.value\((\d+), 'd'\)/u)?.[1],
);

// Il limite d'età delle rules (stringa AAAA-MM-GG + 6573 giorni > adesso),
// riscritto qui per confrontare lo stato che il modulo propone.
function minorePerLeRules(dataNascita) {
  const parti = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(dataNascita);
  if (!parti) return false;
  const limite = Date.UTC(+parti[1], +parti[2] - 1, +parti[3]) + GIORNI_LIMITE * 86_400_000;
  return limite > Date.now();
}

// La clausola sullo stato di validAdminRegistrationUpdate.
function regoleAmmettonoStato({ prima, firmaPrima, dopo, nascitaDopo, richiedeAutorizzazione }) {
  if (dopo === prima) return true;
  if (ADMIN.statiSempreAmmessi.includes(dopo)) return true;
  if (dopo === "active") {
    return firmaPrima === "authorized" || !(richiedeAutorizzazione && minorePerLeRules(nascitaDopo));
  }
  return false;
}

function verificaChiaviPatch(patch, contesto) {
  assert.ok(Object.keys(patch).length > 0, `${contesto}: patch vuota`);
  for (const [chiave, valore] of Object.entries(patch)) {
    const [testa, seconda] = chiave.split(".");
    assert.ok(ADMIN.chiavi.includes(testa), `${contesto}: «${chiave}» non è nella lista admin delle rules`);
    if (testa === "answers") {
      assert.ok(seconda, `${contesto}: «answers» intero riscritto invece dei percorsi puntati`);
      assert.ok(ADMIN.risposte.includes(seconda), `${contesto}: «${chiave}» fuori da answers ammessi`);
    }
    if (testa === "parentAuthorization" && seconda) {
      assert.ok(ADMIN.autorizzazione.includes(seconda), `${contesto}: «${chiave}» fuori da parentAuthorization ammessi`);
    }
    assert.notEqual(valore, undefined, `${contesto}: «${chiave}» è undefined (updateDoc lo rifiuta)`);
  }
}

// ---------------------------------------------------------------------------
// Dati di prova
// ---------------------------------------------------------------------------

const TIMESTAMP = "2026-10-20T10:00:00.000Z";
const ADMIN_UID = "adminUid1";

const PERSONA = {
  firstName: "Marco",
  lastName: "Rossi",
  birthDate: ADULTO,
  genderRoleCategory: "giovane_uomo",
  unitId: "u1",
  unitName: "Rione Nord",
  email: "",
  phone: "",
};
const persona = (extra = {}) => ({ ...PERSONA, ...extra });

const GENITORE_VUOTO = { firstName: "", lastName: "", email: "", phone: "" };
const genitore = (email = "genitore@example.com", extra = {}) => ({
  firstName: "Anna",
  lastName: "Rossi",
  email,
  phone: "333 1234567",
  ...extra,
});

const richiesta = (parentEmail) => ({
  parentFirstName: "Anna",
  parentLastName: "Rossi",
  parentEmail,
  parentPhone: "333 1234567",
  submittedAt: "2026-10-01T08:00:00.000Z",
});

// Iscrizione già salvata. `registrationStatus` e `parentAuthorization` si
// passano per intero in `extra`.
function iscrizione(extra = {}) {
  const birthDate = extra.birthDate ?? ADULTO;
  return {
    id: "manual_prova01",
    eventId: "e1",
    activityId: "a1",
    stakeId: "s1",
    userId: null,
    anonymousUid: null,
    anonymousTokenId: null,
    firstName: "Marco",
    lastName: "Rossi",
    fullName: "Marco Rossi",
    email: "",
    phone: "",
    birthDate,
    genderRoleCategory: "giovane_uomo",
    unitId: "u1",
    unitNameSnapshot: "Rione Nord",
    answers: {
      birthDate,
      genderRoleCategory: "giovane_uomo",
      youthGroup: "Giovani Uomini",
      unitName: "Rione Nord",
    },
    parentAuthorization: null,
    parentUid: null,
    childId: null,
    registrationStatus: "active",
    assignedRoomName: null,
    ...extra,
  };
}

const conRichiesta = (parentEmail, extra = {}) =>
  iscrizione({
    ...extra,
    answers: {
      birthDate: extra.birthDate ?? ADULTO,
      genderRoleCategory: "giovane_uomo",
      youthGroup: "Giovani Uomini",
      unitName: "Rione Nord",
      parentAuthorizationRequest: richiesta(parentEmail),
    },
  });

// La bozza del foglio "Modifica dati" parte dall'iscrizione e cambia qualcosa.
function bozza(registrazione, extra = {}) {
  return { ...personDraftFromRegistration(registrazione), ...extra };
}

const contesto = (registrazione, extra = {}) => ({
  requiresParentAuthorization: true,
  previousUnitName: registrazione.unitNameSnapshot,
  ...extra,
});

const firma = (status) => ({ status });

// ---------------------------------------------------------------------------
// Le rules lette dal file (se cambiano forma, si ferma tutto qui)
// ---------------------------------------------------------------------------

test("rules: gli elenchi letti da firestore.rules sono quelli che servono ai confronti", () => {
  for (const chiave of ["registrationStatus", "updatedAt", "answers", "parentAuthorization", "fullName", "unitId"]) {
    assert.ok(ADMIN.chiavi.includes(chiave), `lista admin senza «${chiave}»`);
  }
  for (const chiave of ["createdBy", "consentSignatureUrl", "accessCode", "userId"]) {
    assert.ok(!ADMIN.chiavi.includes(chiave), `la lista admin non deve avere «${chiave}»`);
  }
  assert.ok(ADMIN.risposte.includes("parentAuthorizationRequest"));
  assert.ok(!ADMIN.risposte.includes("parentAuthorizationConsents"));
  assert.deepEqual([...ADMIN.statiSempreAmmessi].sort(), ["cancelled", ATTESA].sort());
  assert.ok(Number.isFinite(GIORNI_LIMITE) && GIORNI_LIMITE >= 6570 && GIORNI_LIMITE <= 6575, `limite ${GIORNI_LIMITE}`);
  assert.ok(FORMATO_ID_MANUALE.test("manual_abcdef"));
  assert.ok(FORMATO_ID_MANUALE.test(`manual_${"a".repeat(80)}`));
  for (const id of ["manual_abc", `manual_${"a".repeat(81)}`, "user_abcdef", "manual_abc def", "manual_abc.def", "xmanual_abcdef"]) {
    assert.ok(!FORMATO_ID_MANUALE.test(id), id);
  }
});

// ---------------------------------------------------------------------------
// isValidBirthDate
// ---------------------------------------------------------------------------

test("isValidBirthDate: accetta una data vera nel formato AAAA-MM-GG", () => {
  for (const valida of [ADULTO, MINORE, nascita(1), nascita(18), "1980-06-15", "2008-12-31", oggiUtc()]) {
    assert.equal(isValidBirthDate(valida), true, valida);
  }
});

test("isValidBirthDate: il formato deve essere esatto", () => {
  for (const sbagliata of [
    "",
    " ",
    "2008-1-5",
    "2008-10-5",
    "08-10-2008",
    "05/10/2008",
    "2008/10/05",
    "20081005",
    " 2008-10-05",
    "2008-10-05 ",
    "2008-10-05\n",
    "2008-10-05T00:00:00Z",
    "2008-10-05extra",
    "abcd-ef-gh",
    "٢٠٠٨-١٠-٠٥",
  ]) {
    assert.equal(isValidBirthDate(sbagliata), false, JSON.stringify(sbagliata));
  }
});

test("isValidBirthDate: rifiuta le date impossibili", () => {
  for (const impossibile of [
    "2027-02-30",
    "2024-02-30",
    "2024-04-31",
    "2024-06-31",
    "2024-09-31",
    "2024-11-31",
    "2024-01-32",
    "2024-01-00",
    "2024-00-10",
    "2024-13-01",
    "2024-99-99",
  ]) {
    assert.equal(isValidBirthDate(impossibile), false, impossibile);
  }
});

test("isValidBirthDate: il 29 febbraio esiste solo negli anni bisestili", () => {
  assert.equal(isValidBirthDate("2024-02-29"), true);
  assert.equal(isValidBirthDate("2000-02-29"), true, "il 2000 è bisestile (divisibile per 400)");
  assert.equal(isValidBirthDate("2023-02-29"), false);
  assert.equal(isValidBirthDate("2001-02-29"), false);
  assert.equal(isValidBirthDate("1900-02-29"), false);
  assert.equal(isValidBirthDate("2024-02-28"), true);
});

test("isValidBirthDate: una data nel futuro non è valida", () => {
  assert.equal(isValidBirthDate(traDueGiorni()), false);
  assert.equal(isValidBirthDate("2999-01-01"), false);
  assert.equal(isValidBirthDate("9999-12-31"), false);
  assert.equal(isValidBirthDate(oggiUtc()), true, "oggi (UTC) è l'ultimo giorno ammesso");
});

test("isValidBirthDate: prima del 1920 non è valida, dal 1920 sì", () => {
  assert.equal(isValidBirthDate("1919-12-31"), false);
  assert.equal(isValidBirthDate("1900-01-01"), false);
  assert.equal(isValidBirthDate("0001-01-01"), false);
  assert.equal(isValidBirthDate("1920-01-01"), true);
  assert.equal(isValidBirthDate("1920-02-29"), true, "il 1920 è bisestile");
});

// ---------------------------------------------------------------------------
// isValidEmail
// ---------------------------------------------------------------------------

test("isValidEmail: accetta indirizzi normali e ignora gli spazi ai bordi", () => {
  for (const valida of [
    "a@b.it",
    "marco.rossi@example.com",
    "marco+campo@example.co.uk",
    "  marco@example.com  ",
    "MARCO@EXAMPLE.COM",
  ]) {
    assert.equal(isValidEmail(valida), true, valida);
  }
});

test("isValidEmail: rifiuta indirizzi incompleti o con spazi dentro", () => {
  for (const sbagliata of [
    "",
    "   ",
    "marco",
    "marco@",
    "@example.com",
    "marco@example",
    "marco@example.",
    "marco@.it",
    "mar co@example.com",
    "marco@exa mple.com",
    "marco@@example.com",
    "a@b.it, c@d.it",
    "a@b.it c@d.it",
  ]) {
    assert.equal(isValidEmail(sbagliata), false, JSON.stringify(sbagliata));
  }
});

// ---------------------------------------------------------------------------
// needsParentAuthorization
// ---------------------------------------------------------------------------

test("needsParentAuthorization: serve la firma solo se l'attività la chiede e ha meno di 18 anni", () => {
  assert.equal(needsParentAuthorization(true, MINORE), true);
  assert.equal(needsParentAuthorization(true, nascita(17)), true);
  assert.equal(needsParentAuthorization(true, nascita(5)), true);
  assert.equal(needsParentAuthorization(true, ADULTO), false);
  assert.equal(needsParentAuthorization(true, nascita(19)), false);
  assert.equal(needsParentAuthorization(false, MINORE), false);
  assert.equal(needsParentAuthorization(false, ADULTO), false);
});

test("needsParentAuthorization: chi compie 18 anni oggi è maggiorenne", () => {
  assert.equal(needsParentAuthorization(true, nascita(18)), false);
  assert.equal(needsParentAuthorization(true, nascita(18, -1)), false, "li ha compiuti ieri");
  assert.equal(needsParentAuthorization(true, nascita(18, -30)), false);
});

test(
  "needsParentAuthorization: chi compie 18 anni domani ha ancora meno di 18 anni",
  { skip: SOLO_FUSO_NON_A_OVEST },
  () => {
    assert.equal(needsParentAuthorization(true, nascita(18, 1)), true);
    assert.equal(needsParentAuthorization(true, nascita(18, 30)), true);
  },
);

test("needsParentAuthorization: senza una data leggibile non chiede la firma", () => {
  assert.equal(needsParentAuthorization(true, ""), false);
  assert.equal(needsParentAuthorization(true, "non-una-data"), false);
});

// ---------------------------------------------------------------------------
// getRequestParentEmail, isMissingParentEmail
// ---------------------------------------------------------------------------

test("getRequestParentEmail: legge l'email dalla richiesta, in minuscolo e senza spazi", () => {
  assert.equal(getRequestParentEmail(conRichiesta("genitore@example.com")), "genitore@example.com");
  assert.equal(getRequestParentEmail(conRichiesta("  Anna.Rossi@Example.COM ")), "anna.rossi@example.com");
});

test("getRequestParentEmail: senza richiesta o con dati strani risponde stringa vuota", () => {
  assert.equal(getRequestParentEmail({ answers: {} }), "");
  assert.equal(getRequestParentEmail({ answers: { parentAuthorizationRequest: null } }), "");
  assert.equal(getRequestParentEmail({ answers: { parentAuthorizationRequest: "x@y.it" } }), "");
  assert.equal(getRequestParentEmail({ answers: { parentAuthorizationRequest: {} } }), "");
  assert.equal(getRequestParentEmail({ answers: { parentAuthorizationRequest: { parentEmail: 42 } } }), "");
  assert.equal(getRequestParentEmail({ answers: { parentAuthorizationRequest: { parentEmail: null } } }), "");
  assert.equal(getRequestParentEmail(conRichiesta("   ")), "");
});

test("isMissingParentEmail: in attesa senza email nella richiesta manca l'email", () => {
  assert.equal(isMissingParentEmail(iscrizione({ registrationStatus: ATTESA })), true);
  assert.equal(
    isMissingParentEmail(iscrizione({ registrationStatus: ATTESA, parentAuthorization: firma("email_sent") })),
    true,
  );
  assert.equal(isMissingParentEmail(conRichiesta("   ", { registrationStatus: ATTESA })), true);
});

test("isMissingParentEmail: con l'email nella richiesta non manca", () => {
  assert.equal(isMissingParentEmail(conRichiesta("g@example.com", { registrationStatus: ATTESA })), false);
});

test("isMissingParentEmail: solo chi è in attesa e non ha già una risposta del genitore", () => {
  for (const stato of ["active", "cancelled", "confirmed", "rejected_by_parent"]) {
    assert.equal(isMissingParentEmail(iscrizione({ registrationStatus: stato })), false, stato);
  }
  for (const risposta of ["authorized", "rejected_by_parent"]) {
    assert.equal(
      isMissingParentEmail(iscrizione({ registrationStatus: ATTESA, parentAuthorization: firma(risposta) })),
      false,
      risposta,
    );
  }
});

// ---------------------------------------------------------------------------
// isManualRegistration, newManualRegistrationId
// ---------------------------------------------------------------------------

test("isManualRegistration: riconosce il prefisso manual_ e nessun altro", () => {
  assert.equal(MANUAL_REGISTRATION_PREFIX, "manual_");
  assert.equal(isManualRegistration({ id: "manual_abc123" }), true);
  assert.equal(isManualRegistration({ id: "manual_" }), true);
  for (const id of ["user_abc", "guest_abc", "child_p_c", "Manual_abc", "xmanual_abc", "manual-abc", ""]) {
    assert.equal(isManualRegistration({ id }), false, id);
  }
});

test("newManualRegistrationId: prefisso, lunghezza e caratteri ammessi dalle rules", () => {
  assert.ok(FORMATO_ID_MANUALE.source.includes("manual_"), "formato letto dalle rules");
  for (let i = 0; i < 200; i += 1) {
    const id = newManualRegistrationId();
    assert.ok(id.startsWith("manual_"), id);
    assert.ok(FORMATO_ID_MANUALE.test(id), `${id} non passa il formato delle rules`);
    assert.equal(id.length, "manual_".length + 20, id);
  }
});

test("newManualRegistrationId: gli id sono tutti diversi", () => {
  const visti = new Set();
  for (let i = 0; i < 2000; i += 1) visti.add(newManualRegistrationId());
  assert.equal(visti.size, 2000);
});

test("newManualRegistrationId: il generatore si può iniettare e il prefisso si mette una volta sola", () => {
  assert.equal(newManualRegistrationId(() => "abcdef123"), "manual_abcdef123");
  assert.ok(FORMATO_ID_MANUALE.test(newManualRegistrationId(() => "abcdef")));
  assert.ok(!FORMATO_ID_MANUALE.test(newManualRegistrationId(() => "abc")), "sotto i 6 caratteri le rules rifiutano");
});

// ---------------------------------------------------------------------------
// getManualAddOutcome: tabella B della spec
// ---------------------------------------------------------------------------

test("esito B1: un adulto è attivo e non parte nessuna mail, qualunque sia l'attività", () => {
  for (const richiede of [true, false]) {
    assert.deepEqual(
      getManualAddOutcome({ birthDate: ADULTO, requiresParentAuthorization: richiede, parentEmail: "" }),
      { status: "active", needsParent: false, sendsMail: false },
    );
    // L'email del genitore di un adulto non conta.
    assert.deepEqual(
      getManualAddOutcome({
        birthDate: ADULTO,
        requiresParentAuthorization: richiede,
        parentEmail: "genitore@example.com",
      }),
      { status: "active", needsParent: false, sendsMail: false },
    );
  }
});

test("esito B2: chi ha meno di 18 anni in un'attività senza autorizzazione è attivo, senza mail", () => {
  assert.deepEqual(
    getManualAddOutcome({
      birthDate: MINORE,
      requiresParentAuthorization: false,
      parentEmail: "genitore@example.com",
    }),
    { status: "active", needsParent: false, sendsMail: false },
  );
});

test("esito B3: meno di 18 anni con autorizzazione e email del genitore: in attesa e parte la mail", () => {
  assert.deepEqual(
    getManualAddOutcome({
      birthDate: MINORE,
      requiresParentAuthorization: true,
      parentEmail: "genitore@example.com",
    }),
    { status: ATTESA, needsParent: true, sendsMail: true },
  );
  assert.equal(
    getManualAddOutcome({
      birthDate: MINORE,
      requiresParentAuthorization: true,
      parentEmail: "  Genitore@Example.com ",
    }).sendsMail,
    true,
    "gli spazi ai bordi non rendono l'email non valida",
  );
});

test("esito B4: meno di 18 anni con autorizzazione e senza email: in attesa, nessuna mail", () => {
  for (const parentEmail of ["", "   ", "non-una-email", "a@b"]) {
    assert.deepEqual(
      getManualAddOutcome({ birthDate: MINORE, requiresParentAuthorization: true, parentEmail }),
      { status: ATTESA, needsParent: true, sendsMail: false },
      JSON.stringify(parentEmail),
    );
  }
});

test("esito: il confine dei 18 anni segue la data di oggi", () => {
  const esito = (birthDate) =>
    getManualAddOutcome({ birthDate, requiresParentAuthorization: true, parentEmail: "g@example.com" });
  assert.equal(esito(nascita(18)).status, "active", "compie 18 anni oggi");
  assert.equal(esito(nascita(17)).status, ATTESA);
});

test(
  "esito: chi compie 18 anni domani è ancora in attesa del genitore",
  { skip: SOLO_FUSO_NON_A_OVEST },
  () => {
    assert.equal(
      getManualAddOutcome({
        birthDate: nascita(18, 1),
        requiresParentAuthorization: true,
        parentEmail: "g@example.com",
      }).status,
      ATTESA,
    );
  },
);

test("esito: lo stato proposto è quello che le rules ammettono alla creazione", () => {
  // validInitialRegistrationStatus: "attesa" sempre, "attiva" solo se l'attività
  // non chiede l'autorizzazione o la persona non ha meno di 18 anni.
  for (const data of [ADULTO, MINORE, nascita(17), nascita(19), nascita(12)]) {
    for (const richiede of [true, false]) {
      const { status } = getManualAddOutcome({
        birthDate: data,
        requiresParentAuthorization: richiede,
        parentEmail: "g@example.com",
      });
      const ammesso = status === ATTESA || !(richiede && minorePerLeRules(data));
      assert.ok(ammesso, `${data} con richiesta=${richiede}: «${status}» non passa le rules`);
    }
  }
});

// ---------------------------------------------------------------------------
// validateManualAdd, validateAdminEdit
// ---------------------------------------------------------------------------

test("validateManualAdd: dati completi e corretti, nessun problema", () => {
  assert.deepEqual(validateManualAdd(persona(), GENITORE_VUOTO, true), []);
  assert.deepEqual(validateManualAdd(persona({ email: "marco@example.com", phone: "333" }), GENITORE_VUOTO, true), []);
});

test("validateManualAdd: ogni campo obbligatorio mancante è un problema suo", () => {
  assert.deepEqual(validateManualAdd(persona({ firstName: "" }), GENITORE_VUOTO, false), ["nome"]);
  assert.deepEqual(validateManualAdd(persona({ firstName: "   " }), GENITORE_VUOTO, false), ["nome"]);
  assert.deepEqual(validateManualAdd(persona({ lastName: "" }), GENITORE_VUOTO, false), ["cognome"]);
  assert.deepEqual(validateManualAdd(persona({ lastName: " " }), GENITORE_VUOTO, false), ["cognome"]);
  assert.deepEqual(validateManualAdd(persona({ birthDate: "" }), GENITORE_VUOTO, false), ["dataNascita"]);
  assert.deepEqual(validateManualAdd(persona({ birthDate: "2027-02-30" }), GENITORE_VUOTO, false), ["dataNascita"]);
  assert.deepEqual(validateManualAdd(persona({ birthDate: traDueGiorni() }), GENITORE_VUOTO, false), ["dataNascita"]);
  assert.deepEqual(validateManualAdd(persona({ genderRoleCategory: "" }), GENITORE_VUOTO, false), ["categoria"]);
  assert.deepEqual(validateManualAdd(persona({ unitId: "", unitName: "" }), GENITORE_VUOTO, false), ["unita"]);
});

test("validateManualAdd: l'email della persona è facoltativa ma, se c'è, deve essere valida", () => {
  assert.deepEqual(validateManualAdd(persona({ email: "" }), GENITORE_VUOTO, false), []);
  assert.deepEqual(validateManualAdd(persona({ email: "   " }), GENITORE_VUOTO, false), []);
  assert.deepEqual(validateManualAdd(persona({ email: "marco" }), GENITORE_VUOTO, false), ["emailPersona"]);
  assert.deepEqual(validateManualAdd(persona({ email: " marco@example.com " }), GENITORE_VUOTO, false), []);
});

test("validateManualAdd: l'email del genitore si controlla solo se serve il genitore", () => {
  const sbagliata = genitore("non-una-email");
  assert.deepEqual(validateManualAdd(persona({ birthDate: MINORE }), sbagliata, true), ["emailGenitore"]);
  // Attività senza autorizzazione: il genitore non c'è, l'email non si guarda.
  assert.deepEqual(validateManualAdd(persona({ birthDate: MINORE }), sbagliata, false), []);
  // Adulto: stessa cosa.
  assert.deepEqual(validateManualAdd(persona({ birthDate: ADULTO }), sbagliata, true), []);
  // Senza email del genitore si può salvare (si chiede dopo dalla scheda).
  assert.deepEqual(validateManualAdd(persona({ birthDate: MINORE }), GENITORE_VUOTO, true), []);
  assert.deepEqual(validateManualAdd(persona({ birthDate: MINORE }), genitore("   "), true), []);
  assert.deepEqual(validateManualAdd(persona({ birthDate: MINORE }), genitore("ok@example.com"), true), []);
});

test("validateManualAdd: i problemi si elencano tutti insieme, nell'ordine del foglio", () => {
  assert.deepEqual(
    validateManualAdd(
      persona({
        firstName: "",
        lastName: "",
        birthDate: "",
        genderRoleCategory: "",
        unitId: "",
        email: "x",
      }),
      GENITORE_VUOTO,
      true,
    ),
    ["nome", "cognome", "dataNascita", "categoria", "unita", "emailPersona"],
  );
});

test("validateAdminEdit: gli stessi controlli, con il genitore solo se il piano lo chiede", () => {
  const sbagliata = genitore("non-una-email");
  assert.deepEqual(validateAdminEdit(persona(), GENITORE_VUOTO, { needsParentFields: false }), []);
  assert.deepEqual(
    validateAdminEdit(
      persona({ firstName: "", lastName: "", birthDate: "", genderRoleCategory: "", unitId: "", email: "x" }),
      GENITORE_VUOTO,
      { needsParentFields: false },
    ),
    ["nome", "cognome", "dataNascita", "categoria", "unita", "emailPersona"],
  );
  assert.deepEqual(validateAdminEdit(persona(), sbagliata, { needsParentFields: true }), ["emailGenitore"]);
  assert.deepEqual(validateAdminEdit(persona(), sbagliata, { needsParentFields: false }), []);
  assert.deepEqual(validateAdminEdit(persona(), GENITORE_VUOTO, { needsParentFields: true }), []);
});

// ---------------------------------------------------------------------------
// buildManualRegistrationDoc
// ---------------------------------------------------------------------------

const DOC_BASE = {
  person: persona({ email: " marco@example.com ", phone: " 333 1112233 " }),
  parent: GENITORE_VUOTO,
  requiresParentAuthorization: true,
  createdBy: ADMIN_UID,
  timestamp: TIMESTAMP,
};
const creaDoc = (extra = {}) => buildManualRegistrationDoc({ ...DOC_BASE, ...extra });

// Tipi attesi, ricavati dalle clausole `data.x is T` e `data.x == null ||
// data.x is T` di validRegistrationPayload.
const TIPI_RULES = new Map();
for (const match of PAYLOAD.matchAll(/data\.(\w+) is (string|bool|list|map)/gu)) {
  const [, chiave, tipo] = match;
  TIPI_RULES.set(chiave, { tipo, nullable: PAYLOAD.includes(`data.${chiave} == null`) });
}
const controlliTipo = {
  string: (v) => typeof v === "string",
  bool: (v) => typeof v === "boolean",
  list: (v) => Array.isArray(v),
  map: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
};
// Chiavi che le rules vincolano in altro modo (`in [...]`, funzioni) o non
// vincolano nel payload: le controllano i test qui sotto, una per una.
const CHIAVI_CONTROLLATE_A_MANO = [
  "userId",
  "anonymousUid",
  "genderRoleCategory",
  "registrationStatus",
  "submittedByMode",
  "assignedPatrolRole",
  "createdBy",
];

test("documento a mano: l'elenco delle rules è letto e completo", () => {
  assert.ok(CHIAVI_PAYLOAD.length >= 40, `trovate solo ${CHIAVI_PAYLOAD.length} chiavi`);
  assert.ok(CHIAVI_PAYLOAD.includes("createdBy"));
  for (const chiave of CHIAVI_PAYLOAD) {
    assert.ok(
      TIPI_RULES.has(chiave) || CHIAVI_CONTROLLATE_A_MANO.includes(chiave),
      `«${chiave}» è nuova nelle rules: serve un controllo di tipo in questo test`,
    );
  }
});

test("documento a mano: ogni chiave dell'elenco delle rules è presente, e nessuna in più", () => {
  const documento = creaDoc();
  assert.deepEqual(Object.keys(documento).sort(), [...CHIAVI_PAYLOAD].sort());
});

test("documento a mano: ogni chiave ha il tipo che le rules chiedono", () => {
  const documento = creaDoc();
  for (const [chiave, { tipo, nullable }] of TIPI_RULES) {
    if (!(chiave in documento)) continue;
    const valore = documento[chiave];
    const valido = (nullable && valore === null) || controlliTipo[tipo](valore);
    assert.ok(valido, `${chiave}: ${JSON.stringify(valore)} non è ${nullable ? "null o " : ""}${tipo}`);
  }
  assert.ok(["giovane_uomo", "giovane_donna", "dirigente", "accompagnatore"].includes(documento.genderRoleCategory));
  assert.ok(["active", "cancelled", ATTESA, "rejected_by_parent"].includes(documento.registrationStatus));
  assert.equal(documento.submittedByMode, "anonymous");
});

test("documento a mano: consensi, firme, codici, assegnazioni e titolare sono vuoti", () => {
  assert.ok(VUOTI_ALLA_CREAZIONE.length >= 15, "elenco dei campi vuoti non letto dalle rules");
  for (const extra of [{}, { person: persona({ birthDate: MINORE }), parent: genitore() }]) {
    const documento = creaDoc(extra);
    for (const [chiave, atteso] of VUOTI_ALLA_CREAZIONE) {
      assert.deepEqual(documento[chiave], atteso, chiave);
    }
    for (const chiave of [
      "userId",
      "anonymousUid",
      "anonymousTokenId",
      "parentUid",
      "childId",
      "linkedLaterToUserId",
      "accessCode",
      "recoveryCode",
      "roomPreferenceMatches",
      "parentAuthorization",
      "consentSignatureUrl",
      "consentSignaturePath",
      "consentSignatureSetAt",
      "parentConsentDocumentUrl",
      "parentIdDocumentUrl",
      "assignedRoomId",
      "assignedRoomName",
      "assignedPatrolId",
      "assignedTempleShiftId",
    ]) {
      assert.equal(documento[chiave], null, chiave);
    }
    assert.equal(documento.recoveryPdfGenerated, false);
    assert.deepEqual(documento.assignedServiceTeamIds, []);
    assert.deepEqual(documento.assignedCommittees, []);
    assert.deepEqual(documento.participatingDays, []);
  }
});

test("documento a mano: autore, date e modalità", () => {
  const documento = creaDoc();
  assert.equal(documento.createdBy, ADMIN_UID);
  assert.equal(documento.createdAt, TIMESTAMP);
  assert.equal(documento.updatedAt, TIMESTAMP);
  assert.equal(documento.submittedByMode, "anonymous");
});

test("documento a mano: i dati della persona, senza spazi ai bordi", () => {
  const documento = creaDoc({
    person: persona({
      firstName: "  Anna Maria ",
      lastName: " De Luca  ",
      email: " anna@example.com ",
      phone: " 333 1112233 ",
      genderRoleCategory: "giovane_donna",
      unitId: "u9",
      unitName: " Rione Sud ",
      birthDate: ADULTO,
    }),
  });
  assert.equal(documento.firstName, "Anna Maria");
  assert.equal(documento.lastName, "De Luca");
  assert.equal(documento.fullName, "Anna Maria De Luca");
  assert.equal(documento.email, "anna@example.com");
  assert.equal(documento.phone, "333 1112233");
  assert.equal(documento.birthDate, ADULTO);
  assert.equal(documento.genderRoleCategory, "giovane_donna");
  assert.equal(documento.unitId, "u9");
  assert.equal(documento.unitNameSnapshot, "Rione Sud");
});

test("documento a mano: email e telefono mancanti sono stringhe vuote, non null", () => {
  const documento = creaDoc({ person: persona({ email: "", phone: "" }) });
  assert.equal(documento.email, "");
  assert.equal(documento.phone, "");
});

test("documento a mano: answers ha data, categoria, gruppo e unità (e nient'altro per un adulto)", () => {
  const documento = creaDoc({
    person: persona({ genderRoleCategory: "giovane_donna", unitName: " Rione Sud ", birthDate: ADULTO }),
  });
  assert.deepEqual(documento.answers, {
    birthDate: ADULTO,
    genderRoleCategory: "giovane_donna",
    youthGroup: "Giovani Donne",
    unitName: "Rione Sud",
  });
});

test("documento a mano: il gruppo giovani segue la categoria", () => {
  const gruppo = (categoria) =>
    creaDoc({ person: persona({ genderRoleCategory: categoria }) }).answers.youthGroup;
  assert.equal(gruppo("giovane_uomo"), "Giovani Uomini");
  assert.equal(gruppo("giovane_donna"), "Giovani Donne");
  assert.equal(gruppo("dirigente"), "Dirigente");
  assert.equal(gruppo("accompagnatore"), "Accompagnatore");
});

test("documento a mano: la richiesta al genitore c'è solo per chi ha meno di 18 anni, con autorizzazione e email valida", () => {
  const richiestaDel = (extra) => creaDoc(extra).answers.parentAuthorizationRequest;
  const minore = persona({ birthDate: MINORE });

  assert.deepEqual(
    richiestaDel({ person: minore, parent: genitore("  Genitore@Example.COM ", { firstName: " Anna ", lastName: " Rossi ", phone: " 333 " }) }),
    {
      parentFirstName: "Anna",
      parentLastName: "Rossi",
      parentEmail: "genitore@example.com",
      parentPhone: "333",
      submittedAt: TIMESTAMP,
    },
  );

  // Niente richiesta: adulto, attività senza autorizzazione, email assente o non valida.
  assert.equal(richiestaDel({ person: persona({ birthDate: ADULTO }), parent: genitore() }), undefined);
  assert.equal(richiestaDel({ person: minore, parent: genitore(), requiresParentAuthorization: false }), undefined);
  assert.equal(richiestaDel({ person: minore, parent: GENITORE_VUOTO }), undefined);
  assert.equal(richiestaDel({ person: minore, parent: genitore("   ") }), undefined);
  assert.equal(richiestaDel({ person: minore, parent: genitore("non-una-email") }), undefined);
  for (const extra of [
    { person: persona({ birthDate: ADULTO }), parent: genitore() },
    { person: minore, parent: GENITORE_VUOTO },
  ]) {
    assert.equal("parentAuthorizationRequest" in creaDoc(extra).answers, false);
  }
});

test("documento a mano: lo stato segue la tabella B", () => {
  const stato = (extra) => creaDoc(extra).registrationStatus;
  assert.equal(stato({ person: persona({ birthDate: ADULTO }) }), "active");
  assert.equal(stato({ person: persona({ birthDate: MINORE }), requiresParentAuthorization: false }), "active");
  assert.equal(stato({ person: persona({ birthDate: MINORE }), parent: genitore() }), ATTESA);
  assert.equal(stato({ person: persona({ birthDate: MINORE }), parent: GENITORE_VUOTO }), ATTESA);
});

test("documento a mano: lo stato scritto passa le rules di creazione per ogni caso", () => {
  for (const data of [ADULTO, MINORE, nascita(17), nascita(19)]) {
    for (const richiede of [true, false]) {
      for (const parent of [GENITORE_VUOTO, genitore()]) {
        const documento = creaDoc({ person: persona({ birthDate: data }), parent, requiresParentAuthorization: richiede });
        const ammesso =
          documento.registrationStatus === ATTESA ||
          (documento.registrationStatus === "active" && !(richiede && minorePerLeRules(data)));
        assert.ok(ammesso, `${data} richiede=${richiede}: «${documento.registrationStatus}»`);
      }
    }
  }
});

test("documento a mano: la data scritta nelle risposte è la stessa del documento", () => {
  const documento = creaDoc({ person: persona({ birthDate: MINORE }), parent: genitore() });
  assert.equal(documento.answers.birthDate, documento.birthDate);
  assert.equal(documento.answers.unitName, documento.unitNameSnapshot);
  assert.equal(documento.answers.genderRoleCategory, documento.genderRoleCategory);
});

test("documento a mano: stesso input, stesso documento, senza condividere strutture fra le chiamate", () => {
  const input = { ...DOC_BASE, person: persona({ birthDate: MINORE }), parent: genitore() };
  const primo = buildManualRegistrationDoc(input);
  const secondo = buildManualRegistrationDoc(input);
  assert.deepEqual(primo, secondo);
  primo.assignedServiceTeamIds.push("x");
  primo.assignedCommittees.push("x");
  primo.participatingDays.push("x");
  primo.answers.unitName = "cambiato";
  assert.deepEqual(secondo.assignedServiceTeamIds, []);
  assert.deepEqual(secondo.assignedCommittees, []);
  assert.deepEqual(secondo.participatingDays, []);
  assert.equal(secondo.answers.unitName, "Rione Nord");
  assert.deepEqual(buildManualRegistrationDoc(input), secondo);
});

test("documento a mano: non modifica i dati che riceve", () => {
  const input = {
    person: Object.freeze(persona({ birthDate: MINORE, firstName: " Marco " })),
    parent: Object.freeze(genitore(" G@Example.com ")),
    requiresParentAuthorization: true,
    createdBy: ADMIN_UID,
    timestamp: TIMESTAMP,
  };
  assert.doesNotThrow(() => buildManualRegistrationDoc(input));
  assert.equal(input.person.firstName, " Marco ");
  assert.equal(input.parent.email, " G@Example.com ");
});

test("documento a mano: id e documento passano insieme le regole di creazione", () => {
  const id = newManualRegistrationId();
  assert.ok(FORMATO_ID_MANUALE.test(id));
  const documento = creaDoc();
  assert.ok(documento.firstName.length > 0 && documento.lastName.length > 0);
  assert.match(documento.birthDate, /^\d{4}-\d{2}-\d{2}$/u);
  assert.ok(documento.unitId.length > 0);
  assert.equal(typeof documento.createdBy, "string");
});

// ---------------------------------------------------------------------------
// findPossibleDuplicates
// ---------------------------------------------------------------------------

const BIRTH_ROSSI = nascita(16);

function inElenco(id, firstName, lastName, birthDate, extra = {}) {
  return {
    id,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    birthDate,
    registrationStatus: "active",
    ...extra,
  };
}

const ELENCO = [
  inElenco("r1", "Marco", "Rossi", BIRTH_ROSSI),
  inElenco("r2", "Anna", "Bianchi", nascita(22)),
  inElenco("r3", "Giulia", "Verdi", nascita(20), { registrationStatus: "cancelled" }),
  inElenco("r4", "José", "Núñez", nascita(25)),
  inElenco("r5", "Maria Chiara", "Dell'Aquila", nascita(19)),
];
const idDei = (trovati) => trovati.map((iscritto) => iscritto.id);
const cerca = (firstName, lastName, birthDate = "", escludi) =>
  idDei(findPossibleDuplicates(ELENCO, { firstName, lastName, birthDate }, escludi));

test("doppioni: stesso nome e cognome", () => {
  assert.deepEqual(cerca("Marco", "Rossi", nascita(40)), ["r1"]);
  assert.deepEqual(cerca("Anna", "Bianchi"), ["r2"]);
});

test("doppioni: maiuscole, spazi e accenti non contano", () => {
  assert.deepEqual(cerca("MARCO", "rossi"), ["r1"]);
  assert.deepEqual(cerca("  marco ", "  ROSSI  "), ["r1"]);
  assert.deepEqual(cerca("Marco", "Rossi   "), ["r1"]);
  assert.deepEqual(cerca("Jose", "Nunez"), ["r4"], "senza accenti");
  assert.deepEqual(cerca("JOSÉ", "NÚÑEZ"), ["r4"], "maiuscolo con accenti");
  assert.deepEqual(cerca("José", "Núñez"), ["r4"], "accenti scritti come segni combinati");
});

test("doppioni: apostrofi e nomi doppi", () => {
  assert.deepEqual(cerca("Maria Chiara", "Dell'Aquila"), ["r5"]);
  assert.deepEqual(cerca("maria chiara", "dell’aquila"), ["r5"], "apostrofo tipografico");
  assert.deepEqual(cerca("Maria  Chiara", "Dell Aquila"), ["r5"]);
});

test("doppioni: nome e cognome scambiati", () => {
  assert.deepEqual(cerca("Rossi", "Marco"), ["r1"]);
  assert.deepEqual(cerca("Bianchi", "Anna"), ["r2"]);
  assert.deepEqual(cerca("Dell'Aquila", "Maria Chiara"), ["r5"]);
});

test("doppioni: il confronto non dipende dal nome completo salvato", () => {
  const elenco = [inElenco("x1", "Marco", "Rossi", BIRTH_ROSSI, { fullName: "" })];
  assert.deepEqual(idDei(findPossibleDuplicates(elenco, { firstName: "Marco", lastName: "Rossi", birthDate: "" })), ["x1"]);
});

test("doppioni: un'iscrizione vecchia con solo il nome completo si riconosce lo stesso", () => {
  const elenco = [inElenco("v1", "", "", BIRTH_ROSSI, { fullName: "Marco Rossi" })];
  const trova = (firstName, lastName) =>
    idDei(findPossibleDuplicates(elenco, { firstName, lastName, birthDate: "" }));
  assert.deepEqual(trova("Marco", "Rossi"), ["v1"]);
  assert.deepEqual(trova("Rossi", "Marco"), ["v1"]);
  assert.deepEqual(trova("Marco", "Bianchi"), []);
});

test("doppioni: stesso nome e stessa data di nascita, anche con il cognome scritto diverso", () => {
  assert.deepEqual(cerca("Marco", "Rosi", BIRTH_ROSSI), ["r1"]);
  assert.deepEqual(cerca("marco", "Russo", BIRTH_ROSSI), ["r1"]);
});

test("doppioni: nessun falso positivo", () => {
  assert.deepEqual(cerca("Marco", "Bianchi", nascita(40)), [], "stesso nome, cognome e data diversi");
  assert.deepEqual(cerca("Luca", "Rossi", nascita(40)), [], "stesso cognome, nome diverso");
  assert.deepEqual(cerca("Luca", "Rossi", BIRTH_ROSSI), [], "stessa data ma nome e cognome diversi");
  assert.deepEqual(cerca("Marc", "Rossi"), [], "un pezzo del nome non basta");
  assert.deepEqual(cerca("Marcello", "Rossi"), []);
  assert.deepEqual(cerca("Marco", "Rossini"), []);
  assert.deepEqual(cerca("Marco", "Rossi Bianchi", nascita(40)), []);
  assert.deepEqual(cerca("Giovanni", "Neri", nascita(33)), []);
});

test("doppioni: una data vuota non fa da corrispondenza", () => {
  const elenco = [inElenco("v1", "Marco", "Rossi", "")];
  assert.deepEqual(idDei(findPossibleDuplicates(elenco, { firstName: "Marco", lastName: "Bianchi", birthDate: "" })), []);
});

test("doppioni: le iscrizioni annullate non contano", () => {
  assert.deepEqual(cerca("Giulia", "Verdi"), []);
  assert.deepEqual(cerca("Giulia", "Verdi", nascita(20)), []);
  assert.deepEqual(cerca("Giulia", "Rossi", nascita(20)), []);
});

test("doppioni: excludeId toglie l'iscrizione che si sta modificando", () => {
  assert.deepEqual(cerca("Marco", "Rossi", BIRTH_ROSSI, "r1"), []);
  assert.deepEqual(cerca("Marco", "Rossi", BIRTH_ROSSI, "altro"), ["r1"]);
  const elenco = [...ELENCO, inElenco("r6", "Marco", "Rossi", BIRTH_ROSSI)];
  assert.deepEqual(
    idDei(findPossibleDuplicates(elenco, { firstName: "Marco", lastName: "Rossi", birthDate: BIRTH_ROSSI }, "r1")),
    ["r6"],
  );
});

test("doppioni: più iscrizioni uguali tornano tutte, nell'ordine dell'elenco", () => {
  const elenco = [
    inElenco("a", "Marco", "Rossi", nascita(20)),
    inElenco("b", "Anna", "Bianchi", nascita(21)),
    inElenco("c", "Rossi", "Marco", nascita(22)),
    inElenco("d", "Marco", "Rossi", nascita(23), { registrationStatus: ATTESA }),
  ];
  assert.deepEqual(
    idDei(findPossibleDuplicates(elenco, { firstName: "Marco", lastName: "Rossi", birthDate: "" })),
    ["a", "c", "d"],
  );
});

test("doppioni: senza nome non si cerca niente, e un elenco vuoto non dà risultati", () => {
  assert.deepEqual(cerca("", "Rossi", BIRTH_ROSSI), []);
  assert.deepEqual(cerca("   ", "Rossi"), []);
  assert.deepEqual(cerca("", ""), []);
  assert.deepEqual(findPossibleDuplicates([], { firstName: "Marco", lastName: "Rossi", birthDate: BIRTH_ROSSI }), []);
});

test("doppioni: l'elenco ricevuto non viene toccato", () => {
  const copia = JSON.stringify(ELENCO);
  cerca("Marco", "Rossi", BIRTH_ROSSI, "r9");
  assert.equal(JSON.stringify(ELENCO), copia);
});

// ---------------------------------------------------------------------------
// personDraftFromRegistration
// ---------------------------------------------------------------------------

test("personDraftFromRegistration: parte dall'iscrizione, con il nome dell'unità di riserva", () => {
  const registrazione = iscrizione({ email: "m@example.com", phone: "333" });
  assert.deepEqual(personDraftFromRegistration(registrazione), {
    firstName: "Marco",
    lastName: "Rossi",
    birthDate: ADULTO,
    genderRoleCategory: "giovane_uomo",
    unitId: "u1",
    unitName: "Rione Nord",
    email: "m@example.com",
    phone: "333",
  });
  const senzaSnapshot = iscrizione({ unitNameSnapshot: "" });
  assert.equal(personDraftFromRegistration(senzaSnapshot).unitName, "Rione Nord", "dalle risposte");
  const senzaNiente = iscrizione({ unitNameSnapshot: "", answers: {} });
  assert.equal(personDraftFromRegistration(senzaNiente).unitName, "");
});

// ---------------------------------------------------------------------------
// planAdminEdit: tabella "Cosa succede se cambiano data di nascita, unità o nome"
// ---------------------------------------------------------------------------

const MAIL_GENITORE = "genitore@example.com";
const effettoMail = (email) => fillCopy(ISCRITTI.effettoMenoDi18Mail, { email });

test("modifica: nessun dato cambiato, nessun effetto", () => {
  for (const stato of ["active", ATTESA, "cancelled", "confirmed", "rejected_by_parent"]) {
    const registrazione = iscrizione({ registrationStatus: stato });
    assert.deepEqual(planAdminEdit(registrazione, bozza(registrazione), GENITORE_VUOTO, contesto(registrazione)), {
      nextStatus: stato,
      needsParentFields: false,
      sendsMail: false,
      effects: [],
    });
  }
});

test("modifica riga 1: adulto → meno di 18 anni con l'email già nella richiesta: in attesa e parte la mail", () => {
  const registrazione = conRichiesta("  Genitore@Example.com ");
  const piano = planAdminEdit(registrazione, bozza(registrazione, { birthDate: MINORE }), GENITORE_VUOTO, contesto(registrazione));
  assert.equal(piano.nextStatus, ATTESA);
  assert.equal(piano.sendsMail, true);
  assert.equal(piano.needsParentFields, false, "la richiesta c'è già");
  assert.deepEqual(piano.effects, [effettoMail(MAIL_GENITORE)]);
});

test("modifica riga 1: senza email né nella richiesta né nel foglio: in attesa, la si chiede dopo", () => {
  const registrazione = iscrizione();
  const piano = planAdminEdit(registrazione, bozza(registrazione, { birthDate: MINORE }), GENITORE_VUOTO, contesto(registrazione));
  assert.equal(piano.nextStatus, ATTESA);
  assert.equal(piano.sendsMail, false);
  assert.equal(piano.needsParentFields, true, "servono i campi del genitore");
  assert.deepEqual(piano.effects, [ISCRITTI.effettoMenoDi18SenzaEmail]);

  // Email scritta ma non valida: come se mancasse.
  const sbagliata = planAdminEdit(registrazione, bozza(registrazione, { birthDate: MINORE }), genitore("non-una-email"), contesto(registrazione));
  assert.equal(sbagliata.sendsMail, false);
  assert.deepEqual(sbagliata.effects, [ISCRITTI.effettoMenoDi18SenzaEmail]);
});

test("modifica riga 1: senza email nella richiesta ma con l'email scritta nel foglio: parte la mail", () => {
  const registrazione = iscrizione();
  const piano = planAdminEdit(
    registrazione,
    bozza(registrazione, { birthDate: MINORE }),
    genitore("  Nuova.Email@Example.COM "),
    contesto(registrazione),
  );
  assert.equal(piano.nextStatus, ATTESA);
  assert.equal(piano.sendsMail, true);
  assert.equal(piano.needsParentFields, true, "la richiesta va scritta con i dati del foglio");
  assert.deepEqual(piano.effects, [effettoMail("nuova.email@example.com")]);
});

test("modifica riga 1: l'email della richiesta ha la precedenza su quella del foglio", () => {
  const registrazione = conRichiesta(MAIL_GENITORE);
  const piano = planAdminEdit(registrazione, bozza(registrazione, { birthDate: MINORE }), genitore("altra@example.com"), contesto(registrazione));
  assert.deepEqual(piano.effects, [effettoMail(MAIL_GENITORE)]);
  assert.equal(piano.needsParentFields, false);
});

test("modifica riga 1: il confine dei 18 anni segue la data di oggi", () => {
  const registrazione = iscrizione({ birthDate: nascita(30) });
  const verso = (data) => planAdminEdit(registrazione, bozza(registrazione, { birthDate: data }), GENITORE_VUOTO, contesto(registrazione)).nextStatus;
  assert.equal(verso(nascita(17)), ATTESA);
  assert.equal(verso(nascita(18)), "active", "compie 18 anni oggi: resta adulto");
  assert.equal(verso(nascita(25)), "active");
});

test("modifica riga 1: una persona senza data di nascita (le 13 di oggi) diventa in attesa se la data dice meno di 18 anni", () => {
  const registrazione = iscrizione({ birthDate: "" });
  const piano = planAdminEdit(registrazione, bozza(registrazione, { birthDate: MINORE }), GENITORE_VUOTO, contesto(registrazione));
  assert.equal(piano.nextStatus, ATTESA);
  assert.equal(piano.needsParentFields, true);
});

test("modifica riga 2: adulto → meno di 18 anni in un'attività senza autorizzazione: stato invariato, decide il genitore", () => {
  const registrazione = iscrizione();
  const piano = planAdminEdit(
    registrazione,
    bozza(registrazione, { birthDate: MINORE }),
    GENITORE_VUOTO,
    contesto(registrazione, { requiresParentAuthorization: false }),
  );
  assert.equal(piano.nextStatus, "active");
  assert.equal(piano.sendsMail, false);
  assert.equal(piano.needsParentFields, false);
  assert.deepEqual(piano.effects, [ISCRITTI.effettoFotoGenitore]);
});

test("modifica riga 3: meno di 18 anni in attesa → 18 anni o più: torna attiva e il link smette di valere", () => {
  for (const autorizzazione of [null, firma("email_sent"), firma("expired"), firma("failed")]) {
    const registrazione = conRichiesta(MAIL_GENITORE, {
      birthDate: MINORE,
      registrationStatus: ATTESA,
      parentAuthorization: autorizzazione,
    });
    const piano = planAdminEdit(registrazione, bozza(registrazione, { birthDate: ADULTO }), GENITORE_VUOTO, contesto(registrazione));
    assert.equal(piano.nextStatus, "active", JSON.stringify(autorizzazione));
    assert.equal(piano.sendsMail, false);
    assert.equal(piano.needsParentFields, false);
    assert.deepEqual(piano.effects, [ISCRITTI.effettoDa18]);
  }
});

test("modifica riga 3: anche senza l'email del genitore (in attesa senza richiesta) torna attiva", () => {
  const registrazione = iscrizione({ birthDate: MINORE, registrationStatus: ATTESA });
  const piano = planAdminEdit(registrazione, bozza(registrazione, { birthDate: ADULTO }), GENITORE_VUOTO, contesto(registrazione));
  assert.equal(piano.nextStatus, "active");
  assert.deepEqual(piano.effects, [ISCRITTI.effettoDa18]);
});

test(
  "modifica riga 3: in attesa senza data di nascita (le iscrizioni a mano ferme) e la data dice 18 anni o più: torna attiva",
  () => {
    const registrazione = iscrizione({ birthDate: "", registrationStatus: ATTESA });
    const piano = planAdminEdit(registrazione, bozza(registrazione, { birthDate: ADULTO }), GENITORE_VUOTO, contesto(registrazione));
    assert.equal(piano.nextStatus, "active");
    assert.equal(piano.sendsMail, false);
  },
);

test("modifica: in attesa senza data di nascita e la data dice meno di 18 anni: resta in attesa e si chiede l'email", () => {
  const registrazione = iscrizione({ birthDate: "", registrationStatus: ATTESA });
  const piano = planAdminEdit(registrazione, bozza(registrazione, { birthDate: MINORE }), GENITORE_VUOTO, contesto(registrazione));
  assert.equal(piano.nextStatus, ATTESA);
  assert.equal(piano.needsParentFields, true);
  assert.equal(piano.sendsMail, false);
});

test("modifica riga 3: attività senza autorizzazione, meno di 18 anni → adulto: stato invariato, decide la persona", () => {
  const registrazione = iscrizione({ birthDate: MINORE });
  const piano = planAdminEdit(
    registrazione,
    bozza(registrazione, { birthDate: ADULTO }),
    GENITORE_VUOTO,
    contesto(registrazione, { requiresParentAuthorization: false }),
  );
  assert.equal(piano.nextStatus, "active");
  assert.deepEqual(piano.effects, [ISCRITTI.effettoFotoPersona]);
});

test("modifica riga 3: una persona attiva (non in attesa) che diventa adulta non riceve l'avviso del link al genitore", () => {
  // Meno di 18 anni attiva e senza firma: succede con i dati di prima delle rules di ottobre.
  const registrazione = iscrizione({ birthDate: MINORE, registrationStatus: "active" });
  const piano = planAdminEdit(registrazione, bozza(registrazione, { birthDate: ADULTO }), GENITORE_VUOTO, contesto(registrazione));
  assert.equal(piano.nextStatus, "active");
  assert.deepEqual(piano.effects, [ISCRITTI.effettoFotoPersona], "nessun link mandato al genitore da far smettere di valere");
});

test("modifica: cambiare data restando adulto o restando con meno di 18 anni non cambia stato né avvisa", () => {
  const adulto = iscrizione();
  const pianoAdulto = planAdminEdit(adulto, bozza(adulto, { birthDate: nascita(45) }), GENITORE_VUOTO, contesto(adulto));
  assert.deepEqual(pianoAdulto, { nextStatus: "active", needsParentFields: false, sendsMail: false, effects: [] });

  const minore = conRichiesta(MAIL_GENITORE, { birthDate: MINORE, registrationStatus: ATTESA });
  const pianoMinore = planAdminEdit(minore, bozza(minore, { birthDate: nascita(14) }), GENITORE_VUOTO, contesto(minore));
  assert.deepEqual(pianoMinore, { nextStatus: ATTESA, needsParentFields: false, sendsMail: false, effects: [] });
});

test("modifica riga 4: con la firma o il rifiuto del genitore la data cambia ma stato e consensi restano", () => {
  const casi = [
    ["confirmed", firma("authorized")],
    ["active", firma("authorized")],
    ["rejected_by_parent", firma("rejected_by_parent")],
  ];
  for (const [stato, autorizzazione] of casi) {
    for (const [prima, dopo] of [
      [ADULTO, MINORE],
      [MINORE, ADULTO],
    ]) {
      const registrazione = conRichiesta(MAIL_GENITORE, {
        birthDate: prima,
        registrationStatus: stato,
        parentAuthorization: autorizzazione,
      });
      const piano = planAdminEdit(registrazione, bozza(registrazione, { birthDate: dopo }), GENITORE_VUOTO, contesto(registrazione));
      const etichetta = `${stato}, ${prima} → ${dopo}`;
      assert.equal(piano.nextStatus, stato, etichetta);
      assert.equal(piano.sendsMail, false, etichetta);
      assert.equal(piano.needsParentFields, false, etichetta);
      assert.deepEqual(piano.effects, [ISCRITTI.effettoFirmaResta], etichetta);
    }
  }
});

test("modifica riga 4: se la data non cambia, l'autorizzazione già data non produce avvisi", () => {
  const registrazione = iscrizione({
    birthDate: MINORE,
    registrationStatus: "confirmed",
    parentAuthorization: firma("authorized"),
  });
  const piano = planAdminEdit(registrazione, bozza(registrazione, { phone: "333" }), GENITORE_VUOTO, contesto(registrazione));
  assert.deepEqual(piano.effects, []);
});

test("modifica riga 5: l'unità cambia e c'era un'unità prima: la vedono i dirigenti della nuova, non della vecchia", () => {
  const registrazione = iscrizione();
  const piano = planAdminEdit(
    registrazione,
    bozza(registrazione, { unitId: "u2", unitName: "Rione Sud" }),
    GENITORE_VUOTO,
    contesto(registrazione),
  );
  assert.equal(piano.nextStatus, "active");
  assert.equal(piano.sendsMail, false);
  assert.deepEqual(piano.effects, [fillCopy(ISCRITTI.effettoUnita, { nuova: "Rione Sud", vecchia: "Rione Nord" })]);
  assert.ok(!piano.effects[0].includes("{"), piano.effects[0]);
});

test("modifica riga 5: senza unità prima la vedono solo i dirigenti della nuova", () => {
  const registrazione = iscrizione({ unitId: "", unitNameSnapshot: "", answers: {} });
  const piano = planAdminEdit(
    registrazione,
    bozza(registrazione, { unitId: "u2", unitName: "Rione Sud" }),
    GENITORE_VUOTO,
    contesto(registrazione, { previousUnitName: "" }),
  );
  assert.deepEqual(piano.effects, [fillCopy(ISCRITTI.effettoUnitaNuova, { nuova: "Rione Sud" })]);
});

test("modifica riga 5: l'unità ha un id ma non più un nome (unità cancellata): niente 'non più quelli di' vuoto", () => {
  const registrazione = iscrizione();
  const piano = planAdminEdit(
    registrazione,
    bozza(registrazione, { unitId: "u2", unitName: "Rione Sud" }),
    GENITORE_VUOTO,
    contesto(registrazione, { previousUnitName: "" }),
  );
  assert.deepEqual(piano.effects, [fillCopy(ISCRITTI.effettoUnitaNuova, { nuova: "Rione Sud" })]);
});

test("modifica riga 5: con un nome d'unità ma senza id (nessun dirigente la vedeva) non si dice 'non più quelli di'", () => {
  const registrazione = iscrizione({ unitId: "", unitNameSnapshot: "Rione Nord" });
  const piano = planAdminEdit(
    registrazione,
    bozza(registrazione, { unitId: "u2", unitName: "Rione Sud" }),
    GENITORE_VUOTO,
    contesto(registrazione, { previousUnitName: "Rione Nord" }),
  );
  assert.deepEqual(piano.effects, [fillCopy(ISCRITTI.effettoUnitaNuova, { nuova: "Rione Sud" })]);
});

test("modifica riga 5: unità svuotata nel foglio, nessun avviso (il salvataggio è bloccato)", () => {
  const registrazione = iscrizione();
  const piano = planAdminEdit(registrazione, bozza(registrazione, { unitId: "", unitName: "" }), GENITORE_VUOTO, contesto(registrazione));
  assert.deepEqual(piano.effects, []);
  assert.deepEqual(validateAdminEdit(bozza(registrazione, { unitId: "", unitName: "" }), GENITORE_VUOTO, piano), ["unita"]);
});

test("modifica riga 5: stessa unità, nessun avviso sull'unità", () => {
  const registrazione = iscrizione();
  const piano = planAdminEdit(registrazione, bozza(registrazione, { unitName: "Rione Nord" }), GENITORE_VUOTO, contesto(registrazione));
  assert.deepEqual(piano.effects, []);
});

test("modifica riga 6: nome o cognome cambiati con la firma: il modulo firmato resta con il nome di prima", () => {
  const firmata = iscrizione({ registrationStatus: "confirmed", parentAuthorization: firma("authorized") });
  for (const cambio of [{ firstName: "Marcello" }, { lastName: "Bianchi" }, { firstName: "Luca", lastName: "Verdi" }]) {
    const piano = planAdminEdit(firmata, bozza(firmata, cambio), GENITORE_VUOTO, contesto(firmata));
    assert.deepEqual(piano.effects, [ISCRITTI.effettoNomeFirmato], JSON.stringify(cambio));
    assert.equal(piano.nextStatus, "confirmed");
  }
});

test("modifica riga 6: senza firma il cambio di nome non dice niente, e gli spazi non sono un cambio", () => {
  const nonFirmata = iscrizione();
  assert.deepEqual(
    planAdminEdit(nonFirmata, bozza(nonFirmata, { firstName: "Marcello" }), GENITORE_VUOTO, contesto(nonFirmata)).effects,
    [],
  );
  for (const stato of [firma("email_sent"), firma("rejected_by_parent"), null]) {
    const registrazione = iscrizione({ parentAuthorization: stato });
    assert.deepEqual(
      planAdminEdit(registrazione, bozza(registrazione, { lastName: "Bianchi" }), GENITORE_VUOTO, contesto(registrazione)).effects,
      [],
      JSON.stringify(stato),
    );
  }
  const firmata = iscrizione({ registrationStatus: "confirmed", parentAuthorization: firma("authorized") });
  assert.deepEqual(
    planAdminEdit(firmata, bozza(firmata, { firstName: " Marco ", lastName: "Rossi  " }), GENITORE_VUOTO, contesto(firmata)).effects,
    [],
  );
});

test("modifica riga 7: categoria giovane ↔ adulto con una stanza assegnata: ricontrolla il piano stanze", () => {
  const conStanza = iscrizione({ assignedRoomName: "Stanza 4" });
  const atteso = [fillCopy(ISCRITTI.effettoStanza, { stanza: "Stanza 4" })];
  for (const [da, a] of [
    ["giovane_uomo", "dirigente"],
    ["giovane_uomo", "accompagnatore"],
    ["giovane_donna", "dirigente"],
    ["dirigente", "giovane_donna"],
    ["accompagnatore", "giovane_uomo"],
  ]) {
    const registrazione = { ...conStanza, genderRoleCategory: da };
    const piano = planAdminEdit(registrazione, bozza(registrazione, { genderRoleCategory: a }), GENITORE_VUOTO, contesto(registrazione));
    assert.deepEqual(piano.effects, atteso, `${da} → ${a}`);
    assert.equal(piano.nextStatus, "active");
  }
});

test("modifica riga 7: nessun avviso senza stanza o restando nello stesso gruppo", () => {
  const senzaStanza = iscrizione({ assignedRoomName: null });
  assert.deepEqual(
    planAdminEdit(senzaStanza, bozza(senzaStanza, { genderRoleCategory: "dirigente" }), GENITORE_VUOTO, contesto(senzaStanza)).effects,
    [],
  );
  const conStanza = iscrizione({ assignedRoomName: "Stanza 4" });
  assert.deepEqual(
    planAdminEdit(conStanza, bozza(conStanza, { genderRoleCategory: "giovane_donna" }), GENITORE_VUOTO, contesto(conStanza)).effects,
    [],
    "da giovane uomo a giovane donna",
  );
  const dirigente = iscrizione({ assignedRoomName: "Stanza 4", genderRoleCategory: "dirigente" });
  assert.deepEqual(
    planAdminEdit(dirigente, bozza(dirigente, { genderRoleCategory: "accompagnatore" }), GENITORE_VUOTO, contesto(dirigente)).effects,
    [],
    "da dirigente ad accompagnatore",
  );
});

test("modifica riga 8: iscrizione legata a un account (user_, child_): il profilo non cambia", () => {
  for (const legame of [{ userId: "uid1" }, { parentUid: "parent1", childId: "child1" }]) {
    for (const cambio of [{ firstName: "Marcello" }, { unitId: "u2", unitName: "Rione Sud" }, { phone: "333" }, { email: "m@example.com" }, { birthDate: nascita(35) }, { genderRoleCategory: "dirigente" }]) {
      const registrazione = iscrizione({ ...legame });
      const piano = planAdminEdit(registrazione, bozza(registrazione, cambio), GENITORE_VUOTO, contesto(registrazione));
      assert.ok(
        piano.effects.includes(ISCRITTI.effettoProfilo),
        `${JSON.stringify(legame)} con ${JSON.stringify(cambio)}: ${JSON.stringify(piano.effects)}`,
      );
    }
  }
});

test("modifica riga 8: senza account, o senza nessun cambio, nessun avviso sul profilo", () => {
  const manuale = iscrizione();
  assert.ok(
    !planAdminEdit(manuale, bozza(manuale, { firstName: "Marcello" }), GENITORE_VUOTO, contesto(manuale)).effects.includes(
      ISCRITTI.effettoProfilo,
    ),
  );
  const ospite = iscrizione({ anonymousUid: "anon1" });
  assert.ok(
    !planAdminEdit(ospite, bozza(ospite, { firstName: "Marcello" }), GENITORE_VUOTO, contesto(ospite)).effects.includes(
      ISCRITTI.effettoProfilo,
    ),
  );
  const conAccount = iscrizione({ userId: "uid1" });
  assert.deepEqual(planAdminEdit(conAccount, bozza(conAccount), GENITORE_VUOTO, contesto(conAccount)).effects, []);
});

test("modifica: più cambi insieme danno un avviso per ciascuno", () => {
  const registrazione = iscrizione({
    userId: "uid1",
    assignedRoomName: "Stanza 4",
    registrationStatus: "confirmed",
    parentAuthorization: firma("authorized"),
  });
  const piano = planAdminEdit(
    registrazione,
    bozza(registrazione, { firstName: "Marcello", unitId: "u2", unitName: "Rione Sud", genderRoleCategory: "dirigente", birthDate: MINORE }),
    GENITORE_VUOTO,
    contesto(registrazione),
  );
  assert.deepEqual(
    new Set(piano.effects),
    new Set([
      ISCRITTI.effettoFirmaResta,
      fillCopy(ISCRITTI.effettoUnita, { nuova: "Rione Sud", vecchia: "Rione Nord" }),
      ISCRITTI.effettoNomeFirmato,
      fillCopy(ISCRITTI.effettoStanza, { stanza: "Stanza 4" }),
      ISCRITTI.effettoProfilo,
    ]),
  );
  assert.equal(piano.effects.length, 5, "nessun avviso ripetuto");
  assert.equal(piano.nextStatus, "confirmed");
});

test("modifica, annullata: cambiano solo i dati, mai stato, mail o richiesta del genitore", () => {
  for (const [prima, dopo] of [
    [ADULTO, MINORE],
    [MINORE, ADULTO],
  ]) {
    const registrazione = iscrizione({ birthDate: prima, registrationStatus: "cancelled" });
    const piano = planAdminEdit(registrazione, bozza(registrazione, { birthDate: dopo }), GENITORE_VUOTO, contesto(registrazione));
    assert.equal(piano.nextStatus, "cancelled", `${prima} → ${dopo}`);
    assert.equal(piano.sendsMail, false);
    assert.equal(piano.needsParentFields, false);
    assert.deepEqual(piano.effects, [], "nessun avviso su stato, mail o consensi");
  }
  const conEmail = conRichiesta(MAIL_GENITORE, { registrationStatus: "cancelled" });
  const pianoConEmail = planAdminEdit(conEmail, bozza(conEmail, { birthDate: MINORE }), genitore("altra@example.com"), contesto(conEmail));
  assert.equal(pianoConEmail.nextStatus, "cancelled");
  assert.equal(pianoConEmail.sendsMail, false);
  assert.ok(!pianoConEmail.effects.some((testo) => testo.includes("mail")));
});

test(
  "modifica: con la data svuotata o non valida il piano non promette niente",
  () => {
    const registrazione = conRichiesta(MAIL_GENITORE, { birthDate: MINORE, registrationStatus: ATTESA });
    for (const vuota of ["", "2008-1", "non-una-data"]) {
      const piano = planAdminEdit(registrazione, bozza(registrazione, { birthDate: vuota }), GENITORE_VUOTO, contesto(registrazione));
      assert.equal(piano.nextStatus, ATTESA, JSON.stringify(vuota));
      assert.deepEqual(piano.effects, [], JSON.stringify(vuota));
    }
  },
);

test("modifica: i testi degli avvisi sono quelli di ISCRITTI, con i segnaposto riempiti", () => {
  const casi = [
    planAdminEdit(iscrizione(), bozza(iscrizione(), { birthDate: MINORE }), genitore("g@example.com"), contesto(iscrizione())),
    planAdminEdit(iscrizione(), bozza(iscrizione(), { unitId: "u2", unitName: "Rione Sud" }), GENITORE_VUOTO, contesto(iscrizione())),
    planAdminEdit(
      iscrizione({ assignedRoomName: "Stanza 4" }),
      bozza(iscrizione(), { genderRoleCategory: "dirigente" }),
      GENITORE_VUOTO,
      contesto(iscrizione()),
    ),
  ];
  const valoriCopy = new Set(Object.values(ISCRITTI));
  for (const piano of casi) {
    assert.ok(piano.effects.length > 0);
    for (const testo of piano.effects) {
      assert.ok(!/\{\w+\}/u.test(testo), `segnaposto rimasto: ${testo}`);
      const ricostruibile =
        valoriCopy.has(testo) ||
        Object.values(ISCRITTI).some((modello) => /\{\w+\}/u.test(modello) && fillCopy(modello, { email: "g@example.com", nuova: "Rione Sud", vecchia: "Rione Nord", stanza: "Stanza 4" }) === testo);
      assert.ok(ricostruibile, `testo che non viene da ISCRITTI: ${testo}`);
    }
  }
});

test("modifica: lo stato proposto è sempre uno che le rules ammettono", () => {
  const stati = [
    ["active", null],
    [ATTESA, null],
    [ATTESA, firma("email_sent")],
    ["cancelled", null],
    ["confirmed", firma("authorized")],
    ["rejected_by_parent", firma("rejected_by_parent")],
  ];
  const date = ["", ADULTO, nascita(45), MINORE, nascita(17), nascita(18)];
  for (const [stato, autorizzazione] of stati) {
    for (const prima of date) {
      for (const dopo of date) {
        for (const richiede of [true, false]) {
          const registrazione = iscrizione({ birthDate: prima, registrationStatus: stato, parentAuthorization: autorizzazione });
          const piano = planAdminEdit(registrazione, bozza(registrazione, { birthDate: dopo }), genitore(), contesto(registrazione, { requiresParentAuthorization: richiede }));
          assert.ok(
            regoleAmmettonoStato({
              prima: stato,
              firmaPrima: autorizzazione?.status,
              dopo: piano.nextStatus,
              nascitaDopo: dopo,
              richiedeAutorizzazione: richiede,
            }),
            `${stato}, data «${prima}» → «${dopo}», richiede=${richiede}: «${piano.nextStatus}» non passa le rules`,
          );
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// buildAdminEditPatch
// ---------------------------------------------------------------------------

const patchDi = (registrazione, cambio, parent = GENITORE_VUOTO, opzioni = {}) => {
  const person = bozza(registrazione, cambio);
  const piano = planAdminEdit(registrazione, person, parent, contesto(registrazione, opzioni));
  return {
    piano,
    patch: buildAdminEditPatch({ registration: registrazione, person, parent, plan: piano, timestamp: TIMESTAMP }),
  };
};

test("patch di modifica: i campi della persona si scrivono sempre insieme", () => {
  const { patch } = patchDi(iscrizione(), {
    firstName: " Anna Maria ",
    lastName: " De Luca ",
    birthDate: nascita(28),
    genderRoleCategory: "giovane_donna",
    unitId: "u2",
    unitName: " Rione Sud ",
    email: " anna@example.com ",
    phone: " 333 ",
  });
  assert.deepEqual(patch, {
    firstName: "Anna Maria",
    lastName: "De Luca",
    fullName: "Anna Maria De Luca",
    email: "anna@example.com",
    phone: "333",
    birthDate: nascita(28),
    genderRoleCategory: "giovane_donna",
    unitId: "u2",
    unitNameSnapshot: "Rione Sud",
    "answers.birthDate": nascita(28),
    "answers.genderRoleCategory": "giovane_donna",
    "answers.youthGroup": "Giovani Donne",
    "answers.unitName": "Rione Sud",
    updatedAt: TIMESTAMP,
  });
});

test("patch di modifica: nome, unità, data e categoria hanno ciascuno le loro copie", () => {
  const { patch } = patchDi(iscrizione(), { firstName: "Luca", unitId: "u3", unitName: "Rione Est", genderRoleCategory: "dirigente" });
  assert.equal(patch.fullName, "Luca Rossi");
  assert.equal(patch.unitNameSnapshot, patch["answers.unitName"]);
  assert.equal(patch.birthDate, patch["answers.birthDate"]);
  assert.equal(patch.genderRoleCategory, patch["answers.genderRoleCategory"]);
  assert.equal(patch["answers.youthGroup"], "Dirigente");
});

test("patch di modifica: contiene solo chiavi che le rules ammettono all'admin", () => {
  assert.ok(ADMIN.chiavi.length >= 10, "lista admin non letta");
  const registrazioni = [
    iscrizione(),
    conRichiesta(MAIL_GENITORE),
    iscrizione({ birthDate: MINORE, registrationStatus: ATTESA }),
    iscrizione({ registrationStatus: "cancelled" }),
    iscrizione({ registrationStatus: "confirmed", parentAuthorization: firma("authorized") }),
  ];
  const cambi = [
    {},
    { birthDate: MINORE },
    { birthDate: nascita(40) },
    { unitId: "u2", unitName: "Rione Sud" },
    { firstName: "Luca", genderRoleCategory: "giovane_donna" },
  ];
  for (const registrazione of registrazioni) {
    for (const cambio of cambi) {
      for (const parent of [GENITORE_VUOTO, genitore()]) {
        const { patch } = patchDi(registrazione, cambio, parent);
        verificaChiaviPatch(patch, `${registrazione.registrationStatus} ${JSON.stringify(cambio)}`);
      }
    }
  }
});

test("patch di modifica: non tocca consensi, firma, titolare, autore, codici, assegnazioni e il vecchio status", () => {
  const { patch } = patchDi(iscrizione(), { birthDate: MINORE }, genitore());
  for (const chiave of Object.keys(patch)) {
    assert.ok(
      !/^(status|createdBy|createdAt|userId|anonymousUid|parentUid|childId|accessCode|recoveryCode|consent|parentConsent|parentId|assigned|linkedLater|parentAuthorization$)/u.test(chiave),
      chiave,
    );
    assert.ok(chiave !== "answers", "answers intero");
  }
});

test("patch di modifica: lo stato si scrive solo quando cambia", () => {
  const nessunCambio = patchDi(iscrizione(), { firstName: "Luca" });
  assert.equal("registrationStatus" in nessunCambio.patch, false);

  const versoAttesa = patchDi(conRichiesta(MAIL_GENITORE), { birthDate: MINORE });
  assert.equal(versoAttesa.patch.registrationStatus, ATTESA);

  const versoAttiva = patchDi(
    conRichiesta(MAIL_GENITORE, { birthDate: MINORE, registrationStatus: ATTESA }),
    { birthDate: ADULTO },
  );
  assert.equal(versoAttiva.patch.registrationStatus, "active");

  // Già in attesa e resta in attesa (minore → minore): niente scrittura dello stato.
  const restaInAttesa = patchDi(
    conRichiesta(MAIL_GENITORE, { birthDate: MINORE, registrationStatus: ATTESA }),
    { birthDate: nascita(14) },
  );
  assert.equal("registrationStatus" in restaInAttesa.patch, false);

  // Con la firma lo stato non cambia: né confermata né rifiutata si toccano.
  for (const [stato, autorizzazione] of [
    ["confirmed", firma("authorized")],
    ["rejected_by_parent", firma("rejected_by_parent")],
  ]) {
    const { patch } = patchDi(iscrizione({ registrationStatus: stato, parentAuthorization: autorizzazione }), { birthDate: MINORE });
    assert.equal("registrationStatus" in patch, false, stato);
  }

  // Annullata resta annullata.
  const annullata = patchDi(iscrizione({ registrationStatus: "cancelled" }), { birthDate: MINORE });
  assert.equal("registrationStatus" in annullata.patch, false);
});

test("patch di modifica: lo stato scritto passa la clausola sulle transizioni delle rules", () => {
  assert.ok(ADMIN.statiSempreAmmessi.includes("cancelled") && ADMIN.statiSempreAmmessi.includes(ATTESA));
  const date = ["", ADULTO, MINORE, nascita(17), nascita(18)];
  for (const stato of ["active", ATTESA, "cancelled", "confirmed", "rejected_by_parent"]) {
    const autorizzazione = stato === "confirmed" ? firma("authorized") : stato === "rejected_by_parent" ? firma("rejected_by_parent") : null;
    for (const prima of date) {
      for (const dopo of date) {
        const registrazione = iscrizione({ birthDate: prima, registrationStatus: stato, parentAuthorization: autorizzazione });
        const { patch } = patchDi(registrazione, { birthDate: dopo }, genitore());
        assert.ok(
          regoleAmmettonoStato({
            prima: stato,
            firmaPrima: autorizzazione?.status,
            dopo: patch.registrationStatus ?? stato,
            nascitaDopo: dopo,
            richiedeAutorizzazione: true,
          }),
          `${stato}, «${prima}» → «${dopo}»`,
        );
      }
    }
  }
});

test("patch di modifica: i dati del genitore si scrivono se servono e l'email è valida", () => {
  const { piano, patch } = patchDi(iscrizione(), { birthDate: MINORE }, genitore("  Nuova.Email@Example.COM ", { firstName: " Anna ", phone: " 333 " }));
  assert.equal(piano.needsParentFields, true);
  assert.equal(patch.registrationStatus, ATTESA);
  assert.equal(patch["answers.parentAuthorizationRequest.parentFirstName"], "Anna");
  assert.equal(patch["answers.parentAuthorizationRequest.parentLastName"], "Rossi");
  assert.equal(patch["answers.parentAuthorizationRequest.parentEmail"], "nuova.email@example.com");
  assert.equal(patch["answers.parentAuthorizationRequest.parentPhone"], "333");
  assert.equal(patch["answers.parentAuthorizationRequest.submittedAt"], TIMESTAMP);
  verificaChiaviPatch(patch, "con il genitore");
});

test("patch di modifica: senza email valida non si scrive nessuna richiesta, ma la persona va in attesa", () => {
  for (const parent of [GENITORE_VUOTO, genitore("non-una-email"), genitore("   ")]) {
    const { patch } = patchDi(iscrizione(), { birthDate: MINORE }, parent);
    assert.equal(patch.registrationStatus, ATTESA);
    assert.equal(Object.keys(patch).some((chiave) => chiave.startsWith("answers.parentAuthorizationRequest")), false);
  }
});

test("patch di modifica: con la richiesta già presente non la riscrive", () => {
  const { piano, patch } = patchDi(conRichiesta(MAIL_GENITORE), { birthDate: MINORE }, genitore("altra@example.com"));
  assert.equal(piano.needsParentFields, false);
  assert.equal(patch.registrationStatus, ATTESA);
  assert.equal(Object.keys(patch).some((chiave) => chiave.startsWith("answers.parentAuthorizationRequest")), false);
});

test("patch di modifica: i dati del genitore non si scrivono se la modifica non li chiede", () => {
  const { patch } = patchDi(iscrizione(), { firstName: "Luca" }, genitore());
  assert.equal(Object.keys(patch).some((chiave) => chiave.startsWith("answers.parentAuthorizationRequest")), false);
});

test("patch di modifica: non cambia i dati che riceve", () => {
  const registrazione = Object.freeze(iscrizione());
  const person = Object.freeze(bozza(registrazione, { birthDate: MINORE, firstName: " Luca " }));
  const parent = Object.freeze(genitore());
  const piano = planAdminEdit(registrazione, person, parent, contesto(registrazione));
  assert.doesNotThrow(() => buildAdminEditPatch({ registration: registrazione, person, parent, plan: piano, timestamp: TIMESTAMP }));
});

// ---------------------------------------------------------------------------
// parentRequestPatch, buildRequestAuthorizationPatch
// ---------------------------------------------------------------------------

const CHIAVI_RICHIESTA = [
  "answers.parentAuthorizationRequest.parentEmail",
  "answers.parentAuthorizationRequest.parentFirstName",
  "answers.parentAuthorizationRequest.parentLastName",
  "answers.parentAuthorizationRequest.parentPhone",
  "answers.parentAuthorizationRequest.submittedAt",
];

test("parentRequestPatch: cinque chiavi puntate, email in minuscolo, valori senza spazi ai bordi", () => {
  const patch = parentRequestPatch(genitore("  Anna.Rossi@Example.COM ", { firstName: " Anna ", lastName: " Rossi ", phone: " 333 1234567 " }), TIMESTAMP);
  assert.deepEqual(Object.keys(patch).sort(), CHIAVI_RICHIESTA);
  assert.deepEqual(patch, {
    "answers.parentAuthorizationRequest.parentFirstName": "Anna",
    "answers.parentAuthorizationRequest.parentLastName": "Rossi",
    "answers.parentAuthorizationRequest.parentEmail": "anna.rossi@example.com",
    "answers.parentAuthorizationRequest.parentPhone": "333 1234567",
    "answers.parentAuthorizationRequest.submittedAt": TIMESTAMP,
  });
  verificaChiaviPatch(patch, "parentRequestPatch");
});

test("buildRequestAuthorizationPatch: da un'iscrizione già in attesa non tocca lo stato", () => {
  const patch = buildRequestAuthorizationPatch({ registrationStatus: ATTESA }, genitore("G@Example.com"), TIMESTAMP);
  assert.equal("registrationStatus" in patch, false);
  assert.deepEqual(Object.keys(patch).sort(), [...CHIAVI_RICHIESTA, "updatedAt"].sort());
  assert.equal(patch["answers.parentAuthorizationRequest.parentEmail"], "g@example.com");
  assert.equal(patch.updatedAt, TIMESTAMP);
  verificaChiaviPatch(patch, "chiedi autorizzazione");
});

test("buildRequestAuthorizationPatch: da ogni altro stato porta in attesa del genitore", () => {
  for (const stato of ["active", "cancelled", "confirmed", "rejected_by_parent"]) {
    const patch = buildRequestAuthorizationPatch({ registrationStatus: stato }, genitore(), TIMESTAMP);
    assert.equal(patch.registrationStatus, ATTESA, stato);
    assert.deepEqual(Object.keys(patch).sort(), [...CHIAVI_RICHIESTA, "registrationStatus", "updatedAt"].sort(), stato);
    verificaChiaviPatch(patch, `chiedi autorizzazione da ${stato}`);
  }
});

test("buildRequestAuthorizationPatch: stessa richiesta di parentRequestPatch, senza toccare il resto del modulo", () => {
  const parent = genitore(" X@Y.it ");
  const patch = buildRequestAuthorizationPatch({ registrationStatus: ATTESA }, parent, TIMESTAMP);
  for (const [chiave, valore] of Object.entries(parentRequestPatch(parent, TIMESTAMP))) {
    assert.equal(patch[chiave], valore, chiave);
  }
  assert.equal("answers" in patch, false, "il modulo non si riscrive per intero");
  assert.equal(Object.keys(patch).some((chiave) => /medical|allerg|farmac|emergenc/iu.test(chiave)), false);
});

// ---------------------------------------------------------------------------
// planAdminReactivate
// ---------------------------------------------------------------------------

test("riattiva: un adulto torna attivo, senza mail", () => {
  for (const richiede of [true, false]) {
    for (const registrazione of [iscrizione({ registrationStatus: "cancelled" }), conRichiesta(MAIL_GENITORE, { registrationStatus: "cancelled" })]) {
      assert.deepEqual(planAdminReactivate(registrazione, richiede), {
        status: "active",
        sendsMail: false,
        reopensRejection: false,
      });
    }
  }
});

test("riattiva: meno di 18 anni senza firma e senza email nella richiesta: in attesa, nessuna mail", () => {
  for (const autorizzazione of [null, firma("email_sent"), firma("expired")]) {
    const registrazione = iscrizione({ birthDate: MINORE, registrationStatus: "cancelled", parentAuthorization: autorizzazione });
    assert.deepEqual(planAdminReactivate(registrazione, true), {
      status: ATTESA,
      sendsMail: false,
      reopensRejection: false,
    });
  }
});

test("riattiva: meno di 18 anni senza firma e con l'email nella richiesta: in attesa e parte la mail", () => {
  for (const autorizzazione of [null, firma("email_sent"), firma("expired"), firma("failed")]) {
    const registrazione = conRichiesta(MAIL_GENITORE, { birthDate: MINORE, registrationStatus: "cancelled", parentAuthorization: autorizzazione });
    assert.deepEqual(planAdminReactivate(registrazione, true), {
      status: ATTESA,
      sendsMail: true,
      reopensRejection: false,
    });
  }
});

test("riattiva: con il modulo già firmato torna attiva, anche se ha meno di 18 anni", () => {
  const registrazione = conRichiesta(MAIL_GENITORE, {
    birthDate: MINORE,
    registrationStatus: "cancelled",
    parentAuthorization: firma("authorized"),
  });
  assert.deepEqual(planAdminReactivate(registrazione, true), {
    status: "active",
    sendsMail: false,
    reopensRejection: false,
  });
});

test("riattiva: se il genitore aveva rifiutato e c'è l'email, la mail nuova riapre il rifiuto", () => {
  const registrazione = conRichiesta(MAIL_GENITORE, {
    birthDate: MINORE,
    registrationStatus: "cancelled",
    parentAuthorization: firma("rejected_by_parent"),
  });
  assert.deepEqual(planAdminReactivate(registrazione, true), {
    status: ATTESA,
    sendsMail: true,
    reopensRejection: true,
  });
});

test("riattiva: rifiutato ma senza email: in attesa, niente mail e niente rifiuto da riaprire", () => {
  const registrazione = iscrizione({
    birthDate: MINORE,
    registrationStatus: "cancelled",
    parentAuthorization: firma("rejected_by_parent"),
  });
  assert.deepEqual(planAdminReactivate(registrazione, true), {
    status: ATTESA,
    sendsMail: false,
    reopensRejection: false,
  });
});

test("riattiva: in un'attività senza autorizzazione torna sempre attiva", () => {
  for (const autorizzazione of [null, firma("rejected_by_parent"), firma("email_sent")]) {
    const registrazione = conRichiesta(MAIL_GENITORE, { birthDate: MINORE, registrationStatus: "cancelled", parentAuthorization: autorizzazione });
    assert.deepEqual(planAdminReactivate(registrazione, false), {
      status: "active",
      sendsMail: false,
      reopensRejection: false,
    });
  }
});

test("riattiva: chi compie 18 anni oggi non ha bisogno del genitore", () => {
  const registrazione = conRichiesta(MAIL_GENITORE, { birthDate: nascita(18), registrationStatus: "cancelled" });
  assert.equal(planAdminReactivate(registrazione, true).status, "active");
});

test("riattiva: lo stato proposto è sempre uno che le rules ammettono", () => {
  const autorizzazioni = [null, firma("email_sent"), firma("authorized"), firma("rejected_by_parent")];
  for (const data of ["", ADULTO, MINORE, nascita(17), nascita(18)]) {
    for (const autorizzazione of autorizzazioni) {
      for (const richiede of [true, false]) {
        for (const registrazione of [
          iscrizione({ birthDate: data, registrationStatus: "cancelled", parentAuthorization: autorizzazione }),
          conRichiesta(MAIL_GENITORE, { birthDate: data, registrationStatus: "cancelled", parentAuthorization: autorizzazione }),
        ]) {
          const piano = planAdminReactivate(registrazione, richiede);
          assert.ok(
            regoleAmmettonoStato({
              prima: "cancelled",
              firmaPrima: autorizzazione?.status,
              dopo: piano.status,
              nascitaDopo: data,
              richiedeAutorizzazione: richiede,
            }),
            `data «${data}», ${autorizzazione?.status ?? "nessuna"}, richiede=${richiede}: «${piano.status}»`,
          );
          assert.ok(!piano.reopensRejection || piano.sendsMail, "il rifiuto si riapre solo se parte una mail");
        }
      }
    }
  }
});
