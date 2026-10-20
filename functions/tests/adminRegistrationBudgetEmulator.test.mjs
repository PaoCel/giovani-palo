// Costo in espressioni delle rules delle iscrizioni scritte dall'admin
// (docs/ADMIN_ISCRITTI.md, scelta R; metodo in docs/TEST_FIRESTORE_ISCRIZIONI.md).
// Firestore valuta al massimo 1000 espressioni per richiesta: oltre, la
// scrittura è negata come permission-denied, senza altro messaggio.
//
// Misura: si carica nell'emulatore (PUT /emulator/v1/projects/<progetto>:securityRules)
// una variante delle rules in cui la condizione di `allow create` o
// `allow update` del blocco registrations è `[0,0,…,0].size() >= 0 && (<condizione>)`,
// e per bisezione si cerca la lista più lunga con cui la scrittura vera passa
// (ogni elemento vale un'espressione). Il tetto con la sola condizione `true`
// (calibrazione, 993 sull'emulatore) meno la lista massima è il costo. Ogni
// tentativo riparte da un documento seminato da capo, con l'SDK client e l'attore
// vero; le scritture sono quelle dei servizi (adminCreateManualRegistration,
// adminUpdateRegistration, adminSetRegistrationStatus,
// adminUpdateParentAuthorizationEmail, normalizeRoomPreferenceMatches, il batch di
// campManagementService, upsertRegistration).
//
// Il file sostituisce le rules dell'emulatore: si lancia da solo, in un'emulators:exec
// suo (le rules originali vengono rimesse alla fine). Con BUDGET_RULES_FILE=<file>
// misura le stesse scritture su un'altra versione delle rules (ad esempio
// `git show 2eb3e05:firestore.rules`, prima del task) e non asserisce nulla:
// serve al confronto prima/dopo delle due sonde del caso peggiore.
//
// Rilancio dalla radice del repository (solo Firestore):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --only firestore --config firebase.room-test.json --project demo-admin-budget \
//     'node --test --test-concurrency=1 functions/tests/adminRegistrationBudgetEmulator.test.mjs'
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { deleteField, setDoc } from "firebase/firestore";

import { planAdminEdit, buildAdminEditPatch, personDraftFromRegistration } from "../../src/utils/adminRegistration.ts";
import { DAYS, MINOR, UNIT_1, UNIT_2, createFixtures, nowIso } from "./helpers/adminRegistrationFixtures.mjs";

const F = createFixtures("admin-budget");
const { uid, adminDb, clientOps, manualDoc, manualId, minorDraft, parentDraft, personDraft, regPath, regRef, heavyAnswers, roomMatches } = F;

const RULES_FILE = process.env.BUDGET_RULES_FILE || fileURLToPath(new URL("../../firestore.rules", import.meta.url));
const COMPARE_MODE = Boolean(process.env.BUDGET_RULES_FILE);
// BUDGET_ONLY=<regex>: solo gli scenari il cui gruppo o nome combacia (ad esempio "^(D|E|F)\\.").
const ONLY = process.env.BUDGET_ONLY ? new RegExp(process.env.BUDGET_ONLY, "u") : null;
const baseRules = readFileSync(RULES_FILE, "utf8");
const RULES_URL = `http://${F.FIRESTORE_HOST}/emulator/v1/projects/${F.PROJECT}:securityRules`;

async function putRules(content) {
  const response = await fetch(RULES_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content }] } }),
  });
  const body = await response.text();
  assert.equal(response.status, 200, `rules non caricate: ${body.slice(0, 300)}`);
}

/** Le rules con la condizione di `allow <method>` del blocco registrations preceduta da n elementi di riempimento. */
function variant(method, n, inner = null) {
  const start = baseRules.indexOf("match /registrations/{registrationId} {");
  assert.ok(start > 0, "blocco registrations non trovato");
  const tail = baseRules.slice(start);
  const match = new RegExp(`allow ${method}: if ([^;]*);`, "u").exec(tail);
  assert.ok(match, `allow ${method} non trovato`);
  const padding = n > 0 ? `[${new Array(n).fill(0).join(",")}].size() >= 0 && ` : "";
  return `${baseRules.slice(0, start)}${tail.slice(0, match.index)}allow ${method}: if ${padding}(${inner ?? match[1]});${tail.slice(match.index + match[0].length)}`;
}

/**
 * Lista di riempimento più lunga con cui `attempt` passa: -1 se non passa nemmeno
 * con lista vuota (negata per altro, o oltre le 1000 espressioni).
 * `attempt.prepare()` semina da capo e restituisce la scrittura da eseguire.
 */
async function longestPadding({ method, prepare, inner = null }, cap) {
  const passes = async (n) => {
    await putRules(variant(method, n, inner));
    const run = await prepare();
    try {
      await run();
      return true;
    } catch (error) {
      if (error?.code === "permission-denied") return false;
      throw error;
    }
  };
  if (!(await passes(0))) return -1;
  let low = 0;
  let high = cap + 1;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (await passes(middle)) low = middle;
    else high = middle;
  }
  return low;
}

