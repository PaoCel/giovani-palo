import test from "node:test";
import assert from "node:assert/strict";

import { ANNULLA } from "../src/copy/annulla.ts";
import { FAMIGLIA } from "../src/copy/famiglia.ts";
import { fillCopy } from "../src/copy/parole.ts";
import {
  CANCEL_TIMEOUT_MS,
  areRegistrationsOpen,
  getCancelErrorMessage,
  getCancelRegistrationCopy,
  getOwnCancelRegistrationCopy,
  shouldShowResumeSigning,
  withCancelTimeout,
} from "../src/utils/familyCancel.ts";
import { formatDateOnly } from "../src/utils/formatters.ts";

// Foglio "Annulla l'iscrizione" e invito a riprendere la firma, in Famiglia
// (docs/FLUSSO_GENITORE.md, H e fase 2): il testo cambia se l'iscrizione si
// potrà rifare, e "Firma lasciata a metà?" compare solo dopo un "Autorizza ora".
// Il tempo arriva sempre come argomento `now`, così il test non dipende
// dall'orologio.
//
// La data di chiusura si confronta con `formatDateOnly` importata e non con una
// stringa scritta a mano: dipende da Intl it-IT e dal fuso della macchina.
//
// Lo stesso foglio nella propria scheda (`/me/activities/:id`) passa da
// `getOwnCancelRegistrationCopy`: titolo fisso, corpo che dice se si potrà
// rifare l'iscrizione, con la stessa regola `areRegistrationsOpen` di Famiglia.
//
// Comando: node --test tests/familyCancel.test.mjs

const OPENS = "2026-10-01T08:00:00.000Z";
const CLOSES = "2026-10-20T20:00:00.000Z";
const ms = (iso) => new Date(iso).getTime();

const NOW_INSIDE = ms("2026-10-10T12:00:00.000Z");
const NOW_BEFORE = ms("2026-09-30T23:59:59.999Z");
const NOW_AFTER = ms("2026-10-20T20:00:00.001Z");

const makeEvent = (overrides = {}) => ({
  title: "Campo estivo",
  status: "registrations_open",
  registrationOpen: OPENS,
  registrationClose: CLOSES,
  ...overrides,
});

// Nessun segnaposto {nome} può restare nel testo che arriva a schermo.
const NO_PLACEHOLDER = /\{\w+\}/u;

// ---------------------------------------------------------------------------
// areRegistrationsOpen
// ---------------------------------------------------------------------------

test("areRegistrationsOpen: dentro la finestra con lo stato giusto è vero", () => {
  assert.equal(areRegistrationsOpen(makeEvent(), NOW_INSIDE), true);
});

test("areRegistrationsOpen: i due estremi della finestra sono inclusi", () => {
  assert.equal(areRegistrationsOpen(makeEvent(), ms(OPENS)), true);
  assert.equal(areRegistrationsOpen(makeEvent(), ms(CLOSES)), true);
  assert.equal(areRegistrationsOpen(makeEvent(), ms(OPENS) - 1), false);
  assert.equal(areRegistrationsOpen(makeEvent(), ms(CLOSES) + 1), false);
});

test("areRegistrationsOpen: prima dell'apertura e dopo la chiusura è falso", () => {
  assert.equal(areRegistrationsOpen(makeEvent(), NOW_BEFORE), false);
  assert.equal(areRegistrationsOpen(makeEvent(), NOW_AFTER), false);
});

test("areRegistrationsOpen: uno stato diverso da registrations_open è falso, anche dentro la finestra", () => {
  for (const status of [
    "draft",
    "planned",
    "confirmed",
    "registrations_closed",
    "completed",
    "cancelled",
  ]) {
    assert.equal(areRegistrationsOpen(makeEvent({ status }), NOW_INSIDE), false, status);
  }
});

test("areRegistrationsOpen: date non valide o mancanti sono false", () => {
  for (const overrides of [
    { registrationOpen: "non una data" },
    { registrationClose: "non una data" },
    { registrationOpen: "", registrationClose: "" },
    { registrationOpen: undefined },
    { registrationClose: undefined },
    { registrationOpen: "non una data", registrationClose: "non una data" },
  ]) {
    assert.equal(areRegistrationsOpen(makeEvent(overrides), NOW_INSIDE), false, JSON.stringify(overrides));
  }
});

