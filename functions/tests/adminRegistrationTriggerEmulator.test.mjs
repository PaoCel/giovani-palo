// Trigger delle iscrizioni scritte dall'admin (docs/ADMIN_ISCRITTI.md, scelta F e I8):
//   - onRegistrationPendingParentAuth (functions/lib/parentAuthorization.js):
//     quando un'iscrizione esce da `pending_parent_authorization` senza firma e
//     senza essere annullata, i link pendenti diventano `invalidated`,
//     `parentAuthorization.tokenId` torna null e non parte nessuna mail; il
//     ritorno in attesa riparte come una reiscrizione (link e mail nuovi, un
//     solo link vivo). Firma, rifiuto e annullamento non invalidano nulla.
//   - sendAdminPushForNewRegistration (functions/index.js): una `manual_` non
//     scrive nessun avviso (`adminAlerts`), una `user_` sì.
//
// Le scritture dell'admin passano dall'SDK client e dalle rules vere, con le
// chiamate del client (buildManualRegistrationDoc, planAdminEdit +
// buildAdminEditPatch, buildRequestAuthorizationPatch, planAdminReactivate,
// adminSetRegistrationStatus); la firma e il rifiuto del genitore si simulano con
// l'Admin SDK (le callable stanno in parentConsentEmulator.test.mjs). Le mail
// sono simulate: fuori produzione partono solo verso EMAIL_ALLOWLIST, che negli
// emulatori non c'è; gli eventi `email_sent` dell'audit contano le mail.
//
// I casi dove il comportamento di oggi contraddice la spec sono `todo` con il motivo.
//
// Rilancio dalla radice del repository (Firestore e Functions emulati; le Functions
// vogliono functions/.secret.local con BREVO_API_KEY= e WEB_PUSH_PRIVATE_KEY= vuoti,
// altrimenti l'emulatore prova Secret Manager e il primo invio cade):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --only firestore,functions --config firebase.room-test.json --project demo-admin-trigger \
//     'node --test --test-concurrency=1 functions/tests/adminRegistrationTriggerEmulator.test.mjs'
// Con le porte occupate da un'altra sessione non fermarla: copia la config su
// porte diverse (Firestore, Functions, hub, logging, websocket) e rimuovila a
// fine prova. Sul Mac mini il lavoro gira lì (`mini`).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  buildAdminEditPatch,
  buildRequestAuthorizationPatch,
  personDraftFromRegistration,
  planAdminEdit,
  planAdminReactivate,
} from "../../src/utils/adminRegistration.ts";
import { ADULT, MINOR, createFixtures, nowIso } from "./helpers/adminRegistrationFixtures.mjs";

const F = createFixtures("admin-trigger");
const { adminDb, stakeId, clientOps, manualDoc, manualId, minorDraft, parentDraft, personDraft, regPath, stored, uid } = F;

before(async () => {
  await F.setup();
});
after(async () => {
  await F.teardown();
});

const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(read, predicate, label, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await pausa(250);
  }
  assert.fail(`${label}: condizione non raggiunta in ${timeoutMs} ms. Ultimo stato: ${JSON.stringify(last)}`);
}

// ---------------------------------------------------------------------------
// Letture
// ---------------------------------------------------------------------------

async function tokensOf(activityId, registrationId) {
  const snapshot = await adminDb.collection("parentAuthorizationTokens").where("stakeId", "==", stakeId).get();
  return snapshot.docs
    .map((item) => item.data())
    .filter((token) => token.activityId === activityId && token.registrationId === registrationId);
}

async function auditEvents(activityId, registrationId) {
  const snapshot = await adminDb.collection(`stakes/${stakeId}/activities/${activityId}/consentAuditLogs`).get();
  return snapshot.docs
    .map((item) => item.data())
    .filter((row) => row.registrationId === registrationId)
    .map((row) => row.event);
}
const count = (events, name) => events.filter((event) => event === name).length;

/**
 * Lo stato osservabile in un oggetto solo, così un fallimento mostra tutti i
 * numeri insieme: link vivi, se l'unico vivo è quello annotato sull'iscrizione,
 * link invalidati, mail partite (email_sent), invalidazioni registrate.
 */
