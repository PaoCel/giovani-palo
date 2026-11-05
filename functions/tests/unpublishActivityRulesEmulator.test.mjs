// Contratto di «Togli dal catalogo» (docs/ATTIVITA_MODULARI.md, «Contratto di
// «Togli dal catalogo», prima del codice»): le rules NON cambiano, questo test
// prova che quelle esistenti fanno ciò che dice la tabella del documento.
//
// Chiamate come il client (SDK client, utenti veri con token mock dell'emulatore;
// l'Admin SDK serve solo per seminare e rileggere, perché ignora le rules):
// - togli dal catalogo (futuro eventsService.unpublishEvent): runTransaction con
//   get dell'attività e, se è pubblica, update { status: "draft", isPublic: false,
//   isVisible: false, updatedAt };
// - ripubblica (publishEvent): transazione get + update { status:
//   "registrations_open", isPublic: true, isVisible: true, updatedAt };
// - catalogo (listPublicEventsUncached): where isPublic == true e isVisible == true
//   sulle attività del palo; elenco admin: tutta la collection; lettura diretta:
//   getDoc; Famiglia: collectionGroup "registrations" con where parentUid == uid;
// - annullamento del titolare: updateDoc(reg, { registrationStatus: "cancelled",
//   updatedAt }) (parentCancelRulesEmulator).
// Fixture e iscrizioni con la forma vera da functions/tests/helpers/adminRegistrationFixtures.mjs.
// La creazione di un'iscrizione nuova usa lo STESSO payload prima (attività
// pubblica: ammessa), dopo il «togli» (negata) e dopo la ripubblicazione
// (ammessa di nuovo): a negare è il cancello della pubblicazione, non il payload.
//
// Rilancio dalla radice del repository (solo Firestore, porta 8180):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --only firestore --config firebase.room-test.json --project demo-unpublish \
//     'node --test --test-concurrency=1 functions/tests/unpublishActivityRulesEmulator.test.mjs'
// Con le porte occupate da un'altra sessione non fermarla: copia la config su
// porte diverse (Firestore, hub, logging, websocket) in un file temporaneo e
// rimuovilo a fine prova; il test legge l'host da FIRESTORE_EMULATOR_HOST.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { deleteApp, initializeApp } from "firebase/app";
import {
  collection,
  collectionGroup,
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
} from "firebase/firestore";

import { CHILD_ID, createFixtures, nowIso } from "./helpers/adminRegistrationFixtures.mjs";

const fx = createFixtures("togli-catalogo");
const { stakeId, uid, adminDb, fs, expectDenied, stored } = fx;

// Attori in più rispetto alle fixture: chi è iscritto con user_ e un partecipante estraneo.
fx.ACTORS.iscritto = { name: "iscritto", profile: { role: "participant", stakeId } };
fx.ACTORS.estraneo = { name: "estraneo", profile: { role: "participant", stakeId } };

let guestApp = null;
let guestDb = null;

const activityPath = (activityId) => `stakes/${stakeId}/activities/${activityId}`;
const activityRef = (db, activityId) => doc(db, activityPath(activityId));
const registrationId = {
  user: () => `user_${uid("iscritto")}`,
  child: () => `child_${uid("genitore")}_${CHILD_ID}`,
};

/** Togli dal catalogo, come la transazione di unpublishEvent. */
function unpublish(db, activityId) {
  const ref = activityRef(db, activityId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.data().isPublic) return;
    transaction.update(ref, { status: "draft", isPublic: false, isVisible: false, updatedAt: nowIso() });
  });
}

/** Ripubblica, come publishEvent. */
function republish(db, activityId) {
  const ref = activityRef(db, activityId);
  return runTransaction(db, async (transaction) => {
    await transaction.get(ref);
    transaction.update(ref, { status: "registrations_open", isPublic: true, isVisible: true, updatedAt: nowIso() });
  });
}

const catalogIds = async (db) =>
  (
    await getDocs(
      query(collection(db, `stakes/${stakeId}/activities`), where("isPublic", "==", true), where("isVisible", "==", true)),
    )
  ).docs.map((item) => item.id);
const listAllIds = async (db) => (await getDocs(collection(db, `stakes/${stakeId}/activities`))).docs.map((item) => item.id);
const familyRegistrations = async (db, parentUid) =>
  (await getDocs(query(collectionGroup(db, "registrations"), where("parentUid", "==", parentUid)))).docs.map((item) => item.id);

