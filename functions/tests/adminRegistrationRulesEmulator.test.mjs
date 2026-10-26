// Rules delle iscrizioni scritte dall'admin (docs/ADMIN_ISCRITTI.md, scelta R):
// validAdminManualCreate (iscrizione a mano `manual_`) e
// validAdminRegistrationUpdate (correzione dei dati, stato come transizione,
// email del genitore, abbinamenti stanza), più il campo `createdBy` che solo
// l'admin scrive alla creazione e che il titolare non tocca.
//
// SDK client con utenti normali (token mock dell'emulatore: admin del palo,
// super admin, admin di un altro palo, dirigenti di unità, partecipante,
// genitore e un admin che è anche genitore); l'Admin SDK serve solo per
// seminare e rileggere, perché ignora le rules. I payload sono quelli veri del
// client admin (src/utils/adminRegistration.ts: buildManualRegistrationDoc,
// planAdminEdit + buildAdminEditPatch, buildRequestAuthorizationPatch,
// planAdminReactivate) e le chiamate quelle dei servizi
// (registrationsService.ts: adminCreateManualRegistration,
// adminUpdateRegistration, adminSetRegistrationStatus,
// adminUpdateParentAuthorizationEmail, normalizeRoomPreferenceMatches,
// adminDeleteRegistration; campManagementService.ts: il batch delle pattuglie).
// Ogni rifiuto controlla che il documento sia rimasto com'era.
//
// I casi dove il comportamento di oggi contraddice la spec sono `todo` con il
// motivo: restano rossi finché non si sistemano e non fanno fallire il resto.
//
// Il costo in espressioni (limite di 1000) lo misura
// adminRegistrationBudgetEmulator.test.mjs.
//
// Rilancio dalla radice del repository (solo Firestore):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --only firestore --config firebase.room-test.json --project demo-admin-iscritti \
//     'node --test --test-concurrency=1 functions/tests/adminRegistrationRulesEmulator.test.mjs'
// Con le porte occupate da un'altra sessione non fermarla: copia la config su
// porte diverse (Firestore, hub, logging, websocket) e rimuovila a fine prova.
// Sul Mac mini il lavoro gira lì (`mini`, ~/dev/agent-handbook/rules/mac-mini.md).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { collection, deleteDoc, deleteField, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";

import {
  buildAdminEditPatch,
  buildRequestAuthorizationPatch,
  personDraftFromRegistration,
  planAdminEdit,
  planAdminReactivate,
} from "../../src/utils/adminRegistration.ts";
import {
  ADULT,
  MINOR,
  SIGNED_AT,
  UNIT_1,
  UNIT_2,
  createFixtures,
  nowIso,
} from "./helpers/adminRegistrationFixtures.mjs";

const F = createFixtures("admin-iscritti");
const {
  uid,
  stakeId,
  adminDb,
  clientOps,
  expectDenied,
  expectDeniedUnchanged,
  manualDoc,
  manualId,
  minorDraft,
  parentDraft,
  personDraft,
  regPath,
  regRef,
  stored,
  fs,
} = F;

before(async () => {
  await F.setup();
});
after(async () => {
  await F.teardown();
});

const adminUid = uid("admin");
const childIdOf = (actorName) => `child_${uid(actorName)}_figlio-1`;
const accountIdOf = (actorName) => `user_${uid(actorName)}`;

// ---------------------------------------------------------------------------
// Utilità dei casi
// ---------------------------------------------------------------------------

/** Giorni da oggi a cui la persona compie 18 anni: data di nascita per i bordi dell'età. */
function birthDateTurning18In(offsetDays) {
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offsetDays * 86_400_000);
  return new Date(Date.UTC(target.getUTCFullYear() - 18, target.getUTCMonth(), target.getUTCDate())).toISOString().slice(0, 10);
}

const thisYearMinus = (years) => new Date().getFullYear() - years;

/** Documento letto com'è nel database: quello che il client rilegge prima di modificarlo. */
const asRegistration = (id, data) => ({ id, ...data });

/** Patch della "Modifica dati" come la costruisce il client: piano, poi chiavi di buildAdminEditPatch. */
function editPatch(current, id, personChanges, { parent = { firstName: "", lastName: "", email: "", phone: "" }, requires = true } = {}) {
  const registration = asRegistration(id, current);
  const person = { ...personDraftFromRegistration(registration), ...personChanges };
  const plan = planAdminEdit(registration, person, parent, {
    requiresParentAuthorization: requires,
    previousUnitName: current.unitNameSnapshot,
  });
  const patch = buildAdminEditPatch({ registration, person, parent, plan, timestamp: nowIso(), deleteValue: deleteField() });
  return { patch, plan };
}

const withPatch = (activityId, id, patch) => clientOps.update("admin", activityId, id, patch);

/** Cambiano solo le chiavi indicate (percorsi puntati compresi: si confrontano le radici). */
function assertOnlyChanged(before, after, allowedRoots) {
  const roots = new Set(allowedRoots.map((key) => key.split(".")[0]));
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (roots.has(key)) continue;
    assert.deepEqual(after[key], before[key], `${key} doveva restare com'era`);
  }
}

// I 21 campi che alla creazione restano vuoti (stesso elenco di
// registrationInitialStatusRulesEmulator): [campo, valore valorizzato].
const PROTECTED_FIELDS = [
  ["parentConsentDocumentName", "modulo-consenso.pdf"],
  ["parentConsentDocumentUrl", "https://storage.example.invalid/consenso.pdf"],
  ["parentConsentDocumentPath", "parentAuthorizations/s/act/r/consenso.pdf"],
  ["parentConsentUploadedAt", SIGNED_AT],
  ["consentSignatureUrl", "https://storage.example.invalid/firma.png"],
  ["consentSignaturePath", "parentAuthorizations/s/act/r/signature.png"],
  ["consentSignatureSetAt", SIGNED_AT],
  ["parentIdDocumentName", "documento.pdf"],
  ["parentIdDocumentUrl", "https://storage.example.invalid/documento.pdf"],
  ["parentIdDocumentPath", "parentAuthorizations/s/act/r/documento.pdf"],
  ["parentIdUploadedAt", SIGNED_AT],
  ["parentAuthorization", { status: "authorized", authorizedAt: SIGNED_AT }],
  ["assignedRoomId", "stanza-12"],
  ["assignedRoomName", "Stanza 12"],
  ["assignedTempleShiftId", "turno-tempio-3"],
  ["assignedServiceTeamIds", ["squadra-cucina"]],
  ["assignedPatrolId", "pattuglia-aquile"],
  ["assignedPatrolName", "Aquile"],
  ["assignedPatrolRole", "member"],
  ["assignedCommittees", [{ committeeId: "cucina", role: "member" }]],
  ["linkedLaterToUserId", "utente-collegato"],
];

// ===========================================================================
// 0. Il client scrive solo chiavi della lista delle rules
// ===========================================================================

describe("0. contratto fra client e rules", () => {
  const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
  const block = rules.slice(rules.indexOf("function validAdminRegistrationUpdate"));
  const allowlist = (() => {
    const match = /changed\.hasOnly\(\[([\s\S]*?)\]\)/u.exec(block);
    assert.ok(match, "lista hasOnly di validAdminRegistrationUpdate non trovata");
    return new Set([...match[1].matchAll(/'([A-Za-z]+)'/gu)].map((item) => item[1]));
  })();

  test("le chiavi di buildAdminEditPatch e buildRequestAuthorizationPatch sono nella lista dell'admin", () => {
    const current = {
      ...manualDoc({ person: personDraft(), requires: true }),
    };
    const { patch } = editPatch(current, "manual_x", { birthDate: MINOR }, { parent: parentDraft() });
    const request = buildRequestAuthorizationPatch({ registrationStatus: "active" }, parentDraft(), nowIso());
    for (const key of [...Object.keys(patch), ...Object.keys(request)]) {
      assert.ok(allowlist.has(key.split(".")[0]), `${key} non è nella lista hasOnly di validAdminRegistrationUpdate`);
    }
  });

  test("createdBy è ammesso dalla lista del payload e non da quella dell'update admin", () => {
    assert.match(rules, /'createdBy',\s*\n\s*'createdAt'/u, "createdBy nella lista di validRegistrationPayload");
    assert.ok(!allowlist.has("createdBy"), "l'admin non cambia mai createdBy");
  });
});

// ===========================================================================
// 1. Creazione di un'iscrizione a mano
// ===========================================================================

describe("1. admin crea un'iscrizione a mano (adminCreateManualRegistration)", () => {
  let AUTH_ON;
  let AUTH_OFF;
  before(async () => {
    AUTH_ON = await F.seedActivity({ requires: true });
    AUTH_OFF = await F.seedActivity({ requires: false });
  });

  /** Creazione consentita: il documento c'è ed è identico a ciò che il client ha scritto. */
  async function expectCreated(activityId, document, id = manualId(), actor = "admin") {
    await clientOps.createManual(actor, activityId, id, document);
    const data = await stored(regPath(activityId, id));
    assert.deepEqual(data, document);
    return { id, data };
  }

  test("adulto: attivo, in un'attività che chiede l'autorizzazione", async () => {
    const document = manualDoc({ person: personDraft(), requires: true });
    assert.equal(document.registrationStatus, "active");
    await expectCreated(AUTH_ON, document);
  });

  test("minorenne con l'email del genitore: in attesa, con la richiesta di autorizzazione", async () => {
    const document = manualDoc({ person: minorDraft(), parent: parentDraft(), requires: true });
    assert.equal(document.registrationStatus, "pending_parent_authorization");
    assert.equal(document.answers.parentAuthorizationRequest.parentEmail, "genitore@example.invalid");
    await expectCreated(AUTH_ON, document);
  });

  test("minorenne senza l'email del genitore: in attesa, senza la richiesta", async () => {
    const document = manualDoc({ person: minorDraft(), parent: parentDraft({ email: "" }), requires: true });
    assert.equal(document.registrationStatus, "pending_parent_authorization");
    assert.ok(!("parentAuthorizationRequest" in document.answers));
    await expectCreated(AUTH_ON, document);
  });

  test("minorenne in un'attività senza autorizzazione: attivo", async () => {
    const document = manualDoc({ person: minorDraft(), requires: false });
    assert.equal(document.registrationStatus, "active");
    await expectCreated(AUTH_OFF, document);
  });

  test("email e telefono della persona valorizzati, categoria dirigente, unità due", async () => {
    const document = manualDoc({
      person: personDraft({ genderRoleCategory: "dirigente", unitId: UNIT_2.id, unitName: UNIT_2.name, email: "luca@example.invalid", phone: "3471234567" }),
      requires: true,
    });
    await expectCreated(AUTH_ON, document);
  });

  test("attività con le iscrizioni chiuse: l'admin aggiunge lo stesso", async () => {
    const closed = await F.seedActivity({ requires: true, status: "registrations_closed" });
    await expectCreated(closed, manualDoc({ person: personDraft(), requires: true }));
  });

  test("il super admin e l'admin che è anche genitore creano come ogni admin del palo", async () => {
    await expectCreated(AUTH_ON, manualDoc({ person: personDraft(), createdBy: uid("super-admin") }), manualId(), "superAdmin");
    await expectCreated(AUTH_ON, manualDoc({ person: personDraft(), createdBy: uid("admin-genitore") }), manualId(), "adminGenitore");
  });

  test("18 anni compiuti ieri e oggi: attivo; 18 anni fra 30 giorni: solo in attesa", async () => {
    for (const offset of [-1, 0]) {
      await expectCreated(AUTH_ON, manualDoc({ person: personDraft({ birthDate: birthDateTurning18In(offset) }), requires: false, registrationStatus: "active" }));
    }
    const soon = personDraft({ birthDate: birthDateTurning18In(30) });
    const active = manualDoc({ person: soon, requires: false, registrationStatus: "active" });
    const id = manualId();
    await expectDenied(() => clientOps.createManual("admin", AUTH_ON, id, active), "17 anni e 11 mesi, active");
    assert.equal(await stored(regPath(AUTH_ON, id)), undefined);
    await expectCreated(AUTH_ON, manualDoc({ person: soon, parent: parentDraft(), requires: true }), id);
  });

  // ---- Il retry dopo un errore di rete: lo stesso setDoc, stesso id ----------

  test("secondo setDoc identico (retry): passa e non cambia nulla", async () => {
    const document = manualDoc({ person: minorDraft(), parent: parentDraft(), requires: true });
    const { id } = await expectCreated(AUTH_ON, document);
    await clientOps.createManual("admin", AUTH_ON, id, document);
    assert.deepEqual(await stored(regPath(AUTH_ON, id)), document);
  });

  test("retry con un altro updatedAt (timestamp non fissato): passa", async () => {
    const document = manualDoc({ person: personDraft(), requires: true });
    const { id } = await expectCreated(AUTH_ON, document);
    const again = { ...document, updatedAt: new Date(Date.now() + 5000).toISOString() };
    await clientOps.createManual("admin", AUTH_ON, id, again);
    assert.equal((await stored(regPath(AUTH_ON, id))).updatedAt, again.updatedAt);
  });

  test("retry dopo che il trigger ha scritto parentAuthorization: negato, il documento resta quello del trigger (il client controlla prima l'esistenza)", async () => {
    // Il secondo setDoc rimetterebbe parentAuthorization a null: le rules lo negano
    // e per questo il foglio, dal secondo tentativo, legge prima il documento
    // (registrationsService.adminManualRegistrationExists) e non riscrive.
    const document = manualDoc({ person: minorDraft(), parent: parentDraft(), requires: true });
    const { id } = await expectCreated(AUTH_ON, document);
    await adminDb.doc(regPath(AUTH_ON, id)).update({ parentAuthorization: F.emailSentState("token-nuovo"), updatedAt: nowIso() });
    await expectDeniedUnchanged(regPath(AUTH_ON, id), () => clientOps.createManual("admin", AUTH_ON, id, document), "retry dopo il trigger");
    assert.equal((await stored(regPath(AUTH_ON, id))).parentAuthorization.tokenId, "token-nuovo");
  });

  test("id nuovo: nessun doppione, due documenti distinti", async () => {
    const document = manualDoc({ person: personDraft(), requires: true });
    const first = await expectCreated(AUTH_ON, document);
    const second = await expectCreated(AUTH_ON, document);
    assert.notEqual(first.id, second.id);
  });
});

