import test from "node:test";
import assert from "node:assert/strict";

import { CHI_ISCRIVI } from "../src/copy/chiIscrivi.ts";
import {
  ADULT_GUARD_AGE,
  MIN_YOUTH_AGE,
  applyChildIdentity,
  describeAgeAtActivity,
  getActivityFirstDay,
  getAvatarTone,
  getBlockedReasonText,
  getChildAgeWarning,
  getChildAgeWarningText,
  getChildChoiceState,
  getChildFormInitial,
  getInitialChildChoice,
  getInitials,
  getParentEmailAddress,
  getParentEmailOutcome,
  getRegisterDraftKey,
  getRegisteredLabel,
  validateChildForm,
} from "../src/utils/childChoice.ts";

// "Chi iscrivi?" e "Iscrizione inviata" (docs/FLUSSO_GENITORE.md, E, F, H,
// "Utente che sbaglia", scelta G1): stato della scheda di ogni figlio, età il
// primo giorno dell'attività e avvisi morbidi, chiave delle bozze, esito della
// mail di autorizzazione, modulo del figlio.
//
// I valori attesi vengono dalla spec, non dal codice: dove la spec scrive un
// testo (per esempio "Attività solo per Giovani Donne"), il test lo scrive per
// intero invece di rileggerlo da `CHI_ISCRIVI`.
//
// Le date si costruiscono con `new Date(anno, mese, giorno, ora)` locali: i casi
// valgono in qualunque fuso giri il processo.
//
// Comando: node --test tests/childChoice.test.mjs

const sameInstant = (actual, expected, message) =>
  assert.equal(actual.getTime(), expected.getTime(), `${message ?? ""} atteso ${expected.toString()}, avuto ${actual.toString()}`);

// Primo giorno di un'attività di esempio: sabato 24 aprile 2027 (spec, G).
const FIRST_DAY = new Date(2027, 3, 24);

// ---------------------------------------------------------------------------
// getActivityFirstDay
// ---------------------------------------------------------------------------

test("getActivityFirstDay: un giorno nudo «YYYY-MM-DD» è il giorno locale, a mezzanotte", () => {
  const fallback = new Date(2026, 9, 19, 15, 45);

  sameInstant(getActivityFirstDay("2027-04-24", fallback), new Date(2027, 3, 24));
  sameInstant(getActivityFirstDay("2027-01-01", fallback), new Date(2027, 0, 1));
  sameInstant(getActivityFirstDay("2027-12-31", fallback), new Date(2027, 11, 31));
});

test("getActivityFirstDay: un istante ISO dà il giorno locale di quell'istante", () => {
  const fallback = new Date(2026, 9, 19, 15, 45);

  // Ore diverse dello stesso giorno locale, comprese quelle vicine alla
  // mezzanotte che in UTC cadono nel giorno prima o in quello dopo.
  for (const hour of [0, 1, 7, 12, 22, 23]) {
    const iso = new Date(2027, 3, 24, hour, 30).toISOString();
    sameInstant(getActivityFirstDay(iso, fallback), new Date(2027, 3, 24), `istante ${iso} (ore ${hour}:30 locali)`);
  }

  // Ultimo minuto dell'anno e primo minuto dell'anno dopo.
  sameInstant(getActivityFirstDay(new Date(2027, 11, 31, 23, 59).toISOString(), fallback), new Date(2027, 11, 31));
  sameInstant(getActivityFirstDay(new Date(2028, 0, 1, 0, 1).toISOString(), fallback), new Date(2028, 0, 1));
});

test("getActivityFirstDay: data vuota o non valida → il giorno di fallback, a mezzanotte", () => {
  const fallback = new Date(2026, 9, 19, 15, 45, 12, 345);
  const fallbackTime = fallback.getTime();

  for (const value of [null, undefined, "", "   ", "non è una data", "24/04/2027", "domani"]) {
    sameInstant(getActivityFirstDay(value, fallback), new Date(2026, 9, 19), `startDate=${JSON.stringify(value)}`);
  }

  // Il fallback ricevuto non si modifica.
  assert.equal(fallback.getTime(), fallbackTime);
});

test("getActivityFirstDay: un giorno nudo impossibile (30 febbraio, mese 13) è invalido → fallback", () => {
  const fallback = new Date(2026, 9, 19, 15, 45);

  for (const value of ["2027-02-30", "2027-13-01", "2027-00-10", "2027-04-31"]) {
    sameInstant(getActivityFirstDay(value, fallback), new Date(2026, 9, 19), `startDate=${JSON.stringify(value)}`);
  }
});

// ---------------------------------------------------------------------------
// describeAgeAtActivity
// ---------------------------------------------------------------------------

test("describeAgeAtActivity: «14 anni ad aprile», l'età il primo giorno con il mese", () => {
  assert.equal(describeAgeAtActivity("2013-01-10", FIRST_DAY), "14 anni ad aprile");
});

test("describeAgeAtActivity: tutti e 12 i mesi con la preposizione giusta (ad solo davanti ad aprile e agosto)", () => {
  const expected = [
    "a gennaio",
    "a febbraio",
    "a marzo",
    "ad aprile",
    "a maggio",
    "a giugno",
    "a luglio",
    "ad agosto",
    "a settembre",
    "a ottobre",
    "a novembre",
    "a dicembre",
  ];

  // Nato il 31 dicembre 2012: il 15 di ogni mese del 2027 ha 14 anni.
  expected.forEach((month, index) => {
    assert.equal(
      describeAgeAtActivity("2012-12-31", new Date(2027, index, 15)),
      `14 anni ${month}`,
      `mese ${index + 1}`,
    );
  });
});