test("areRegistrationsOpen: evento mancante è falso", () => {
  assert.equal(areRegistrationsOpen(null, NOW_INSIDE), false);
  assert.equal(areRegistrationsOpen(undefined, NOW_INSIDE), false);
});

test("areRegistrationsOpen: senza `now` usa l'ora attuale", () => {
  const day = 24 * 60 * 60 * 1000;
  const iso = (offset) => new Date(Date.now() + offset).toISOString();
  assert.equal(
    areRegistrationsOpen(makeEvent({ registrationOpen: iso(-day), registrationClose: iso(day) })),
    true,
  );
  assert.equal(
    areRegistrationsOpen(makeEvent({ registrationOpen: iso(-2 * day), registrationClose: iso(-day) })),
    false,
  );
  assert.equal(
    areRegistrationsOpen(makeEvent({ registrationOpen: iso(day), registrationClose: iso(2 * day) })),
    false,
  );
});

// ---------------------------------------------------------------------------
// getCancelRegistrationCopy
// ---------------------------------------------------------------------------

test("getCancelRegistrationCopy: il titolo nomina il figlio", () => {
  const { title } = getCancelRegistrationCopy("Marco", makeEvent(), NOW_INSIDE);
  assert.equal(title, fillCopy(FAMIGLIA.annullaTitolo, { nome: "Marco" }));
  assert.ok(title.includes("Marco"), title);
  assert.doesNotMatch(title, NO_PLACEHOLDER);

  // Il titolo non dipende dall'attività né dall'apertura delle iscrizioni.
  assert.equal(getCancelRegistrationCopy("Marco", null, NOW_AFTER).title, title);
  assert.ok(getCancelRegistrationCopy("Giulia Rossi", makeEvent(), NOW_INSIDE).title.includes("Giulia Rossi"));
});

test("getCancelRegistrationCopy: iscrizioni aperte, titolo dell'attività e data di chiusura", () => {
  const { body } = getCancelRegistrationCopy("Marco", makeEvent(), NOW_INSIDE);
  const closing = formatDateOnly(CLOSES);

  assert.equal(
    body,
    fillCopy(FAMIGLIA.annullaCorpoAperte, { attivita: "Campo estivo", data: closing }),
  );
  assert.ok(body.includes("«Campo estivo»"), body);
  assert.ok(body.includes(closing), body);
  assert.doesNotMatch(body, NO_PLACEHOLDER);
});

test("getCancelRegistrationCopy: iscrizioni chiuse, senza data e con la stessa attività", () => {
  const closing = formatDateOnly(CLOSES);
  const closed = [
    ["dopo la chiusura", makeEvent(), NOW_AFTER],
    ["prima dell'apertura", makeEvent(), NOW_BEFORE],
    ["stato chiuso", makeEvent({ status: "registrations_closed" }), NOW_INSIDE],
    ["attività annullata", makeEvent({ status: "cancelled" }), NOW_INSIDE],
    ["date non valide", makeEvent({ registrationClose: "non una data" }), NOW_INSIDE],
  ];
  for (const [label, event, now] of closed) {
    const { body } = getCancelRegistrationCopy("Marco", event, now);
    assert.equal(body, fillCopy(FAMIGLIA.annullaCorpoChiuse, { attivita: "Campo estivo" }), label);
    assert.ok(body.includes("«Campo estivo»"), label);
    assert.ok(!body.includes(closing), `${label}: la data di chiusura non serve`);
    assert.doesNotMatch(body, NO_PLACEHOLDER, label);
  }
});

test("getCancelRegistrationCopy: aperte e chiuse hanno testi diversi", () => {
  const open = getCancelRegistrationCopy("Marco", makeEvent(), NOW_INSIDE).body;
  const closed = getCancelRegistrationCopy("Marco", makeEvent(), NOW_AFTER).body;
  assert.notEqual(open, closed);
});

