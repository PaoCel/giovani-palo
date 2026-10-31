// Quarto incremento di docs/ATTIVITA_MODULARI.md: comitati e gruppi liberi.
// Test puri (nessun emulatore) scritti dal contratto della spec, non dal codice:
// le costanti (ID storici, limiti, messaggio) sono ripetute qui in chiaro.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  normalizeCampConfiguration,
  readPlanFormat,
  assertLegacyPlanEditable,
  isValidCommitteeId,
  isHistoricCommitteeId,
  CampConfigurationError,
} = require("../lib/campConfiguration.js");
const {
  normalizeCampManagement,
  historicCommittees,
  buildCommitteeAssignments,
  toRosterEntry,
  resolvePlanAccess,
} = require("../lib/campManagement.js");

const HISTORIC = ["logistics", "wellbeing", "kitchen", "games", "spiritual"];
const LEGACY_MESSAGE = "Questa versione dell'app non può modificare il piano. Ricarica la pagina per aggiornarla.";
const REVISION = "2026-10-31T10:00:00.000Z";
const ACTIVITY_TYPES = ["standard", "overnight", "trip", "camp", "multi_day"];

const failure = (code) => (error) => error instanceof CampConfigurationError && error.code === code;
const invalid = (action, label) => assert.throws(action, failure("invalid-argument"), label);
const cid = (length = 8, char = "a") => `c_${char.repeat(length)}`;
const committee = (id, extra = {}) => ({ id, title: `Titolo ${id}`, ...extra });
const format2 = (committees, previous = {}, extra = {}) =>
  normalizeCampConfiguration({ committees, ...extra }, previous, { planFormat: 2 });
const historicPlan = (extra = {}) => ({
  groupLabel: "pattuglia",
  updatedAt: REVISION,
  committees: HISTORIC.map((id) => committee(id)),
  ...extra,
});

// ---------------------------------------------------------------------------
// planFormat
// ---------------------------------------------------------------------------

test("readPlanFormat: senza planFormat è il formato precedente, con o senza revisione", () => {
  for (const data of [undefined, null, {}, { plan: {} }, { plan: {}, expectedUpdatedAt: null }, { expectedUpdatedAt: REVISION }]) {
    assert.equal(readPlanFormat(data), 1, JSON.stringify(data));
  }
});

test("readPlanFormat: formato 2 accetta la revisione stringa o null esplicito", () => {
  assert.equal(readPlanFormat({ planFormat: 2, expectedUpdatedAt: null }), 2);
  assert.equal(readPlanFormat({ planFormat: 2, expectedUpdatedAt: REVISION }), 2);
  assert.equal(readPlanFormat({ planFormat: 2, plan: {}, expectedUpdatedAt: REVISION, stakeId: "x" }), 2);
});

test("readPlanFormat: formato 2 senza revisione (campo assente) è invalid-argument", () => {
  invalid(() => readPlanFormat({ planFormat: 2 }));
  invalid(() => readPlanFormat({ planFormat: 2, plan: {} }));
});

test("readPlanFormat: formato 2 con revisione non stringa è invalid-argument", () => {
  for (const expectedUpdatedAt of [42, true, {}, [], 0]) {
    invalid(() => readPlanFormat({ planFormat: 2, expectedUpdatedAt }), JSON.stringify(expectedUpdatedAt));
  }
});

// Il formato 1 esplicito e null non sono specificati dal contratto: non asseriti.
test("readPlanFormat: valori di formato sconosciuti sono invalid-argument", () => {
  for (const planFormat of [0, 3, -1, 2.5, NaN, "2", "1", true, {}, [2]]) {
    invalid(() => readPlanFormat({ planFormat, expectedUpdatedAt: null }), String(planFormat));
  }
});

// ---------------------------------------------------------------------------
// ID dei comitati
// ---------------------------------------------------------------------------