test("describeAgeAtActivity: compleanno proprio il primo giorno → compie gli anni quel giorno, età nuova", () => {
  assert.equal(describeAgeAtActivity("2013-04-24", FIRST_DAY), "14 anni ad aprile");
  // Il giorno dopo il primo giorno: ancora l'età di prima.
  assert.equal(describeAgeAtActivity("2013-04-25", FIRST_DAY), "13 anni ad aprile");
  // Compleanno il primo gennaio, attività il primo gennaio.
  assert.equal(describeAgeAtActivity("2013-01-01", new Date(2027, 0, 1)), "14 anni a gennaio");
});

test("describeAgeAtActivity: data di nascita mancante o invalida → null", () => {
  for (const value of [null, undefined, "", "   ", "abc", "2013-02-30", "2013-13-01", "24/04/2013", "2013-4-24"]) {
    assert.equal(describeAgeAtActivity(value, FIRST_DAY), null, `birthDate=${JSON.stringify(value)}`);
  }
});

// ---------------------------------------------------------------------------
// getChildAgeWarning / getChildAgeWarningText (G1: 19 anni il primo giorno)
// ---------------------------------------------------------------------------

test("soglie: 11 anni per le attività GU e GD, guardia adulto a 19 (G1)", () => {
  assert.equal(MIN_YOUTH_AGE, 11);
  assert.equal(ADULT_GUARD_AGE, 19);
});

test("getChildAgeWarning: sotto 11 anni il primo giorno → «sotto11»", () => {
  // Compie 11 anni il giorno dopo il primo giorno: ha ancora 10 anni.
  assert.equal(getChildAgeWarning("2016-04-25", FIRST_DAY), "sotto11");
  assert.equal(getChildAgeWarning("2020-06-01", FIRST_DAY), "sotto11");
});

test("getChildAgeWarning: 11 anni esatti il primo giorno → nessun avviso", () => {
  assert.equal(getChildAgeWarning("2016-04-24", FIRST_DAY), null);
  assert.equal(getChildAgeWarning("2014-09-01", FIRST_DAY), null);
});

test("getChildAgeWarning: 18 anni → nessun avviso (ancora nei giovani)", () => {
  // 18 anni compiuti proprio il primo giorno.
  assert.equal(getChildAgeWarning("2009-04-24", FIRST_DAY), null);
  // 18 anni e 364 giorni: compie 19 anni il giorno dopo.
  assert.equal(getChildAgeWarning("2008-04-25", FIRST_DAY), null);
});

test("getChildAgeWarning: 19 anni compiuti il primo giorno → «maggiorenne» (G1)", () => {
  assert.equal(getChildAgeWarning("2008-04-24", FIRST_DAY), "maggiorenne");
  assert.equal(getChildAgeWarning("2008-04-23", FIRST_DAY), "maggiorenne");
  assert.equal(getChildAgeWarning("1980-01-01", FIRST_DAY), "maggiorenne");
});

test("getChildAgeWarning: conta il primo giorno dell'attività, non oggi", () => {
  // Nato il 1° giugno 2008: 18 anni ad aprile 2027, 19 a luglio 2027.
  assert.equal(getChildAgeWarning("2008-06-01", FIRST_DAY), null);
  assert.equal(getChildAgeWarning("2008-06-01", new Date(2027, 6, 1)), "maggiorenne");

  // Composizione con getActivityFirstDay: oggi (19 ottobre 2026) ha 18 anni,
  // al primo giorno dell'attività ne ha 19.
  const today = new Date(2026, 9, 19, 10);
  const firstDay = getActivityFirstDay(new Date(2027, 3, 24, 9).toISOString(), today);
  assert.equal(getChildAgeWarning("2008-01-01", firstDay), "maggiorenne");
  // Senza data dell'attività vale il giorno di fallback: 18 anni, nessun avviso.
  assert.equal(getChildAgeWarning("2008-01-01", getActivityFirstDay("", today)), null);
});

test("getChildAgeWarning: data di nascita mancante o invalida → nessun avviso", () => {
  for (const value of [null, undefined, "", "abc", "2013-02-30"]) {
    assert.equal(getChildAgeWarning(value, FIRST_DAY), null, `birthDate=${JSON.stringify(value)}`);
  }
});

test("getChildAgeWarningText: sotto 11 → il testo della spec", () => {
  const child = { firstName: "Luca", fullName: "Luca Rossi", genderRoleCategory: "giovane_uomo" };
  assert.equal(getChildAgeWarningText("sotto11", child), CHI_ISCRIVI.sotto11);
  assert.equal(CHI_ISCRIVI.sotto11, "Le attività GU e GD sono dagli 11 anni: controlla la data.");
});

test("getChildAgeWarningText: maggiorenne con il nome, «da sola» per una giovane donna, «da solo» altrimenti", () => {
  assert.equal(
    getChildAgeWarningText("maggiorenne", { firstName: "Giulia", fullName: "Giulia Rossi", genderRoleCategory: "giovane_donna" }),
    "Giulia è maggiorenne: può iscriversi da sola con il suo account.",
  );
  assert.equal(
    getChildAgeWarningText("maggiorenne", { firstName: "Marco", fullName: "Marco Rossi", genderRoleCategory: "giovane_uomo" }),
    "Marco è maggiorenne: può iscriversi da solo con il suo account.",
  );
  // Gruppo non ancora scelto: forma maschile, come la spec ("figlio o figlia" → da solo).
  assert.equal(
    getChildAgeWarningText("maggiorenne", { firstName: "Andrea", fullName: "Andrea Rossi", genderRoleCategory: "" }),
    "Andrea è maggiorenne: può iscriversi da solo con il suo account.",
  );
});