let CAP = 993;
let ACT_REQ;
let ACT_FREE;
let ACT_CAMP;
const results = [];

before(async () => {
  await F.setup();
  ACT_REQ = await F.seedActivity({ requires: true });
  ACT_FREE = await F.seedActivity({ requires: false });
  ACT_CAMP = await F.seedActivity({ requires: true, type: "camp" });
});

after(async () => {
  try {
    await putRules(baseRules);
  } finally {
    await F.teardown();
  }
  console.log("\nCosto in espressioni (limite 1000)\n");
  for (const row of results) console.log(row);
});

const childId = (name) => `child_${uid(name)}_figlio-1`;
const accountId = (name) => `user_${uid(name)}`;
/** Semina (sovrascrive) l'iscrizione e restituisce i dati attuali come li rilegge il client. */
async function seed(activityId, id, data) {
  await adminDb.doc(regPath(activityId, id)).set(data);
  return (await adminDb.doc(regPath(activityId, id)).get()).data();
}

/** Patch di "Modifica dati" come il client. */
function editPatch(current, id, personChanges, { parent = { firstName: "", lastName: "", email: "", phone: "" }, requires = true } = {}) {
  const registration = { id, ...current };
  const person = { ...personDraftFromRegistration(registration), ...personChanges };
  const plan = planAdminEdit(registration, person, parent, { requiresParentAuthorization: requires, previousUnitName: current.unitNameSnapshot });
  return buildAdminEditPatch({ registration, person, parent, plan, timestamp: nowIso(), deleteValue: deleteField() });
}

/** Le tre spunte foto che l'adulto dà nel modulo (8a294f2): l'admin le toglie se la data dice meno di 18 anni. */
const withPhotoAnswers = (data) => ({
  ...data,
  answers: { ...data.answers, photoInternalConsent: true, photoPublicConsent: true, photoReleaseAccepted: true },
});

const ALL_PERSON_CHANGES = {
  firstName: "Piero",
  lastName: "Neri",
  unitId: UNIT_2.id,
  unitName: UNIT_2.name,
  genderRoleCategory: "dirigente",
  email: "piero@example.invalid",
  phone: "3471112222",
};

// ---------------------------------------------------------------------------
// Scenari: { group, name, method, prepare, reference? }
// ---------------------------------------------------------------------------

const SCENARIOS = [];
const add = (group, name, method, prepare, extra = {}) => SCENARIOS.push({ group, name, method, prepare, ...extra });

/**
 * Documento a mano al massimo che le rules ammettono: nelle risposte solo i
 * cinque campi consentiti, con la richiesta del genitore completa; poi
 * preferenze stanza, giorni, email e telefono valorizzati.
 */
const maximalManual = (person, parent) => {
  const base = manualDoc({ person, parent, requires: true });
  return {
    ...base,
    email: "persona@example.invalid",
    phone: "3471234567",
    answers: {
      ...base.answers,
      parentAuthorizationRequest: {
        ...F.parentRequest(),
        emergencyContactName: "Anna Rossi",
        emergencyContactPhone: "3409876543",
        emergencyContactRelation: "nonna",
        allergies: "Graminacee, acari, nichel",
        medications: "Salbutamolo spray al bisogno.",
        medicalNotes: "Asma da sforzo, porta sempre lo spray.",
        dietaryNotes: "Niente frutta a guscio.",
        submittedAt: nowIso(),
      },
    },
    roomPreferenceMatches: roomMatches(),
    participatingDays: DAYS,
  };
};

// ---- Creazione dell'admin: iscrizione a mano ------------------------------

add("A. admin crea a mano", "adulto attivo, attività con autorizzazione (lettura dell'attività e calcolo dell'età)", "create", async () => {
  const id = manualId();
  const document = manualDoc({ person: personDraft(), requires: true });
  return () => clientOps.createManual("admin", ACT_REQ, id, document);
});
add("A. admin crea a mano", "minorenne in attesa, con la richiesta del genitore", "create", async () => {
  const id = manualId();
  const document = manualDoc({ person: minorDraft(), parent: parentDraft(), requires: true });
  return () => clientOps.createManual("admin", ACT_REQ, id, document);
});
add("A. admin crea a mano", "minorenne in attesa, senza la richiesta", "create", async () => {
  const id = manualId();
  const document = manualDoc({ person: minorDraft(), parent: parentDraft({ email: "" }), requires: true });
  return () => clientOps.createManual("admin", ACT_REQ, id, document);
});
add("A. admin crea a mano", "minorenne attivo, attività senza autorizzazione", "create", async () => {
  const id = manualId();
  const document = manualDoc({ person: minorDraft(), requires: false });
  return () => clientOps.createManual("admin", ACT_FREE, id, document);
});
add("A. admin crea a mano", "documento massimo: adulto attivo, preferenze stanza, giorni, email e telefono", "create", async () => {
  const id = manualId();
  const document = maximalManual(personDraft(), parentDraft());
  return () => clientOps.createManual("admin", ACT_REQ, id, document);
});
add("A. admin crea a mano", "documento massimo: minorenne in attesa con la richiesta completa", "create", async () => {
  const id = manualId();
  const document = maximalManual(minorDraft(), parentDraft());
  return () => clientOps.createManual("admin", ACT_REQ, id, document);
});
add("A. admin crea a mano", "secondo setDoc identico (retry): passa dal ramo update", "update", async () => {
  const id = manualId();
  const document = manualDoc({ person: minorDraft(), parent: parentDraft(), requires: true });
  await seed(ACT_REQ, id, document);
  return () => clientOps.createManual("admin", ACT_REQ, id, document);
});