test("getCancelRegistrationCopy: evento mancante, testo senza nominare l'attività", () => {
  for (const event of [null, undefined]) {
    for (const now of [NOW_BEFORE, NOW_INSIDE, NOW_AFTER]) {
      const { title, body } = getCancelRegistrationCopy("Marco", event, now);
      assert.equal(body, FAMIGLIA.annullaCorpoSenzaAttivita);
      // Né il nome generico né le virgolette: l'attività non la conosciamo.
      assert.ok(!body.includes(FAMIGLIA.attivitaGenerica), body);
      assert.ok(!body.includes("«") && !body.includes("»"), body);
      assert.doesNotMatch(body, NO_PLACEHOLDER);
      assert.equal(title, fillCopy(FAMIGLIA.annullaTitolo, { nome: "Marco" }));
    }
  }
});

test("getCancelRegistrationCopy: evento senza titolo usa «Attività»", () => {
  for (const title of ["", "   ", "\n", undefined, null]) {
    const open = getCancelRegistrationCopy("Marco", makeEvent({ title }), NOW_INSIDE).body;
    assert.ok(open.includes("«Attività»"), JSON.stringify(title));
    assert.ok(open.includes(formatDateOnly(CLOSES)), JSON.stringify(title));
    assert.doesNotMatch(open, NO_PLACEHOLDER, JSON.stringify(title));

    const closed = getCancelRegistrationCopy("Marco", makeEvent({ title }), NOW_AFTER).body;
    assert.ok(closed.includes("«Attività»"), JSON.stringify(title));
    assert.doesNotMatch(closed, NO_PLACEHOLDER, JSON.stringify(title));
  }
});

test("getCancelRegistrationCopy: il titolo dell'attività è tagliato dagli spazi e non è interpretato", () => {
  const spaced = getCancelRegistrationCopy("Marco", makeEvent({ title: "  Campo estivo  " }), NOW_INSIDE).body;
  assert.ok(spaced.includes("«Campo estivo»"), spaced);

  // `$&` e simili nel titolo restano com'è: nessuna sostituzione speciale.
  const special = getCancelRegistrationCopy("Marco", makeEvent({ title: "Notte $& giorno" }), NOW_INSIDE).body;
  assert.ok(special.includes("«Notte $& giorno»"), special);
});

// ---------------------------------------------------------------------------
// shouldShowResumeSigning
// ---------------------------------------------------------------------------

const ISSUED = "2026-10-18T10:00:00.000Z";

const makeRegistration = (registrationStatus, parentAuthorization) => ({
  registrationStatus,
  parentAuthorization,
});

test("shouldShowResumeSigning: vero solo in attesa di firma e dopo un Autorizza ora", () => {
  assert.equal(
    shouldShowResumeSigning(makeRegistration("pending_parent_authorization", { selfTokenIssuedAt: ISSUED })),
    true,
  );
  // Gli altri campi dell'autorizzazione non contano.
  assert.equal(
    shouldShowResumeSigning(
      makeRegistration("pending_parent_authorization", { status: "email_sent", selfTokenIssuedAt: ISSUED }),
    ),
    true,
  );
});

test("shouldShowResumeSigning: falso senza un Autorizza ora registrato", () => {
  for (const selfTokenIssuedAt of [null, undefined, ""]) {
    assert.equal(
      shouldShowResumeSigning(makeRegistration("pending_parent_authorization", { selfTokenIssuedAt })),
      false,
      JSON.stringify(selfTokenIssuedAt),
    );
  }
  // Campo assente del tutto, autorizzazione null o mancante.
  assert.equal(shouldShowResumeSigning(makeRegistration("pending_parent_authorization", {})), false);
  assert.equal(shouldShowResumeSigning(makeRegistration("pending_parent_authorization", null)), false);
  assert.equal(shouldShowResumeSigning(makeRegistration("pending_parent_authorization", undefined)), false);
  assert.equal(shouldShowResumeSigning({ registrationStatus: "pending_parent_authorization" }), false);
});

test("shouldShowResumeSigning: falso con ogni altro stato dell'iscrizione, anche col token", () => {
  for (const status of [
    "draft",
    "submitted",
    "confirmed",
    "waitlist",
    "active",
    "cancelled",
    "rejected_by_parent",
  ]) {
    assert.equal(
      shouldShowResumeSigning(makeRegistration(status, { selfTokenIssuedAt: ISSUED })),
      false,
      status,
    );
  }
  assert.equal(shouldShowResumeSigning(makeRegistration(undefined, { selfTokenIssuedAt: ISSUED })), false);
});

