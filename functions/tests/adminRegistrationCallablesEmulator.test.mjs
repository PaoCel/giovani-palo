// Callable del genitore e dell'admin dopo una correzione dei dati
// (docs/ADMIN_ISCRITTI.md, scelta F; functions/lib/parentAuthorization.js):
//   - parentAuthorizationIssueOwnToken ("Autorizza ora") rifiuta un'iscrizione
//     non in attesa (NOT_AWAITING_MESSAGE): dopo una correzione che la rende
//     attiva un link nuovo farebbe firmare un adulto;
//   - parentAuthorizationResend (reinvio dell'admin) rifiuta se l'autorizzazione
//     non serve più (NOT_NEEDED_MESSAGE): né in attesa né meno di 18 anni in
//     un'attività con requiresParentAuthorization;
//   - dopo la correzione della data (minorenne → adulto, via rules e trigger
//     veri) il link del genitore risulta invalidato e la firma/rifiuto è negata;
//   - parentAuthorizationReject e parentAuthorizationConfirm su un'iscrizione
//     che non è più in attesa ma ha ancora un link valido (la finestra fra la
//     scrittura dell'admin e il trigger, o un trigger fallito): negati con
//     NOT_NEEDED_MESSAGE se l'autorizzazione non serve più (18 anni o più, o
//     attività che non la chiede), consentiti per un minorenne attivo in
//     un'attività che la chiede (reinvio dell'admin).
// Callable vere (SDK client → Functions emulator) con utenti dell'Auth emulator;
// le correzioni dell'admin passano dalle rules con le chiamate del client.
//
// Rilancio dalla radice del repository (Auth, Firestore e Functions emulati;
// functions/.secret.local con BREVO_API_KEY= e WEB_PUSH_PRIVATE_KEY= vuoti):
//   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
//   firebase emulators:exec --only auth,firestore,functions --config firebase.room-test.json --project demo-admin-callables \
//     'node --test --test-concurrency=1 functions/tests/adminRegistrationCallablesEmulator.test.mjs'
// Le mail sono simulate (nessuna EMAIL_ALLOWLIST negli emulatori).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";

import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

import { buildAdminEditPatch, personDraftFromRegistration, planAdminEdit } from "../../src/utils/adminRegistration.ts";
import { ADULT, CHILD_ID, createFixtures, nowIso } from "./helpers/adminRegistrationFixtures.mjs";

const require = createRequire(import.meta.url);
const { FieldValue } = require("firebase-admin/firestore");
const { PNG } = require("pngjs");
const { PARENT_CONSENT_CHECKBOXES } = require("../lib/legalDocs.js");

const F = createFixtures("admin-callables");
const { adminDb, stakeId, clientOps, regPath, stored, uid, PROJECT } = F;

const hostOf = (value, label) => {
  assert.match(value || "", /^(127\.0\.0\.1|localhost):\d+$/u, `${label}: emulatore locale richiesto`);
  const [host, port] = value.split(":");
  return { host, port: Number(port) };
};
const AUTH = hostOf(process.env.FIREBASE_AUTH_EMULATOR_HOST, "Auth");

async function functionsHost() {
  if (process.env.FUNCTIONS_EMULATOR_HOST) return hostOf(process.env.FUNCTIONS_EMULATOR_HOST, "Functions");
  const hub = process.env.FIREBASE_EMULATOR_HUB;
  if (hub) {
    const { host, port } = hostOf(hub, "Hub");
    const list = await (await fetch(`http://${host}:${port}/emulators`)).json();
    if (list.functions) return hostOf(`${list.functions.host}:${list.functions.port}`, "Functions");
  }
  return { host: "127.0.0.1", port: 5101 };
}
const FUNCTIONS = await functionsHost();

const PASSWORD = `Pw-${F.runId}-callables!`; // credenziale di test, vale solo nell'emulatore
const NOT_AWAITING_MESSAGE = "L'iscrizione non è in attesa dell'autorizzazione del genitore.";
const NOT_NEEDED_MESSAGE =
  "Per questa iscrizione l'autorizzazione del genitore non serve: ha 18 anni o più, o l'attività non la chiede.";
const ALREADY_AUTHORIZED_MESSAGE = "L'autorizzazione è già stata firmata.";

const hashToken = (raw) => createHash("sha256").update(raw, "utf8").digest("hex");
const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const apps = [];
async function makeClient(name, { signIn = true } = {}) {
  const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT }, `${name}-${F.runId}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH.host}:${AUTH.port}`, { disableWarnings: true });
  if (signIn) await createUserWithEmailAndPassword(auth, `${name}-${F.runId}@example.invalid`, PASSWORD);
  const functions = getFunctions(app, "europe-west1");
  connectFunctionsEmulator(functions, FUNCTIONS.host, FUNCTIONS.port);
  return {
    uid: auth.currentUser?.uid ?? null,
    call: async (callable, data) => (await httpsCallable(functions, callable)(data)).data,
  };
}

