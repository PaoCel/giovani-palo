import test from "node:test";
import assert from "node:assert/strict";
import {
  validateWizardStep,
  buildWizardPayload,
  buildWizardFormPayload,
  getTypeChangeEffects,
  getDayTypeSuggestion,
  getPublicationChecklist,
  getStepSummaries,
  isStepDirty,
  splitLocalDateTime,
  joinLocalDateTime,
  getInitialWizardValues,
} from "../src/utils/activityWizard.ts";
import { getPublicationIssues } from "../src/utils/eventCreation.ts";
import { EVENT_CREATION as COPY } from "../src/copy/eventCreation.ts";

// Spec: docs/ATTIVITA_MODULARI.md, «Sesto incremento: Crea attività a step».
// Le stringhe datetime-local sono ora locale; gli ISO si costruiscono con
// new Date("...").toISOString() per non dipendere dal fuso della macchina.
const iso = local => new Date(local).toISOString();
const NOW = new Date("2027-01-10T12:00").getTime();
const ALL = new Set(["what", "when", "poster", "registrations", "participants", "review"]);
const VERSIONS = { participation: "p1", privacy: "v1", photo: "f1" };
const ACTIVITY_TYPES = ["standard", "overnight", "camp", "trek", "retreat"];

const values = (overrides = {}) => ({
  ...getInitialWizardValues(null, null, { enabledStandardFields: [] }),
  title: "Gran galà di gennaio",
  startDate: "2027-01-23T19:00",
  endDate: "2027-01-23T23:00",
  location: "Centro del palo",
  ...overrides,
});

const savedEvent = (overrides = {}) => ({
  id: "ev1",
  title: "Titolo salvato",
  description: "Descrizione salvata.",
  year: 2027,
  audience: "congiunta",
  startDate: iso("2027-01-23T19:00"),
  endDate: iso("2027-01-23T23:00"),
  location: "Luogo salvato",
  program: "Programma salvato",
  publicNotes: "Nota pubblica",
  organizerNotes: "",
  menuInfo: "",
  allergiesInfo: "",
  roomsInfo: "",
  whatToBring: "",
  heroImageUrl: "",
  heroImagePath: "",
  status: "draft",
  isPublic: false,
  isVisible: false,
  registrationOpen: iso("2027-01-05T09:00"),
  registrationClose: iso("2027-01-20T18:00"),
  maxParticipants: null,
  overnight: false,
  activityType: "standard",
  requiresAccount: false,
  requiresParentAuthorization: false,
  requiresEmergencyContacts: false,
  requiresMedicalNotes: false,
  ...overrides,
});

// ---------- validateWizardStep ----------

test("step 1: il nome è obbligatorio, anche se fatto di soli spazi", () => {
  assert.equal(validateWizardStep("what", values({ title: "" })).title, COPY.errors.title);
  assert.equal(validateWizardStep("what", values({ title: "   " })).title, COPY.errors.title);
  assert.deepEqual(validateWizardStep("what", values()), {});
});

test("step 2: inizio, fine e luogo sono obbligatori", () => {
  const e = validateWizardStep("when", values({ startDate: "", endDate: "", location: " " }));
  assert.equal(e.startDate, COPY.errors.start);
  assert.equal(e.endDate, COPY.errors.end);
  assert.equal(e.location, COPY.errors.location);
  assert.deepEqual(validateWizardStep("when", values()), {});
});

test("step 2: con locationOptional il luogo non è chiesto, senza flag sì", () => {
  const missing = values({ location: "" });
  assert.equal(validateWizardStep("when", missing).location, COPY.errors.location);
  assert.equal(validateWizardStep("when", missing, { locationOptional: false }).location, COPY.errors.location);
  assert.equal(validateWizardStep("when", missing, { locationOptional: true }).location, undefined);
  assert.deepEqual(validateWizardStep("when", missing, { locationOptional: true }), {});
  assert.equal(validateWizardStep("when", values({ location: "  " }), { locationOptional: true }).location, undefined);
});

test("step 2: la fine prima dell'inizio è rifiutata, a pari data no", () => {
  const before = validateWizardStep("when", values({ endDate: "2027-01-23T18:00" }));
  assert.equal(before.endDate, COPY.errors.endBeforeStart);
  assert.deepEqual(validateWizardStep("when", values({ endDate: "2027-01-23T19:00" })), {});
});