test("shouldShowResumeSigning: il risultato è sempre un booleano", () => {
  for (const registration of [
    makeRegistration("pending_parent_authorization", { selfTokenIssuedAt: ISSUED }),
    makeRegistration("pending_parent_authorization", null),
    makeRegistration("confirmed", { selfTokenIssuedAt: ISSUED }),
  ]) {
    assert.equal(typeof shouldShowResumeSigning(registration), "boolean");
  }
});

// ---------------------------------------------------------------------------
// withCancelTimeout
// ---------------------------------------------------------------------------

// Una promessa che non si risolve mai: la scrittura offline, in coda.
const never = () => new Promise(() => {});
const wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

test("withCancelTimeout: se la promessa arriva prima risolve con il suo valore", async () => {
  assert.equal(await withCancelTimeout(Promise.resolve("fatto"), 20), "fatto");

  const value = { id: "r1" };
  assert.equal(await withCancelTimeout(Promise.resolve(value), 20), value);

  // Anche se arriva dopo un po', purché prima del limite.
  assert.equal(await withCancelTimeout(wait(5).then(() => "tardi"), 500), "tardi");

  // Un valore vuoto resta tale.
  assert.equal(await withCancelTimeout(Promise.resolve(undefined), 20), undefined);
});

test("withCancelTimeout: se la promessa rigetta prima rigetta con lo stesso errore", async () => {
  const original = Object.assign(new Error("Missing or insufficient permissions."), {
    code: "permission-denied",
  });
  await assert.rejects(withCancelTimeout(Promise.reject(original), 20), (caught) => {
    assert.equal(caught, original);
    assert.notEqual(caught.message, ANNULLA.erroreRete);
    return true;
  });

  // Anche un valore che non è un Error passa com'è.
  await assert.rejects(withCancelTimeout(Promise.reject("rete"), 20), (caught) => caught === "rete");
});

test("withCancelTimeout: se la promessa non arriva rigetta con il messaggio di rete", async () => {
  const startedAt = Date.now();
  await assert.rejects(withCancelTimeout(never(), 20), (caught) => {
    assert.ok(caught instanceof Error);
    assert.equal(caught.message, ANNULLA.erroreRete);
    return true;
  });
  // Non prima del limite (con un po' di margine per i timer).
  assert.ok(Date.now() - startedAt >= 10, "rigettata troppo presto");
});

test("withCancelTimeout: l'esito della promessa arrivato dopo il limite non cambia niente", async () => {
  const late = wait(50).then(() => "troppo tardi");
  await assert.rejects(withCancelTimeout(late, 10), (caught) => caught.message === ANNULLA.erroreRete);
  assert.equal(await late, "troppo tardi");

  const lateFailure = wait(50).then(() => {
    throw new Error("dopo");
  });
  await assert.rejects(withCancelTimeout(lateFailure, 10), (caught) => caught.message === ANNULLA.erroreRete);
  await assert.rejects(lateFailure, /dopo/u);
});

test("withCancelTimeout: ferma il timer quando la promessa si chiude prima", async (t) => {
  const clear = t.mock.method(globalThis, "clearTimeout");
  await withCancelTimeout(Promise.resolve("ok"), 500);
  assert.equal(clear.mock.callCount(), 1);
  await assert.rejects(withCancelTimeout(Promise.reject(new Error("no")), 500), /no/u);
  assert.equal(clear.mock.callCount(), 2);
});

test("withCancelTimeout: il limite predefinito è un numero di millisecondi sensato", () => {
  assert.equal(typeof CANCEL_TIMEOUT_MS, "number");
  assert.ok(CANCEL_TIMEOUT_MS >= 5000 && CANCEL_TIMEOUT_MS <= 60000, String(CANCEL_TIMEOUT_MS));
});

// ---------------------------------------------------------------------------
// getCancelErrorMessage
// ---------------------------------------------------------------------------

const withCode = (code, message = "Firebase: errore in inglese.") =>
  Object.assign(new Error(message), { code });