// ===========================================================================
// 2. Creazione rifiutata: id e payload
// ===========================================================================

describe("2. creazione `manual_` rifiutata", () => {
  let AUTH_ON;
  before(async () => {
    AUTH_ON = await F.seedActivity({ requires: true });
  });

  const adult = () => manualDoc({ person: personDraft(), requires: true });
  const minorPending = () => manualDoc({ person: minorDraft(), parent: parentDraft(), requires: true });

  /** `rejected` è negato e non lascia traccia; poi `accepted` (stesso id) passa: a negare era davvero la differenza. */
  async function deniedThenAccepted(rejected, accepted, label, id = manualId()) {
    const path = regPath(AUTH_ON, id);
    await expectDenied(() => clientOps.createManual("admin", AUTH_ON, id, rejected), label);
    assert.equal(await stored(path), undefined, `${label}: un rifiuto non lascia documenti`);
    await clientOps.createManual("admin", AUTH_ON, id, accepted);
    assert.ok(await stored(path), `${label}: il controllo è stato scritto`);
  }
  const without = (document, key) => Object.fromEntries(Object.entries(document).filter(([name]) => name !== key));

  test("id senza il prefisso manual_ o fuori forma", async () => {
    const document = adult();
    for (const id of [
      `abc${F.runId}`,
      `manual-${F.runId}`,
      "manual_abc12", // 5 caratteri: sotto il minimo di 6
      `manual_${"a".repeat(81)}`, // sopra il massimo di 80
      "manual_ab cd ef",
      "manual_ab.cd.ef",
      "manual_ab/cd/ef",
      `Manual_${F.runId}`,
      `user_${adminUid}`,
      `guest_${adminUid}`,
      `child_${adminUid}_figlio-1`,
    ]) {
      const path = regPath(AUTH_ON, id);
      await expectDenied(() => clientOps.createManual("admin", AUTH_ON, id, document), `id ${id}`);
      assert.equal(await stored(path), undefined, `id ${id}`);
    }
    // Controllo: lo stesso documento con un id valido passa.
    await clientOps.createManual("admin", AUTH_ON, manualId(), document);
  });

  test("id valido ai due estremi (6 e 80 caratteri, lettere, cifre, trattino e sottolineatura)", async () => {
    for (const id of [`manual_${F.runId.slice(0, 6)}`, `manual_${"k".repeat(80)}`, `manual_${"x_y-".repeat(20)}`]) {
      await clientOps.createManual("admin", AUTH_ON, id, adult());
      assert.ok(await stored(regPath(AUTH_ON, id)), id);
    }
  });

  test("createdBy di un altro, mancante o null", async () => {
    const accepted = adult();
    await deniedThenAccepted({ ...accepted, createdBy: uid("utente") }, accepted, "createdBy di un altro");
    await deniedThenAccepted(without(accepted, "createdBy"), accepted, "createdBy mancante");
    await deniedThenAccepted({ ...accepted, createdBy: null }, accepted, "createdBy null");
    await deniedThenAccepted({ ...accepted, createdBy: "" }, accepted, "createdBy vuoto");
  });

  test("data di nascita vuota, malformata o non stringa", async () => {
    const accepted = adult();
    for (const birthDate of ["", "9 maggio 2012", "2012-5-9", "2012/05/09", "09-05-2012", "2012-05-09T00:00:00Z", " 2012-05-09", null, 20120509]) {
      await deniedThenAccepted({ ...accepted, birthDate }, accepted, `birthDate ${JSON.stringify(birthDate)}`);
    }
  });

  test("osservazione: una data che passa la forma ma non il calendario (2013-02-30) con lo stato in attesa", async (t) => {
    const document = manualDoc({ person: minorDraft({ birthDate: "2013-02-30" }), parent: parentDraft(), requires: true, registrationStatus: "pending_parent_authorization" });
    let outcome;
    try {
      await clientOps.createManual("admin", AUTH_ON, manualId(), document);
      outcome = "consentita";
    } catch (error) {
      outcome = `negata (${error?.code})`;
    }
    t.diagnostic(`birthDate 2013-02-30, pending, attività con autorizzazione: ${outcome}`);
  });

  test("unità vuota, che non esiste, di un altro palo", async () => {
    const accepted = adult();
    for (const unitId of ["", "unita-fantasma", "unita-altro-palo", "UNITA-1"]) {
      await deniedThenAccepted({ ...accepted, unitId }, accepted, `unitId ${JSON.stringify(unitId)}`);
    }
  });

  test("nome o cognome vuoti", async () => {
    const accepted = adult();
    await deniedThenAccepted({ ...accepted, firstName: "" }, accepted, "nome vuoto");
    await deniedThenAccepted({ ...accepted, lastName: "" }, accepted, "cognome vuoto");
  });

  test("minorenne attivo in un'attività che chiede l'autorizzazione (si salterebbe il consenso)", async () => {
    const accepted = minorPending();
    await deniedThenAccepted({ ...accepted, registrationStatus: "active" }, accepted, "minorenne active");
    const { parentAuthorizationRequest: _request, ...answers } = accepted.answers;
    await deniedThenAccepted({ ...accepted, answers, registrationStatus: "active" }, accepted, "minorenne active senza richiesta");
  });

  test("stato confirmed, cancelled, rejected_by_parent, draft, submitted, waitlist, fuori elenco", async () => {
    const accepted = adult();
    for (const status of ["confirmed", "cancelled", "rejected_by_parent", "draft", "submitted", "waitlist", "pending", "ACTIVE", "", null, 1]) {
      await deniedThenAccepted({ ...accepted, registrationStatus: status }, accepted, `stato ${JSON.stringify(status)}`);
    }
  });

  test("consensi, firme, documenti e assegnazioni valorizzati (ognuno dei 21 campi)", async () => {
    const accepted = adult();
    for (const [field, value] of PROTECTED_FIELDS) {
      await deniedThenAccepted({ ...accepted, [field]: value }, accepted, field);
    }
    const everything = { ...accepted, ...Object.fromEntries(PROTECTED_FIELDS) };
    await deniedThenAccepted(everything, accepted, "tutti insieme");
  });

  test("campi stringa o mappa vuoti ma non null ('' e {})", async () => {
    const accepted = adult();
    for (const [field, empty] of [
      ["parentConsentDocumentName", ""],
      ["consentSignaturePath", ""],
      ["assignedRoomId", ""],
      ["assignedPatrolId", ""],
      ["parentAuthorization", {}],
    ]) {
      await deniedThenAccepted({ ...accepted, [field]: empty }, accepted, `${field} = ${JSON.stringify(empty)}`);
    }
  });

  test("codici di accesso e recupero, token anonimo, PDF di recupero", async () => {
    const accepted = adult();
    await deniedThenAccepted({ ...accepted, accessCode: "ACC-1234" }, accepted, "accessCode");
    await deniedThenAccepted({ ...accepted, recoveryCode: "REC-5678" }, accepted, "recoveryCode");
    await deniedThenAccepted({ ...accepted, anonymousTokenId: "token-1" }, accepted, "anonymousTokenId");
    await deniedThenAccepted({ ...accepted, recoveryPdfGenerated: true }, accepted, "recoveryPdfGenerated");
  });

  test("titolare valorizzato (userId, anonymousUid, parentUid, childId)", async () => {
    const accepted = adult();
    await deniedThenAccepted({ ...accepted, userId: uid("utente") }, accepted, "userId");
    await deniedThenAccepted({ ...accepted, anonymousUid: uid("utente") }, accepted, "anonymousUid");
    await deniedThenAccepted({ ...accepted, parentUid: uid("genitore") }, accepted, "parentUid");
    await deniedThenAccepted({ ...accepted, childId: "figlio-1" }, accepted, "childId");
    await deniedThenAccepted({ ...accepted, parentUid: uid("genitore"), childId: "figlio-1" }, accepted, "parentUid e childId");
  });

  test("submittedByMode diverso da anonymous", async () => {
    const accepted = adult();
    for (const mode of ["authenticated", "parent", "admin", "", null]) {
      await deniedThenAccepted({ ...accepted, submittedByMode: mode }, accepted, `submittedByMode ${JSON.stringify(mode)}`);
    }
    await deniedThenAccepted(without(accepted, "submittedByMode"), accepted, "submittedByMode mancante");
  });

  test("nelle risposte solo i dati della persona e la richiesta al genitore (nessun flag di consenso)", async () => {
    const accepted = minorPending();
    for (const [key, value] of [
      ["parentConfirmed", true],
      ["parentConfirmedAt", SIGNED_AT],
      ["photoInternalConsent", true],
      ["parentalConsentAccepted", true],
      ["parentAuthorizationAcceptedAt", SIGNED_AT],
      ["allergies", "nessuna"],
      ["transportMode", "bus"],
    ]) {
      await deniedThenAccepted({ ...accepted, answers: { ...accepted.answers, [key]: value } }, accepted, `answers.${key}`);
    }
  });

  test("campo fuori elenco, tipi sbagliati, categoria non valida", async () => {
    const accepted = adult();
    await deniedThenAccepted({ ...accepted, note: "solo admin" }, accepted, "campo fuori elenco");
    await deniedThenAccepted({ ...accepted, status: "active" }, accepted, "status legacy");
    await deniedThenAccepted({ ...accepted, fullName: 5 }, accepted, "fullName numerico");
    await deniedThenAccepted({ ...accepted, email: null }, accepted, "email null");
    await deniedThenAccepted({ ...accepted, genderRoleCategory: "altro" }, accepted, "categoria non valida");
    await deniedThenAccepted({ ...accepted, answers: "testo" }, accepted, "answers non mappa");
    await deniedThenAccepted(without(accepted, "unitNameSnapshot"), accepted, "unitNameSnapshot mancante");
  });
});

// ===========================================================================
// 3. Chi non è admin del palo non crea né scrive un'iscrizione a mano
// ===========================================================================

describe("3. creazione `manual_` da chi non è admin del palo", () => {
  let AUTH_ON;
  before(async () => {
    AUTH_ON = await F.seedActivity({ requires: true });
  });

  const OUTSIDERS = [
    ["un dirigente di unità", "dirigente", "dirigente"],
    ["un dirigente di un'altra unità", "dirigenteUnita2", "dirigente-unita-2"],
    ["un partecipante", "utente", "utente"],
    ["un genitore", "genitore", "genitore"],
    ["un admin di un altro palo", "adminAltroPalo", "admin-altro-palo"],
    ["un utente non autenticato", "nonAutenticato", null],
  ];
  for (const [label, actor, name] of OUTSIDERS) {
    test(`${label}: negato, anche con createdBy che è lui`, async () => {
      const id = manualId();
      const document = manualDoc({ person: personDraft(), createdBy: name ? uid(name) : "anonimo", requires: true });
      await expectDenied(() => clientOps.createManual(actor, AUTH_ON, id, document), label);
      assert.equal(await stored(regPath(AUTH_ON, id)), undefined);
      await expectDenied(
        () => clientOps.createManual(actor, AUTH_ON, id, { ...document, createdBy: adminUid }),
        `${label}, createdBy dell'admin`,
      );
      assert.equal(await stored(regPath(AUTH_ON, id)), undefined);
    });
  }

  test("un partecipante non crea un manual_ intestandosi l'iscrizione (userId proprio)", async () => {
    const id = manualId();
    const document = manualDoc({ person: personDraft(), createdBy: uid("utente"), userId: uid("utente"), submittedByMode: "authenticated" });
    await expectDenied(() => clientOps.createManual("utente", AUTH_ON, id, document));
    assert.equal(await stored(regPath(AUTH_ON, id)), undefined);
  });

  test("l'admin non crea più iscrizioni di altri con id diverso da manual_ (user_, child_)", async () => {
    // Prima isStakeAdmin bastava per creare qualunque documento; ora l'admin
    // crea a mano solo con manual_, il resto passa dalle regole del titolare.
    const otherUser = F.accountRegistration(uid("utente"), "light");
    const otherChild = F.childRegistration(uid("genitore"), childIdOf("genitore"), "pending");
    for (const [id, data] of [
      [accountIdOf("utente"), { ...otherUser, parentAuthorization: null }],
      [childIdOf("genitore"), { ...otherChild, parentAuthorization: null }],
    ]) {
      await expectDenied(() => clientOps.createManual("admin", AUTH_ON, id, data), `admin crea ${id}`);
      assert.equal(await stored(regPath(AUTH_ON, id)), undefined);
    }
  });

  test("l'admin che si iscrive da sé (user_ proprio) passa dal ramo del titolare", async () => {
    const own = { ...F.accountRegistration(adminUid, "light"), parentAuthorization: null };
    await clientOps.createManual("admin", AUTH_ON, accountIdOf("admin"), own);
    assert.ok(await stored(regPath(AUTH_ON, accountIdOf("admin"))));
  });

  test("l'admin che è anche genitore iscrive il figlio dal modulo (child_ proprio)", async () => {
    const own = { ...F.childRegistration(uid("admin-genitore"), childIdOf("admin-genitore"), "pending"), parentAuthorization: null };
    await clientOps.createManual("adminGenitore", AUTH_ON, childIdOf("admin-genitore"), own);
    assert.ok(await stored(regPath(AUTH_ON, childIdOf("admin-genitore"))));
  });
});

