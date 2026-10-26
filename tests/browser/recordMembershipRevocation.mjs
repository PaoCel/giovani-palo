// QA_BASE_URL points to local Vite in demo/emulator mode; run on the QA host.
// Real RecordNightPage and membership hook, controlled services, no backend.
import assert from "node:assert/strict";
const base = process.env.QA_BASE_URL;
assert.match(base ?? "", /^http:\/\/(127\.0\.0\.1|localhost):\d+$/u);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const browser = await chromium.launch();
let passed = 0;
try {
  for (const scenario of ["sheet", "family", "failed-own-read", "late"]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    try {
      await page.goto(`${base}/tests/browser/fixtures/recordMembershipRevocation.html?scenario=${scenario}`);
      await page.waitForFunction(() => window.__qaRecord?.calls.some(call => call.kind === "listRecords"));
      if (scenario !== "late") {
        await page.getByText("Record riservato sentinella", { exact: true }).first().waitFor();
        await page.getByRole("button", { name: /Proponi/ }).first().click();
        await page.getByRole("dialog").waitFor();
        await page.getByRole("textbox").first().fill("Testo non inviato");
      }
      await page.evaluate(() => window.__qaRecord.revoke());
      await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
      if (scenario === "late") await page.evaluate(() => window.__qaRecord.releaseOld());
      // Let delayed service promises and React effects complete.
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 150)));
      assert.equal(await page.getByText("Record riservato sentinella", { exact: true }).count(), 0, `${scenario}: elenco protetto rimosso`);
      assert.equal(await page.getByRole("dialog").count(), 0, `${scenario}: foglio chiuso`);
      assert.equal(await page.getByRole("button", { name: /Proponi/ }).count(), 0);
      assert.deepEqual(await page.evaluate(() => window.__qaRecord.calls.filter(call => call.kind === "propose" || call.kind === "challenge")), []);
      if (scenario === "sheet" || scenario === "family") {
        await page.getByRole("button", { name: "Modifica", exact: true }).click();
        const editDialog = page.getByRole("dialog");
        await editDialog.waitFor();
        assert.equal(await editDialog.getByText("Record riservato sentinella", { exact: true }).count(), 0);
        await editDialog.getByRole("textbox").first().fill("Proposta personale aggiornata");
        await editDialog.getByRole("button", { name: /Salva/ }).click();
        await page.waitForFunction(() => window.__qaRecord.calls.some(call => call.kind === "edit" && call.uid === "qa-owned-entry"));
        await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
        const withdraw = page.getByRole("button", { name: "Ritira", exact: true });
        await withdraw.waitFor();
        await withdraw.click();
        await page.getByRole("button", { name: "Annulla", exact: true }).click();
        await page.waitForFunction(() => window.__qaRecord.calls.some(call => call.kind === "restore"));
        assert.ok((await page.evaluate(() => window.__qaRecord.calls.filter(call => call.kind === "ownEntries"))).every(call => call.uid === "qa-record-owner"), "Famiglia usa ownerUid del genitore, non quello del figlio");
      }
      assert.deepEqual(errors, []);
      console.log(`PASS ${scenario}: revoca chiude dati e foglio; richieste tardive innocue`);
      passed++;
    } catch (error) {
      console.error(scenario, await page.locator("body").innerText(), errors);
      throw error;
    } finally { await page.close(); }
  }
} finally { await browser.close(); console.log(`PASS=${passed}/4`); }
