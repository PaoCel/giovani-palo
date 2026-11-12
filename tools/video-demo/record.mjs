// Records one demo scene against the local emulators (seeded palo-demo).
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright-core");
import fs from "node:fs";
const BASE = "http://127.0.0.1:5173";
const EXE = process.env.CHROME_PATH || process.env.HOME + "/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const TOKEN = process.env.MATTEO_TOKEN;
const scene = process.argv[2];
// PACE slows every pause so each step can be followed on screen.
const PACE = Number(process.env.PACE || 1.7);
const sleep = ms => new Promise(r => setTimeout(r, ms * PACE));

const OVERLAY = ({ mobile }) => {
  const install = () => {
    const st = document.createElement("style");
    st.textContent = `
      #__cur{position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:transform .05s linear}
      #__cur svg{filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
      .__tap{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(0,85,129,.28);border:2px solid rgba(0,85,129,.55);z-index:2147483647;pointer-events:none;animation:__t .6s ease-out forwards}
      @keyframes __t{from{transform:scale(.5);opacity:1}to{transform:scale(1.4);opacity:0}}
      [aria-label="Chiudi suggerimento installazione"], .pwa-install, [class*="install-hint"], [class*="InstallHint"]{}
    `;
    document.documentElement.appendChild(st);
    if (!mobile) {
      const c = document.createElement("div"); c.id = "__cur";
      c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 13.8 L10.6 20.4 L13.4 19.1 L10.4 12.6 L16.6 12.6 Z" fill="#fff" stroke="#1d2a33" stroke-width="1.4" stroke-linejoin="round"/></svg>';
      document.documentElement.appendChild(c);
      addEventListener("mousemove", e => { c.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`; }, true);
    }
    addEventListener("pointerdown", e => {
      const t = document.createElement("div"); t.className = "__tap";
      t.style.left = e.clientX + "px"; t.style.top = e.clientY + "px";
      document.documentElement.appendChild(t); setTimeout(() => t.remove(), 700);
    }, true);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", install); else install();
};

async function session(role, mobile) {
  const vp = mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 };
  const DPR = mobile ? 2 : 1.5;
  const browser = await chromium.launch({ executablePath: EXE, args: [`--window-size=${vp.width},${vp.height}`, `--force-device-scale-factor=${DPR}`] });
  const base = { viewport: vp, ...(mobile ? { isMobile: true, hasTouch: true } : {}) };
  let state;
  if (role) {
    const c = await browser.newContext(base); const p = await c.newPage();
    await p.goto(BASE + "/login");
    await p.locator('input[type="email"]').fill(`${role}.demo@example.invalid`);
    await p.locator('input[type="password"]').fill("Demo-2026!");
    await p.locator('input[type="password"]').press("Enter");
    await p.waitForURL(u => !u.pathname.startsWith("/login")); await sleep(1500);
    state = await c.storageState({ indexedDB: true }); await c.close();
  }
  const dpr = DPR;
  const ctx = await browser.newContext({ ...base, deviceScaleFactor: dpr, storageState: state });
  await ctx.addInitScript(OVERLAY, { mobile });
  const page = await ctx.newPage(); page.setDefaultTimeout(20000);
  page.on("pageerror", e => console.log("PAGEERROR", e.message));
  const dir = `clips/${scene}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const frames = []; let n = 0;
  const cdp = await ctx.newCDPSession(page);
  cdp.on("Page.screencastFrame", async f => {
    const file = `${String(n++).padStart(5, "0")}.jpg`;
    fs.writeFileSync(`${dir}/${file}`, Buffer.from(f.data, "base64"));
    frames.push([file, f.metadata.timestamp]);
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1, maxWidth: Math.round(vp.width * dpr), maxHeight: Math.round(vp.height * dpr) });
  const marks = {};
  const mark = name => { marks[name] = Date.now() / 1000; };
  const done = async () => {
    await sleep(300);
    await cdp.send("Page.stopScreencast").catch(() => {});
    await ctx.close(); await browser.close();
    fs.writeFileSync(`${dir}/meta.json`, JSON.stringify({ marks, frames, dpr, mobile }));
    console.log(scene, "frames", frames.length, JSON.stringify(Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, +(v - marks.ready).toFixed(2)]))));
  };
  return { page, mark, done, mobile };
}

async function closeInstallHint(page) {
  const b = page.getByRole("button", { name: "Chiudi suggerimento installazione" });
  if (await b.count()) await b.first().click({ timeout: 2000 }).catch(() => {});
}
async function glide(page, locator, steps = 40) {
  const box = await locator.boundingBox(); if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps }); await sleep(250);
}
async function click(s, locator) {
  await locator.scrollIntoViewIfNeeded();
  if (!s.mobile) { await glide(s.page, locator); }
  await locator.click(); await sleep(350);
}
async function type(locator, text, clear = false) {
  if (clear) await locator.fill("");
  await locator.pressSequentially(text, { delay: 85 });
}
async function smoothScrollTo(page, locator, offset = 120) {
  await page.evaluate(([sel, off]) => {}, ["", 0]);
  const y = await locator.evaluate((el, off) => el.getBoundingClientRect().top + scrollY - off, offset);
  await page.evaluate(y => window.scrollTo({ top: y, behavior: "smooth" }), y); await sleep(1200);
}