test("step 4: le iscrizioni sono facoltative, ma la chiusura non precede l'apertura", () => {
  assert.deepEqual(validateWizardStep("registrations", values()), {});
  const e = validateWizardStep("registrations", values({
    registrationOpen: "2027-01-15T09:00", registrationClose: "2027-01-14T09:00",
  }));
  assert.equal(e.registrationClose, COPY.errors.closeBeforeOpen);
  assert.deepEqual(validateWizardStep("registrations", values({
    registrationOpen: "2027-01-14T09:00", registrationClose: "2027-01-14T09:00",
  })), {});
});

test("step 4: maxParticipants vuoto va bene, solo interi da 1 in su", () => {
  const check = max => validateWizardStep("registrations", values({ maxParticipants: max })).maxParticipants;
  for (const ok of ["", "  ", "1", "40"]) assert.equal(check(ok), undefined, `"${ok}" deve passare`);
  for (const bad of ["0", "-1", "1.5", "abc", "1e3", "4 0"]) {
    assert.equal(check(bad), COPY.errors.maxParticipants, `"${bad}" deve essere rifiutato`);
  }
});

test("step 4: una domanda personalizzata senza testo è un errore sul suo campo", () => {
  const e = validateWizardStep("registrations", values({
    customFields: [
      { id: "a", key: "a", label: "Taglia maglia", type: "text", required: false },
      { id: "b", key: "", label: "  ", type: "text", required: false },
    ],
  }));
  assert.equal(e["customField:b"], COPY.errors.questionLabel);
  assert.equal(e["customField:a"], undefined);
});

test("step 5: record che chiudono dopo la fine dell'attività sono rifiutati, solo a record accesi", () => {
  const late = { recordsCloseAt: "2027-01-24T08:00" };
  assert.equal(validateWizardStep("participants", values({ ...late, recordsEnabled: true })).recordsCloseAt, COPY.errors.recordsClose);
  assert.equal(validateWizardStep("participants", values({ ...late, recordsEnabled: false })).recordsCloseAt, undefined);
  assert.equal(validateWizardStep("participants", values({ recordsCloseAt: "2027-01-23T22:00", recordsEnabled: true })).recordsCloseAt, undefined);
});

test("step 5: record senza account senza revisione dei titoli sono rifiutati", () => {
  const on = values({ recordsEnabled: true, recordsGuestEnabled: true });
  assert.equal(validateWizardStep("participants", on, { guestReviewMissing: true }).recordsGuestReviewed, COPY.errors.guestReview);
  assert.equal(validateWizardStep("participants", on, { guestReviewMissing: false }).recordsGuestReviewed, undefined);
  assert.equal(validateWizardStep("participants", on).recordsGuestReviewed, undefined);
  // Record spenti o senza account: la spunta non serve.
  assert.equal(validateWizardStep("participants", values({ recordsEnabled: false, recordsGuestEnabled: true }), { guestReviewMissing: true }).recordsGuestReviewed, undefined);
  assert.equal(validateWizardStep("participants", values({ recordsEnabled: true, recordsGuestEnabled: false }), { guestReviewMissing: true }).recordsGuestReviewed, undefined);
});

test("gli step 3 e 6 non hanno errori di campo", () => {
  assert.deepEqual(validateWizardStep("poster", values({ title: "" })), {});
  assert.deepEqual(validateWizardStep("review", values({ title: "" })), {});
});

// ---------- buildWizardPayload ----------

test("payload: i campi vengono da values solo per gli step in fromSteps", () => {
  const saved = savedEvent();
  const v = values({ title: "Nuovo", location: "Nuovo luogo", description: "Nuova", program: "Nuovo programma" });
  const p = buildWizardPayload(v, saved, new Set(["what"]), VERSIONS);
  assert.equal(p.title, "Nuovo");
  assert.equal(p.location, "Luogo salvato");
  assert.equal(p.description, "Descrizione salvata.");
  assert.equal(p.program, "Programma salvato");
  assert.equal(p.startDate, saved.startDate);
});

test("payload: uno step non valido lasciato con Indietro non entra nel salvataggio di un altro", () => {
  const saved = savedEvent();
  // Lo step 2 è in memoria con fine prima dell'inizio e luogo vuoto.
  const v = values({ endDate: "2027-01-22T10:00", location: "", description: "Descrizione nuova" });
  const p = buildWizardPayload(v, saved, new Set(["poster"]), VERSIONS);
  assert.equal(p.description, "Descrizione nuova");
  assert.equal(p.endDate, saved.endDate);
  assert.equal(p.location, "Luogo salvato");
});

test("payload: l'anno si ricava dall'inizio", () => {
  const p = buildWizardPayload(values({ startDate: "2028-03-05T10:00", endDate: "2028-03-05T12:00" }), null, ALL, VERSIONS);
  assert.equal(p.year, 2028);
  assert.equal(p.startDate, iso("2028-03-05T10:00"));
});

