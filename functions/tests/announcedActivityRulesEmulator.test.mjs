// Contratto dello stato «annunciata» (docs/ATTIVITA_MODULARI.md, «Settimo
// incremento»: «Annunciata: i dati», «Le rules bastano: verifica», «Chi vede,
// chi scrive»): le rules NON cambiano, questo test prova che quelle esistenti
// fanno ciò che dice la tabella. Annunciata = attività in
// stakes/{stakeId}/activities/{id} con status: "planned", isPublic: true,
// isVisible: true.
//
// Chiamate come il client (SDK client, utenti veri con token mock dell'emulatore;
// l'Admin SDK serve solo per seminare e rileggere, perché ignora le rules):
// - creazione dalla rapida (eventsService.createEvent): batch.set dell'attività
//   (forma di normalizeEventInput, più timeToBeDefined: true) e, tramite
//   eventFormsService.saveFormConfig, set di config/form e dei formFields;
// - annuncio di una bozza (futuro eventsService.announceEvent): runTransaction
//   con get dell'attività e, se è draft, update { status: "planned",
//   isPublic: true, isVisible: true, updatedAt };
// - apertura iscrizioni (publishEvent esteso): transazione get + update
//   { status: "registrations_open", isPublic: true, isVisible: true, updatedAt }
//   partendo da planned;
// - «Rimetti annunciata» senza iscritti: update { status: "planned", updatedAt };
// - togli dal catalogo (unpublishEvent): se è pubblica, update { status: "draft",
//   isPublic: false, isVisible: false, updatedAt };
// - annulla / riapri (setEventCancelled, con il campo nuovo statusBeforeCancel):
//   annulla scrive { status: "cancelled", statusBeforeCancel: "planned",
//   updatedAt }; riapri rilegge il campo e torna a planned;
// - catalogo (listPublicEventsUncached): where isPublic == true e isVisible == true
//   sulle attività del palo; scheda pubblica (getPublicEventById): getDoc;
//   modulo: getDoc di config/form; elenco admin: tutta la collection;
// - iscrizione nuova: lo STESSO payload valido delle fixture (user_, guest_
//   anonimo, child_ del genitore). Su un'annunciata è negato; sulla stessa
//   attività dopo l'apertura iscrizioni (registrations_open) è ammesso: a negare
//   è lo stato, non il payload.
// - annullamento del titolare: updateDoc(reg, { registrationStatus: "cancelled",
//   updatedAt }) (parentCancelRulesEmulator).
// - «Elimina» della rapida (deleteAnnouncedEvent): getDocs di formFields e
//   registrations, poi transazione get attività + delete dei formFields, di
//   config/form e dell'attività, solo se ancora planned e stessa revisione.
//
// Nota del progetto: il rifiuto di una create iscrizione su una bozza arrivava
// come «maximum of 1000 expressions» invece di false della rule. expectDenied
// accetta entrambi: in emulatore hanno code permission-denied. Se il messaggio
// contiene «1000 expressions» il test lo annota nell'asserzione.
//
// Fixture da functions/tests/helpers/adminRegistrationFixtures.mjs.
//
// Rilancio dalla radice del repository (solo Firestore, porta 8180):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --only firestore --config firebase.room-test.json --project demo-announced \
//     'node --test --test-concurrency=1 functions/tests/announcedActivityRulesEmulator.test.mjs'
// Con le porte occupate da un'altra sessione non fermarla: copia la config su
// porte diverse (Firestore, hub, logging, websocket) in un file temporaneo e
// rimuovilo a fine prova; il test legge l'host da FIRESTORE_EMULATOR_HOST.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { deleteApp, initializeApp } from "firebase/app";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

import { CHILD_ID, createFixtures, nowIso, SEEDED_AT } from "./helpers/adminRegistrationFixtures.mjs";

const fx = createFixtures("annunciata");
const { stakeId, otherStakeId, uid, adminDb, fs, stored } = fx;

fx.ACTORS.iscritto = { name: "iscritto", profile: { role: "participant", stakeId } };
fx.ACTORS.dirigenteAltroPalo = {
  name: "dirigente-altro",
  profile: { role: "unit_leader", stakeId: otherStakeId, unitId: "unita-altro-palo", unitName: "Unità di un altro palo" },
};
fx.ACTORS.partecipanteAltroPalo = { name: "partecipante-altro", profile: { role: "participant", stakeId: otherStakeId } };

