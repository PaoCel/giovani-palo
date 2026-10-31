// Collaudo browser indipendente del quarto incremento di docs/ATTIVITA_MODULARI.md:
// comitati e gruppi liberi su ogni tipo di attività. App vera (vite, componenti
// originali), Auth, Firestore e Functions degli emulatori; non si inietta nulla,
// se non un ritardo opzionale sulla callable `roster` per allargare la finestra
// di osservazione del cambio account.
//
// Lancio (porte e progetto demo a scelta, vite con VITE_USE_EMULATORS=true e
// VITE_EMULATOR_PROJECT_ID=<stesso demo-*>, stesse porte degli emulatori):
//   firebase emulators:exec --only auth,firestore,functions --project demo-xxx \
//     --config <config> "QA_BASE_URL=http://127.0.0.1:<vite> \
//     CAMP_FUNCTIONS_HOST=127.0.0.1:<porta functions> PLAYWRIGHT_MODULE=<.../playwright-core/index.mjs> \
//     QA_ARTIFACT_DIR=<cartella screenshot> node --test functions/tests/campCommitteesFreeBrowser.test.mjs"
import { before, after, test } from "node:test";
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
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const adminApp = initializeApp({ projectId }, `comitati-browser-${randomUUID()}`);
const db = getFirestore(adminApp);
const adminAuth = getAuth(adminApp);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const browser = await chromium.launch();

const suffix = randomUUID().replace(/-/gu, "").slice(0, 10);
const stakeId = `qa-comitati-browser-${suffix}`;
const password = "qa-comitati-browser-only123";
const WIDTHS = [320, 390, 430];
const HEIGHT = { 320: 640, 390: 844, 430: 932 };
const HISTORIC_TITLES = ["Logistica e Materiali", "Benessere e Supporto", "Cucina", "Giochi e Attività", "Pensieri Spirituali e Serate"];
const HISTORIC_IDS = ["logistics", "wellbeing", "kitchen", "games", "spiritual"];
const PERMISSION_DENIED = /permission-denied|Missing or insufficient permissions/iu;
const EMOJI = /\p{Extended_Pictographic}/u;
const INCARICO_H = "Servire le colazioni di H alle sette";

// Attività (id) e persone. Ogni scenario ha la sua attività, così un fallimento
// non ne contamina un altro; B e C servono a più scenari (vedi i commenti).
const A = `viaggio-a-${suffix}`; // S1, S8: admin su viaggio, piano mai salvato
const B = `viaggio-b-${suffix}`; // S4, S5, S7: dirigente salva, giovane vede
const C = `viaggio-c-${suffix}`; // S5: secondo viaggio senza piano salvato
const D = `viaggio-d-${suffix}`; // S2: limite di 20 comitati
const E = `campeggio-e-${suffix}`; // S6: campeggio
const F = `viaggio-f-${suffix}`; // S7: piano con nomi esclusivi
const G = `viaggio-g-${suffix}`; // S3: uscita con modifiche non salvate
const H = `viaggio-h-${suffix}`; // S7: piano già salvato con Giulia in «Cucina» e nel «Gruppo 1»
const I = `viaggio-i-${suffix}`; // S5b: il piano viene salvato dopo la prima visita del giovane
const J = `viaggio-j-${suffix}`; // S10: altri modali dell'app (nessuna scrittura)
const actors = {};
const contexts = [];
const softNotes = [];
const iso = (value = Date.now()) => new Date(value).toISOString();

const activityRef = (id) => db.doc(`stakes/${stakeId}/activities/${id}`);
const planRef = (id) => db.doc(`stakes/${stakeId}/activities/${id}/management/camp`);
async function planOf(id) {
  const snapshot = await planRef(id).get();
  return snapshot.exists ? snapshot.data() : null;
}
async function registrationsOf(id) {
  const snapshot = await activityRef(id).collection("registrations").get();
  return new Map(snapshot.docs.map((document) => [document.id, document.data()]));
}
const PROJECTION_KEYS = ["assignedCommittees", "assignedPatrolId", "assignedPatrolName", "assignedPatrolRole", "updatedAt"];
const stable = (data) => Object.fromEntries(Object.entries(data).filter(([key]) => !PROJECTION_KEYS.includes(key)));

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
    assignedCommittees: [],
    assignedPatrolId: null,
    assignedPatrolName: null,
    assignedPatrolRole: null,
    createdAt: "2026-10-26T10:00:00.000Z",
    updatedAt: "2026-10-26T10:00:00.000Z",
    ...extra,
  };
}

async function seedActivity(id, type, title, { people = [], extra = {} } = {}) {
  await activityRef(id).set({
    title,
    activityType: type,
    status: "registrations_open",
    isPublic: true,
    isVisible: true,
    startDate: "2026-11-20T09:00:00.000Z",
    endDate: "2026-11-22T17:00:00.000Z",
    overnight: true,
    ...extra,
  });
  const common = {
    [`user_${actors.giulia.uid}`]: registrationDoc("Giulia", "Rossi", { userId: actors.giulia.uid, genderRoleCategory: "giovane_donna" }),
    manual_anna: registrationDoc("Anna", "Verdi", { genderRoleCategory: "giovane_donna" }),
    manual_bruno: registrationDoc("Bruno", "Neri", { unitId: "unit-b", unitNameSnapshot: "Unità B" }),
    manual_dario: registrationDoc("Dario", "Gialli"),
    manual_carla: registrationDoc("Carla", "Blu", { genderRoleCategory: "giovane_donna", registrationStatus: "cancelled", status: "cancelled" }),
    manual_ester: registrationDoc("Ester", "Viola", { genderRoleCategory: "accompagnatore", birthDate: "1985-03-03" }),
  };
  for (const [registrationId, data] of Object.entries({ ...common, ...Object.fromEntries(people) })) {
    await activityRef(id).collection("registrations").doc(registrationId).set(data);
  }
}