test("payload: pernottamento solo per i tipi non standard su due giorni di calendario", () => {
  const span = { startDate: "2027-01-23T19:00", endDate: "2027-01-24T10:00" };
  const one = { startDate: "2027-01-23T09:00", endDate: "2027-01-23T22:00" };
  for (const type of ACTIVITY_TYPES) {
    const strong = type !== "standard";
    assert.equal(buildWizardPayload(values({ activityType: type, ...span }), null, ALL, VERSIONS).overnight, strong, `${type} su due giorni`);
    assert.equal(buildWizardPayload(values({ activityType: type, ...one }), null, ALL, VERSIONS).overnight, false, `${type} in un giorno`);
  }
});

test("payload: roomsInfo si svuota senza pernottamento, si tiene con", () => {
  const span = { startDate: "2027-01-23T19:00", endDate: "2027-01-24T10:00" };
  const withRooms = { roomsInfo: " Stanza 1 ", activityType: "overnight" };
  assert.equal(buildWizardPayload(values({ ...withRooms, ...span }), null, ALL, VERSIONS).roomsInfo, "Stanza 1");
  assert.equal(buildWizardPayload(values({ ...withRooms }), null, ALL, VERSIONS).roomsInfo, "");
  assert.equal(buildWizardPayload(values({ roomsInfo: "x", activityType: "standard", ...span }), null, ALL, VERSIONS).roomsInfo, "");
});

test("payload: requireLoginForEdit acceso sulle attività nuove, le esistenti restano come sono (decisione 4)", () => {
  assert.equal(buildWizardPayload(values(), null, ALL, VERSIONS).requireLoginForEdit, true);
  assert.equal(buildWizardPayload(values(), savedEvent({ requireLoginForEdit: false }), ALL, VERSIONS).requireLoginForEdit, false);
  assert.equal(buildWizardPayload(values(), savedEvent({ requireLoginForEdit: true }), ALL, VERSIONS).requireLoginForEdit, true);
  assert.equal(buildWizardPayload(values(), savedEvent(), ALL, VERSIONS).requireLoginForEdit, true, "senza campo");
});

test("payload: una bozza nuova prende i default del palo per gli step non ancora compilati", () => {
  const p = buildWizardPayload(values({ allowGuestRegistration: true }), null, new Set(["what", "when"]), VERSIONS, { allowGuestRegistration: false });
  assert.equal(p.allowGuestRegistration, false);
});

test("payload: con requiresAccount niente iscrizione senza account", () => {
  assert.equal(buildWizardPayload(values({ requiresAccount: true, allowGuestRegistration: true }), null, ALL, VERSIONS).allowGuestRegistration, false);
  assert.equal(buildWizardPayload(values({ requiresAccount: false, allowGuestRegistration: true }), null, ALL, VERSIONS).allowGuestRegistration, true);
  assert.equal(buildWizardPayload(values({ requiresAccount: false, allowGuestRegistration: false }), null, ALL, VERSIONS).allowGuestRegistration, false);
});

test("payload: una bozza resta bozza e privata, anche senza attività salvata", () => {
  for (const saved of [null, savedEvent()]) {
    const p = buildWizardPayload(values(), saved, ALL, VERSIONS);
    assert.equal(p.status, "draft");
    assert.equal(p.isPublic, false);
    assert.equal(p.isVisible, false);
  }
});

test("payload: planned resta planned, registrations_open resta, bozza resta bozza", () => {
  const planned = buildWizardPayload(values(), savedEvent({ status: "planned", isPublic: true, isVisible: true }), ALL, VERSIONS);
  assert.equal(planned.status, "planned");
  assert.equal(planned.isPublic, true);
  assert.equal(planned.isVisible, true);

  const open = buildWizardPayload(values(), savedEvent({ status: "registrations_open", isPublic: true, isVisible: true }), ALL, VERSIONS);
  assert.equal(open.status, "registrations_open");
  assert.equal(open.isPublic, true);
  assert.equal(open.isVisible, true);

  for (const saved of [null, savedEvent({ status: "draft", isPublic: false })]) {
    const draft = buildWizardPayload(values(), saved, ALL, VERSIONS);
    assert.equal(draft.status, "draft");
    assert.equal(draft.isPublic, false);
  }
});

test("payload: altre pubbliche non annullate tornano registrations_open, con la visibilità di prima", () => {
  for (const status of ["registrations_closed", "published"]) {
    const p = buildWizardPayload(values(), savedEvent({ status, isPublic: true, isVisible: true }), ALL, VERSIONS);
    assert.equal(p.status, "registrations_open", status);
    assert.equal(p.isPublic, true);
    assert.equal(p.isVisible, true);
  }
  const hidden = buildWizardPayload(values(), savedEvent({ status: "registrations_open", isPublic: true, isVisible: false }), ALL, VERSIONS);
  assert.equal(hidden.isVisible, false);
});

