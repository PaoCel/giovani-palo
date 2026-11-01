// Collaudo browser indipendente del quinto incremento di docs/ATTIVITA_MODULARI.md:
// finitura alloggi (stato vuoto della tab Stanze, inserimento in blocco, staff
// alloggiato altrove, riepilogo «Alloggio»). App vera (vite, componenti
// originali), Auth, Firestore e Functions degli emulatori; non si inietta nulla.
//
// Lancio (porte e progetto demo a scelta, vite con VITE_USE_EMULATORS=true e
// VITE_EMULATOR_PROJECT_ID=<stesso demo-*>, stesse porte degli emulatori):
//   firebase emulators:exec --only auth,firestore,functions --project demo-xxx \
//     --config <config> "QA_BASE_URL=http://127.0.0.1:<vite> \
//     CAMP_FUNCTIONS_HOST=127.0.0.1:<porta functions> PLAYWRIGHT_MODULE=<.../playwright-core/index.mjs> \
//     QA_ARTIFACT_DIR=<cartella screenshot> node --test functions/tests/roomLodgingBrowser.test.mjs"
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";

// Guardie su progetto demo e host locali PRIMA di inizializzare l'Admin SDK.
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
assert.match(projectId, /^demo-[a-z0-9-]+$/u, "Progetto demo-* obbligatorio");
function localHost(value, name) {
  assert.match(value || "", /^(localhost|127\.0\.0\.1):[1-9]\d{0,4}$/u, `${name}: emulatore locale obbligatorio`);
  const [host, port] = value.split(":");
  assert.ok(Number(port) <= 65535, `${name}: porta non valida`);
  return { host, port: Number(port), value };
}
const authHost = localHost(process.env.FIREBASE_AUTH_EMULATOR_HOST, "Auth");
const firestoreHost = localHost(process.env.FIRESTORE_EMULATOR_HOST, "Firestore");
const functionsHost = localHost(process.env.CAMP_FUNCTIONS_HOST, "Functions");
const base = new URL(process.env.QA_BASE_URL || "http://invalid.invalid");
assert.equal(base.protocol, "http:");
assert.ok(["127.0.0.1", "localhost"].includes(base.hostname), "QA_BASE_URL deve essere locale");
assert.ok(process.env.PLAYWRIGHT_MODULE, "PLAYWRIGHT_MODULE obbligatorio sul mini");
const artifactDir = process.env.QA_ARTIFACT_DIR || "";
if (artifactDir) mkdirSync(artifactDir, { recursive: true });

const require = createRequire(import.meta.url);
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const adminApp = initializeApp({ projectId }, `alloggi-browser-${randomUUID()}`);
const db = getFirestore(adminApp);
const adminAuth = getAuth(adminApp);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const browser = await chromium.launch();

const suffix = randomUUID().replace(/-/gu, "").slice(0, 10);
const stakeId = `qa-alloggi-browser-${suffix}`;
const password = "qa-alloggi-browser-only123";
const WIDTHS = [320, 390, 430];
const HEIGHT = { 320: 640, 390: 844, 430: 932 };
const PERMISSION_DENIED = /permission-denied|Missing or insufficient permissions/iu;
const EMOJI = /\p{Extended_Pictographic}/u;
const MISSING_STAFF = "Riserva almeno una stanza agli accompagnatori, oppure indica che sono alloggiati altrove.";
const LODGING_HINT = "Struttura, camere e cosa serve per la notte. Visibile a chi apre l’attività, anche senza iscrizione.";
const LODGING_INVITE = "Nessuna indicazione per chi partecipa: aggiungi struttura, camere e cosa serve per la notte.";
const LODGING_B = "Foresteria del tempio: camere da quattro letti, lenzuola fornite. Portare l'asciugamano.";
const LODGING_C = "Ostello QA in via Roma 1: camere da sei, colazione inclusa.";

// Attività (id): ogni scenario ha la sua, così un fallimento non ne contamina un altro.
const A = `viaggio-a-${suffix}`; // S1, S2: nessun piano, alloggio vuoto
const B = `viaggio-b-${suffix}`; // S4, S5: alloggio con testo, Giulia iscritta
const C = `viaggio-c-${suffix}`; // S4: alloggio vuoto, modifica dall'editor con bozza stanze aperta
const D = `viaggio-d-${suffix}`; // S3: staff alloggiato altrove
const L = `viaggio-l-${suffix}`; // S2b: piano salvato con 195 stanze
const E = `viaggio-e-${suffix}`; // S4b: bozza non pubblicata, «Rendi pubblica» con bozza stanze aperta
const actors = {};
const contexts = [];
const softNotes = [];
// Difetti di finitura (overflow, bersagli, campi): raccolti ovunque, valutati in S6.
const layoutDefects = [];
const finishDefects = [];
let layoutChecks = 0;
let finishChecks = 0;
// Difetti del giro precedente (bottone del problema a 41,5 px, filtro a 11,2 px, errore del foglio doppio,
// «Modifica» di Alloggio sul primo passo): le misure di questo giro, valutate in S6.
const closed = { problemButtonHeights: [], filterSelectSizes: [], sheetAlertCounts: [], lodgingFocus: [] };

const activityRef = (id) => db.doc(`stakes/${stakeId}/activities/${id}`);
const roomsRef = (id) => db.doc(`stakes/${stakeId}/activities/${id}/management/rooms`);
async function roomsPlanOf(id) {
  const snapshot = await roomsRef(id).get();
  return snapshot.exists ? snapshot.data() : null;
}

function registrationDoc(firstName, lastName, extra = {}) {
  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    genderRoleCategory: "giovane_uomo",
    unitId: "unit-a",
    unitNameSnapshot: "Unità A",
    registrationStatus: "confirmed",
    status: "active",
    birthDate: "2010-05-05",
    email: `${firstName.toLowerCase()}-${suffix}@example.invalid`,
    phone: "3330000000",
    answers: {},
    createdAt: "2026-10-26T10:00:00.000Z",
    updatedAt: "2026-10-26T10:00:00.000Z",
    ...extra,
  };
}

// Attività completa come quella salvata dall'editor: l'editor la rilegge e la salva in S4.
async function seedActivity(id, title, { roomsInfo = "", extra = {} } = {}) {
  await activityRef(id).set({
    title,
    description: `Descrizione di ${title}.`,
    year: 2026,
    audience: "congiunta",
    activityType: "trip",
    status: "registrations_open",
    isPublic: true,
    isVisible: true,
    location: "Roma",
    startDate: "2026-11-20T09:00:00.000Z",
    endDate: "2026-11-22T17:00:00.000Z",
    registrationOpen: "2026-10-01T08:00:00.000Z",
    registrationClose: "2026-11-15T20:00:00.000Z",
    overnight: true,
    roomsInfo,
    menuInfo: "",
    allergiesInfo: "",
    publicNotes: "",
    program: "",
    whatToBring: "",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...extra,
  });
  const people = {
    [`user_${actors.giulia.uid}`]: registrationDoc("Giulia", "Rossi", { userId: actors.giulia.uid, genderRoleCategory: "giovane_donna" }),
    manual_anna: registrationDoc("Anna", "Verdi", { genderRoleCategory: "giovane_donna" }),
    manual_bruno: registrationDoc("Bruno", "Neri"),
    manual_dario: registrationDoc("Dario", "Gialli"),
    manual_carla: registrationDoc("Carla", "Blu", { genderRoleCategory: "giovane_donna", registrationStatus: "cancelled", status: "cancelled" }),
    manual_ester: registrationDoc("Ester", "Viola", { genderRoleCategory: "accompagnatore", birthDate: "1985-03-03" }),
    manual_davide: registrationDoc("Davide", "Bianchi", { genderRoleCategory: "dirigente", birthDate: "1980-02-02" }),
  };
  for (const [registrationId, data] of Object.entries(people)) {
    await activityRef(id).collection("registrations").doc(registrationId).set(data);
  }
}
const YOUTH = ["Anna Verdi", "Bruno Neri", "Dario Gialli", "Giulia Rossi"];
const ADULTS = ["Davide Bianchi", "Ester Viola"];

