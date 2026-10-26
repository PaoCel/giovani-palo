// Controlled late subscriptions around real components and real upload provider.
import assert from 'node:assert/strict';
const base = process.env.QA_BASE_URL;
assert.match(base ?? '', /^http:\/\/(127\.0\.0\.1|localhost):\d+$/u);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch();
try {
  const page = await browser.newPage(); page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.goto(`${base}/tests/browser/fixtures/galleryContext.html`);
  const emit = async (gallery, image) => {
    await page.waitForFunction(() => window.__galleryContext?.subscriptions.some(s => s.kind === 'gallery'));
    await page.evaluate(gallery => {
      const subscriptions = window.__galleryContext.subscriptions;
      const latest = subscriptions.filter(s => s.kind === 'gallery').at(-1);
      latest.callback({ id: gallery, stakeId: latest.scope.split('/')[0], activityId: latest.scope.split('/')[1], mediaCount: 1,
        uploadsClosed: false, uploadsWindowSource: 'manual', uploadsOpenFrom: Date.now() - 3600000, uploadsOpenUntil: Date.now() + 3600000 });
    }, gallery);
    await page.waitForFunction(gallery => window.__galleryContext.subscriptions.some(s => s.kind === 'latest' && s.scope.endsWith(`/${gallery}`)), gallery);
    await page.evaluate(image => window.__galleryContext.subscriptions.filter(s => s.kind === 'latest').at(-1).callback([{ id: image, type: 'image', thumbnailUrl: `/${image}.png` }]), image);
    await page.locator('.ag-mosaic__big').waitFor();
  };
  await emit('gallery-a', 'old-image');
  for (const [kind, scope] of [
    ['account', { uid: 'qa-b', stake: 'qa-a', event: 'qa-a' }],
    ['palo', { uid: 'qa-b', stake: 'qa-b', event: 'qa-a' }],
    ['attività', { uid: 'qa-b', stake: 'qa-b', event: 'qa-b' }],
  ]) {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Aggiungi foto o video', exact: true }).click()]);
    await page.evaluate(scope => {
      window.__oldGalleryCallbacks = [...window.__galleryContext.subscriptions];
      window.__galleryContext.setScope(scope);
    }, scope);
    await page.locator('.ag-mosaic__big').waitFor({ state: 'hidden' });
    await page.evaluate(() => {
      for (const sub of window.__oldGalleryCallbacks) {
        sub.callback(sub.kind === 'gallery' ? { id: 'late-old-gallery', mediaCount: 1 } : [{ id: 'late', type: 'image', thumbnailUrl: '/late-old-image.png' }]);
      }
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(await page.locator('.ag-mosaic__big').count(), 0, `${kind}: risposta vecchia scartata`);
    await emit(`gallery-${kind}`, `new-${kind}`);
    await chooser.setFiles({ name: 'sintetico.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZQAAAAASUVORK5CYII=', 'base64') });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(await page.getByTestId('queue').innerText(), '0:/', `${kind}: vecchio chooser non crea upload né navigazione`);
    assert.ok((await page.locator('.ag-mosaic__big').getAttribute('style')).includes(`new-${kind}`));
    console.log(`PASS ${kind}: galleria e anteprime tardive isolate; chooser invalidato`);
  }
  const [galleryChooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Aggiungi foto o video', exact: true }).click()]);
  await emit('replacement-gallery', 'replacement-image');
  await galleryChooser.setFiles({ name: 'sintetico.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZQAAAAASUVORK5CYII=', 'base64') });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  assert.equal(await page.getByTestId('queue').innerText(), '0:/', 'Galleria cambiata nello stesso evento: chooser precedente invalidato');
  console.log('PASS galleria: sostituzione nello stesso evento invalida chooser');
  const [validChooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Aggiungi foto o video', exact: true }).click()]);
  await validChooser.setFiles({ name: 'sintetico.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZQAAAAASUVORK5CYII=', 'base64') });
  await page.waitForFunction(() => document.querySelector('[data-testid="queue"]').textContent.endsWith(':/activities/qa-b/foto')).catch(async error => { console.error(await page.locator('body').innerText()); throw error; });
  console.log('PASS controllo positivo: chooser corrente avvia il percorso upload');
  assert.deepEqual(errors, []);
  await page.close();
} finally { await browser.close(); }