let guestApp = null;
let guestDb = null;

const activityPath = (activityId) => `stakes/${stakeId}/activities/${activityId}`;
const activityRef = (db, activityId) => doc(db, activityPath(activityId));
const formPath = (activityId) => `${activityPath(activityId)}/config/form`;
const formRef = (db, activityId) => doc(db, formPath(activityId));
const registrationId = {
  user: (name) => `user_${uid(name)}`,
  guest: () => `guest_${uid("ospite")}`,
  child: () => `child_${uid("genitore")}_${CHILD_ID}`,
};

// Campi di default di eventFormsService.saveFormConfig / getDefaultEventFormConfig
// (audience congiunta, non overnight: birthDate, genderRoleCategory, phone, unitName).
const FORM_FIELDS = [
  {
    id: "birthDate",
    key: "birthDate",
    label: "Data di nascita",
    type: "shortText",
    required: true,
    order: 0,
    presetOrigin: "standard",
    options: [],
    helpText: "Serve per organizzare attività e autorizzazioni in modo corretto.",
  },
  {
    id: "genderRoleCategory",
    key: "genderRoleCategory",
    label: "Organizzazione",
    type: "select",
    required: true,
    order: 1,
    presetOrigin: "standard",
    options: ["giovane_uomo", "giovane_donna", "dirigente", "accompagnatore"],
    helpText: "Seleziona se sei GU, GD, dirigente o accompagnatore.",
  },
  {
    id: "phone",
    key: "phone",
    label: "Telefono",
    type: "shortText",
    required: false,
    order: 2,
    presetOrigin: "standard",
    options: [],
    helpText: "Numero di contatto principale.",
  },
  {
    id: "unitName",
    key: "unitName",
    label: "Rione o ramo",
    type: "select",
    required: true,
    order: 3,
    presetOrigin: "standard",
    options: [],
    helpText: "Scegli l'unità di appartenenza.",
  },
];

/**
 * Documento dell'annunciata come lo scrive createEvent: normalizeEventInput
 * (tipo standard, luogo e date d'iscrizione vuoti) più timeToBeDefined: true
 * e i campi di create (activityId, createdBy, createdAt, updatedAt).
 */
function announcedActivityData(activityId, createdBy, timestamp) {
  return {
    title: "Serata di palo",
    slug: "serata-di-palo",
    description: "",
    year: 2026,
    audience: "congiunta",
    startDate: "2026-12-15T00:00:00.000Z",
    endDate: "2026-12-15T23:59:00.000Z",
    location: "",
    program: "",
    publicNotes: "",
    organizerNotes: "",
    menuInfo: "",
    allergiesInfo: "",
    roomsInfo: "",
    whatToBring: "",
    heroImageUrl: "",
    heroImagePath: "",
    coverImageUrl: "",
    coverImagePath: "",
    status: "planned",
    isPublic: true,
    isVisible: true,
    allowGuestRegistration: true,
    requireLoginForEdit: true,
    registrationOpen: "",
    registrationClose: "",
    maxParticipants: null,
    overnight: false,
    activityType: "standard",
    requiresAccount: false,
    requiresParentAuthorization: false,
    requiresEmergencyContacts: false,
    requiresMedicalNotes: false,
    requiresImageConsent: false,
    requiresDocumentUpload: false,
    consentVersionId: "v1-2026-05",
    privacyNoticeVersionId: "v1-2026-05",
    imageConsentVersionId: "v1-2026-05",
    templateId: null,
    questionsEnabled: false,
    requiresParentalConsent: false,
    requiresPhotoRelease: false,
    timeToBeDefined: true,
    activityId,
    createdBy,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** Batch di createEvent: set attività + config/form + formFields di saveFormConfig. */
function createAnnounced(db, activityId, createdBy) {
  const timestamp = nowIso();
  const batch = writeBatch(db);
  batch.set(activityRef(db, activityId), announcedActivityData(activityId, createdBy, timestamp));
  batch.set(formRef(db, activityId), { allowGuestRegistration: true, requireLoginForEdit: true });
  for (const field of FORM_FIELDS) {
    batch.set(doc(db, `${activityPath(activityId)}/formFields/${field.id}`), field);
  }
  return batch.commit();
}

/** Annuncio di una bozza, come la transazione di announceEvent. */
function announce(db, activityId) {
  const ref = activityRef(db, activityId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.data().status !== "draft") return;
    transaction.update(ref, { status: "planned", isPublic: true, isVisible: true, updatedAt: nowIso() });
  });
}