before(async () => {
  await db.doc(`stakes/${stakeId}`).set({ name: "Palo QA alloggi", slug: stakeId, isActive: true });
  const defs = [
    ["admin", "admin", "Paola", "Admin", "dirigente", null],
    ["giulia", "participant", "Giulia", "Rossi", "giovane_donna", "unit-a"],
  ];
  for (const [name, role, firstName, lastName, category, unitId] of defs) {
    const user = await adminAuth.createUser({ uid: `qa-alloggi-${name}-${suffix}`, email: `${name}-${suffix}@example.invalid`, password, emailVerified: true });
    actors[name] = { uid: user.uid, email: user.email, name: `${firstName} ${lastName}` };
    await db.doc(`users/${user.uid}`).set({
      firstName, lastName, fullName: `${firstName} ${lastName}`, email: user.email, role, stakeId, stakeName: "Palo QA alloggi",
      birthDate: category.startsWith("giovane") ? "2010-05-05" : "1985-03-03", genderRoleCategory: category,
      unitName: unitId === "unit-a" ? "Unità A" : "Presidenza di palo", unitId: unitId ?? "", stakeSlug: stakeId,
      createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z", lastLoginAt: "2026-10-01T10:00:00.000Z",
      city: "Città QA", phone: "3330000000", mustChangePassword: false,
    });
    await db.doc(`stakes/${stakeId}/members/${user.uid}`).set({
      status: "active", staffRole: role === "participant" ? null : role, ...(unitId ? { claimedUnitId: unitId } : {}),
    });
  }
  await seedActivity(A, "Viaggio QA A");
  await seedActivity(B, "Viaggio QA B", { roomsInfo: LODGING_B });
  await seedActivity(C, "Viaggio QA C");
  await seedActivity(D, "Viaggio QA D");
  await seedActivity(L, "Viaggio QA L");
  await seedActivity(E, "Viaggio QA E", { roomsInfo: LODGING_B, extra: { status: "draft", isPublic: false, isVisible: false } });
  // L: piano già salvato con 195 stanze (una staff), come lo scrive la callable.
  const rooms = Array.from({ length: 195 }, (_, index) => ({
    id: `seed-room-${String(index + 1).padStart(3, "0")}`, name: `S${String(index + 1).padStart(3, "0")}`, capacity: 2,
    floor: "Terra", category: index === 0 ? "staff_male" : "boys", accessible: false, notes: "", minAge: null, maxAge: null,
  }));
  await roomsRef(L).set({
    rooms, assignments: {}, lockedIds: [], adultGenders: {}, couples: [], published: false, staffElsewhere: false,
    revision: 1, updatedAt: "2026-10-30T10:00:00.000Z", savedAt: FieldValue.serverTimestamp(),
  });
});

after(async () => {
  for (const context of contexts) await context.close().catch(() => undefined);
  await browser.close();
  await db.recursiveDelete(db.doc(`stakes/${stakeId}`));
  for (const who of Object.values(actors)) {
    await db.doc(`users/${who.uid}`).delete();
    await adminAuth.deleteUser(who.uid);
  }
  await deleteApp(adminApp);
  for (const note of softNotes) console.log(`# NOTA ${note}`);
});

// ---- Pagina, osservazione, accesso -----------------------------------------------------
const openPages = [];
const watches = new Map();
function attachWatch(page) {
  const watch = { console: [], pageErrors: [], external: [], callableBodies: [] };
  page.on("console", (message) => watch.console.push({ type: message.type(), text: message.text() }));
  page.on("pageerror", (error) => watch.pageErrors.push(String(error?.message || error)));
  page.on("response", (response) => {
    if (/\/roomManagementSave/u.test(response.url())) {
      void response.text().then((text) => watch.callableBodies.push({ status: response.status(), text, request: response.request().postData() || "" })).catch(() => undefined);
    }
  });
  return watch;
}

async function openPage(who, { width = 390 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: HEIGHT[width] }, serviceWorkers: "block" });
  contexts.push(context);
  const page = await context.newPage();
  openPages.push(page);
  const watch = attachWatch(page);
  watches.set(page, watch);
  page.setDefaultTimeout(20000);
  await context.route("**/*", (route) => {
    const target = new URL(route.request().url());
    if (["127.0.0.1", "localhost"].includes(target.hostname)) return route.continue();
    // Solo con QA_ALLOW_FONTS=1: i CSS e i file dei font di Google (GET statici), per misure con i font veri.
    if (process.env.QA_ALLOW_FONTS === "1" && ["fonts.googleapis.com", "fonts.gstatic.com"].includes(target.hostname)) return route.continue();
    watch.external.push(route.request().url());
    return route.abort();
  });
  await page.goto(`${base.origin}/login`);
  // La pagina deve parlare solo con gli emulatori del progetto demo di questa prova.
  const target = await page.evaluate(async () => {
    const app = await import("/src/services/firebase/app.ts");
    const config = await import("/src/services/firebase/config.ts");
    return [app.firebaseApp.options.projectId, config.useLocalEmulators, app.auth.emulatorConfig?.port, app.db._settings.host];
  });
  assert.deepEqual(target, [projectId, true, authHost.port, `127.0.0.1:${firestoreHost.port}`]);
  if (who) await login(page, who);
  return { page, watch, context };
}

async function login(page, who) {
  await page.locator('input[type="email"]').fill(who.email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}
async function gotoApp(page, path) {
  await page.goto(`${base.origin}${path}`);
  await dismissHints(page);
}
async function dismissHints(page) {
  const hint = page.getByRole("button", { name: "Chiudi suggerimento installazione" });
  if (await hint.count()) await hint.first().click().catch(() => undefined);
}
// Testo dell'app senza i menu a tendina: innerText di una select include tutte le opzioni.
const appText = (page) => page.evaluate(() => {
  const copy = document.body.cloneNode(true);
  copy.querySelectorAll("select, script, style").forEach((element) => element.remove());
  return copy.textContent ?? "";
});

async function dumpPages(name) {
  for (const [index, page] of openPages.entries()) {
    if (page.isClosed()) continue;
    if (artifactDir) await page.screenshot({ path: `${artifactDir}/FAIL-${name.replace(/[^a-z0-9]+/giu, "-").slice(0, 40)}-${index}.png` }).catch(() => undefined);
    const text = await page.locator("body").innerText().catch(() => "");
    console.log(`# FAIL "${name}" pagina ${index} ${page.url()}\n# ${text.replace(/\s+/gu, " ").slice(0, 900)}`);
    const watch = watches.get(page);
    if (watch) {
      const tail = watch.console.filter((entry) => ["error", "warning"].includes(entry.type)).slice(-6).map((entry) => `${entry.type}: ${entry.text.slice(0, 220)}`);
      console.log(`# CONSOLE ${JSON.stringify(tail)} PAGEERRORS ${JSON.stringify(watch.pageErrors.slice(-3))} CALLABLE ${JSON.stringify(watch.callableBodies.slice(-2).map((entry) => [entry.status, entry.text.slice(0, 300)]))}`);
    }
  }
}
async function step(t, name, fn) {
  await t.test(name, async () => {
    try {
      await fn();
    } catch (error) {
      await dumpPages(name);
      throw error;
    }
  });
}
function scenario(name, options, fn) {
  test(name, options, async (t) => {
    openPages.length = 0;
    try {
      await fn(t);
    } catch (error) {
      await dumpPages(name);
      throw error;
    }
  });
}
async function setWidth(page, width) {
  await page.setViewportSize({ width, height: HEIGHT[width] });
}
async function eachWidth(page, fn) {
  for (const width of WIDTHS) {
    await setWidth(page, width);
    await fn(width);
  }
  await setWidth(page, 390);
}
// Screenshot del viewport; con `focus` la pagina scorre prima fino a quell'elemento (sotto la barra in alto).
async function shot(page, name, width, focus = null) {
  if (!artifactDir) return;
  if (focus) {
    await focus.evaluate((element) => {
      const top = element.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - 96));
    });
    await page.waitForTimeout(150);
  }
  await page.screenshot({ path: `${artifactDir}/${name}-${width}.png`, fullPage: false });
}