test("getChildAgeWarningText: senza nome di battesimo il testo ha comunque un nome, mai il segnaposto", () => {
  const text = getChildAgeWarningText("maggiorenne", { firstName: "", fullName: "Marco Rossi", genderRoleCategory: "giovane_uomo" });
  assert.ok(text.includes("Marco"), text);
  assert.ok(!text.includes("{nome}"), text);
});

test("getChildAgeWarningText: nessun avviso → null", () => {
  assert.equal(getChildAgeWarningText(null, { firstName: "Marco", fullName: "Marco Rossi", genderRoleCategory: "giovane_uomo" }), null);
});

// ---------------------------------------------------------------------------
// getChildChoiceState / getBlockedReasonText / getRegisteredLabel
// ---------------------------------------------------------------------------

const GU = { genderRoleCategory: "giovane_uomo" };
const GD = { genderRoleCategory: "giovane_donna" };
const NO_GROUP = { genderRoleCategory: "" };
const AUDIENCES = ["congiunta", "giovane_uomo", "giovane_donna"];
const LIVE_STATUSES = [
  "draft",
  "submitted",
  "confirmed",
  "waitlist",
  "active",
  "pending_parent_authorization",
  "rejected_by_parent",
];

test("getChildChoiceState: iscrizione non annullata, in qualunque stato → «Già iscritto», mai un doppione", () => {
  for (const registrationStatus of LIVE_STATUSES) {
    for (const audience of AUDIENCES) {
      for (const child of [GU, GD, NO_GROUP]) {
        assert.deepEqual(
          getChildChoiceState(child, { audience }, { registrationStatus }),
          { kind: "registered" },
          `${registrationStatus}, attività ${audience}, figlio ${child.genderRoleCategory || "senza gruppo"}`,
        );
      }
    }
  }
});

test("getChildChoiceState: iscrizione annullata o assente → conta solo il pubblico dell'attività", () => {
  for (const registration of [null, undefined, { registrationStatus: "cancelled" }]) {
    const label = JSON.stringify(registration ?? null);
    assert.deepEqual(getChildChoiceState(GU, { audience: "congiunta" }, registration), { kind: "selectable" }, label);
    assert.deepEqual(getChildChoiceState(GD, { audience: "congiunta" }, registration), { kind: "selectable" }, label);
    assert.deepEqual(getChildChoiceState(GU, { audience: "giovane_uomo" }, registration), { kind: "selectable" }, label);
    assert.deepEqual(getChildChoiceState(GD, { audience: "giovane_donna" }, registration), { kind: "selectable" }, label);
  }
});

test("getChildChoiceState: attività solo GD e figlio giovane uomo → bloccata «solo_gd»", () => {
  assert.deepEqual(getChildChoiceState(GU, { audience: "giovane_donna" }, null), { kind: "blocked", reason: "solo_gd" });
  assert.deepEqual(
    getChildChoiceState(GU, { audience: "giovane_donna" }, { registrationStatus: "cancelled" }),
    { kind: "blocked", reason: "solo_gd" },
  );
});

test("getChildChoiceState: attività solo GU e figlia → bloccata «solo_gu»", () => {
  assert.deepEqual(getChildChoiceState(GD, { audience: "giovane_uomo" }, null), { kind: "blocked", reason: "solo_gu" });
  assert.deepEqual(
    getChildChoiceState(GD, { audience: "giovane_uomo" }, { registrationStatus: "cancelled" }),
    { kind: "blocked", reason: "solo_gu" },
  );
});

test("getChildChoiceState: figlio senza gruppo su un'attività riservata → bloccata «gruppo»", () => {
  assert.deepEqual(getChildChoiceState(NO_GROUP, { audience: "giovane_uomo" }, null), { kind: "blocked", reason: "gruppo" });
  assert.deepEqual(getChildChoiceState(NO_GROUP, { audience: "giovane_donna" }, null), { kind: "blocked", reason: "gruppo" });
});

test("getChildChoiceState: attività congiunta → selezionabile anche senza gruppo", () => {
  assert.deepEqual(getChildChoiceState(NO_GROUP, { audience: "congiunta" }, null), { kind: "selectable" });
  assert.deepEqual(
    getChildChoiceState(NO_GROUP, { audience: "congiunta" }, { registrationStatus: "cancelled" }),
    { kind: "selectable" },
  );
});

test("getBlockedReasonText: il motivo scritto sulla scheda", () => {
  assert.equal(getBlockedReasonText("solo_gd"), "Attività solo per Giovani Donne");
  assert.equal(getBlockedReasonText("solo_gu"), "Attività solo per Giovani Uomini");
  assert.equal(getBlockedReasonText("gruppo"), CHI_ISCRIVI.gruppoMancante);
  // I tre motivi hanno tre testi diversi.
  assert.equal(new Set(["solo_gd", "solo_gu", "gruppo"].map(getBlockedReasonText)).size, 3);
});

test("getRegisteredLabel: «Già iscritta» per una giovane donna, «Già iscritto» altrimenti", () => {
  assert.equal(getRegisteredLabel(GD), "Già iscritta");
  assert.equal(getRegisteredLabel(GU), "Già iscritto");
  assert.equal(getRegisteredLabel(NO_GROUP), "Già iscritto");
});

// ---------------------------------------------------------------------------
// getInitialChildChoice
// ---------------------------------------------------------------------------

