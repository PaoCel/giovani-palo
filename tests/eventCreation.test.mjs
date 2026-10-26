import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEssentialDraft,
  validateEssentialDraft,
  getPublicationIssues,
} from "../src/utils/eventCreation.ts";

// Attesi dai percorsi della spec ATTIVITA_MODULARI: creare e salvare il
// modulo conserva una bozza privata; pubblicare richiede una scelta separata.
const essential = (overrides = {}) => ({
  title: "Serata insieme",
  activityType: "standard",
  startDate: "2027-01-01T00:30",
  endDate: "2027-01-01T02:00",
  location: "Centro del palo",
  ...overrides,
});

const publishable = (overrides = {}) => ({
  title: "Serata insieme",
  description: "Una serata per conoscersi e stare insieme.",
  startDate: "2027-01-15T18:00:00.000Z",
  endDate: "2027-01-15T21:00:00.000Z",
  location: "Centro del palo",
  registrationOpen: "2027-01-01T09:00:00.000Z",
  registrationClose: "2027-01-14T18:00:00.000Z",
  status: "draft",
  ...overrides,
});

test("pochi dati reali bastano per creare una bozza, non per pubblicarla", () => {
  const values = Object.freeze(essential());
  assert.equal(validateEssentialDraft(values), null);
  const draft = buildEssentialDraft(values);
  assert.equal(draft.status, "draft");
  assert.equal(draft.isPublic, false);
  assert.equal(draft.isVisible, false);
  assert.equal(draft.audience, "congiunta");
  assert.equal(draft.description, "");
  assert.equal(draft.registrationOpen, "");
  assert.equal(draft.registrationClose, "");
  assert.ok(getPublicationIssues(draft).length > 0);
  assert.equal(values.startDate, "2027-01-01T00:30");
});

test("il builder salva istanti ISO e ricava l'anno dal giorno scelto nell'editor", () => {
  const draft = buildEssentialDraft(essential());
  assert.equal(draft.startDate, new Date(2027, 0, 1, 0, 30).toISOString());
  assert.equal(draft.endDate, new Date(2027, 0, 1, 2, 0).toISOString());
  assert.equal(draft.year, 2027);
});

test("nome e luogo vengono ripuliti senza modificare i valori del modulo", () => {
  const values = Object.freeze(essential({ title: "  Serata insieme  ", location: "  Centro del palo  " }));
  const draft = buildEssentialDraft(values);
  assert.equal(draft.title, "Serata insieme");
  assert.equal(draft.location, "Centro del palo");
  assert.equal(values.title, "  Serata insieme  ");
});

test("i valori del palo per accesso ospite e modifica vengono rispettati", () => {
  for (const allowGuestRegistration of [false, true]) {
    for (const requireLoginForEdit of [false, true]) {
      const defaults = Object.freeze({ allowGuestRegistration, requireLoginForEdit });
      const draft = buildEssentialDraft(essential(), defaults);
      assert.equal(draft.allowGuestRegistration, allowGuestRegistration);
      assert.equal(draft.requireLoginForEdit, requireLoginForEdit);
    }
  }
});

test("l'attività semplice non chiede le opzioni di sicurezza delle attività impegnative", () => {
  const draft = buildEssentialDraft(essential());
  for (const field of ["requiresAccount", "requiresParentAuthorization", "requiresEmergencyContacts", "requiresMedicalNotes"]) {
    assert.equal(draft[field], false, field);
  }
  assert.equal(draft.overnight, false);
});

for (const activityType of ["overnight", "trip", "camp", "multi_day"]) {
  test(`${activityType}: i requisiti di sicurezza partono attivi`, () => {
    const draft = buildEssentialDraft(essential({ activityType }));
    assert.equal(draft.activityType, activityType);
    for (const field of ["requiresAccount", "requiresParentAuthorization", "requiresEmergencyContacts", "requiresMedicalNotes"]) {
      assert.equal(draft[field], true, field);
    }
  });
}

test("il pernottamento richiede più giorni e un tipo che lo prevede", () => {
  const overnightDates = { startDate: "2027-06-10T23:00", endDate: "2027-06-11T01:00" };
  for (const activityType of ["overnight", "trip", "camp", "multi_day"]) {
    assert.equal(buildEssentialDraft(essential({ activityType })).overnight, false, `${activityType} nello stesso giorno`);
    assert.equal(buildEssentialDraft(essential({ activityType, ...overnightDates })).overnight, true, `${activityType} attraversa la mezzanotte`);
  }
  assert.equal(buildEssentialDraft(essential({ ...overnightDates })).overnight, false);
});

for (const [label, overrides] of [
  ["nome vuoto", { title: "" }],
  ["nome di soli spazi", { title: " \n\t " }],
  ["luogo di soli spazi", { location: "  \t " }],
  ["inizio assente", { startDate: "" }],
  ["fine assente", { endDate: "" }],
  ["inizio non interpretabile", { startDate: "non-una-data" }],
  ["fine non interpretabile", { endDate: "non-una-data" }],
  ["fine prima dell'inizio", { endDate: "2026-12-31T23:59" }],
]) {
  test(`la creazione segnala ${label}`, () => {
    const error = validateEssentialDraft(essential(overrides));
    assert.equal(typeof error, "string");
    assert.ok(error.trim().length > 0);
  });
}

test("la pubblicazione accetta una bozza completa e non modifica i dati", () => {
  const event = Object.freeze(publishable());
  assert.deepEqual(getPublicationIssues(event), []);
  assert.equal(event.status, "draft");
});

for (const [label, overrides] of [
  ["nome vuoto", { title: "  " }],
  ["luogo vuoto", { location: "  " }],
  ["descrizione vuota", { description: " \n " }],
  ["inizio attività assente", { startDate: "" }],
  ["fine attività assente", { endDate: "" }],
  ["inizio attività invalido", { startDate: "non-una-data" }],
  ["fine attività invalida", { endDate: "non-una-data" }],
  ["date attività invertite", { endDate: "2027-01-15T17:59:59.999Z" }],
  ["apertura iscrizioni assente", { registrationOpen: "" }],
  ["chiusura iscrizioni assente", { registrationClose: "" }],
  ["apertura iscrizioni invalida", { registrationOpen: "non-una-data" }],
  ["chiusura iscrizioni invalida", { registrationClose: "non-una-data" }],
  ["finestra iscrizioni invertita", { registrationClose: "2027-01-01T08:59:59.999Z" }],
  ["attività annullata", { status: "cancelled" }],
  ["attività conclusa", { status: "completed" }],
]) {
  test(`la pubblicazione si ferma con ${label}`, () => {
    const issues = getPublicationIssues(publishable(overrides));
    assert.ok(issues.length > 0);
    for (const issue of issues) assert.ok(typeof issue === "string" && issue.trim());
  });
}

test("l'anteprima segnala insieme i dati rimandati nella creazione essenziale", () => {
  const issues = getPublicationIssues(publishable({
    description: "",
    registrationOpen: "",
    registrationClose: "",
  }));
  assert.ok(issues.length >= 2, "l'admin deve vedere sia descrizione sia finestra mancanti prima di pubblicare");
});