// Nessun overflow orizzontale: documento, corpo e fogli (scrollWidth ≤ larghezza).
async function assertLayout(page, label) {
  const result = await page.evaluate(() => {
    const doc = document.documentElement;
    const viewport = doc.clientWidth;
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
      .filter((element) => element.scrollWidth > element.clientWidth + 1 || element.getBoundingClientRect().right > viewport + 1 || element.getBoundingClientRect().left < -1)
      .map((element) => `${element.querySelector("h2")?.textContent}:${element.scrollWidth}>${element.clientWidth} @${Math.round(element.getBoundingClientRect().left)}-${Math.round(element.getBoundingClientRect().right)}`);
    const outside = [];
    for (const element of document.body.querySelectorAll("*")) {
      const rect = element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      if (rect.right <= viewport + 1 && rect.left >= -1) continue;
      const style = getComputedStyle(element);
      if (style.position === "fixed" || style.visibility === "hidden" || style.display === "none") continue;
      let parent = element.parentElement;
      let scrollable = false;
      while (parent && parent !== document.body) {
        const overflowX = getComputedStyle(parent).overflowX;
        if (["auto", "scroll", "hidden"].includes(overflowX) && parent.scrollWidth > parent.clientWidth) { scrollable = true; break; }
        parent = parent.parentElement;
      }
      if (!scrollable) outside.push(`${element.tagName.toLowerCase()}.${String(element.className).slice(0, 40)}@${Math.round(rect.left)}-${Math.round(rect.right)}`);
    }
    return { docScroll: doc.scrollWidth, bodyScroll: document.body.scrollWidth, viewport, innerWidth: window.innerWidth, dialogs, outside: outside.slice(0, 6) };
  });
  if (result.docScroll > result.innerWidth) layoutDefects.push(`${label}: scrollWidth ${result.docScroll} > innerWidth ${result.innerWidth}`);
  if (result.bodyScroll > result.innerWidth) layoutDefects.push(`${label}: body.scrollWidth ${result.bodyScroll} > innerWidth ${result.innerWidth}`);
  for (const dialog of result.dialogs) layoutDefects.push(`${label}: foglio con overflow orizzontale ${dialog}`);
  if (result.outside.length) softNotes.push(`${label} @${result.viewport}px: elementi oltre il bordo ${result.outside.join(", ")}`);
  layoutChecks += 1;
}
// Campi a 16 px (sotto, Safari iOS ingrandisce la pagina al focus).
async function checkFieldSizes(scope, label) {
  const sizes = await scope.locator("input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select").evaluateAll((elements) => elements
    .filter((element) => element.getBoundingClientRect().width > 0)
    .map((element) => ({ name: element.getAttribute("aria-label") || element.closest("label")?.firstChild?.textContent?.trim() || element.name || element.tagName, size: parseFloat(getComputedStyle(element).fontSize) })));
  finishChecks += 1;
  assert.ok(sizes.length > 0, `${label}: nessun campo trovato`);
  const small = sizes.filter((entry) => entry.size < 16);
  if (small.length) finishDefects.push(`${label}: campi sotto 16 px ${small.map((entry) => `«${entry.name}» ${entry.size}px`).join(", ")}`);
  return sizes;
}
// Bersaglio di tocco ≥ 44 px di altezza (e di larghezza) davvero cliccabile (elementFromPoint dentro l'area).
async function checkTarget(locator, label) {
  await locator.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const info = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const at = (fx, fy) => [rect.left + rect.width * fx, rect.top + rect.height * fy];
    const probes = [at(0.5, 0.5), at(0.2, 0.5), at(0.8, 0.5), at(0.5, 0.2), at(0.5, 0.8)];
    const hits = probes.map(([x, y]) => { const hit = document.elementFromPoint(x, y); return hit === element || element.contains(hit) || (element.tagName === "LABEL" && hit?.closest("label") === element); });
    return { width: rect.width, height: rect.height, left: rect.left, right: rect.right, viewport: document.documentElement.clientWidth, hits };
  });
  finishChecks += 1;
  const problems = [];
  if (info.height < 43.5) problems.push(`alto ${info.height.toFixed(1)} px < 44`);
  if (info.width < 43.5) problems.push(`largo ${info.width.toFixed(1)} px < 44`);
  if (!info.hits.every(Boolean)) problems.push(`parte dell'area coperta da altro ${JSON.stringify(info.hits)}`);
  if (info.right > info.viewport + 0.5 || info.left < -0.5) problems.push(`fuori schermo ${Math.round(info.left)}-${Math.round(info.right)} su ${info.viewport}`);
  if (problems.length) finishDefects.push(`${label} @${info.viewport}px: ${problems.join(", ")}`);
  return info;
}
// Un foglio a 320 px è usabile se ogni campo e pulsante sta nello schermo e nel foglio ed è raggiungibile.
async function checkSheetUsable(dialog, label) {
  const result = await dialog.evaluate(async (element) => {
    const viewport = document.documentElement.clientWidth;
    const box = element.getBoundingClientRect();
    const problems = [];
    if (box.left < -0.5 || box.right > viewport + 0.5) problems.push(`foglio ${Math.round(box.left)}-${Math.round(box.right)} oltre ${viewport}`);
    for (const control of element.querySelectorAll("input:not([type=hidden]), select, textarea, button")) {
      if (control.getBoundingClientRect().width === 0) continue;
      control.scrollIntoView({ block: "center" });
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const rect = control.getBoundingClientRect();
      const name = control.getAttribute("aria-label") || (control.textContent || "").trim().slice(0, 30) || control.closest("label")?.firstChild?.textContent?.trim() || control.tagName;
      const sheet = element.getBoundingClientRect();
      if (rect.left < sheet.left - 0.5 || rect.right > sheet.right + 0.5 || rect.right > viewport + 0.5) problems.push(`«${name}» fuori dal foglio (${Math.round(rect.left)}-${Math.round(rect.right)})`);
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (!(hit === control || control.contains(hit) || hit?.closest("label")?.contains(control))) problems.push(`«${name}» coperto da ${hit?.tagName?.toLowerCase()}.${String(hit?.className || "").slice(0, 30)}`);
    }
    return { viewport, problems };
  });
  finishChecks += 1;
  for (const problem of result.problems) finishDefects.push(`${label} @${result.viewport}px: ${problem}`);
}
function assertClean(watch, label) {
  const consoleErrors = watch.console.filter((entry) => ["error", "warning"].includes(entry.type) && PERMISSION_DENIED.test(entry.text));
  assert.deepEqual(consoleErrors, [], `${label}: permission-denied in console`);
  assert.deepEqual(watch.pageErrors, [], `${label}: errori di pagina`);
  const external = watch.external.filter((url) => !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//u.test(url));
  assert.deepEqual(external, [], `${label}: richieste verso host esterni`);
}

// ---- Tab Stanze --------------------------------------------------------------------------
const planner = (page) => page.locator("section.room-planner");
async function openRooms(page, activityId) {
  await gotoApp(page, `/admin/events/${activityId}/rooms`);
  await page.getByRole("heading", { name: "Organizza le stanze", exact: true }).waitFor();
}
const roomNames = (page) => planner(page).locator(".rp-room h4").allInnerTexts();
const roomCount = async (page) => Number((await planner(page).locator(".rp-stats > div").nth(3).locator("strong").innerText()).trim());
const assignedStat = async (page) => (await planner(page).locator(".rp-stats > div").first().locator("strong").innerText()).replace(/\s+/gu, " ").trim();
const toAssignCount = async (page) => Number((await planner(page).locator(".rp-people > .rp-people__title span").innerText()).trim());
const toAssignNames = (page) => planner(page).locator(".rp-people__list > .rp-person strong").allInnerTexts();
const elsewhereGroup = (page) => planner(page).locator(".rp-elsewhere");
const elsewhereNames = (page) => elsewhereGroup(page).locator(".rp-person strong").allInnerTexts();
const problemsBox = (page) => planner(page).locator(".rp-notice--warning", { hasText: "Da sistemare prima del salvataggio" });
const problemButton = (page) => problemsBox(page).getByRole("button", { name: "Accompagnatori alloggiati altrove", exact: true });
const elsewhereCheckbox = (page) => planner(page).locator(".rp-people").getByRole("checkbox", { name: "Accompagnatori alloggiati altrove", exact: true });
const elsewhereLabel = (page) => planner(page).locator(".rp-people label.rp-checkbox", { hasText: "Accompagnatori alloggiati altrove" });
const saveDraftButton = (page) => planner(page).locator(".rp-savebar").getByRole("button", { name: /^(Salva bozza|Salvataggio\.\.\.)$/u });
const undoButton = (page) => planner(page).locator(".rp-savebar").getByRole("button", { name: "Annulla ultima modifica", exact: true });
const statusText = async (page) => (await planner(page).locator(".rp-status").innerText()).trim();
const bulkDialog = (page) => page.getByRole("dialog", { name: "Aggiungi stanze", exact: true });
const emptyState = (page) => planner(page).locator(".rp-empty");

async function openBulkFromToolbar(page) {
  await planner(page).locator(".rp-toolbar").getByRole("button", { name: "Aggiungi stanze", exact: true }).click();
  const dialog = bulkDialog(page);
  await dialog.waitFor();
  return dialog;
}
async function fillBulk(dialog, { count, first, capacity, floor = "", category = "unassigned" }) {
  await dialog.getByLabel("Quante stanze", { exact: true }).fill(String(count));
  await dialog.getByLabel("Nome o numero della prima", { exact: true }).fill(first);
  await dialog.getByLabel("Posti letto in ognuna", { exact: true }).fill(String(capacity));
  await dialog.getByLabel("Piano", { exact: true }).fill(floor);
  await dialog.getByLabel("Categoria delle nuove stanze", { exact: true }).selectOption(category);
}
async function bulkValues(dialog) {
  return {
    count: await dialog.getByLabel("Quante stanze", { exact: true }).inputValue(),
    first: await dialog.getByLabel("Nome o numero della prima", { exact: true }).inputValue(),
    capacity: await dialog.getByLabel("Posti letto in ognuna", { exact: true }).inputValue(),
    floor: await dialog.getByLabel("Piano", { exact: true }).inputValue(),
    category: await dialog.getByLabel("Categoria delle nuove stanze", { exact: true }).inputValue(),
  };
}
async function submitBulk(dialog) {
  await dialog.getByRole("button", { name: "Aggiungi alla bozza", exact: true }).click();
}
async function saveDraft(page) {
  const watch = watches.get(page);
  const before = watch.callableBodies.length;
  await saveDraftButton(page).click();
  await page.getByText("Bozza salvata. Visibile solo agli amministratori.", { exact: true }).waitFor({ timeout: 30000 }).catch(async (error) => {
    console.log(`# DEBUG callable ${JSON.stringify(watch.callableBodies.slice(before).map((entry) => [entry.status, entry.text.slice(0, 400)]))}`);
    throw error;
  });
  assert.equal(await statusText(page), "Bozza riservata");
}

// Campo «Alloggio» dell'editor e stato all'apertura. Contratto: il cursore arriva nel campo appena l'editor ha
// finito di rileggere l'attività dal server (prima il fieldset è disattivato e nessun campo può avere il focus);
// lo stato «immediate» resta solo come informazione.
const lodgingField = (page, editor) => editor.locator("label.field", { has: page.locator(".field__label", { hasText: /^Alloggio$/u }) }).locator("textarea");
async function lodgingFieldState(page, editor) {
  const field = lodgingField(page, editor);
  await field.waitFor({ timeout: 10000 }).catch(() => undefined);
  const describe = () => page.evaluate(() => {
    const active = document.activeElement;
    const label = active?.closest?.("label")?.querySelector(".field__label")?.textContent?.trim();
    return `${active?.tagName?.toLowerCase()}${label ? `«${label}»` : ""}${active?.id ? `#${active.id}` : ""}`;
  });
  const immediate = { visible: await field.isVisible().catch(() => false), focused: await field.evaluate((element) => document.activeElement === element).catch(() => false), active: await describe() };
  // Attesa del cursore nel campo (fine della rilettura), poi una pausa per vedere che nessuno lo sposta.
  const started = Date.now();
  const arrived = await field.evaluate((element) => new Promise((resolve) => {
    const deadline = Date.now() + 10000;
    const tick = () => {
      if (document.activeElement === element) resolve(true);
      else if (Date.now() > deadline) resolve(false);
      else requestAnimationFrame(tick);
    };
    tick();
  })).catch(() => false);
  const waitedMs = Date.now() - started;
  await page.waitForTimeout(500);
  const settled = { arrived, waitedMs, focused: await field.evaluate((element) => document.activeElement === element).catch(() => false), active: await describe(), disabled: await field.evaluate((element) => element.matches(":disabled")).catch(() => true) };
  const continueButtons = await editor.getByRole("button", { name: /^Continua/u }).count();
  const inView = await field.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const body = element.closest(".app-modal__body")?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
    return rect.top >= body.top - 1 && rect.bottom <= body.bottom + 1;
  }).catch(() => false);
  return { immediate, settled, continueButtons, inView };
}