let target; // attività con le due iscrizioni, poi tolta dal catalogo
let control; // attività che resta pubblica (prova che la query del catalogo restituisce qualcosa)

before(async () => {
  await fx.setup();
  // Ospite anonimo (sign_in_provider anonymous): la fixture usa sempre "password".
  guestApp = initializeApp({ apiKey: "demo-key", projectId: fx.PROJECT }, `ospite-${fx.runId}`);
  guestDb = getFirestore(guestApp);
  const [host, port] = fx.FIRESTORE_HOST.split(":");
  connectFirestoreEmulator(guestDb, host, Number(port), {
    mockUserToken: { sub: uid("ospite"), firebase: { sign_in_provider: "anonymous" } },
  });

  target = await fx.seedActivity({ requires: true });
  control = await fx.seedActivity({ requires: false });
  await adminDb
    .doc(fx.regPath(target, registrationId.user()))
    .set(fx.accountRegistration(uid("iscritto"), "light"));
  await adminDb
    .doc(fx.regPath(target, registrationId.child()))
    .set(fx.childRegistration(uid("genitore"), registrationId.child(), "pending"));
});

after(async () => {
  try {
    if (guestApp) await deleteApp(guestApp);
  } finally {
    await fx.teardown();
  }
});

describe("Togli dal catalogo: le rules esistenti reggono il contratto", () => {
  test("1. admin: toglie dal catalogo, legge, elenca, ripubblica", async () => {
    await unpublish(fs("admin"), target);
    const afterUnpublish = await stored(activityPath(target));
    assert.equal(afterUnpublish.isPublic, false);
    assert.equal(afterUnpublish.isVisible, false);
    assert.equal(afterUnpublish.status, "draft");

    const snapshot = await getDoc(activityRef(fs("admin"), target));
    assert.equal(snapshot.exists(), true, "l'admin legge la bozza");
    const all = await listAllIds(fs("admin"));
    assert.ok(all.includes(target) && all.includes(control), "l'elenco admin la mostra come bozza, insieme alle altre");

    // Doppio tocco: già non pubblica, la transazione non scrive.
    const revision = afterUnpublish.updatedAt;
    await unpublish(fs("admin"), target);
    assert.equal((await stored(activityPath(target))).updatedAt, revision, "secondo «togli» innocuo");

    await republish(fs("admin"), target);
    const back = await stored(activityPath(target));
    assert.equal(back.isPublic, true);
    assert.equal(back.isVisible, true);
    assert.equal(back.status, "registrations_open");

    await unpublish(fs("admin"), target); // di nuovo bozza per i casi seguenti
    assert.equal((await stored(activityPath(target))).isPublic, false);
  });

  test("2. dirigente di unità del palo: legge ed elenca la bozza", async () => {
    assert.equal((await getDoc(activityRef(fs("dirigente"), target))).exists(), true);
    const all = await listAllIds(fs("dirigente"));
    assert.ok(all.includes(target), "il dirigente la vede in elenco (isUnitLeaderOfStake)");
  });

  test("3. visitatore, ospite anonimo, partecipante estraneo: get negato, assente dal catalogo", async () => {
    for (const [label, db] of [
      ["non autenticato", fs("nonAutenticato")],
      ["ospite anonimo", guestDb],
      ["partecipante estraneo", fs("estraneo")],
    ]) {
      await expectDenied(() => getDoc(activityRef(db, target)), `${label}: get della bozza`);
      const ids = await catalogIds(db);
      assert.ok(!ids.includes(target), `${label}: la bozza non è nel catalogo`);
      assert.ok(ids.includes(control), `${label}: la query del catalogo è ammessa e restituisce le pubbliche`);
    }
  });

  test("4. iscritto con user_: get ammesso, assente dal catalogo", async () => {
    const snapshot = await getDoc(activityRef(fs("iscritto"), target));
    assert.equal(snapshot.exists(), true, "hasOwnRegistration lo ammette");
    assert.equal(snapshot.data().isPublic, false);
    const ids = await catalogIds(fs("iscritto"));
    assert.ok(!ids.includes(target));
    assert.ok(ids.includes(control));
  });

  test("5. genitore con iscrizione child_: attività negata, iscrizioni lette come prima", async () => {
    await expectDenied(() => getDoc(activityRef(fs("genitore"), target)), "genitore: get della bozza");
    const ids = await catalogIds(fs("genitore"));
    assert.ok(!ids.includes(target));
    const registrations = await familyRegistrations(fs("genitore"), uid("genitore"));
    assert.ok(registrations.includes(registrationId.child()), "la query di Famiglia (parentUid) restituisce l'iscrizione");
  });

  test("6. nessun non-admin può togliere o ripubblicare", async () => {
    const before = await stored(activityPath(target));
    // Chi può leggere la bozza arriva fino all'update della transazione: negato lì.
    await expectDenied(() => republish(fs("iscritto"), target), "iscritto: ripubblica (transazione)");
    await expectDenied(() => republish(fs("dirigente"), target), "dirigente: ripubblica (transazione)");
    for (const actor of ["iscritto", "estraneo", "genitore", "dirigente", "adminAltroPalo", "nonAutenticato"]) {
      await expectDenied(
        () =>
          updateDoc(activityRef(fs(actor), target), {
            status: "registrations_open",
            isPublic: true,
            isVisible: true,
            updatedAt: nowIso(),
          }),
        `${actor}: ripubblica con updateDoc`,
      );
    }
    await expectDenied(() => updateDoc(activityRef(guestDb, target), { isPublic: true }), "ospite: ripubblica");
    assert.deepEqual(await stored(activityPath(target)), before, "i rifiuti non cambiano l'attività");

    // E su un'attività pubblica nessuno di loro può toglierla.
    const publicBefore = await stored(activityPath(control));
    await expectDenied(() => unpublish(fs("iscritto"), control), "iscritto: toglie (transazione, get della pubblica ammesso)");
    await expectDenied(() => unpublish(fs("estraneo"), control), "estraneo: toglie (transazione, get della pubblica ammesso)");
    await expectDenied(() => unpublish(fs("dirigente"), control), "dirigente: toglie (transazione)");
    assert.deepEqual(await stored(activityPath(control)), publicBefore);
  });

  test("7. iscrizione nuova: stesso payload ammesso se pubblica, negato da bozza, ammesso dopo la ripubblicazione", async () => {
    const activityId = await fx.seedActivity({ requires: false });
    const newId = `user_${uid("estraneo")}`;
    const payload = fx.accountRegistration(uid("estraneo"), "light");
    const ref = doc(fs("estraneo"), fx.regPath(activityId, newId));

    // Controllo: su un'attività gemella sempre pubblica lo stesso payload passa.
    const twin = await fx.seedActivity({ requires: false });
    await setDoc(doc(fs("estraneo"), fx.regPath(twin, newId)), payload);
    assert.equal((await stored(fx.regPath(twin, newId))).registrationStatus, "active", "payload valido sull'attività pubblica");

    await unpublish(fs("admin"), activityId);
    await expectDenied(() => setDoc(ref, payload), "iscrizione nuova su bozza");
    assert.equal((await adminDb.doc(fx.regPath(activityId, newId)).get()).exists, false, "nessun documento creato");

    await republish(fs("admin"), activityId);
    await setDoc(ref, payload);
    assert.equal((await stored(fx.regPath(activityId, newId))).registrationStatus, "active", "ripubblicata: lo stesso payload passa");
  });

  test("8. titolare: annullamento dell'iscrizione esistente ammesso mentre l'attività è bozza", async () => {
    assert.equal((await stored(activityPath(target))).isPublic, false, "precondizione: bozza");
    const ref = doc(fs("iscritto"), fx.regPath(target, registrationId.user()));
    await updateDoc(ref, { registrationStatus: "cancelled", updatedAt: nowIso() });
    assert.equal((await stored(fx.regPath(target, registrationId.user()))).registrationStatus, "cancelled");

    // Anche il genitore annulla l'iscrizione del figlio (ramo child_, stessa rule).
    const childRef = doc(fs("genitore"), fx.regPath(target, registrationId.child()));
    await updateDoc(childRef, { registrationStatus: "cancelled", updatedAt: nowIso() });
    assert.equal((await stored(fx.regPath(target, registrationId.child()))).registrationStatus, "cancelled");
  });
});