const SELECTABLE = { kind: "selectable" };
const REGISTERED = { kind: "registered" };
const BLOCKED = { kind: "blocked", reason: "solo_gd" };
const item = (childId, state) => ({ childId, state });

test("getInitialChildChoice: la scelta di prima resta se è ancora selezionabile", () => {
  const states = [item("marco", SELECTABLE), item("giulia", SELECTABLE)];
  assert.equal(getInitialChildChoice(states, "giulia"), "giulia");
  assert.equal(getInitialChildChoice(states, "marco"), "marco");
});

test("getInitialChildChoice: la scelta di prima non resta se ora è iscritta, bloccata o sparita", () => {
  // Marco nel frattempo è iscritto: resta solo Giulia, scelta da sola.
  assert.equal(getInitialChildChoice([item("marco", REGISTERED), item("giulia", SELECTABLE)], "marco"), "giulia");
  // Marco è bloccato e gli altri due sono selezionabili: nessuna scelta.
  assert.equal(
    getInitialChildChoice([item("marco", BLOCKED), item("giulia", SELECTABLE), item("anna", SELECTABLE)], "marco"),
    null,
  );
  // Figlio cancellato da Famiglia.
  assert.equal(getInitialChildChoice([item("giulia", SELECTABLE), item("anna", SELECTABLE)], "marco"), null);
  // Nessuno selezionabile.
  assert.equal(getInitialChildChoice([item("marco", REGISTERED), item("giulia", BLOCKED)], "marco"), null);
});

test("getInitialChildChoice: un solo figlio selezionabile → scelto da solo", () => {
  assert.equal(getInitialChildChoice([item("marco", SELECTABLE)], null), "marco");
  assert.equal(getInitialChildChoice([item("marco", SELECTABLE)], undefined), "marco");
  assert.equal(getInitialChildChoice([item("marco", SELECTABLE)], ""), "marco");
  // Registrati e bloccati non contano.
  assert.equal(
    getInitialChildChoice([item("marco", REGISTERED), item("giulia", SELECTABLE), item("anna", BLOCKED)], null),
    "giulia",
  );
});

test("getInitialChildChoice: due o più selezionabili senza scelta di prima → nessuna scelta (telefono di famiglia)", () => {
  assert.equal(getInitialChildChoice([item("marco", SELECTABLE), item("giulia", SELECTABLE)], null), null);
  assert.equal(
    getInitialChildChoice([item("marco", SELECTABLE), item("giulia", SELECTABLE), item("anna", REGISTERED)], undefined),
    null,
  );
});

test("getInitialChildChoice: nessun figlio, o solo iscritti e bloccati → nessuna scelta", () => {
  assert.equal(getInitialChildChoice([], null), null);
  assert.equal(getInitialChildChoice([item("marco", REGISTERED)], null), null);
  assert.equal(getInitialChildChoice([item("giulia", BLOCKED)], null), null);
  assert.equal(getInitialChildChoice([item("marco", REGISTERED), item("giulia", BLOCKED)], "giulia"), null);
});

// ---------------------------------------------------------------------------
// getRegisterDraftKey
// ---------------------------------------------------------------------------

test("getRegisterDraftKey: stessi dati → stessa chiave", () => {
  const input = { uid: "uid-paola", stakeId: "roma-est", eventId: "campo-2027", childId: "marco" };
  assert.equal(getRegisterDraftKey(input), getRegisterDraftKey({ ...input }));
  assert.equal(
    getRegisterDraftKey({ uid: "uid-paola", stakeId: "roma-est", eventId: "campo-2027" }),
    getRegisterDraftKey({ uid: "uid-paola", stakeId: "roma-est", eventId: "campo-2027", childId: null }),
  );
});

test("getRegisterDraftKey: figli diversi, «io», account, attività e palo diversi → chiavi diverse", () => {
  const base = { uid: "uid-paola", stakeId: "roma-est", eventId: "campo-2027" };
  const variants = [
    { ...base, childId: "marco" },
    { ...base, childId: "giulia" },
    { ...base, childId: null },
    // Un figlio con id "io" non prende la bozza di chi partecipa.
    { ...base, childId: "io" },
    { ...base, uid: "uid-luca", childId: "marco" },
    { ...base, uid: "uid-luca", childId: null },
    { ...base, eventId: "tempio-2027", childId: "marco" },
    { ...base, eventId: "tempio-2027", childId: null },
    { ...base, stakeId: "roma-ovest", childId: "marco" },
    { ...base, stakeId: "roma-ovest", childId: null },
  ];
  const keys = variants.map(getRegisterDraftKey);
  assert.equal(new Set(keys).size, variants.length, `chiavi uguali fra: ${JSON.stringify(keys)}`);
});

test("getRegisterDraftKey: senza figlio (null, undefined o vuoto) è la bozza di «io»", () => {
  const base = { uid: "uid-paola", stakeId: "roma-est", eventId: "campo-2027" };
  const io = getRegisterDraftKey({ ...base, childId: null });
  assert.equal(getRegisterDraftKey({ ...base }), io);
  assert.equal(getRegisterDraftKey({ ...base, childId: undefined }), io);
  assert.equal(getRegisterDraftKey({ ...base, childId: "" }), io);
  assert.notEqual(getRegisterDraftKey({ ...base, childId: "marco" }), io);
});