const scenes = {
// Selettori (testo a schermo → file).
//
// adminhome
//   region «Totali del palo», «Attività create», «Iscrizioni aperte»,
//   «Partecipanti totali», h2 «Iscrizioni aperte adesso»:
//     src/copy/adminElenchi.ts (totali, attivitaCreate, iscrizioniAperte,
//     partecipantiTotali, apertiTitolo)
//     src/pages/admin/AdminDashboardPage.tsx (section aria-label, ul.admin-stats, h2)
//   link delle card (titolo attività + «N iscritti»):
//     src/components/AdminActivityCard.tsx
//     src/copy/adminElenchi.ts (iscritti «{n} iscritti»)
//   «Viaggio al Tempio», «Campeggio d'inverno»: titolo nel seed, tools/lib/demoData.mjs
//
// registrations
//   «Attivi», «Attesa», «Annullati»: src/components/admin/registrations/RegistrationsTab.tsx
//   group «Filtri iscritti»: stesso file (role=group, aria-label)
//   searchbox «Cerca» (type=search dentro label, placeholder «Nome, cognome o email»):
//     stesso file. Il nome accessibile è «Cerca», non il placeholder.
//   riga: button il cui nome contiene il display name.
//     src/utils/roomPreferences.ts getRegistrationDisplayName → «Rossi Pietro»
//     (cognome, poi nome). Nel seed è Pietro Rossi (tools/lib/demoData.mjs, index 12).
//   dialog «Rossi Pietro», «Lista d'attesa», «Rione Aurora»:
//     src/pages/admin/AdminEventDetailPage.tsx (AppModal title = display name,
//     subtitle «Dettaglio registrazione»)
//     src/utils/registrations.ts getRegistrationStatusLabel waitlist → «Lista d'attesa»
//     src/components/admin/registrations/registrationLabels.ts getUnitLabel
//   button «Chiudi» (aria-label, icona, dentro il dialog):
//     src/components/AppModal.tsx
//
// stats
//   region «Totali del palo»: src/copy/adminElenchi.ts totali
//   «Iscritti attivi del palo», «Registrazioni totali», «Iscritti con account»,
//   «Iscritti come ospiti», h2 «Unità» / «Organizzazione» / «Città»,
//   «Rione Aurora», «Ramo Collina», «Rione Brezza», «Giovane donna»,
//   «Giovane uomo», «Dirigente», h2 «Iscritti globali del palo»:
//     src/pages/admin/AdminStatsPage.tsx
//     src/copy/adminElenchi.ts iscrittiGlobali
//     src/utils/profile.ts getGenderRoleCategoryLabel
//   h2 della card: src/components/ui/Card.tsx (titleAs h2 → section)
//   Tre card in riga da 900px: src/styles/adminPages.css .admin-distributions
//
// surveys
//   h3 «Domande del sondaggio», h3 «Risultati»:
//     src/pages/admin/AdminEventDetailPage.tsx (tab surveys)
//   «risposte definitive», chip categoria, h4 della domanda, «Aperta»:
//     src/components/SurveyResultsPanel.tsx
//     src/utils/profile.ts (Giovane donna / Giovane uomo / Dirigente)
//   testi domande: tools/lib/demoData.mjs (q-giudizio, q-ricordo).
//   La frase intera del ricordo sta dietro «Mostra risposte complete»:
//   la scena non lo preme.
//
// unithome
//   region «Totali delle ultime attività», «Iscritti unità», «Passaggio necessario»,
//   «Consenso foto mancante», «Autorizzazione genitore mancante»,
//   h2 «Attività del palo», link della riga:
//     src/copy/homeUnita.ts
//     src/pages/unit/UnitDashboardPage.tsx (article del riquadro, Link.unit-home-row)
//   «Viaggio al Tempio»: titolo nel seed, tools/lib/demoData.mjs

  async adminhome() {
    const s = await session("admin", false);
    const { page } = s;
    await page.goto(BASE + "/admin");
    const totali = page.getByRole("region", { name: "Totali del palo" });
    await totali.getByText("Attività create", { exact: true }).waitFor();
    await totali.getByText("Iscrizioni aperte", { exact: true }).waitFor();
    await totali.getByText("Partecipanti totali", { exact: true }).waitFor();
    await totali.getByText(/^\d+$/).nth(2).waitFor();
    await closeInstallHint(page);
    await smoothScrollTo(page, totali.getByText("Attività create", { exact: true }), 160);
    await page.mouse.move(640, 280);
    s.mark("ready");
    await sleep(1200);
    for (const etichetta of ["Attività create", "Iscrizioni aperte", "Partecipanti totali"]) {
      const riquadro = totali.getByText(etichetta, { exact: true }).locator("xpath=ancestor::li[1]");
      await glide(page, riquadro);
      await sleep(1100);
    }
    const aperti = page.getByRole("heading", { name: "Iscrizioni aperte adesso", exact: true, level: 2 }).locator("xpath=ancestor::section[1]");
    await smoothScrollTo(page, aperti.getByRole("heading", { name: "Iscrizioni aperte adesso", exact: true }), 100);
    await sleep(400);
    await glide(page, aperti.getByRole("link", { name: /Viaggio al Tempio/ }));
    await sleep(1400);
    await glide(page, aperti.getByRole("link", { name: /Campeggio d'inverno/ }));
    await sleep(1400);
    s.mark("end");
    await s.done();
  },
  async registrations() {
    const s = await session("admin", false);
    const { page } = s;
    await page.goto(BASE + "/admin/events/viaggio-tempio/registrations");
    const attivi = page.getByText("Attivi", { exact: true });
    await attivi.waitFor();
    await page.getByText("Attesa", { exact: true }).waitFor();
    await page.getByText("Annullati", { exact: true }).waitFor();
    await closeInstallHint(page);
    await smoothScrollTo(page, attivi, 150);
    await page.mouse.move(620, 260);
    s.mark("ready");
    await sleep(1200);
    await glide(page, page.getByRole("group", { name: "Filtri iscritti" }));
    await sleep(1200);
    const cerca = page.getByRole("searchbox", { name: "Cerca" });
    await click(s, cerca);
    await type(cerca, "Pietro");
    await sleep(1200);
    await click(s, page.getByRole("button", { name: /Rossi Pietro/ }));
    const foglio = page.getByRole("dialog", { name: "Rossi Pietro" });
    await foglio.getByText("Lista d'attesa", { exact: true }).first().waitFor();
    await foglio.getByText("Rione Aurora", { exact: true }).first().waitFor();
    await sleep(1200);
    s.mark("sheet");
    await glide(page, foglio.getByText("Lista d'attesa", { exact: true }).first());
    await sleep(1200);
    await glide(page, foglio.getByText("Rione Aurora", { exact: true }).first());
    await sleep(1400);
    await click(s, foglio.getByRole("button", { name: "Chiudi", exact: true }));
    await foglio.waitFor({ state: "hidden" });
    await sleep(1200);
    s.mark("end");
    await s.done();
  },
  async stats() {
    const s = await session("admin", false);
    const { page } = s;
    await page.goto(BASE + "/admin/stats");
    const totali = page.getByRole("region", { name: "Totali del palo" });
    await totali.getByText("Iscritti attivi del palo", { exact: true }).waitFor();
    await totali.getByText("Registrazioni totali", { exact: true }).waitFor();
    await totali.getByText("Iscritti con account", { exact: true }).waitFor();
    await totali.getByText("Iscritti come ospiti", { exact: true }).waitFor();
    await totali.getByText(/^\d+$/).nth(3).waitFor();
    await closeInstallHint(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(700, 320);
    await sleep(800);
    s.mark("ready");
    await sleep(1200);
    const unita = page.getByRole("heading", { name: "Unità", exact: true, level: 2 });
    await smoothScrollTo(page, unita, 180);
    const nomi = page.getByRole("heading", { name: "Iscritti globali del palo", exact: true, level: 2 });
    const nomiBox = await nomi.boundingBox();
    const vista = page.viewportSize();
    if (nomiBox && vista && nomiBox.y < vista.height - 8) {
      await page.evaluate((top) => {
        window.scrollBy({ top: top - window.innerHeight - 24, behavior: "smooth" });
      }, nomiBox.y);
      await sleep(1100);
    }
    // Tre card affiancate (adminPages.css, min-width 900px): sposta la riga
    // quel tanto che «Città» resti tagliata a destra, «Organizzazione» dentro.
    await page.evaluate(() => {
      const h2 = (name) => [...document.querySelectorAll("h2")].find((el) => el.textContent.trim() === name);
      const unitaCard = h2("Unità")?.closest("section");
      const orgCard = h2("Organizzazione")?.closest("section");
      const cityCard = h2("Città")?.closest("section");
      const row = cityCard?.parentElement;
      if (!unitaCard || !orgCard || !cityCard || !row) return;
      const cityBox = cityCard.getBoundingClientRect();
      const orgBox = orgCard.getBoundingClientRect();
      const unitaBox = unitaCard.getBoundingClientRect();
      if (Math.abs(cityBox.top - unitaBox.top) > 40) return;
      const visible = Math.min(cityBox.right, window.innerWidth) - Math.max(cityBox.left, 0);
      if (visible < cityBox.width * 0.45) return;
      const keep = cityBox.width * 0.3;
      let shift = Math.round(Math.min(cityBox.right, window.innerWidth) - cityBox.left - keep);
      const room = window.innerWidth - orgBox.right - 16;
      if (shift > room) shift = Math.max(0, Math.floor(room));
      if (shift < 12) return;
      row.style.transition = "transform .7s ease";
      row.style.transform = `translateX(${shift}px)`;
    });
    await sleep(1000);
    const unitaCard = unita.locator("xpath=ancestor::section[1]");
    for (const nome of ["Rione Aurora", "Ramo Collina", "Rione Brezza"]) {
      await glide(page, unitaCard.getByText(nome, { exact: true }));
      await sleep(1100);
    }
    const orgCard = page.getByRole("heading", { name: "Organizzazione", exact: true, level: 2 }).locator("xpath=ancestor::section[1]");
    await glide(page, orgCard);
    await sleep(1500);
    s.mark("end");
    await s.done();
  },
  async surveys() {
    const s = await session("admin", false);
    const { page } = s;
    await page.goto(BASE + "/admin/events/campeggio-autunno/surveys");
    const risultati = page.locator("article").filter({ has: page.getByRole("heading", { name: "Risultati", exact: true, level: 3 }) });
    await risultati.getByRole("heading", { name: "Risultati", exact: true }).waitFor();
    await risultati.getByText("risposte definitive", { exact: true }).waitFor();
    await closeInstallHint(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(680, 360);
    await sleep(800);
    s.mark("ready");
    await sleep(1000);
    await smoothScrollTo(page, risultati.getByRole("heading", { name: "Risultati", exact: true }), 92);
    await sleep(500);
    await glide(page, risultati.getByText("risposte definitive", { exact: true }));
    await sleep(1200);
    for (const nome of ["Giovane donna", "Giovane uomo", "Dirigente"]) {
      await glide(page, risultati.getByText(nome, { exact: true }).first());
      await sleep(1000);
    }
    const stelle = risultati.getByRole("heading", { name: "Quanto ti è piaciuto il campeggio?", exact: true });
    await glide(page, stelle);
    await sleep(1400);
    const aperta = risultati.getByRole("heading", { name: "Qual è il momento che ti porti a casa?", exact: true });
    await smoothScrollTo(page, aperta, 200);
    await sleep(400);
    await glide(page, aperta);
    await sleep(1400);
    s.mark("end");
    await s.done();
  },
  async unithome() {
    const s = await session("dirigente", false);
    const { page } = s;
    await page.goto(BASE + "/unit");
    const totali = page.getByRole("region", { name: "Totali delle ultime attività" });
    await totali.waitFor();
    await closeInstallHint(page);
    await smoothScrollTo(page, totali.getByText("Iscritti unità", { exact: true }), 150);
    await page.mouse.move(640, 300);
    s.mark("ready");
    await sleep(1200);
    for (const etichetta of [
      "Iscritti unità",
      "Passaggio necessario",
      "Consenso foto mancante",
      "Autorizzazione genitore mancante",
    ]) {
      const riquadro = totali.getByText(etichetta, { exact: true }).locator("xpath=ancestor::article[1]");
      await glide(page, riquadro);
      await sleep(900);
    }
    const elenco = page.getByRole("heading", { name: "Attività del palo", exact: true, level: 2 }).locator("xpath=ancestor::section[1]");
    const viaggio = elenco.getByRole("link", { name: /Viaggio al Tempio/ });
    await smoothScrollTo(page, viaggio, 260);
    await sleep(400);
    await glide(page, viaggio);
    await sleep(1500);
    s.mark("end");
    await s.done();
  },
  async leader() {
    const s = await session("dirigente", false); const { page } = s;
    await page.mouse.move(700, 450);
    await page.goto(BASE + "/unit"); await page.getByText("Autorizzazione genitore mancante").first().waitFor(); await sleep(800); s.mark("ready");
    await sleep(1200);
    await glide(page, page.getByText("Autorizzazione genitore mancante").first(), 30); await sleep(1500);
    await click(s, page.getByText("Viaggio al Tempio").first()); await sleep(2500); s.mark("detail");
    const m = page.getByText(/Matteo/).first(); if (await m.count()) { await m.scrollIntoViewIfNeeded(); await glide(page, m, 30); }
    await sleep(3000); s.mark("end"); await s.done();
  },
  async register() {
    const s = await session("partecipante", true); const { page } = s;
    await page.goto(BASE + "/activities/campeggio-estivo"); await page.getByRole("link", { name: "Iscriviti", exact: true }).or(page.getByRole("button", { name: "Iscriviti", exact: true })).first().waitFor(); await closeInstallHint(page); await page.evaluate(() => window.scrollTo(0, 0)); await sleep(600); s.mark("ready");
    await sleep(1200);
    await smoothScrollTo(page, page.getByRole("link", { name: "Iscriviti", exact: true }).or(page.getByRole("button", { name: "Iscriviti", exact: true })).first(), 420); await sleep(500);
    await click(s, page.getByRole("link", { name: "Iscriviti", exact: true }).or(page.getByRole("button", { name: "Iscriviti", exact: true })).first()); await sleep(1200); await closeInstallHint(page);
    const tel = page.getByLabel("Telefono").first(); await tel.click(); await type(tel, "333 123 4567", true); await sleep(400);
    await click(s, page.getByRole("button", { name: "Continua" })); await sleep(1000); s.mark("step2");
    const pn = page.getByRole("textbox", { name: "Nome genitore", exact: true }); await pn.click(); await type(pn, "Marco", true);
    const pc = page.getByRole("textbox", { name: "Cognome genitore", exact: true }); await pc.click(); await type(pc, "Bianchi", true);
    const pt = page.getByRole("textbox", { name: "Telefono genitore", exact: true }); await pt.click(); await type(pt, "333 765 4321");
    const en = page.getByRole("textbox", { name: "Nome e cognome", exact: true }); await en.click(); await type(en, "Anna Bianchi");
    const et = page.getByRole("textbox", { name: "Telefono", exact: true }); await et.click(); await type(et, "333 222 1100");
    await page.getByRole("button", { name: "Conferma iscrizione" }).scrollIntoViewIfNeeded(); await sleep(600); s.mark("beforeConfirm");
    await click(s, page.getByRole("button", { name: "Conferma iscrizione" })); await sleep(3500); s.mark("confirmed");
    await sleep(1500); s.mark("end"); await s.done();
  },
  async parent() {
    const s = await session(null, true); const { page } = s;
    await page.goto(BASE + "/parent-confirm/" + TOKEN); await page.getByRole("button", { name: "Continua" }).waitFor(); await closeInstallHint(page); await page.evaluate(() => window.scrollTo(0, 0)); await sleep(600); s.mark("ready");
    await sleep(1500);
    for (const l of await page.locator('label:has(input[type="checkbox"])').all()) { await l.scrollIntoViewIfNeeded(); await l.click(); await sleep(260); }
    await click(s, page.getByRole("button", { name: "Continua" })); await sleep(900); s.mark("photos");
    for (const l of await page.locator('label:has(input[type="radio"][value="accepted"])').all()) { await l.scrollIntoViewIfNeeded(); await l.click(); await sleep(500); }
    await click(s, page.getByRole("button", { name: "Continua" })); await sleep(900); s.mark("sign");
    const c = page.locator("canvas").first(); await c.scrollIntoViewIfNeeded(); const b = await c.boundingBox();
    // cursive-like signature: a tall first loop, smaller connected loops, then a flourish
    const stroke = async pts => { await page.mouse.move(...pts[0]); await page.mouse.down(); for (const p of pts) { await page.mouse.move(p[0], p[1]); await sleep(12); } await page.mouse.up(); await sleep(150); };
    const base = b.y + b.height * 0.66, x0 = b.x + 40;
    // letters as upward loops (cursive "l"/"e"); h = height, r = loop width
    const letters = (x, spec) => { const pts = []; for (const [w, h, r] of spec) { for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push([x + t * w + r * Math.sin(2 * Math.PI * t), base - h * (1 - Math.cos(2 * Math.PI * t)) / 2]); } x += w; } return pts; };
    const lead = [[x0 - 6, base + 6], [x0, base]];
    await stroke(lead.concat(letters(x0, [[22, 78, 7], [16, 26, 4], [16, 24, 3], [20, 30, 2]])));
    const cc = []; for (let i = 0; i <= 14; i++) { const a2 = Math.PI * 0.25 + i / 14 * Math.PI * 1.35; cc.push([x0 + 120 + 20 * Math.cos(a2), base - 30 - 30 * Math.sin(a2)]); }
    await stroke(cc.concat(letters(x0 + 116, [[16, 22, 3], [18, 24, 1], [16, 22, 1], [18, 62, 6], [14, 22, 2]]), [[x0 + 210, base - 8], [x0 + 232, base - 18]]));
    await stroke([[x0 + 164, base - 44], [x0 + 186, base - 48], [x0 + 196, base - 47]]);
    const ul = []; for (let i = 0; i <= 20; i++) { const t = i / 20; ul.push([x0 + 4 + t * 230, base + 18 - 5 * Math.sin(t * Math.PI) + 3 * t]); }
    await stroke(ul);
    await sleep(800);
    if (process.env.DRY) { await page.locator("canvas").first().screenshot({ path: "shots/sig.png" }); s.mark("end"); return s.done(); }
    await click(s, page.getByRole("button", { name: "Confermo l'autorizzazione" })); await sleep(4000); s.mark("confirmed");
    await sleep(1500); s.mark("end"); await s.done();
  },
  async rooms() {
    const s = await session("admin", false); const { page } = s;
    await page.mouse.move(800, 300);
    await page.goto(BASE + "/admin/events/viaggio-tempio/rooms"); await page.getByText("Organizza le stanze").waitFor(); await sleep(800); s.mark("ready");
    await sleep(800);
    await smoothScrollTo(page, page.getByText("Organizza le stanze"), 30); await sleep(600);
    await glide(page, page.getByText("Stanza Glicine").first(), 35); await sleep(1500);
    await glide(page, page.getByText("Sofia Bianchi").first(), 20); await sleep(2500);
    s.mark("end"); await s.done();
  },
  async myroom() {
    const s = await session("partecipante", true); const { page } = s;
    await page.goto(BASE + "/me/activities/viaggio-tempio"); await page.getByText("La tua stanza").waitFor(); await closeInstallHint(page); await page.evaluate(() => window.scrollTo(0, 0)); await sleep(800); s.mark("ready");
    await sleep(1000);
    await smoothScrollTo(page, page.getByText("La tua stanza"), 260); await sleep(3500);
    s.mark("end"); await s.done();
  },
  async gallery() {
    const s = await session("partecipante", true); const { page } = s;
    await page.goto(BASE + "/activities/campeggio-autunno/foto"); await page.locator("img").nth(3).waitFor(); await sleep(1500); s.mark("ready");
    await sleep(1500);
    const imgs = page.locator("main img, img");
    await imgs.nth(5).click(); await sleep(2500); s.mark("open");
    await page.mouse.move(300, 420); await sleep(200);
    await sleep(1500); s.mark("end"); await s.done();
  },
  async consents() {
    const s = await session("admin", false); const { page } = s;
    await page.mouse.move(900, 300);
    await page.goto(BASE + "/admin/events/campeggio-autunno/consents"); await page.getByText(/moduli firmati disponibili/).waitFor(); await sleep(600);
    const y = await page.getByText("Elenco consensi").evaluate(el => el.getBoundingClientRect().top + scrollY - 200);
    await page.evaluate(y => window.scrollTo(0, y), y); await sleep(800); s.mark("ready");
    await sleep(800);
    await glide(page, page.getByText(/moduli firmati disponibili/).first(), 30); await sleep(700);
    { const bb = await page.getByRole("button", { name: /Scarica ZIP/ }).first().boundingBox(); await page.mouse.move(bb.x + 22, bb.y + bb.height * 0.8, { steps: 25 }); } await sleep(2500);
    s.mark("end"); await s.done();
  },
  async quick() {
    const s = await session("admin", false); const { page } = s;
    await page.mouse.move(900, 500);
    await page.goto(BASE + "/admin/events"); await page.getByRole("button", { name: /Nuova attività/ }).first().waitFor(); await sleep(800); s.mark("ready");
    await sleep(600);
    await click(s, page.getByRole("button", { name: /Nuova attività/ }).first()); await sleep(800);
    const name = page.getByPlaceholder("Es. Serata giochi"); await click(s, name); await type(name, "Serata film");
    const day = page.getByLabel("Giorno"); await click(s, day); await day.fill("2026-12-04"); await sleep(500);
    await click(s, page.getByRole("button", { name: "Salva nel calendario" })); await sleep(1800); s.mark("saved");
    const fatto = page.getByRole("button", { name: /^Fatto/ }); if (await fatto.count()) { await click(s, fatto.first()); await sleep(1500); }
    s.mark("end"); await s.done();
  },
};
await scenes[scene]();