const VALID_IDS = [
  ...HISTORIC,
  cid(8),
  cid(32),
  `c_${"a1b2".repeat(4)}`,
  "c_12345678",
  `c_${"0".repeat(20)}`,
];
const INVALID_IDS = [
  "", "c_", cid(7), cid(33), cid(40), "C_abcdefgh", "c_ABCDEFGH", "c_abcdefg-", "c_abcdefg_", "c_abcdéfgh", "c_abcd efg",
  "logistic", "logistics ", " logistics", "Logistics", "LOGISTICS", "c-abcdefgh", "x_abcdefgh", "cabcdefgh", "c__abcdefgh",
  "__proto__", "constructor", "../camp", "c_abcdefgh/x", "c_abcdefgh\n",
  5, null, undefined, true, {}, ["c_abcdefgh"],
];

for (const id of VALID_IDS) {
  test(`ID valido accettato nell'elenco: ${id}`, () => {
    assert.equal(isValidCommitteeId(id), true);
    assert.equal(format2([committee(id)]).committees[0].id, id);
  });
}
for (const id of INVALID_IDS) {
  test(`ID non valido rifiutato: ${JSON.stringify(id)}`, () => {
    assert.equal(isValidCommitteeId(id), false);
    invalid(() => format2([{ id, title: "Titolo" }]));
  });
}

test("i cinque ID storici sono riconosciuti come storici, i c_ no", () => {
  for (const id of HISTORIC) assert.equal(isHistoricCommitteeId(id), true, id);
  for (const id of [cid(8), "", "Kitchen", null, undefined]) assert.equal(isHistoricCommitteeId(id), false, String(id));
});

test("ID doppi nell'elenco sono rifiutati, storici e c_", () => {
  invalid(() => format2([committee(cid(8)), committee(cid(8))]));
  invalid(() => format2([committee("kitchen"), committee("games"), committee("kitchen")]));
  invalid(() => format2([committee(cid(8)), committee(cid(9)), committee(cid(8))]));
});

test("elemento dell'elenco che non è un oggetto è rifiutato", () => {
  for (const item of [null, "kitchen", 5, [], undefined]) invalid(() => format2([item]), JSON.stringify(item));
});

// ---------------------------------------------------------------------------
// Titolo, incarico, limiti numerici
// ---------------------------------------------------------------------------

test("titolo obbligatorio: assente, vuoto, solo spazi, non stringa", () => {
  invalid(() => format2([{ id: cid(8) }]), "assente");
  for (const title of ["", "   ", "\n\t", 5, null, {}, []]) {
    invalid(() => format2([{ id: cid(8), title }]), JSON.stringify(title));
  }
});

test("titolo: 1 e 80 caratteri ammessi, 81 no; il confine vale dopo il trim", () => {
  assert.equal(format2([committee(cid(8), { title: "T" })]).committees[0].title, "T");
  assert.equal(format2([committee(cid(8), { title: "T".repeat(80) })]).committees[0].title.length, 80);
  assert.equal(format2([committee(cid(8), { title: `  ${"T".repeat(80)}  ` })]).committees[0].title.length, 80);
  invalid(() => format2([committee(cid(8), { title: "T".repeat(81) })]));
  invalid(() => format2([committee(cid(8), { title: `${"T".repeat(81)}  ` })]));
});

test("titolo: lo spazio attorno viene tolto, quello interno resta", () => {
  assert.equal(format2([committee(cid(8), { title: "  Palco e luci  " })]).committees[0].title, "Palco e luci");
});

test("incarico: assente = vuoto, 0 e 600 ammessi, 601 no; il confine vale dopo il trim", () => {
  assert.equal(format2([committee(cid(8))]).committees[0].responsibilities, "");
  assert.equal(format2([committee(cid(8), { responsibilities: "" })]).committees[0].responsibilities, "");
  assert.equal(format2([committee(cid(8), { responsibilities: "I".repeat(600) })]).committees[0].responsibilities.length, 600);
  assert.equal(format2([committee(cid(8), { responsibilities: ` ${"I".repeat(600)} ` })]).committees[0].responsibilities.length, 600);
  invalid(() => format2([committee(cid(8), { responsibilities: "I".repeat(601) })]));
  invalid(() => format2([committee(cid(8), { responsibilities: 5 })]));
  invalid(() => format2([committee(cid(8), { responsibilities: [] })]));
});