test("getRegisterDraftKey: da Marco a Giulia e di nuovo a Marco si ritrova la bozza di Marco", () => {
  const base = { uid: "uid-paola", stakeId: "roma-est", eventId: "campo-2027" };
  const drafts = new Map();
  drafts.set(getRegisterDraftKey({ ...base, childId: "marco" }), { allergie: "arachidi" });

  // Giulia non vede i dati sanitari di Marco.
  assert.equal(drafts.get(getRegisterDraftKey({ ...base, childId: "giulia" })), undefined);
  drafts.set(getRegisterDraftKey({ ...base, childId: "giulia" }), { allergie: "" });

  assert.deepEqual(drafts.get(getRegisterDraftKey({ ...base, childId: "marco" })), { allergie: "arachidi" });
  // Un altro account sullo stesso telefono non la vede.
  assert.equal(drafts.get(getRegisterDraftKey({ ...base, uid: "uid-marco", childId: "marco" })), undefined);
});

// ---------------------------------------------------------------------------
// getParentEmailOutcome / getParentEmailAddress
// ---------------------------------------------------------------------------

const makeAuthorization = (overrides = {}) => ({
  status: "pending_parent_authorization",
  parentEmail: "",
  brevoMessageId: null,
  selfTokenIssuedAt: null,
  ...overrides,
});

const pending = (authorization) => ({
  registrationStatus: "pending_parent_authorization",
  parentAuthorization: authorization,
});

test("getParentEmailOutcome: nessuna iscrizione → none", () => {
  assert.equal(getParentEmailOutcome(null), "none");
  assert.equal(getParentEmailOutcome(undefined), "none");
});

test("getParentEmailOutcome: iscrizione confermata o autorizzazione firmata → authorized", () => {
  assert.equal(getParentEmailOutcome({ registrationStatus: "confirmed", parentAuthorization: null }), "authorized");
  assert.equal(
    getParentEmailOutcome({ registrationStatus: "confirmed", parentAuthorization: makeAuthorization({ status: "email_error" }) }),
    "authorized",
  );
  assert.equal(getParentEmailOutcome(pending(makeAuthorization({ status: "authorized" }))), "authorized");
  // La firma vince anche su un "Autorizza ora" emesso prima.
  assert.equal(
    getParentEmailOutcome(pending(makeAuthorization({ status: "authorized", selfTokenIssuedAt: "2026-10-19T10:00:00.000Z" }))),
    "authorized",
  );
  assert.equal(
    getParentEmailOutcome({ registrationStatus: "active", parentAuthorization: makeAuthorization({ status: "authorized" }) }),
    "authorized",
  );
});

test("getParentEmailOutcome: iscrizione attiva senza autorizzazione da dare → none", () => {
  assert.equal(getParentEmailOutcome({ registrationStatus: "active", parentAuthorization: null }), "none");
  assert.equal(
    getParentEmailOutcome({
      registrationStatus: "active",
      parentAuthorization: makeAuthorization({ status: "email_sent", brevoMessageId: "msg-1" }),
    }),
    "none",
  );
  assert.equal(getParentEmailOutcome({ registrationStatus: "active", parentAuthorization: makeAuthorization({ status: "not_required" }) }), "none");
});

test("getParentEmailOutcome: dopo «Autorizza ora» → self, anche se la mail era fallita o partita", () => {
  const issuedAt = "2026-10-19T10:00:00.000Z";
  for (const overrides of [
    { status: "email_error" },
    { status: "email_sent", brevoMessageId: "msg-1" },
    { status: "email_sent", brevoMessageId: null },
    { status: "pending_parent_authorization" },
  ]) {
    assert.equal(
      getParentEmailOutcome(pending(makeAuthorization({ ...overrides, selfTokenIssuedAt: issuedAt }))),
      "self",
      JSON.stringify(overrides),
    );
  }
});

test("getParentEmailOutcome: mail fallita → failed", () => {
  assert.equal(getParentEmailOutcome(pending(makeAuthorization({ status: "email_error" }))), "failed");
  assert.equal(
    getParentEmailOutcome(pending(makeAuthorization({ status: "email_error", selfTokenIssuedAt: null }))),
    "failed",
  );
});

test("getParentEmailOutcome: mail partita con l'id del provider → sent", () => {
  assert.equal(getParentEmailOutcome(pending(makeAuthorization({ status: "email_sent", brevoMessageId: "msg-1" }))), "sent");
});

test("getParentEmailOutcome: invio non ancora confermato → sending, mai «abbiamo scritto»", () => {
  // email_sent senza id del messaggio: non è una conferma.
  assert.equal(getParentEmailOutcome(pending(makeAuthorization({ status: "email_sent", brevoMessageId: null }))), "sending");
  assert.equal(getParentEmailOutcome(pending(makeAuthorization({ status: "email_sent", brevoMessageId: "" }))), "sending");
  // Il trigger non ha ancora scritto niente.
  assert.equal(getParentEmailOutcome(pending(makeAuthorization({ status: "pending_parent_authorization" }))), "sending");
  assert.equal(getParentEmailOutcome(pending(makeAuthorization({ status: "pending_request" }))), "sending");
  assert.equal(getParentEmailOutcome(pending(null)), "sending");
  assert.equal(getParentEmailOutcome({ registrationStatus: "pending_parent_authorization" }), "sending");
});

test("getParentEmailOutcome: iscrizioni annullate, rifiutate o in bozza senza firma → none", () => {
  for (const registrationStatus of ["cancelled", "rejected_by_parent", "draft", "submitted", "waitlist"]) {
    assert.equal(getParentEmailOutcome({ registrationStatus, parentAuthorization: null }), "none", registrationStatus);
    assert.equal(
      getParentEmailOutcome({
        registrationStatus,
        parentAuthorization: makeAuthorization({ status: "email_sent", brevoMessageId: "msg-1" }),
      }),
      "none",
      `${registrationStatus} con mail partita`,
    );
  }
});