// ---- Update dell'admin su un'iscrizione di un altro -----------------------

const CHILD_OF_GENITORE = childId("genitore");
const maximalChild = (name, opts) => F.childRegistration(uid(name), childId(name), "maximal", opts);

add("B. admin su iscrizione di un altro", "annulla l'iscrizione figlio massima", "update", async () => {
  await seed(ACT_REQ, CHILD_OF_GENITORE, maximalChild("genitore"));
  return () => clientOps.setStatus("admin", ACT_REQ, CHILD_OF_GENITORE, "cancelled");
});
add("B. admin su iscrizione di un altro", "riattiva figlio massimo firmato: active", "update", async () => {
  await seed(ACT_REQ, CHILD_OF_GENITORE, maximalChild("genitore", { cancelled: true }));
  return () => clientOps.setStatus("admin", ACT_REQ, CHILD_OF_GENITORE, "active");
});
add("B. admin su iscrizione di un altro", "riattiva figlio non firmato: in attesa", "update", async () => {
  await seed(ACT_REQ, CHILD_OF_GENITORE, F.childRegistration(uid("genitore"), CHILD_OF_GENITORE, "pending", { cancelled: true }));
  return () => clientOps.setStatus("admin", ACT_REQ, CHILD_OF_GENITORE, "pending_parent_authorization");
});
add("B. admin su iscrizione di un altro", "riattiva adulto massimo: active (lettura dell'attività)", "update", async () => {
  await seed(ACT_REQ, accountId("utente"), F.accountRegistration(uid("utente"), "maximal", { cancelled: true }));
  return () => clientOps.setStatus("admin", ACT_REQ, accountId("utente"), "active");
});
add("B. admin su iscrizione di un altro", "corregge un account adulto massimo: ogni dato, adulto → minorenne, richiesta del genitore, in attesa, tre spunte foto tolte", "update", async () => {
  const current = await seed(ACT_REQ, accountId("utente"), withPhotoAnswers(F.accountRegistration(uid("utente"), "maximal")));
  const patch = editPatch(current, accountId("utente"), { ...ALL_PERSON_CHANGES, birthDate: MINOR }, { parent: parentDraft() });
  return () => clientOps.update("admin", ACT_REQ, accountId("utente"), patch);
});
add("B. admin su iscrizione di un altro", "corregge un figlio massimo firmato: ogni dato, stato invariato", "update", async () => {
  const current = await seed(ACT_REQ, CHILD_OF_GENITORE, maximalChild("genitore"));
  const patch = editPatch(current, CHILD_OF_GENITORE, ALL_PERSON_CHANGES);
  return () => clientOps.update("admin", ACT_REQ, CHILD_OF_GENITORE, patch);
});
add("B. admin su iscrizione di un altro", "corregge un'iscrizione a mano: ogni dato", "update", async () => {
  const id = manualId();
  const current = await seed(ACT_REQ, id, maximalManual(personDraft(), parentDraft()));
  const patch = editPatch(current, id, ALL_PERSON_CHANGES);
  return () => clientOps.update("admin", ACT_REQ, id, patch);
});
add("B. admin su iscrizione di un altro", "cambia l'email del genitore (adminUpdateParentAuthorizationEmail) di un figlio massimo", "update", async () => {
  await seed(ACT_REQ, CHILD_OF_GENITORE, withPhotoAnswers(maximalChild("genitore")));
  return () => clientOps.updateParentEmail("admin", ACT_REQ, CHILD_OF_GENITORE, "nuovo@example.invalid");
});
add("B. admin su iscrizione di un altro", "normalizeRoomPreferenceMatches su un figlio massimo", "update", async () => {
  await seed(ACT_REQ, CHILD_OF_GENITORE, maximalChild("genitore"));
  return () => clientOps.normalizeRoomMatches("admin", [{ activityId: ACT_REQ, registrationId: CHILD_OF_GENITORE }]);
});
add("B. admin su iscrizione di un altro", "pattuglia e comitati in un campeggio su un figlio massimo (validCampAssignmentUpdate)", "update", async () => {
  await seed(ACT_CAMP, CHILD_OF_GENITORE, maximalChild("genitore"));
  return () => clientOps.campAssignments("admin", [{ activityId: ACT_CAMP, registrationId: CHILD_OF_GENITORE }]);
});
/** Ogni chiave che l'allowlist dell'admin ammette, in una scrittura sola (nessun client la fa). */
const ALL_KEYS_PATCH = (timestamp) => ({
  registrationStatus: "pending_parent_authorization",
  updatedAt: timestamp,
  firstName: "Piero",
  lastName: "Neri",
  fullName: "Piero Neri",
  birthDate: MINOR,
  genderRoleCategory: "giovane_uomo",
  unitId: UNIT_2.id,
  unitNameSnapshot: UNIT_2.name,
  email: "piero@example.invalid",
  phone: "3471112222",
  roomPreferenceMatches: roomMatches(),
  "answers.birthDate": MINOR,
  "answers.genderRoleCategory": "giovane_uomo",
  "answers.youthGroup": "Giovani Uomini",
  "answers.unitName": UNIT_2.name,
  "answers.parentAuthorizationRequest.parentEmail": "nuovo@example.invalid",
  "answers.parentAuthorizationRequest.parentFirstName": "Anna",
  "parentAuthorization.parentEmail": "nuovo@example.invalid",
  "parentAuthorization.emailLastError": null,
  "parentAuthorization.updatedAt": timestamp,
  "answers.photoInternalConsent": deleteField(),
  "answers.photoPublicConsent": deleteField(),
  "answers.photoReleaseAccepted": deleteField(),
});
add("B. admin su iscrizione di un altro", "sintetico: tutte le chiavi lecite insieme su un figlio massimo annullato (riattivato in attesa)", "update", async () => {
  await seed(ACT_REQ, CHILD_OF_GENITORE, withPhotoAnswers(maximalChild("genitore", { cancelled: true })));
  const timestamp = nowIso();
  return () => clientOps.update("admin", ACT_REQ, CHILD_OF_GENITORE, ALL_KEYS_PATCH(timestamp));
});

