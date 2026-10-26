// Run on the QA host with Vite and Auth/Firestore emulators already running.
// Required: PLAYWRIGHT_MODULE, QA_BASE_URL, GCLOUD_PROJECT=demo-*,
// FIRESTORE_EMULATOR_HOST=127.0.0.1:<port>, FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:<port>.
// Example: node tests/browser/eventCreationConcurrency.mjs
// Admin SDK only seeds synthetic data and verifies persisted results. Mutations
// under test use the real application services through the authenticated client.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const projectId = process.env.GCLOUD_PROJECT;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const base = new URL(process.env.QA_BASE_URL ?? "http://invalid.invalid");
const localHost = host => /^127\.0\.0\.1:([1-9][0-9]{0,4})$/.test(host ?? "") && Number(host.split(":")[1]) <= 65535;
assert.match(projectId ?? "", /^demo-[a-z0-9-]+$/, "Serve un progetto demo-* esplicito");
assert.ok(localHost(firestoreHost) && localHost(authHost), "Servono entrambi gli emulatori su loopback, con porte esplicite");
assert.ok(base.protocol === "http:" && ["127.0.0.1", "localhost"].includes(base.hostname), "QA_BASE_URL deve essere locale");
assert.ok(process.env.PLAYWRIGHT_MODULE, "Indicare PLAYWRIGHT_MODULE sul nodo QA");
// No Admin SDK import, initialization or REST request precedes these guards.
const require = createRequire(new URL("../../functions/package.json", import.meta.url));
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const app = initializeApp({ projectId }, `qa-concurrency-${randomUUID()}`);
const db = getFirestore(app);
const auth = getAuth(app);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const browser = await chromium.launch();
const runId = randomUUID();
const stakeId = `qa-concurrency-${runId}`;
const uid = `qa-concurrency-${runId}`;
const email = `${uid}@example.invalid`;
const password = `Qa-${randomUUID()}!`;
let createdUser = false;