async function expectCallError(promise, code, message) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, `functions/${code}`, `${error?.code}: ${error?.message}`);
    if (message !== undefined) assert.equal(error.message, message);
    return true;
  });
}

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

const who = {};
before(async () => {
  await F.setup();
  const [genitore, admin, anonimo] = await Promise.all([
    makeClient("genitore-cb"),
    makeClient("admin-cb"),
    makeClient("pagina-pubblica-cb", { signIn: false }),
  ]);
  Object.assign(who, { genitore, admin, anonimo });
  await Promise.all([
    adminDb.doc(`users/${genitore.uid}`).set({ role: "parent", stakeId, fullName: "Genitore Test" }),
    adminDb.doc(`users/${admin.uid}`).set({ role: "admin", stakeId, fullName: "Admin Test" }),
  ]);
});
after(async () => {
  try {
    const leftovers = await adminDb.collection("parentAuthorizationTokens").where("stakeId", "==", stakeId).get();
    await Promise.all(leftovers.docs.map((item) => item.ref.delete()));
    await Promise.all([who.genitore, who.admin].map((client) => client && adminDb.doc(`users/${client.uid}`).delete()));
    await F.teardown();
  } finally {
    await Promise.all(apps.map((app) => deleteApp(app)));
  }
});

// ---------------------------------------------------------------------------
// Semina
// ---------------------------------------------------------------------------

const tokensOf = async (activityId, registrationId) => {
  const snapshot = await adminDb.collection("parentAuthorizationTokens").where("stakeId", "==", stakeId).get();
  return snapshot.docs.map((item) => item.data()).filter((token) => token.activityId === activityId && token.registrationId === registrationId);
};
const auditEvents = async (activityId, registrationId) => {
  const snapshot = await adminDb.collection(`stakes/${stakeId}/activities/${activityId}/consentAuditLogs`).get();
  return snapshot.docs.map((item) => item.data()).filter((row) => row.registrationId === registrationId).map((row) => row.event);
};

async function seedToken(activityId, registrationId, status = "pending") {
  const rawToken = randomBytes(32).toString("hex");
  const hash = hashToken(rawToken);
  await adminDb.doc(`parentAuthorizationTokens/${hash}`).set({
    id: hash,
    tokenHash: hash,
    stakeId,
    activityId,
    registrationId,
    parentEmail: "genitore@example.invalid",
    participantName: "Figlio Test",
    activityTitle: "Attività di prova",
    activityStartDate: "2026-11-13T14:00:00.000Z",
    activityEndDate: "2026-11-17T16:00:00.000Z",
    status,
    createdAt: "2026-10-01T08:00:00.000Z",
    expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    usedAt: null,
    invalidatedAt: status === "invalidated" ? nowIso() : null,
    createdByUserId: null,
    createdByMode: "system",
  });
  return { rawToken, hash };
}

/**
 * Iscrizione figlio del genitore dell'Auth emulator, con link vivo annotato.
 * `overrides` per stato, data di nascita e autorizzazione.
 */
async function seedChild({ requires = true, overrides = {}, token = "pending" } = {}) {
  const activityId = await F.seedActivity({ requires });
  const registrationId = `child_${who.genitore.uid}_${CHILD_ID}`;
  const seeded = token ? await seedToken(activityId, registrationId, token) : { rawToken: null, hash: null };
  const base = F.childRegistration(who.genitore.uid, registrationId, "pending");
  await adminDb.doc(regPath(activityId, registrationId)).set({
    ...base,
    parentAuthorization: seeded.hash ? { ...base.parentAuthorization, tokenId: seeded.hash } : base.parentAuthorization,
    ...overrides,
  });
  return { activityId, registrationId, id: registrationId, ...seeded };
}

const ADULT_FIELDS = { birthDate: ADULT, registrationStatus: "active" };

// ===========================================================================
// 1. "Autorizza ora" (parentAuthorizationIssueOwnToken)
// ===========================================================================