test("getCancelErrorMessage: errore di rete per il timeout e per unavailable", async () => {
  const timeoutError = await withCancelTimeout(never(), 20).catch((error) => error);
  assert.equal(getCancelErrorMessage(timeoutError), ANNULLA.erroreRete);

  assert.equal(getCancelErrorMessage(withCode("unavailable")), ANNULLA.erroreRete);
  assert.equal(getCancelErrorMessage({ code: "unavailable" }), ANNULLA.erroreRete);
});

test("getCancelErrorMessage: messaggio generico per ogni altro errore", () => {
  for (const error of [
    withCode("permission-denied", "Missing or insufficient permissions."),
    withCode("not-found"),
    withCode("failed-precondition"),
    new Error("qualunque cosa"),
    new TypeError("x"),
    { code: 14 },
    { message: "unavailable" },
    {},
    "unavailable",
    "stringa",
    42,
    null,
    undefined,
  ]) {
    assert.equal(getCancelErrorMessage(error), ANNULLA.errore, String(error));
  }
});

test("getCancelErrorMessage: non lascia passare il testo inglese di Firebase", () => {
  const message = getCancelErrorMessage(withCode("permission-denied", "Missing or insufficient permissions."));
  assert.doesNotMatch(message, /permissions|Firebase/iu);
  assert.notEqual(ANNULLA.errore, ANNULLA.erroreRete);
});

// ---------------------------------------------------------------------------
// getOwnCancelRegistrationCopy
// ---------------------------------------------------------------------------

// Le combinazioni di evento e orologio su cui la scelta aperte/chiuse deve
// coincidere con `areRegistrationsOpen`, la regola del foglio di Famiglia.
const OWN_SCENARIOS = [
  ["dentro la finestra", makeEvent(), NOW_INSIDE],
  ["apertura esatta", makeEvent(), ms(OPENS)],
  ["chiusura esatta", makeEvent(), ms(CLOSES)],
  ["un istante prima dell'apertura", makeEvent(), ms(OPENS) - 1],
  ["un istante dopo la chiusura", makeEvent(), ms(CLOSES) + 1],
  ["prima dell'apertura", makeEvent(), NOW_BEFORE],
  ["dopo la chiusura", makeEvent(), NOW_AFTER],
  ["stato chiuso", makeEvent({ status: "registrations_closed" }), NOW_INSIDE],
  ["stato bozza", makeEvent({ status: "draft" }), NOW_INSIDE],
  ["attività annullata", makeEvent({ status: "cancelled" }), NOW_INSIDE],
  ["data di chiusura non valida", makeEvent({ registrationClose: "non una data" }), NOW_INSIDE],
  ["data di apertura mancante", makeEvent({ registrationOpen: undefined }), NOW_INSIDE],
];

test("getOwnCancelRegistrationCopy: iscrizioni aperte, titolo dell'attività e data di chiusura", () => {
  const { body } = getOwnCancelRegistrationCopy(makeEvent(), NOW_INSIDE);
  const closing = formatDateOnly(CLOSES);

  assert.equal(
    body,
    fillCopy(ANNULLA.corpoAperteTua, { attivita: "Campo estivo", data: closing }),
  );
  assert.ok(body.includes("«Campo estivo»"), body);
  assert.ok(body.includes(closing), body);
  assert.doesNotMatch(body, NO_PLACEHOLDER);
});

test("getOwnCancelRegistrationCopy: la data è quella di chiusura, non quella di apertura", () => {
  const closing = formatDateOnly(CLOSES);
  const opening = formatDateOnly(OPENS);
  assert.notEqual(closing, opening, "il test ha bisogno di due date che si leggono diverse");

  const { body } = getOwnCancelRegistrationCopy(makeEvent(), NOW_INSIDE);
  assert.ok(body.includes(closing), body);
  assert.ok(!body.includes(opening), `${body}: c'è la data di apertura`);

  // Cambia la chiusura e cambia il testo: la data arriva davvero dall'evento.
  const later = "2026-10-25T20:00:00.000Z";
  assert.notEqual(formatDateOnly(later), closing);
  const moved = getOwnCancelRegistrationCopy(makeEvent({ registrationClose: later }), NOW_INSIDE).body;
  assert.ok(moved.includes(formatDateOnly(later)), moved);
  assert.ok(!moved.includes(closing), moved);
});