test("payload: annullata o conclusa mantiene lo stato, pubblica o no", () => {
  for (const status of ["cancelled", "completed"]) {
    const pub = buildWizardPayload(values(), savedEvent({ status, isPublic: true, isVisible: true }), ALL, VERSIONS);
    assert.equal(pub.status, status);
    assert.equal(pub.isPublic, true);
    const priv = buildWizardPayload(values(), savedEvent({ status, isPublic: false }), ALL, VERSIONS);
    assert.equal(priv.status, status);
    assert.equal(priv.isPublic, false);
  }
});

test("payload: i flag legacy requiresParentalConsent e requiresPhotoRelease sono sempre false", () => {
  const saved = savedEvent({ requiresParentalConsent: true, requiresPhotoRelease: true });
  const p = buildWizardPayload(values({ requiresImageConsent: true }), saved, ALL, VERSIONS);
  assert.equal(p.requiresParentalConsent, false);
  assert.equal(p.requiresPhotoRelease, false);
  assert.equal(p.requiresImageConsent, true);
});

test("payload: recordsGuestEnabled è false a record spenti, la data di chiusura sopravvive", () => {
  const off = buildWizardPayload(values({ recordsEnabled: false, recordsGuestEnabled: true, recordsCloseAt: "2027-01-23T22:00" }), null, ALL, VERSIONS);
  assert.equal(off.recordsGuestEnabled, false);
  assert.equal(off.recordsCloseAt, iso("2027-01-23T22:00"));
  const on = buildWizardPayload(values({ recordsEnabled: true, recordsGuestEnabled: true }), null, ALL, VERSIONS);
  assert.equal(on.recordsGuestEnabled, true);
  assert.equal(on.recordsCloseAt, null);
});

test("payload: publicNotes dell'attività salvata si conserva", () => {
  assert.equal(buildWizardPayload(values(), savedEvent({ publicNotes: "Da conservare" }), ALL, VERSIONS).publicNotes, "Da conservare");
  assert.equal(buildWizardPayload(values(), null, ALL, VERSIONS).publicNotes, "");
});

test("payload: maxParticipants numero o null, testi tagliati", () => {
  assert.equal(buildWizardPayload(values({ maxParticipants: " 25 " }), null, ALL, VERSIONS).maxParticipants, 25);
  assert.equal(buildWizardPayload(values({ maxParticipants: "" }), null, ALL, VERSIONS).maxParticipants, null);
  assert.equal(buildWizardPayload(values({ title: "  Galà  ", location: " Sala " }), null, ALL, VERSIONS).title, "Galà");
});

test("payload: le versioni di consenso salvate vincono su quelle nuove", () => {
  const p = buildWizardPayload(values(), savedEvent({ consentVersionId: "vecchia" }), ALL, VERSIONS);
  assert.equal(p.consentVersionId, "vecchia");
  assert.equal(p.privacyNoticeVersionId, "v1");
});

// ---------- buildWizardFormPayload ----------

test("modulo: la chiave di un campo esistente non cambia con l'etichetta", () => {
  const out = buildWizardFormPayload(values({
    customFields: [{ id: "f1", key: "chiave_originale", label: "Etichetta cambiata", type: "text", required: false }],
  }));
  assert.equal(out.customFields[0].key, "chiave_originale");
  assert.equal(out.customFields[0].label, "Etichetta cambiata");
});

test("modulo: un campo nuovo senza chiave ne riceve una", () => {
  const out = buildWizardFormPayload(values({
    customFields: [
      { id: "f2", key: "", label: "Taglia maglia", type: "text", required: false },
      { id: "f3", key: "", label: "???", type: "text", required: false },
    ],
  }));
  assert.ok(out.customFields[0].key.length > 0);
  assert.ok(out.customFields[1].key.length > 0, "anche con etichetta non sluggabile");
});

test("modulo: due domande nuove con la stessa etichetta hanno chiavi diverse", () => {
  const out = buildWizardFormPayload(values({
    customFields: [
      { id: "n1", key: "", label: "Taglia", type: "text", required: false },
      { id: "n2", key: "", label: "Taglia", type: "text", required: false },
    ],
  }));
  assert.notEqual(out.customFields[0].key, out.customFields[1].key);
  assert.ok(out.customFields.every(f => f.key.length > 0));
});

