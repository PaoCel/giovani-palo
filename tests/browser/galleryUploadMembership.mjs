// Real components/provider with controlled membership delivery. The profile
// remains admin while active membership is revoked: access stays "member".
import assert from 'node:assert/strict';
const base = process.env.QA_BASE_URL;
assert.match(base ?? '', /^http:\/\/(127\.0\.0\.1|localhost):\d+$/u);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch();
try {
  const page = await browser.newPage(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.goto(`${base}/tests/browser/fixtures/galleryContext.html`);
  await page.waitForFunction(() => window.__galleryContext?.subscriptions.some(s => s.kind === 'gallery'));
  await page.evaluate(() => window.__galleryContext.subscriptions.filter(s => s.kind === 'gallery').at(-1).callback({ id: 'active-gallery', stakeId: 'qa-a', activityId: 'qa-a', mediaCount: 1,
    uploadsClosed: false, uploadsWindowSource: 'manual', uploadsOpenFrom: Date.now() - 3600000, uploadsOpenUntil: Date.now() + 3600000 }));
  await page.waitForFunction(() => window.__galleryContext.subscriptions.some(s => s.kind === 'latest'));
  await page.evaluate(() => window.__galleryContext.subscriptions.filter(s => s.kind === 'latest').at(-1).callback([{ id: 'image', type: 'image', thumbnailUrl: '/synthetic.png' }]));
  const add = page.getByRole('button', { name: 'Aggiungi foto o video', exact: true });
  await add.waitFor(); console.log('PASS active member: upload disponibile');
  await page.evaluate(() => window.__galleryContext.setRole('admin'));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  await page.evaluate(() => window.__galleryContext.setMemberStatus('removed'));
  await add.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.ag-mosaic__big').count(), 1);
  console.log('PASS staff fallback: galleria leggibile, upload assente');
  await page.evaluate(() => window.__galleryContext.setMemberStatus('active'));
  await add.waitFor(); console.log('PASS staff con membership attiva: upload disponibile');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), add.click()]);
  await page.evaluate(() => window.__galleryContext.setMemberStatus('removed'));
  await add.waitFor({ state: 'hidden' });
  await chooser.setFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZQAAAAASUVORK5CYII=', 'base64') });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  assert.equal(await page.getByTestId('queue').innerText(), '0:/');
  assert.equal(await page.locator('.ag-mosaic__big').count(), 1);
  console.log('PASS revoca con access member stabile: vecchio chooser non invia né naviga');
  await page.evaluate(() => window.__galleryContext.setMemberStatus('active'));
  const [expired] = await Promise.all([page.waitForEvent('filechooser'), add.click()]);
  await page.evaluate(() => { window.__realDateNow = Date.now; Date.now = () => window.__realDateNow() + 7200000; });
  try {
    await expired.setFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZQAAAAASUVORK5CYII=', 'base64') });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(await page.getByTestId('queue').innerText(), '0:/');
  } finally { await page.evaluate(() => { Date.now = window.__realDateNow; }); }
  console.log('PASS finestra scaduta senza render: chooser non crea upload né navigazione');
  const [fresh] = await Promise.all([page.waitForEvent('filechooser'), add.click()]);
  await fresh.setFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZQAAAAASUVORK5CYII=', 'base64') });
  await page.waitForFunction(() => document.querySelector('[data-testid="queue"]').textContent.endsWith(':/activities/qa-a/foto'));
  console.log('PASS ripristino membership: chooser nuovo accettato');
  assert.deepEqual(errors, []);
  console.log('GALLERY_UPLOAD_MEMBERSHIP_PASS=6/6');
} finally { await browser.close(); }