// ===========================================================================
// 4. Lettura ed eliminazione di un'iscrizione a mano
// ===========================================================================

describe("4. chi vede e chi elimina un'iscrizione a mano", () => {
  let ctx;
  before(async () => {
    const activityId = await F.seedActivity({ requires: true });
    const id = manualId();
    ctx = await F.seedRegistration(manualDoc({ person: personDraft({ unitId: UNIT_1.id }), requires: true }), id, { activityId });
  });

  test("la vedono l'admin e il dirigente della sua unità; non il dirigente di un'altra unità né gli altri", async () => {
    for (const actor of ["admin", "superAdmin", "dirigente"]) {
      const snapshot = await getDoc(regRef(actor, ctx.activityId, ctx.registrationId));
      assert.ok(snapshot.exists(), actor);
    }
    for (const actor of ["dirigenteUnita2", "utente", "genitore", "adminAltroPalo", "nonAutenticato"]) {
      await expectDenied(() => getDoc(regRef(actor, ctx.activityId, ctx.registrationId)), `lettura di ${actor}`);
    }
  });

  test("la query del dirigente (where unitId == la sua) la trova; quella dell'altra unità no", async () => {
    const reference = collection(fs("dirigente"), "stakes", stakeId, "activities", ctx.activityId, "registrations");
    const own = await getDocs(query(reference, where("unitId", "==", UNIT_1.id)));
    assert.ok(own.docs.some((item) => item.id === ctx.registrationId));
    const otherReference = collection(fs("dirigenteUnita2"), "stakes", stakeId, "activities", ctx.activityId, "registrations");
    const other = await getDocs(query(otherReference, where("unitId", "==", UNIT_2.id)));
    assert.ok(!other.docs.some((item) => item.id === ctx.registrationId));
  });

  test("solo l'admin del palo la elimina (adminDeleteRegistration)", async () => {
    for (const actor of ["dirigente", "dirigenteUnita2", "utente", "genitore", "adminAltroPalo", "nonAutenticato"]) {
      await expectDenied(() => deleteDoc(regRef(actor, ctx.activityId, ctx.registrationId)), `eliminazione di ${actor}`);
      assert.ok(await stored(ctx.path), `${actor}: resta lì`);
    }
    await deleteDoc(regRef("admin", ctx.activityId, ctx.registrationId));
    assert.equal(await stored(ctx.path), undefined);
  });

  test("nessun altro la modifica: dirigente, partecipante, genitore, admin di un altro palo", async () => {
    const fresh = await F.seedRegistration(manualDoc({ person: personDraft(), requires: true }), manualId());
    for (const actor of ["dirigente", "utente", "genitore", "adminAltroPalo", "nonAutenticato"]) {
      await expectDeniedUnchanged(fresh.path, () => updateDoc(regRef(actor, fresh.activityId, fresh.registrationId), { phone: "3330001111", updatedAt: nowIso() }), actor);
      await expectDeniedUnchanged(
        fresh.path,
        () => updateDoc(regRef(actor, fresh.activityId, fresh.registrationId), { registrationStatus: "cancelled", updatedAt: nowIso() }),
        `${actor} annulla`,
      );
    }
  });
});

// ===========================================================================
// 5. Update admin: annulla
// ===========================================================================

describe("5. admin annulla (adminSetRegistrationStatus)", () => {
  const CASES = [
    ["iscrizione a mano, adulto attivo", () => [manualDoc({ person: personDraft() }), manualId()]],
    ["iscrizione a mano, minorenne in attesa", () => [manualDoc({ person: minorDraft(), parent: parentDraft() }), manualId()]],
    ["figlio in attesa della firma", () => [F.childRegistration(uid("genitore"), childIdOf("genitore"), "pending"), childIdOf("genitore")]],
    ["figlio confermato con la firma", () => [F.childRegistration(uid("genitore"), childIdOf("genitore"), "signed"), childIdOf("genitore")]],
    ["figlio pesante (stanza, pattuglia, comitati)", () => [F.childRegistration(uid("genitore"), childIdOf("genitore"), "heavy"), childIdOf("genitore")]],
    ["figlio massimo (ogni campo valorizzato)", () => [F.childRegistration(uid("genitore"), childIdOf("genitore"), "maximal"), childIdOf("genitore")]],
    ["account adulto massimo", () => [F.accountRegistration(uid("utente"), "maximal"), accountIdOf("utente")]],
    ["figlio rifiutato dal genitore", () => {
      const data = F.childRegistration(uid("genitore"), childIdOf("genitore"), "pending");
      return [{ ...data, registrationStatus: "rejected_by_parent", parentAuthorization: { ...data.parentAuthorization, status: "rejected_by_parent" } }, childIdOf("genitore")];
    }],
  ];
  for (const [label, build] of CASES) {
    test(`${label}: annullata, cambiano solo stato e updatedAt`, async () => {
      const [data, id] = build();
      const ctx = await F.seedRegistration(data, id);
      await clientOps.setStatus("admin", ctx.activityId, id, "cancelled");
      const after = await stored(ctx.path);
      assert.equal(after.registrationStatus, "cancelled");
      assertOnlyChanged(ctx.current, after, ["registrationStatus", "updatedAt"]);
    });
  }

  test("un'iscrizione già annullata si annulla di nuovo (innocuo)", async () => {
    const ctx = await F.seedRegistration({ ...manualDoc({ person: personDraft() }), registrationStatus: "cancelled" }, manualId());
    await clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, "cancelled");
    assert.equal((await stored(ctx.path)).registrationStatus, "cancelled");
  });

  test("chi non è admin del palo non annulla l'iscrizione di un altro", async () => {
    for (const [actor, build] of [
      ["dirigente", () => [manualDoc({ person: personDraft() }), manualId()]],
      ["adminAltroPalo", () => [F.childRegistration(uid("genitore"), childIdOf("genitore"), "pending"), childIdOf("genitore")]],
      ["utente", () => [F.childRegistration(uid("genitore"), childIdOf("genitore"), "pending"), childIdOf("genitore")]],
      ["nonAutenticato", () => [F.accountRegistration(uid("utente"), "light"), accountIdOf("utente")]],
    ]) {
      const [data, id] = build();
      const ctx = await F.seedRegistration(data, id);
      await expectDeniedUnchanged(ctx.path, () => clientOps.setStatus(actor, ctx.activityId, id, "cancelled"), actor);
    }
  });
});

// ===========================================================================
// 6. Update admin: riattiva e transizioni di stato
// ===========================================================================

describe("6. admin cambia stato (Riattiva e transizioni)", () => {
  const cancelledChild = (flavor, { requires = true, authorizationStatus } = {}) => {
    const data = F.childRegistration(uid("genitore"), childIdOf("genitore"), flavor, { cancelled: true });
    return authorizationStatus
      ? { ...data, parentAuthorization: { ...data.parentAuthorization, status: authorizationStatus } }
      : data;
  };
  /** Il piano di "Riattiva" come lo calcola il client. */
  const planFor = (current, requires = true) => planAdminReactivate(current, requires);

  test("adulto annullato: planAdminReactivate dice active e le rules lo concedono", async () => {
    const ctx = await F.seedRegistration({ ...manualDoc({ person: personDraft() }), registrationStatus: "cancelled" }, manualId());
    const plan = planFor(ctx.current);
    assert.equal(plan.status, "active");
    await clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, plan.status);
    assert.equal((await stored(ctx.path)).registrationStatus, "active");
  });

  test("minorenne senza firma in un'attività con autorizzazione: il piano dice in attesa; active è negato", async () => {
    const ctx = await F.seedRegistration(cancelledChild("pending"), childIdOf("genitore"));
    const plan = planFor(ctx.current);
    assert.equal(plan.status, "pending_parent_authorization");
    await expectDeniedUnchanged(ctx.path, () => clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, "active"), "active senza firma");
    await clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, plan.status);
    assert.equal((await stored(ctx.path)).registrationStatus, "pending_parent_authorization");
  });

  test("minorenne annullato di una 'a mano', senza la richiesta del genitore: active negato, in attesa consentito", async () => {
    const ctx = await F.seedRegistration({ ...manualDoc({ person: minorDraft(), parent: parentDraft({ email: "" }) }), registrationStatus: "cancelled" }, manualId());
    assert.equal(planFor(ctx.current).status, "pending_parent_authorization");
    await expectDeniedUnchanged(ctx.path, () => clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, "active"), "active");
    await clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, "pending_parent_authorization");
  });

  test("minorenne con la firma (parentAuthorization.status authorized): active consentito", async () => {
    const ctx = await F.seedRegistration(cancelledChild("signed"), childIdOf("genitore"));
    const plan = planFor(ctx.current);
    assert.equal(plan.status, "active");
    await clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, plan.status);
    assert.equal((await stored(ctx.path)).registrationStatus, "active");
  });

  test("minorenne con la firma: anche in attesa è consentito", async () => {
    const ctx = await F.seedRegistration(cancelledChild("heavy"), childIdOf("genitore"));
    await clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, "pending_parent_authorization");
  });

  test("minorenne in un'attività senza autorizzazione: active consentito", async () => {
    const ctx = await F.seedRegistration(cancelledChild("pending"), childIdOf("genitore"), { requires: false });
    const plan = planFor(ctx.current, false);
    assert.equal(plan.status, "active");
    await clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, plan.status);
  });

  test("il genitore aveva rifiutato: il piano riapre il rifiuto (in attesa); active è negato", async () => {
    const ctx = await F.seedRegistration(cancelledChild("pending", { authorizationStatus: "rejected_by_parent" }), childIdOf("genitore"));
    const plan = planFor(ctx.current);
    assert.equal(plan.status, "pending_parent_authorization");
    assert.equal(plan.reopensRejection, true);
    await expectDeniedUnchanged(ctx.path, () => clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, "active"), "active dopo il rifiuto");
    await clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, plan.status);
  });

  test("autorizzazione non firmata (scaduta, revocata, errore mail, richiesta): active negato", async () => {
    for (const authorizationStatus of ["expired", "revoked", "email_error", "pending_request", "email_sent"]) {
      const ctx = await F.seedRegistration(cancelledChild("pending", { authorizationStatus }), childIdOf("genitore"));
      await expectDeniedUnchanged(ctx.path, () => clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, "active"), authorizationStatus);
    }
  });

  test("verso confirmed: mai (da annullata, in attesa, attiva, con o senza firma)", async () => {
    for (const data of [
      cancelledChild("pending"),
      cancelledChild("signed"),
      F.childRegistration(uid("genitore"), childIdOf("genitore"), "pending"),
      { ...F.accountRegistration(uid("utente"), "light"), registrationStatus: "active" },
      { ...manualDoc({ person: personDraft() }), registrationStatus: "active" },
    ]) {
      const id = data.userId ? accountIdOf("utente") : data.parentUid ? childIdOf("genitore") : manualId();
      const ctx = await F.seedRegistration(data, id);
      await expectDeniedUnchanged(ctx.path, () => clientOps.setStatus("admin", ctx.activityId, id, "confirmed"), `confirmed da ${data.registrationStatus}`);
    }
  });

  test("verso rejected_by_parent, draft, submitted, waitlist, stati fuori elenco: mai", async () => {
    for (const status of ["rejected_by_parent", "draft", "submitted", "waitlist", "pending", "", null]) {
      const ctx = await F.seedRegistration({ ...manualDoc({ person: personDraft() }), registrationStatus: "cancelled" }, manualId());
      await expectDeniedUnchanged(ctx.path, () => clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, status), `stato ${status}`);
      const pending = await F.seedRegistration(F.childRegistration(uid("genitore"), childIdOf("genitore"), "pending"), childIdOf("genitore"));
      await expectDeniedUnchanged(pending.path, () => clientOps.setStatus("admin", pending.activityId, pending.registrationId, status), `stato ${status} da pending`);
    }
  });

  test("in attesa non si torna da una decisione del genitore (rejected_by_parent, confirmed); da attiva, annullata e altri stati sì (8a294f2)", async () => {
    for (const [from, allowed] of [
      ["rejected_by_parent", false],
      ["confirmed", false],
      ["active", true],
      ["cancelled", true],
      ["submitted", true],
      ["waitlist", true],
      ["draft", true],
    ]) {
      const ctx = await F.seedRegistration({ ...manualDoc({ person: minorDraft(), parent: parentDraft() }), registrationStatus: from }, manualId());
      if (allowed) {
        await clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, "pending_parent_authorization");
        assert.equal((await stored(ctx.path)).registrationStatus, "pending_parent_authorization", from);
      } else {
        await expectDeniedUnchanged(ctx.path, () => clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, "pending_parent_authorization"), `${from} → in attesa`);
      }
    }
  });

  test("una decisione del genitore si riapre annullando e riattivando: rifiutata → annullata → in attesa", async () => {
    const base = F.childRegistration(uid("genitore"), childIdOf("genitore"), "pending");
    const ctx = await F.seedRegistration(
      { ...base, registrationStatus: "rejected_by_parent", parentAuthorization: { ...base.parentAuthorization, status: "rejected_by_parent" } },
      childIdOf("genitore"),
    );
    await expectDeniedUnchanged(ctx.path, () => clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, "pending_parent_authorization"), "diretta");
    await clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, "cancelled");
    const plan = planAdminReactivate(await stored(ctx.path), true);
    assert.equal(plan.status, "pending_parent_authorization");
    assert.equal(plan.reopensRejection, true);
    await clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, plan.status);
  });

  test("da in attesa ad active: adulto sì, minorenne senza firma no, minorenne con la firma sì", async () => {
    const adult = await F.seedRegistration({ ...manualDoc({ person: personDraft() }), registrationStatus: "pending_parent_authorization" }, manualId());
    await clientOps.setStatus("admin", adult.activityId, adult.registrationId, "active");

    const minor = await F.seedRegistration(F.childRegistration(uid("genitore"), childIdOf("genitore"), "pending"), childIdOf("genitore"));
    await expectDeniedUnchanged(minor.path, () => clientOps.setStatus("admin", minor.activityId, minor.registrationId, "active"), "minorenne senza firma");

    const signed = await F.seedRegistration(
      { ...F.childRegistration(uid("genitore"), childIdOf("genitore"), "signed"), registrationStatus: "pending_parent_authorization" },
      childIdOf("genitore"),
    );
    await clientOps.setStatus("admin", signed.activityId, signed.registrationId, "active");
  });

  test("da attiva a in attesa e ritorno a annullata", async () => {
    const ctx = await F.seedRegistration({ ...manualDoc({ person: minorDraft(), parent: parentDraft() }), registrationStatus: "active" }, manualId());
    await clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, "pending_parent_authorization");
    await clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, "cancelled");
    assert.equal((await stored(ctx.path)).registrationStatus, "cancelled");
  });

  test("bordi dei 18 anni per active senza firma: oggi e domani sì, fra 3 giorni no", async () => {
    for (const [offset, allowed] of [[0, true], [1, true], [3, false]]) {
      const birthDate = birthDateTurning18In(offset);
      const ctx = await F.seedRegistration(
        { ...manualDoc({ person: personDraft({ birthDate }), requires: false }), registrationStatus: "cancelled", parentAuthorization: null },
        manualId(),
      );
      if (allowed) {
        await clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, "active");
      } else {
        await expectDeniedUnchanged(ctx.path, () => clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, "active"), `18 anni fra ${offset} giorni`);
      }
    }
  });

  test("chi non è admin non riattiva l'iscrizione di un altro", async () => {
    for (const actor of ["dirigente", "adminAltroPalo", "utente", "genitore", "nonAutenticato"]) {
      const ctx = await F.seedRegistration({ ...manualDoc({ person: personDraft() }), registrationStatus: "cancelled" }, manualId());
      await expectDeniedUnchanged(ctx.path, () => clientOps.setStatus(actor, ctx.activityId, ctx.registrationId, "active"), actor);
    }
  });
});