test("modulo: una domanda nuova non riusa la chiave di un campo standard attivo né di una domanda esistente", () => {
  const out = buildWizardFormPayload(values({
    enabledStandardFields: ["phone"],
    customFields: [
      { id: "e1", key: "city", label: "Altro", type: "text", required: false },
      { id: "n1", key: "", label: "Phone", type: "text", required: false },
      { id: "n2", key: "", label: "City", type: "text", required: false },
    ],
  }));
  const keys = out.customFields.map(f => f.key);
  assert.equal(keys[0], "city", "la chiave esistente non cambia");
  assert.notEqual(keys[1], "phone");
  assert.notEqual(keys[2], "city");
  assert.equal(new Set(keys).size, 3);
  assert.ok(!keys.slice(1).includes("phone"));
});

test("modulo: opzioni dei select ripulite, quelle degli altri tipi svuotate", () => {
  const out = buildWizardFormPayload(values({
    customFields: [
      { id: "s", key: "s", label: "Scelta", type: "select", required: false, options: [" Sì ", "", "  ", "No"] },
      { id: "t", key: "t", label: "Testo", type: "text", required: false, options: ["resto", "vecchio"] },
    ],
  }));
  assert.deepEqual(out.customFields[0].options, ["Sì", "No"]);
  assert.deepEqual(out.customFields[1].options, []);
});

test("modulo: allowGuestRegistration è false con requiresAccount", () => {
  assert.equal(buildWizardFormPayload(values({ requiresAccount: true, allowGuestRegistration: true })).allowGuestRegistration, false);
  assert.equal(buildWizardFormPayload(values({ requiresAccount: false, allowGuestRegistration: true })).allowGuestRegistration, true);
});

// ---------- getTypeChangeEffects ----------

test("cambio di tipo: tutte le 25 coppie", () => {
  for (const from of ACTIVITY_TYPES) {
    for (const to of ACTIVITY_TYPES) {
      const effects = getTypeChangeEffects(from, to, { roomsInfo: "Stanza 1" });
      const sameClass = (from === "standard") === (to === "standard");
      if (sameClass) { assert.equal(effects, null, `${from} -> ${to}`); continue; }
      const toStrong = to !== "standard";
      assert.equal(effects.turnsOn, toStrong, `${from} -> ${to}`);
      assert.equal(effects.clearsRooms, !toStrong, `${from} -> ${to}`);
      for (const key of ["requiresAccount", "requiresParentAuthorization", "requiresEmergencyContacts", "requiresMedicalNotes"]) {
        assert.equal(effects.requirements[key], toStrong, `${from} -> ${to} ${key}`);
      }
    }
  }
});

test("cambio di tipo: l'alloggio si cancella solo se c'è del testo", () => {
  assert.equal(getTypeChangeEffects("overnight", "standard", { roomsInfo: "" }).clearsRooms, false);
  assert.equal(getTypeChangeEffects("overnight", "standard", { roomsInfo: "   " }).clearsRooms, false);
  assert.equal(getTypeChangeEffects("overnight", "standard", { roomsInfo: "Stanza" }).clearsRooms, true);
  assert.equal(getTypeChangeEffects("standard", "camp", { roomsInfo: "Stanza" }).clearsRooms, false);
});

// ---------- getDayTypeSuggestion ----------

test("suggerimento: in giornata che finisce il giorno dopo propone il pernottamento", () => {
  assert.equal(getDayTypeSuggestion({ activityType: "standard", startDate: "2027-01-23T19:00", endDate: "2027-01-24T10:00" }), "overnight");
});

test("suggerimento: pernottamento in un giorno solo propone in giornata", () => {
  assert.equal(getDayTypeSuggestion({ activityType: "overnight", startDate: "2027-01-23T09:00", endDate: "2027-01-23T22:00" }), "standard");
});

test("suggerimento: nessuno quando tipo e date concordano, per altri tipi o date non valide", () => {
  const span = { startDate: "2027-01-23T19:00", endDate: "2027-01-24T10:00" };
  const one = { startDate: "2027-01-23T09:00", endDate: "2027-01-23T22:00" };
  assert.equal(getDayTypeSuggestion({ activityType: "standard", ...one }), null);
  assert.equal(getDayTypeSuggestion({ activityType: "overnight", ...span }), null);
  for (const type of ["camp", "trek", "retreat"]) {
    assert.equal(getDayTypeSuggestion({ activityType: type, ...span }), null, type);
    assert.equal(getDayTypeSuggestion({ activityType: type, ...one }), null, type);
  }
  assert.equal(getDayTypeSuggestion({ activityType: "standard", startDate: "", endDate: "2027-01-24T10:00" }), null);
  assert.equal(getDayTypeSuggestion({ activityType: "standard", startDate: "2027-01-23T19:00", endDate: "" }), null);
  assert.equal(getDayTypeSuggestion({ activityType: "standard", startDate: "boh", endDate: "2027-01-24T10:00" }), null);
  // Fine prima dell'inizio: nessun suggerimento.
  assert.equal(getDayTypeSuggestion({ activityType: "standard", startDate: "2027-01-24T19:00", endDate: "2027-01-23T10:00" }), null);
});