/** Apertura iscrizioni da planned, come publishEvent esteso (non esce se è già pubblica). */
function publish(db, activityId) {
  const ref = activityRef(db, activityId);
  return runTransaction(db, async (transaction) => {
    await transaction.get(ref);
    transaction.update(ref, { status: "registrations_open", isPublic: true, isVisible: true, updatedAt: nowIso() });
  });
}

/** «Rimetti annunciata» senza iscritti: solo lo status, isPublic/isVisible restano. */
function remakeAnnounced(db, activityId) {
  const ref = activityRef(db, activityId);
  return runTransaction(db, async (transaction) => {
    await transaction.get(ref);
    transaction.update(ref, { status: "planned", updatedAt: nowIso() });
  });
}

/** Togli dal catalogo, come la transazione di unpublishEvent. */
function unpublish(db, activityId) {
  const ref = activityRef(db, activityId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.data().isPublic) return;
    transaction.update(ref, { status: "draft", isPublic: false, isVisible: false, updatedAt: nowIso() });
  });
}

/** Annulla, come setEventCancelled(true) con il campo nuovo statusBeforeCancel. */
function cancelEvent(db, activityId, statusBeforeCancel = "planned") {
  const ref = activityRef(db, activityId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.data().status === "cancelled") return;
    transaction.update(ref, { status: "cancelled", statusBeforeCancel, updatedAt: nowIso() });
  });
}

/** Riapri, come setEventCancelled(false) che rilegge statusBeforeCancel. */
function reopenEvent(db, activityId) {
  const ref = activityRef(db, activityId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.data();
    if (current.status !== "cancelled") return;
    const nextStatus = current.statusBeforeCancel || (current.isPublic ? "registrations_open" : "draft");
    transaction.update(ref, { status: nextStatus, updatedAt: nowIso() });
  });
}

/**
 * «Elimina» della rapida, come eventsService.deleteAnnouncedEvent: legge
 * formFields e registrations, poi in transazione cancella i campi, config/form
 * e l'attività se è ancora planned con la revisione vista.
 */
async function deleteAnnounced(db, activityId, expectedUpdatedAt) {
  const reference = activityRef(db, activityId);
  const [fields, registrations] = await Promise.all([
    getDocs(collection(reference, "formFields")),
    getDocs(collection(reference, "registrations")),
  ]);
  if (!registrations.empty) throw new Error("Nel frattempo è cambiata: aprila dalla scheda.");
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) return;
    const data = snapshot.data();
    if (data.status !== "planned" || data.updatedAt !== expectedUpdatedAt) {
      throw new Error("Nel frattempo è cambiata: aprila dalla scheda.");
    }
    for (const field of fields.docs) transaction.delete(field.ref);
    transaction.delete(doc(reference, "config", "form"));
    transaction.delete(reference);
  });
}

async function formFieldMap(activityId) {
  const snapshot = await adminDb.collection(`${activityPath(activityId)}/formFields`).get();
  return Object.fromEntries(snapshot.docs.map((item) => [item.id, item.data()]));
}

const catalogIds = async (db) =>
  (
    await getDocs(
      query(collection(db, `stakes/${stakeId}/activities`), where("isPublic", "==", true), where("isVisible", "==", true)),
    )
  ).docs.map((item) => item.id);
const listAllIds = async (db) => (await getDocs(collection(db, `stakes/${stakeId}/activities`))).docs.map((item) => item.id);

/**
 * Rifiuto delle rules. Accetta sia false della rule sia «maximum of 1000
 * expressions»: in emulatore entrambi arrivano come permission-denied.
 */
async function expectDenied(operation, message = "") {
  let failure = null;
  try {
    await operation();
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, `${message}: la scrittura doveva essere negata e invece è passata`);
  const hint = String(failure?.message ?? "").includes("1000 expressions")
    ? " (rifiuto per «maximum of 1000 expressions», non per false della rule)"
    : "";
  assert.equal(failure?.code, "permission-denied", `${message}${hint} ${failure?.code}: ${failure?.message}`);
}