// ---- S1 ------------------------------------------------------------------------------------
scenario("S1 admin, attività con pernottamento senza piano: stato vuoto e vista Pianta", { timeout: 180000 }, async (t) => {
  const { page, watch } = await openPage(actors.admin);
  await openRooms(page, A);

  await step(t, "elenco vuoto: «Aggiungi stanze» primaria e «Importa file Excel o CSV» secondaria", async () => {
    const empty = emptyState(page);
    await empty.waitFor();
    await empty.getByRole("heading", { name: "Partiamo dalle stanze.", exact: true }).waitFor();
    const add = empty.getByRole("button", { name: "Aggiungi stanze", exact: true });
    const importButton = empty.getByRole("button", { name: "Importa file Excel o CSV", exact: true });
    assert.ok(await add.evaluate((element) => element.classList.contains("button--primary")), "«Aggiungi stanze» deve essere la primaria");
    assert.ok(await importButton.evaluate((element) => element.classList.contains("button--secondary")), "«Importa file Excel o CSV» deve essere secondaria");
    // Ordine: la primaria viene prima.
    const order = await empty.locator(".rp-actions button").allInnerTexts();
    assert.deepEqual(order.map((text) => text.trim()), ["Aggiungi stanze", "Importa file Excel o CSV"]);
    const text = await empty.innerText();
    assert.ok(!/Importa il file dell’ostello\./u.test(text), "il vecchio invito a importare il file non deve restare");
    assert.equal(await roomCount(page), 0);
    assert.equal(await undoButton(page).isDisabled(), true, "nessuna modifica da annullare");
    assert.equal(await statusText(page), "Bozza riservata");
    assert.ok(!EMOJI.test(await appText(page)), "nessuna emoji");
    await eachWidth(page, async (width) => {
      await assertLayout(page, `S1 stanze vuote ${width}`);
      await checkTarget(add, `S1 «Aggiungi stanze» (stato vuoto) ${width}`);
      await checkTarget(importButton, `S1 «Importa file Excel o CSV» ${width}`);
      await shot(page, "s1-stanze-vuote", width, empty);
    });
  });

  await step(t, "vista Pianta vuota: «Aggiungi prima le stanze…» e «Carica pianta»", async () => {
    await planner(page).locator(".rp-view").getByRole("button", { name: "Pianta", exact: true }).click();
    const hint = planner(page).locator(".rp-map-view .rp-empty-small");
    await hint.waitFor();
    const text = (await hint.innerText()).replace(/\s+/gu, " ").trim();
    assert.ok(text.startsWith("Aggiungi prima le stanze: la pianta mostra quelle della bozza."), `testo della pianta vuota: ${text}`);
    await hint.getByRole("button", { name: "Carica pianta", exact: true }).waitFor();
    await eachWidth(page, async (width) => {
      await assertLayout(page, `S1 pianta vuota ${width}`);
      await shot(page, "s1-pianta-vuota", width, hint);
    });
    await planner(page).locator(".rp-view").getByRole("button", { name: "Elenco", exact: true }).click();
    await emptyState(page).waitFor();
  });

  await step(t, "riepilogo «Alloggio» vuoto: invito ad aggiungerlo", async () => {
    const lodging = page.locator("article.rp-lodging");
    await lodging.getByRole("heading", { name: "Alloggio", exact: true }).waitFor();
    assert.equal((await lodging.locator("p").innerText()).trim(), LODGING_INVITE);
    assert.equal((await lodging.locator("small").innerText()).trim(), "Visibile a chi apre l’attività, anche senza iscrizione.");
  });
  assertClean(watch, "S1");
  assert.equal(await roomsPlanOf(A), null, "nessun piano salvato");
});