async function esito(ctx) {
  const [tokens, events, registration] = await Promise.all([
    tokensOf(ctx.activityId, ctx.id),
    auditEvents(ctx.activityId, ctx.id),
    stored(regPath(ctx.activityId, ctx.id)),
  ]);
  const vivi = tokens.filter((token) => token.status === "pending");
  return {
    stato: registration?.registrationStatus,
    linkVivi: vivi.length,
    vivoAnnotato: vivi.length === 1 && vivi[0].id === registration?.parentAuthorization?.tokenId,
    tokenId: registration?.parentAuthorization?.tokenId ?? null,
    invalidati: tokens.filter((token) => token.status === "invalidated").length,
    usati: tokens.filter((token) => token.status === "used").length,
    mailInviate: count(events, "email_sent"),
    invalidazioni: count(events, "token_invalidated"),
    richieste: count(events, "authorization_requested"),
  };
}

/** Aspetta che i trigger si assestino: nessun cambiamento osservabile per `quietMs` di fila. */
async function settle(ctx, { quietMs = 3500, timeoutMs = 60_000 } = {}) {
  const photo = async () => {
    const [tokens, events, snapshot] = await Promise.all([
      tokensOf(ctx.activityId, ctx.id),
      auditEvents(ctx.activityId, ctx.id),
      adminDb.doc(regPath(ctx.activityId, ctx.id)).get(),
    ]);
    return JSON.stringify([tokens.map((token) => `${token.id}:${token.status}`).sort(), events.length, snapshot.updateTime?.toMillis() ?? null]);
  };
  const deadline = Date.now() + timeoutMs;
  let last = await photo();
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    await pausa(300);
    const current = await photo();
    if (current !== last) {
      last = current;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= quietMs) {
      return;
    }
  }
  assert.fail(`${ctx.id}: ancora in movimento dopo ${timeoutMs} ms`);
}

// ---------------------------------------------------------------------------
// Scritture del client admin
// ---------------------------------------------------------------------------

const NO_PARENT = { firstName: "", lastName: "", email: "", phone: "" };

/** "Modifica dati" come la fa il client: piano, poi chiavi di buildAdminEditPatch. */
async function adminEdit(ctx, personChanges, { parent = NO_PARENT, requires = true } = {}) {
  const current = await stored(regPath(ctx.activityId, ctx.id));
  const registration = { id: ctx.id, ...current };
  const person = { ...personDraftFromRegistration(registration), ...personChanges };
  const plan = planAdminEdit(registration, person, parent, { requiresParentAuthorization: requires, previousUnitName: current.unitNameSnapshot });
  const patch = buildAdminEditPatch({ registration, person, parent, plan, timestamp: nowIso() });
  await clientOps.update("admin", ctx.activityId, ctx.id, patch);
  return plan;
}

/** "Riattiva": lo stato che calcola planAdminReactivate, scritto come adminSetRegistrationStatus. */
async function adminReactivate(ctx, { requires = true } = {}) {
  const current = await stored(regPath(ctx.activityId, ctx.id));
  const plan = planAdminReactivate(current, requires);
  await clientOps.setStatus("admin", ctx.activityId, ctx.id, plan.status);
  return plan;
}

/** Aggiunge a mano un minorenne in attesa con l'email del genitore e aspetta il primo link e la prima mail. */
async function addPendingMinor({ requires = true } = {}) {
  const activityId = await F.seedActivity({ requires });
  const id = manualId();
  await clientOps.createManual("admin", activityId, id, manualDoc({ person: minorDraft(), parent: parentDraft(), requires }));
  const ctx = { activityId, id };
  await waitFor(
    () => esito(ctx),
    (state) => state.linkVivi === 1 && state.vivoAnnotato && state.mailInviate === 1,
    "primo link e prima mail",
  );
  await settle(ctx);
  return ctx;
}

// ===========================================================================
// 1. Uscita da "in attesa" senza firma: i link smettono di valere
// ===========================================================================