test("getParentEmailAddress: prima l'indirizzo dell'ultimo invio", () => {
  assert.equal(
    getParentEmailAddress({
      parentAuthorization: makeAuthorization({ parentEmail: "mamma@example.com" }),
      answers: { parentAuthorizationRequest: { parentEmail: "vecchia@example.com" } },
    }),
    "mamma@example.com",
  );
  // Spazi intorno all'indirizzo: tolti.
  assert.equal(
    getParentEmailAddress({ parentAuthorization: makeAuthorization({ parentEmail: "  mamma@example.com " }), answers: {} }),
    "mamma@example.com",
  );
});

test("getParentEmailAddress: senza invio, quello scritto nel modulo", () => {
  const answers = { parentAuthorizationRequest: { parentEmail: "papa@example.com" } };
  assert.equal(getParentEmailAddress({ parentAuthorization: null, answers }), "papa@example.com");
  assert.equal(getParentEmailAddress({ parentAuthorization: makeAuthorization({ parentEmail: "" }), answers }), "papa@example.com");
  assert.equal(getParentEmailAddress({ parentAuthorization: makeAuthorization({ parentEmail: "   " }), answers }), "papa@example.com");
  assert.equal(getParentEmailAddress({ answers }), "papa@example.com");
});

test("getParentEmailAddress: nessun indirizzo → stringa vuota", () => {
  assert.equal(getParentEmailAddress(null), "");
  assert.equal(getParentEmailAddress(undefined), "");
  assert.equal(getParentEmailAddress({ parentAuthorization: null, answers: {} }), "");
  assert.equal(getParentEmailAddress({ parentAuthorization: null }), "");
  assert.equal(getParentEmailAddress({ parentAuthorization: null, answers: { parentAuthorizationRequest: null } }), "");
  assert.equal(getParentEmailAddress({ parentAuthorization: null, answers: { parentAuthorizationRequest: "x@y.it" } }), "");
  assert.equal(getParentEmailAddress({ parentAuthorization: null, answers: { parentAuthorizationRequest: { parentEmail: 42 } } }), "");
});

// ---------------------------------------------------------------------------
// validateChildForm / getChildFormInitial
// ---------------------------------------------------------------------------

const TODAY = new Date(2026, 9, 19, 18, 30);
const UNITS = ["unita-roma-1", "unita-roma-2"];

const validChild = (overrides = {}) => ({
  firstName: "Marco",
  lastName: "Rossi",
  birthDate: "2013-04-24",
  genderRoleCategory: "giovane_uomo",
  unitId: "unita-roma-1",
  ...overrides,
});

test("validateChildForm: un modulo completo è valido", () => {
  assert.equal(validateChildForm(validChild(), { today: TODAY, unitIds: UNITS }), null);
  assert.equal(validateChildForm(validChild({ genderRoleCategory: "giovane_donna" }), { today: TODAY, unitIds: UNITS }), null);
});

test("validateChildForm: nome o cognome vuoti, anche solo spazi → erroreNome", () => {
  for (const overrides of [{ firstName: "" }, { lastName: "" }, { firstName: "   " }, { lastName: " \t " }, { firstName: "", lastName: "" }]) {
    assert.equal(validateChildForm(validChild(overrides), { today: TODAY, unitIds: UNITS }), CHI_ISCRIVI.erroreNome, JSON.stringify(overrides));
  }
});

test("validateChildForm: data di nascita mancante → erroreDataNascita", () => {
  assert.equal(validateChildForm(validChild({ birthDate: "" }), { today: TODAY, unitIds: UNITS }), CHI_ISCRIVI.erroreDataNascita);
});

test("validateChildForm: data futura, prima del 1920 o impossibile → erroreDataNonValida", () => {
  for (const birthDate of ["2026-10-20", "2030-01-01", "1919-12-31", "1900-06-01", "2013-02-30", "abc"]) {
    assert.equal(
      validateChildForm(validChild({ birthDate }), { today: TODAY, unitIds: UNITS }),
      CHI_ISCRIVI.erroreDataNonValida,
      birthDate,
    );
  }
});

test("validateChildForm: oggi e il 1° gennaio 1920 sono date accettate (i limiti sono inclusi)", () => {
  assert.equal(validateChildForm(validChild({ birthDate: "2026-10-19" }), { today: TODAY, unitIds: UNITS }), null);
  assert.equal(validateChildForm(validChild({ birthDate: "1920-01-01" }), { today: TODAY, unitIds: UNITS }), null);
});

test("validateChildForm: gruppo mancante → erroreGruppo", () => {
  assert.equal(validateChildForm(validChild({ genderRoleCategory: "" }), { today: TODAY, unitIds: UNITS }), CHI_ISCRIVI.erroreGruppo);
});

test("validateChildForm: unità obbligatoria solo con unità configurate, e fra quelle", () => {
  assert.equal(validateChildForm(validChild({ unitId: "" }), { today: TODAY, unitIds: UNITS }), CHI_ISCRIVI.erroreUnita);
  assert.equal(validateChildForm(validChild({ unitId: "unita-milano" }), { today: TODAY, unitIds: UNITS }), CHI_ISCRIVI.erroreUnita);
  assert.equal(validateChildForm(validChild({ unitId: "unita-roma-2" }), { today: TODAY, unitIds: UNITS }), null);
  // Palo senza unità configurate: il campo resta spento, niente errore.
  assert.equal(validateChildForm(validChild({ unitId: "" }), { today: TODAY, unitIds: [] }), null);
});

