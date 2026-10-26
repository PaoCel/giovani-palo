// Guardia browser indipendente dei dettagli staff di Persone. Avviare Vite
// in modalità emulatori/demo, poi eseguire sul Mac mini:
// QA_DETAILS_BASE_URL=http://127.0.0.1:5349 PLAYWRIGHT_MODULE=/percorso/playwright-core/index.mjs node tests/browser/stakeMembershipDetails.mjs
// PLAYWRIGHT_MODULE è facoltativo se playwright-core è già risolvibile.
import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright-core");

const baseUrl = process.env.QA_DETAILS_BASE_URL || "http://127.0.0.1:5349";
assert.match(baseUrl, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/u, "La QA usa soltanto Vite locale");
const browser = await chromium.launch({ headless: true });
const results = [];
let failure;

async function check(label, run) {
  await run();
  results.push(label);
  console.log(`PASS ${label}`);
}

async function fixture(scenario, run) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Una chiamata inattesa alla rete reale è un errore della fixture.
  await page.route(/^https:\/\//u, (route) => {
    const hostname = new URL(route.request().url()).hostname;
    if (hostname === "fonts.googleapis.com" || hostname === "fonts.gstatic.com") return route.abort();
    const firebaseBackend = /^(?:firestore|identitytoolkit|securetoken|storage|firebasestorage|firebaseinstallations|fcmregistrations|fcm|firebaseappcheck)\.googleapis\.com$/u.test(hostname)
      || /(?:^|\.)(?:firebaseio\.com|firebasedatabase\.app|cloudfunctions\.net)$/u.test(hostname);
    if (!firebaseBackend) return route.continue();
    errors.push(`Backend Firebase reale inatteso: ${hostname}`);
    return route.abort();
  });
  try {
    await page.goto(`${baseUrl}/tests/browser/fixtures/stakeMembershipDetails.html?scenario=${scenario}&scheda=rifiutate`, { waitUntil: "domcontentloaded" });
    await page.locator(".mship-card").first().waitFor();
    await run(page);
    assert.deepEqual(errors, [], `${scenario}: errori browser`);
    assert.equal(await page.evaluate(() => window.__qaDetails.getMounts()), 1, "il cambio palo non deve rimontare il pannello");
  } finally {
    await page.close();
  }
}

const undoCount = (page) => page.getByRole("button", { name: "Annulla rifiuto", exact: true }).count();
const readCount = (page, stakeId, uid) => page.evaluate(({ stakeId, uid }) => window.__qaDetails.calls.filter((call) => call.kind === "previous" && call.stakeId === stakeId && (!uid || call.uid === uid)).length, { stakeId, uid });
const eventually = async (read, expected, label) => {
  const deadline = Date.now() + 10_000;
  let actual;
  do {
    actual = await read();
    if (actual === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  } while (Date.now() < deadline);
  assert.equal(actual, expected, label);
};

try {
  await check("cache distinta per palo, stesso uid e stessa versione", () => fixture("scope", async (page) => {
    await eventually(() => undoCount(page), 1, "nel palo A il dirigente può annullare il proprio rifiuto");
    await page.locator("#qa-stake-b").click();
    await eventually(() => readCount(page, "qa-palo-b"), 1, "i dettagli del palo B devono essere riletti");
    await eventually(() => undoCount(page), 0, "nel palo B il rifiuto di un altro dirigente non si annulla");
    await page.locator("#qa-stake-a").click();
    await eventually(() => undoCount(page), 1, "tornando al palo A si ritrovano i dettagli corretti");
    assert.equal(await readCount(page, "qa-palo-a"), 1, "i dettagli riusciti di A restano in cache");
    assert.equal(await page.getByRole("alert").count(), 0);
  }));

  await check("errore parziale recuperabile, solo la persona fallita viene riletta", () => fixture("retry", async (page) => {
    await page.getByRole("alert").waitFor();
    await eventually(() => undoCount(page), 1, "il successo parziale resta utilizzabile");
    assert.equal(await page.locator(".mship-card").count(), 2, "la coda rimane visibile");
    await page.getByRole("button", { name: "Riprova", exact: true }).click();
    await eventually(() => undoCount(page), 2, "Riprova ripristina Annulla rifiuto");
    assert.equal(await page.getByRole("alert").count(), 0, "errore cancellato dopo il recupero");
    assert.equal(await page.getByRole("button", { name: "Riprova", exact: true }).count(), 0);
    assert.equal(await readCount(page, "qa-palo-a", "qa-successo"), 1);
    assert.equal(await readCount(page, "qa-palo-a", "qa-primo-errore"), 2);
  }));

  await check("assenza reale del documento senza falso errore", () => fixture("absent", async (page) => {
    await eventually(() => readCount(page, "qa-palo-a"), 1, "lettura del documento assente");
    assert.equal(await undoCount(page), 0);
    assert.equal(await page.getByRole("alert").count(), 0);
    assert.equal(await page.getByRole("button", { name: "Riprova", exact: true }).count(), 0);
  }));

  await check("compatibilità del campo previous legacy", () => fixture("legacy", async (page) => {
    await eventually(() => readCount(page, "qa-palo-a"), 1, "lettura separata senza documento");
    await eventually(() => undoCount(page), 1, "il campo legacy abilita ancora Annulla rifiuto");
    assert.equal(await page.getByRole("alert").count(), 0);
  }));

  await check("risposta tardiva del palo precedente ignorata", () => fixture("late", async (page) => {
    await eventually(() => readCount(page, "qa-palo-a"), 1, "lettura A in corso");
    await page.locator("#qa-stake-b").click();
    await eventually(() => readCount(page, "qa-palo-b"), 1, "lettura B conclusa");
    assert.equal(await undoCount(page), 0);
    await page.evaluate(() => window.__qaDetails.releaseFirstStake());
    // La risposta tardiva e il setState percorrono almeno un giro del browser.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await undoCount(page), 0, "il risultato di A non deve apparire in B");
    await page.locator("#qa-stake-a").click();
    await eventually(() => undoCount(page), 1, "ritornando ad A la nuova lettura riesce");
    assert.equal(await readCount(page, "qa-palo-a"), 2, "il risultato cancellato non viene messo in cache");
  }));
} catch (error) {
  failure = error;
  console.error(error.stack || error);
} finally {
  await browser.close();
}
console.log(JSON.stringify({ passed: results.length, checks: results, failed: Boolean(failure) }));
if (failure) process.exitCode = 1;