describe("1. 'Autorizza ora' solo per un'iscrizione in attesa", () => {
  const issue = (ctx) => who.genitore.call("parentAuthorizationIssueOwnToken", { stakeId, activityId: ctx.activityId, registrationId: ctx.registrationId });

  test("in attesa: il genitore ottiene un link a vita breve, uno solo vivo", async () => {
    const ctx = await seedChild();
    const result = await issue(ctx);
    assert.ok(result.token, "link restituito");
    const live = (await tokensOf(ctx.activityId, ctx.registrationId)).filter((token) => token.status === "pending");
    assert.equal(live.length, 1, "un solo link vivo");
    assert.equal(live[0].id, hashToken(result.token));
  });

  test("attiva (correzione della data in adulto): negato con il messaggio, nessun link nuovo", async () => {
    const ctx = await seedChild({ overrides: ADULT_FIELDS, token: "invalidated" });
    const before = await tokensOf(ctx.activityId, ctx.registrationId);
    await expectCallError(issue(ctx), "failed-precondition", NOT_AWAITING_MESSAGE);
    assert.equal((await tokensOf(ctx.activityId, ctx.registrationId)).length, before.length, "nessun token nuovo");
  });

  test("attiva minorenne (iscritto prima che l'attività chiedesse l'autorizzazione): negato", async () => {
    const ctx = await seedChild({ overrides: { registrationStatus: "active" }, token: null });
    await expectCallError(issue(ctx), "failed-precondition", NOT_AWAITING_MESSAGE);
  });

  test("rifiutata dal genitore: negato (la riapre l'admin con Riattiva)", async () => {
    const ctx = await seedChild({ overrides: { registrationStatus: "rejected_by_parent" }, token: "used" });
    await expectCallError(issue(ctx), "failed-precondition", NOT_AWAITING_MESSAGE);
  });

  test("già firmata (confirmed): resta il messaggio della firma, non quello dell'attesa", async () => {
    const base = F.childRegistration(who.genitore.uid, `child_${who.genitore.uid}_${CHILD_ID}`, "signed");
    const ctx = await seedChild({ overrides: { ...base, parentAuthorization: { ...base.parentAuthorization } }, token: "used" });
    await expectCallError(issue(ctx), "failed-precondition", ALREADY_AUTHORIZED_MESSAGE);
  });

  test("annullata: resta il messaggio dell'annullamento", async () => {
    const ctx = await seedChild({ overrides: { registrationStatus: "cancelled" } });
    await expectCallError(issue(ctx), "failed-precondition", "L'iscrizione è annullata.");
  });

  test("un altro genitore non ottiene il link (resta permission-denied)", async () => {
    const other = await makeClient("altro-genitore-cb");
    const ctx = await seedChild();
    await expectCallError(
      other.call("parentAuthorizationIssueOwnToken", { stakeId, activityId: ctx.activityId, registrationId: ctx.registrationId }),
      "permission-denied",
    );
  });
});

// ===========================================================================
// 2. Reinvio dell'admin (parentAuthorizationResend)
// ===========================================================================