// ===========================================================================
// 7. Update admin: correzione dei dati (Modifica dati)
// ===========================================================================

describe("7. admin corregge i dati (buildAdminEditPatch)", () => {
  test("nome, cognome, unità, categoria, email e telefono di una a mano: le copie nelle risposte si allineano", async () => {
    const ctx = await F.seedRegistration(manualDoc({ person: personDraft(), requires: true }), manualId());
    const { patch } = editPatch(ctx.current, ctx.registrationId, {
      firstName: "Luca Maria",
      lastName: "Bianchi Verdi",
      unitId: UNIT_2.id,
      unitName: UNIT_2.name,
      genderRoleCategory: "dirigente",
      email: "luca@example.invalid",
      phone: "3471234567",
    });
    await withPatch(ctx.activityId, ctx.registrationId, patch);
    const after = await stored(ctx.path);
    assert.equal(after.firstName, "Luca Maria");
    assert.equal(after.fullName, "Luca Maria Bianchi Verdi");
    assert.equal(after.unitId, UNIT_2.id);
    assert.equal(after.unitNameSnapshot, UNIT_2.name);
    assert.equal(after.answers.unitName, UNIT_2.name);
    assert.equal(after.genderRoleCategory, "dirigente");
    assert.equal(after.answers.genderRoleCategory, "dirigente");
    assert.equal(after.answers.youthGroup, "Dirigente");
    assert.equal(after.email, "luca@example.invalid");
    assert.equal(after.phone, "3471234567");
    assertOnlyChanged(ctx.current, after, Object.keys(patch));
  });

  test("data di nascita: adulto diventa minorenne, attività con autorizzazione, con l'email del genitore", async () => {
    const ctx = await F.seedRegistration(manualDoc({ person: personDraft(), requires: true }), manualId());
    const { patch, plan } = editPatch(ctx.current, ctx.registrationId, { birthDate: MINOR }, { parent: parentDraft() });
    assert.equal(plan.nextStatus, "pending_parent_authorization");
    assert.ok(plan.sendsMail);
    await withPatch(ctx.activityId, ctx.registrationId, patch);
    const after = await stored(ctx.path);
    assert.equal(after.registrationStatus, "pending_parent_authorization");
    assert.equal(after.birthDate, MINOR);
    assert.equal(after.answers.parentAuthorizationRequest.parentEmail, "genitore@example.invalid");
    assert.equal(after.answers.parentAuthorizationRequest.parentFirstName, "Paola");
  });

  test("adulto diventa minorenne senza l'email del genitore: in attesa, senza la richiesta", async () => {
    const ctx = await F.seedRegistration(manualDoc({ person: personDraft(), requires: true }), manualId());
    const { patch, plan } = editPatch(ctx.current, ctx.registrationId, { birthDate: MINOR });
    assert.equal(plan.nextStatus, "pending_parent_authorization");
    assert.equal(plan.needsParentFields, true);
    await withPatch(ctx.activityId, ctx.registrationId, patch);
    const after = await stored(ctx.path);
    assert.equal(after.registrationStatus, "pending_parent_authorization");
    assert.ok(!after.answers.parentAuthorizationRequest);
  });

  test("minorenne in attesa diventa adulto: torna attiva", async () => {
    const ctx = await F.seedRegistration(manualDoc({ person: minorDraft(), parent: parentDraft(), requires: true }), manualId());
    const { patch, plan } = editPatch(ctx.current, ctx.registrationId, { birthDate: ADULT });
    assert.equal(plan.nextStatus, "active");
    await withPatch(ctx.activityId, ctx.registrationId, patch);
    const after = await stored(ctx.path);
    assert.equal(after.registrationStatus, "active");
    assert.equal(after.birthDate, ADULT);
  });

  test("adulto diventa minorenne in un'attività senza autorizzazione: stato invariato", async () => {
    const ctx = await F.seedRegistration(manualDoc({ person: personDraft(), requires: false }), manualId(), { requires: false });
    const { patch, plan } = editPatch(ctx.current, ctx.registrationId, { birthDate: MINOR }, { requires: false });
    assert.equal(plan.nextStatus, "active");
    assert.ok(!("registrationStatus" in patch));
    await withPatch(ctx.activityId, ctx.registrationId, patch);
  });

  test("iscrizione confermata (firmata): si correggono i dati, lo stato resta confirmed", async () => {
    const ctx = await F.seedRegistration(F.childRegistration(uid("genitore"), childIdOf("genitore"), "signed"), childIdOf("genitore"));
    const { patch } = editPatch(ctx.current, ctx.registrationId, { firstName: "Francesca", unitId: UNIT_2.id, unitName: UNIT_2.name, birthDate: ADULT });
    assert.ok(!("registrationStatus" in patch));
    await withPatch(ctx.activityId, ctx.registrationId, patch);
    const after = await stored(ctx.path);
    assert.equal(after.registrationStatus, "confirmed");
    assert.equal(after.firstName, "Francesca");
    assert.deepEqual(after.parentAuthorization, ctx.current.parentAuthorization);
    assert.equal(after.consentSignaturePath, ctx.current.consentSignaturePath);
  });

  test("iscrizione rifiutata dal genitore: si correggono i dati, il rifiuto resta", async () => {
    const base = F.childRegistration(uid("genitore"), childIdOf("genitore"), "pending");
    const ctx = await F.seedRegistration(
      { ...base, registrationStatus: "rejected_by_parent", parentAuthorization: { ...base.parentAuthorization, status: "rejected_by_parent" } },
      childIdOf("genitore"),
    );
    const { patch } = editPatch(ctx.current, ctx.registrationId, { lastName: "Neri" });
    await withPatch(ctx.activityId, ctx.registrationId, patch);
    const after = await stored(ctx.path);
    assert.equal(after.registrationStatus, "rejected_by_parent");
    assert.equal(after.lastName, "Neri");
  });

  test("iscrizione annullata: cambiano solo i dati, resta annullata", async () => {
    const ctx = await F.seedRegistration({ ...manualDoc({ person: personDraft() }), registrationStatus: "cancelled" }, manualId());
    const { patch } = editPatch(ctx.current, ctx.registrationId, { phone: "3339998888", firstName: "Piero" });
    assert.ok(!("registrationStatus" in patch));
    await withPatch(ctx.activityId, ctx.registrationId, patch);
    assert.equal((await stored(ctx.path)).registrationStatus, "cancelled");
  });

  for (const flavor of ["heavy", "maximal"]) {
    test(`iscrizione figlio ${flavor}: correzione completa dei dati`, async () => {
      const ctx = await F.seedRegistration(F.childRegistration(uid("genitore"), childIdOf("genitore"), flavor), childIdOf("genitore"));
      const { patch } = editPatch(ctx.current, ctx.registrationId, {
        firstName: "Chiara",
        lastName: "Gialli",
        unitId: UNIT_2.id,
        unitName: UNIT_2.name,
        genderRoleCategory: "giovane_uomo",
        email: "chiara@example.invalid",
        phone: "3471112222",
      });
      await withPatch(ctx.activityId, ctx.registrationId, patch);
      const after = await stored(ctx.path);
      assert.equal(after.fullName, "Chiara Gialli");
      assert.equal(after.assignedRoomName, "Stanza 12");
      assert.deepEqual(after.parentAuthorization, ctx.current.parentAuthorization);
      assert.equal(after.answers.campo_01, ctx.current.answers.campo_01);
    });
  }

  test("account (user_) adulto: correzione dei dati della persona", async () => {
    const ctx = await F.seedRegistration(F.accountRegistration(uid("utente"), "maximal"), accountIdOf("utente"));
    const { patch } = editPatch(ctx.current, ctx.registrationId, { firstName: "Gianni", phone: "3200000000" });
    await withPatch(ctx.activityId, ctx.registrationId, patch);
    assert.equal((await stored(ctx.path)).firstName, "Gianni");
  });

  test("richiesta di autorizzazione (buildRequestAuthorizationPatch): dati del genitore e stato in attesa", async () => {
    const ctx = await F.seedRegistration(manualDoc({ person: minorDraft(), parent: parentDraft({ email: "" }), requires: true }), manualId());
    const patch = buildRequestAuthorizationPatch(ctx.current, parentDraft({ email: "Nuovo.Genitore@Example.invalid" }), nowIso());
    assert.ok(!("registrationStatus" in patch), "già in attesa: lo stato non si riscrive");
    await withPatch(ctx.activityId, ctx.registrationId, patch);
    const after = await stored(ctx.path);
    assert.equal(after.answers.parentAuthorizationRequest.parentEmail, "nuovo.genitore@example.invalid");
    assert.equal(after.registrationStatus, "pending_parent_authorization");
  });

  test("richiesta di autorizzazione su un'iscrizione attiva (adulto diventato minorenne): porta in attesa", async () => {
    const ctx = await F.seedRegistration({ ...manualDoc({ person: minorDraft(), requires: false }), registrationStatus: "active" }, manualId(), { requires: true });
    const patch = buildRequestAuthorizationPatch(ctx.current, parentDraft(), nowIso());
    assert.equal(patch.registrationStatus, "pending_parent_authorization");
    await withPatch(ctx.activityId, ctx.registrationId, patch);
    assert.equal((await stored(ctx.path)).registrationStatus, "pending_parent_authorization");
  });

  test("data corretta in minorenne lasciando attiva l'iscrizione: negata; con lo stato in attesa, la firma o un'attività senza autorizzazione passa", async () => {
    const datePatch = { birthDate: MINOR, "answers.birthDate": MINOR };
    const adult = await F.seedRegistration(manualDoc({ person: personDraft(), requires: true }), manualId());
    await expectDeniedUnchanged(adult.path, () => withPatch(adult.activityId, adult.registrationId, { ...datePatch, updatedAt: nowIso() }), "attiva + minorenne senza firma");
    await withPatch(adult.activityId, adult.registrationId, { ...datePatch, registrationStatus: "pending_parent_authorization", updatedAt: nowIso() });

    const signed = await F.seedRegistration(
      { ...F.childRegistration(uid("genitore"), childIdOf("genitore"), "signed", { birthDate: ADULT }), registrationStatus: "active" },
      childIdOf("genitore"),
    );
    await withPatch(signed.activityId, signed.registrationId, { ...datePatch, updatedAt: nowIso() });

    const free = await F.seedRegistration(manualDoc({ person: personDraft(), requires: false }), manualId(), { requires: false });
    await withPatch(free.activityId, free.registrationId, { ...datePatch, updatedAt: nowIso() });

    // Minorenne → adulto con l'iscrizione attiva: nessun consenso da chiedere.
    const minor = await F.seedRegistration({ ...manualDoc({ person: minorDraft(), requires: false }), registrationStatus: "active" }, manualId());
    await withPatch(minor.activityId, minor.registrationId, { birthDate: ADULT, "answers.birthDate": ADULT, updatedAt: nowIso() });
  });

  test("minorenne attivo senza firma (iscritto prima che l'attività chiedesse l'autorizzazione): l'admin non ne corregge la data senza metterlo in attesa", async () => {
    // È il caso che planAdminEdit risolve scrivendo lo stato in attesa.
    const ctx = await F.seedRegistration({ ...manualDoc({ person: minorDraft(), requires: false }), registrationStatus: "active" }, manualId());
    const other = `${thisYearMinus(15)}-03-02`;
    await expectDeniedUnchanged(ctx.path, () => withPatch(ctx.activityId, ctx.registrationId, { birthDate: other, "answers.birthDate": other, updatedAt: nowIso() }), "data corretta, ancora attivo");
    const { patch, plan } = editPatch(ctx.current, ctx.registrationId, { birthDate: other }, { parent: parentDraft() });
    assert.equal(plan.nextStatus, "pending_parent_authorization");
    await withPatch(ctx.activityId, ctx.registrationId, patch);
  });

  test("tipi: categoria non valida, nome non stringa, email non stringa sono negati", async () => {
    const ctx = await F.seedRegistration(manualDoc({ person: personDraft() }), manualId());
    for (const patch of [
      { genderRoleCategory: "altro" },
      { firstName: 5 },
      { lastName: null },
      { fullName: 5 },
      { email: null },
      { phone: 3471234567 },
      { birthDate: 20120509 },
      { unitId: 7 },
      { unitNameSnapshot: null },
    ]) {
      await expectDeniedUnchanged(ctx.path, () => withPatch(ctx.activityId, ctx.registrationId, { ...patch, updatedAt: nowIso() }), JSON.stringify(patch));
    }
  });

  test("osservazione: l'update non ricontrolla unità e nome come la creazione", async (t) => {
    const outcomes = [];
    for (const [label, patch] of [
      ["unitId inesistente", { unitId: "unita-fantasma" }],
      ["unitId di un altro palo", { unitId: "unita-altro-palo" }],
      ["firstName vuoto", { firstName: "" }],
    ]) {
      const ctx = await F.seedRegistration(manualDoc({ person: personDraft() }), manualId());
      try {
        await withPatch(ctx.activityId, ctx.registrationId, { ...patch, updatedAt: nowIso() });
        outcomes.push(`${label}: consentito`);
      } catch (error) {
        outcomes.push(`${label}: negato (${error?.code})`);
      }
    }
    t.diagnostic(outcomes.join("; "));
  });

  test("data di nascita nell'update: vuota o YYYY-MM-DD passa, ogni altra forma è negata (6c44deb)", async () => {
    const ctx = await F.seedRegistration(manualDoc({ person: personDraft() }), manualId());
    for (const birthDate of ["9 maggio 2012", "2012-5-9", "2012/05/09", "09-05-2012", "2012-05-09T00:00:00Z", " 2012-05-09", "2012-05-09 ", "20120509", "abc"]) {
      await expectDeniedUnchanged(
        ctx.path,
        () => withPatch(ctx.activityId, ctx.registrationId, { birthDate, "answers.birthDate": birthDate, updatedAt: nowIso() }),
        `birthDate ${JSON.stringify(birthDate)}`,
      );
    }
    // Vuota (come le a mano di ottobre senza data) e nella forma giusta passano.
    await withPatch(ctx.activityId, ctx.registrationId, { birthDate: "", "answers.birthDate": "", updatedAt: nowIso() });
    await withPatch(ctx.activityId, ctx.registrationId, { birthDate: ADULT, "answers.birthDate": ADULT, updatedAt: nowIso() });
    assert.equal((await stored(ctx.path)).birthDate, ADULT);
  });

  test("la forma della data si controlla solo quando cambiano i dati della persona", async () => {
    // Annullare, cambiare l'email del genitore o gli abbinamenti stanza non toccano i dati
    // della persona: un documento vecchio con una data in un'altra forma si annulla lo stesso.
    const ctx = await F.seedRegistration({ ...manualDoc({ person: personDraft() }), birthDate: "9/5/2012" }, manualId());
    await clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, "cancelled");
    await clientOps.normalizeRoomMatches("admin", [{ activityId: ctx.activityId, registrationId: ctx.registrationId }]);
    assert.equal((await stored(ctx.path)).birthDate, "9/5/2012");
  });

  test("osservazione: un documento con una data in un'altra forma e una correzione di sola email o telefono", async (t) => {
    const ctx = await F.seedRegistration({ ...manualDoc({ person: personDraft() }), birthDate: "9/5/2012" }, manualId());
    let outcome;
    try {
      await withPatch(ctx.activityId, ctx.registrationId, { phone: "3471112222", updatedAt: nowIso() });
      outcome = "consentita";
    } catch (error) {
      outcome = `negata (${error?.code})`;
    }
    t.diagnostic(`correzione del solo telefono su un documento con birthDate "9/5/2012" (il client scrive sempre anche la data): ${outcome}`);
  });

  test("chi non è admin del palo non corregge i dati di un altro", async () => {
    for (const actor of ["dirigente", "adminAltroPalo", "utente", "genitore", "nonAutenticato"]) {
      const ctx = await F.seedRegistration(manualDoc({ person: personDraft() }), manualId());
      const { patch } = editPatch(ctx.current, ctx.registrationId, { firstName: "Altro" });
      await expectDeniedUnchanged(ctx.path, () => clientOps.update(actor, ctx.activityId, ctx.registrationId, patch), actor);
    }
  });
});