// ---- Admin che è anche genitore o partecipante: le sue iscrizioni ----------

const OWN_CHILD = childId("admin-genitore");
const OWN_ACCOUNT = accountId("admin-genitore");
const ownChild = (opts) => maximalChild("admin-genitore", opts);
const ownAccount = (opts) => F.accountRegistration(uid("admin-genitore"), "maximal", opts);

add("C. admin titolare della propria iscrizione", "salva dal modulo l'iscrizione del figlio massima (ramo del titolare)", "update", async () => {
  const current = await seed(ACT_REQ, OWN_CHILD, ownChild());
  return () => clientOps.resave("adminGenitore", ACT_REQ, OWN_CHILD, current, { changes: { phone: "3470000001" } });
});
add("C. admin titolare della propria iscrizione", "riattiva dal modulo il figlio massimo firmato: active (ramo del titolare)", "update", async () => {
  const current = await seed(ACT_REQ, OWN_CHILD, ownChild({ cancelled: true }));
  return () => clientOps.resave("adminGenitore", ACT_REQ, OWN_CHILD, current, { status: "active" });
});
add("C. admin titolare della propria iscrizione", "annulla l'iscrizione del figlio massima", "update", async () => {
  await seed(ACT_REQ, OWN_CHILD, ownChild());
  return () => clientOps.setStatus("adminGenitore", ACT_REQ, OWN_CHILD, "cancelled");
});
add("C. admin titolare della propria iscrizione", "riattiva il figlio non firmato: in attesa", "update", async () => {
  await seed(ACT_REQ, OWN_CHILD, F.childRegistration(uid("admin-genitore"), OWN_CHILD, "pending", { cancelled: true }));
  return () => clientOps.setStatus("adminGenitore", ACT_REQ, OWN_CHILD, "pending_parent_authorization");
});
add("C. admin titolare della propria iscrizione", "corregge i dati del figlio massimo (unità cambiata: il ramo del titolare fallisce, poi quello admin)", "update", async () => {
  const current = await seed(ACT_REQ, OWN_CHILD, ownChild());
  const patch = editPatch(current, OWN_CHILD, ALL_PERSON_CHANGES);
  return () => clientOps.update("adminGenitore", ACT_REQ, OWN_CHILD, patch);
});
add("C. admin titolare della propria iscrizione", "corregge i dati della propria iscrizione di account massima (unità cambiata)", "update", async () => {
  const current = await seed(ACT_REQ, OWN_ACCOUNT, ownAccount());
  const patch = editPatch(current, OWN_ACCOUNT, ALL_PERSON_CHANGES);
  return () => clientOps.update("adminGenitore", ACT_REQ, OWN_ACCOUNT, patch);
});
add("C. admin titolare della propria iscrizione", "cambia l'email del genitore del figlio massimo (answers intero + parentAuthorization)", "update", async () => {
  await seed(ACT_REQ, OWN_CHILD, withPhotoAnswers(ownChild()));
  return () => clientOps.updateParentEmail("adminGenitore", ACT_REQ, OWN_CHILD, "nuovo@example.invalid");
});
add("C. admin titolare della propria iscrizione", "normalizeRoomPreferenceMatches sul figlio massimo", "update", async () => {
  await seed(ACT_REQ, OWN_CHILD, ownChild());
  return () => clientOps.normalizeRoomMatches("adminGenitore", [{ activityId: ACT_REQ, registrationId: OWN_CHILD }]);
});
add("C. admin titolare della propria iscrizione", "pattuglia e comitati in un campeggio sul figlio massimo (pattuglia cambiata)", "update", async () => {
  await seed(ACT_CAMP, OWN_CHILD, { ...ownChild(), assignedPatrolId: "pattuglia-gufi", assignedPatrolName: "Gufi", assignedPatrolRole: "leader" });
  return () => clientOps.campAssignments("adminGenitore", [{ activityId: ACT_CAMP, registrationId: OWN_CHILD }]);
});
add("C. admin titolare della propria iscrizione", "pattuglia e comitati in un campeggio sulla propria iscrizione di account massima", "update", async () => {
  await seed(ACT_CAMP, OWN_ACCOUNT, { ...ownAccount(), assignedPatrolId: "pattuglia-gufi", assignedPatrolName: "Gufi", assignedPatrolRole: "leader" });
  return () => clientOps.campAssignments("adminGenitore", [{ activityId: ACT_CAMP, registrationId: OWN_ACCOUNT }]);
});
add("C. admin titolare della propria iscrizione", "pattuglia e comitati in un campeggio con valori invariati (il ramo del titolare passa)", "update", async () => {
  await seed(ACT_CAMP, OWN_CHILD, { ...ownChild(), assignedPatrolId: "pattuglia-aquile", assignedCommittees: [{ committeeId: "cucina", role: "member" }] });
  return () => clientOps.campAssignments("adminGenitore", [{ activityId: ACT_CAMP, registrationId: OWN_CHILD }]);
});