describe("2. reinvio dell'admin solo se l'autorizzazione serve ancora", () => {
  const resend = (ctx) => who.admin.call("parentAuthorizationResend", { stakeId, activityId: ctx.activityId, registrationId: ctx.registrationId });
  const live = async (ctx) => (await tokensOf(ctx.activityId, ctx.registrationId)).filter((token) => token.status === "pending");

  test("in attesa: il reinvio sostituisce il link, uno solo vivo, una mail", async () => {
    const ctx = await seedChild();
    const result = await resend(ctx);
    assert.equal(result.ok, true);
    const alive = await live(ctx);
    assert.equal(alive.length, 1);
    assert.notEqual(alive[0].id, ctx.hash);
    assert.equal((await tokensOf(ctx.activityId, ctx.registrationId)).find((token) => token.id === ctx.hash).status, "invalidated");
  });

  test("adulto attivo (data corretta), link vecchio ancora annotato: negato, nessun link né mail", async () => {
    const ctx = await seedChild({ overrides: ADULT_FIELDS, token: "invalidated" });
    const before = (await auditEvents(ctx.activityId, ctx.registrationId)).length;
    await expectCallError(resend(ctx), "failed-precondition", NOT_NEEDED_MESSAGE);
    assert.equal((await live(ctx)).length, 0);
    assert.equal((await auditEvents(ctx.activityId, ctx.registrationId)).length, before);
  });

  test("minorenne attivo in un'attività che chiede l'autorizzazione (iscritto prima): consentito", async () => {
    const ctx = await seedChild({ overrides: { registrationStatus: "active" }, token: null });
    const result = await resend(ctx);
    assert.equal(result.ok, true);
    assert.equal((await live(ctx)).length, 1);
  });

  test("minorenne attivo in un'attività che non chiede l'autorizzazione: negato", async () => {
    const ctx = await seedChild({ requires: false, overrides: { registrationStatus: "active" }, token: null });
    await expectCallError(resend(ctx), "failed-precondition", NOT_NEEDED_MESSAGE);
    assert.equal((await live(ctx)).length, 0);
  });

  test("adulto attivo in un'attività che chiede l'autorizzazione: negato", async () => {
    const ctx = await seedChild({ overrides: ADULT_FIELDS, token: null });
    await expectCallError(resend(ctx), "failed-precondition", NOT_NEEDED_MESSAGE);
  });

  test("attività senza il campo requiresParentAuthorization: un minorenne attivo non si reinvia", async () => {
    const ctx = await seedChild({ overrides: { registrationStatus: "active" }, token: null });
    await adminDb.doc(`stakes/${stakeId}/activities/${ctx.activityId}`).update({ requiresParentAuthorization: FieldValue.delete() });
    await expectCallError(resend(ctx), "failed-precondition", NOT_NEEDED_MESSAGE);
  });

  test("in attesa ma con la data di un adulto (prima che il trigger giri): consentito, è ancora in attesa", async () => {
    const ctx = await seedChild({ overrides: { birthDate: ADULT } });
    const result = await resend(ctx);
    assert.equal(result.ok, true);
  });

  test("già firmata: resta il messaggio della firma", async () => {
    const base = F.childRegistration(who.genitore.uid, `child_${who.genitore.uid}_${CHILD_ID}`, "signed");
    const ctx = await seedChild({ overrides: { ...base }, token: "used" });
    await expectCallError(resend(ctx), "failed-precondition", ALREADY_AUTHORIZED_MESSAGE);
  });

  test("chi non è admin né dirigente della stessa unità non reinvia", async () => {
    const ctx = await seedChild();
    await expectCallError(
      who.genitore.call("parentAuthorizationResend", { stakeId, activityId: ctx.activityId, registrationId: ctx.registrationId }),
      "permission-denied",
    );
  });
});

// ===========================================================================
// 3. Dopo la correzione della data: il link del genitore non vale più
// ===========================================================================