test("validateChildForm: il primo errore segue l'ordine dei campi (nome, data, gruppo, unità)", () => {
  const empty = { firstName: "", lastName: "", birthDate: "", genderRoleCategory: "", unitId: "" };
  assert.equal(validateChildForm(empty, { today: TODAY, unitIds: UNITS }), CHI_ISCRIVI.erroreNome);
  assert.equal(
    validateChildForm({ ...empty, firstName: "Marco", lastName: "Rossi" }, { today: TODAY, unitIds: UNITS }),
    CHI_ISCRIVI.erroreDataNascita,
  );
  assert.equal(
    validateChildForm({ ...empty, firstName: "Marco", lastName: "Rossi", birthDate: "2013-04-24" }, { today: TODAY, unitIds: UNITS }),
    CHI_ISCRIVI.erroreGruppo,
  );
  assert.equal(
    validateChildForm(
      { ...empty, firstName: "Marco", lastName: "Rossi", birthDate: "2013-04-24", genderRoleCategory: "giovane_uomo" },
      { today: TODAY, unitIds: UNITS },
    ),
    CHI_ISCRIVI.erroreUnita,
  );
});

test("validateChildForm: i messaggi sono testi diversi e non vuoti", () => {
  const messages = [
    CHI_ISCRIVI.erroreNome,
    CHI_ISCRIVI.erroreDataNascita,
    CHI_ISCRIVI.erroreDataNonValida,
    CHI_ISCRIVI.erroreGruppo,
    CHI_ISCRIVI.erroreUnita,
  ];
  for (const message of messages) {
    assert.equal(typeof message, "string");
    assert.ok(message.trim().length > 0);
  }
  assert.equal(new Set(messages).size, messages.length);
});

test("getChildFormInitial: figlio nuovo → campi vuoti e l'unità del genitore solo se è in elenco", () => {
  assert.deepEqual(getChildFormInitial(null, "unita-roma-2", UNITS), {
    firstName: "",
    lastName: "",
    birthDate: "",
    genderRoleCategory: "",
    unitId: "unita-roma-2",
  });
  assert.equal(getChildFormInitial(null, "unita-milano", UNITS).unitId, "");
  assert.equal(getChildFormInitial(null, "", UNITS).unitId, "");
  assert.equal(getChildFormInitial(null, "unita-roma-1", []).unitId, "");
});

test("getChildFormInitial: in modifica → i dati salvati del figlio", () => {
  const saved = {
    firstName: "Giulia",
    lastName: "Rossi",
    birthDate: "2012-09-03",
    genderRoleCategory: "giovane_donna",
    unitId: "unita-roma-1",
    // Campi del documento che il modulo non mostra.
    fullName: "Giulia Rossi",
    unitName: "Roma 1",
  };
  assert.deepEqual(getChildFormInitial(saved, "unita-roma-2", UNITS), {
    firstName: "Giulia",
    lastName: "Rossi",
    birthDate: "2012-09-03",
    genderRoleCategory: "giovane_donna",
    unitId: "unita-roma-1",
  });
  assert.equal(getChildFormInitial({ ...saved, genderRoleCategory: "giovane_uomo" }, "", UNITS).genderRoleCategory, "giovane_uomo");
});

test("getChildFormInitial: in modifica un gruppo non valido per un figlio diventa vuoto", () => {
  const saved = { firstName: "Luca", lastName: "Bianchi", birthDate: "2012-01-01", unitId: "unita-roma-1" };
  for (const genderRoleCategory of ["", "dirigente", "accompagnatore", "GU", undefined]) {
    assert.equal(
      getChildFormInitial({ ...saved, genderRoleCategory }, "", UNITS).genderRoleCategory,
      "",
      JSON.stringify(genderRoleCategory),
    );
  }
});

// ---------------------------------------------------------------------------
// getInitials / getAvatarTone
// ---------------------------------------------------------------------------

test("getInitials: le iniziali delle prime due parole, maiuscole", () => {
  assert.equal(getInitials("Marco Rossi"), "MR");
  assert.equal(getInitials("giulia rossi"), "GR");
  assert.equal(getInitials("  Anna   Maria  Bianchi "), "AM");
  assert.equal(getInitials("Luca"), "L");
  assert.equal(getInitials("élodie rossi"), "ÉR");
});

test("getInitials: nome vuoto → «?»", () => {
  assert.equal(getInitials(""), "?");
  assert.equal(getInitials("   "), "?");
});

test("getAvatarTone: stesso nome, stesso tono; sempre uno dei quattro toni", () => {
  const tones = new Set(["blue", "sand", "green", "slate"]);
  const names = [
    "",
    "Marco Rossi",
    "Giulia Rossi",
    "Anna Bianchi",
    "Luca Verdi",
    "Sofia Esposito",
    "Matteo Romano",
    "Chiara Colombo",
    "Davide Ricci",
    "Elena Marino",
    "Francesco Greco",
    "Martina Bruno",
    "Lorenzo Gallo",
    "Alice Conti",
    "Tommaso De Luca",
    "Aurora Costa",
    "Riccardo Fontana",
  ];

  for (const name of names) {
    const tone = getAvatarTone(name);
    assert.ok(tones.has(tone), `${JSON.stringify(name)} → ${tone}`);
    assert.equal(getAvatarTone(name), tone, `${JSON.stringify(name)} non è stabile`);
  }

  // Su tanti nomi i toni sono più d'uno (altrimenti l'avatar non distingue nessuno).
  assert.ok(new Set(names.map(getAvatarTone)).size > 1);
});