// ---------- getPublicationChecklist ----------

const publishable = (overrides = {}) => savedEvent({ registrationClose: iso("2027-01-20T18:00"), ...overrides });

test("checklist: un'attività pronta non ha voci", () => {
  assert.deepEqual(getPublicationChecklist(publishable(), NOW), []);
});

test("checklist: i messaggi sono quelli di getPublicationIssues, con lo step che li risolve", () => {
  const cases = [
    [{ title: "" }, "what"],
    [{ location: "" }, "when"],
    [{ startDate: "" }, "when"],
    [{ endDate: iso("2027-01-22T10:00") }, "when"],
    [{ description: "  " }, "poster"],
    [{ registrationOpen: "" }, "registrations"],
    [{ registrationClose: "" }, "registrations"],
    [{ registrationOpen: iso("2027-01-21T09:00"), registrationClose: iso("2027-01-20T09:00") }, "registrations"],
  ];
  for (const [overrides, step] of cases) {
    const event = publishable(overrides);
    const issues = getPublicationIssues(event);
    assert.ok(issues.length > 0, JSON.stringify(overrides));
    const checks = getPublicationChecklist(event, NOW);
    assert.deepEqual(checks.map(c => c.message), issues, JSON.stringify(overrides));
    assert.ok(checks.every(c => c.step === step), `${JSON.stringify(overrides)} -> ${step}, ottenuto ${checks.map(c => c.step)}`);
  }
});

test("checklist: più mancanze, ognuna con il suo step", () => {
  const event = publishable({ title: "", description: "", registrationClose: "" });
  const checks = getPublicationChecklist(event, NOW);
  assert.deepEqual(checks.map(c => c.message), getPublicationIssues(event));
  const steps = new Set(checks.map(c => c.step));
  assert.ok(steps.has("what") && steps.has("poster") && steps.has("registrations"));
});

test("checklist: la chiusura iscrizioni già passata aggiunge la voce, solo per la pubblicazione", () => {
  const event = publishable({ registrationClose: iso("2027-01-09T18:00"), registrationOpen: iso("2027-01-05T09:00") });
  assert.deepEqual(getPublicationIssues(event), [], "il gate del servizio non guarda il passato");
  const checks = getPublicationChecklist(event, NOW);
  assert.deepEqual(checks, [{ step: "registrations", message: COPY.closePassed }]);
  // Con la chiusura nel futuro la voce non c'è.
  assert.deepEqual(getPublicationChecklist(event, new Date("2027-01-08T12:00").getTime()), []);
});

test("checklist: la chiusura passata non si somma a un errore di iscrizioni già segnalato", () => {
  const event = publishable({ registrationOpen: iso("2027-01-09T09:00"), registrationClose: iso("2027-01-08T09:00") });
  const checks = getPublicationChecklist(event, NOW);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].message, getPublicationIssues(event)[0]);
});

test("checklist: annullata o conclusa rimanda al riepilogo", () => {
  for (const status of ["cancelled", "completed"]) {
    const checks = getPublicationChecklist(publishable({ status }), NOW);
    assert.deepEqual(checks, [{ step: "review", message: COPY.cancelled }], status);
  }
});

// ---------- getStepSummaries ----------

test("riepilogo senza bozza: step 1-2 da fare, 3-6 bloccati", () => {
  const s = getStepSummaries(null, NOW);
  assert.equal(s.length, 6);
  assert.deepEqual(s.map(x => x.state), ["todo", "todo", "locked", "locked", "locked", "locked"]);
  assert.ok(s.slice(2).every(x => x.label === COPY.index.locked));
  assert.ok(s.slice(0, 2).every(x => x.label === COPY.index.todo));
});

test("riepilogo con bozza completa: step fatti, partecipanti facoltativo, riepilogo da fare", () => {
  const s = getStepSummaries(publishable(), NOW);
  assert.deepEqual(s.map(x => x.step), ["what", "when", "poster", "registrations", "participants", "review"]);
  const state = Object.fromEntries(s.map(x => [x.step, x.state]));
  assert.equal(state.what, "done");
  assert.equal(state.when, "done");
  assert.equal(state.poster, "done");
  assert.equal(state.registrations, "done");
  assert.equal(state.participants, "done");
  assert.equal(state.review, "todo");
});