const manyIds = (count) => Array.from({ length: count }, (_, index) => `c_${String(index).padStart(8, "0")}`);

test("massimo 20 comitati: 20 ammessi, 21 no", () => {
  assert.equal(format2(manyIds(20).map((id) => committee(id))).committees.length, 20);
  invalid(() => format2(manyIds(21).map((id) => committee(id))));
  invalid(() => format2(manyIds(50).map((id) => committee(id))));
});

test("massimo 20 comitati: vale anche mescolando storici e nuovi", () => {
  const mixed = [...HISTORIC, ...manyIds(15)].map((id) => committee(id));
  assert.equal(mixed.length, 20);
  assert.equal(format2(mixed).committees.length, 20);
  invalid(() => format2([...mixed, committee(cid(8, "z"))]));
});

test("zero comitati è ammesso e resta zero (non torna ai cinque storici)", () => {
  const configured = format2([], historicPlan());
  assert.deepEqual(configured.committees, []);
  assert.deepEqual(normalizeCampManagement({ ...configured, updatedAt: REVISION }).committees, []);
});

test("l'elenco deve essere una lista", () => {
  for (const committees of ["all", {}, 5, null]) invalid(() => format2(committees), JSON.stringify(committees));
});

test("un elenco non valido non muta il piano salvato", () => {
  const previous = historicPlan();
  const frozen = structuredClone(previous);
  invalid(() => format2([committee(cid(8)), committee(cid(8))], previous));
  assert.deepEqual(previous, frozen);
});

// ---------------------------------------------------------------------------
// Formato 2 (elenco autorevole) contro formato precedente (unione)
// ---------------------------------------------------------------------------

const idsOf = (list) => list.map((item) => item.id);

test("formato 2: un comitato omesso è eliminato, l'ordine è quello inviato", () => {
  const previous = historicPlan({ committees: [...HISTORIC.map((id) => committee(id)), committee(cid(8), { title: "Palco" })] });
  const result = format2([committee(cid(8), { title: "Palco" }), committee("kitchen")], previous);
  assert.deepEqual(idsOf(result.committees), [cid(8), "kitchen"]);
});

test("formato 2: si possono eliminare tutti gli storici e aggiungere solo comitati nuovi", () => {
  const result = format2([committee(cid(8)), committee(cid(9))], historicPlan());
  assert.deepEqual(idsOf(result.committees), [cid(8), cid(9)]);
});

test("formato 2: elenco vuoto elimina anche gli storici", () => {
  assert.deepEqual(format2([], historicPlan()).committees, []);
});

test("formato precedente: unione con i salvati, un comitato omesso resta", () => {
  const previous = historicPlan();
  const legacy = normalizeCampConfiguration({ committees: [{ id: "kitchen", title: "Cucina nuova" }] }, previous, { planFormat: 1 });
  assert.deepEqual(new Set(idsOf(legacy.committees)), new Set(HISTORIC));
  assert.equal(legacy.committees.find((item) => item.id === "kitchen").title, "Cucina nuova");
  const emptyList = normalizeCampConfiguration({ committees: [] }, previous, { planFormat: 1 });
  assert.deepEqual(new Set(idsOf(emptyList.committees)), new Set(HISTORIC), "committees [] legacy conserva i comitati");
});

test("formato precedente: senza opzioni il comportamento è l'unione", () => {
  const legacy = normalizeCampConfiguration({ committees: [{ id: "games", title: "Giochi" }] }, historicPlan());
  assert.equal(legacy.committees.length, 5);
});

test("formato 2 non muta il piano salvato né ne eredita i comitati omessi", () => {
  const previous = historicPlan({ committees: [...HISTORIC.map((id) => committee(id, { memberRegistrationIds: ["user_x"] }))] });
  const frozen = structuredClone(previous);
  const result = format2([committee("kitchen")], previous);
  assert.deepEqual(previous, frozen);
  assert.deepEqual(idsOf(result.committees), ["kitchen"]);
});