// ===========================================================================
// 8. Update admin: campi che l'admin non scrive
// ===========================================================================

describe("8. update admin: campi vietati", () => {
  // [etichetta, patch]: un solo campo alla volta, più updatedAt.
  const FORBIDDEN = [
    ["parentAuthorization.photoConsent", { "parentAuthorization.photoConsent": "refused" }],
    ["parentAuthorization.socialPublicationConsent", { "parentAuthorization.socialPublicationConsent": "accepted" }],
    ["parentAuthorization.status", { "parentAuthorization.status": "authorized" }],
    ["parentAuthorization.tokenId", { "parentAuthorization.tokenId": "token-forzato" }],
    ["parentAuthorization.signaturePath", { "parentAuthorization.signaturePath": "forged.png" }],
    ["parentAuthorization.authorizedAt", { "parentAuthorization.authorizedAt": SIGNED_AT }],
    ["parentAuthorization intera a null", { parentAuthorization: null }],
    ["parentAuthorization intera sostituita", { parentAuthorization: { status: "authorized", parentEmail: "x@example.invalid" } }],
    ["parentConsentDocumentUrl", { parentConsentDocumentUrl: "https://forged.example.invalid/x.pdf" }],
    ["parentConsentDocumentName", { parentConsentDocumentName: "x.pdf" }],
    ["parentConsentDocumentPath", { parentConsentDocumentPath: "forged/x.pdf" }],
    ["parentConsentUploadedAt", { parentConsentUploadedAt: SIGNED_AT }],
    ["consentSignaturePath", { consentSignaturePath: "forged.png" }],
    ["consentSignatureUrl", { consentSignatureUrl: "https://forged.example.invalid/f.png" }],
    ["parentIdDocumentUrl", { parentIdDocumentUrl: "https://forged.example.invalid/id.pdf" }],
    ["assignedRoomId", { assignedRoomId: "stanza-99" }],
    ["assignedRoomName", { assignedRoomName: "Stanza 99" }],
    ["assignedPatrolId", { assignedPatrolId: "pattuglia-x" }],
    ["assignedPatrolName", { assignedPatrolName: "X" }],
    ["assignedPatrolRole", { assignedPatrolRole: "leader" }],
    ["assignedCommittees", { assignedCommittees: [{ committeeId: "x", role: "leader" }] }],
    ["assignedTempleShiftId", { assignedTempleShiftId: "turno-9" }],
    ["assignedServiceTeamIds", { assignedServiceTeamIds: ["squadra-x"] }],
    ["userId", { userId: "utente-forzato" }],
    ["anonymousUid", { anonymousUid: "anonimo-forzato" }],
    ["parentUid", { parentUid: "genitore-forzato" }],
    ["childId", { childId: "figlio-forzato" }],
    ["createdBy", { createdBy: "admin-forzato" }],
    ["createdAt", { createdAt: "2020-01-01T00:00:00.000Z" }],
    ["accessCode", { accessCode: "ACC-FORZATO" }],
    ["recoveryCode", { recoveryCode: "REC-FORZATO" }],
    ["anonymousTokenId", { anonymousTokenId: "token-forzato" }],
    ["recoveryPdfGenerated", { recoveryPdfGenerated: true }],
    ["submittedByMode", { submittedByMode: "authenticated" }],
    ["linkedLaterToUserId", { linkedLaterToUserId: "utente-forzato" }],
    ["participatingDays", { participatingDays: ["2026-10-16"] }],
    ["registrationStatus confirmed", { registrationStatus: "confirmed" }],
    ["registrationStatus rejected_by_parent", { registrationStatus: "rejected_by_parent" }],
    ["answers.allergies", { "answers.allergies": "nessuna" }],
    ["answers.transportMode", { "answers.transportMode": "auto" }],
    ["answers.photoInternalConsent", { "answers.photoInternalConsent": false }],
    ["answers.parentConfirmed", { "answers.parentConfirmed": true }],
    ["answers.parentAuthorizationAcceptedAt", { "answers.parentAuthorizationAcceptedAt": SIGNED_AT }],
    ["answers intero riscritto con un campo nuovo", null],
  ];

  const BUILDERS = [
    ["iscrizione a mano in attesa", () => [manualDoc({ person: minorDraft(), parent: parentDraft() }), manualId()]],
    ["figlio pesante firmato", () => [F.childRegistration(uid("genitore"), childIdOf("genitore"), "heavy"), childIdOf("genitore")]],
  ];

  for (const [builderLabel, build] of BUILDERS) {
    test(`${builderLabel}: ognuno dei campi vietati è negato e il documento resta com'era`, async () => {
      const [data, id] = build();
      const ctx = await F.seedRegistration(data, id);
      for (const [label, patch] of FORBIDDEN) {
        const effective = patch ?? { answers: { ...ctx.current.answers, campoNuovo: "x" } };
        // Scrivere il valore che c'è già non è una modifica (ad esempio parentAuthorization: null su una a mano).
        const valueAt = (path) => path.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), ctx.current);
        const unchanged = Object.entries(effective).every(([key, value]) => JSON.stringify(valueAt(key)) === JSON.stringify(value));
        if (unchanged) continue;
        await expectDeniedUnchanged(ctx.path, () => withPatch(ctx.activityId, id, { ...effective, updatedAt: nowIso() }), label);
      }
    });
  }

  test("un campo vietato insieme a una correzione lecita nega tutta la scrittura", async () => {
    const [data, id] = BUILDERS[1][1]();
    const ctx = await F.seedRegistration(data, id);
    const { patch } = editPatch(ctx.current, id, { firstName: "Paolo" });
    await expectDeniedUnchanged(ctx.path, () => withPatch(ctx.activityId, id, { ...patch, assignedRoomId: "stanza-99" }), "correzione + assignedRoomId");
    await expectDeniedUnchanged(ctx.path, () => withPatch(ctx.activityId, id, { ...patch, "parentAuthorization.photoConsent": "refused" }), "correzione + consenso foto");
    await withPatch(ctx.activityId, id, patch);
  });

  test("le chiavi lecite di answers e della richiesta del genitore passano", async () => {
    const ctx = await F.seedRegistration(manualDoc({ person: minorDraft(), parent: parentDraft() }), manualId());
    await withPatch(ctx.activityId, ctx.registrationId, {
      "answers.parentAuthorizationRequest.parentEmail": "altro@example.invalid",
      "answers.parentAuthorizationRequest.parentFirstName": "Anna",
      "answers.parentAuthorizationRequest.parentLastName": "Verdi",
      "answers.parentAuthorizationRequest.parentPhone": "3470000000",
      "answers.birthDate": MINOR,
      "answers.genderRoleCategory": "giovane_uomo",
      "answers.youthGroup": "Giovani Uomini",
      "answers.unitName": UNIT_1.name,
      updatedAt: nowIso(),
    });
    const after = await stored(ctx.path);
    assert.equal(after.answers.parentAuthorizationRequest.parentEmail, "altro@example.invalid");
  });

  test("scrivere lo stesso valore di un campo vietato non è una modifica: passa", async () => {
    const [data, id] = BUILDERS[1][1]();
    const ctx = await F.seedRegistration(data, id);
    await withPatch(ctx.activityId, id, { assignedRoomId: ctx.current.assignedRoomId, "parentAuthorization.photoConsent": ctx.current.parentAuthorization.photoConsent, updatedAt: nowIso() });
  });
});