async function putActivity(activityId, data) {
  await adminDb.doc(activityPath(activityId)).set({
    title: `Attività ${activityId}`,
    activityType: "trip",
    overnight: true,
    isPublic: true,
    isVisible: true,
    registrationOpen: "2026-09-01T08:00:00.000Z",
    startDate: "2026-11-13T14:00:00.000Z",
    endDate: "2026-11-17T16:00:00.000Z",
    requiresParentAuthorization: false,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
    ...data,
  });
}

async function putForm(activityId) {
  await adminDb.doc(formPath(activityId)).set({ allowGuestRegistration: true, requireLoginForEdit: true });
}

async function putAnnounced(activityId, extra = {}) {
  await putActivity(activityId, { status: "planned", timeToBeDefined: true, location: "", description: "", registrationOpen: "", registrationClose: "", ...extra });
  await putForm(activityId);
}

async function putDraft(activityId) {
  await putActivity(activityId, { status: "draft", isPublic: false, isVisible: false });
}

async function putOpen(activityId) {
  await putActivity(activityId, { status: "registrations_open" });
  await putForm(activityId);
}

function userPayload(name) {
  return fx.accountRegistration(uid(name), "light");
}

function guestPayload() {
  const owner = uid("ospite");
  return {
    ...fx.accountRegistration(owner, "light"),
    userId: null,
    anonymousUid: owner,
    submittedByMode: "anonymous",
    recoveryCode: "REC-ABCD-1234",
    accessCode: "REC-ABCD-1234",
  };
}

function childPayload() {
  const parentUid = uid("genitore");
  return {
    ...fx.accountRegistration(parentUid, "light"),
    userId: null,
    parentUid,
    childId: CHILD_ID,
    submittedByMode: "parent",
  };
}

before(async () => {
  await fx.setup();
  // Ospite anonimo (sign_in_provider anonymous): la fixture usa sempre "password".
  guestApp = initializeApp({ apiKey: "demo-key", projectId: fx.PROJECT }, `ospite-${fx.runId}`);
  guestDb = getFirestore(guestApp);
  const [host, port] = fx.FIRESTORE_HOST.split(":");
  connectFirestoreEmulator(guestDb, host, Number(port), {
    mockUserToken: { sub: uid("ospite"), firebase: { sign_in_provider: "anonymous" } },
  });
});

after(async () => {
  try {
    if (guestApp) await deleteApp(guestApp);
  } finally {
    await fx.teardown();
  }
});