describe("1. uscita da 'in attesa' senza firma (scelta F)", () => {
  test("iscrizione a mano di un minorenne con l'email del genitore: un link vivo e una mail (base di confronto)", async () => {
    const ctx = await addPendingMinor();
    const state = await esito(ctx);
    assert.deepEqual(state, { ...state, stato: "pending_parent_authorization", linkVivi: 1, vivoAnnotato: true, invalidati: 0, mailInviate: 1, invalidazioni: 0, richieste: 1 });
  });

  test("correzione della data (minorenne → adulto): il link è invalidato, tokenId null, nessuna mail nuova", async () => {
    const ctx = await addPendingMinor();
    const before = await esito(ctx);
    const plan = await adminEdit(ctx, { birthDate: ADULT });
    assert.equal(plan.nextStatus, "active");

    await waitFor(() => esito(ctx), (state) => state.linkVivi === 0 && state.tokenId === null, "link invalidato e tokenId azzerato");
    await settle(ctx);
    const after = await esito(ctx);
    assert.deepEqual(after, { ...before, stato: "active", linkVivi: 0, vivoAnnotato: false, tokenId: null, invalidati: 1, invalidazioni: 1 }, JSON.stringify(after));
    const token = (await tokensOf(ctx.activityId, ctx.id))[0];
    assert.equal(token.status, "invalidated");
    assert.ok(token.invalidatedAt, "invalidatedAt scritto");
  });

  test("poi di nuovo minorenne in attesa (stesso indirizzo): parte un link nuovo, uno solo vivo, una mail in più", async () => {
    const ctx = await addPendingMinor();
    const first = (await tokensOf(ctx.activityId, ctx.id))[0];
    await adminEdit(ctx, { birthDate: ADULT });
    await waitFor(() => esito(ctx), (state) => state.linkVivi === 0 && state.tokenId === null, "link invalidato");
    await settle(ctx);

    // "Chiedi l'autorizzazione" / correzione dell'adulto diventato di nuovo minorenne.
    const plan = await adminEdit(ctx, { birthDate: MINOR }, { parent: parentDraft() });
    assert.equal(plan.nextStatus, "pending_parent_authorization");
    await waitFor(() => esito(ctx), (state) => state.linkVivi === 1 && state.vivoAnnotato && state.mailInviate === 2, "link nuovo e seconda mail");
    await settle(ctx);

    const after = await esito(ctx);
    assert.deepEqual(after, { ...after, stato: "pending_parent_authorization", linkVivi: 1, vivoAnnotato: true, invalidati: 1, mailInviate: 2, invalidazioni: 1, richieste: 2 }, JSON.stringify(after));
    const live = (await tokensOf(ctx.activityId, ctx.id)).find((token) => token.status === "pending");
    assert.notEqual(live.id, first.id, "il link nuovo non è quello vecchio");
    assert.equal((await tokensOf(ctx.activityId, ctx.id)).find((token) => token.id === first.id).status, "invalidated");
  });

  test("ritorno in attesa con un altro indirizzo digitato: la richiesta di prima resta e il link va all'indirizzo di prima", async () => {
    // Il piano (planAdminEdit) usa l'email della richiesta se c'è già: l'indirizzo
    // si cambia da 'Modifica email genitore', non da 'Modifica dati'.
    const ctx = await addPendingMinor();
    await adminEdit(ctx, { birthDate: ADULT });
    await waitFor(() => esito(ctx), (state) => state.linkVivi === 0 && state.tokenId === null, "link invalidato");
    await settle(ctx);
    const plan = await adminEdit(ctx, { birthDate: MINOR }, { parent: parentDraft({ email: "Altro.Genitore@Example.invalid" }) });
    assert.equal(plan.needsParentFields, false, "la richiesta c'è già");
    await waitFor(() => esito(ctx), (state) => state.linkVivi === 1 && state.vivoAnnotato && state.mailInviate === 2, "link nuovo");
    await settle(ctx);
    const live = (await tokensOf(ctx.activityId, ctx.id)).find((token) => token.status === "pending");
    assert.equal(live.parentEmail, "genitore@example.invalid");
  });

  test("l'attività non chiede più l'autorizzazione e l'admin porta la persona ad active (adminSetRegistrationStatus): link invalidato; poi di nuovo in attesa: link nuovo", async () => {
    const ctx = await addPendingMinor();
    await adminDb.doc(`stakes/${stakeId}/activities/${ctx.activityId}`).update({ requiresParentAuthorization: false });
    await clientOps.setStatus("admin", ctx.activityId, ctx.id, "active");
    await waitFor(() => esito(ctx), (state) => state.linkVivi === 0 && state.tokenId === null, "link invalidato");
    await settle(ctx);
    const afterActive = await esito(ctx);
    assert.deepEqual(afterActive, { ...afterActive, stato: "active", linkVivi: 0, tokenId: null, invalidati: 1, mailInviate: 1, invalidazioni: 1 }, JSON.stringify(afterActive));

    await adminDb.doc(`stakes/${stakeId}/activities/${ctx.activityId}`).update({ requiresParentAuthorization: true });
    await clientOps.setStatus("admin", ctx.activityId, ctx.id, "pending_parent_authorization");
    await waitFor(() => esito(ctx), (state) => state.linkVivi === 1 && state.vivoAnnotato && state.mailInviate === 2, "link nuovo");
    await settle(ctx);
    const afterBack = await esito(ctx);
    assert.deepEqual(afterBack, { ...afterBack, stato: "pending_parent_authorization", linkVivi: 1, vivoAnnotato: true, invalidati: 1, mailInviate: 2 }, JSON.stringify(afterBack));
  });

  test("ripensamento rapido (attiva e subito di nuovo in attesa, senza aspettare i trigger): un solo link vivo e annotato", async () => {
    for (let round = 1; round <= 3; round += 1) {
      const ctx = await addPendingMinor();
      await adminEdit(ctx, { birthDate: ADULT });
      await adminEdit(ctx, { birthDate: MINOR }, { parent: parentDraft() });
      await settle(ctx, { quietMs: 5000 });
      const state = await esito(ctx);
      assert.equal(state.stato, "pending_parent_authorization", `giro ${round}: ${JSON.stringify(state)}`);
      assert.equal(state.linkVivi, 1, `giro ${round}: un solo link vivo (${JSON.stringify(state)})`);
      assert.equal(state.vivoAnnotato, true, `giro ${round}: il link vivo è quello annotato (${JSON.stringify(state)})`);
    }
  });

  test("adulto che diventa minorenne senza l'email del genitore: in attesa, nessun link né mail; con 'Chiedi l'autorizzazione' parte il primo", async () => {
    const activityId = await F.seedActivity({ requires: true });
    const id = manualId();
    await clientOps.createManual("admin", activityId, id, manualDoc({ person: personDraft(), requires: true }));
    const ctx = { activityId, id };
    const plan = await adminEdit(ctx, { birthDate: MINOR });
    assert.equal(plan.nextStatus, "pending_parent_authorization");
    assert.equal(plan.needsParentFields, true);
    await settle(ctx);
    const waiting = await esito(ctx);
    assert.deepEqual(waiting, { ...waiting, stato: "pending_parent_authorization", linkVivi: 0, mailInviate: 0, richieste: 0 }, JSON.stringify(waiting));

    const current = await stored(regPath(activityId, id));
    await clientOps.update("admin", activityId, id, buildRequestAuthorizationPatch(current, parentDraft(), nowIso()));
    await waitFor(() => esito(ctx), (state) => state.linkVivi === 1 && state.vivoAnnotato && state.mailInviate === 1, "primo link dopo 'Chiedi l'autorizzazione'");
  });
});