test("denominazione dei gruppi: valore inviato > salvato > predefinito del tipo", () => {
  assert.equal(normalizeCampConfiguration({}, {}, { defaultGroupLabel: "gruppo" }).groupLabel, "gruppo");
  assert.equal(normalizeCampConfiguration({}, {}, { defaultGroupLabel: "pattuglia" }).groupLabel, "pattuglia");
  assert.equal(normalizeCampConfiguration({}, { groupLabel: "squadra" }, { defaultGroupLabel: "gruppo" }).groupLabel, "squadra");
  assert.equal(normalizeCampConfiguration({ groupLabel: "team" }, { groupLabel: "squadra" }, { defaultGroupLabel: "gruppo" }).groupLabel, "team");
  assert.equal(format2([], {}, { groupLabel: "compagnia" }).groupLabel, "compagnia");
});

test("denominazione dei gruppi: i cinque nomi valgono ovunque, altri sono rifiutati", () => {
  for (const groupLabel of ["pattuglia", "gruppo", "compagnia", "team", "squadra"]) {
    assert.equal(format2([], {}, { groupLabel }).groupLabel, groupLabel);
  }
  for (const groupLabel of ["reparto", "", null, 1, {}]) invalid(() => format2([], {}, { groupLabel }), JSON.stringify(groupLabel));
});

// ---------------------------------------------------------------------------
// assertLegacyPlanEditable
// ---------------------------------------------------------------------------

const expectLegacyRefused = (activityType, previous, label) =>
  assert.throws(
    () => assertLegacyPlanEditable(activityType, previous),
    (error) => {
      assert.ok(error instanceof CampConfigurationError, `${label}: tipo di errore`);
      assert.equal(error.code, "failed-precondition", label);
      assert.equal(error.message, LEGACY_MESSAGE, label);
      return true;
    },
    label,
  );

test("legacy: campeggio con i cinque comitati storici è modificabile, in qualunque ordine", () => {
  assert.doesNotThrow(() => assertLegacyPlanEditable("camp", historicPlan()));
  assert.doesNotThrow(() => assertLegacyPlanEditable("camp", historicPlan({ committees: [...HISTORIC].reverse().map((id) => committee(id)) })));
});

test("legacy: campeggio senza piano salvato è modificabile", () => {
  assert.doesNotThrow(() => assertLegacyPlanEditable("camp", null));
  assert.doesNotThrow(() => assertLegacyPlanEditable("camp", undefined));
});

test("legacy: campeggio con un comitato c_ è rifiutato col messaggio della spec", () => {
  expectLegacyRefused("camp", historicPlan({ committees: [...HISTORIC.map((id) => committee(id)), committee(cid(8))] }), "cinque storici più un c_");
  expectLegacyRefused("camp", historicPlan({ committees: [committee(cid(8))] }), "solo un c_");
  expectLegacyRefused("camp", historicPlan({ committees: [...HISTORIC.slice(0, 4).map((id) => committee(id)), committee(cid(8))] }), "quattro storici e un c_ (cinque in tutto)");
});

test("legacy: campeggio con uno storico eliminato è rifiutato", () => {
  for (const missing of HISTORIC) {
    expectLegacyRefused("camp", historicPlan({ committees: HISTORIC.filter((id) => id !== missing).map((id) => committee(id)) }), `senza ${missing}`);
  }
});

test("legacy: campeggio con elenco vuoto o con storici doppi è rifiutato", () => {
  expectLegacyRefused("camp", historicPlan({ committees: [] }), "elenco vuoto");
  expectLegacyRefused("camp", historicPlan({ committees: [...HISTORIC.slice(0, 4), "kitchen"].map((id) => committee(id)) }), "storico doppio");
});