add("C. admin titolare della propria iscrizione", "corregge la propria iscrizione di account massima: adulto → minorenne, richiesta del genitore, stato in attesa e le tre spunte foto tolte", "update", async () => {
  const current = await seed(ACT_REQ, OWN_ACCOUNT, withPhotoAnswers(ownAccount()));
  const patch = editPatch(current, OWN_ACCOUNT, { ...ALL_PERSON_CHANGES, birthDate: MINOR }, { parent: parentDraft() });
  return () => clientOps.update("adminGenitore", ACT_REQ, OWN_ACCOUNT, patch);
});
add("C. admin titolare della propria iscrizione", "sintetico: tutte le chiavi lecite insieme sul figlio massimo annullato (riattivato in attesa)", "update", async () => {
  await seed(ACT_REQ, OWN_CHILD, withPhotoAnswers(ownChild({ cancelled: true })));
  const timestamp = nowIso();
  return () => clientOps.update("adminGenitore", ACT_REQ, OWN_CHILD, ALL_KEYS_PATCH(timestamp));
});

// ---- Le sonde del caso peggiore del titolare (docs/TEST_FIRESTORE_ISCRIZIONI.md) ----

const PROBE_CHANGES = {
  assignedCommittees: [],
  assignedRoomName: null,
  anonymousTokenId: "token-anonimo-1",
  accessCode: "ACC-1234",
  recoveryCode: "REC-5678",
  recoveryPdfGenerated: true,
  registrationStatus: "active",
};
add(
  "D. sonde del titolare (caso peggiore)",
  "sintetico: codici, comitati e riattivazione, figlio firmato legacy (documentato: 972)",
  "update",
  async () => {
    await seed(ACT_REQ, CHILD_OF_GENITORE, F.childRegistration(uid("genitore"), CHILD_OF_GENITORE, "heavy", { cancelled: true, legacy: true }));
    return () => clientOps.update("genitore", ACT_REQ, CHILD_OF_GENITORE, { ...PROBE_CHANGES, updatedAt: nowIso() });
  },
  { reference: 972 },
);
add(
  "D. sonde del titolare (caso peggiore)",
  "sintetico: codici, comitati e riattivazione, adulto senza firma legacy (documentato: 974)",
  "update",
  async () => {
    await seed(ACT_REQ, accountId("utente"), F.accountRegistration(uid("utente"), "heavy", { cancelled: true, legacy: true }));
    return () => clientOps.update("utente", ACT_REQ, accountId("utente"), { ...PROBE_CHANGES, updatedAt: nowIso() });
  },
  { reference: 974 },
);