// ---- S2 ------------------------------------------------------------------------------------
scenario("S2 foglio «Aggiungi stanze»: anteprima, aggiunta in blocco, problema staff, annulla, errori", { timeout: 300000 }, async (t) => {
  const { page, watch } = await openPage(actors.admin);
  await openRooms(page, A);

  await step(t, "Annulla del foglio con campi compilati non cambia la bozza vuota", async () => {
    await emptyState(page).getByRole("button", { name: "Aggiungi stanze", exact: true }).click();
    const dialog = bulkDialog(page);
    await dialog.waitFor();
    // Valori iniziali documentati: 1 stanza da 2 posti, da decidere.
    assert.deepEqual(await bulkValues(dialog), { count: "1", first: "", capacity: "2", floor: "", category: "unassigned" });
    await fillBulk(dialog, { count: 5, first: "201", capacity: 3, floor: "Secondo", category: "girls" });
    await dialog.getByRole("button", { name: "Annulla", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await emptyState(page).waitFor();
    assert.equal(await roomCount(page), 0);
    assert.equal(await undoButton(page).isDisabled(), true, "Annulla del foglio non crea una modifica");
    assert.equal(await statusText(page), "Bozza riservata");
  });

  await step(t, "10 stanze da «101», 4 posti, piano Primo, Ragazzi: anteprima dei nomi a 320, 390, 430", async () => {
    await emptyState(page).getByRole("button", { name: "Aggiungi stanze", exact: true }).click();
    const dialog = bulkDialog(page);
    await dialog.waitFor();
    await fillBulk(dialog, { count: 10, first: "101", capacity: 4, floor: "Primo", category: "boys" });
    const preview = dialog.locator("p[aria-live=polite]");
    assert.equal((await preview.innerText()).trim(), "Nomi: 101, 102, 103 … 110");
    // Anteprima con pochi nomi: tutti elencati.
    await dialog.getByLabel("Quante stanze", { exact: true }).fill("3");
    assert.equal((await preview.innerText()).trim(), "Nomi: 101, 102, 103");
    await dialog.getByLabel("Quante stanze", { exact: true }).fill("10");
    await eachWidth(page, async (width) => {
      await assertLayout(page, `S2 foglio aggiungi stanze ${width}`);
      await checkFieldSizes(dialog, `S2 foglio aggiungi stanze ${width}`);
      await checkTarget(dialog.getByRole("button", { name: "Aggiungi alla bozza", exact: true }), `S2 «Aggiungi alla bozza» ${width}`);
      await checkTarget(dialog.getByRole("button", { name: "Annulla", exact: true }), `S2 «Annulla» del foglio ${width}`);
      await checkTarget(dialog.getByRole("button", { name: "Chiudi", exact: true }), `S2 x del foglio ${width}`);
      await dialog.evaluate((element) => element.querySelector(".app-modal__body")?.scrollTo(0, 0));
      await shot(page, "s2-foglio-aggiungi-stanze", width);
    });
    // A 320 px: il foglio intero è usabile e l'aggiunta si conferma da lì.
    await setWidth(page, 320);
    await checkSheetUsable(dialog, "S2 foglio aggiungi stanze");
    await submitBulk(dialog);
    await dialog.waitFor({ state: "hidden" });
    await setWidth(page, 390);
  });

  await step(t, "aggiunte: 10 stanze, problema della stanza staff con l'azione, «Salva bozza» disattivato", async () => {
    await page.getByText("10 stanze aggiunte alla bozza.", { exact: true }).waitFor();
    assert.deepEqual(await roomNames(page), ["101", "102", "103", "104", "105", "106", "107", "108", "109", "110"]);
    assert.equal(await roomCount(page), 10);
    const first = planner(page).locator(".rp-room").first();
    assert.equal((await first.locator(".rp-category").innerText()).trim(), "Ragazzi");
    assert.equal((await first.locator("header small").innerText()).trim(), "Primo");
    assert.equal((await first.locator(".rp-room__meta strong").innerText()).replace(/\s+/gu, ""), "0/4");
    await problemsBox(page).waitFor();
    assert.ok((await problemsBox(page).innerText()).includes(MISSING_STAFF), "problema della stanza staff");
    await problemButton(page).waitFor();
    assert.equal(await saveDraftButton(page).isDisabled(), true, "«Salva bozza» disattivato finché c'è il problema");
    assert.equal(await statusText(page), "Modifiche da salvare");
    // «Assegna automaticamente» usa la validazione della bozza: attivo anche senza stanza staff, con l'avviso nel foglio.
    const auto = planner(page).getByRole("button", { name: "Assegna automaticamente" });
    assert.equal(await auto.isDisabled(), false, "«Assegna automaticamente» attivo senza stanza staff");
    await auto.click();
    const proposal = page.getByRole("dialog", { name: "Proposta automatica", exact: true });
    await proposal.waitFor();
    const warning = proposal.locator(".rp-notice--warning", { hasText: "Nessuna stanza è riservata agli accompagnatori" });
    await warning.waitFor();
    assert.equal((await warning.innerText()).trim(), "Nessuna stanza è riservata agli accompagnatori: il calcolo ne riserva una tra quelle «Da decidere» ancora vuote, se c’è. Puoi cambiarla prima di salvare.");
    await eachWidth(page, async (width) => {
      await assertLayout(page, `S2 proposta senza stanza staff ${width}`);
      await warning.evaluate((element) => element.scrollIntoView({ block: "center" }));
      await shot(page, "s2-proposta-avviso-staff", width);
    });
    await proposal.getByRole("button", { name: "Chiudi", exact: true }).click();
    await proposal.waitFor({ state: "hidden" });
    assert.equal(await roomCount(page), 10, "chiudere la proposta non cambia la bozza");
    assert.equal(await undoButton(page).isDisabled(), false);
    await eachWidth(page, async (width) => {
      await assertLayout(page, `S2 bozza con problema staff ${width}`);
      const problemInfo = await checkTarget(problemButton(page), `S2 «Accompagnatori alloggiati altrove» (problema) ${width}`);
      closed.problemButtonHeights.push([width, Math.round(problemInfo.height * 10) / 10]);
      await checkTarget(elsewhereLabel(page), `S2 spunta «Accompagnatori alloggiati altrove» ${width}`);
      await checkTarget(planner(page).locator(".rp-toolbar").getByRole("button", { name: "Aggiungi stanze", exact: true }), `S2 «Aggiungi stanze» (barra) ${width}`);
      await shot(page, "s2-problema-staff", width, problemsBox(page));
      await shot(page, "s2-stanze-aggiunte", width, planner(page).locator(".rp-room-grid"));
    });
  });

  await step(t, "«Annulla ultima modifica» toglie le 10 stanze in un passo", async () => {
    await undoButton(page).click();
    await page.getByText("Ultima modifica annullata.", { exact: true }).waitFor();
    assert.equal(await roomCount(page), 0);
    await emptyState(page).waitFor();
    assert.equal(await problemsBox(page).count(), 0, "senza stanze nessun problema");
    assert.equal(await undoButton(page).isDisabled(), true);
    assert.equal(await statusText(page), "Bozza riservata", "tornata allo stato salvato");
    await shot(page, "s2-dopo-annulla-ultima", 390, emptyState(page));
  });

  await step(t, "nome già usato: errore nel foglio, campi conservati; Annulla non tocca la bozza", async () => {
    await emptyState(page).getByRole("button", { name: "Aggiungi stanze", exact: true }).click();
    let dialog = bulkDialog(page);
    await fillBulk(dialog, { count: 10, first: "101", capacity: 4, floor: "Primo", category: "boys" });
    await submitBulk(dialog);
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await roomCount(page), 10);
    dialog = await openBulkFromToolbar(page);
    await fillBulk(dialog, { count: 3, first: "109", capacity: 2, floor: "Secondo", category: "girls" });
    assert.equal((await dialog.locator("p[aria-live=polite]").innerText()).trim(), "Nomi: 109, 110, 111");
    await submitBulk(dialog);
    const alert = dialog.getByRole("alert");
    await alert.waitFor();
    assert.equal((await alert.innerText()).trim(), "La stanza 109 esiste già. Modificala dalla sua scheda.");
    assert.ok(await dialog.isVisible(), "il foglio resta aperto");
    assert.deepEqual(await bulkValues(dialog), { count: "3", first: "109", capacity: "2", floor: "Secondo", category: "girls" }, "campi conservati");
    assert.equal(await roomCount(page), 10, "nessuna stanza aggiunta");
    // Lo stesso errore non deve comparire due volte allo stesso lettore: si conta anche fuori dal foglio.
    closed.sheetAlertCounts.push(["S2 nome già usato", await page.getByRole("alert").filter({ hasText: "La stanza 109 esiste già." }).count()]);
    await eachWidth(page, async (width) => {
      await assertLayout(page, `S2 errore nome già usato ${width}`);
      await dialog.evaluate((element) => element.querySelector(".app-modal__body")?.scrollTo(0, 0));
      await shot(page, "s2-errore-nome-usato", width);
    });
    // Correzione nel foglio stesso: il nome libero passa.
    await dialog.getByLabel("Nome o numero della prima", { exact: true }).fill("111");
    await dialog.getByRole("button", { name: "Annulla", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await roomCount(page), 10, "Annulla del foglio non cambia la bozza");
    assert.deepEqual(await roomNames(page), ["101", "102", "103", "104", "105", "106", "107", "108", "109", "110"]);
    assert.equal(await planner(page).getByRole("alert").count(), 0, "l'errore del foglio non resta nella pagina");
    // Riaperto, il foglio riparte dai valori iniziali.
    dialog = await openBulkFromToolbar(page);
    assert.deepEqual(await bulkValues(dialog), { count: "1", first: "", capacity: "2", floor: "", category: "unassigned" });
    assert.equal(await dialog.getByRole("alert").count(), 0, "nessun errore vecchio nel foglio riaperto");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await roomCount(page), 10);
    // Una sola stanza: messaggio al singolare.
    dialog = await openBulkFromToolbar(page);
    await fillBulk(dialog, { count: 1, first: "Sala A", capacity: 2, category: "unassigned" });
    assert.equal(await dialog.locator("p[aria-live=polite]").count(), 0, "con una stanza nessuna anteprima");
    await submitBulk(dialog);
    await dialog.waitFor({ state: "hidden" });
    await page.getByText("Stanza Sala A aggiunta alla bozza.", { exact: true }).waitFor();
    assert.equal(await roomCount(page), 11);
    await undoButton(page).click();
    assert.equal(await roomCount(page), 10);
    // Nome senza numero: numerati da 1 dopo il nome.
    dialog = await openBulkFromToolbar(page);
    await fillBulk(dialog, { count: 3, first: "Camera", capacity: 2 });
    assert.equal((await dialog.locator("p[aria-live=polite]").innerText()).trim(), "Nomi: Camera 1, Camera 2, Camera 3");
    await dialog.getByRole("button", { name: "Annulla", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await roomCount(page), 10);
  });
  assertClean(watch, "S2");
  assert.equal(await roomsPlanOf(A), null, "nulla salvato senza «Salva bozza»");
});

// ---- S2b -----------------------------------------------------------------------------------
scenario("S2b limite delle 200 stanze: errore nel foglio con quante ne restano", { timeout: 240000 }, async (t) => {
  const { page, watch } = await openPage(actors.admin);
  await openRooms(page, L);

  await step(t, "195 salvate: 10 in più rifiutate nel foglio, 5 accettate, poi nessuna", async () => {
    assert.equal(await roomCount(page), 195);
    let dialog = await openBulkFromToolbar(page);
    await fillBulk(dialog, { count: 10, first: "X1", capacity: 2, category: "boys" });
    await submitBulk(dialog);
    const alert = dialog.getByRole("alert");
    await alert.waitFor();
    assert.equal((await alert.innerText()).trim(), "Il piano può contenere al massimo 200 stanze: puoi aggiungerne ancora 5.");
    closed.sheetAlertCounts.push(["S2b limite 200", await page.getByRole("alert").filter({ hasText: "Il piano può contenere al massimo 200 stanze" }).count()]);
    assert.deepEqual(await bulkValues(dialog), { count: "10", first: "X1", capacity: "2", floor: "", category: "boys" }, "campi conservati");
    await eachWidth(page, async (width) => {
      await assertLayout(page, `S2b errore limite 200 ${width}`);
      await dialog.evaluate((element) => element.querySelector(".app-modal__body")?.scrollTo(0, 0));
      await shot(page, "s2b-errore-limite-200", width);
    });
    await dialog.getByLabel("Quante stanze", { exact: true }).fill("5");
    await submitBulk(dialog);
    await dialog.waitFor({ state: "hidden" });
    await page.getByText("5 stanze aggiunte alla bozza.", { exact: true }).waitFor();
    assert.equal(await roomCount(page), 200);
    dialog = await openBulkFromToolbar(page);
    await fillBulk(dialog, { count: 1, first: "Y1", capacity: 2, category: "boys" });
    await submitBulk(dialog);
    await dialog.getByRole("alert").waitFor();
    const full = (await dialog.getByRole("alert").innerText()).trim();
    assert.equal(full, "Il piano ha già 200 stanze, il massimo.", "errore a piano pieno");
    assert.deepEqual(await bulkValues(dialog), { count: "1", first: "Y1", capacity: "2", floor: "", category: "boys" }, "campi conservati");
    await shot(page, "s2b-piano-pieno", 390);
    await dialog.getByRole("button", { name: "Annulla", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    // Oltre 50 per foglio il campo non accetta il valore (max del campo).
    dialog = await openBulkFromToolbar(page);
    await dialog.getByLabel("Quante stanze", { exact: true }).fill("51");
    const valid = await dialog.getByLabel("Quante stanze", { exact: true }).evaluate((element) => element.checkValidity());
    assert.equal(valid, false, "51 stanze per foglio non sono valide");
    await dialog.getByRole("button", { name: "Annulla", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await roomCount(page), 200);
  });
  assertClean(watch, "S2b");
  assert.equal((await roomsPlanOf(L)).rooms.length, 195, "il piano salvato non cambia");
});

// ---- S3 ------------------------------------------------------------------------------------
scenario("S3 accompagnatori alloggiati altrove: spunta, salvataggio, ricarica, ritorno e assegnazione", { timeout: 300000 }, async (t) => {
  const { page, watch } = await openPage(actors.admin);
  await openRooms(page, D);

  await step(t, "prima della spunta: 6 da assegnare, adulti compresi", async () => {
    assert.equal(await toAssignCount(page), 6);
    assert.deepEqual((await toAssignNames(page)).sort(), [...ADULTS, ...YOUTH].sort());
    assert.equal(await elsewhereGroup(page).count(), 0);
    assert.equal(await elsewhereCheckbox(page).isChecked(), false);
    const dialog = await openBulkFromToolbar(page);
    await fillBulk(dialog, { count: 10, first: "101", capacity: 4, floor: "Primo", category: "boys" });
    await submitBulk(dialog);
    await dialog.waitFor({ state: "hidden" });
    await problemButton(page).waitFor();
    assert.equal(await assignedStat(page), "0 / 6");
  });

  await step(t, "azione del problema: spunta accesa, problema sparito, adulti in «Alloggiati altrove»", async () => {
    await problemButton(page).click();
    await page.getByText("Gli accompagnatori senza stanza risultano alloggiati altrove.", { exact: true }).waitFor();
    assert.equal(await elsewhereCheckbox(page).isChecked(), true);
    assert.equal(await problemsBox(page).count(), 0, "il problema della stanza staff deve sparire");
    await elsewhereGroup(page).waitFor();
    assert.equal((await elsewhereGroup(page).locator("h3").innerText()).trim(), "Alloggiati altrove");
    assert.equal(Number((await elsewhereGroup(page).locator(".rp-people__title span").innerText()).trim()), 2);
    assert.deepEqual(await elsewhereNames(page), ADULTS, "gli adulti, in ordine alfabetico");
    assert.equal(await toAssignCount(page), 4, "da assegnare senza gli adulti");
    assert.deepEqual((await toAssignNames(page)).sort(), YOUTH);
    assert.equal(await assignedStat(page), "0 / 4", "conteggi senza gli adulti");
    assert.equal(await saveDraftButton(page).isDisabled(), false, "ora si salva");
    await eachWidth(page, async (width) => {
      await assertLayout(page, `S3 alloggiati altrove ${width}`);
      await checkTarget(elsewhereLabel(page), `S3 spunta «Accompagnatori alloggiati altrove» ${width}`);
      await shot(page, "s3-alloggiati-altrove", width, planner(page).locator(".rp-people"));
      await shot(page, "s3-conteggi", width, planner(page).locator(".rp-stats"));
    });
    // Ricerca: anche il gruppo «Alloggiati altrove» si filtra.
    await planner(page).getByRole("searchbox", { name: "Cerca partecipante" }).fill("Ester");
    assert.deepEqual(await elsewhereNames(page), ["Ester Viola"]);
    assert.equal(await planner(page).getByText("Nessun partecipante trovato.", { exact: true }).count(), 0, "cercando un alloggiato altrove non compare «Nessun partecipante trovato.»");
    await shot(page, "s3-ricerca-alloggiato-altrove", 390, planner(page).locator(".rp-people"));
    await planner(page).getByRole("searchbox", { name: "Cerca partecipante" }).fill("Nessuno così");
    await planner(page).getByText("Nessun partecipante trovato.", { exact: true }).waitFor();
    await planner(page).getByRole("searchbox", { name: "Cerca partecipante" }).fill("");
    // Campi del planner (ricerca e filtri) a 16 px.
    for (const width of WIDTHS) {
      await setWidth(page, width);
      const sizes = await checkFieldSizes(planner(page), `S3 campi del planner ${width}`);
      const filter = sizes.find((entry) => entry.name === "Filtra per categoria");
      assert.ok(filter, `il filtro «Filtra per categoria» deve essere tra i campi misurati: ${JSON.stringify(sizes)}`);
      closed.filterSelectSizes.push([width, filter.size]);
    }
    await setWidth(page, 390);
  });

  await step(t, "«Salva bozza» e ricarica: spunta e stanze lette dal server", async () => {
    await saveDraft(page);
    const saved = await roomsPlanOf(D);
    assert.equal(saved.staffElsewhere, true, "staffElsewhere salvato");
    assert.equal(saved.rooms.length, 10);
    assert.equal(saved.revision, 1);
    // Ritocco lato server dopo il salvataggio: se la ricarica lo mostra, la lettura viene dal server e non dalla cache.
    const rooms = saved.rooms.map((room) => (room.name === "110" ? { ...room, floor: "Primo (server)" } : room));
    await roomsRef(D).update({ rooms });
    await page.reload();
    await dismissHints(page);
    await page.getByRole("heading", { name: "Organizza le stanze", exact: true }).waitFor();
    assert.equal(await elsewhereCheckbox(page).isChecked(), true, "spunta conservata dopo la ricarica");
    assert.equal(await roomCount(page), 10);
    assert.deepEqual(await roomNames(page), ["101", "102", "103", "104", "105", "106", "107", "108", "109", "110"]);
    assert.equal((await planner(page).locator(".rp-room", { has: page.locator("h4", { hasText: /^110$/u }) }).locator("header small").innerText()).trim(), "Primo (server)", "la ricarica legge il server");
    assert.deepEqual(await elsewhereNames(page), ADULTS);
    assert.equal(await problemsBox(page).count(), 0);
    assert.equal(await statusText(page), "Bozza riservata");
    await shot(page, "s3-dopo-ricarica", 390, planner(page).locator(".rp-people"));
  });

  await step(t, "togli la spunta: adulti tra i da assegnare, il problema ritorna, «Salva bozza» disattivato", async () => {
    await elsewhereLabel(page).click();
    await page.getByText("Gli accompagnatori senza stanza tornano tra i da assegnare.", { exact: true }).waitFor();
    assert.equal(await elsewhereCheckbox(page).isChecked(), false);
    assert.equal(await elsewhereGroup(page).count(), 0);
    assert.equal(await toAssignCount(page), 6);
    assert.deepEqual((await toAssignNames(page)).sort(), [...ADULTS, ...YOUTH].sort());
    assert.equal(await assignedStat(page), "0 / 6");
    await problemsBox(page).waitFor();
    assert.ok((await problemsBox(page).innerText()).includes(MISSING_STAFF));
    assert.equal(await saveDraftButton(page).isDisabled(), true);
    await eachWidth(page, async (width) => {
      await assertLayout(page, `S3 spunta tolta ${width}`);
      await shot(page, "s3-spunta-tolta", width, problemsBox(page));
    });
    // Annulla ultima modifica: la spunta torna.
    await undoButton(page).click();
    assert.equal(await elsewhereCheckbox(page).isChecked(), true);
    assert.equal(await problemsBox(page).count(), 0);
    assert.equal(await statusText(page), "Bozza riservata", "di nuovo uguale al salvato");
  });

  await step(t, "un accompagnatore alloggiato altrove resta assegnabile a una stanza staff", async () => {
    // 110 diventa stanza staff maschile.
    await planner(page).getByRole("button", { name: "Modifica stanza 110", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Modifica stanza 110", exact: true });
    await editor.getByLabel("Categoria stanza", { exact: true }).selectOption("staff_male");
    await editor.getByRole("button", { name: "Applica alla bozza", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
    // Dal picker della stanza staff: gli alloggiati altrove compatibili compaiono (Davide dopo aver indicato il sesso).
    await elsewhereGroup(page).locator(".rp-person", { hasText: "Davide Bianchi" }).click();
    const person = page.getByRole("dialog", { name: "Davide Bianchi", exact: true });
    await person.waitFor();
    // La select sta dentro la sua label: il nome accessibile include le opzioni, si cerca dalla label.
    await person.locator("label", { hasText: "Genere dell’accompagnatore" }).locator("select").selectOption("male");
    const destination = person.locator(".rp-destinations button", { has: page.locator("strong", { hasText: /^110$/u }) });
    assert.equal(await destination.isDisabled(), false, "la stanza staff è assegnabile");
    assert.ok((await destination.innerText()).includes("4 posti liberi"));
    const boysRoom = person.locator(".rp-destinations button", { has: page.locator("strong", { hasText: /^101$/u }) });
    assert.equal(await boysRoom.isDisabled(), true, "una stanza ragazzi no");
    await shot(page, "s3-assegna-staff", 390);
    await destination.click();
    await person.waitFor({ state: "hidden" });
    await page.getByText("Davide Bianchi assegnato alla stanza 110.", { exact: true }).waitFor();
    assert.deepEqual(await elsewhereNames(page), ["Ester Viola"], "Davide esce dagli alloggiati altrove");
    assert.equal(await assignedStat(page), "1 / 5", "Davide assegnato conta");
    // Picker della stanza 110: Ester è nel gruppo «Alloggiati altrove» ma senza sesso indicato non è compatibile.
    await saveDraft(page);
    const saved = await roomsPlanOf(D);
    assert.equal(saved.staffElsewhere, true);
    assert.equal(saved.assignments.manual_davide, saved.rooms.find((room) => room.name === "110").id);
    assert.equal(saved.adultGenders.manual_davide, "male");
    // Rimuovendo l'assegnazione torna tra gli alloggiati altrove.
    await planner(page).locator(".rp-occupant button", { hasText: "Davide Bianchi" }).first().click();
    const again = page.getByRole("dialog", { name: "Davide Bianchi", exact: true });
    await again.getByRole("button", { name: "Rimuovi assegnazione", exact: true }).click();
    await page.getByText("Davide Bianchi torna tra gli alloggiati altrove.", { exact: true }).waitFor();
    assert.deepEqual(await elsewhereNames(page), ADULTS);
    await undoButton(page).click();
  });
  assertClean(watch, "S3");
});

// ---- S4 ------------------------------------------------------------------------------------
scenario("S4 riepilogo «Alloggio» nella tab Stanze: testo, invito, «Modifica» con bozza stanze intatta", { timeout: 300000 }, async (t) => {
  const { page, watch } = await openPage(actors.admin);
  const lodging = page.locator("article.rp-lodging");

  await step(t, "attività con testo: il riepilogo lo mostra; senza bozza «Modifica» apre subito l'editor", async () => {
    await openRooms(page, B);
    assert.equal((await lodging.locator("p").innerText()).trim(), LODGING_B);
    await eachWidth(page, async (width) => {
      await assertLayout(page, `S4 riepilogo alloggio ${width}`);
      await checkTarget(lodging.getByRole("button", { name: "Modifica", exact: true }), `S4 «Modifica» di Alloggio ${width}`);
      await shot(page, "s4-riepilogo-alloggio", width, lodging);
    });
    await lodging.getByRole("button", { name: "Modifica", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Locandina e altre opzioni", exact: true });
    await editor.waitFor();
    assert.equal(await page.getByRole("dialog", { name: "Modifiche alle stanze non salvate", exact: true }).count(), 0, "senza bozza nessun foglio intermedio");
    closed.lodgingFocus.push(["S4 B senza bozza", await lodgingFieldState(page, editor)]);
    await shot(page, "s4-editor-apertura-diretta", 390);
    await editor.getByRole("button", { name: "Torna alla gestione", exact: true }).click();
    await page.getByRole("dialog", { name: "Gestisci attività", exact: true }).waitFor();
    await page.getByRole("dialog", { name: "Gestisci attività", exact: true }).getByRole("button", { name: "Chiudi", exact: true }).last().click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal((await activityRef(B).get()).get("roomsInfo"), LODGING_B, "aprire e chiudere non cambia l'alloggio");
  });

  await step(t, "scheda Dettagli dell'admin: titolo «Alloggio»", async () => {
    await gotoApp(page, `/admin/events/${B}`);
    await page.getByRole("heading", { name: "Alloggio", exact: true }).waitFor();
    const article = page.locator("article", { has: page.getByRole("heading", { name: "Alloggio", exact: true }) });
    assert.equal((await article.locator("p").innerText()).trim(), LODGING_B);
    assert.equal(await page.getByText("Stanze e logistica", { exact: true }).count(), 0);
  });

  await step(t, "attività vuota: invito, bozza stanze non salvata, «Modifica» apre le opzioni con «Alloggio»", async () => {
    await openRooms(page, C);
    assert.equal((await lodging.locator("p").innerText()).trim(), LODGING_INVITE);
    await eachWidth(page, async (width) => {
      await assertLayout(page, `S4 riepilogo alloggio vuoto ${width}`);
      await shot(page, "s4-riepilogo-alloggio-vuoto", width, lodging);
    });
    const dialog = await (async () => {
      await emptyState(page).getByRole("button", { name: "Aggiungi stanze", exact: true }).click();
      return bulkDialog(page);
    })();
    await fillBulk(dialog, { count: 2, first: "A1", capacity: 3, floor: "Terra", category: "staff_female" });
    await submitBulk(dialog);
    await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(await roomNames(page), ["A1", "A2"]);
    assert.equal(await statusText(page), "Modifiche da salvare");

    // Con la bozza stanze non salvata, prima dell'editor il foglio «Modifiche alle stanze non salvate».
    await lodging.getByRole("button", { name: "Modifica", exact: true }).click();
    const guard = page.getByRole("dialog", { name: "Modifiche alle stanze non salvate", exact: true });
    await guard.waitFor();
    assert.equal(await page.getByRole("dialog", { name: "Locandina e altre opzioni", exact: true }).count(), 0, "l'editor non si apre prima della scelta");
    const footer = await guard.locator("footer button").allInnerTexts();
    assert.deepEqual(footer.map((text) => text.trim()), ["Resta nelle stanze", "Modifica l’attività"]);
    await eachWidth(page, async (width) => {
      await assertLayout(page, `S4 foglio stanze non salvate ${width}`);
      await checkTarget(guard.getByRole("button", { name: "Resta nelle stanze", exact: true }), `S4 «Resta nelle stanze» ${width}`);
      await checkTarget(guard.getByRole("button", { name: "Modifica l’attività", exact: true }), `S4 «Modifica l’attività» ${width}`);
      await shot(page, "s4-foglio-stanze-non-salvate", width);
    });
    await guard.getByRole("button", { name: "Resta nelle stanze", exact: true }).click();
    await guard.waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("dialog").count(), 0, "«Resta nelle stanze» non apre l'editor");
    assert.deepEqual(await roomNames(page), ["A1", "A2"], "«Resta nelle stanze» non cambia la bozza");
    assert.equal(await statusText(page), "Modifiche da salvare");
    assert.equal(await undoButton(page).isDisabled(), false, "la cronologia della bozza resta");
    // Anche la matita dell'attività passa dallo stesso foglio; Escape equivale a restare.
    await page.getByRole("button", { name: "Modifica attività", exact: true }).click();
    await guard.waitFor();
    await page.keyboard.press("Escape");
    await guard.waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.deepEqual(await roomNames(page), ["A1", "A2"]);

    await lodging.getByRole("button", { name: "Modifica", exact: true }).click();
    await guard.waitFor();
    await guard.getByRole("button", { name: "Modifica l’attività", exact: true }).click();
    await guard.waitFor({ state: "hidden" });
    const editor = page.getByRole("dialog", { name: "Locandina e altre opzioni", exact: true });
    await editor.waitFor();
    // «Modifica» del riepilogo apre l'editor sul passo del campo «Alloggio», con il cursore nel campo, senza «Continua».
    // Il suggerimento sta dentro la label: il nome accessibile del campo è «Alloggio» più il suggerimento.
    const field = lodgingField(page, editor);
    closed.lodgingFocus.push(["S4 C dopo il foglio stanze non salvate", await lodgingFieldState(page, editor)]);
    assert.ok(await field.isVisible(), "il campo «Alloggio» deve essere visibile all'apertura");
    const fieldLabel = editor.locator("label.field", { has: page.locator(".field__label", { hasText: /^Alloggio$/u }) });
    const accessibleName = await field.evaluate((element) => (element.closest("label")?.textContent || "").replace(/\s+/gu, " ").trim());
    if (accessibleName !== "Alloggio") softNotes.push(`S4: il nome accessibile del campo è «${accessibleName.slice(0, 140)}» (suggerimento dentro la label)`);
    assert.ok((await fieldLabel.innerText()).includes(LODGING_HINT), "suggerimento sulla visibilità sotto il campo");
    assert.equal(await editor.getByText("Tende / logistica", { exact: true }).count(), 0);
    await field.fill(LODGING_C);
    await eachWidth(page, async (width) => {
      await assertLayout(page, `S4 editor campo alloggio ${width}`);
      await field.evaluate((element) => element.scrollIntoView({ block: "center" }));
      await shot(page, "s4-editor-alloggio", width);
    });
    await checkFieldSizes(fieldLabel, "S4 campo «Alloggio» dell'editor");
    // «Salva modifiche» deve essere raggiungibile come per un utente (click reale, a 320, 390 e 430 px).
    const submit = editor.getByRole("button", { name: "Salva modifiche", exact: true });
    for (const width of [...WIDTHS, 390]) {
      await setWidth(page, width);
      const geometry = await submit.evaluate((element) => {
        element.scrollIntoView({ block: "center" });
        const rect = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
        const dialog = element.closest('[role="dialog"]');
        const back = [...dialog.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Indietro");
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return { submit: rect(element), back: rect(back), actions: rect(element.closest(".form-stepper__actions")), footer: rect(dialog.querySelector(".app-modal__footer")), hit: `${hit?.tagName?.toLowerCase()}.${String(hit?.className || "").slice(0, 40)} «${(hit?.textContent || "").trim().slice(0, 24)}»`, ok: hit === element || element.contains(hit) };
      });
      finishChecks += 1;
      if (!geometry.ok) finishDefects.push(`S4 «Salva modifiche» dell'editor coperto @${width}px: ${JSON.stringify(geometry)}`);
      if (width !== 390) await shot(page, "s4-editor-salva-modifiche", width);
    }
    await shot(page, "s4-editor-salva-modifiche", 390);
    try {
      await submit.click({ timeout: 5000 });
    } catch (error) {
      finishDefects.push(`S4 «Salva modifiche» dell'editor non cliccabile a 390 px: ${String(error.message).split("\n").filter((line) => /intercepts|Timeout/u.test(line)).slice(0, 2).join(" ")}`);
      // Per verificare il resto dello scenario si invia il modulo come farebbe la tastiera.
      await submit.evaluate((element) => element.click());
    }
    // Salvato, l'editor torna alla panoramica («Gestisci attività» per un'attività pubblica).
    const overview = page.getByRole("dialog", { name: "Gestisci attività", exact: true });
    await overview.getByText("Modifiche salvate.", { exact: true }).waitFor({ timeout: 30000 });
    await overview.getByRole("button", { name: "Chiudi", exact: true }).last().click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  });

  await step(t, "dopo il salvataggio: riepilogo aggiornato, bozza stanze intatta e ancora da salvare", async () => {
    await lodging.locator("p", { hasText: LODGING_C }).waitFor({ timeout: 20000 });
    assert.equal((await activityRef(C).get()).get("roomsInfo"), LODGING_C);
    assert.deepEqual(await roomNames(page), ["A1", "A2"], "la bozza stanze non salvata resta");
    assert.equal(await statusText(page), "Modifiche da salvare");
    assert.equal(await page.getByRole("dialog").count(), 0, "nessun avviso di modifiche perse");
    assert.equal(await roomsPlanOf(C), null, "la bozza stanze non è stata salvata dall'editor");
    await shot(page, "s4-dopo-salvataggio", 390, lodging);
    // La bozza si salva ancora (revisione 0, nessun conflitto).
    await saveDraft(page);
    assert.equal((await roomsPlanOf(C)).rooms.length, 2);
  });
  assertClean(watch, "S4");
});

// ---- S4b -----------------------------------------------------------------------------------
scenario("S4b «Rendi pubblica» con bozza stanze non salvata: foglio, poi l'editor senza perdere la bozza", { timeout: 240000 }, async (t) => {
  const { page, watch } = await openPage(actors.admin);
  const guard = page.getByRole("dialog", { name: "Modifiche alle stanze non salvate", exact: true });

  await step(t, "«Resta nelle stanze» non cambia nulla; «Modifica l’attività» apre «Controlla e pubblica»", async () => {
    await openRooms(page, E);
    await emptyState(page).getByRole("button", { name: "Aggiungi stanze", exact: true }).click();
    const dialog = bulkDialog(page);
    await fillBulk(dialog, { count: 3, first: "B1", capacity: 2, category: "staff_male" });
    await submitBulk(dialog);
    await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(await roomNames(page), ["B1", "B2", "B3"]);
    await page.getByRole("button", { name: "Rendi pubblica", exact: true }).click();
    await guard.waitFor();
    assert.equal(await page.getByRole("dialog", { name: "Controlla e pubblica", exact: true }).count(), 0);
    await guard.getByRole("button", { name: "Resta nelle stanze", exact: true }).click();
    await guard.waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.deepEqual(await roomNames(page), ["B1", "B2", "B3"]);
    assert.equal(await statusText(page), "Modifiche da salvare");

    await page.getByRole("button", { name: "Rendi pubblica", exact: true }).click();
    await guard.waitFor();
    await guard.getByRole("button", { name: "Modifica l’attività", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Controlla e pubblica", exact: true });
    await editor.waitFor();
    await shot(page, "s4b-editor-controlla-e-pubblica", 390);
    // Si esce senza pubblicare: la x chiude l'editor.
    await editor.getByRole("button", { name: "Chiudi", exact: true }).first().click();
    await editor.waitFor({ state: "hidden" });
    await page.waitForTimeout(500);
    assert.equal((await activityRef(E).get()).get("isPublic"), false, "nessuna pubblicazione");
    assert.deepEqual(await roomNames(page), ["B1", "B2", "B3"], "la bozza stanze resta dopo l'editor");
    assert.equal(await statusText(page), "Modifiche da salvare");
    await saveDraft(page);
    // Salvata la bozza, la matita apre subito l'editor.
    await page.getByRole("button", { name: "Modifica attività", exact: true }).click();
    const overview = page.getByRole("dialog", { name: "La tua bozza", exact: true });
    await overview.waitFor();
    assert.equal(await guard.count(), 0, "con la bozza salvata nessun foglio intermedio");
    // «Esci dalla bozza» è disattivato finché l'editor rilegge l'attività; la x in quel momento non fa nulla.
    await overview.getByRole("button", { name: "Esci dalla bozza", exact: true }).click();
    await overview.waitFor({ state: "hidden" });
  });
  assertClean(watch, "S4b");
});

// ---- S5 ------------------------------------------------------------------------------------
scenario("S5 pagina pubblica dell'attività e /me di un iscritto: sezione «Alloggio»", { timeout: 240000 }, async (t) => {
  await step(t, "pagina pubblica senza accesso", async () => {
    const { page, watch } = await openPage(null);
    await gotoApp(page, `/activities/${B}?stake=${stakeId}`);
    const heading = page.getByRole("heading", { name: "Alloggio", exact: true });
    await heading.waitFor();
    const panel = page.locator(".surface-panel", { has: heading });
    assert.equal((await panel.locator("p").innerText()).trim(), LODGING_B);
    assert.equal(await page.getByText("Camere o posti letto", { exact: true }).count(), 0);
    await eachWidth(page, async (width) => {
      await assertLayout(page, `S5 pagina pubblica ${width}`);
      await shot(page, "s5-pubblica-alloggio", width, panel);
    });
    assertClean(watch, "S5 pubblica");
  });

  await step(t, "/me della giovane iscritta", async () => {
    const { page, watch } = await openPage(actors.giulia);
    await gotoApp(page, `/me/activities/${B}`);
    const term = page.locator("dt", { hasText: /^Alloggio$/u });
    await term.waitFor();
    assert.equal((await term.locator("xpath=following-sibling::dd[1]").innerText()).trim(), LODGING_B);
    assert.equal(await page.locator("dt", { hasText: /^Logistica$/u }).count(), 0);
    await eachWidth(page, async (width) => {
      await assertLayout(page, `S5 /me ${width}`);
      await shot(page, "s5-me-alloggio", width, term);
    });
    assertClean(watch, "S5 /me");
  });
});

// ---- S6 ------------------------------------------------------------------------------------
// Esito finale delle misure raccolte in tutti gli scenari a 320, 390 e 430 px.
scenario("S6 finitura: nessuno scroll orizzontale", { timeout: 30000 }, async () => {
  assert.ok(layoutChecks >= 20, `controlli di layout eseguiti: ${layoutChecks}`);
  assert.deepEqual(layoutDefects, [], `${layoutDefects.length} superfici con overflow su ${layoutChecks} controlli`);
});
scenario("S6 difetti del giro precedente chiusi: bottone del problema, filtro, errore unico, «Modifica» di Alloggio", { timeout: 30000 }, async (t) => {
  await t.test("bottone «Accompagnatori alloggiati altrove» del problema ≥ 44 px a 320, 390, 430", () => {
    assert.deepEqual(closed.problemButtonHeights.map(([width]) => width), WIDTHS);
    assert.ok(closed.problemButtonHeights.every(([, height]) => height >= 43.5), JSON.stringify(closed.problemButtonHeights));
  });
  await t.test("«Filtra per categoria» a 16 px a 320, 390, 430", () => {
    assert.deepEqual(closed.filterSelectSizes.map(([width]) => width), WIDTHS);
    assert.ok(closed.filterSelectSizes.every(([, size]) => size >= 16), JSON.stringify(closed.filterSelectSizes));
  });
  await t.test("l'errore di un foglio aperto compare una volta sola", () => {
    assert.equal(closed.sheetAlertCounts.length, 2);
    assert.ok(closed.sheetAlertCounts.every(([, count]) => count === 1), JSON.stringify(closed.sheetAlertCounts));
  });
  await t.test("«Modifica» di Alloggio: campo visibile senza «Continua», cursore nel campo", () => {
    for (const [label, state] of closed.lodgingFocus) softNotes.push(`S6 apertura di Alloggio, ${label}: ${JSON.stringify(state)}`);
    assert.equal(closed.lodgingFocus.length, 2, JSON.stringify(closed.lodgingFocus));
    for (const [label, state] of closed.lodgingFocus) {
      assert.equal(state.immediate.visible, true, `${label}: campo non visibile all'apertura ${JSON.stringify(state)}`);
      assert.equal(state.continueButtons, 0, `${label}: l'editor non è sull'ultimo passo ${JSON.stringify(state)}`);
      assert.equal(state.inView, true, `${label}: campo fuori dalla vista del foglio ${JSON.stringify(state)}`);
      assert.equal(state.settled.arrived, true, `${label}: il cursore non arriva nel campo entro 10 s ${JSON.stringify(state)}`);
      assert.equal(state.settled.focused, true, `${label}: il cursore non resta nel campo dopo la rilettura ${JSON.stringify(state)}`);
      assert.equal(state.settled.disabled, false, `${label}: campo ancora disattivato ${JSON.stringify(state)}`);
    }
  });
});
scenario("S6 finitura: pulsanti e spunte nuovi ≥ 44 px, campi del foglio a 16 px, foglio usabile a 320 px", { timeout: 30000 }, async () => {
  assert.ok(finishChecks >= 20, `controlli di finitura eseguiti: ${finishChecks}`);
  assert.deepEqual(finishDefects, [], `${finishDefects.length} difetti di finitura su ${finishChecks} controlli`);
});