test("legacy: ogni tipo diverso da camp è rifiutato, con o senza piano, anche con i cinque storici", () => {
  for (const type of ACTIVITY_TYPES.filter((item) => item !== "camp")) {
    expectLegacyRefused(type, null, `${type} senza piano`);
    expectLegacyRefused(type, historicPlan(), `${type} con i cinque storici`);
  }
  expectLegacyRefused(undefined, null, "tipo mancante");
});

// ---------------------------------------------------------------------------
// Piano normalizzato: predefiniti, emoji, cardinalità, proiezioni
// ---------------------------------------------------------------------------

test("senza documento salvato il piano parte dai cinque comitati storici con incarico vuoto", () => {
  for (const source of [null, undefined, {}]) {
    const plan = normalizeCampManagement(source);
    assert.deepEqual(idsOf(plan.committees), HISTORIC);
    for (const item of plan.committees) {
      assert.equal(item.responsibilities, "", item.id);
      assert.ok(item.title.length > 0, `titolo predefinito di ${item.id}`);
      assert.deepEqual(item.memberRegistrationIds, []);
      assert.deepEqual(item.leaderRegistrationIds, []);
    }
  }
});

test("emoji: i comitati c_ non ne hanno mai, nemmeno se il payload ne porta una", () => {
  const plan = normalizeCampManagement({ committees: [{ id: cid(8), title: "Palco", emoji: "🎪" }, { id: cid(9), title: "Luci" }] });
  assert.deepEqual(plan.committees.map((item) => item.emoji), ["", ""]);
});

test("emoji: gli storici conservano la propria o ricevono quella predefinita", () => {
  const plan = normalizeCampManagement({ committees: [{ id: "kitchen", title: "Cucina", emoji: "🎯" }, { id: "games", title: "Giochi" }] });
  assert.equal(plan.committees.find((item) => item.id === "kitchen").emoji, "🎯");
  assert.ok(plan.committees.find((item) => item.id === "games").emoji.length > 0);
});

test("l'elenco c_ passato per normalizzazione di formato 2 produce comitati senza emoji", () => {
  const configured = format2([committee(cid(8), { title: "Palco", emoji: "🎪" }), committee("kitchen")]);
  const plan = normalizeCampManagement({ ...configured, updatedAt: REVISION });
  assert.equal(plan.committees.find((item) => item.id === cid(8)).emoji, "");
  assert.ok(plan.committees.find((item) => item.id === "kitchen").emoji.length > 0);
});

test("payload del client precedente: solo i cinque storici, mai un c_", () => {
  const result = historicCommittees([committee(cid(8)), committee("kitchen", { title: "Cucina" }), { id: "constructor" }]);
  assert.deepEqual(idsOf(result), HISTORIC);
  assert.equal(result.find((item) => item.id === "kitchen").title, "Cucina");
  assert.deepEqual(idsOf(historicCommittees(undefined)), HISTORIC);
  assert.deepEqual(idsOf(historicCommittees([])), HISTORIC);
});

test("una persona sta in un solo comitato: la prima assegnazione vince, anche tra guida e membro", () => {
  const plan = normalizeCampManagement({
    committees: [
      { id: cid(8), title: "Palco", memberRegistrationIds: ["user_a", "user_b"], leaderRegistrationIds: ["user_l"] },
      { id: cid(9), title: "Luci", memberRegistrationIds: ["user_a", "user_c"], leaderRegistrationIds: ["user_l", "user_b"] },
    ],
  });
  const [first, second] = plan.committees;
  assert.deepEqual(first.memberRegistrationIds, ["user_a", "user_b"]);
  assert.deepEqual(first.leaderRegistrationIds, ["user_l"]);
  assert.deepEqual(second.memberRegistrationIds, ["user_c"]);
  assert.deepEqual(second.leaderRegistrationIds, []);
});