// ===========================================================================
// 2. Firma, rifiuto e annullamento: nessuna invalidazione
// ===========================================================================

describe("2. firma, rifiuto e annullamento non invalidano i link", () => {
  const SIGNED = () => ({
    ...F.authorizedState("x", "x"),
  });

  /** Simula parentAuthorizationConfirm: `confirmed`, firma e (se richiesto) link usato, in una scrittura sola. */
  async function sign(ctx, { markTokenUsed }) {
    const registrationRef = adminDb.doc(regPath(ctx.activityId, ctx.id));
    const [token] = await tokensOf(ctx.activityId, ctx.id);
    const batch = adminDb.batch();
    batch.update(registrationRef, {
      registrationStatus: "confirmed",
      parentAuthorization: { ...SIGNED(), tokenId: token.id, parentEmail: token.parentEmail },
      parentConsentDocumentName: `modulo-consenso-${ctx.id}.pdf`,
      parentConsentDocumentPath: `parentAuthorizations/${stakeId}/${ctx.activityId}/${ctx.id}/consenso.pdf`,
      parentConsentUploadedAt: nowIso(),
      consentSignaturePath: `parentAuthorizations/${stakeId}/${ctx.activityId}/${ctx.id}/signature.png`,
      consentSignatureSetAt: nowIso(),
      updatedAt: nowIso(),
    });
    if (markTokenUsed) batch.update(adminDb.doc(`parentAuthorizationTokens/${token.id}`), { status: "used", usedAt: nowIso() });
    await batch.commit();
    return token;
  }

  test("firma del genitore (link usato, confirmed): nessuna invalidazione, tokenId e link com'erano", async () => {
    const ctx = await addPendingMinor();
    const before = await esito(ctx);
    const token = await sign(ctx, { markTokenUsed: true });
    await settle(ctx);
    const after = await esito(ctx);
    assert.deepEqual(after, { ...before, stato: "confirmed", linkVivi: 0, vivoAnnotato: false, usati: 1, tokenId: token.id }, JSON.stringify(after));
    assert.equal((await stored(regPath(ctx.activityId, ctx.id))).parentAuthorization.status, "authorized");
  });

  test("firma con il link ancora 'pending' sul documento (caso discriminante): il trigger non lo invalida, la firma vale", async () => {
    const ctx = await addPendingMinor();
    const before = await esito(ctx);
    const token = await sign(ctx, { markTokenUsed: false });
    await settle(ctx);
    const after = await esito(ctx);
    assert.equal(after.invalidazioni, before.invalidazioni, `nessun token_invalidated (${JSON.stringify(after)})`);
    assert.equal(after.invalidati, 0, JSON.stringify(after));
    assert.equal(after.tokenId, token.id);
    assert.equal((await tokensOf(ctx.activityId, ctx.id))[0].status, "pending");
    const registration = await stored(regPath(ctx.activityId, ctx.id));
    assert.equal(registration.registrationStatus, "confirmed");
    assert.equal(registration.parentAuthorization.status, "authorized");
  });

  test("rifiuto del genitore (rejected_by_parent): nessuna invalidazione, nessuna mail", async () => {
    const ctx = await addPendingMinor();
    const before = await esito(ctx);
    const [token] = await tokensOf(ctx.activityId, ctx.id);
    // Come parentAuthorizationReject: stato e autorizzazione nella stessa scrittura, link usato.
    const batch = adminDb.batch();
    batch.set(
      adminDb.doc(regPath(ctx.activityId, ctx.id)),
      { registrationStatus: "rejected_by_parent", parentAuthorization: { status: "rejected_by_parent", rejectedAt: nowIso(), updatedAt: nowIso() }, updatedAt: nowIso() },
      { merge: true },
    );
    await batch.commit();
    await settle(ctx);
    const after = await esito(ctx);
    assert.equal(after.invalidazioni, before.invalidazioni, JSON.stringify(after));
    assert.equal(after.mailInviate, before.mailInviate, JSON.stringify(after));
    assert.equal(after.stato, "rejected_by_parent");
    assert.equal(token.id, (await tokensOf(ctx.activityId, ctx.id))[0].id);
  });

  test("annullamento dell'admin (pending → cancelled): nessuna invalidazione, il link e tokenId restano", async () => {
    const ctx = await addPendingMinor();
    const before = await esito(ctx);
    await clientOps.setStatus("admin", ctx.activityId, ctx.id, "cancelled");
    await settle(ctx);
    const after = await esito(ctx);
    assert.deepEqual(after, { ...before, stato: "cancelled" }, JSON.stringify(after));
  });

  test("'Riattiva' di un minorenne senza firma (annullata → in attesa): il link vecchio è sostituito, uno solo vivo, una mail in più", async () => {
    const ctx = await addPendingMinor();
    const first = (await tokensOf(ctx.activityId, ctx.id))[0];
    await clientOps.setStatus("admin", ctx.activityId, ctx.id, "cancelled");
    await settle(ctx);
    const plan = await adminReactivate(ctx);
    assert.equal(plan.status, "pending_parent_authorization");
    assert.equal(plan.sendsMail, true);
    await waitFor(() => esito(ctx), (state) => state.linkVivi === 1 && state.vivoAnnotato && state.mailInviate === 2, "link nuovo dopo la riattivazione");
    await settle(ctx);
    const live = (await tokensOf(ctx.activityId, ctx.id)).find((token) => token.status === "pending");
    assert.notEqual(live.id, first.id);
    assert.equal((await tokensOf(ctx.activityId, ctx.id)).find((token) => token.id === first.id).status, "invalidated");
  });

  test("annullata, data corretta in adulto e riattivata (annullata → active): il link vecchio è invalidato", async () => {
    // Annulla, 'Modifica dati' (su un'annullata cambiano solo i dati) e 'Riattiva':
    // il link mandato prima dell'annullamento non deve restare valido per un adulto.
    const ctx = await addPendingMinor();
    await clientOps.setStatus("admin", ctx.activityId, ctx.id, "cancelled");
    await settle(ctx);
    const plan0 = await adminEdit(ctx, { birthDate: ADULT });
    assert.equal(plan0.nextStatus, "cancelled", "su un'annullata cambiano solo i dati");
    const plan = await adminReactivate(ctx);
    assert.equal(plan.status, "active");
    await waitFor(() => esito(ctx), (state) => state.stato === "active" && state.linkVivi === 0 && state.tokenId === null, "link invalidato dopo la riattivazione");
    await settle(ctx);
    const state = await esito(ctx);
    assert.deepEqual(state, { ...state, stato: "active", linkVivi: 0, vivoAnnotato: false, tokenId: null, invalidati: 1, mailInviate: 1, invalidazioni: 1 }, JSON.stringify(state));
  });

  test("annullata e riattivata in un'attività che non chiede più l'autorizzazione (annullata → active): il link vecchio è invalidato", async () => {
    const ctx = await addPendingMinor();
    await clientOps.setStatus("admin", ctx.activityId, ctx.id, "cancelled");
    await settle(ctx);
    await adminDb.doc(`stakes/${stakeId}/activities/${ctx.activityId}`).update({ requiresParentAuthorization: false });
    const plan = await adminReactivate(ctx, { requires: false });
    assert.equal(plan.status, "active");
    await waitFor(() => esito(ctx), (state) => state.stato === "active" && state.linkVivi === 0 && state.tokenId === null, "link invalidato");
  });

  test("annullata, firmata e riattivata (annullata → active con la firma): nessuna invalidazione, la firma resta", async () => {
    const ctx = await addPendingMinor();
    const token = await sign(ctx, { markTokenUsed: true });
    await settle(ctx);
    await clientOps.setStatus("admin", ctx.activityId, ctx.id, "cancelled");
    await settle(ctx);
    await adminReactivate(ctx);
    await settle(ctx);
    const state = await esito(ctx);
    assert.equal(state.stato, "active");
    assert.equal(state.invalidazioni, 0, JSON.stringify(state));
    assert.equal(state.tokenId, token.id);
    assert.equal((await stored(regPath(ctx.activityId, ctx.id))).parentAuthorization.status, "authorized");
  });
});

