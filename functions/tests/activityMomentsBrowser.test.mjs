// Independent runtime UI acceptance. Uses original components, real Auth,
// Functions and Firestore emulators. Only delayed/failed responses are injected.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { MOMENTI } from "../../src/copy/momenti.ts";
const projectId = process.env.GCLOUD_PROJECT || "";
assert.match(projectId, /^demo-[a-z0-9-]+$/);
for (const name of ["FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST"]) assert.match(process.env[name] || "", /^127\.0\.0\.1:[1-9]\d{0,4}$/);
const base = new URL(process.env.QA_BASE_URL || "http://invalid.invalid");
assert.equal(base.protocol, "http:"); assert.ok(["127.0.0.1", "localhost"].includes(base.hostname));
assert.ok(process.env.PLAYWRIGHT_MODULE, "PLAYWRIGHT_MODULE obbligatorio sul mini");
const require = createRequire(import.meta.url);
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { createMomentsAdminHandler } = require("../lib/activityMoments.js");
const app = initializeApp({ projectId }, `independent-browser-${randomUUID()}`);
const db = getFirestore(app), auth = getAuth(app), adminHandler = createMomentsAdminHandler({ db });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
// The harness page is fulfilled by Playwright, so Chromium treats it as non-loopback
// and Local Network Access would block the loopback emulators.
const browser = await chromium.launch({ args: ["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests"] });
const suffix = randomUUID().slice(0, 10), stakeId = `qa-moments-independent-browser-${suffix}`;
const activityIds = ["editor", "participation", "context-b"].map(name => `${name}-${suffix}`);
const password = "qa-moments-browser-only123";
const actors = {}, contexts = [];
const request = (who, data) => ({ auth: { uid: who.uid, token: { firebase: { sign_in_provider: "password" } } }, data: { stakeId, ...data } });
const activityRef = id => db.doc(`stakes/${stakeId}/activities/${id}`);
const future = new Date(Date.now() + 86400000).toISOString();
const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>t=>t;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module">
import React from '/node_modules/.vite/deps/react.js';
// Pre-bundled CJS deps expose a default export only when served outside Vite transforms.
import * as ReactDomClient from '/node_modules/.vite/deps/react-dom_client.js';
const createRoot = ReactDomClient.createRoot ?? ReactDomClient.default.createRoot;
import {auth,db,firebaseApp} from '/src/services/firebase/app.ts';
import {useLocalEmulators} from '/src/services/firebase/config.ts';
import {signInWithEmailAndPassword} from '/node_modules/.vite/deps/firebase_auth.js';
import {AuthProvider} from '/src/app/providers/AuthProvider.tsx';
import {useAuth} from '/src/hooks/useAuth.ts';
import {MomentsAdminTab} from '/src/components/admin/moments/MomentsAdminTab.tsx';
import {ActivityProgram} from '/src/components/activities/ActivityProgram.tsx';
import '/src/styles/base.css';
window.qaTarget=()=>[firebaseApp.options.projectId,useLocalEmulators,auth.emulatorConfig?.port,db._settings.host];
window.qaSignIn=(email,password)=>signInWithEmailAndPassword(auth,email,password);
let change; function Harness(){const {session}=useAuth();const [ctx,setCtx]=React.useState(null);change=setCtx;if(!session||!ctx)return React.createElement('p',null,'Preparazione QA');return React.createElement('main',{className:'page'},ctx.mode==='admin'?React.createElement(MomentsAdminTab,{key:session.firebaseUser.uid+'|'+ctx.activityId,stakeId:${JSON.stringify(stakeId)},activityId:ctx.activityId,startDate:${JSON.stringify(future)},activityDraft:false,onDirtyChange:v=>window.qaDirty=v,onPendingChange:v=>window.qaPending=v}):React.createElement(ActivityProgram,{stakeId:${JSON.stringify(stakeId)},activityId:ctx.activityId}));}
window.qaContext=ctx=>change(ctx);createRoot(document.getElementById('root')).render(React.createElement(AuthProvider,null,React.createElement(Harness)));window.qaReady=true;
</script></body></html>`;
async function seedMoment(activityId, title, capacity = 2) {
  const momentId = `moment-${randomUUID()}`;
  const saved = await adminHandler(request(actors.admin, { action: "save", activityId, momentId, requestId: randomUUID(), expectedRevision: null, fields: { type: "turni", title, startsAt: future, capacity } }));
  return (await adminHandler(request(actors.admin, { action: "publish", activityId, momentId, requestId: randomUUID(), expectedRevision: saved.moment.revision }))).moment;
}
async function pageFor(who, mode, activityId) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(context);
  await context.route("**/*", route => {
    const target = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(target.hostname) ? route.continue() : route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  await page.route(`${base.origin}/qa-independent-moments`, route => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto(`${base.origin}/qa-independent-moments`);
  await page.waitForFunction(() => window.qaReady === true);
  const target = await page.evaluate(() => window.qaTarget());
  assert.deepEqual(target, [projectId, true, Number(process.env.FIREBASE_AUTH_EMULATOR_HOST.split(":")[1]), process.env.FIRESTORE_EMULATOR_HOST]);
  await page.evaluate(({ email, password }) => window.qaSignIn(email, password).then(() => undefined), { email: who.email, password });
  await page.evaluate(ctx => window.qaContext(ctx), { mode, activityId });
  await page.getByRole("heading", { name: mode === "admin" ? MOMENTI.programma : MOMENTI.ilProgramma, exact: true }).waitFor();
  return page;
}
async function assertVisibleBounds(locator, page) {
  const box = await locator.boundingBox(), viewport = page.viewportSize();
  assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, "azione/errore deve essere nella porzione visibile");
}
async function closeDiscard(page) {
  const editor = page.getByRole("dialog", { name: "Nuovo momento", exact: true });
  await editor.getByRole("button", { name: "Annulla", exact: true }).click();
  const discard = page.getByRole("dialog", { name: "Scartare le modifiche?", exact: true });
  if (await discard.count()) await discard.getByRole("button", { name: "Scarta modifiche", exact: true }).click();
}
before(async () => {
  await db.doc(`stakes/${stakeId}`).set({ name: "Palo QA programma", slug: stakeId, isActive: true });
  for (const [name, role] of [["admin", "admin"], ["parent", "parent"], ["person", "participant"]]) {
    const user = await auth.createUser({ uid: `qa-moments-ui-${name}-${suffix}`, email: `${name}-${suffix}@example.invalid`, password, emailVerified: true });
    actors[name] = { uid: user.uid, email: user.email };
    await db.doc(`users/${user.uid}`).set({ firstName: "Persona", lastName: `Sintetica ${name}`, fullName: `Persona Sintetica ${name}`, email: user.email,
      role, stakeId, stakeName: "Palo QA programma", birthDate: "1990-01-01", genderRoleCategory: "dirigente", unitId: "qa-unit", unitName: "Unità QA", city: "Città QA", phone: "3330000000", mustChangePassword: false });
    await db.doc(`stakes/${stakeId}/members/${user.uid}`).set({ status: "active", staffRole: role === "admin" ? "admin" : null, claimedUnitId: "qa-unit" });
  }
  for (const id of activityIds) await activityRef(id).set({ title: "Attività QA programma", activityType: "standard", status: "registrations_open", isPublic: true, isVisible: true, startDate: future, endDate: future });
  for (const id of activityIds.slice(1)) {
    await activityRef(id).collection("registrations").doc(`user_${actors.parent.uid}`).set({ userId: actors.parent.uid, fullName: "Genitore Sintetico", firstName: "Genitore", lastName: "Sintetico", registrationStatus: "confirmed" });
    await activityRef(id).collection("registrations").doc(`child_${actors.parent.uid}_one`).set({ parentUid: actors.parent.uid, fullName: "Figlio Programma", firstName: "Figlio", lastName: "Programma", registrationStatus: "confirmed" });
    await activityRef(id).collection("registrations").doc(`user_${actors.person.uid}`).set({ userId: actors.person.uid, fullName: "Altra Persona", firstName: "Altra", lastName: "Persona", registrationStatus: "confirmed" });
  }
  await seedMoment(activityIds[1], "Momento iscrizione indipendente");
  await seedMoment(activityIds[2], "Momento altro contesto");
});
after(async () => {
  for (const context of contexts) await context.close(); await browser.close();
  await db.recursiveDelete(db.doc(`stakes/${stakeId}`));
  for (const who of Object.values(actors)) { await db.doc(`users/${who.uid}`).delete(); await auth.deleteUser(who.uid); }
  await deleteApp(app);
});

test("UI admin: scarto, tipo immutabile, anteprima e pubblicazione", { timeout: 90000 }, async t => {
  const page = await pageFor(actors.admin, "admin", activityIds[0]);
  for (const width of [320, 390, 430]) await t.test(`viewport${width}: nessun overflow e comandi raggiungibili`, async () => {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole("button", { name: "Aggiungi momento", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Nuovo momento", exact: true });
    await editor.getByLabel("Titolo", { exact: true }).fill("Bozza senza effetti");
    await editor.getByRole("button", { name: /Attività con iscrizione/ }).click();
    assert.equal(await editor.getByLabel("Titolo", { exact: true }).inputValue(), "Bozza senza effetti");
    await assertVisibleBounds(editor.getByRole("button", { name: "Salva bozza", exact: true }), page);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await editor.press("Escape");
    const discard = page.getByRole("dialog", { name: "Scartare le modifiche?", exact: true });
    await discard.getByRole("button", { name: "Continua a modificare", exact: true }).click();
    assert.equal(await editor.getByLabel("Titolo", { exact: true }).inputValue(), "Bozza senza effetti");
    await closeDiscard(page);
    assert.equal((await activityRef(activityIds[0]).collection("moments").get()).size, 0);
  });
  await t.test("salva bozza e poi pubblica dall'anteprima; tipo bloccato", async () => {
    await page.getByRole("button", { name: "Aggiungi momento", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Nuovo momento", exact: true });
    await editor.getByLabel("Titolo", { exact: true }).fill("Info pubblicata da UI");
    await editor.getByLabel("Quando inizia", { exact: true }).fill("2030-01-04T15:00");
    await editor.getByRole("button", { name: "Salva bozza", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
    const card = page.locator(".moment-card").filter({ hasText: "Info pubblicata da UI" });
    await card.getByRole("button", { name: "Modifica", exact: true }).click();
    const editing = page.getByRole("dialog", { name: "Modifica", exact: true });
    assert.equal(await editing.getByRole("button", { name: /Attività con iscrizione/ }).isDisabled(), true);
    await editing.getByRole("button", { name: "Annulla", exact: true }).click();
    await card.getByRole("button", { name: "Anteprima", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "Prima di pubblicare", exact: true });
    assert.equal((await activityRef(activityIds[0]).collection("moments").get()).docs[0].get("status"), "draft");
    await preview.getByRole("button", { name: "Pubblica", exact: true }).click();
    await preview.waitFor({ state: "hidden" });
    assert.equal((await activityRef(activityIds[0]).collection("moments").get()).docs[0].get("status"), "published");
  });
});

test("UI partecipazione: persona esplicita, singolo invio, rinuncia e ritorno", { timeout: 90000 }, async t => {
  const page = await pageFor(actors.parent, "participant", activityIds[1]);
  const card = page.locator(".moment-card").filter({ hasText: "Momento iscrizione indipendente" });
  await card.waitFor();
  await t.test("più persone richiedono scelta esplicita", async () => {
    assert.equal(await card.getByRole("button", { name: "Iscriviti", exact: true }).isDisabled(), true);
    await page.getByLabel("Per chi vuoi iscriverti?", { exact: true }).selectOption(`child_${actors.parent.uid}_one`);
    assert.equal(await card.getByRole("button", { name: "Iscriviti", exact: true }).isEnabled(), true);
  });
  await t.test("risposta tardiva: niente successo ottimistico né doppio invio", async () => {
    let release; const gate = new Promise(resolve => { release = resolve; }); let count = 0;
    const routeHandler = async route => {
      if (route.request().postDataJSON()?.data?.action !== "join") return route.continue();
      count++; const response = await route.fetch(); await gate; await route.fulfill({ response });
    };
    await page.route("**/momentsParticipant", routeHandler);
    const button = card.getByRole("button", { name: "Iscriviti", exact: true });
    await button.dblclick();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(el => el.disabled && el.textContent?.includes("Salvataggio")));
    assert.equal(await card.getByText("Iscrizione confermata", { exact: true }).count(), 0);
    release(); await card.getByText("Iscrizione confermata", { exact: true }).waitFor();
    assert.equal(count, 1); await page.unroute("**/momentsParticipant", routeHandler);
  });
  await t.test("rinuncia protetta da conferma, annulla conserva il posto", async () => {
    await card.getByRole("button", { name: "Rinuncia al posto", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Rinunciare al posto?", exact: true });
    await sheet.getByRole("button", { name: "Tieni il posto", exact: true }).click();
    await card.getByText("Iscrizione confermata", { exact: true }).waitFor();
    await card.getByRole("button", { name: "Rinuncia al posto", exact: true }).click();
    await sheet.getByRole("button", { name: "Rinuncia al posto", exact: true }).click();
    await card.getByRole("button", { name: "Riprendi iscrizione", exact: true }).waitFor();
  });
  await t.test("risposta di vecchio contesto non sostituisce l'altro programma", async () => {
    let release, captured; const gate = new Promise(resolve => { release = resolve; }); const seen = new Promise(resolve => { captured = resolve; });
    const routeHandler = async route => {
      const input = route.request().postDataJSON()?.data;
      if (input?.action !== "context" || input?.activityId !== activityIds[1]) return route.continue();
      const response = await route.fetch(); captured(); await gate; await route.fulfill({ response });
    };
    await page.route("**/momentsParticipant", routeHandler);
    await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await seen;
    await page.evaluate(activityId => window.qaContext({ mode: "participant", activityId }), activityIds[2]);
    await page.getByText("Momento altro contesto", { exact: true }).waitFor(); release();
    await page.waitForTimeout(100);
    assert.equal(await page.getByText("Momento iscrizione indipendente", { exact: true }).count(), 0);
    await page.unroute("**/momentsParticipant", routeHandler);
  });
});

test("UI timeout dopo commit e delete: vecchio retry non ricrea, errore e Ricarica visibili", { timeout: 90000 }, async () => {
  const page = await pageFor(actors.admin, "admin", activityIds[0]);
  await page.getByRole("button", { name: "Aggiungi momento", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Nuovo momento", exact: true });
  await editor.getByLabel("Titolo", { exact: true }).fill("Bozza timeout eliminata");
  await editor.getByLabel("Quando inizia", { exact: true }).fill("2030-01-04T15:00");
  let saved, intercepted = false; const saveRequests = [];
  await page.route("**/momentsAdmin", async route => {
    const input = route.request().postDataJSON()?.data;
    if (input?.action !== "save") return route.continue();
    saveRequests.push(input);
    if (intercepted) return route.continue();
    intercepted = true; const response = await route.fetch(); assert.equal(response.status(), 200); saved = input;
    await adminHandler(request(actors.admin, { action: "delete", activityId: activityIds[0], momentId: input.momentId, requestId: randomUUID(), expectedRevision: (await activityRef(activityIds[0]).collection("moments").doc(input.momentId).get()).get("revision") }));
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { status: "UNAVAILABLE", message: "Risposta QA persa dopo commit" } }) });
  });
  await editor.getByRole("button", { name: "Salva bozza", exact: true }).click();
  const alert = editor.getByRole("alert"); await alert.waitFor();
  await assertVisibleBounds(alert, page);
  await editor.getByRole("button", { name: "Salva bozza", exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(el => el.disabled && el.textContent === "Salva bozza"));
  assert.equal(saveRequests.length, 2); assert.equal(saveRequests[1].requestId, saveRequests[0].requestId);
  await assertVisibleBounds(alert, page);
  await alert.getByRole("button", { name: "Ricarica programma", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Scartare le modifiche?", exact: true });
  if (await confirm.count()) await confirm.getByRole("button", { name: "Ricarica programma", exact: true }).click();
  assert.ok(saved); assert.equal((await activityRef(activityIds[0]).collection("moments").doc(saved.momentId).get()).exists, false);
  await page.getByText("Bozza timeout eliminata", { exact: true }).waitFor({ state: "hidden" });
  if (process.env.QA_ARTIFACT_DIR) { mkdirSync(process.env.QA_ARTIFACT_DIR, { recursive: true }); await page.screenshot({ path: `${process.env.QA_ARTIFACT_DIR}/moments-timeout-recovery-390.png`, fullPage: false }); }
});