async function snapshot(eventId) {
  const activity = db.doc(`stakes/${stakeId}/activities/${eventId}`);
  const [parent, settings, fields] = await Promise.all([
    activity.get(), activity.collection("config").doc("form").get(), activity.collection("formFields").get(),
  ]);
  return {
    activity: parent.data(), config: settings.data(),
    fields: fields.docs.map(doc => ({ id: doc.id, data: doc.data() })).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

try {
  const now = new Date().toISOString();
  await auth.createUser({ uid, email, password, emailVerified: true });
  createdUser = true;
  const seed = db.batch();
  seed.set(db.doc(`stakes/${stakeId}`), {
    name: "Palo sintetico concorrenza", stakeName: "Palo sintetico concorrenza", slug: stakeId, isActive: true,
    supportContact: "qa@example.invalid", updatedAt: now,
    registrationDefaults: { allowGuestRegistration: true, requireLoginForEdit: true, enabledStandardFields: ["birthDate", "genderRoleCategory", "unitName"], fieldOverrides: {} },
  });
  seed.set(db.doc(`users/${uid}`), {
    firstName: "Admin", lastName: "Sintetico", fullName: "Admin Sintetico", email, role: "admin",
    stakeId, stakeSlug: stakeId, stakeName: "Palo sintetico concorrenza", birthDate: "1982-07-07",
    genderRoleCategory: "dirigente", phone: "3330000000", city: "Città demo",
    unitId: "qa-unit", unitName: "Unità sintetica", mustChangePassword: false,
    createdAt: now, updatedAt: now, lastLoginAt: now,
  });
  seed.set(db.doc(`stakes/${stakeId}/members/${uid}`), { status: "active", staffRole: "admin", claimedUnitId: "qa-unit", version: 1 });
  await seed.commit();

  const context = await browser.newContext({ serviceWorkers: "block" });
  const allowed = new Set([base.origin, `http://${authHost}`, `http://${firestoreHost}`]);
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return allowed.has(url.origin) ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  await page.goto(new URL("/login", base).href);
  const target = await page.evaluate(async () => {
    const { firebaseApp, auth, db } = await import("/src/services/firebase/app.ts");
    const { useLocalEmulators } = await import("/src/services/firebase/config.ts");
    return { projectId: firebaseApp.options.projectId, emulator: useLocalEmulators, authPort: auth.emulatorConfig?.port, firestoreHost: db._settings.host };
  });
  assert.equal(target.projectId, projectId);
  assert.equal(target.emulator, true);
  assert.equal(target.authPort, Number(authHost.split(":")[1]));
  assert.equal(target.firestoreHost, firestoreHost);
  await page.locator("input[type=email]").fill(email);
  await page.locator("input[autocomplete=current-password]").fill(password);
  await page.locator(".auth-foot button[type=submit]").click();
  await page.waitForURL(url => !url.pathname.startsWith("/login"));

  // Keep A's snapshot deliberately stale while B uses the same authenticated
  // real services. Independent snapshots are sufficient to model the race;
  // no service or SDK is mocked, and persistence is checked with Admin reads.
  for (const scenario of ["event-after-publish", "event-after-form", "form-after-event", "form-after-form"]) {
    const eventId = await page.evaluate(async ({ stakeId, uid, scenario }) => {
      const { eventsService } = await import("/src/services/firestore/eventsService.ts");
      const { eventFormsService } = await import("/src/services/firestore/eventFormsService.ts");
      const { buildEssentialDraft } = await import("/src/utils/eventCreation.ts");
      const input = { ...buildEssentialDraft({ title: `QA ${scenario}`, activityType: "standard", startDate: "2027-03-01T18:00", endDate: "2027-03-01T20:00", location: "Sede sintetica" }), description: "Prova sintetica", registrationOpen: "2027-02-01T10:00:00.000Z", registrationClose: "2027-02-28T10:00:00.000Z" };
      const event = await eventsService.createEvent(stakeId, input, uid);
      const config = await eventFormsService.getFormConfig(stakeId, event.id);
      window.__concurrencyA = { event, config };
      if (scenario === "event-after-publish") await eventsService.publishEvent(stakeId, event.id, event.updatedAt);
      else if (scenario === "form-after-event") await eventsService.updateEvent(stakeId, event.id, { ...event, location: "Luogo scelto da B" }, event.updatedAt);
      else await eventFormsService.saveFormConfig(stakeId, event.id, { ...config, allowGuestRegistration: false }, undefined, { expectedUpdatedAt: event.updatedAt });
      return event.id;
    }, { stakeId, uid, scenario });
    const afterB = await snapshot(eventId);
    const rejection = await page.evaluate(async ({ stakeId, scenario }) => {
      const { event, config } = window.__concurrencyA;
      try {
        if (scenario.startsWith("event-")) {
          const { eventsService } = await import("/src/services/firestore/eventsService.ts");
          await eventsService.updateEvent(stakeId, event.id, { ...event, location: "Vecchia scelta di A", allowGuestRegistration: true }, event.updatedAt);
        } else {
          const { eventFormsService } = await import("/src/services/firestore/eventFormsService.ts");
          await eventFormsService.saveFormConfig(stakeId, event.id, { ...config, requireLoginForEdit: false }, undefined, { expectedUpdatedAt: event.updatedAt });
        }
        return null;
      } catch (error) { return error.message; }
    }, { stakeId, scenario });
    assert.ok(rejection, `${scenario}: A deve ricevere un conflitto`);
    assert.match(rejection, /cambiat|conflitt|revision|riapr|ricaric/i, `${scenario}: errore comprensibile sul conflitto`);
    assert.deepEqual(await snapshot(eventId), afterB, `${scenario}: A non modifica attività, config o campi`);
    await page.evaluate(async ({ stakeId, eventId, scenario }) => {
      const { eventsService } = await import("/src/services/firestore/eventsService.ts");
      const { eventFormsService } = await import("/src/services/firestore/eventFormsService.ts");
      const fresh = await eventsService.getEventById(stakeId, eventId, true);
      if (scenario.startsWith("event-")) await eventsService.updateEvent(stakeId, eventId, { ...fresh, location: "Scelta aggiornata di A" }, fresh.updatedAt);
      else {
        const config = await eventFormsService.getFormConfig(stakeId, eventId, true);
        await eventFormsService.saveFormConfig(stakeId, eventId, { ...config, requireLoginForEdit: false }, undefined, { expectedUpdatedAt: fresh.updatedAt });
      }
    }, { stakeId, eventId, scenario });
    const recovered = await snapshot(eventId);
    assert.ok(Date.parse(recovered.activity.updatedAt) > Date.parse(afterB.activity.updatedAt));
    assert.equal(recovered.activity.isPublic, afterB.activity.isPublic);
    assert.equal(recovered.activity.status, afterB.activity.status);
    if (scenario.startsWith("event-")) {
      assert.equal(recovered.activity.location, "Scelta aggiornata di A");
      assert.deepEqual(recovered.config, afterB.config, "Il recupero di A conserva il modulo di B");
    } else {
      assert.equal(recovered.config.requireLoginForEdit, false);
      assert.equal(recovered.activity.location, afterB.activity.location, "Il recupero di A conserva il luogo di B");
      assert.equal(recovered.config.allowGuestRegistration, afterB.config.allowGuestRegistration);
    }
    assert.deepEqual(recovered.fields, afterB.fields, "Il recupero non altera i campi già salvati");
    console.log(`PASS ${scenario}: conflitto senza scritture parziali, rilettura e recupero`);
  }
} finally {
  await browser.close();
  // Unique synthetic namespace only: never erase any shared QA collection.
  await db.recursiveDelete(db.doc(`stakes/${stakeId}`));
  await db.doc(`users/${uid}`).delete();
  if (createdUser) await auth.deleteUser(uid);
  await deleteApp(app);
}