// ===========================================================================
// 8b. Spunte foto date da adulto: l'admin le toglie, non le scrive (8a294f2)
// ===========================================================================

describe("8b. spunte foto nelle risposte", () => {
  const PHOTO_KEYS = ["photoInternalConsent", "photoPublicConsent", "photoReleaseAccepted"];
  /** Iscrizione a mano di un adulto con le spunte date da adulto nelle risposte. */
  async function seedWithPhotos(keys = PHOTO_KEYS, { requires = true } = {}) {
    const data = manualDoc({ person: personDraft(), requires });
    data.answers = { ...data.answers, ...Object.fromEntries(keys.map((key) => [key, true])) };
    return F.seedRegistration(data, manualId(), { requires });
  }

  test("toglierle tutte (deleteField) passa; il resto delle risposte resta", async () => {
    const ctx = await seedWithPhotos();
    await withPatch(ctx.activityId, ctx.registrationId, {
      ...Object.fromEntries(PHOTO_KEYS.map((key) => [`answers.${key}`, deleteField()])),
      updatedAt: nowIso(),
    });
    const after = await stored(ctx.path);
    for (const key of PHOTO_KEYS) assert.ok(!(key in after.answers), key);
    assert.equal(after.answers.birthDate, ctx.current.answers.birthDate);
  });

  test("scriverle a true o a false è negato, ognuna; anche se c'erano già", async () => {
    const ctx = await seedWithPhotos(["photoInternalConsent"]);
    for (const key of PHOTO_KEYS) {
      for (const value of [true, false]) {
        // Riscrivere il valore che c'è già non è una modifica.
        if (JSON.stringify(ctx.current.answers[key]) === JSON.stringify(value)) continue;
        await expectDeniedUnchanged(ctx.path, () => withPatch(ctx.activityId, ctx.registrationId, { [`answers.${key}`]: value, updatedAt: nowIso() }), `${key}=${value}`);
      }
    }
    const empty = await F.seedRegistration(manualDoc({ person: personDraft() }), manualId());
    for (const key of PHOTO_KEYS) {
      await expectDeniedUnchanged(empty.path, () => withPatch(empty.activityId, empty.registrationId, { [`answers.${key}`]: true, updatedAt: nowIso() }), `${key} nuova`);
    }
  });

  test("toglierne una sola quando ce n'è più d'una resta negato: o si tolgono tutte o nessuna", async () => {
    const ctx = await seedWithPhotos(["photoInternalConsent", "photoPublicConsent"]);
    await expectDeniedUnchanged(
      ctx.path,
      () => withPatch(ctx.activityId, ctx.registrationId, { "answers.photoInternalConsent": deleteField(), updatedAt: nowIso() }),
      "una su due",
    );
    await withPatch(ctx.activityId, ctx.registrationId, {
      "answers.photoInternalConsent": deleteField(),
      "answers.photoPublicConsent": deleteField(),
      updatedAt: nowIso(),
    });
  });

  test("togliere una spunta che non c'è non cambia nulla: passa", async () => {
    const ctx = await F.seedRegistration(manualDoc({ person: personDraft() }), manualId());
    await withPatch(ctx.activityId, ctx.registrationId, { "answers.photoInternalConsent": deleteField(), updatedAt: nowIso() });
  });

  test("toglierle insieme a un'altra chiave non permessa è negato", async () => {
    const ctx = await seedWithPhotos();
    await expectDeniedUnchanged(
      ctx.path,
      () =>
        withPatch(ctx.activityId, ctx.registrationId, {
          ...Object.fromEntries(PHOTO_KEYS.map((key) => [`answers.${key}`, deleteField()])),
          "answers.allergies": "nessuna",
          updatedAt: nowIso(),
        }),
      "spunte tolte + allergies",
    );
  });

  test("planAdminEdit + buildAdminEditPatch con deleteField: adulto → minorenne toglie le spunte, in attesa; il payload passa", async () => {
    for (const requires of [true, false]) {
      const ctx = await seedWithPhotos(PHOTO_KEYS, { requires });
      const { patch, plan } = editPatch(ctx.current, ctx.registrationId, { birthDate: MINOR }, { parent: parentDraft(), requires });
      assert.deepEqual([...plan.clearAnswerKeys].sort(), [...PHOTO_KEYS].sort(), `requires ${requires}`);
      for (const key of PHOTO_KEYS) assert.ok(`answers.${key}` in patch, `answers.${key} nel patch`);
      await withPatch(ctx.activityId, ctx.registrationId, patch);
      const after = await stored(ctx.path);
      for (const key of PHOTO_KEYS) assert.ok(!(key in after.answers), `${key} tolta (requires ${requires})`);
      assert.equal(after.registrationStatus, requires ? "pending_parent_authorization" : "active");
      assert.equal(after.birthDate, MINOR);
    }
  });

  test("senza deleteField il payload di planAdminEdit non passa (undefined non si scrive)", async () => {
    const ctx = await seedWithPhotos();
    const registration = asRegistration(ctx.registrationId, ctx.current);
    const person = { ...personDraftFromRegistration(registration), birthDate: MINOR };
    const plan = planAdminEdit(registration, person, parentDraft(), { requiresParentAuthorization: true, previousUnitName: ctx.current.unitNameSnapshot });
    const patch = buildAdminEditPatch({ registration, person, parent: parentDraft(), plan, timestamp: nowIso() });
    assert.equal(patch["answers.photoInternalConsent"], undefined);
    await assert.rejects(async () => withPatch(ctx.activityId, ctx.registrationId, patch), /undefined/u);
  });

  test("correzione di un adulto che resta adulto, o di un minorenne: nessuna spunta tolta", async () => {
    const adult = await seedWithPhotos();
    const { plan } = editPatch(adult.current, adult.registrationId, { birthDate: `${new Date().getFullYear() - 41}-01-02` });
    assert.deepEqual(plan.clearAnswerKeys, []);
    const minorDoc = manualDoc({ person: minorDraft(), parent: parentDraft() });
    minorDoc.answers = { ...minorDoc.answers, photoInternalConsent: true };
    const minor = await F.seedRegistration(minorDoc, manualId());
    const { plan: minorPlan } = editPatch(minor.current, minor.registrationId, { birthDate: `${new Date().getFullYear() - 15}-01-02` });
    assert.deepEqual(minorPlan.clearAnswerKeys, []);
  });

  test("adminUpdateParentAuthorizationEmail su un'iscrizione con le spunte nelle risposte passa ancora (answers intero, spunte invariate)", async () => {
    const ctx = await F.seedRegistration(
      (() => {
        const base = F.childRegistration(uid("genitore"), childIdOf("genitore"), "pending");
        return { ...base, answers: { ...base.answers, photoInternalConsent: true, photoPublicConsent: true, photoReleaseAccepted: true } };
      })(),
      childIdOf("genitore"),
    );
    await clientOps.updateParentEmail("admin", ctx.activityId, ctx.registrationId, "nuovo@esempio.invalid");
    const after = await stored(ctx.path);
    assert.equal(after.parentAuthorization.parentEmail, "nuovo@esempio.invalid");
    assert.equal(after.answers.photoInternalConsent, true);
    // Anche il figlio massimo (heavyAnswers ha photoInternalConsent).
    const heavy = await F.seedRegistration(F.childRegistration(uid("genitore"), childIdOf("genitore"), "maximal"), childIdOf("genitore"));
    assert.equal(heavy.current.answers.photoInternalConsent, true);
    await clientOps.updateParentEmail("admin", heavy.activityId, heavy.registrationId, "altro@esempio.invalid");
  });

  test("il titolare scrive le sue spunte come prima (il vincolo è dell'admin)", async () => {
    const payload = F.accountRegistration(uid("utente"), "light");
    const ctx = await F.seedRegistration(payload, `user_${uid("utente")}`);
    await clientOps.update("utente", ctx.activityId, ctx.registrationId, { "answers.photoInternalConsent": true, updatedAt: nowIso() });
    assert.equal((await stored(ctx.path)).answers.photoInternalConsent, true);
  });
});

// ===========================================================================
// 9. Le altre chiamate del client admin
// ===========================================================================

describe("9. chiamate esatte dei servizi admin", () => {
  test("adminUpdateParentAuthorizationEmail: answers intero e percorsi di parentAuthorization", async () => {
    const ctx = await F.seedRegistration(F.childRegistration(uid("genitore"), childIdOf("genitore"), "pending"), childIdOf("genitore"));
    await clientOps.updateParentEmail("admin", ctx.activityId, ctx.registrationId, "  Nuovo@Esempio.invalid ");
    const after = await stored(ctx.path);
    assert.equal(after.answers.parentAuthorizationRequest.parentEmail, "nuovo@esempio.invalid");
    assert.equal(after.parentAuthorization.parentEmail, "nuovo@esempio.invalid");
    assert.equal(after.parentAuthorization.emailLastError, null);
    assert.equal(after.parentAuthorization.tokenId, ctx.current.parentAuthorization.tokenId);
    assertOnlyChanged(ctx.current, after, ["answers", "parentAuthorization", "updatedAt"]);
  });

  test("adminUpdateParentAuthorizationEmail su una a mano senza parentAuthorization: solo answers e updatedAt", async () => {
    const ctx = await F.seedRegistration(manualDoc({ person: minorDraft(), parent: parentDraft() }), manualId());
    assert.equal(ctx.current.parentAuthorization, null);
    await clientOps.updateParentEmail("admin", ctx.activityId, ctx.registrationId, "nuovo@esempio.invalid");
    const after = await stored(ctx.path);
    assert.equal(after.answers.parentAuthorizationRequest.parentEmail, "nuovo@esempio.invalid");
    assert.equal(after.parentAuthorization, null);
  });

  test("adminUpdateParentAuthorizationEmail su una a mano senza richiesta (4 'in attesa' senza email): answers invariato", async () => {
    const ctx = await F.seedRegistration(manualDoc({ person: minorDraft(), parent: parentDraft({ email: "" }) }), manualId());
    await clientOps.updateParentEmail("admin", ctx.activityId, ctx.registrationId, "nuovo@esempio.invalid");
  });

  test("adminUpdateParentAuthorizationEmail su un figlio pesante firmato e su uno massimo", async () => {
    for (const flavor of ["heavy", "maximal"]) {
      const ctx = await F.seedRegistration(F.childRegistration(uid("genitore"), childIdOf("genitore"), flavor), childIdOf("genitore"));
      await clientOps.updateParentEmail("admin", ctx.activityId, ctx.registrationId, "nuovo@esempio.invalid");
      assert.equal((await stored(ctx.path)).parentAuthorization.parentEmail, "nuovo@esempio.invalid");
    }
  });

  test("adminUpdateParentAuthorizationEmail: chi non è admin non cambia l'email del genitore", async () => {
    for (const actor of ["dirigente", "utente", "adminAltroPalo", "nonAutenticato"]) {
      const ctx = await F.seedRegistration(F.childRegistration(uid("genitore"), childIdOf("genitore"), "pending"), childIdOf("genitore"));
      await expectDeniedUnchanged(ctx.path, () => clientOps.updateParentEmail(actor, ctx.activityId, ctx.registrationId, "x@esempio.invalid"), actor);
    }
  });

  test("normalizeRoomPreferenceMatches: batch su a mano, figlio pesante, account e annullata", async () => {
    const activityId = await F.seedActivity({ requires: true });
    const targets = [];
    for (const [data, id] of [
      [manualDoc({ person: personDraft() }), manualId()],
      [manualDoc({ person: minorDraft(), parent: parentDraft() }), manualId()],
      [F.childRegistration(uid("genitore"), childIdOf("genitore"), "heavy"), childIdOf("genitore")],
      [F.accountRegistration(uid("utente"), "maximal"), accountIdOf("utente")],
      [{ ...F.accountRegistration(uid("dirigente"), "light"), registrationStatus: "cancelled" }, accountIdOf("dirigente")],
    ]) {
      await F.seedRegistration(data, id, { activityId });
      targets.push({ activityId, registrationId: id });
    }
    await clientOps.normalizeRoomMatches("admin", targets);
    for (const { registrationId } of targets) {
      const data = await stored(regPath(activityId, registrationId));
      assert.deepEqual(Object.keys(data.roomPreferenceMatches).sort(), ["roomPreference1Name", "roomPreference2Name"]);
    }
  });

  test("normalizeRoomPreferenceMatches: un'iscrizione sola non lecita fa fallire tutto il batch (chi non è admin)", async () => {
    const activityId = await F.seedActivity({ requires: true });
    const { registrationId } = await F.seedRegistration(manualDoc({ person: personDraft() }), manualId(), { activityId });
    await expectDenied(() => clientOps.normalizeRoomMatches("dirigente", [{ activityId, registrationId }]));
  });

  test("batch delle pattuglie e dei comitati in un campeggio (validCampAssignmentUpdate): a mano, figlio, account, annullata", async () => {
    const activityId = await F.seedActivity({ requires: true, type: "camp" });
    const targets = [];
    for (const [data, id] of [
      [manualDoc({ person: personDraft() }), manualId()],
      [{ ...manualDoc({ person: personDraft() }), registrationStatus: "cancelled" }, manualId()],
      [F.childRegistration(uid("genitore"), childIdOf("genitore"), "heavy"), childIdOf("genitore")],
      [F.childRegistration(uid("genitore"), childIdOf("genitore"), "heavy", { legacy: true }), `child_${uid("genitore")}_figlio-2`],
      [F.accountRegistration(uid("utente"), "maximal"), accountIdOf("utente")],
    ]) {
      await F.seedRegistration(data, id, { activityId });
      targets.push({ activityId, registrationId: id });
    }
    await clientOps.campAssignments("admin", targets);
    for (const { registrationId } of targets) {
      assert.equal((await stored(regPath(activityId, registrationId))).assignedPatrolId, "pattuglia-aquile");
    }
    // Togliere la pattuglia: la stessa scrittura con null.
    await clientOps.campAssignments("admin", targets, { patrol: null });
    assert.equal((await stored(regPath(activityId, targets[0].registrationId))).assignedPatrolId, null);
  });

  test("osservazione: le pattuglie fuori da un campeggio non le scrive più nessun admin (nessun client lo fa)", async (t) => {
    const activityId = await F.seedActivity({ requires: true, type: "trip" });
    const { registrationId } = await F.seedRegistration(manualDoc({ person: personDraft() }), manualId(), { activityId });
    let outcome;
    try {
      await clientOps.campAssignments("admin", [{ activityId, registrationId }]);
      outcome = "consentito";
    } catch (error) {
      outcome = `negato (${error?.code})`;
    }
    t.diagnostic(`assegnazione di pattuglia dall'admin in un viaggio (non campeggio): ${outcome}`);
  });

  test("adminDeleteRegistration: elimina anche un'iscrizione piena di consensi", async () => {
    const ctx = await F.seedRegistration(F.childRegistration(uid("genitore"), childIdOf("genitore"), "maximal"), childIdOf("genitore"));
    await deleteDoc(regRef("admin", ctx.activityId, ctx.registrationId));
    assert.equal(await stored(ctx.path), undefined);
  });
});