// ---------------------------------------------------------------------------
// applyChildIdentity
// ---------------------------------------------------------------------------

// Difetto trovato in review: la bozza del modulo di Marco, ripresa dopo che il
// genitore ha corretto i suoi dati con la matita, riportava nome, data, gruppo
// e unità di prima. Sono campi nascosti nel modulo, e una data vecchia da
// maggiorenne avrebbe tolto la richiesta di autorizzazione per un minore.

// Marco come era quando è partita la bozza: data sbagliata, da maggiorenne.
const staleDraft = () => ({
  firstName: "Marcoo",
  lastName: "Rosi",
  birthDate: "2005-04-24",
  category: "giovane_uomo",
  unitName: "Roma 1",
  // Campi della bozza che non riguardano l'identità del figlio.
  parentPhone: "+39 333 0000000",
  consentAccepted: true,
  answers: {
    birthDate: "2005-04-24",
    genderRoleCategory: "giovane_uomo",
    youthGroup: "giovane_uomo",
    unitName: "Roma 1",
    allergies: "arachidi",
    medicalNotes: "asma lieve",
    custom_tshirt: "M",
    custom_trasporto: { andata: true, ritorno: false },
  },
});

// Marco dopo la correzione con la matita.
const correctedChild = {
  firstName: "Marco",
  lastName: "Rossi",
  birthDate: "2013-04-24",
  genderRoleCategory: "giovane_donna",
  unitName: "Roma 2",
  // Campi del documento del figlio che la bozza non usa.
  id: "child-marco",
  fullName: "Marco Rossi",
  unitId: "unita-roma-2",
};

test("applyChildIdentity: nome, cognome, data, gruppo e unità vengono dal figlio", () => {
  const result = applyChildIdentity(staleDraft(), correctedChild);
  assert.equal(result.firstName, "Marco");
  assert.equal(result.lastName, "Rossi");
  assert.equal(result.birthDate, "2013-04-24");
  assert.equal(result.category, "giovane_donna");
  assert.equal(result.unitName, "Roma 2");
});

test("applyChildIdentity: nelle risposte si riscrivono data, gruppo (anche youthGroup) e unità già presenti", () => {
  const { answers } = applyChildIdentity(staleDraft(), correctedChild);
  assert.equal(answers.birthDate, "2013-04-24");
  assert.equal(answers.genderRoleCategory, "giovane_donna");
  assert.equal(answers.youthGroup, "giovane_donna");
  assert.equal(answers.unitName, "Roma 2");
});

test("applyChildIdentity: le altre risposte (sanitarie, note, chiavi personalizzate) restano identiche", () => {
  const draft = staleDraft();
  const { answers } = applyChildIdentity(draft, correctedChild);
  for (const key of ["allergies", "medicalNotes", "custom_tshirt", "custom_trasporto"]) {
    assert.deepEqual(answers[key], draft.answers[key], key);
  }
  // Le stesse chiavi di prima, nessuna in più e nessuna in meno.
  assert.deepEqual(Object.keys(answers).sort(), Object.keys(draft.answers).sort());
});

test("applyChildIdentity: i campi della bozza fuori dall'identità restano", () => {
  const result = applyChildIdentity(staleDraft(), correctedChild);
  assert.equal(result.parentPhone, "+39 333 0000000");
  assert.equal(result.consentAccepted, true);
  // Nessun campo del figlio che la bozza non ha (id, fullName, unitId) entra nella bozza.
  for (const key of ["id", "fullName", "unitId", "genderRoleCategory"]) {
    assert.equal(Object.hasOwn(result, key), false, key);
  }
});

test("applyChildIdentity: nessuna chiave nuova nelle risposte, se la bozza non l'aveva", () => {
  const onlyMedical = { ...staleDraft(), answers: { allergies: "arachidi", custom_tshirt: "M" } };
  const { answers } = applyChildIdentity(onlyMedical, correctedChild);
  assert.deepEqual(answers, { allergies: "arachidi", custom_tshirt: "M" });

  const empty = { ...staleDraft(), answers: {} };
  assert.deepEqual(applyChildIdentity(empty, correctedChild).answers, {});

  // Solo alcune delle quattro: si riscrivono quelle, le altre non compaiono.
  const some = { ...staleDraft(), answers: { youthGroup: "giovane_uomo", note: "ciao" } };
  assert.deepEqual(applyChildIdentity(some, correctedChild).answers, { youthGroup: "giovane_donna", note: "ciao" });
  const withUnit = { ...staleDraft(), answers: { unitName: "Roma 1" } };
  assert.deepEqual(applyChildIdentity(withUnit, correctedChild).answers, { unitName: "Roma 2" });
});

test("applyChildIdentity: l'oggetto di partenza non viene modificato", () => {
  const draft = staleDraft();
  const snapshot = structuredClone(draft);
  const result = applyChildIdentity(draft, correctedChild);

  assert.deepEqual(draft, snapshot);
  assert.notEqual(result, draft);

  // Cambiare le risposte del risultato non tocca quelle della bozza di partenza.
  result.answers.allergies = "nessuna";
  result.answers.nuova = "x";
  assert.deepEqual(draft.answers, snapshot.answers);
});

test("applyChildIdentity: con i dati già giusti la bozza resta uguale", () => {
  const draft = applyChildIdentity(staleDraft(), correctedChild);
  assert.deepEqual(applyChildIdentity(draft, correctedChild), draft);
});