// ===========================================================================
// 3. Avviso "nuovo iscritto" agli admin (scelta I8)
// ===========================================================================

describe("3. avviso 'nuovo iscritto' agli admin", () => {
  const alertsOf = async (registrationId) => {
    const snapshot = await adminDb.collection(`stakes/${stakeId}/adminAlerts`).get();
    return snapshot.docs.map((item) => item.data()).filter((row) => row.registrationId === registrationId);
  };

  test("una iscrizione a mano non scrive nessun avviso; una user_ sì (con il suo testo)", async () => {
    const activityId = await F.seedActivity({ requires: true });
    const manualAdult = manualId();
    const manualMinor = manualId();
    await clientOps.createManual("admin", activityId, manualAdult, manualDoc({ person: personDraft(), requires: true }));
    await clientOps.createManual("admin", activityId, manualMinor, manualDoc({ person: minorDraft(), parent: parentDraft(), requires: true }));

    // Controllo positivo: l'iscrizione di un account (dal modulo, con le rules) scrive l'avviso.
    const userRegistration = `user_${uid("utente")}`;
    await adminDb.doc(`stakes/${stakeId}/activities/${activityId}`).update({ isPublic: true });
    await (await import("firebase/firestore")).setDoc(F.regRef("utente", activityId, userRegistration), {
      ...F.accountRegistration(uid("utente"), "light"),
      parentAuthorization: null,
    });
    const alerts = await waitFor(() => alertsOf(userRegistration), (rows) => rows.length === 1, "avviso della user_");
    assert.equal(alerts[0].type, "registration_created");
    assert.match(alerts[0].message, /si è iscritto a/u);

    // Il trigger della user_ ha girato: ai trigger delle a mano è stato dato lo stesso tempo.
    await pausa(4000);
    assert.deepEqual(await alertsOf(manualAdult), [], "nessun avviso per la a mano (adulto)");
    assert.deepEqual(await alertsOf(manualMinor), [], "nessun avviso per la a mano (minorenne in attesa)");
    const all = await adminDb.collection(`stakes/${stakeId}/adminAlerts`).get();
    assert.ok(!all.docs.some((item) => item.data().registrationId?.startsWith("manual_")), "nessun avviso con registrationId manual_");
  });
});