test("riepilogo: senza programma né altro lo step 5 è facoltativo, con un campo compilato è fatto", () => {
  const empty = getStepSummaries(publishable({ program: "" }), NOW).find(x => x.step === "participants");
  assert.equal(empty.state, "optional");
  assert.equal(empty.label, COPY.index.optional);
  const filled = getStepSummaries(publishable({ program: "", whatToBring: "Sacco a pelo" }), NOW).find(x => x.step === "participants");
  assert.equal(filled.state, "done");
  assert.equal(filled.label, COPY.index.done);
});

test("riepilogo: senza descrizione la locandina è da fare con «Manca la descrizione»", () => {
  const poster = getStepSummaries(publishable({ description: "" }), NOW).find(x => x.step === "poster");
  assert.equal(poster.state, "todo");
  assert.equal(poster.label, "Manca la descrizione");
});

test("riepilogo: mancanze negli step 1, 2, 4 li segnano da completare", () => {
  const byStep = overrides => Object.fromEntries(getStepSummaries(publishable(overrides), NOW).map(x => [x.step, x.state]));
  assert.equal(byStep({ title: "" }).what, "todo");
  assert.equal(byStep({ location: "" }).when, "todo");
  assert.equal(byStep({ registrationClose: "" }).registrations, "todo");
  assert.equal(byStep({ registrationClose: iso("2027-01-09T09:00") }).registrations, "todo", "chiusura passata");
});

test("riepilogo: pubblicata, il riepilogo è fatto con etichetta «Pubblicata»", () => {
  const review = getStepSummaries(publishable({ isPublic: true, status: "registrations_open" }), NOW).find(x => x.step === "review");
  assert.equal(review.state, "done");
  assert.equal(review.label, COPY.index.published);
});

test("riepilogo: planned, lo step review resta da fare", () => {
  const review = getStepSummaries(publishable({ isPublic: true, status: "planned" }), NOW).find(x => x.step === "review");
  assert.equal(review.state, "todo");
});

// ---------- isStepDirty ----------

test("isStepDirty guarda solo i campi dello step", () => {
  const saved = values();
  const changed = values({ title: "Altro", customFields: [{ id: "x", key: "x", label: "Q", type: "text", required: false }] });
  assert.equal(isStepDirty("what", changed, saved), true);
  assert.equal(isStepDirty("when", changed, saved), false);
  assert.equal(isStepDirty("registrations", changed, saved), true);
  assert.equal(isStepDirty("review", changed, saved), false);
  assert.equal(isStepDirty("what", saved, values()), false);
  assert.equal(isStepDirty("registrations", values({ enabledStandardFields: ["unitName"] }), saved), true);
});

// ---------- splitLocalDateTime / joinLocalDateTime ----------

test("split e join del valore datetime-local", () => {
  assert.deepEqual(splitLocalDateTime("2027-01-23T19:00"), { date: "2027-01-23", time: "19:00" });
  assert.deepEqual(splitLocalDateTime("2027-01-23T19:00:30"), { date: "2027-01-23", time: "19:00" });
  assert.deepEqual(splitLocalDateTime(""), { date: "", time: "" });
  assert.deepEqual(splitLocalDateTime("2027-01-23"), { date: "2027-01-23", time: "" });
  assert.equal(joinLocalDateTime("2027-01-23", "19:00", "09:00"), "2027-01-23T19:00");
  assert.equal(joinLocalDateTime("2027-01-23", "", "09:00"), "2027-01-23T09:00");
  assert.equal(joinLocalDateTime("", "19:00", "09:00"), "");
});

// ---------- getInitialWizardValues ----------

test("valori iniziali di una nuova attività", () => {
  const v = getInitialWizardValues(null, null);
  assert.equal(v.title, "");
  assert.equal(v.activityType, "standard");
  assert.equal(v.audience, "congiunta");
  assert.equal(v.startDate, "");
  assert.equal(v.maxParticipants, "");
  assert.equal(v.requiresAccount, false);
  assert.equal(v.allowGuestRegistration, true);
  assert.equal(v.recordsEnabled, false);
  assert.deepEqual(v.customFields, []);
});

test("valori iniziali: i default del palo si usano solo senza configurazione", () => {
  const v = getInitialWizardValues(null, null, { allowGuestRegistration: false, enabledStandardFields: ["unitName"] });
  assert.equal(v.allowGuestRegistration, false);
  assert.deepEqual(v.enabledStandardFields, ["unitName"]);
  const c = getInitialWizardValues(null, { allowGuestRegistration: true, enabledStandardFields: ["phone"], customFields: [] }, { allowGuestRegistration: false });
  assert.equal(c.allowGuestRegistration, true);
  assert.deepEqual(c.enabledStandardFields, ["phone"]);
});