// Le due sonde con i documenti dei test che le hanno misurate la prima volta
// (parentCancelRulesEmulator: heavyRegistration + legacy + asCancelled, su un
// campeggio; registrationInitialStatusRulesEmulator: cancelledRegistration di un
// account adulto senza firma): servono a confrontare i numeri con quelli
// documentati (972 e 974) e con le rules di prima.
function parentCancelHeavyLegacyCancelled(parentUid, registrationId) {
  const folder = `parentAuthorizations/${F.stakeId}/act/${registrationId}`;
  const answers = {
    birthDate: "2012-02-26",
    genderRoleCategory: "giovane_donna",
    unitName: "Unità Uno",
    address: "Via dei Test 1",
    city: "Roma",
    stateOrProvince: "RM",
    transportMode: "bus",
    roomPreference: "Con le amiche della mia unità",
    roomNotes: "Preferisce il letto in basso",
    emergencyContactSecondaryPhone: "3331111111",
    parentalConsentAccepted: true,
    parentalConsentSignerName: "Genitore Test",
    parentalConsentAcceptedAt: "2026-10-01T08:00:00.000Z",
    photoReleaseAccepted: true,
    photoReleaseSignerName: "Genitore Test",
    photoReleaseAcceptedAt: "2026-10-01T08:00:00.000Z",
    photoInternalConsent: true,
    parentConfirmed: true,
    parentConfirmedAt: "2026-10-01T08:00:00.000Z",
    parentAuthorizationAcceptedAt: "2026-10-01T08:00:00.000Z",
    parentGuardianEmail: "genitore@example.invalid",
    shirtSize: "M",
    swimming: "si",
    previousCamps: ["2024", "2025"],
    talents: ["canto", "chitarra", "cucina"],
    medicalTherapies: "Nessuna",
    notesForLeaders: "Soffre il mal d'auto: meglio davanti sul pullman.",
    parentAuthorizationRequest: { ...F.parentRequest(), emergencyContactName: "Nonna Test", emergencyContactPhone: "3332222222", emergencyContactRelation: "nonna", allergies: "Graminacee, acari", medications: "Antistaminico al bisogno", medicalNotes: "Asma lieve da sforzo, porta il suo spray.", dietaryNotes: "Niente frutta a guscio" },
  };
  for (let index = 1; index <= 30; index += 1) {
    answers[`campo_${String(index).padStart(2, "0")}`] = index % 3 === 0 ? index % 2 === 0 : index % 3 === 1 ? `Risposta libera numero ${index}` : [`a${index}`, `b${index}`];
  }
  return {
    userId: null,
    anonymousUid: null,
    parentUid,
    childId: "figlio-1",
    anonymousTokenId: null,
    firstName: "Figlio",
    lastName: "Test",
    fullName: "Figlio Test",
    email: "genitore@example.invalid",
    phone: "3330000000",
    birthDate: "2012-02-26",
    genderRoleCategory: "giovane_donna",
    unitId: "unita-1",
    unitNameSnapshot: "Unità Uno",
    answers,
    roomPreferenceMatches: {
      "amica-1": { status: "matched", registrationId: "child_x_amica-1", updatedAt: "2026-10-01T08:00:00.000Z" },
      "amica-2": { status: "pending", registrationId: null, updatedAt: "2026-10-01T08:00:00.000Z" },
      "amica-3": { status: "matched", registrationId: "user_amica-3", updatedAt: "2026-10-01T08:00:00.000Z" },
    },
    accessCode: null,
    recoveryCode: null,
    participatingDays: ["2026-10-16", "2026-10-17", "2026-10-18"],
    recoveryPdfGenerated: false,
    parentConsentDocumentName: `modulo-consenso-${registrationId}.pdf`,
    parentConsentDocumentUrl: null,
    parentConsentDocumentPath: `${folder}/consenso.pdf`,
    parentConsentUploadedAt: "2026-10-02T19:30:00.000Z",
    consentSignatureUrl: null,
    consentSignaturePath: `${folder}/signature.png`,
    consentSignatureSetAt: "2026-10-02T19:30:00.000Z",
    parentIdDocumentName: null,
    parentIdDocumentUrl: null,
    parentIdDocumentPath: null,
    parentIdUploadedAt: null,
    parentAuthorization: F.authorizedState(registrationId, "token-usato", { emergencyContactName: "Nonna Test", allergies: "Graminacee, acari", medications: "Antistaminico al bisogno", medicalNotes: "Asma lieve da sforzo, porta il suo spray.", dietaryNotes: "Niente frutta a guscio", brevoMessageId: "<202610010800.1234567890@smtp-relay.mailin.fr>" }),
    linkedLaterToUserId: null,
    registrationStatus: "cancelled",
    submittedByMode: "parent",
    assignedRoomId: "stanza-12",
    assignedTempleShiftId: null,
    assignedServiceTeamIds: [],
    assignedPatrolId: "pattuglia-aquile",
    assignedPatrolName: "Aquile",
    assignedPatrolRole: "member",
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-02T19:30:00.000Z",
  };
}
add(
  "D. sonde del titolare (caso peggiore)",
  "documenti dei test originali: figlio firmato legacy su un campeggio (documentato: 972)",
  "update",
  async () => {
    await seed(ACT_CAMP, CHILD_OF_GENITORE, parentCancelHeavyLegacyCancelled(uid("genitore"), CHILD_OF_GENITORE));
    return () => clientOps.update("genitore", ACT_CAMP, CHILD_OF_GENITORE, { ...PROBE_CHANGES, updatedAt: nowIso() });
  },
  { reference: 972 },
);
add(
  "D. sonde del titolare (caso peggiore)",
  "documenti dei test originali, con birthDate cambiata: figlio firmato legacy su un campeggio",
  "update",
  async () => {
    await seed(ACT_CAMP, CHILD_OF_GENITORE, parentCancelHeavyLegacyCancelled(uid("genitore"), CHILD_OF_GENITORE));
    return () => clientOps.update("genitore", ACT_CAMP, CHILD_OF_GENITORE, { ...PROBE_CHANGES, birthDate: "2012-03-02", "answers.birthDate": "2012-03-02", updatedAt: nowIso() });
  },
);