// ===========================================================================
// 10. Documenti vecchi con campi fuori lista
// ===========================================================================

describe("10. documenti vecchi: campi fuori elenco, campi mancanti", () => {
  /** Un figlio di prima delle stanze pubblicate e dei comitati, con `status` e `youthGroup` al primo livello. */
  function oldDocument() {
    const data = F.childRegistration(uid("genitore"), childIdOf("genitore"), "signed", { legacy: true });
    const { parentUid: _p, childId: _c, ...rest } = data; // anche senza parentUid/childId nel documento
    return { ...rest, status: "active", youthGroup: "Giovani Donne", eventId: "viaggio-vecchio" };
  }

  test("si annulla", async () => {
    const ctx = await F.seedRegistration(oldDocument(), childIdOf("genitore"));
    await clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, "cancelled");
    assert.equal((await stored(ctx.path)).registrationStatus, "cancelled");
  });

  test("senza `answers` e con `answers: null`: l'admin annulla e riattiva (c640f8c)", async () => {
    const { answers: _answers, ...withoutAnswers } = oldDocument();
    for (const [label, data] of [
      ["senza answers", withoutAnswers],
      ["answers null", { ...oldDocument(), answers: null }],
    ]) {
      const ctx = await F.seedRegistration(data, childIdOf("genitore"));
      await clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, "cancelled");
      const cancelled = await stored(ctx.path);
      assert.equal(cancelled.registrationStatus, "cancelled", label);
      assert.equal(cancelled.answers ?? null, data.answers ?? null, `${label}: answers com'erano`);
      await clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, "active");
      assert.equal((await stored(ctx.path)).registrationStatus, "active", label);
    }
  });

  test("osservazione: senza `answers` / con `answers: null`, correzione dei dati e email del genitore", async (t) => {
    const { answers: _answers, ...withoutAnswers } = oldDocument();
    const outcomes = [];
    for (const [label, data] of [
      ["senza answers", withoutAnswers],
      ["answers null", { ...oldDocument(), answers: null }],
    ]) {
      const ctx = await F.seedRegistration(data, childIdOf("genitore"));
      try {
        await withPatch(ctx.activityId, ctx.registrationId, { phone: "3471112222", updatedAt: nowIso() });
        outcomes.push(`${label}, telefono: consentito`);
      } catch (error) {
        outcomes.push(`${label}, telefono: negato (${error?.code})`);
      }
      try {
        await clientOps.updateParentEmail("admin", ctx.activityId, ctx.registrationId, "nuovo@esempio.invalid");
        outcomes.push(`${label}, email del genitore: consentita`);
      } catch (error) {
        outcomes.push(`${label}, email del genitore: negata (${error?.code})`);
      }
    }
    t.diagnostic(outcomes.join("; "));
  });

  test("si corregge (nome, unità, data) e i campi fuori elenco restano com'erano", async () => {
    const ctx = await F.seedRegistration(oldDocument(), childIdOf("genitore"));
    const { patch } = editPatch(ctx.current, ctx.registrationId, { firstName: "Elisa", unitId: UNIT_2.id, unitName: UNIT_2.name });
    await withPatch(ctx.activityId, ctx.registrationId, patch);
    const after = await stored(ctx.path);
    assert.equal(after.status, "active");
    assert.equal(after.youthGroup, "Giovani Donne");
    assert.equal(after.firstName, "Elisa");
  });

  test("si riattiva (annullata con firma → attiva) e si cambia l'email del genitore", async () => {
    const ctx = await F.seedRegistration({ ...oldDocument(), registrationStatus: "cancelled" }, childIdOf("genitore"));
    await clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, planAdminReactivate(ctx.current, true).status);
    assert.equal((await stored(ctx.path)).registrationStatus, "active");
    await clientOps.updateParentEmail("admin", ctx.activityId, ctx.registrationId, "vecchio@esempio.invalid");
  });

  test("senza roomPreferenceMatches né participatingDays: normalizeRoomPreferenceMatches li aggiunge", async () => {
    const { roomPreferenceMatches: _m, participatingDays: _d, ...rest } = oldDocument();
    const ctx = await F.seedRegistration(rest, childIdOf("genitore"));
    await clientOps.normalizeRoomMatches("admin", [{ activityId: ctx.activityId, registrationId: ctx.registrationId }]);
    assert.ok((await stored(ctx.path)).roomPreferenceMatches);
  });

  test("riallineare il vecchio campo status insieme a registrationStatus", {
    skip: "Scelta (docs/ADMIN_ISCRITTI.md, Riattiva): il censimento del 2026-10-20 trova 0 iscrizioni con status 'cancelled' in produzione, quindi l'admin non scrive `status`",
  }, async () => {
    const ctx = await F.seedRegistration({ ...oldDocument(), status: "cancelled", registrationStatus: "cancelled" }, childIdOf("genitore"));
    await withPatch(ctx.activityId, ctx.registrationId, { registrationStatus: "active", status: "active", updatedAt: nowIso() });
    assert.equal((await stored(ctx.path)).status, "active");
  });

  test("lo stesso riallineamento non permette di scrivere un valore qualunque in status", async () => {
    const ctx = await F.seedRegistration(oldDocument(), childIdOf("genitore"));
    await expectDeniedUnchanged(ctx.path, () => withPatch(ctx.activityId, ctx.registrationId, { status: "pippo", updatedAt: nowIso() }), "status fuori valori");
  });
});

// ===========================================================================
// 11. Titolare: createdBy e flussi di sempre
// ===========================================================================

describe("11. titolare: createdBy resta dell'admin, i flussi di sempre restano", () => {
  let AUTH_ON;
  before(async () => {
    AUTH_ON = await F.seedActivity({ requires: true });
  });

  const baselines = () => [
    [
      "figlio (child_)",
      "genitore",
      childIdOf("genitore"),
      { ...F.childRegistration(uid("genitore"), childIdOf("genitore"), "pending"), parentAuthorization: null },
    ],
    [
      "account (user_)",
      "utente",
      accountIdOf("utente"),
      F.accountRegistration(uid("utente"), "light"),
    ],
  ];

  test("creazione con createdBy valorizzato: negata; lo stesso payload senza createdBy passa", async () => {
    for (const [label, actor, id, payload] of baselines()) {
      const activityId = await F.seedActivity({ requires: true });
      const path = regPath(activityId, id);
      for (const value of [uid("utente"), uid("admin"), "", "x"]) {
        await expectDenied(() => setDoc(regRef(actor, activityId, id), { ...payload, createdBy: value }), `${label}, createdBy ${JSON.stringify(value)}`);
        assert.equal(await stored(path), undefined);
      }
      await setDoc(regRef(actor, activityId, id), payload);
      assert.ok(await stored(path), label);
    }
  });

  test("creazione con createdBy: null esplicito (vuoto alla creazione): passa", async () => {
    for (const [label, actor, id, payload] of baselines()) {
      const activityId = await F.seedActivity({ requires: true });
      await setDoc(regRef(actor, activityId, id), { ...payload, createdBy: null });
      assert.equal((await stored(regPath(activityId, id))).createdBy, null, label);
    }
  });

  test("update che cambia createdBy: negato, da null o da assente", async () => {
    for (const [label, actor, id, payload] of baselines()) {
      const ctx = await F.seedRegistration(payload, id);
      for (const value of [uid("admin"), "x", ""]) {
        await expectDeniedUnchanged(ctx.path, () => clientOps.update(actor, ctx.activityId, id, { createdBy: value, updatedAt: nowIso() }), `${label}, createdBy ${JSON.stringify(value)}`);
      }
      await expectDeniedUnchanged(
        ctx.path,
        () => clientOps.update(actor, ctx.activityId, id, { phone: "3470002222", createdBy: uid(actor), updatedAt: nowIso() }),
        `${label}, createdBy insieme a una modifica lecita`,
      );
    }
  });

  test("update che cambia createdBy su un documento che ce l'ha (a mano): il titolare non lo è, ma neppure un admin lo cambia", async () => {
    const ctx = await F.seedRegistration(manualDoc({ person: personDraft() }), manualId());
    await expectDeniedUnchanged(ctx.path, () => clientOps.update("admin", ctx.activityId, ctx.registrationId, { createdBy: uid("utente"), updatedAt: nowIso() }), "admin cambia createdBy");
    await expectDeniedUnchanged(ctx.path, () => clientOps.update("utente", ctx.activityId, ctx.registrationId, { createdBy: uid("utente"), updatedAt: nowIso() }), "utente cambia createdBy");
  });

  test("osservazione: il titolare che aggiunge createdBy: null a un documento che non ce l'ha", async (t) => {
    const ctx = await F.seedRegistration(baselines()[1][3], accountIdOf("utente"));
    let outcome;
    try {
      await clientOps.update("utente", ctx.activityId, accountIdOf("utente"), { createdBy: null, updatedAt: nowIso() });
      outcome = "consentito";
    } catch (error) {
      outcome = `negato (${error?.code})`;
    }
    t.diagnostic(`createdBy: null aggiunto dal titolare a un documento senza il campo: ${outcome}`);
  });

  test("data di nascita cambiata in minorenne dal titolare: negata con lo stato attivo, consentita passando in attesa (come fa il modulo)", async () => {
    const [, actor, id, payload] = baselines()[1];
    const ctx = await F.seedRegistration(payload, id);
    const datePatch = { birthDate: MINOR, "answers.birthDate": MINOR };
    await expectDeniedUnchanged(ctx.path, () => clientOps.update(actor, ctx.activityId, id, { ...datePatch, updatedAt: nowIso() }), "attivo + minorenne senza firma");
    await clientOps.update(actor, ctx.activityId, id, { ...datePatch, registrationStatus: "pending_parent_authorization", updatedAt: nowIso() });
    assert.equal((await stored(ctx.path)).registrationStatus, "pending_parent_authorization");
  });

  test("il titolare porta da sé l'iscrizione attiva in attesa del genitore (anche senza cambiare la data); da confermata o rifiutata no", async () => {
    const [, actor, id, payload] = baselines()[1];
    const active = await F.seedRegistration(payload, id);
    await clientOps.setStatus(actor, active.activityId, id, "pending_parent_authorization");
    assert.equal((await stored(active.path)).registrationStatus, "pending_parent_authorization");
    for (const status of ["confirmed", "rejected_by_parent", "waitlist"]) {
      const ctx = await F.seedRegistration({ ...payload, registrationStatus: status }, id);
      await expectDeniedUnchanged(ctx.path, () => clientOps.setStatus(actor, ctx.activityId, id, "pending_parent_authorization"), `da ${status}`);
    }
    // Il ritorno da in attesa ad attiva resta dell'admin / della firma.
    const pending = await F.seedRegistration({ ...payload, registrationStatus: "pending_parent_authorization" }, id);
    await expectDeniedUnchanged(pending.path, () => clientOps.setStatus(actor, pending.activityId, id, "active"), "pending → active");
  });

  test("un minorenne attivo senza firma (iscritto prima che l'attività la chiedesse) corregge la propria data: con lo stato attivo no, passando in attesa sì", async () => {
    const [, actor, id, payload] = baselines()[1];
    const ctx = await F.seedRegistration({ ...payload, birthDate: MINOR, answers: { ...payload.answers, birthDate: MINOR } }, id);
    const other = `${thisYearMinus(15)}-03-02`;
    const datePatch = { birthDate: other, "answers.birthDate": other };
    await expectDeniedUnchanged(ctx.path, () => clientOps.update(actor, ctx.activityId, id, { ...datePatch, updatedAt: nowIso() }), "stato invariato");
    await clientOps.update(actor, ctx.activityId, id, { ...datePatch, registrationStatus: "pending_parent_authorization", updatedAt: nowIso() });
  });

  test("data di nascita cambiata da un'iscrizione attiva con la firma o da minorenne a adulto: passa", async () => {
    const signed = await F.seedRegistration(
      { ...F.childRegistration(uid("genitore"), childIdOf("genitore"), "signed"), registrationStatus: "active" },
      childIdOf("genitore"),
    );
    const other = `${thisYearMinus(15)}-03-02`;
    await clientOps.update("genitore", signed.activityId, childIdOf("genitore"), { birthDate: other, "answers.birthDate": other, updatedAt: nowIso() });
    const minorAccount = await F.seedRegistration({ ...baselines()[1][3], birthDate: MINOR }, accountIdOf("utente"));
    await clientOps.update("utente", minorAccount.activityId, accountIdOf("utente"), { birthDate: ADULT, "answers.birthDate": ADULT, updatedAt: nowIso() });
  });

  test("il risalvataggio del modulo del titolare (updateDoc dei tredici campi) passa e non tocca createdBy", async () => {
    for (const [label, actor, id, payload] of baselines()) {
      const ctx = await F.seedRegistration(payload, id);
      await clientOps.resave(actor, ctx.activityId, id, ctx.current, { changes: { phone: "3470001111" } });
      const after = await stored(ctx.path);
      assert.equal(after.phone, "3470001111", label);
      assert.ok(!("createdBy" in after) || after.createdBy === null, label);
    }
  });

  test("annullamento del titolare (due campi) e reiscrizione: passano", async () => {
    for (const [label, actor, id, payload] of baselines()) {
      const ctx = await F.seedRegistration(payload, id);
      await clientOps.setStatus(actor, ctx.activityId, id, "cancelled");
      assert.equal((await stored(ctx.path)).registrationStatus, "cancelled", label);
      const current = await stored(ctx.path);
      await clientOps.resave(actor, ctx.activityId, id, current, { status: current.parentAuthorization ? "active" : label.startsWith("figlio") ? "pending_parent_authorization" : "active" });
    }
  });

  test("il titolare non riattiva né annulla un'iscrizione a mano (non gli appartiene)", async () => {
    const ctx = await F.seedRegistration({ ...manualDoc({ person: personDraft() }), registrationStatus: "cancelled" }, manualId());
    for (const actor of ["utente", "genitore"]) {
      await expectDeniedUnchanged(ctx.path, () => clientOps.setStatus(actor, ctx.activityId, ctx.registrationId, "active"), actor);
    }
  });
});