describe("3. link del genitore dopo una correzione minorenne → adulto", () => {
  /** "Modifica dati" dell'admin con le rules vere: data di nascita adulta, piano e chiavi di buildAdminEditPatch. */
  async function adminCorrectsToAdult(ctx) {
    const current = await stored(regPath(ctx.activityId, ctx.registrationId));
    const registration = { id: ctx.registrationId, ...current };
    const person = { ...personDraftFromRegistration(registration), birthDate: ADULT };
    const plan = planAdminEdit(registration, person, { firstName: "", lastName: "", email: "", phone: "" }, { requiresParentAuthorization: true, previousUnitName: current.unitNameSnapshot });
    assert.equal(plan.nextStatus, "active");
    await clientOps.update("admin", ctx.activityId, ctx.registrationId, buildAdminEditPatch({ registration, person, parent: { firstName: "", lastName: "", email: "", phone: "" }, plan, timestamp: nowIso() }));
  }

  test("il trigger invalida il link: GetContext dice invalidated, Reject è negata e l'iscrizione resta attiva", async () => {
    const ctx = await seedChild();
    assert.equal((await who.anonimo.call("parentAuthorizationGetContext", { token: ctx.rawToken })).status, "valid");
    await adminCorrectsToAdult(ctx);
    await waitFor(
      async () => (await tokensOf(ctx.activityId, ctx.registrationId)).find((token) => token.id === ctx.hash)?.status,
      (status) => status === "invalidated",
      "link invalidato dal trigger",
    );
    const context = await who.anonimo.call("parentAuthorizationGetContext", { token: ctx.rawToken });
    assert.equal(context.status, "invalidated");
    await expectCallError(who.anonimo.call("parentAuthorizationReject", { token: ctx.rawToken, reason: "prova" }), "failed-precondition");
    const registration = await stored(regPath(ctx.activityId, ctx.registrationId));
    assert.equal(registration.registrationStatus, "active");
    assert.notEqual(registration.parentAuthorization?.status, "rejected_by_parent");
  });

  /** Stato che l'admin ha scritto (attiva) un attimo prima del trigger: il link è ancora 'pending'. */
  async function activeWithLiveLink({ requires = true, overrides = {} } = {}) {
    const ctx = await seedChild({ requires, overrides: { registrationStatus: "active", ...overrides } });
    return ctx;
  }
  const reject = (ctx) => who.anonimo.call("parentAuthorizationReject", { token: ctx.rawToken, reason: "prova" });

  function signatureDataUrl() {
    const png = new PNG({ width: 160, height: 60 });
    for (let x = 10; x < 150; x += 1) {
      for (const y of [20 + Math.round(10 * Math.sin(x / 9)), 21 + Math.round(10 * Math.sin(x / 9))]) {
        const index = (png.width * y + x) << 2;
        png.data[index] = 10;
        png.data[index + 1] = 10;
        png.data[index + 2] = 40;
        png.data[index + 3] = 255;
      }
    }
    return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
  }
  const confirmPayload = (ctx) => ({
    token: ctx.rawToken,
    consents: Object.fromEntries(PARENT_CONSENT_CHECKBOXES.map((item) => [item.key, true])),
    photoConsent: "accepted",
    socialPublicationConsent: "refused",
    signatureDataUrl: signatureDataUrl(),
  });

  test("finestra prima del trigger: adulto attivo con il link ancora valido, il rifiuto è negato (NOT_NEEDED) e nulla cambia", async () => {
    const ctx = await activeWithLiveLink({ overrides: ADULT_FIELDS });
    const before = await stored(regPath(ctx.activityId, ctx.registrationId));
    await expectCallError(reject(ctx), "failed-precondition", NOT_NEEDED_MESSAGE);
    assert.deepEqual(await stored(regPath(ctx.activityId, ctx.registrationId)), before);
    assert.equal((await tokensOf(ctx.activityId, ctx.registrationId)).find((token) => token.id === ctx.hash).status, "pending");
  });

  test("finestra prima del trigger: adulto attivo con il link ancora valido, la firma è negata (NOT_NEEDED) e non scrive confirmed", async () => {
    const ctx = await activeWithLiveLink({ overrides: ADULT_FIELDS });
    await expectCallError(who.anonimo.call("parentAuthorizationConfirm", confirmPayload(ctx)), "failed-precondition", NOT_NEEDED_MESSAGE);
    const registration = await stored(regPath(ctx.activityId, ctx.registrationId));
    assert.equal(registration.registrationStatus, "active");
    assert.notEqual(registration.parentAuthorization?.status, "authorized");
  });

  test("minorenne attivo in un'attività che non chiede più l'autorizzazione, link ancora valido: rifiuto e firma negati", async () => {
    const ctx = await activeWithLiveLink({ requires: false });
    await expectCallError(reject(ctx), "failed-precondition", NOT_NEEDED_MESSAGE);
    await expectCallError(who.anonimo.call("parentAuthorizationConfirm", confirmPayload(ctx)), "failed-precondition", NOT_NEEDED_MESSAGE);
  });

  test("minorenne attivo in un'attività che la chiede (reinvio dell'admin): il rifiuto passa", async () => {
    const ctx = await activeWithLiveLink();
    assert.deepEqual(await reject(ctx), { ok: true });
  });

  test("in attesa con la data di un adulto (prima che il trigger giri): il rifiuto passa, è ancora in attesa", async () => {
    const ctx = await seedChild({ overrides: { birthDate: ADULT } });
    assert.deepEqual(await reject(ctx), { ok: true });
  });

  test("correzione ad adulto dell'admin e rifiuto/firma subito dopo (prima o dopo il trigger): mai un rifiuto o una firma scritti", async () => {
    for (let round = 1; round <= 3; round += 1) {
      const ctx = await seedChild();
      await adminCorrectsToAdult(ctx);
      // Senza aspettare il trigger: se il link vale ancora, la guardia sulla necessità lo ferma.
      await expectCallError(reject(ctx), "failed-precondition");
      await expectCallError(who.anonimo.call("parentAuthorizationConfirm", confirmPayload(ctx)), "failed-precondition");
      await waitFor(
        async () => (await tokensOf(ctx.activityId, ctx.registrationId)).find((token) => token.id === ctx.hash)?.status,
        (status) => status === "invalidated",
        `giro ${round}: link invalidato dal trigger`,
      );
      const registration = await stored(regPath(ctx.activityId, ctx.registrationId));
      assert.equal(registration.registrationStatus, "active", `giro ${round}`);
      assert.ok(!["authorized", "rejected_by_parent"].includes(registration.parentAuthorization?.status), `giro ${round}: ${registration.parentAuthorization?.status}`);
    }
  });

  test("Reject su un link valido e iscrizione in attesa: passa (controllo che il rifiuto di sempre funzioni)", async () => {
    const ctx = await seedChild();
    assert.deepEqual(await who.anonimo.call("parentAuthorizationReject", { token: ctx.rawToken, reason: "prova" }), { ok: true });
    assert.equal((await stored(regPath(ctx.activityId, ctx.registrationId))).registrationStatus, "rejected_by_parent");
  });
});