// Con la clausola sulla data di nascita (6d7c601): `birthDate` cambiata nella stessa scrittura.
const OTHER_MINOR = `${new Date().getFullYear() - 15}-03-02`;
const OTHER_ADULT = `${new Date().getFullYear() - 40}-02-11`;
add(
  "D. sonde del titolare (caso peggiore)",
  "stesse, con birthDate cambiata: figlio firmato legacy (la firma chiude la clausola)",
  "update",
  async () => {
    await seed(ACT_REQ, CHILD_OF_GENITORE, F.childRegistration(uid("genitore"), CHILD_OF_GENITORE, "heavy", { cancelled: true, legacy: true }));
    return () => clientOps.update("genitore", ACT_REQ, CHILD_OF_GENITORE, { ...PROBE_CHANGES, birthDate: OTHER_MINOR, "answers.birthDate": OTHER_MINOR, updatedAt: nowIso() });
  },
);
add(
  "D. sonde del titolare (caso peggiore)",
  "stesse, con birthDate cambiata: adulto senza firma legacy (la clausola legge l'attività e calcola l'età)",
  "update",
  async () => {
    await seed(ACT_REQ, accountId("utente"), F.accountRegistration(uid("utente"), "heavy", { cancelled: true, legacy: true }));
    return () => clientOps.update("utente", ACT_REQ, accountId("utente"), { ...PROBE_CHANGES, birthDate: OTHER_ADULT, "answers.birthDate": OTHER_ADULT, updatedAt: nowIso() });
  },
);

add("F. titolare, risalvataggio con birthDate cambiata", "account adulto massimo attivo → in attesa: data da minorenne e richiesta del genitore (ramo active → pending)", "update", async () => {
  const current = await seed(ACT_REQ, accountId("utente"), F.accountRegistration(uid("utente"), "maximal"));
  const answers = { ...current.answers, birthDate: OTHER_MINOR, parentAuthorizationRequest: { ...F.parentRequest(), emergencyContactName: "Anna Rossi", emergencyContactPhone: "3409876543", emergencyContactRelation: "nonna", allergies: "Graminacee", medications: "Salbutamolo", medicalNotes: "Asma da sforzo", dietaryNotes: "Niente frutta a guscio", submittedAt: nowIso() } };
  return () => clientOps.resave("utente", ACT_REQ, accountId("utente"), current, { status: "pending_parent_authorization", changes: { birthDate: OTHER_MINOR, answers } });
});
add("F. titolare, risalvataggio con birthDate cambiata", "figlio massimo attivo senza firma → in attesa: modulo con un'altra data da minorenne", "update", async () => {
  const base = maximalChild("genitore");
  const current = await seed(ACT_REQ, CHILD_OF_GENITORE, { ...base, registrationStatus: "active", parentAuthorization: { ...base.parentAuthorization, status: "email_sent", authorizedAt: null } });
  return () => clientOps.resave("genitore", ACT_REQ, CHILD_OF_GENITORE, current, { status: "pending_parent_authorization", changes: { birthDate: OTHER_MINOR } });
});
add("F. titolare, risalvataggio con birthDate cambiata", "account adulto massimo attivo → in attesa, senza cambiare la data (solo stato e updatedAt)", "update", async () => {
  await seed(ACT_REQ, accountId("utente"), F.accountRegistration(uid("utente"), "maximal"));
  return () => clientOps.setStatus("utente", ACT_REQ, accountId("utente"), "pending_parent_authorization");
});
add("F. titolare, risalvataggio con birthDate cambiata", "account adulto massimo attivo: modulo con un'altra data da adulto (la clausola legge l'attività)", "update", async () => {
  const current = await seed(ACT_REQ, accountId("utente"), F.accountRegistration(uid("utente"), "maximal"));
  return () => clientOps.resave("utente", ACT_REQ, accountId("utente"), current, { changes: { phone: "3470000001", birthDate: OTHER_ADULT } });
});
add("F. titolare, risalvataggio con birthDate cambiata", "figlio massimo firmato attivo: modulo con un'altra data da minorenne", "update", async () => {
  const current = await seed(ACT_REQ, CHILD_OF_GENITORE, { ...maximalChild("genitore"), registrationStatus: "active" });
  return () => clientOps.resave("genitore", ACT_REQ, CHILD_OF_GENITORE, current, { changes: { phone: "3470000001", birthDate: OTHER_MINOR } });
});
add("F. titolare, risalvataggio con birthDate cambiata", "figlio massimo firmato annullato: riattivazione con un'altra data", "update", async () => {
  const current = await seed(ACT_REQ, CHILD_OF_GENITORE, maximalChild("genitore", { cancelled: true }));
  return () => clientOps.resave("genitore", ACT_REQ, CHILD_OF_GENITORE, current, { status: "active", changes: { birthDate: OTHER_MINOR } });
});
add("F. titolare, risalvataggio con birthDate cambiata", "account adulto massimo annullato: riattivazione con un'altra data da adulto", "update", async () => {
  const current = await seed(ACT_REQ, accountId("utente"), F.accountRegistration(uid("utente"), "maximal", { cancelled: true }));
  return () => clientOps.resave("utente", ACT_REQ, accountId("utente"), current, { status: "active", changes: { birthDate: OTHER_ADULT } });
});