// ===========================================================================
// 12. Admin che è anche genitore: il ramo del titolare viene prima di quello admin
// ===========================================================================

describe("12. admin che è anche genitore o partecipante: le sue iscrizioni", () => {
  const ownChild = (flavor, opts) => F.childRegistration(uid("admin-genitore"), childIdOf("admin-genitore"), flavor, opts);
  const ownAccount = (flavor, opts) => F.accountRegistration(uid("admin-genitore"), flavor, opts);

  test("salva dal modulo l'iscrizione del figlio (pesante e massima) con lo stato di sempre", async () => {
    for (const flavor of ["pending", "heavy", "maximal"]) {
      const ctx = await F.seedRegistration(ownChild(flavor), childIdOf("admin-genitore"));
      await clientOps.resave("adminGenitore", ctx.activityId, ctx.registrationId, ctx.current, { changes: { phone: "3470009999" } });
      assert.equal((await stored(ctx.path)).phone, "3470009999", flavor);
    }
  });

  test("annulla l'iscrizione del figlio e la riattiva dal modulo (firmata → attiva, non firmata → in attesa)", async () => {
    const signed = await F.seedRegistration(ownChild("heavy"), childIdOf("admin-genitore"));
    await clientOps.setStatus("adminGenitore", signed.activityId, signed.registrationId, "cancelled");
    await clientOps.setStatus("adminGenitore", signed.activityId, signed.registrationId, "active");
    const pending = await F.seedRegistration(ownChild("pending", { cancelled: true }), childIdOf("admin-genitore"));
    await expectDeniedUnchanged(pending.path, () => clientOps.setStatus("adminGenitore", pending.activityId, pending.registrationId, "active"), "active senza firma");
    await clientOps.setStatus("adminGenitore", pending.activityId, pending.registrationId, "pending_parent_authorization");
  });

  test("corregge dati del proprio figlio con le chiavi dell'admin (nome, telefono, unità)", async () => {
    for (const flavor of ["pending", "heavy", "maximal"]) {
      const ctx = await F.seedRegistration(ownChild(flavor), childIdOf("admin-genitore"));
      const { patch } = editPatch(ctx.current, ctx.registrationId, { firstName: "Rita", unitId: UNIT_2.id, unitName: UNIT_2.name, phone: "3470004444" });
      await withPatch(ctx.activityId, ctx.registrationId, patch);
      assert.equal((await stored(ctx.path)).unitId, UNIT_2.id, flavor);
    }
  });

  test("cambia l'email del genitore del proprio figlio (adminUpdateParentAuthorizationEmail)", async () => {
    for (const flavor of ["pending", "heavy", "maximal"]) {
      const ctx = await F.seedRegistration(ownChild(flavor), childIdOf("admin-genitore"));
      await clientOps.updateParentEmail("adminGenitore", ctx.activityId, ctx.registrationId, "nuova@esempio.invalid");
      assert.equal((await stored(ctx.path)).parentAuthorization.parentEmail, "nuova@esempio.invalid", flavor);
    }
  });

  test("le sue assegnazioni di pattuglia in un campeggio, con la sua iscrizione pesante nel lotto", async () => {
    const activityId = await F.seedActivity({ requires: true, type: "camp" });
    const targets = [];
    for (const [data, id] of [
      [manualDoc({ person: personDraft() }), manualId()],
      [ownChild("heavy"), childIdOf("admin-genitore")],
      [ownAccount("maximal"), accountIdOf("admin-genitore")],
    ]) {
      await F.seedRegistration(data, id, { activityId });
      targets.push({ activityId, registrationId: id });
    }
    await clientOps.campAssignments("adminGenitore", targets);
    for (const { registrationId } of targets) {
      assert.equal((await stored(regPath(activityId, registrationId))).assignedPatrolId, "pattuglia-aquile", registrationId);
    }
  });

  test("normalizeRoomPreferenceMatches con le sue iscrizioni pesanti nel lotto", async () => {
    const activityId = await F.seedActivity({ requires: true });
    const targets = [];
    for (const [data, id] of [
      [ownChild("maximal"), childIdOf("admin-genitore")],
      [ownAccount("maximal"), accountIdOf("admin-genitore")],
    ]) {
      await F.seedRegistration(data, id, { activityId });
      targets.push({ activityId, registrationId: id });
    }
    await clientOps.normalizeRoomMatches("adminGenitore", targets);
  });

  test("non scrive per questo le assegnazioni, i consensi o createdBy sulla sua iscrizione", async () => {
    const ctx = await F.seedRegistration(ownChild("heavy"), childIdOf("admin-genitore"));
    for (const patch of [
      { assignedRoomId: "stanza-99" },
      { "parentAuthorization.photoConsent": "refused" },
      { parentConsentDocumentUrl: "https://forged.example.invalid/x.pdf" },
      { createdBy: uid("admin-genitore") },
      { registrationStatus: "rejected_by_parent" },
    ]) {
      await expectDeniedUnchanged(ctx.path, () => clientOps.update("adminGenitore", ctx.activityId, ctx.registrationId, { ...patch, updatedAt: nowIso() }), JSON.stringify(patch));
    }
  });
});

// ===========================================================================
// 13. Le `manual_` create dallo script operatore (13 sul viaggio al tempio)
// ===========================================================================

describe("13. iscrizioni a mano create con l'Admin SDK (forma di add-october-registrations.cjs)", () => {
  /** Senza data di nascita, senza unità (3 su 13), senza `youthGroup` né `createdBy`, `answers` ridotte a tre campi. */
  const scriptDocument = (overrides = {}) => ({
    userId: null,
    anonymousUid: null,
    parentUid: null,
    childId: null,
    anonymousTokenId: null,
    firstName: "Ester",
    lastName: "Murgia",
    fullName: "Ester Murgia",
    email: "",
    phone: "",
    birthDate: "",
    genderRoleCategory: "giovane_donna",
    unitId: "",
    unitNameSnapshot: "",
    answers: { unitName: "", birthDate: "", genderRoleCategory: "giovane_donna" },
    roomPreferenceMatches: {},
    accessCode: null,
    recoveryCode: null,
    participatingDays: [],
    recoveryPdfGenerated: false,
    parentConsentDocumentName: null,
    parentConsentDocumentUrl: null,
    parentConsentDocumentPath: null,
    parentConsentUploadedAt: null,
    consentSignatureUrl: null,
    consentSignaturePath: null,
    consentSignatureSetAt: null,
    parentIdDocumentName: null,
    parentIdDocumentUrl: null,
    parentIdDocumentPath: null,
    parentIdUploadedAt: null,
    parentAuthorization: null,
    linkedLaterToUserId: null,
    registrationStatus: "active",
    submittedByMode: "anonymous",
    assignedRoomId: null,
    assignedTempleShiftId: null,
    assignedServiceTeamIds: [],
    assignedPatrolId: null,
    assignedPatrolName: null,
    assignedPatrolRole: null,
    assignedCommittees: [],
    createdAt: "2026-10-14T10:00:00.000Z",
    updatedAt: "2026-10-14T10:00:00.000Z",
    ...overrides,
  });

  test("l'admin completa unità e data da adulto: resta attiva; le copie nelle risposte si aggiungono (youthGroup compreso)", async () => {
    const ctx = await F.seedRegistration(scriptDocument(), manualId());
    const { patch } = editPatch(ctx.current, ctx.registrationId, { birthDate: ADULT, unitId: UNIT_1.id, unitName: UNIT_1.name });
    await withPatch(ctx.activityId, ctx.registrationId, patch);
    const after = await stored(ctx.path);
    assert.equal(after.registrationStatus, "active");
    assert.equal(after.unitId, UNIT_1.id);
    assert.equal(after.answers.youthGroup, "Giovani Donne");
  });

  test("l'admin completa la data di una minorenne: passa in attesa, con la richiesta del genitore se c'è l'email", async () => {
    const ctx = await F.seedRegistration(scriptDocument(), manualId());
    const { patch, plan } = editPatch(ctx.current, ctx.registrationId, { birthDate: MINOR, unitId: UNIT_1.id, unitName: UNIT_1.name }, { parent: parentDraft() });
    assert.equal(plan.nextStatus, "pending_parent_authorization");
    await withPatch(ctx.activityId, ctx.registrationId, patch);
    const after = await stored(ctx.path);
    assert.equal(after.registrationStatus, "pending_parent_authorization");
    assert.equal(after.answers.parentAuthorizationRequest.parentEmail, "genitore@example.invalid");
  });

  test("le 4 'in attesa' senza email e senza richiesta: 'Chiedi l'autorizzazione' scrive la richiesta e lascia lo stato", async () => {
    const ctx = await F.seedRegistration(scriptDocument({ birthDate: MINOR, registrationStatus: "pending_parent_authorization" }), manualId());
    const patch = buildRequestAuthorizationPatch(ctx.current, parentDraft(), nowIso());
    assert.ok(!("registrationStatus" in patch));
    await withPatch(ctx.activityId, ctx.registrationId, patch);
    assert.equal((await stored(ctx.path)).answers.parentAuthorizationRequest.parentEmail, "genitore@example.invalid");
  });

  test("si annullano, si riattivano (adulta) e si eliminano come le altre", async () => {
    const ctx = await F.seedRegistration(scriptDocument(), manualId());
    await clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, "cancelled");
    await clientOps.setStatus("admin", ctx.activityId, ctx.registrationId, planAdminReactivate(await stored(ctx.path), true).status);
    assert.equal((await stored(ctx.path)).registrationStatus, "active");
    await deleteDoc(regRef("admin", ctx.activityId, ctx.registrationId));
    assert.equal(await stored(ctx.path), undefined);
  });
});