describe("Annunciata: le rules esistenti reggono il contratto", () => {
  test("1. admin crea l'annunciata col batch del client; partecipante, ospite e visitatore no", async () => {
    await createAnnounced(fs("admin"), "crea-rapida-admin", uid("admin"));
    const created = await stored(activityPath("crea-rapida-admin"));
    assert.equal(created.status, "planned");
    assert.equal(created.isPublic, true);
    assert.equal(created.isVisible, true);
    assert.equal(created.timeToBeDefined, true);
    assert.equal(created.location, "");
    assert.equal(created.description, "");
    assert.equal(created.registrationOpen, "");
    assert.equal(created.registrationClose, "");
    const form = await stored(formPath("crea-rapida-admin"));
    assert.equal(form.allowGuestRegistration, true);
    assert.equal(form.requireLoginForEdit, true);

    await expectDenied(
      () => createAnnounced(fs("utente"), "crea-rapida-utente", uid("utente")),
      "partecipante: batch della rapida",
    );
    await expectDenied(
      () => createAnnounced(guestDb, "crea-rapida-ospite", uid("ospite")),
      "ospite anonimo: batch della rapida",
    );
    await expectDenied(
      () => createAnnounced(fs("nonAutenticato"), "crea-rapida-visitatore", ""),
      "visitatore: batch della rapida",
    );
    assert.equal((await adminDb.doc(activityPath("crea-rapida-utente")).get()).exists, false);
    assert.equal((await adminDb.doc(activityPath("crea-rapida-ospite")).get()).exists, false);
    assert.equal((await adminDb.doc(activityPath("crea-rapida-visitatore")).get()).exists, false);
  });

  test("2. visitatore, ospite, partecipante, genitore: get, catalogo e config/form dell'annunciata", async () => {
    await putAnnounced("lettura-annunciata");
    await putOpen("catalogo-controllo");

    for (const [label, db] of [
      ["non autenticato", fs("nonAutenticato")],
      ["ospite anonimo", guestDb],
      ["partecipante del palo", fs("utente")],
      ["genitore", fs("genitore")],
    ]) {
      const snapshot = await getDoc(activityRef(db, "lettura-annunciata"));
      assert.equal(snapshot.exists(), true, `${label}: getDoc dell'annunciata`);
      assert.equal(snapshot.data().status, "planned");
      const ids = await catalogIds(db);
      assert.ok(ids.includes("lettura-annunciata"), `${label}: la query del catalogo la restituisce`);
      assert.ok(ids.includes("catalogo-controllo"), `${label}: la query del catalogo restituisce anche le aperte`);
      const form = await getDoc(formRef(db, "lettura-annunciata"));
      assert.equal(form.exists(), true, `${label}: getDoc di config/form`);
    }
  });

  test("3. iscrizione nuova sull'annunciata: negata per user_, guest_, child_; ammessa dopo l'apertura", async () => {
    await putAnnounced("iscr-annunciata");
    const attempts = [
      ["user_", fs("utente"), registrationId.user("utente"), userPayload("utente")],
      ["guest_", guestDb, registrationId.guest(), guestPayload()],
      ["child_", fs("genitore"), registrationId.child(), childPayload()],
    ];

    for (const [kind, db, id, payload] of attempts) {
      await expectDenied(
        () => setDoc(doc(db, fx.regPath("iscr-annunciata", id)), payload),
        `iscrizione ${kind} su annunciata`,
      );
      assert.equal(
        (await adminDb.doc(fx.regPath("iscr-annunciata", id)).get()).exists,
        false,
        `${kind}: nessun documento creato sull'annunciata`,
      );
    }

    await publish(fs("admin"), "iscr-annunciata");
    assert.equal((await stored(activityPath("iscr-annunciata"))).status, "registrations_open");

    for (const [kind, db, id, payload] of attempts) {
      await setDoc(doc(db, fx.regPath("iscr-annunciata", id)), payload);
      assert.ok((await adminDb.doc(fx.regPath("iscr-annunciata", id)).get()).exists, `${kind}: stesso payload ammesso a iscrizioni aperte`);
    }
  });

  test("4. dirigente del palo: get e list ammessi; altro palo: list senza filtro negata, catalogo ammesso", async () => {
    await putAnnounced("altro-palo-annunciata");
    await putDraft("altro-palo-bozza");

    assert.equal((await getDoc(activityRef(fs("dirigente"), "altro-palo-annunciata"))).exists(), true);
    const ownList = await listAllIds(fs("dirigente"));
    assert.ok(ownList.includes("altro-palo-annunciata"), "dirigente del palo: list include l'annunciata");
    assert.ok(ownList.includes("altro-palo-bozza"), "dirigente del palo: list include anche le bozze (isUnitLeaderOfStake)");

    // allow list: isStakeAdmin || isPublicActivityListDoc || isUnitLeaderOfStake.
    // Senza vincolo sulla query, un doc non pubblico (la bozza) fa fallire l'intera
    // list per chi non è staff del palo. La query del catalogo (isPublic == true,
    // isVisible == true) coincide con isPublicActivityListDoc e passa.
    for (const [label, actor] of [
      ["dirigente di un altro palo", "dirigenteAltroPalo"],
      ["partecipante di un altro palo", "partecipanteAltroPalo"],
      ["admin di un altro palo", "adminAltroPalo"],
    ]) {
      await expectDenied(() => listAllIds(fs(actor)), `${label}: list senza filtro (ci sono bozze)`);
      const ids = await catalogIds(fs(actor));
      assert.ok(ids.includes("altro-palo-annunciata"), `${label}: catalogo ammesso, annunciata presente`);
      assert.ok(!ids.includes("altro-palo-bozza"), `${label}: la bozza non è nel catalogo`);
      const snapshot = await getDoc(activityRef(fs(actor), "altro-palo-annunciata"));
      assert.equal(snapshot.exists(), true, `${label}: get dell'annunciata ammesso (isPublicActivityDoc)`);
      await expectDenied(() => getDoc(activityRef(fs(actor), "altro-palo-bozza")), `${label}: get della bozza`);
    }
  });

  test("5. transizioni dell'admin ammesse; le stesse da un partecipante negate", async () => {
    await putDraft("trans-admin");
    await announce(fs("admin"), "trans-admin");
    let current = await stored(activityPath("trans-admin"));
    assert.equal(current.status, "planned");
    assert.equal(current.isPublic, true);
    assert.equal(current.isVisible, true);

    await publish(fs("admin"), "trans-admin");
    assert.equal((await stored(activityPath("trans-admin"))).status, "registrations_open");

    await remakeAnnounced(fs("admin"), "trans-admin");
    current = await stored(activityPath("trans-admin"));
    assert.equal(current.status, "planned");
    assert.equal(current.isPublic, true);
    assert.equal(current.isVisible, true);

    await unpublish(fs("admin"), "trans-admin");
    current = await stored(activityPath("trans-admin"));
    assert.equal(current.status, "draft");
    assert.equal(current.isPublic, false);
    assert.equal(current.isVisible, false);

    await announce(fs("admin"), "trans-admin");
    await cancelEvent(fs("admin"), "trans-admin", "planned");
    current = await stored(activityPath("trans-admin"));
    assert.equal(current.status, "cancelled");
    assert.equal(current.statusBeforeCancel, "planned");

    await reopenEvent(fs("admin"), "trans-admin");
    current = await stored(activityPath("trans-admin"));
    assert.equal(current.status, "planned");
    assert.equal(current.isPublic, true);

    await putDraft("trans-partecipante-bozza");
    await putAnnounced("trans-partecipante-annunciata");
    await putOpen("trans-partecipante-aperta");
    const beforeDraft = await stored(activityPath("trans-partecipante-bozza"));
    const beforeAnnounced = await stored(activityPath("trans-partecipante-annunciata"));
    const beforeOpen = await stored(activityPath("trans-partecipante-aperta"));

    await expectDenied(() => announce(fs("utente"), "trans-partecipante-bozza"), "partecipante: announce");
    await expectDenied(() => publish(fs("utente"), "trans-partecipante-annunciata"), "partecipante: publish");
    await expectDenied(() => remakeAnnounced(fs("utente"), "trans-partecipante-aperta"), "partecipante: rimetti annunciata");
    await expectDenied(() => unpublish(fs("utente"), "trans-partecipante-annunciata"), "partecipante: unpublish");
    await expectDenied(() => cancelEvent(fs("utente"), "trans-partecipante-annunciata"), "partecipante: annulla");
    await expectDenied(
      () =>
        updateDoc(activityRef(fs("utente"), "trans-partecipante-annunciata"), {
          status: "cancelled",
          statusBeforeCancel: "planned",
          updatedAt: nowIso(),
        }),
      "partecipante: annulla con updateDoc",
    );
    assert.deepEqual(await stored(activityPath("trans-partecipante-bozza")), beforeDraft);
    assert.deepEqual(await stored(activityPath("trans-partecipante-annunciata")), beforeAnnounced);
    assert.deepEqual(await stored(activityPath("trans-partecipante-aperta")), beforeOpen);
  });

  test("6. dopo «Togli dal catalogo» di un'annunciata: visitatore get negato, assente dal catalogo", async () => {
    await putAnnounced("togli-annunciata");
    await putOpen("togli-controllo");
    await unpublish(fs("admin"), "togli-annunciata");
    const after = await stored(activityPath("togli-annunciata"));
    assert.equal(after.status, "draft");
    assert.equal(after.isPublic, false);
    assert.equal(after.isVisible, false);

    await expectDenied(() => getDoc(activityRef(fs("nonAutenticato"), "togli-annunciata")), "visitatore: get dopo togli");
    await expectDenied(() => getDoc(formRef(fs("nonAutenticato"), "togli-annunciata")), "visitatore: config/form dopo togli");
    const ids = await catalogIds(fs("nonAutenticato"));
    assert.ok(!ids.includes("togli-annunciata"), "visitatore: assente dal catalogo");
    assert.ok(ids.includes("togli-controllo"), "visitatore: il catalogo resta ammesso e mostra le pubbliche");
  });

  test("7. annunciata con un iscritto già presente: il titolare legge e annulla; nessuno crea di nuove", async () => {
    await putOpen("con-iscritto");
    await adminDb.doc(fx.regPath("con-iscritto", registrationId.user("iscritto"))).set(userPayload("iscritto"));
    await remakeAnnounced(fs("admin"), "con-iscritto");
    assert.equal((await stored(activityPath("con-iscritto"))).status, "planned");

    const snapshot = await getDoc(activityRef(fs("iscritto"), "con-iscritto"));
    assert.equal(snapshot.exists(), true, "titolare: get dell'annunciata (isPublicActivityDoc / hasOwnRegistration)");

    const ref = doc(fs("iscritto"), fx.regPath("con-iscritto", registrationId.user("iscritto")));
    await updateDoc(ref, { registrationStatus: "cancelled", updatedAt: nowIso() });
    assert.equal((await stored(fx.regPath("con-iscritto", registrationId.user("iscritto")))).registrationStatus, "cancelled");

    const newUser = registrationId.user("utente");
    await expectDenied(
      () => setDoc(doc(fs("utente"), fx.regPath("con-iscritto", newUser)), userPayload("utente")),
      "user_ nuova su annunciata con iscritto",
    );
    await expectDenied(
      () => setDoc(doc(guestDb, fx.regPath("con-iscritto", registrationId.guest())), guestPayload()),
      "guest_ nuova su annunciata con iscritto",
    );
    await expectDenied(
      () => setDoc(doc(fs("genitore"), fx.regPath("con-iscritto", registrationId.child())), childPayload()),
      "child_ nuova su annunciata con iscritto",
    );
    assert.equal((await adminDb.doc(fx.regPath("con-iscritto", newUser)).get()).exists, false);
    assert.equal((await adminDb.doc(fx.regPath("con-iscritto", registrationId.guest())).get()).exists, false);
    assert.equal((await adminDb.doc(fx.regPath("con-iscritto", registrationId.child())).get()).exists, false);
  });

  test("8. Elimina della rapida: ammessa all'admin del palo; negata a partecipante e admin di un altro palo", async () => {
    await createAnnounced(fs("admin"), "elimina-ok", uid("admin"));
    const created = await stored(activityPath("elimina-ok"));
    await deleteAnnounced(fs("admin"), "elimina-ok", created.updatedAt);
    assert.equal((await adminDb.doc(activityPath("elimina-ok")).get()).exists, false);
    assert.equal((await adminDb.doc(formPath("elimina-ok")).get()).exists, false);
    assert.deepEqual(await formFieldMap("elimina-ok"), {});

    await createAnnounced(fs("admin"), "elimina-utente", uid("admin"));
    await createAnnounced(fs("admin"), "elimina-altro-palo", uid("admin"));
    const beforeUser = await stored(activityPath("elimina-utente"));
    const beforeUserForm = await stored(formPath("elimina-utente"));
    const beforeUserFields = await formFieldMap("elimina-utente");
    const beforeOther = await stored(activityPath("elimina-altro-palo"));
    const beforeOtherForm = await stored(formPath("elimina-altro-palo"));
    const beforeOtherFields = await formFieldMap("elimina-altro-palo");

    await expectDenied(
      () => deleteAnnounced(fs("utente"), "elimina-utente", beforeUser.updatedAt),
      "partecipante: elimina della rapida",
    );
    await expectDenied(
      () => deleteAnnounced(fs("adminAltroPalo"), "elimina-altro-palo", beforeOther.updatedAt),
      "admin di un altro palo: elimina della rapida",
    );

    assert.deepEqual(await stored(activityPath("elimina-utente")), beforeUser);
    assert.deepEqual(await stored(formPath("elimina-utente")), beforeUserForm);
    assert.deepEqual(await formFieldMap("elimina-utente"), beforeUserFields);
    assert.deepEqual(await stored(activityPath("elimina-altro-palo")), beforeOther);
    assert.deepEqual(await stored(formPath("elimina-altro-palo")), beforeOtherForm);
    assert.deepEqual(await formFieldMap("elimina-altro-palo"), beforeOtherFields);
  });
});