test("una persona sta in un solo comitato anche con un dirigente manuale collegato per nome", () => {
  // Il server collega «Ada Rossi» (dirigente manuale in B) all'iscrizione user_ada,
  // già nel comitato A: le proiezioni non devono dare due comitati alla stessa persona.
  const manualLeaders = [{ id: "manual-ada", fullName: "Ada Rossi", linkedRegistrationId: "user_ada" }];
  for (const asLeader of [false, true]) {
    const plan = normalizeCampManagement({
      committees: [
        { id: cid(8), title: "Comitato Alfa", ...(asLeader ? { leaderRegistrationIds: ["user_ada"] } : { memberRegistrationIds: ["user_ada"] }) },
        { id: cid(9), title: "Comitato Beta", manualLeaderIds: ["manual-ada"] },
      ],
      manualLeaders,
    });
    const assigned = buildCommitteeAssignments(plan).get("user_ada") || [];
    assert.ok(new Set(assigned.map((item) => item.id)).size <= 1, `comitati distinti per user_ada: ${JSON.stringify(assigned)}`);
    assert.ok(assigned.length <= 1, `nessuna voce doppia: ${JSON.stringify(assigned)}`);
  }
});

test("dirigente manuale collegato, senza altra assegnazione: un solo comitato", () => {
  const plan = normalizeCampManagement({
    committees: [{ id: cid(8), title: "Comitato Alfa" }, { id: cid(9), title: "Comitato Beta", manualLeaderIds: ["manual-ada"] }],
    manualLeaders: [{ id: "manual-ada", fullName: "Ada Rossi", linkedRegistrationId: "user_ada" }],
  });
  assert.deepEqual((buildCommitteeAssignments(plan).get("user_ada") || []).map((item) => item.id), [cid(9)]);
});

test("eliminare un comitato lascia le sue persone senza comitato, le altre restano dove sono", () => {
  const before = format2(
    [
      committee(cid(8), { title: "Palco", memberRegistrationIds: ["user_a", "user_b"], leaderRegistrationIds: ["user_l"] }),
      committee("kitchen", { memberRegistrationIds: ["user_c"] }),
    ],
    {},
  );
  const planBefore = normalizeCampManagement({ ...before, updatedAt: REVISION });
  assert.deepEqual([...buildCommitteeAssignments(planBefore).keys()].sort(), ["user_a", "user_b", "user_c", "user_l"]);

  const after = format2(
    [committee("kitchen", { memberRegistrationIds: ["user_c"] })],
    planBefore,
  );
  const planAfter = normalizeCampManagement({ ...after, updatedAt: REVISION });
  const assignments = buildCommitteeAssignments(planAfter);
  assert.deepEqual([...assignments.keys()], ["user_c"], "solo chi è in un comitato rimasto ha ancora un'assegnazione");
  assert.deepEqual(assignments.get("user_c").map((item) => item.id), ["kitchen"]);
  assert.equal(assignments.has("user_a"), false);
  assert.equal(assignments.has("user_l"), false);
});

test("proiezione: ogni assegnazione porta id e titolo del comitato", () => {
  const plan = normalizeCampManagement({
    committees: [{ id: cid(8), title: "Palco", memberRegistrationIds: ["user_a"], leaderRegistrationIds: ["user_l"] }],
  });
  const assignments = buildCommitteeAssignments(plan);
  assert.equal(assignments.get("user_a")[0].id, cid(8));
  assert.equal(assignments.get("user_a")[0].title, "Palco");
  assert.equal(assignments.get("user_l")[0].id, cid(8));
});

// ---------------------------------------------------------------------------
// Elenco nomi (roster): solo i campi ammessi
// ---------------------------------------------------------------------------