// ---- Riferimenti già documentati: verificano il metodo ----------------------

add(
  "E. riferimenti documentati (verifica del metodo)",
  "modulo, iscrizione figlio pesante (documentato: 707)",
  "update",
  async () => {
    const current = await seed(ACT_REQ, CHILD_OF_GENITORE, F.childRegistration(uid("genitore"), CHILD_OF_GENITORE, "heavy"));
    return () => clientOps.resave("genitore", ACT_REQ, CHILD_OF_GENITORE, current, { changes: { phone: "3470000001" } });
  },
  { reference: 707 },
);
add(
  "E. riferimenti documentati (verifica del metodo)",
  "riattivazione, iscrizione figlio pesante firmata (documentato: 725-794)",
  "update",
  async () => {
    const current = await seed(ACT_REQ, CHILD_OF_GENITORE, F.childRegistration(uid("genitore"), CHILD_OF_GENITORE, "heavy", { cancelled: true }));
    return () => clientOps.resave("genitore", ACT_REQ, CHILD_OF_GENITORE, current, { status: "active" });
  },
  { reference: 794 },
);
add(
  "E. riferimenti documentati (verifica del metodo)",
  "crea il figlio minore in attesa, documento massimo (documentato: 806)",
  "create",
  async () => {
    const path = regPath(ACT_REQ, CHILD_OF_GENITORE);
    await adminDb.doc(path).delete();
    const base = { ...F.childRegistration(uid("genitore"), CHILD_OF_GENITORE, "pending"), parentAuthorization: null };
    const document = {
      ...base,
      answers: heavyAnswers(56, base.answers),
      roomPreferenceMatches: roomMatches(),
      participatingDays: DAYS,
      anonymousTokenId: "token-anonimo-1",
      accessCode: "ACC-1234",
      recoveryCode: "REC-5678",
      recoveryPdfGenerated: true,
    };
    return () => setDoc(regRef("genitore", ACT_REQ, CHILD_OF_GENITORE), document);
  },
  { reference: 806 },
);

// ---------------------------------------------------------------------------
// Esecuzione
// ---------------------------------------------------------------------------

describe(`costo in espressioni${COMPARE_MODE ? ` (confronto con ${RULES_FILE})` : ""}`, () => {
  test("calibrazione: con la sola condizione `true` il tetto è 993 elementi", async (t) => {
    CAP = await longestPadding(
      {
        method: "create",
        inner: "true",
        prepare: async () => {
          const id = manualId();
          return () => setDoc(regRef("admin", ACT_REQ, id), { calibrazione: true });
        },
      },
      1100,
    );
    t.diagnostic(`tetto della lista di riempimento con la sola condizione 'true': ${CAP}`);
    assert.equal(CAP, 993, "il metodo del documento presuppone 993 elementi");
  });

  for (const scenario of SCENARIOS) {
    test(`${scenario.group} · ${scenario.name}`, { skip: Boolean(ONLY && !ONLY.test(`${scenario.group} · ${scenario.name}`)) }, async (t) => {
      const longest = await longestPadding(scenario, CAP);
      const cost = longest < 0 ? null : CAP - longest;
      const margin = cost === null ? null : 1000 - cost;
      const line = `${cost === null ? "oltre 1000 o negata" : `${cost} (margine ${margin})`}${scenario.reference ? ` [documentato ${scenario.reference}]` : ""} · ${scenario.group} · ${scenario.name}`;
      results.push(line);
      t.diagnostic(line);
      if (COMPARE_MODE) return;
      // Un flusso vero deve restare a 15 espressioni dal limite. Le scritture sintetiche (nessun client le fa)
      // a 5, e possono anche sforare: si registra, non si asserisce.
      const synthetic = scenario.name.startsWith("sintetico");
      if (cost === null) {
        assert.ok(synthetic, `${scenario.name}: negata anche senza riempimento (oltre le 1000 espressioni, o rifiutata per altro)`);
        return;
      }
      const minimumMargin = synthetic ? 5 : 15;
      assert.ok(margin >= minimumMargin, `${scenario.name}: costo ${cost}, margine ${margin} sotto le ${minimumMargin} espressioni`);
    });
  }
});
