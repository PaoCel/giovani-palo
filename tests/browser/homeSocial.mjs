// Run on the QA host with Vite and Auth/Firestore emulators already running.
// Required: PLAYWRIGHT_MODULE, QA_BASE_URL, GCLOUD_PROJECT=demo-*,
// FIRESTORE_EMULATOR_HOST=127.0.0.1:<port>, FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:<port>.
// Example: node tests/browser/homeSocial.mjs
// QA_ARTIFACT_DIR optionally receives screenshots at 320/390/430/1440 px.
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
const app = initializeApp({ projectId }, `qa-home-${randomUUID()}`);
const db = getFirestore(app);
const auth = getAuth(app);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const browser = await chromium.launch();
const runId = randomUUID();
const stakeId = `qa-home-${runId}`;
const uid = `qa-home-${runId}`;
const email = `${uid}@example.invalid`;
const password = `Qa-${randomUUID()}!`;
let createdUser = false;

let passed = 0;
const now = new Date().toISOString();
const eventId = 'next';
const member = db.doc(`stakes/${stakeId}/members/${uid}`);
try {
  await auth.createUser({ uid, email, password, emailVerified: true }); createdUser = true;
  const batch = db.batch();
  batch.set(db.doc(`stakes/${stakeId}`), { name: 'Palo sintetico Home', slug: stakeId, isActive: true });
  batch.set(db.doc(`users/${uid}`), { firstName: 'Persona', lastName: 'Sintetica', fullName: 'Persona Sintetica', email, role: 'participant',
    stakeId, stakeName: 'Palo sintetico Home', birthDate: '2008-07-07', genderRoleCategory: 'giovane_uomo',
    unitId: 'qa-unit', unitName: 'Unità sintetica', city: 'Città demo', phone: '3330000000', mustChangePassword: false, createdAt: now, updatedAt: now });
  batch.set(member, { status: 'active', staffRole: null, claimedUnitId: 'qa-unit', version: 1 });
  batch.set(db.doc(`stakes/${stakeId}/activities/${eventId}`), {
    title: 'Prossima attività sintetica', description: 'Attività sintetica per test', location: 'Sede sintetica',
    isPublic: true, isVisible: true, status: 'registrations_open', activityType: 'standard', targetCategory: 'all',
    startDate: '2027-07-01T15:00:00.000Z', endDate: '2027-07-01T18:00:00.000Z',
    registrationOpen: '2026-01-01T00:00:00.000Z', registrationClose: '2027-06-30T18:00:00.000Z', createdAt: now, updatedAt: now,
  });
  for (const [id, published, visibility, title] of [
    ['visible', true, 'all_authenticated', 'Aggiornamento sintetico visibile'],
    ['draft', false, 'all_authenticated', 'BOZZA SEGRETA SENTINELLA'],
    ['private', true, 'admins_only', 'ADMIN SEGRETO SENTINELLA'],
  ]) batch.set(db.doc(`stakes/${stakeId}/feedPosts/${id}`), {
    title, body: 'Dati sintetici della prova indipendente.', published, visibility, type: 'announcement', pinned: false,
    createdBy: 'synthetic-staff', createdAt: now, updatedAt: now, publishedAt: now, likeCount: 0,
  });
  await batch.commit();
  const context = await browser.newContext();
  const origins = new Set([base.origin, `http://${firestoreHost}`, `http://${authHost}`]);
  await context.route('**/*', route => origins.has(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('/login', base).href);
  const target = await page.evaluate(async () => {
    const { firebaseApp, auth, db } = await import('/src/services/firebase/app.ts');
    const { useLocalEmulators } = await import('/src/services/firebase/config.ts');
    return [firebaseApp.options.projectId, useLocalEmulators, auth.emulatorConfig?.port, db._settings.host];
  });
  assert.deepEqual(target, [projectId, true, Number(authHost.split(':')[1]), firestoreHost]);
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[autocomplete=current-password]').fill(password);
  await page.locator('.auth-foot button[type=submit]').click();
  await page.waitForURL(url => !url.pathname.startsWith('/login')).catch(async error => {
    console.error(await page.locator('body').innerText(), errors); throw error;
  });
  await page.goto(new URL('/me', base).href);
  for (const width of [320, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await page.getByText('Aggiornamento sintetico visibile', { exact: true }).waitFor();
    assert.equal(await page.getByText(/SEGRET[AO] SENTINELLA/).count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow ${width}`);
    await page.locator('.social-next-card').getByRole('link', { name: /Iscriviti/ }).waitFor().catch(async error => {
      console.error(await page.locator('body').innerText(), errors); throw error;
    });
    if (process.env.QA_ARTIFACT_DIR) await page.screenshot({ path: `${process.env.QA_ARTIFACT_DIR}/home-${width}.png`, fullPage: true });
    console.log(`PASS viewport ${width}: privacy e prossima attività`); passed++;
  }
  await page.getByRole('button', { name: 'Foto e video', exact: true }).click();
  await page.getByText('Nessun contenuto in questo filtro').waitFor();
  await page.getByRole('button', { name: 'Tutto', exact: true }).last().click();
  const card = page.locator('.feed-card').filter({ hasText: 'Aggiornamento sintetico visibile' });
  const like = card.locator('button').last();
  await like.click();
  await page.waitForFunction(() => document.querySelector('.feed-card button[aria-pressed="true"]'));
  assert.equal((await db.doc(`stakes/${stakeId}/feedPosts/visible`).get()).data().likeCount, 1);
  await like.click();
  await page.waitForFunction(() => document.querySelector('.feed-card button[aria-pressed="false"]'));
  assert.equal((await db.doc(`stakes/${stakeId}/feedPosts/visible`).get()).data().likeCount, 0);
  await context.setOffline(true);
  await page.getByText('Sei offline. Riconnettiti per inviare commenti e Mi piace.').waitFor();
  assert.equal(await card.getByRole('button').last().isDisabled(), true);
  await context.setOffline(false);
  await member.update({ status: 'removed' });
  await page.getByText('Aggiornamento sintetico visibile', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.feed-card').count(), 0);
  await member.update({ status: 'pending' });
  await page.reload();
  await page.locator('.social-feed').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.feed-card').count(), 0);
  await member.update({ status: 'active' });
  await page.getByText('Aggiornamento sintetico visibile', { exact: true }).waitFor();
  console.log('PASS filtri, like/annulla, offline, revoca e ripristino'); passed++;
  for (const [status, label] of [['draft', 'Bozza'], ['pending_parent_authorization', 'In attesa autorizzazione genitore'], ['confirmed', 'Confermata'], ['cancelled', 'Annullata']]) {
    await db.doc(`stakes/${stakeId}/activities/${eventId}/registrations/user_${uid}`).set({
      userId: uid, ownerUid: uid, registrationStatus: status, fullName: 'Persona Sintetica', createdAt: now, updatedAt: now,
    });
    // Prime the real Firestore client from the server before reloading the UI.
    await page.evaluate(async ({ stakeId, eventId, uid }) => {
      const { registrationsService } = await import('/src/services/firestore/registrationsService.ts');
      await registrationsService.getRegistrationById(stakeId, eventId, `user_${uid}`);
    }, { stakeId, eventId, uid });
    await page.reload();
    const next = page.locator('.social-next-card');
    await next.getByText(label, { exact: true }).waitFor();
    await next.getByRole('link', { name: status === 'cancelled' ? /Iscriviti/ : /Dettagli attività/ }).waitFor();
  }
  console.log('PASS prossima attività: bozza, autorizzazione, confermata e annullata'); passed++;
  // A visible reminder with an inaccessible parent must yield an explicit
  // recoverable error, never silently turn a failed read into an empty feed.
  await db.doc(`stakes/${stakeId}/activities/private-event`).set({ isPublic: false, isVisible: false, status: 'draft' });
  const brokenPost = db.doc(`stakes/${stakeId}/feedPosts/error-post`);
  await brokenPost.set({ type: 'activity_reminder', title: 'Riferimento sintetico non leggibile',
    published: true, visibility: 'all_authenticated', activityId: 'private-event', likeCount: 0, createdAt: now });
  await page.reload();
  await page.locator('.social-feed [role=alert]').waitFor();
  await brokenPost.delete();
  await page.locator('.social-feed').getByRole('button', { name: 'Riprova', exact: true }).click();
  await page.getByText('Aggiornamento sintetico visibile', { exact: true }).waitFor();
  await page.locator('.social-feed [role=alert]').waitFor({ state: 'hidden' });
  console.log('PASS errore esplicito e Riprova dopo ripristino dati'); passed++;
  const galleryId = 'qa-gallery';
  await db.doc(`stakes/${stakeId}/galleries/${galleryId}`).set({ title: 'Galleria sintetica', activityId: eventId, mediaCount: 2, batchSize: 10, uploadsClosed: true });
  for (const id of ['one', 'two']) await db.doc(`stakes/${stakeId}/galleries/${galleryId}/media/${id}`).set({
    type: 'image', activityId: eventId, caption: `Immagine sintetica ${id}`, uploadedBy: 'synthetic-other',
    storageUrl: `${base.origin}/brand-logo.png`, thumbnailUrl: `${base.origin}/brand-logo.png`, status: 'uploaded', likeCount: 0, createdAt: now,
  });
  await db.doc(`stakes/${stakeId}/feedPosts/photos`).set({ title: 'Foto sintetiche del gruppo',
    type: 'gallery', galleryId, activityId: eventId, mediaIds: ['one', 'two'], published: true,
    visibility: 'gallery_members', likeCount: 0, createdAt: now });
  await page.reload();
  await page.getByText('Aggiornamento sintetico visibile', { exact: true }).waitFor();
  assert.equal(await page.getByText('Foto sintetiche del gruppo', { exact: true }).count(), 0, 'P2: iscrizione annullata esclude la galleria');
  await db.doc(`stakes/${stakeId}/activities/${eventId}/registrations/user_${uid}`).update({ registrationStatus: 'confirmed' });
  await page.reload();
  await page.getByText('Foto sintetiche del gruppo', { exact: true }).waitFor();
  for (const width of [320, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `media overflow ${width}`);
    if (process.env.QA_ARTIFACT_DIR) await page.screenshot({ path: `${process.env.QA_ARTIFACT_DIR}/home-media-${width}.png`, fullPage: true });
  }
  // Real router history: Back from the viewer must target a prior SPA route.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.bottom-nav').getByRole('link', { name: /Calendario/ }).click();
  await page.locator('.bottom-nav').getByRole('link', { name: /Home/ }).click();
  await page.getByText('Foto sintetiche del gruppo', { exact: true }).waitFor();
  await page.setViewportSize({ width: 1440, height: 960 });
  // Delay delivery of a real server snapshot: it was read before the new
  // comment, but arrives after the real write confirms. No data is fabricated.
  await page.evaluate(async () => {
    const { galleryCommentsService } = await import('/src/services/firestore/galleryCommentsService.ts');
    const original = galleryCommentsService.list.bind(galleryCommentsService);
    galleryCommentsService.list = async (...args) => {
      const result = await original(...args);
      if (args[2] !== 'one') return result;
      return new Promise(resolve => { window.__releaseHomeCommentRead = () => resolve(result); });
    };
  });
  await page.getByRole('button', { name: /Apri foto e commenti/ }).click();
  const viewer = page.getByRole('dialog', { name: 'Foto e commenti', exact: true });
  await viewer.waitFor();
  const mediaLike = viewer.getByRole('button', { name: 'Like alla foto/video', exact: true });
  await mediaLike.click();
  await page.waitForFunction(() => document.querySelector('.media-lightbox button[aria-label="Like alla foto/video"]')?.getAttribute('aria-pressed') === 'true');
  assert.equal((await db.doc(`stakes/${stakeId}/galleries/${galleryId}/media/one`).get()).data().likeCount, 1);
  await mediaLike.click();
  await page.waitForFunction(() => document.querySelector('.media-lightbox button[aria-label="Like alla foto/video"]')?.getAttribute('aria-pressed') === 'false');
  assert.equal((await db.doc(`stakes/${stakeId}/galleries/${galleryId}/media/one`).get()).data().likeCount, 0);
  await viewer.getByRole('button', { name: 'Segnala', exact: true }).click();
  const report = page.getByRole('dialog', { name: 'Segnalare questa foto?', exact: true });
  await report.waitFor();
  await page.evaluate(() => history.back());
  await report.waitFor({ state: 'hidden' });
  await viewer.waitFor();
  const input = viewer.getByRole('textbox', { name: 'Scrivi un commento' });
  await input.fill('Bozza sintetica uno');
  await viewer.getByRole('button', { name: 'Successivo', exact: true }).click();
  assert.equal(await input.inputValue(), '');
  await viewer.getByRole('button', { name: 'Precedente', exact: true }).click();
  assert.equal(await input.inputValue(), 'Bozza sintetica uno');
  await viewer.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await page.getByRole('button', { name: 'Continua a scrivere', exact: true }).click();
  assert.equal(await input.inputValue(), 'Bozza sintetica uno');
  await context.setOffline(true);
  await page.waitForFunction(() => document.querySelector('.media-comments button[type="submit"]')?.disabled === true);
  assert.equal(await viewer.getByRole('button', { name: 'Invia', exact: true }).isDisabled(), true);
  await context.setOffline(false);
  await viewer.getByRole('button', { name: 'Invia', exact: true }).click();
  await viewer.getByText('Bozza sintetica uno', { exact: true }).waitFor();
  await page.evaluate(() => window.__releaseHomeCommentRead?.());
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await viewer.getByText('Bozza sintetica uno', { exact: true }).count(), 1, 'La risposta precedente non cancella il commento confermato');
  const comments = await db.collection(`stakes/${stakeId}/galleries/${galleryId}/media/one/comments`).get();
  assert.equal(comments.size, 1);
  const duplicateIds = await page.evaluate(async ({ stakeId, galleryId, uid }) => {
    const { galleryCommentsService } = await import('/src/services/firestore/galleryCommentsService.ts');
    const args = { stakeId, galleryId, mediaId: 'two', uid, displayName: 'Persona Sintetica', body: 'Doppio invio sintetico' };
    const results = await Promise.all([galleryCommentsService.add(args), galleryCommentsService.add(args)]);
    return results.map(item => item.id);
  }, { stakeId, galleryId, uid });
  assert.equal(duplicateIds[0], duplicateIds[1]);
  assert.equal((await db.collection(`stakes/${stakeId}/galleries/${galleryId}/media/two/comments`).get()).size, 1);
  await input.fill('Bozza da non perdere con Back');
  await page.evaluate(() => history.back());
  await page.getByRole('button', { name: 'Continua a scrivere', exact: true }).click();
  assert.equal(await input.inputValue(), 'Bozza da non perdere con Back');
  await viewer.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await page.getByRole('button', { name: 'Scarta bozza', exact: true }).click();
  await viewer.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /Apri foto e commenti/ }).click();
  await viewer.waitFor();
  assert.equal(await input.inputValue(), '', 'Scarto esplicito non conserva una bozza');
  await member.update({ status: 'removed' });
  await viewer.waitFor({ state: 'hidden' });
  assert.equal(await page.getByText('Bozza sintetica uno', { exact: true }).count(), 0);
  await member.update({ status: 'active' });
  await page.getByText('Foto sintetiche del gruppo', { exact: true }).waitFor();
  await page.evaluate(async ({ stakeId, galleryId, uid }) => {
    const { galleryCommentsService } = await import('/src/services/firestore/galleryCommentsService.ts');
    const args = { stakeId, galleryId, mediaId: 'two', uid, displayName: 'Persona Sintetica', body: 'Esito conservato a viewer chiuso' };
    await galleryCommentsService.add(args);
    if (galleryCommentsService.getSubmission(args)?.status !== 'sent') throw new Error('Fixture non conserva esito');
    window.__homeSubmissionVisible = () => Boolean(galleryCommentsService.getSubmission(args));
  }, { stakeId, galleryId, uid });
  await member.update({ status: 'removed' });
  await page.waitForFunction(() => window.__homeSubmissionVisible() === false);
  console.log('PASS media P2, quattro viewport, bozze per foto, continua, offline, invio reale e revoca'); passed++;
  assert.deepEqual(errors, []);
  await context.close();
} finally {
  await browser.close();
  await db.recursiveDelete(db.doc(`stakes/${stakeId}`));
  await db.doc(`users/${uid}`).delete();
  if (createdUser) await auth.deleteUser(uid);
  await deleteApp(app);
  console.log(`HOME_BROWSER_PASS=${passed}/8`);
}