const ROSTER_FIELDS = ["firstName", "fullName", "genderRoleCategory", "id", "lastName", "registrationStatus", "status", "unitName"];
const SENTINEL = "SENTINELLA";
const sensitiveRegistration = (extra = {}) => ({
  firstName: "Ada",
  lastName: "Rossi",
  fullName: "Ada Rossi",
  genderRoleCategory: "giovane_donna",
  unitName: "Unità sintetica",
  registrationStatus: "confirmed",
  status: "active",
  birthDate: `${SENTINEL}_NASCITA`,
  email: `${SENTINEL}_EMAIL@example.invalid`,
  phone: `${SENTINEL}_TELEFONO`,
  userId: `${SENTINEL}_UID`,
  anonymousUid: `${SENTINEL}_ANON`,
  anonymousTokenId: `${SENTINEL}_TOKEN`,
  accessCode: `${SENTINEL}_ACCESSO`,
  recoveryCode: `${SENTINEL}_RECUPERO`,
  parentUid: `${SENTINEL}_GENITORE`,
  answers: { medicalNote: `${SENTINEL}_RISPOSTA`, allergies: `${SENTINEL}_ALLERGIE` },
  allergiesInfo: `${SENTINEL}_ALLERGIE_INFO`,
  allergies: `${SENTINEL}_ALLERGIE_GEN`,
  medications: `${SENTINEL}_FARMACI`,
  medicalNotes: `${SENTINEL}_NOTE_MEDICHE`,
  dietaryNotes: `${SENTINEL}_DIETA`,
  emergencyContactName: `${SENTINEL}_EMERGENZA`,
  emergencyContactPhone: `${SENTINEL}_EMERGENZA_TEL`,
  parentAuthorization: { parentEmail: `${SENTINEL}_EMAIL_GENITORE`, medicalNotes: `${SENTINEL}_NOTE_GENITORE` },
  parentConsentDocumentUrl: `https://example.invalid/${SENTINEL}_DOC`,
  parentIdDocumentUrl: `https://example.invalid/${SENTINEL}_ID`,
  consentSignatureUrl: `https://example.invalid/${SENTINEL}_FIRMA`,
  photoConsent: { decision: "accepted" },
  assignedRoomId: "room-1",
  assignedCommittees: [{ id: "kitchen", title: "Cucina", role: "member" }],
  createdBy: `${SENTINEL}_CREATORE`,
  ...extra,
});

test("roster: esattamente gli otto campi ammessi, nessun valore sensibile", () => {
  const entry = toRosterEntry("user_ada", sensitiveRegistration());
  assert.deepEqual(Object.keys(entry).sort(), ROSTER_FIELDS);
  assert.equal(JSON.stringify(entry).includes(SENTINEL), false, JSON.stringify(entry));
  assert.deepEqual(entry, {
    id: "user_ada",
    firstName: "Ada",
    lastName: "Rossi",
    fullName: "Ada Rossi",
    genderRoleCategory: "giovane_donna",
    unitName: "Unità sintetica",
    registrationStatus: "confirmed",
    status: "active",
  });
});

test("roster: un'iscrizione senza dati restituisce comunque le sole chiavi ammesse, tutte stringhe", () => {
  const entry = toRosterEntry("manual_vuota", {});
  assert.deepEqual(Object.keys(entry).sort(), ROSTER_FIELDS);
  for (const value of Object.values(entry)) assert.equal(typeof value, "string");
  assert.equal(entry.id, "manual_vuota");
});

test("roster: valori non stringa non passano e la categoria sconosciuta diventa vuota", () => {
  const entry = toRosterEntry("manual_x", sensitiveRegistration({ firstName: 5, lastName: { a: 1 }, fullName: null, unitName: [], registrationStatus: 7, status: false, genderRoleCategory: "genitore" }));
  assert.deepEqual(Object.keys(entry).sort(), ROSTER_FIELDS);
  assert.equal(entry.genderRoleCategory, "");
  assert.equal(entry.firstName, "");
  assert.equal(entry.lastName, "");
  assert.equal(entry.registrationStatus, "");
  assert.equal(entry.status, "");
  assert.equal(JSON.stringify(entry).includes(SENTINEL), false);
});