before(async () => {
  await db.doc(`stakes/${stakeId}`).set({ name: "Palo QA comitati", slug: stakeId, isActive: true });
  const defs = [
    ["admin", "admin", "Paola", "Admin", "dirigente", null],
    ["leader", "unit_leader", "Luca", "Dirigente", "dirigente", "unit-a"],
    ["giulia", "participant", "Giulia", "Rossi", "giovane_donna", "unit-a"],
    ["marco", "participant", "Marco", "Bianchi", "giovane_uomo", "unit-b"],
  ];
  for (const [name, role, firstName, lastName, category, unitId] of defs) {
    const user = await adminAuth.createUser({ uid: `qa-comitati-${name}-${suffix}`, email: `${name}-${suffix}@example.invalid`, password, emailVerified: true });
    actors[name] = { uid: user.uid, email: user.email, name: `${firstName} ${lastName}` };
    await db.doc(`users/${user.uid}`).set({
      firstName, lastName, fullName: `${firstName} ${lastName}`, email: user.email, role, stakeId, stakeName: "Palo QA comitati",
      birthDate: category.startsWith("giovane") ? "2010-05-05" : "1985-03-03", genderRoleCategory: category,
      // Il profilo senza unità è «da completare»: l'app chiederebbe i dati prima di entrare.
      unitName: unitId === "unit-a" ? "Unità A" : unitId === "unit-b" ? "Unità B" : "Presidenza di palo",
      unitId: unitId ?? "", stakeSlug: stakeId,
      // Profilo completo come quello vero: all'accesso l'app lo riscrive (merge) e le rules lo validano.
      createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z", lastLoginAt: "2026-10-01T10:00:00.000Z",
      city: "Città QA", phone: "3330000000", mustChangePassword: false,
    });
    await db.doc(`stakes/${stakeId}/members/${user.uid}`).set({
      status: "active", staffRole: role === "participant" ? null : role, ...(unitId ? { claimedUnitId: unitId } : {}),
    });
  }
  const marcoRegistration = [[`user_${actors.marco.uid}`, registrationDoc("Marco", "Bianchi", { userId: actors.marco.uid, unitId: "unit-b", unitNameSnapshot: "Unità B" })]];
  await seedActivity(A, "trip", "Viaggio QA A", {});
  await seedActivity(B, "trip", "Viaggio QA B", {
    people: [
      ...marcoRegistration,
      // Iscrizione legacy senza registrationStatus: resta nell'elenco nomi.
      ["manual_leo", (() => { const data = registrationDoc("Leo", "Legacy"); delete data.registrationStatus; return data; })()],
      // Solo `status: cancelled` (senza registrationStatus): esclusa dall'elenco nomi.
      ["manual_nora", (() => { const data = registrationDoc("Nora", "Stato", { genderRoleCategory: "giovane_donna", status: "cancelled" }); delete data.registrationStatus; return data; })()],
    ],
  });
  await seedActivity(C, "trip", "Viaggio QA C", { people: marcoRegistration });
  await seedActivity(I, "trip", "Viaggio QA I", { people: marcoRegistration });
  await seedActivity(J, "trip", "Viaggio QA J", { people: marcoRegistration });
  await seedActivity(D, "trip", "Viaggio QA D");
  await seedActivity(E, "camp", "Campeggio QA E");
  await seedActivity(G, "trip", "Viaggio QA G");
  // F: piano già salvato con nomi che esistono solo qui (osservazione del cambio account).
  await seedActivity(F, "trip", "Viaggio QA F", {
    people: [["manual_zaira", registrationDoc("Zaira", "Esclusiva", { genderRoleCategory: "giovane_donna", assignedCommittees: [{ id: "c_secretf0001", title: "Squadra Segreta F", role: "member" }] })]],
  });
  // H: un piano come quello che salva l'app, indipendente da S4, per le prove di cambio contesto.
  await seedActivity(H, "trip", "Viaggio QA H", {
    people: [...marcoRegistration, [`user_${actors.giulia.uid}`, registrationDoc("Giulia", "Rossi", {
      userId: actors.giulia.uid, genderRoleCategory: "giovane_donna",
      assignedCommittees: [{ id: "kitchen", title: "Cucina", role: "member" }], assignedPatrolId: "patrol-h1", assignedPatrolName: "Gruppo 1", assignedPatrolRole: "member",
    })]],
  });
  const giuliaPublic = { registrationId: `user_${actors.giulia.uid}`, fullName: "Giulia Rossi", genderRoleCategory: "giovane_donna", unitName: "Unità A", role: "member" };
  await planRef(H).set({
    groupLabel: "gruppo",
    committees: HISTORIC_IDS.map((id, index) => ({
      id, title: HISTORIC_TITLES[index], responsibilities: id === "kitchen" ? INCARICO_H : "",
      leaderRegistrationIds: [], manualLeaderIds: [], memberRegistrationIds: id === "kitchen" ? [`user_${actors.giulia.uid}`] : [],
      publicMembers: id === "kitchen" ? [giuliaPublic] : [], updatedAt: "2026-10-26T10:00:00.000Z",
    })),
    patrols: [{ id: "patrol-h1", name: "Gruppo 1", leaderRegistrationId: "", supervisorRegistrationIds: [], manualSupervisorIds: [], memberRegistrationIds: [`user_${actors.giulia.uid}`], publicMembers: [giuliaPublic], updatedAt: "2026-10-26T10:00:00.000Z" }],
    manualLeaders: [], updatedAt: "2026-10-26T10:00:00.000Z", savedAt: "2026-10-26T10:00:00.000Z",
  });
  await planRef(F).set({
    groupLabel: "gruppo",
    committees: [{
      id: "c_secretf0001", title: "Squadra Segreta F", responsibilities: "Incarico riservato di F",
      leaderRegistrationIds: [], manualLeaderIds: [], memberRegistrationIds: ["manual_zaira"],
      publicMembers: [{ registrationId: "manual_zaira", fullName: "Zaira Esclusiva", genderRoleCategory: "giovane_donna", unitName: "Unità A", role: "member" }],
      updatedAt: "2026-10-26T10:00:00.000Z",
    }],
    patrols: [], manualLeaders: [], updatedAt: "2026-10-26T10:00:00.000Z", savedAt: "2026-10-26T10:00:00.000Z",
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
function attachWatch(page) {
  const watch = { console: [], pageErrors: [], requests: [], responses: [], external: [], callableBodies: [] };
  page.on("console", (message) => watch.console.push({ type: message.type(), text: message.text() }));
  page.on("pageerror", (error) => watch.pageErrors.push(String(error?.message || error)));
  page.on("request", (request) => {
    let body = "";
    try { body = request.postData() || ""; } catch { body = ""; }
    watch.requests.push({ method: request.method(), url: request.url(), port: new URL(request.url()).port, body });
  });
  page.on("response", (response) => {
    watch.responses.push({ url: response.url(), status: response.status() });
    // Esito delle callable dei comitati (per capire un 400 o un permesso negato).
    if (/\/campManagement(Staff|Save)/u.test(response.url())) {
      void response.text().then((text) => watch.callableBodies.push({ status: response.status(), text, request: response.request().postData() || "" })).catch(() => undefined);
    }
  });
  return watch;
}
const firestoreRequests = (watch, from = 0) => watch.requests.slice(from).filter((request) => request.port === String(firestoreHost.port));
const callableRequests = (watch, name, from = 0) => watch.requests.slice(from).filter((request) => request.port === String(functionsHost.port) && request.url.includes(`/${name}`) && request.method === "POST");
// Bersagli aperti da una richiesta Firestore (WebChannel Listen): query su una collezione o letture di documenti.
function listenTargets(request) {
  const targets = [];
  for (const [key, value] of new URLSearchParams(request.body)) {
    if (!/^req\d+___data__$/u.test(key)) continue;
    let payload;
    try { payload = JSON.parse(value); } catch { continue; }
    const add = payload.addTarget;
    if (!add) continue;
    if (add.query) {
      const [from] = add.query.structuredQuery?.from ?? [];
      targets.push({ kind: "query", collection: from?.collectionId ?? "", allDescendants: from?.allDescendants === true, parent: add.query.parent ?? "", where: JSON.stringify(add.query.structuredQuery?.where ?? null) });
    } else if (add.documents) {
      for (const path of add.documents.documents ?? []) targets.push({ kind: "documents", path });
    }
  }
  return targets;
}
// Letture di registrazioni attività via SDK: una query su `registrations` (anche collectionGroup), non il singolo documento.
const registrationQueries = (watch, from = 0) => firestoreRequests(watch, from).flatMap(listenTargets).filter((target) => target.kind === "query" && target.collection === "registrations");
// Una query «completa» sulle iscrizioni è quella senza filtro su unitId, parentUid o userId: è ciò che un
// dirigente di unità non deve fare dalla pagina comitati (l'elenco completo contiene dati sanitari).
const isScopedRegistrationQuery = (target) => /"fieldPath":"(unitId|parentUid|userId)"/u.test(target.where);
const unscopedRegistrationQueries = (watch, from = 0) => registrationQueries(watch, from).filter((target) => !isScopedRegistrationQuery(target));
const registrationDocuments = (watch, from = 0) => firestoreRequests(watch, from).flatMap(listenTargets).filter((target) => target.kind === "documents" && /\/registrations\//u.test(target.path));

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
    // Unica eccezione ammessa, e solo con QA_ALLOW_FONTS=1: i CSS e i file dei font di Google (GET statici),
    // così misure e screenshot usano Manrope e Fraunces veri. Senza, restano i font di sistema.
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
// Navigazione lato client (nessun ricaricamento): è quella che può far restare a schermo dati vecchi.
async function spaNavigate(page, path) {
  // Stesso router dell'app (modulo condiviso): equivale al click su un collegamento interno, con URL e
  // rendering sincronizzati come in uso reale, a differenza di un pushState a mano.
  await page.evaluate(async (target) => {
    const { router } = await import("/src/routes/router.tsx");
    await router.navigate(target);
  }, path);
}

const bodyText = (page) => page.locator("body").innerText();
// Testo dell'app senza i menu a tendina: innerText di una select include tutte le opzioni.
const appText = (page) => page.evaluate(() => {
  const copy = document.body.cloneNode(true);
  copy.querySelectorAll("select, script, style").forEach((element) => element.remove());
  return copy.textContent ?? "";
});
const openPages = [];
// Un test fallito lascia screenshot e testo di ogni pagina aperta tra gli artefatti.
async function dumpPages(name) {
  for (const [index, page] of openPages.entries()) {
    if (page.isClosed()) continue;
    if (artifactDir) await page.screenshot({ path: `${artifactDir}/FAIL-${name.replace(/[^a-z0-9]+/giu, "-").slice(0, 40)}-${index}.png` }).catch(() => undefined);
    const text = await page.locator("body").innerText().catch(() => "");
    console.log(`# FAIL "${name}" pagina ${index} ${page.url()}\n# ${text.replace(/\s+/gu, " ").slice(0, 700)}`);
    const watch = watches.get(page);
    if (watch) {
      const tail = watch.console.filter((entry) => ["error", "warning"].includes(entry.type)).slice(-6).map((entry) => `${entry.type}: ${entry.text.slice(0, 220)}`);
      console.log(`# CONSOLE ${JSON.stringify(tail)} PAGEERRORS ${JSON.stringify(watch.pageErrors.slice(-3))}`);
    }
  }
}
const watches = new Map();
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
async function eachWidth(page, label, fn) {
  for (const width of WIDTHS) {
    await setWidth(page, width);
    await fn(width);
  }
  await setWidth(page, 390);
  void label;
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

// Nessun overflow orizzontale: documento, corpo e fogli. Gli elementi che sporgono
// dal bordo (fuori da contenitori scorrevoli) sono note, non fallimenti.
async function assertLayout(page, label) {
  const result = await page.evaluate(() => {
    const doc = document.documentElement;
    const viewport = doc.clientWidth;
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map((element) => {
        // Chi sporge: i discendenti il cui bordo destro supera quello del foglio.
        const edge = element.getBoundingClientRect().right;
        const offenders = [...element.querySelectorAll("*")]
          .filter((child) => child.getBoundingClientRect().right > edge + 1 && child.getBoundingClientRect().width > 1)
          .slice(0, 4)
          .map((child) => `${child.tagName.toLowerCase()}.${String(child.className).slice(0, 30)}"${(child.textContent || "").trim().slice(0, 24)}"@${Math.round(child.getBoundingClientRect().right)}`);
        return `${element.querySelector("h2")?.textContent}:${element.scrollWidth}>${element.clientWidth} [${offenders.join(" | ")}]`;
      });
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
    return { docScroll: doc.scrollWidth, bodyScroll: document.body.scrollWidth, viewport, dialogs, outside: outside.slice(0, 6) };
  });
  // Le misure si raccolgono e si valutano nello scenario S8 finale: un overflow non ferma gli altri scenari.
  if (result.docScroll > result.viewport) layoutDefects.push(`${label}: scrollWidth ${result.docScroll} > ${result.viewport}`);
  if (result.bodyScroll > result.viewport) layoutDefects.push(`${label}: body ${result.bodyScroll} > ${result.viewport}`);
  for (const dialog of result.dialogs) layoutDefects.push(`${label}: foglio con overflow orizzontale ${dialog}`);
  if (result.outside.length) softNotes.push(`${label} @${result.viewport}px: elementi oltre il bordo ${result.outside.join(", ")}`);
  layoutChecks += 1;
}
const layoutDefects = [];
let layoutChecks = 0;
// Piede dei fogli di comitati e gruppi (camp-sheet-footer): tutti i pulsanti dentro il foglio, alti almeno 44 px,
// la x di chiusura intera nello schermo; sotto i 720 px uno sotto l'altro con il principale per primo e
// l'eliminazione in fondo, da 720 px su una riga.
async function assertSheetFooter(page, label) {
  const info = await page.evaluate(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find((element) => element.querySelector(".camp-sheet-actions"));
    if (!dialog) return null;
    const box = dialog.getBoundingClientRect();
    const rect = (element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    const close = dialog.querySelector(".app-modal__header .icon-button");
    return {
      viewport: document.documentElement.clientWidth,
      dialog: rect(dialog),
      close: close ? rect(close) : null,
      buttons: [...dialog.querySelectorAll(".camp-sheet-actions .button")].map((button) => ({
        text: (button.textContent || "").trim(), primary: button.classList.contains("button--primary"), danger: button.classList.contains("button--danger"), ...rect(button),
      })),
      boxLeft: box.left, boxRight: box.right,
    };
  });
  layoutChecks += 1;
  if (!info) { layoutDefects.push(`${label}: foglio con piede comitati/gruppi non trovato`); return; }
  const problems = [];
  const inside = (r) => r.left >= info.boxLeft - 0.5 && r.right <= info.boxRight + 0.5 && r.right <= info.viewport + 0.5;
  if (info.close && !inside(info.close)) problems.push(`x di chiusura fuori (${Math.round(info.close.right)} > ${Math.round(Math.min(info.boxRight, info.viewport))})`);
  if (info.close && (info.close.width < 43.5 || info.close.height < 43.5)) problems.push(`x di chiusura ${Math.round(info.close.width)}x${Math.round(info.close.height)} < 44`);
  for (const button of info.buttons) {
    if (!inside(button)) problems.push(`«${button.text}» fuori dal foglio (${Math.round(button.left)}-${Math.round(button.right)})`);
    if (button.height < 43.5) problems.push(`«${button.text}» alto ${Math.round(button.height)} < 44`);
  }
  if (info.viewport < 720) {
    const stacked = info.buttons.every((button, index) => index === 0 || button.top >= info.buttons[index - 1].bottom - 0.5);
    if (!stacked) problems.push(`sotto 720 px i pulsanti non sono impilati: ${info.buttons.map((button) => `${button.text}@${Math.round(button.top)}`).join(", ")}`);
    if (info.buttons.length && !info.buttons[0].primary) problems.push(`il principale non è il primo: ${info.buttons[0].text}`);
    const danger = info.buttons.filter((button) => button.danger);
    if (danger.length && !info.buttons.at(-1).danger) problems.push("l'eliminazione non è in fondo");
  } else {
    const row = info.buttons.every((button) => Math.abs(button.top - info.buttons[0].top) < 1);
    if (!row) problems.push(`da 720 px i pulsanti non stanno su una riga: ${info.buttons.map((button) => `${button.text}@${Math.round(button.top)}`).join(", ")}`);
  }
  for (const problem of problems) layoutDefects.push(`${label} @${info.viewport}px: ${problem}`);
}
async function assertFieldSizes(scope) {
  const sizes = await scope.locator("input:not([type=checkbox]):not([type=radio]), textarea, select").evaluateAll((elements) => elements.map((element) => parseFloat(getComputedStyle(element).fontSize)));
  assert.ok(sizes.length > 0 && sizes.every((size) => size >= 16), `campi sotto i 16 px: ${sizes}`);
}
// Bersaglio di tocco >= 44 px e davvero cliccabile (elementFromPoint dentro l'area).
async function assertTouchTarget(locator, label) {
  // Al centro dello schermo: ai bordi la barra in alto o quella in basso (fisse) coprirebbero il bersaglio.
  await locator.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const info = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    // Punti dentro l'area anche per i bottoni arrotondati (gli angoli di un cerchio non sono toccabili).
    const at = (fx, fy) => [rect.left + rect.width * fx, rect.top + rect.height * fy];
    const probes = [at(0.5, 0.5), at(0.25, 0.25), at(0.75, 0.25), at(0.25, 0.75), at(0.75, 0.75), [rect.left + rect.width / 2, rect.top + 3], [rect.left + rect.width / 2, rect.bottom - 3], [rect.left + 3, rect.top + rect.height / 2], [rect.right - 3, rect.top + rect.height / 2]];
    const hits = probes.map(([x, y]) => { const hit = document.elementFromPoint(x, y); return hit === element || element.contains(hit); });
    return { width: rect.width, height: rect.height, hits };
  });
  assert.ok(info.width >= 43.5 && info.height >= 43.5, `${label}: ${info.width}x${info.height} < 44x44`);
  assert.ok(info.hits.every(Boolean), `${label}: parte dell'area non è l'elemento cliccabile ${info.hits}`);
}
function assertClean(watch, label, { from = { console: 0, pageErrors: 0 } } = {}) {
  const consoleErrors = watch.console.slice(from.console).filter((entry) => ["error", "warning"].includes(entry.type) && PERMISSION_DENIED.test(entry.text));
  assert.deepEqual(consoleErrors, [], `${label}: permission-denied in console`);
  const pageErrors = watch.pageErrors.slice(from.pageErrors);
  assert.deepEqual(pageErrors, [], `${label}: errori di pagina`);
  // I soli font di Google, bloccati, non contano: tutto il resto fuori dal loopback sì.
  const external = watch.external.filter((url) => !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//u.test(url));
  assert.deepEqual(external, [], `${label}: richieste verso host esterni`);
}

// ---- Pagina comitati ---------------------------------------------------------------------
const cardsOf = (page) => page.locator(".camp-ios-card--committee");
const cardTitles = (page) => cardsOf(page).locator("strong").allInnerTexts();
const cardOf = (page, title) => cardsOf(page).filter({ has: page.locator("strong", { hasText: new RegExp(`^${title}$`, "u") }) });
const pageAdd = (page) => page.locator(".camp-committee-add").getByRole("button", { name: "Aggiungi comitato" });
const saveButton = (page) => page.locator(".admin-roster__head").first().getByRole("button", { name: /^(Salva modifiche|Salvato)$/u });
const metric = (page, label) => page.locator(".admin-inline-metric").filter({ hasText: label }).locator("strong");

async function openCommittees(page, activityId) {
  await gotoApp(page, `/admin/events/${activityId}/comitati`);
  await page.locator(".camp-committee-add").waitFor();
  await page.getByText("Modifiche non ancora salvate").waitFor({ state: "hidden" });
}
async function waitSaved(page) {
  await saveButton(page).filter({ hasText: "Salvato" }).waitFor();
  await page.getByText("Modifiche non ancora salvate").waitFor({ state: "hidden" });
}
async function expectDirty(page, dirty) {
  assert.equal(await page.getByText("Modifiche non ancora salvate").first().isVisible().catch(() => false), dirty);
}
async function openSheet(page, title) {
  await cardOf(page, title).click();
  await page.getByRole("dialog", { name: title, exact: true }).waitFor();
  // Il nome del foglio segue il titolo (si può rinominare): il foglio di un comitato è sempre il primo.
  return page.locator('[role="dialog"]').first();
}
async function closeSheetKeepDraft(page, dialog) {
  await dialog.locator("footer").getByRole("button", { name: /^(Continua dopo|Chiudi)$/u }).click();
  await dialog.waitFor({ state: "hidden" });
}
async function assignYouth(dialog, fullName) {
  const row = dialog.locator("section.camp-modal-section", { has: dialog.page().getByRole("heading", { name: "Giovani", exact: true }) }).locator("label.toggle-field", { hasText: fullName });
  if (!(await row.count())) console.log("# DEBUG", JSON.stringify(await dialog.locator("h3").allInnerTexts()), JSON.stringify(await dialog.locator("label.toggle-field").allInnerTexts()));
  await row.click();
  assert.equal(await row.locator("input").isChecked(), true, `${fullName} deve risultare assegnato`);
}
async function addCommittee(page, title, responsibilities = "") {
  await pageAdd(page).click();
  const dialog = page.getByRole("dialog", { name: "Nuovo comitato", exact: true });
  await dialog.getByLabel("Nome del comitato").fill(title);
  if (responsibilities) await dialog.getByLabel("Cosa deve fare").fill(responsibilities);
  await dialog.getByRole("button", { name: "Aggiungi comitato", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  // Il comitato appena creato si apre per assegnare le persone.
  await page.getByRole("dialog", { name: title, exact: true }).waitFor();
  return page.locator('[role="dialog"]').first();
}
async function confirmDialog(page, title) {
  const dialog = page.getByRole("dialog", { name: title, exact: true });
  await dialog.waitFor();
  return dialog;
}
// Esporta con «Excel» e rilegge il file scaricato (generato dal browser, solo nella cartella temporanea di Playwright).
async function exportExcel(page) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Excel", exact: true }).click()]);
  const XLSX = require("xlsx");
  const workbook = XLSX.readFile(await download.path());
  await page.getByText("Excel comitati e gruppi generato.").waitFor();
  return { name: download.suggestedFilename(), sheets: Object.fromEntries(workbook.SheetNames.map((sheet) => [sheet, XLSX.utils.sheet_to_json(workbook.Sheets[sheet])])) };
}
// «Scarta modifiche» della pagina: rilegge il piano dal server, quindi si aspetta la fine.
async function discardDraft(page) {
  await page.locator(".admin-roster__head").first().getByRole("button", { name: "Scarta modifiche", exact: true }).click();
  const confirm = await confirmDialog(page, "Scartare le modifiche al piano?");
  await confirm.getByRole("button", { name: "Scarta modifiche", exact: true }).click();
  await confirm.waitFor({ state: "hidden" });
  await waitSaved(page);
}
async function save(page) {
  await saveButton(page).filter({ hasText: "Salva modifiche" }).click();
  await waitSaved(page);
}

// ---- S1 ------------------------------------------------------------------------------------
scenario("S1 admin su viaggio: predefiniti, aggiunta, eliminazione con persone, salvataggio e ricarica", { timeout: 300000 }, async (t) => {
  const { page, watch } = await openPage(actors.admin);
  await openCommittees(page, A);
  let newId = "";

  await step(t,"cinque comitati predefiniti, gruppi chiamati «Gruppi», niente staff campeggio", async () => {
    assert.deepEqual(await cardTitles(page), HISTORIC_TITLES);
    // Controllo positivo del rilevatore usato in S4: l'admin legge l'elenco completo e il rilevatore lo vede.
    assert.ok(unscopedRegistrationQueries(watch).some((target) => target.parent.endsWith(`/activities/${A}`)), "il rilevatore deve vedere la lettura completa dell'admin");
    assert.equal(await page.locator(".camp-config-panel select option:checked").innerText(), "Gruppi");
    await page.getByRole("heading", { name: "Gruppi", exact: true }).waitFor();
    await page.getByText("Nessun gruppo", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Aggiungi gruppo", exact: true }).waitFor();
    const text = await appText(page);
    assert.ok(!/pattugli/iu.test(text), "«Pattuglie» non deve comparire su un viaggio");
    assert.ok(!EMOJI.test(text), "nessuna emoji nelle superfici toccate");
    assert.equal(await page.getByText("Chi gestisce il campeggio").count(), 0);
    assert.equal(await saveButton(page).innerText().then((value) => value.trim()), "Salvato");
    await eachWidth(page, "tab comitati", async (width) => {
      await assertLayout(page, `S1 tab comitati ${width}`);
      await shot(page, "s1-tab-comitati", width, page.locator(".camp-committee-grid").first());
    });
  });

  await step(t,"foglio «Nuovo comitato»: Annulla senza testo chiude; con testo chiede di scartare", async () => {
    await pageAdd(page).click();
    const dialog = page.getByRole("dialog", { name: "Nuovo comitato", exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Aggiungi comitato", exact: true }).isDisabled(), true, "senza nome non si aggiunge");
    await assertFieldSizes(dialog);
    await dialog.getByRole("button", { name: "Annulla", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("dialog").count(), 0, "senza testo nessuna conferma");

    await pageAdd(page).click();
    await dialog.getByLabel("Nome del comitato").fill("Accoglienza");
    await dialog.getByLabel("Cosa deve fare").fill("Accogliere chi arriva e fare il primo appello alle partenze");
    await eachWidth(page, "foglio nuovo comitato", async (width) => {
      await assertLayout(page, `S1 foglio nuovo comitato ${width}`);
      await assertSheetFooter(page, `S1 foglio nuovo comitato ${width}`);
      await shot(page, "s1-foglio-nuovo-comitato", width);
    });
    await dialog.getByRole("button", { name: "Annulla", exact: true }).click();
    const discard = await confirmDialog(page, "Scartare il nuovo comitato?");
    await assertLayout(page, "S1 scarta nuovo comitato");
    await discard.getByRole("button", { name: "Continua a modificare", exact: true }).click();
    await discard.waitFor({ state: "hidden" });
    assert.equal(await dialog.getByLabel("Nome del comitato").inputValue(), "Accoglienza");
    await page.keyboard.press("Escape");
    await (await confirmDialog(page, "Scartare il nuovo comitato?")).getByRole("button", { name: "Scarta comitato", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(await cardTitles(page), HISTORIC_TITLES, "nessun comitato aggiunto");
    await expectDirty(page, false);
  });

  await step(t,"aggiungi «Accoglienza» e assegna un giovane; modifica incarico di «Cucina»", async () => {
    const sheet = await addCommittee(page, "Accoglienza", "Accogliere chi arriva e fare il primo appello alle partenze");
    await assertFieldSizes(sheet);
    await assignYouth(sheet, "Neri Bruno");
    // Il foglio del comitato con le liste di persone, a tutte le larghezze.
    await eachWidth(page, "foglio comitato", async (width) => {
      await assertLayout(page, `S1 foglio comitato ${width}`);
      await assertSheetFooter(page, `S1 foglio comitato ${width}`);
      await shot(page, "s1-foglio-comitato", width);
    });
    // Da 720 px il piede torna su una riga (eliminazione a sinistra).
    await page.setViewportSize({ width: 800, height: 900 });
    await assertLayout(page, "S1 foglio comitato 800");
    await assertSheetFooter(page, "S1 foglio comitato 800");
    await shot(page, "s1-foglio-comitato", 800);
    await setWidth(page, 390);
    await closeSheetKeepDraft(page, sheet);
    assert.equal((await cardTitles(page)).length, 6);
    const initials = await cardOf(page, "Accoglienza").locator(".camp-ios-card__icon").innerText();
    assert.equal(initials.trim(), "A", "iniziali al posto dell'emoji");
    const kitchen = await openSheet(page, "Cucina");
    await kitchen.getByLabel("Cosa deve fare").fill("Preparare i pranzi al sacco");
    await assignYouth(kitchen, "Rossi Giulia");
    await closeSheetKeepDraft(page, kitchen);
    await expectDirty(page, true);
    assert.equal(await metric(page, "Con comitato").innerText(), "2");
    // Un gruppo con la stessa persona nel suo comitato: una persona, un solo gruppo.
    await page.getByRole("button", { name: "Aggiungi gruppo", exact: true }).click();
    await page.locator(".camp-ios-card--patrol").filter({ hasText: "Gruppo 1" }).click();
    const group = page.getByRole("dialog", { name: "Gruppo 1", exact: true });
    await group.locator("label.toggle-field", { hasText: "Rossi Giulia" }).click();
    // Stessa famiglia di fogli (piede con tre pulsanti): si misura anche quello del gruppo.
    await eachWidth(page, "foglio gruppo", async (width) => {
      await assertLayout(page, `S1 foglio gruppo ${width}`);
      await assertSheetFooter(page, `S1 foglio gruppo ${width}`);
      await shot(page, "s1-foglio-gruppo", width);
    });
    await group.getByRole("button", { name: "Continua dopo", exact: true }).click();
    await group.waitFor({ state: "hidden" });
  });

  await step(t,"primo salvataggio: piano e proiezioni sul server", async () => {
    const before = await registrationsOf(A);
    await save(page);
    const saved = await planOf(A);
    assert.equal(saved.committees.length, 6);
    newId = saved.committees.find((committee) => committee.title === "Accoglienza").id;
    assert.match(newId, /^c_[a-z0-9]{8,32}$/u);
    assert.equal(saved.groupLabel, "gruppo");
    const after = await registrationsOf(A);
    const projection = (id) => after.get(id).assignedCommittees.map((entry) => entry.id);
    assert.deepEqual(projection("manual_bruno"), [newId]);
    assert.deepEqual(projection(`user_${actors.giulia.uid}`), ["kitchen"]);
    assert.equal(after.get(`user_${actors.giulia.uid}`).assignedPatrolName, "Gruppo 1");
    for (const [id, data] of before) assert.deepEqual(stable(after.get(id)), stable(data), `iscrizione ${id} intatta`);
  });

  await step(t,"eliminazione con persone: la conferma le elenca; «Tieni il comitato» non cambia nulla", async () => {
    const sheet = await openSheet(page, "Accoglienza");
    await sheet.getByRole("button", { name: "Elimina comitato", exact: true }).click();
    const confirm = await confirmDialog(page, "Eliminare il comitato «Accoglienza»?");
    const rows = await confirm.locator(".camp-confirm-people li").allInnerTexts();
    assert.deepEqual(rows.map((row) => row.replace(/\s+/gu, " ").trim()), ["Neri Bruno Giovane"]);
    await eachWidth(page, "conferma eliminazione", async (width) => {
      await assertLayout(page, `S1 conferma eliminazione ${width}`);
      // Sotto la conferma c'è il foglio del comitato con il piede «pulito» (Chiudi invece di Continua dopo).
      await assertSheetFooter(page, `S1 foglio comitato pulito sotto la conferma ${width}`);
      await shot(page, "s1-conferma-eliminazione", width);
    });
    await confirm.getByRole("button", { name: "Tieni il comitato", exact: true }).click();
    await confirm.waitFor({ state: "hidden" });
    assert.equal((await cardTitles(page)).length, 6);
    await expectDirty(page, false);
    await closeSheetKeepDraft(page, sheet);
    assert.equal(await metric(page, "Con comitato").innerText(), "2");
  });

  await step(t,"conferma: persone senza comitato nella bozza; «Scarta modifiche» ripristina", async () => {
    const sheet = await openSheet(page, "Accoglienza");
    await sheet.getByRole("button", { name: "Elimina comitato", exact: true }).click();
    await (await confirmDialog(page, "Eliminare il comitato «Accoglienza»?")).getByRole("button", { name: "Elimina comitato", exact: true }).click();
    await sheet.waitFor({ state: "hidden" });
    assert.equal((await cardTitles(page)).length, 5);
    await expectDirty(page, true);
    assert.equal(await metric(page, "Con comitato").innerText(), "1", "Bruno senza comitato nella bozza");
    assert.equal((await planOf(A)).committees.length, 6, "il server non è cambiato prima di Salva");
    await page.locator(".admin-roster__head").first().getByRole("button", { name: "Scarta modifiche", exact: true }).click();
    const discard = await confirmDialog(page, "Scartare le modifiche al piano?");
    await discard.getByRole("button", { name: "Scarta modifiche", exact: true }).click();
    await discard.waitFor({ state: "hidden" });
    assert.equal((await cardTitles(page)).length, 6);
    assert.equal(await metric(page, "Con comitato").innerText(), "2");
    await expectDirty(page, false);
  });

  await step(t,"rifai ed esegui «Salva modifiche»: server e proiezione svuotata", async () => {
    const sheet = await openSheet(page, "Accoglienza");
    await sheet.getByRole("button", { name: "Elimina comitato", exact: true }).click();
    await (await confirmDialog(page, "Eliminare il comitato «Accoglienza»?")).getByRole("button", { name: "Elimina comitato", exact: true }).click();
    await sheet.waitFor({ state: "hidden" });
    await save(page);
    const saved = await planOf(A);
    assert.deepEqual(saved.committees.map((committee) => committee.id), HISTORIC_IDS);
    const registrations = await registrationsOf(A);
    assert.deepEqual(registrations.get("manual_bruno").assignedCommittees, [], "iscrizione svuotata");
    assert.equal(registrations.get("manual_bruno").registrationStatus, "confirmed", "iscrizione intatta");
    assert.deepEqual(registrations.get(`user_${actors.giulia.uid}`).assignedCommittees.map((entry) => entry.id), ["kitchen"]);
  });

  await step(t,"ricarica pagina: ritrova lo stato salvato", async () => {
    await page.reload();
    await dismissHints(page);
    await page.locator(".camp-committee-add").waitFor();
    assert.deepEqual(await cardTitles(page), HISTORIC_TITLES);
    assert.equal(await metric(page, "Con comitato").innerText(), "1");
    assert.equal((await saveButton(page).innerText()).trim(), "Salvato");
    await expectDirty(page, false);
    assert.ok((await cardOf(page, "Cucina").innerText()).includes("Preparare i pranzi al sacco"));
    await shot(page, "s1-dopo-ricarica", 390, page.locator(".camp-committee-grid").first());
  });

  await step(t,"S8 dirigenti manuali: × e target da 44 px a 320/390/430, rimozione e scarto", async () => {
    await page.getByPlaceholder("Nome e cognome").fill("Rita Provvisoria");
    await page.getByRole("button", { name: "Aggiungi", exact: true }).click();
    const remove = page.getByRole("button", { name: "Rimuovi Rita Provvisoria", exact: true });
    await remove.waitFor();
    await eachWidth(page, "dirigenti manuali", async (width) => {
      await assertTouchTarget(remove, `× di rimozione a ${width}`);
      await assertLayout(page, `S1 dirigenti manuali ${width}`);
    });
    await shot(page, "s8-dirigente-manuale", 390, page.locator(".chip-row").first());
    await remove.click();
    await remove.waitFor({ state: "hidden" });
    await expectDirty(page, true);
    await discardDraft(page);
    await expectDirty(page, false);
  });

  assertClean(watch, "S1");
});

// ---- S2 ------------------------------------------------------------------------------------
scenario("S2 limite: a 20 comitati «Aggiungi» è disattivato con «Massimo 20 comitati»", { timeout: 300000 }, async (t) => {
  const { page, watch } = await openPage(actors.admin);
  await openCommittees(page, D);
  for (let index = 6; index <= 20; index += 1) {
    const sheet = await addCommittee(page, `Comitato ${index}`);
    await closeSheetKeepDraft(page, sheet);
  }
  assert.equal((await cardTitles(page)).length, 20);

  await step(t,"pulsante disattivato con il motivo, descritto per gli screen reader", async () => {
    const add = pageAdd(page);
    assert.equal(await add.isDisabled(), true);
    await page.getByText("Massimo 20 comitati", { exact: true }).waitFor();
    const describedBy = await add.getAttribute("aria-describedby");
    assert.ok(describedBy);
    assert.equal(await page.locator(`#${describedBy}`).innerText(), "Massimo 20 comitati");
    await eachWidth(page, "limite", async (width) => {
      await assertLayout(page, `S2 limite ${width}`);
      await add.scrollIntoViewIfNeeded();
      await shot(page, "s2-limite-venti", width);
    });
  });

  await step(t,"20 comitati si salvano e si ritrovano dopo la ricarica", async () => {
    await save(page);
    assert.equal((await planOf(D)).committees.length, 20);
    await page.reload();
    await dismissHints(page);
    await page.locator(".camp-committee-add").waitFor();
    assert.equal((await cardTitles(page)).length, 20);
    assert.equal(await pageAdd(page).isDisabled(), true);
  });

  await step(t, "Excel con venti comitati liberi: un foglio «Comitati», uno «Gruppi»", async () => {
    const exported = await exportExcel(page);
    assert.equal(exported.name, "viaggio-qa-d-comitati-gruppi.xlsx");
    assert.deepEqual(Object.keys(exported.sheets), ["Comitati", "Gruppi"]);
    assert.equal(exported.sheets.Comitati.length, 20, "una riga per comitato vuoto");
    assert.ok(exported.sheets.Comitati.some((row) => row.Comitato === "Comitato 20"));
    assert.equal(exported.sheets.Gruppi.length, 0);
  });

  await step(t,"eliminarne uno riattiva «Aggiungi comitato»", async () => {
    const sheet = await openSheet(page, "Comitato 20");
    await sheet.getByRole("button", { name: "Elimina comitato", exact: true }).click();
    const confirm = await confirmDialog(page, "Eliminare il comitato «Comitato 20»?");
    assert.equal(await confirm.locator(".camp-confirm-people").count(), 0, "comitato vuoto: nessun elenco di persone");
    await confirm.getByRole("button", { name: "Elimina comitato", exact: true }).click();
    await sheet.waitFor({ state: "hidden" });
    assert.equal(await pageAdd(page).isEnabled(), true);
    assert.equal(await page.getByText("Massimo 20 comitati").count(), 0);
    await discardDraft(page);
    assert.equal((await cardTitles(page)).length, 20);
    assert.equal(await pageAdd(page).isDisabled(), true, "Scarta modifiche ripristina i 20");
  });

  assertClean(watch, "S2");
});

// ---- S3 ------------------------------------------------------------------------------------
scenario("S3 uscita con modifiche non salvate chiede conferma", { timeout: 180000 }, async (t) => {
  const { page, watch } = await openPage(actors.admin);
  // Si arriva ai comitati con un click: Indietro del browser è così una navigazione dell'app (il blocker
  // di react-router non vede un ritorno a un altro documento).
  await gotoApp(page, `/admin/events/${G}`);
  await page.getByRole("button", { name: "Comitati", exact: true }).click();
  await page.locator(".camp-committee-add").waitFor();
  const kitchen = await openSheet(page, "Cucina");
  await kitchen.getByLabel("Nome del comitato").fill("Cucina QA");
  await closeSheetKeepDraft(page, kitchen);
  await expectDirty(page, true);
  const details = page.getByRole("button", { name: "Dettagli", exact: true });

  await step(t,"cambio tab: «Continua a modificare» conserva la bozza", async () => {
    await details.click();
    const sheet = await confirmDialog(page, "Lasciare il piano senza salvare?");
    await eachWidth(page, "uscita", async (width) => {
      await assertLayout(page, `S3 uscita ${width}`);
      await shot(page, "s3-uscita-non-salvata", width);
    });
    await sheet.getByRole("button", { name: "Continua a modificare", exact: true }).click();
    await sheet.waitFor({ state: "hidden" });
    assert.ok(page.url().endsWith(`/admin/events/${G}/comitati`));
    assert.ok((await cardTitles(page)).includes("Cucina QA"));
  });

  await step(t,"Indietro del browser chiede la stessa conferma", async () => {
    await page.goBack();
    const sheet = await confirmDialog(page, "Lasciare il piano senza salvare?");
    await sheet.getByRole("button", { name: "Continua a modificare", exact: true }).click();
    await sheet.waitFor({ state: "hidden" });
    assert.ok(page.url().endsWith(`/admin/events/${G}/comitati`));
    assert.ok((await cardTitles(page)).includes("Cucina QA"));
  });

  await step(t,"anche un nuovo comitato con testo non si perde in silenzio", async () => {
    await expectDirty(page, true);
    await pageAdd(page).click();
    const dialog = page.getByRole("dialog", { name: "Nuovo comitato", exact: true });
    await dialog.getByLabel("Nome del comitato").fill("Bozza volante");
    await page.goBack();
    const sheet = await confirmDialog(page, "Lasciare il piano senza salvare?");
    await sheet.getByRole("button", { name: "Continua a modificare", exact: true }).click();
    assert.equal(await dialog.getByLabel("Nome del comitato").inputValue(), "Bozza volante");
    await dialog.getByRole("button", { name: "Annulla", exact: true }).click();
    await (await confirmDialog(page, "Scartare il nuovo comitato?")).getByRole("button", { name: "Scarta comitato", exact: true }).click();
  });

  await step(t, "«Esci dal piano» scarta la bozza: nessun nome scartato in nessun fotogramma al ritorno", async () => {
    await installLeakWatcher(page);
    await details.click();
    const sheet = await confirmDialog(page, "Lasciare il piano senza salvare?");
    await sheet.getByRole("button", { name: "Esci dal piano", exact: true }).click();
    await page.waitForURL((url) => !url.pathname.endsWith("/comitati"));
    assert.equal(await planOf(G), null, "nessun piano salvato");
    // Si arma quando la tab Comitati non è più nel documento: da qui ogni fotogramma con la bozza scartata è un difetto.
    await page.locator(".camp-committee-add").waitFor({ state: "detached" });
    await armLeakWatcher(page, ["Cucina QA"]);
    await page.getByRole("button", { name: "Comitati", exact: true }).click();
    await page.locator(".camp-committee-add").waitFor();
    // Finestra di osservazione: la tab rilegge i dati e, se ci fosse, rimetterebbe il piano dopo un attimo.
    await page.waitForTimeout(1500);
    assert.deepEqual(await cardTitles(page), HISTORIC_TITLES, "stato uguale al piano salvato");
    assert.equal((await saveButton(page).innerText()).trim(), "Salvato");
    await expectDirty(page, false);
    assert.equal(await page.getByRole("dialog").count(), 0);
    await assertNoLeaks(page, "S3 «Esci dal piano» e ritorno");
    const leaks = await leaksOf(page);
    assert.deepEqual([leaks.painted.length, leaks.transient.length], [0, 0], "nemmeno una mutazione transitoria con la bozza scartata");
  });

  await step(t, "Indietro con un foglio aperto: «Esci dal piano» chiude i fogli e scarta la bozza", async () => {
    // Un'altra bozza, con il foglio del comitato aperto sopra la pagina.
    await expectDirty(page, false);
    const open = await openSheet(page, "Benessere e Supporto");
    await open.getByLabel("Nome del comitato").fill("Benessere QA2");
    await page.goBack();
    const confirm = await confirmDialog(page, "Lasciare il piano senza salvare?");
    await confirm.getByRole("button", { name: "Esci dal piano", exact: true }).click();
    await page.waitForURL((url) => !url.pathname.endsWith("/comitati"));
    assert.equal(await page.getByRole("dialog").count(), 0, "nessun foglio resta aperto");
    await page.locator(".camp-committee-add").waitFor({ state: "detached" });
    await armLeakWatcher(page, ["Benessere QA2"]);
    await page.getByRole("button", { name: "Comitati", exact: true }).click();
    await page.locator(".camp-committee-add").waitFor();
    await page.waitForTimeout(1500);
    assert.equal(await page.getByRole("dialog").count(), 0, "tornando alla tab nessun foglio");
    assert.deepEqual(await cardTitles(page), HISTORIC_TITLES);
    await expectDirty(page, false);
    await assertNoLeaks(page, "S3 Indietro con foglio aperto");
    assert.equal(await planOf(G), null, "nessun piano salvato");
  });

  assertClean(watch, "S3");

  // D4: con una bozza non salvata il browser deve chiedere conferma a ricarica o chiusura. Si prova l'evento
  // (annullato o no) e, nel browser vero, la richiesta di conferma alla chiusura della scheda.
  const beforeUnloadPrevented = () => page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  await step(t, "beforeunload: annullato solo con bozza sporca, comitato nuovo con testo o salvataggio in corso", async () => {
    assert.equal(await beforeUnloadPrevented(), false, "pagina pulita: nessun avviso");
    const sheet = await openSheet(page, "Cucina");
    await sheet.getByLabel("Nome del comitato").fill("Cucina D4");
    await closeSheetKeepDraft(page, sheet);
    assert.equal(await beforeUnloadPrevented(), true, "bozza sporca: avviso");
    await discardDraft(page);
    assert.equal(await beforeUnloadPrevented(), false, "dopo «Scarta modifiche»: nessun avviso");

    await pageAdd(page).click();
    const dialog = page.getByRole("dialog", { name: "Nuovo comitato", exact: true });
    assert.equal(await beforeUnloadPrevented(), false, "comitato nuovo senza testo: nessun avviso");
    await dialog.getByLabel("Nome del comitato").fill("Bozza D4");
    assert.equal(await beforeUnloadPrevented(), true, "comitato nuovo con testo: avviso");
    await dialog.getByLabel("Nome del comitato").fill("");
    assert.equal(await beforeUnloadPrevented(), false, "testo cancellato: nessun avviso");
    await dialog.getByRole("button", { name: "Annulla", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });

    // Salvataggio in corso: la risposta della callable è trattenuta, la bozza è già «in volo».
    const renamed = await openSheet(page, "Cucina");
    await renamed.getByLabel("Nome del comitato").fill("Cucina D4 salvata");
    await closeSheetKeepDraft(page, renamed);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let reached;
    const arrived = new Promise((resolve) => { reached = resolve; });
    await page.route("**/campManagementSave", async (route) => {
      reached();
      await gate;
      await route.continue();
    });
    await saveButton(page).filter({ hasText: "Salva modifiche" }).click();
    await arrived;
    assert.equal(await beforeUnloadPrevented(), true, "salvataggio in corso: avviso");
    release();
    await waitSaved(page);
    await page.unroute("**/campManagementSave");
    assert.equal(await beforeUnloadPrevented(), false, "salvato: nessun avviso");
    assert.equal((await planOf(G)).committees.find((committee) => committee.id === "kitchen").title, "Cucina D4 salvata");
  });

  await step(t, "beforeunload nel browser vero: la chiusura della scheda con bozza sporca chiede conferma", async () => {
    const renamed = await openSheet(page, "Cucina D4 salvata");
    await renamed.getByLabel("Nome del comitato").fill("Cucina D4 chiusura");
    await closeSheetKeepDraft(page, renamed);
    await expectDirty(page, true);
    // Ricarica avviata dalla pagina (come F5 dopo un gesto dell'utente): con bozza sporca il browser deve
    // chiedere conferma; annullandola la bozza resta lì.
    const asked = [];
    page.on("dialog", (dialog) => {
      asked.push(dialog.type());
      void dialog.dismiss();
    });
    const firstDialog = page.waitForEvent("dialog", { timeout: 5000 });
    await page.evaluate(() => { setTimeout(() => window.location.reload(), 0); });
    assert.equal((await firstDialog).type(), "beforeunload", "una richiesta di conferma con bozza sporca");
    await page.waitForTimeout(300);
    assert.deepEqual(asked, ["beforeunload"]);
    await expectDirty(page, true);
    assert.ok((await cardTitles(page)).includes("Cucina D4 chiusura"), "annullata la richiesta la bozza resta");
    // Senza bozza la stessa ricarica parte senza chiedere nulla.
    await discardDraft(page);
    await page.evaluate(() => { window.__qaReloadMarker = true; setTimeout(() => window.location.reload(), 0); });
    await page.waitForFunction(() => window.__qaReloadMarker !== true, null, { timeout: 15000 });
    await page.locator(".camp-committee-add").waitFor();
    assert.deepEqual(asked, ["beforeunload"], "bozza pulita: nessuna richiesta");
  });
});

// ---- S3b -----------------------------------------------------------------------------------
// «Client precedente» della tabella degli stati: una PWA in cache invia il piano senza `planFormat`. Su un piano
// che non ha i cinque comitati storici (qui F, con un solo comitato libero) il server rifiuta con l'invito a
// ricaricare, e la bozza locale resta intatta. Il rifiuto non scrive nulla: F resta com'era per S7 e S9.
scenario("S3b client precedente: salvataggio rifiutato con invito a ricaricare, bozza intatta", { timeout: 120000 }, async (t) => {
  const { page, watch } = await openPage(actors.admin);
  await openCommittees(page, F);
  const before = await planOf(F);
  const sheet = await openSheet(page, "Squadra Segreta F");
  await sheet.getByLabel("Nome del comitato").fill("Squadra rinominata dal vecchio client");
  await closeSheetKeepDraft(page, sheet);
  let intercepted = 0;
  await page.route("**/campManagementSave", async (route) => {
    const body = route.request().postDataJSON();
    delete body.data.planFormat;
    intercepted += 1;
    await route.continue({ postData: JSON.stringify(body) });
  });

  await step(t, "rifiuto con il messaggio del server e bozza locale intatta", async () => {
    await saveButton(page).filter({ hasText: "Salva modifiche" }).click();
    await page.getByText("Questa versione dell'app non può modificare il piano. Ricarica la pagina per aggiornarla.").waitFor();
    assert.equal(intercepted, 1);
    await expectDirty(page, true);
    assert.ok((await cardTitles(page)).includes("Squadra rinominata dal vecchio client"), "la bozza locale resta");
    assert.deepEqual(await planOf(F), before, "il server non è cambiato");
    await shot(page, "s3b-client-precedente", 390);
    await assertLayout(page, "S3b client precedente 390");
    const rejected = watch.callableBodies.find((entry) => /campManagementSave/u.test(entry.request) || entry.status === 400);
    assert.ok(rejected, "la callable ha risposto con un errore");
  });

  await step(t, "ritorno: «Scarta modifiche» rimette il piano salvato", async () => {
    await page.unroute("**/campManagementSave");
    await discardDraft(page);
    assert.ok((await cardTitles(page)).includes("Squadra Segreta F"));
  });
});

// ---- S4 ------------------------------------------------------------------------------------
scenario("S4 dirigente di unità su viaggio: pagina unità, Gestisci, nomi dalla callable, salvataggio", { timeout: 300000 }, async (t) => {
  const { page, watch } = await openPage(actors.leader);
  let afterUnitPage = 0;

  await step(t,"dalla pagina unità: sezione «Organizzazione» e «Gestisci» da 44 px", async () => {
    assert.equal(new URL(page.url()).pathname, "/unit");
    await page.locator(`a[href="/unit/activities/${B}"]`).click();
    await page.getByRole("heading", { name: "Organizzazione", exact: true }).waitFor();
    await page.locator(".camp-ios-grid").first().waitFor();
    const section = page.locator("section", { has: page.getByRole("heading", { name: "Organizzazione", exact: true }) });
    assert.ok((await section.innerText()).includes("Comitati e gruppi"));
    assert.ok(!/campeggio/iu.test(await section.innerText()), "titoli generici: niente «campeggio» su un viaggio");
    const manage = page.getByRole("link", { name: "Gestisci", exact: true });
    // Controllo positivo: la pagina unità legge le proprie iscrizioni, quindi il rilevatore di query deve vederle.
    // Controllo positivo: il rilevatore deve vedere la lettura della pagina unità, che è filtrata per unitId.
    assert.ok(registrationQueries(watch).some((target) => target.parent.endsWith(`/activities/${B}`) && /"fieldPath":"unitId"/u.test(target.where)), "il rilevatore deve vedere la query per unità della pagina unità");
    assert.deepEqual(unscopedRegistrationQueries(watch), [], "la pagina unità non legge l'elenco completo delle iscrizioni");
    await eachWidth(page, "pagina unità", async (width) => {
      await assertTouchTarget(manage, `«Gestisci» a ${width}`);
      await assertLayout(page, `S4 pagina unità ${width}`);
      await shot(page, "s4-pagina-unita-organizzazione", width, page.getByRole("heading", { name: "Organizzazione", exact: true }));
    });
    afterUnitPage = watch.requests.length;
  });

  const mark = { console: 0, pageErrors: 0 };
  await step(t,"«Gestisci»: la pagina comitati carica i nomi via roster, senza elenco iscrizioni via SDK", async () => {
    mark.console = watch.console.length;
    mark.pageErrors = watch.pageErrors.length;
    await page.getByRole("link", { name: "Gestisci", exact: true }).click();
    await page.waitForURL(`**/admin/events/${B}/comitati`);
    await page.locator(".camp-committee-add").waitFor();
    assert.deepEqual(await cardTitles(page), HISTORIC_TITLES);
    assert.equal(await page.getByRole("button", { name: "Modifica attività" }).count(), 0, "niente comandi riservati agli admin");
    assert.equal(await page.getByText("Chi gestisce il campeggio").count(), 0);
    const kitchen = await openSheet(page, "Cucina");
    const youth = (await kitchen.locator("section.camp-modal-section", { has: page.getByRole("heading", { name: "Giovani", exact: true }) }).locator("label.toggle-field").allInnerTexts()).map((row) => row.split("\n")[0].trim());
    assert.deepEqual([...youth].sort(), ["Verdi Anna", "Neri Bruno", "Gialli Dario", "Rossi Giulia", "Legacy Leo", "Bianchi Marco"].sort());
    assert.ok(!youth.includes("Blu Carla") && !youth.includes("Stato Nora"), "annullate escluse (registrationStatus e solo status)");
    const adults = await kitchen.locator("section.camp-modal-section", { has: page.getByRole("heading", { name: "Dirigenti iscritti", exact: true }) }).innerText();
    assert.ok(adults.includes("Viola Ester"));
    await shot(page, "s4-comitato-nomi-roster", 390);
    await closeSheetKeepDraft(page, kitchen);
    const roster = callableRequests(watch, "campManagementStaff", afterUnitPage).filter((request) => /"action":"roster"/u.test(request.body));
    assert.ok(roster.length >= 1, "nomi dalla callable roster");
    assert.deepEqual(unscopedRegistrationQueries(watch), [], "nessuna query sull'elenco completo delle iscrizioni, nemmeno fallita, in tutto il percorso del dirigente");
    assert.deepEqual(registrationDocuments(watch, afterUnitPage), [], "nessun documento di registrations letto via SDK dalla pagina comitati del dirigente");
    for (const response of watch.responses.filter((entry) => entry.url.includes("/campManagementStaff"))) assert.equal(response.status, 200);
  });

  await step(t,"assegna giovani, incarico e gruppo, poi salva (callable campManagementSave)", async () => {
    const kitchen = await openSheet(page, "Cucina");
    await kitchen.getByLabel("Cosa deve fare").fill("Preparare i pranzi al sacco per il viaggio");
    await assignYouth(kitchen, "Rossi Giulia");
    await closeSheetKeepDraft(page, kitchen);
    await page.getByRole("button", { name: "Aggiungi gruppo", exact: true }).click();
    await page.locator(".camp-ios-card--patrol").filter({ hasText: "Gruppo 1" }).click();
    const group = page.getByRole("dialog", { name: "Gruppo 1", exact: true });
    await group.locator("label.toggle-field", { hasText: "Rossi Giulia" }).click();
    await group.getByRole("button", { name: "Continua dopo", exact: true }).click();
    await group.waitFor({ state: "hidden" });
    await save(page);
    const saved = await planOf(B);
    assert.equal(saved.committees.length, 5);
    assert.equal(saved.groupLabel, "gruppo");
    const registrations = await registrationsOf(B);
    assert.deepEqual(registrations.get(`user_${actors.giulia.uid}`).assignedCommittees.map((entry) => entry.id), ["kitchen"]);
    assert.equal(registrations.get(`user_${actors.giulia.uid}`).assignedPatrolName, "Gruppo 1");
    assert.deepEqual(registrations.get("manual_anna").assignedCommittees, []);
    assert.ok(callableRequests(watch, "campManagementSave").length >= 1);
    assertClean(watch, "S4 dirigente", { from: mark });
    await eachWidth(page, "comitati dirigente", async (width) => {
      await assertLayout(page, `S4 comitati dirigente ${width}`);
      await shot(page, "s4-comitati-dirigente", width, page.locator(".camp-committee-grid").first());
    });
  });

  await step(t, "Excel dal dirigente: nomi dalla roster, comitato e gruppo", async () => {
    const exported = await exportExcel(page);
    assert.ok(exported.sheets.Comitati.some((row) => row.Comitato === "Cucina" && row.Nome === "Giulia Rossi" && row.Ruolo === "Giovane"), JSON.stringify(exported.sheets.Comitati.slice(0, 6)));
    assert.ok(exported.sheets.Gruppi.some((row) => row.Gruppo === "Gruppo 1" && row.Nome === "Giulia Rossi"), JSON.stringify(exported.sheets.Gruppi));
  });

  await step(t,"ritorno alla pagina unità: ritrova il piano salvato", async () => {
    await page.goBack();
    await page.getByRole("heading", { name: "Organizzazione", exact: true }).waitFor();
    await page.locator(".camp-ios-grid").first().waitFor();
    assert.ok((await page.locator(".camp-ios-grid").first().innerText()).includes("Gruppo 1"));
  });
});

// ---- S5 ------------------------------------------------------------------------------------
scenario("S5 giovane iscritto: tab di organizzazione con comitato e incarico; senza piano nessuna tab", { timeout: 240000 }, async (t) => {
  const { page, watch } = await openPage(actors.giulia);
  await gotoApp(page, `/me/activities/${B}`);
  const tabs = page.getByRole("tab");

  await step(t,"viaggio con piano salvato: tab Iscrizione, Gruppo, Comitati", async () => {
    await tabs.first().waitFor();
    assert.deepEqual(await tabs.allInnerTexts().then((labels) => labels.map((label) => label.trim())), ["Iscrizione", "Gruppo", "Comitati"]);
    await page.getByRole("tab", { name: "Comitati", exact: true }).click();
    await page.getByRole("heading", { name: "Comitati", exact: true }).waitFor();
    const card = page.locator(".camp-committee-card");
    assert.equal(await card.count(), 1);
    const text = await card.innerText();
    assert.ok(text.includes("Cucina") && text.includes("Preparare i pranzi al sacco per il viaggio") && text.includes("Sei assegnato a questo comitato."));
    assert.ok(!/campeggio/iu.test(await page.locator(".camp-youth-tab-panel").innerText()));
    await eachWidth(page, "scheda /me comitati", async (width) => {
      await assertLayout(page, `S5 /me comitati ${width}`);
      await shot(page, "s5-me-comitato", width, page.locator(".camp-committee-card").first());
    });
    await page.getByRole("tab", { name: "Gruppo", exact: true }).click();
    await page.getByRole("heading", { name: "Il tuo gruppo", exact: true }).waitFor();
    const group = await page.locator(".camp-youth-tab-panel").innerText();
    assert.ok(group.includes("Gruppo 1") && group.includes("Con chi sei durante l'attività."));
    assert.ok(!/campo|cammini/iu.test(group), "copy del campeggio fuori dal campeggio");
    await shot(page, "s5-me-gruppo", 390, page.locator(".camp-youth-screen").first());
  });

  await step(t,"secondo viaggio senza piano salvato: nessuna tab di organizzazione", async () => {
    await spaNavigate(page, `/me/activities/${C}`);
    await page.getByText("Viaggio QA C", { exact: false }).first().waitFor();
    assert.equal(await tabs.count(), 0);
    const text = await bodyText(page);
    assert.ok(!text.includes("Cucina") && !text.includes("Gruppo 1") && !text.includes("Preparare i pranzi"));
    await eachWidth(page, "scheda /me senza piano", async (width) => {
      await assertLayout(page, `S5 /me senza piano ${width}`);
      await shot(page, "s5-me-senza-piano", width);
    });
  });

  await step(t,"chi non è assegnato vede le tab ma «Nessun comitato assegnato»", async () => {
    const marco = await openPage(actors.marco);
    await gotoApp(marco.page, `/me/activities/${B}`);
    await marco.page.getByRole("tab", { name: "Comitati", exact: true }).click();
    await marco.page.getByText("Nessun comitato assegnato", { exact: true }).waitFor();
    const text = await marco.page.locator(".camp-youth-tab-panel").innerText();
    assert.ok(!text.includes("Preparare i pranzi") && !/Giulia|Rossi/u.test(text));
    assertClean(marco.watch, "S5 Marco");
  });

  assertClean(watch, "S5");
});

// ---- S5b -----------------------------------------------------------------------------------
// La scheda del giovane legge il piano cache-first: se alla prima visita il piano non c'era e poi viene
// salvato, alla riapertura le tab devono comparire (la rilettura dal server aggiorna la cache).
scenario("S5b giovane: il piano salvato dopo la prima visita compare alla riapertura", { timeout: 120000 }, async (t) => {
  const { page, watch } = await openPage(actors.marco);
  await gotoApp(page, `/me/activities/${I}`);
  await page.getByText("Viaggio QA I").first().waitFor();
  await page.waitForTimeout(800);
  assert.equal(await page.getByRole("tab").count(), 0, "alla prima visita il piano non c'è");

  await step(t, "riapertura dopo il salvataggio del piano", async () => {
    // Scrive piano e proiezione come fa la callable campManagementSave (Marco in «Cucina»).
    const member = { registrationId: `user_${actors.marco.uid}`, fullName: "Marco Bianchi", genderRoleCategory: "giovane_uomo", unitName: "Unità B", role: "member" };
    await planRef(I).set({
      groupLabel: "gruppo",
      committees: HISTORIC_IDS.map((id, index) => ({
        id, title: HISTORIC_TITLES[index], responsibilities: id === "kitchen" ? "Pulire le pentole dopo cena" : "",
        leaderRegistrationIds: [], manualLeaderIds: [], memberRegistrationIds: id === "kitchen" ? [member.registrationId] : [],
        publicMembers: id === "kitchen" ? [member] : [], updatedAt: iso(),
      })),
      patrols: [], manualLeaders: [], updatedAt: iso(), savedAt: iso(),
    });
    await activityRef(I).collection("registrations").doc(member.registrationId).update({ assignedCommittees: [{ id: "kitchen", title: "Cucina", role: "member" }] });
    await page.reload();
    await page.getByText("Viaggio QA I").first().waitFor();
    const started = Date.now();
    let tabs = 0;
    while (Date.now() - started < 10000) {
      tabs = await page.getByRole("tab").count();
      if (tabs > 0) break;
      await page.waitForTimeout(100);
    }
    const ms = Date.now() - started;
    if (ms > 600) softNotes.push(`S5b: le tab del piano salvato dopo la prima visita sono comparse dopo ${ms} ms dalla riapertura (cache locale rinfrescata dal server)`);
    assert.ok(tabs >= 3, `dopo il salvataggio le tab di organizzazione devono comparire alla riapertura (viste ${tabs} dopo ${ms} ms)`);
    await page.getByRole("tab", { name: "Comitati", exact: true }).click();
    await page.getByText("Pulire le pentole dopo cena").waitFor();
  });

  assertClean(watch, "S5b");
});

// ---- S6 ------------------------------------------------------------------------------------
scenario("S6 campeggio: come prima (staff campeggio, Pattuglie), salvataggio funzionante", { timeout: 240000 }, async (t) => {
  const { page, watch } = await openPage(actors.admin);
  await openCommittees(page, E);

  await step(t,"sezione staff, Pattuglie, cinque comitati", async () => {
    await page.getByText("Chi gestisce il campeggio", { exact: true }).waitFor();
    assert.deepEqual(await cardTitles(page), HISTORIC_TITLES);
    assert.equal(await page.locator(".camp-config-panel select option:checked").innerText(), "Pattuglie");
    await page.getByRole("heading", { name: "Pattuglie", exact: true }).waitFor();
    await eachWidth(page, "campeggio", async (width) => {
      await assertLayout(page, `S6 campeggio ${width}`);
      await shot(page, "s6-campeggio-comitati", width, page.locator(".camp-committee-grid").first());
    });
  });

  await step(t,"assegna e salva; il server proietta sull'iscrizione", async () => {
    const sheet = await openSheet(page, "Giochi e Attività");
    await assignYouth(sheet, "Verdi Anna");
    await closeSheetKeepDraft(page, sheet);
    await save(page);
    const registrations = await registrationsOf(E);
    assert.deepEqual(registrations.get("manual_anna").assignedCommittees.map((entry) => entry.id), ["games"]);
    assert.equal((await planOf(E)).groupLabel, "pattuglia");
  });

  assertClean(watch, "S6");
});

// ---- S7 ------------------------------------------------------------------------------------
// Osservatore che registra, dal momento in cui è armato, ogni istante in cui il testo della pagina
// contiene una stringa del contesto precedente. `painted` guarda il DOM a ogni fotogramma (prima di
// disegnarlo: è ciò che l'utente può vedere); `transient` guarda ogni mutazione, anche quelle
// sostituite nello stesso ciclo prima di un disegno.
async function installLeakWatcher(page) {
  await page.evaluate(() => {
    if (window.__leakWatcher) return;
    window.__leaks = { painted: [], transient: [], oldPage: [] };
    window.__forbidden = [];
    window.__marker = null;
    const scan = (key) => {
      if (!window.__forbidden.length) return;
      const text = document.body?.textContent ?? "";
      const heading = document.querySelector("h1")?.textContent ?? "";
      // Con un marcatore (titolo del nuovo contesto) un fotogramma senza il titolo nuovo è la pagina vecchia
      // ancora montata mentre la navigazione si completa, non un dato vecchio nella pagina nuova.
      const bucket = window.__marker && !heading.includes(window.__marker) ? window.__leaks.oldPage : window.__leaks[key];
      for (const needle of window.__forbidden) {
        if (!text.includes(needle)) continue;
        const now = Math.round(performance.now());
        const known = bucket.find((entry) => entry.needle === needle && entry.path === location.pathname);
        if (known) { known.lastAt = now; known.checks += 1; continue; }
        // Diagnostica: cosa c'è a schermo in quel momento (titolo, schede, testo che dice «caricamento»).
        bucket.push({
          needle, path: location.pathname, firstAt: now, lastAt: now, checks: 1, heading: heading.slice(0, 40),
          cards: [...document.querySelectorAll(".camp-ios-card strong")].map((element) => element.textContent).slice(0, 8),
          loader: [...document.querySelectorAll("[role=status], [aria-busy=true]")].map((element) => (element.textContent || "").slice(0, 40)).slice(0, 3),
        });
      }
    };
    new MutationObserver(() => scan("transient")).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    const loop = () => { scan("painted"); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    window.__leakWatcher = true;
  });
}
const armLeakWatcher = (page, needles, marker = null) => page.evaluate(({ list, title }) => { window.__leaks = { painted: [], transient: [], oldPage: [] }; window.__forbidden = list; window.__marker = title; }, { list: needles, title: marker });
const leaksOf = (page) => page.evaluate(() => window.__leaks);
// Fallisce se una stringa vecchia è visibile in un fotogramma; le mutazioni transitorie sono una nota.
async function assertNoLeaks(page, label, only = null) {
  const leaks = await leaksOf(page);
  const pick = (list) => (only ? list.filter((leak) => only.includes(leak.needle)) : list);
  if (pick(leaks.transient).length && !pick(leaks.painted).length) {
    softNotes.push(`${label}: stringhe del contesto precedente solo in mutazioni transitorie, mai in un fotogramma (${[...new Set(pick(leaks.transient).map((leak) => leak.needle))].join(", ")})`);
  }
  if (pick(leaks.oldPage).length) {
    const frames = Math.max(...pick(leaks.oldPage).map((leak) => leak.checks));
    softNotes.push(`${label}: la pagina vecchia è rimasta montata per circa ${frames} controlli (fotogrammi) col nuovo indirizzo, prima che la navigazione si completasse: è il comportamento normale di una transizione, nessun dato del nuovo contesto mescolato`);
  }
  assert.deepEqual(pick(leaks.painted), [], `${label}: dati del contesto precedente visibili in un fotogramma`);
}

scenario("S7 cambio account e cambio attività con la pagina aperta: nessun dato del contesto precedente", { timeout: 300000 }, async (t) => {
  const SECRETS = ["Zaira", "Esclusiva", "Squadra Segreta F", "Incarico riservato di F"];

  await step(t,"admin su F → Esci → Marco (giovane) nella stessa scheda", async () => {
    const { page } = await openPage(actors.admin);
    await openCommittees(page, F);
    await page.locator(".camp-ios-card--committee", { hasText: "Squadra Segreta F" }).waitFor();
    assert.ok((await bodyText(page)).includes("Esclusiva Zaira"), "precondizione: l'admin vede i nomi di F");
    await installLeakWatcher(page);
    await page.getByRole("button", { name: "Esci", exact: true }).click();
    await page.waitForURL((url) => url.pathname.startsWith("/login"));
    // Si arma quando la sessione dell'admin è finita e il nuovo utente sta per entrare: da qui in poi
    // un nome o un piano di F a schermo è per definizione un dato del contesto precedente.
    await page.locator('input[type="email"]').waitFor();
    await armLeakWatcher(page, SECRETS);
    await login(page, actors.marco);
    // Dopo l'accesso l'app riporta alla pagina da cui si era usciti (redirect): per un giovane è il cancello dei comitati.
    await page.waitForTimeout(1500);
    await assertNoLeaks(page, "S7 admin→Marco");
    assert.ok(!(await page.locator("body").innerText()).includes("Zaira"));
  });

  await step(t,"dirigente su F via roster ritardata → Esci → Giulia: niente nomi o piano di F", async () => {
    const { page, context } = await openPage(actors.leader);
    await context.route("**/campManagementStaff", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });
    await gotoApp(page, `/admin/events/${F}/comitati`);
    await page.locator(".camp-ios-card--committee", { hasText: "Squadra Segreta F" }).waitFor();
    assert.ok((await bodyText(page)).includes("Esclusiva Zaira"));
    await installLeakWatcher(page);
    await page.getByRole("button", { name: "Esci", exact: true }).click();
    await page.waitForURL((url) => url.pathname.startsWith("/login"));
    await page.locator('input[type="email"]').waitFor();
    await armLeakWatcher(page, SECRETS);
    await login(page, actors.giulia);
    await page.waitForTimeout(1500);
    await assertNoLeaks(page, "S7 dirigente→Giulia");
  });

  await step(t,"stesso admin, da F a H senza ricaricare: nulla di F resta a schermo", async () => {
    const { page, watch } = await openPage(actors.admin);
    await openCommittees(page, F);
    await page.locator(".camp-ios-card--committee", { hasText: "Squadra Segreta F" }).waitFor();
    await installLeakWatcher(page);
    await armLeakWatcher(page, SECRETS, "Viaggio QA H");
    await spaNavigate(page, `/admin/events/${H}/comitati`);
    await page.locator(".camp-ios-card--committee", { hasText: "Cucina" }).waitFor();
    await page.waitForTimeout(800);
    assert.ok((await page.locator("h1").first().innerText()).includes("Viaggio QA H"), "il marcatore (titolo del nuovo contesto) è nel titolo");
    await assertNoLeaks(page, "S7 admin F→H");
    assert.deepEqual(await cardTitles(page), HISTORIC_TITLES, "il piano mostrato è quello di H");
    assert.ok((await cardOf(page, "Cucina").innerText()).includes("Servire le colazioni di H alle sette"));
    assertClean(watch, "S7 admin F→H");
  });

  await step(t,"dirigente da H a F (roster ritardata): niente nomi del contesto precedente prima dell'esito", async () => {
    const { page, context, watch } = await openPage(actors.leader);
    await context.route("**/campManagementStaff", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });
    await gotoApp(page, `/admin/events/${H}/comitati`);
    await page.locator(".camp-ios-card--committee", { hasText: "Cucina" }).waitFor();
    await page.getByText("Rossi Giulia").first().waitFor();
    await installLeakWatcher(page);
    await armLeakWatcher(page, ["Servire le colazioni di H alle sette"], "Viaggio QA F");
    await spaNavigate(page, `/admin/events/${F}/comitati`);
    // Durante il caricamento (la roster è ritardata di 1,2 s) la pagina mostra il contesto di F, non quello di B.
    await page.waitForTimeout(500);
    await shot(page, "s7-transizione-B-F-in-caricamento", 390);
    await page.locator(".camp-ios-card--committee", { hasText: "Squadra Segreta F" }).waitFor();
    await page.waitForTimeout(800);
    assert.ok((await page.locator("h1").first().innerText()).includes("Viaggio QA F"), "il marcatore (titolo del nuovo contesto) è nel titolo");
    await assertNoLeaks(page, "S7 dirigente H→F");
    assertClean(watch, "S7 dirigente H→F");
  });

  await step(t,"giovane da H a C senza ricaricare: tab e comitato di H non restano", async () => {
    const { page } = await openPage(actors.giulia);
    await gotoApp(page, `/me/activities/${H}`);
    await page.getByRole("tab", { name: "Comitati", exact: true }).click();
    await page.getByText("Servire le colazioni di H alle sette").waitFor();
    await installLeakWatcher(page);
    await armLeakWatcher(page, ["Servire le colazioni di H alle sette", "Gruppo 1"], "Viaggio QA C");
    await spaNavigate(page, `/me/activities/${C}`);
    await page.getByText("Viaggio QA C").first().waitFor();
    await page.waitForTimeout(800);
    assert.ok((await page.locator("h1").first().innerText()).includes("Viaggio QA C"), "il marcatore (titolo del nuovo contesto) è nel titolo");
    await assertNoLeaks(page, "S7 giovane H→C");
    assert.equal(await page.getByRole("tab").count(), 0);
  });
});

// ---- S9 ------------------------------------------------------------------------------------
// Difetto trovato nel collaudo del 31 ottobre e corretto in 2e3e9c0: per un viaggio la callable `context`
// risponde 400 (L'elenco staff esiste solo per i campeggi) e il cancello lo leggeva come errore di rete.
scenario("S9 giovane non staff apre i comitati di un viaggio: torna a /me, non un errore di rete", { timeout: 120000 }, async (t) => {
  await step(t, "cancello con esito chiaro", async () => {
    const { page, watch } = await openPage(actors.marco);
    await gotoApp(page, `/admin/events/${F}/comitati`);
    // Ammessi: ritorno a /me, oppure un «non hai accesso». Non ammesso: «Controlla la connessione e riprova».
    await page.waitForFunction(() => location.pathname.startsWith("/me") || /Non riesco a verificare l'accesso/u.test(document.body.innerText), null, { timeout: 15000 });
    const staff = watch.callableBodies.filter((entry) => entry.request.includes('"action":"context"'));
    await shot(page, "s9-cancello-giovane-su-viaggio", 390);
    assert.ok(new URL(page.url()).pathname.startsWith("/me"), `il giovane non-staff su un viaggio deve tornare a /me; invece resta su ${new URL(page.url()).pathname} con «Non riesco a verificare l'accesso» (callable context: ${JSON.stringify(staff.map((entry) => [entry.status, entry.text.slice(0, 120)]))})`);
  });
});

// ---- S10 -----------------------------------------------------------------------------------
// Regressione della modifica globale a `.app-modal` (grid-template-columns: minmax(0, 1fr), 2e3e9c0): altri modali
// dell'app fuori dalla tab comitati, a 320, 390 e 430 px. Il confronto con main è esatto: la sola differenza di CSS
// globale tra main e il branch è quella proprietà (git diff main..HEAD su base.css), quindi «main» si riproduce
// nella stessa pagina forzando `grid-template-columns: none` (il valore che aveva) e rimisurando.
const MAIN_APP_MODAL_CSS = ".app-modal { grid-template-columns: none !important; }";
const modalMetrics = (page) => page.evaluate(() => {
  const dialog = [...document.querySelectorAll('[role="dialog"]')].pop();
  const round = (element) => {
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return [box.left, box.top, box.right, box.bottom].map((value) => Math.round(value * 10) / 10);
  };
  return {
    title: dialog.querySelector("h2")?.textContent ?? "",
    overflow: dialog.scrollWidth - dialog.clientWidth,
    rects: {
      dialog: round(dialog),
      header: round(dialog.querySelector(".app-modal__header")),
      body: round(dialog.querySelector(".app-modal__body")),
      footer: round(dialog.querySelector(".app-modal__footer")),
      close: round(dialog.querySelector(".app-modal__header .icon-button")),
      ...Object.fromEntries([...dialog.querySelectorAll(".app-modal__footer button")].map((button, index) => [`bottone${index}:${(button.textContent || "").trim().slice(0, 18)}`, round(button)])),
    },
  };
});
async function compareModalWithMain(page, name) {
  const modal = await modalMetrics(page);
  const widthNow = page.viewportSize().width;
  await shot(page, `s10-${name}`, widthNow);
  await page.evaluate((css) => { const style = document.createElement("style"); style.id = "qa-main-css"; style.textContent = css; document.head.append(style); }, MAIN_APP_MODAL_CSS);
  await page.waitForTimeout(120);
  const main = await modalMetrics(page);
  await shot(page, `s10-${name}-main`, widthNow);
  await page.evaluate(() => document.getElementById("qa-main-css")?.remove());
  layoutChecks += 1;
  const label = `S10 ${name} ${widthNow}`;
  if (modal.overflow > 0) layoutDefects.push(`${label}: «${modal.title}» sfora di ${modal.overflow} px`);
  if (modal.overflow > main.overflow) layoutDefects.push(`${label}: «${modal.title}» sfora più di main (${modal.overflow} > ${main.overflow})`);
  if (main.overflow > 0 && modal.overflow <= 0) {
    softNotes.push(`${label}: «${modal.title}» con il CSS di main sforava di ${main.overflow} px, ora no (migliorato)`);
  } else if (main.overflow <= 0) {
    const differences = Object.keys(modal.rects).filter((key) => {
      const a = modal.rects[key], b = main.rects[key];
      if (!a && !b) return false; // elemento assente in entrambi (per esempio un modale senza piede)
      return !a || !b || a.some((value, index) => Math.abs(value - b[index]) > 1);
    });
    if (differences.length) layoutDefects.push(`${label}: «${modal.title}» cambia rispetto a main in ${differences.map((key) => `${key} ora ${JSON.stringify(modal.rects[key])} main ${JSON.stringify(main.rects[key])}`).join("; ")}`);
  }
  return { modal, main };
}

scenario("S10 regressione .app-modal: altri modali a 320, 390 e 430 identici a main o migliori", { timeout: 300000 }, async (t) => {
  const { page, watch } = await openPage(actors.admin);
  await gotoApp(page, `/admin/events/${J}`);
  await page.getByRole("button", { name: "Modifica attività", exact: true }).waitFor();
  // Controllo positivo dello scambio «attuale / main»: un modale largo 300 px con un piede da 900 px. Con il CSS
  // attuale la colonna resta di 300 px; con quello di main la colonna si allarga al piede (è il difetto di 320 px).
  const control = await page.evaluate((css) => {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;top:0;width:300px;";
    host.innerHTML = '<section class="app-modal" style="width:300px"><header class="app-modal__header">h</header><div class="app-modal__body">b</div><footer class="app-modal__footer"><div style="min-width:900px">x</div></footer></section>';
    document.body.append(host);
    const footerWidth = () => host.querySelector(".app-modal__footer").getBoundingClientRect().width;
    const current = footerWidth();
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const main = footerWidth();
    style.remove();
    host.remove();
    return { current, main };
  }, MAIN_APP_MODAL_CSS);
  assert.ok(control.current <= 301 && control.main >= 899, `lo scambio attuale/main deve cambiare la colonna: ${JSON.stringify(control)}`);
  softNotes.push(`S10 controllo positivo: piede da 900 px in un modale da 300 px, colonna attuale ${Math.round(control.current)} px, con il CSS di main ${Math.round(control.main)} px`);
  const everyWidth = async (name) => {
    for (const width of WIDTHS) {
      await setWidth(page, width);
      await assertLayout(page, `S10 ${name} ${width}`);
      await compareModalWithMain(page, name);
    }
    await setWidth(page, 390);
  };

  await step(t, "editor dell'attività (modale ampio)", async () => {
    await page.getByRole("button", { name: "Modifica attività", exact: true }).click();
    await page.locator('[role="dialog"]').last().waitFor();
    await everyWidth("editor-attivita");
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  });

  await step(t, "foglio «Nuovo momento» del programma", async () => {
    await page.getByRole("button", { name: "Programma", exact: true }).click();
    await page.getByRole("button", { name: "Aggiungi momento", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Nuovo momento", exact: true });
    await dialog.waitFor();
    await everyWidth("nuovo-momento");
    await dialog.getByRole("button", { name: "Annulla", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  });

  await step(t, "foglio «Aggiungi a mano» degli iscritti", async () => {
    await page.getByRole("button", { name: "Iscritti", exact: true }).click();
    await page.getByRole("button", { name: "Aggiungi a mano" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Aggiungi a mano", exact: true });
    await dialog.waitFor();
    await everyWidth("aggiungi-a-mano");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  });

  await step(t, "foglio di conferma generico (cancella attività, compatto)", async () => {
    await page.getByRole("button", { name: "Cancella attività", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Eliminare «Viaggio QA J»?", exact: true });
    await dialog.waitFor();
    await everyWidth("conferma-cancella-attivita");
    await dialog.getByRole("button", { name: "Tieni l'attività", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.ok(await activityRef(J).get().then((snapshot) => snapshot.exists), "l'attività non è stata cancellata");
  });

  await step(t, "foglio del giovane «Annulla l'iscrizione» in /me", async () => {
    const youth = await openPage(actors.giulia);
    await gotoApp(youth.page, `/me/activities/${J}`);
    await youth.page.getByRole("button", { name: "Annulla l'iscrizione", exact: true }).first().click();
    const dialog = youth.page.getByRole("dialog", { name: "Annulli la tua iscrizione?", exact: true });
    await dialog.waitFor();
    for (const width of WIDTHS) {
      await setWidth(youth.page, width);
      await assertLayout(youth.page, `S10 annulla-iscrizione ${width}`);
      await compareModalWithMain(youth.page, "annulla-iscrizione");
    }
    await dialog.getByRole("button", { name: "Tieni l'iscrizione", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.notEqual((await activityRef(J).collection("registrations").doc(`user_${actors.giulia.uid}`).get()).get("registrationStatus"), "cancelled", "l'iscrizione non è stata annullata");
    assertClean(youth.watch, "S10 giovane");
  });

  assertClean(watch, "S10");
});

// ---- S8 ------------------------------------------------------------------------------------
// Esito finale delle misure raccolte da assertLayout, assertSheetFooter e dal confronto con main (S10) in tutti
// gli scenari (documento, corpo e fogli a 320, 390 e 430 px). Difetto trovato il 31 ottobre e corretto in
// 2e3e9c0: a 320 px il piede a tre pulsanti dei fogli comitato e gruppo sforava in orizzontale.
scenario("S8 misure: nessun overflow orizzontale in nessuna superficie provata", { timeout: 30000 }, async () => {
  assert.ok(layoutChecks >= 20, `controlli di layout eseguiti: ${layoutChecks}`);
  assert.deepEqual(layoutDefects, [], `${layoutDefects.length} superfici con overflow su ${layoutChecks} controlli`);
});