test("getOwnCancelRegistrationCopy: iscrizioni chiuse, senza data e con la stessa attività", () => {
  const closing = formatDateOnly(CLOSES);
  const closed = [
    ["dopo la chiusura", makeEvent(), NOW_AFTER],
    ["prima dell'apertura", makeEvent(), NOW_BEFORE],
    ["stato chiuso", makeEvent({ status: "registrations_closed" }), NOW_INSIDE],
    ["attività annullata", makeEvent({ status: "cancelled" }), NOW_INSIDE],
    ["date non valide", makeEvent({ registrationClose: "non una data" }), NOW_INSIDE],
  ];
  for (const [label, event, now] of closed) {
    const { body } = getOwnCancelRegistrationCopy(event, now);
    assert.equal(body, fillCopy(ANNULLA.corpoChiuseTua, { attivita: "Campo estivo" }), label);
    assert.ok(body.includes("«Campo estivo»"), label);
    assert.ok(!body.includes(closing), `${label}: la data di chiusura non serve`);
    assert.doesNotMatch(body, NO_PLACEHOLDER, label);
  }
});

test("getOwnCancelRegistrationCopy: aperte e chiuse hanno testi diversi", () => {
  const open = getOwnCancelRegistrationCopy(makeEvent(), NOW_INSIDE).body;
  const closed = getOwnCancelRegistrationCopy(makeEvent(), NOW_AFTER).body;
  assert.notEqual(open, closed);
  assert.notEqual(ANNULLA.corpoAperteTua, ANNULLA.corpoChiuseTua);
});

test("getOwnCancelRegistrationCopy: il titolo è sempre quello della propria iscrizione", () => {
  for (const [label, event, now] of OWN_SCENARIOS) {
    const { title } = getOwnCancelRegistrationCopy(event, now);
    assert.equal(title, ANNULLA.titoloTua, label);
    // Parla alla persona che si sta annullando: nessun nome da riempire.
    assert.doesNotMatch(title, NO_PLACEHOLDER, label);
  }
  for (const title of ["", "   ", undefined]) {
    assert.equal(getOwnCancelRegistrationCopy(makeEvent({ title }), NOW_INSIDE).title, ANNULLA.titoloTua);
  }
});

test("getOwnCancelRegistrationCopy: sceglie aperte o chiuse come areRegistrationsOpen, il controllo del foglio di Famiglia", () => {
  const closing = formatDateOnly(CLOSES);
  for (const [label, event, now] of OWN_SCENARIOS) {
    const { body } = getOwnCancelRegistrationCopy(event, now);
    const expected = areRegistrationsOpen(event, now)
      ? fillCopy(ANNULLA.corpoAperteTua, { attivita: "Campo estivo", data: closing })
      : fillCopy(ANNULLA.corpoChiuseTua, { attivita: "Campo estivo" });
    assert.equal(body, expected, label);
    assert.doesNotMatch(body, NO_PLACEHOLDER, label);
  }

  // Le due schede dicono la stessa cosa sulla possibilità di rifare l'iscrizione.
  for (const [label, event, now] of OWN_SCENARIOS) {
    const own = getOwnCancelRegistrationCopy(event, now).body.includes(closing);
    const family = getCancelRegistrationCopy("Marco", event, now).body.includes(closing);
    assert.equal(own, family, label);
  }
});

test("getOwnCancelRegistrationCopy: uno stato diverso da registrations_open vale come chiuso, anche dentro la finestra", () => {
  const closing = formatDateOnly(CLOSES);
  for (const status of ["draft", "planned", "confirmed", "registrations_closed", "completed", "cancelled"]) {
    const { body } = getOwnCancelRegistrationCopy(makeEvent({ status }), NOW_INSIDE);
    assert.equal(body, fillCopy(ANNULLA.corpoChiuseTua, { attivita: "Campo estivo" }), status);
    assert.ok(!body.includes(closing), status);
  }
});