test("roster: le quattro categorie note passano, il nome completo si ricostruisce da nome e cognome", () => {
  for (const category of ["giovane_uomo", "giovane_donna", "dirigente", "accompagnatore"]) {
    assert.equal(toRosterEntry("x", { genderRoleCategory: category }).genderRoleCategory, category);
  }
  assert.equal(toRosterEntry("x", { firstName: "Ada", lastName: "Rossi" }).fullName, "Ada Rossi");
  assert.equal(toRosterEntry("x", { unitNameSnapshot: "Unità copia" }).unitName, "Unità copia");
  assert.equal(toRosterEntry("x", { unitName: "Unità viva" }).unitName, "Unità viva");
});

// ---------------------------------------------------------------------------
// Chi può salvare il piano (stessa decisione delle rules, tabella della spec)
// ---------------------------------------------------------------------------

const STAKE = "palo-a";
const UID = "persona-1";
const activeRegistration = { registrationStatus: "confirmed" };
const access = (overrides) =>
  resolvePlanAccess({ activityType: "trip", profile: null, stakeId: STAKE, uid: UID, staffUids: [], ownRegistration: null, ...overrides });

test("accesso al piano: admin del palo e super_admin su ogni tipo di attività", () => {
  for (const activityType of ACTIVITY_TYPES) {
    assert.equal(access({ activityType, profile: { role: "admin", stakeId: STAKE } }), "admin", activityType);
    assert.equal(access({ activityType, profile: { role: "super_admin", stakeId: "altro" } }), "admin", activityType);
  }
});

test("accesso al piano: dirigente di unità del palo su ogni tipo, di un altro palo no", () => {
  for (const activityType of ACTIVITY_TYPES) {
    assert.equal(access({ activityType, profile: { role: "unit_leader", stakeId: STAKE } }), "unit_leader", activityType);
    assert.equal(access({ activityType, profile: { role: "unit_leader", stakeId: "altro" } }), null, activityType);
  }
  assert.equal(access({ profile: { role: "unit_leader" } }), null, "dirigente senza palo");
});

test("accesso al piano: admin di un altro palo o senza palo no", () => {
  for (const activityType of ACTIVITY_TYPES) {
    assert.equal(access({ activityType, profile: { role: "admin", stakeId: "altro" } }), null, activityType);
  }
  assert.equal(access({ profile: { role: "admin" } }), null);
});

test("accesso al piano: staff in elenco con iscrizione attiva solo sul campeggio", () => {
  const listed = { staffUids: [UID], ownRegistration: activeRegistration, profile: { role: "participant", stakeId: STAKE } };
  assert.equal(access({ ...listed, activityType: "camp" }), "listed");
  for (const activityType of [...ACTIVITY_TYPES.filter((type) => type !== "camp"), undefined]) {
    assert.equal(access({ ...listed, activityType }), null, String(activityType));
  }
});

test("accesso al piano: staff in elenco ma iscrizione annullata, assente o senza stato: no", () => {
  const base = { activityType: "camp", staffUids: [UID], profile: { role: "participant", stakeId: STAKE } };
  assert.equal(access({ ...base, ownRegistration: { registrationStatus: "cancelled" } }), null);
  assert.equal(access({ ...base, ownRegistration: null }), null);
  assert.equal(access({ ...base, ownRegistration: {} }), null);
  assert.equal(access({ ...base, staffUids: ["altro"], ownRegistration: activeRegistration }), null);
});

test("accesso al piano: categoria autodichiarata, iscritti e anonimi non danno nessun accesso", () => {
  for (const activityType of ACTIVITY_TYPES) {
    for (const genderRoleCategory of ["dirigente", "accompagnatore"]) {
      assert.equal(
        access({ activityType, profile: { role: "participant", stakeId: STAKE, genderRoleCategory }, ownRegistration: { ...activeRegistration, genderRoleCategory } }),
        null,
        `${activityType} ${genderRoleCategory}`,
      );
    }
    assert.equal(access({ activityType, profile: null, ownRegistration: activeRegistration }), null, `${activityType} senza profilo`);
    for (const role of ["participant", "member", "", undefined, "organizer"]) {
      assert.equal(access({ activityType, profile: { role, stakeId: STAKE } }), null, `${activityType} ruolo ${role}`);
    }
  }
});