test("valori iniziali di un'attività legacy: overnight true senza activityType diventa «overnight»", () => {
  const legacy = savedEvent({ activityType: undefined, overnight: true, maxParticipants: 30 });
  for (const key of ["activityType", "requiresAccount", "requiresParentAuthorization", "requiresEmergencyContacts", "requiresMedicalNotes"]) delete legacy[key];
  const v = getInitialWizardValues(legacy, null);
  assert.equal(v.activityType, "overnight");
  assert.equal(v.requiresAccount, true, "tipo rafforzato: requisiti accesi se il campo manca");
  assert.equal(v.maxParticipants, "30");
  assert.equal(v.startDate, "2027-01-23T19:00");
  assert.equal(v.endDate, "2027-01-23T23:00");
  const plain = savedEvent({ overnight: false });
  delete plain.activityType;
  assert.equal(getInitialWizardValues(plain, null).activityType, "standard");
});

test("valori iniziali: il consenso foto legacy requiresPhotoRelease alimenta requiresImageConsent", () => {
  assert.equal(getInitialWizardValues(savedEvent({ requiresPhotoRelease: true }), null).requiresImageConsent, true);
  assert.equal(getInitialWizardValues(savedEvent({ requiresImageConsent: false, requiresPhotoRelease: true }), null).requiresImageConsent, false);
});

test("andata e ritorno: valori iniziali di un'attività salvata ricostruiscono lo stesso payload", () => {
  const saved = savedEvent({ activityType: "overnight", overnight: true, endDate: iso("2027-01-24T10:00"), roomsInfo: "Stanza 1", maxParticipants: 12 });
  const p = buildWizardPayload(getInitialWizardValues(saved, null), saved, ALL, VERSIONS);
  assert.equal(p.startDate, saved.startDate);
  assert.equal(p.endDate, saved.endDate);
  assert.equal(p.roomsInfo, "Stanza 1");
  assert.equal(p.maxParticipants, 12);
  assert.equal(p.overnight, true);
});

// ---------- timeToBeDefined ----------

test("valori iniziali: timeToBeDefined arriva dall'attività salvata", () => {
  assert.equal(getInitialWizardValues(null, null).timeToBeDefined, false);
  assert.equal(getInitialWizardValues(savedEvent(), null).timeToBeDefined, false);
  assert.equal(getInitialWizardValues(savedEvent({ timeToBeDefined: true }), null).timeToBeDefined, true);
  assert.equal(getInitialWizardValues(savedEvent({ timeToBeDefined: false }), null).timeToBeDefined, false);
});

test("payload: timeToBeDefined resta true se la fine è 23:59, diventa false con un'altra ora", () => {
  const defined = buildWizardPayload(values({ timeToBeDefined: true, endDate: "2027-01-23T23:59" }), null, ALL, VERSIONS);
  assert.equal(defined.timeToBeDefined, true);
  const other = buildWizardPayload(values({ timeToBeDefined: true, endDate: "2027-01-23T23:00" }), null, ALL, VERSIONS);
  assert.equal(other.timeToBeDefined, false);
  const off = buildWizardPayload(values({ timeToBeDefined: false, endDate: "2027-01-23T23:59" }), null, ALL, VERSIONS);
  assert.equal(off.timeToBeDefined, false);
});

test("payload: timeToBeDefined non si tocca se lo step when non è in fromSteps", () => {
  const announced = savedEvent({
    timeToBeDefined: true,
    startDate: iso("2027-01-23T00:00"),
    endDate: iso("2027-01-23T23:59"),
    status: "planned",
    isPublic: true,
    isVisible: true,
  });
  const dirtyWhen = values({ timeToBeDefined: false, startDate: "2027-01-23T19:00", endDate: "2027-01-23T22:00" });
  const p = buildWizardPayload(dirtyWhen, announced, new Set(["poster"]), VERSIONS);
  assert.equal(p.timeToBeDefined, true);
  assert.equal(p.startDate, announced.startDate);
  assert.equal(p.endDate, announced.endDate);

  const timed = savedEvent({ timeToBeDefined: false, endDate: iso("2027-01-23T23:00") });
  const keepFalse = buildWizardPayload(values({ timeToBeDefined: true, endDate: "2027-01-23T23:59" }), timed, new Set(["what"]), VERSIONS);
  assert.equal(keepFalse.timeToBeDefined, false);
});