test("getOwnCancelRegistrationCopy: evento senza titolo usa «Attività»", () => {
  const generic = FAMIGLIA.attivitaGenerica;
  assert.equal(generic, "Attività");

  for (const title of ["", "   ", "\n", "\t ", undefined, null]) {
    const label = JSON.stringify(title);

    const open = getOwnCancelRegistrationCopy(makeEvent({ title }), NOW_INSIDE).body;
    assert.equal(
      open,
      fillCopy(ANNULLA.corpoAperteTua, { attivita: generic, data: formatDateOnly(CLOSES) }),
      label,
    );
    assert.ok(open.includes(`«${generic}»`), label);
    assert.doesNotMatch(open, NO_PLACEHOLDER, label);

    const closed = getOwnCancelRegistrationCopy(makeEvent({ title }), NOW_AFTER).body;
    assert.equal(closed, fillCopy(ANNULLA.corpoChiuseTua, { attivita: generic }), label);
    assert.ok(closed.includes(`«${generic}»`), label);
    assert.doesNotMatch(closed, NO_PLACEHOLDER, label);
  }
});

test("getOwnCancelRegistrationCopy: il titolo dell'attività è tagliato dagli spazi e non è interpretato", () => {
  const spaced = getOwnCancelRegistrationCopy(makeEvent({ title: "  Campo estivo  " }), NOW_INSIDE).body;
  assert.ok(spaced.includes("«Campo estivo»"), spaced);

  // `$&` e simili nel titolo restano com'è: nessuna sostituzione speciale.
  const special = getOwnCancelRegistrationCopy(makeEvent({ title: "Notte $& giorno" }), NOW_INSIDE).body;
  assert.ok(special.includes("«Notte $& giorno»"), special);
  const specialClosed = getOwnCancelRegistrationCopy(makeEvent({ title: "Notte $& giorno" }), NOW_AFTER).body;
  assert.ok(specialClosed.includes("«Notte $& giorno»"), specialClosed);

  // Un titolo che sembra un segnaposto non viene riempito una seconda volta.
  const looksLikePlaceholder = getOwnCancelRegistrationCopy(makeEvent({ title: "{data}" }), NOW_INSIDE).body;
  assert.ok(looksLikePlaceholder.includes("«{data}»"), looksLikePlaceholder);
});

test("getOwnCancelRegistrationCopy: senza `now` usa l'ora attuale", () => {
  const day = 24 * 60 * 60 * 1000;
  const iso = (offset) => new Date(Date.now() + offset).toISOString();

  const open = getOwnCancelRegistrationCopy(
    makeEvent({ registrationOpen: iso(-day), registrationClose: iso(day) }),
  ).body;
  assert.ok(open.includes(formatDateOnly(iso(day))), open);

  const closed = getOwnCancelRegistrationCopy(
    makeEvent({ registrationOpen: iso(-2 * day), registrationClose: iso(-day) }),
  ).body;
  assert.equal(closed, fillCopy(ANNULLA.corpoChiuseTua, { attivita: "Campo estivo" }));

  const notYet = getOwnCancelRegistrationCopy(
    makeEvent({ registrationOpen: iso(day), registrationClose: iso(2 * day) }),
  ).body;
  assert.equal(notYet, fillCopy(ANNULLA.corpoChiuseTua, { attivita: "Campo estivo" }));
});

test("getOwnCancelRegistrationCopy: non tocca l'evento che riceve", () => {
  const event = makeEvent();
  const snapshot = JSON.stringify(event);
  getOwnCancelRegistrationCopy(event, NOW_INSIDE);
  getOwnCancelRegistrationCopy(event, NOW_AFTER);
  assert.equal(JSON.stringify(event), snapshot);
});

test("le frasi del foglio per la propria iscrizione sono scritte per intero", () => {
  // La chiave di traduzione è la stringa italiana, punto finale compreso.
  assert.match(ANNULLA.titoloTua, /\?$/u);
  for (const text of [ANNULLA.corpoAperteTua, ANNULLA.corpoChiuseTua]) {
    assert.match(text, /\.$/u, text);
    assert.ok(text.includes("{attivita}"), text);
  }
  assert.ok(ANNULLA.corpoAperteTua.includes("{data}"));
  assert.ok(!ANNULLA.corpoChiuseTua.includes("{data}"));
});
