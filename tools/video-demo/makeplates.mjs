import { render, G, T, H } from "./plates.mjs"; // run with cwd = work dir; plates/ is written there
import fs from "node:fs";
fs.mkdirSync("plates", { recursive: true });
const TX = {
  it: {
    hook: "Sai chi è iscritto al prossimo campeggio?",
    regs: ["Chi è iscritto, nome per nome", "In alto i totali; ogni riga dice unità e stato della persona."],
    stats: ["Da quale unità arrivano", "Le iscrizioni del palo, per unità e per organizzazione."],
    surveys: ["Dopo, si chiede com'è andata", "Sondaggi anonimi: si vede la categoria, non il nome."],
    reg: ["Si iscrivono dal telefono", "Il modulo lo decide il palo: chiede solo quello che serve."],
    unit: ["Il dirigente vede la sua unità", "Quanti iscritti, chi ha bisogno di un passaggio, cosa manca."],
    par: ["Le autorizzazioni arrivano firmate", "Se serve, il genitore riceve un link e firma dal telefono."],
    pdf: ["Ogni firma, in PDF", "Ogni modulo firmato resta in PDF."],
    leader: ["Il dirigente sa chi manca", "Il dirigente di unità vede chi non ha ancora l'autorizzazione."],
    rooms: ["Ognuno vede la sua stanza", "Le stanze si preparano nell'app, e ogni ragazzo vede solo la sua."],
    gallery: ["Le foto restano nel palo", "Dopo l'attività le foto sono nell'app, visibili solo ai membri del palo."],
    quick: ["Un'attività nuova? Nome e giorno.", null],
    numTitle: "Palo di Roma Est, da marzo 2026", n1: ["326", "iscrizioni"], n2: ["116", "autorizzazioni firmate dal telefono"],
    cta: ["Se serve anche al vostro palo, scrivete a Paolo Celestini.", "gugditalia.it"],
    faqLabel: "Domande frequenti",
    faq: [
      ["Chi si può iscrivere?", "Ragazzi, dirigenti e accompagnatori. I genitori iscrivono i figli dal loro account."],
      ["Serve un account?", "Lo decide il palo per ogni attività: possono bastare nome ed email."],
      ["Bisogna installare qualcosa?", "No: si apre dal browser del telefono."],
      ["Chi vede i dati?", "Iscritti: admin e dirigente di unità. Sondaggi: senza nomi. Note sanitarie: admin. Foto: membri del palo."],
      ["È un'app ufficiale della Chiesa?", "No: è uno strumento locale, nato in un palo."],
    ],
  },
  en: {
    hook: "Do you know who's signed up for the next camp?",
    regs: ["Every youth, by name", "Totals at the top; each row shows the person's unit and status."],
    stats: ["Which unit they come from", "Stake sign-ups, by unit and by organization."],
    surveys: ["Afterward, you ask how it went", "Anonymous surveys: you see the group, not the name."],
    reg: ["They sign up on their phones", "The stake decides what the form asks: only what's needed."],
    unit: ["Leaders see their own unit", "How many signed up, who needs a ride, what's missing."],
    par: ["Permission slips come back signed", "When needed, the parent gets a link and signs on the phone."],
    pdf: ["Every signature, as a PDF", "Every signed form is saved as a PDF."],
    leader: ["Leaders know who's missing", "Unit leaders see who still needs a permission slip."],
    rooms: ["Everyone sees their own room", "Leaders assign rooms in the app. Each youth sees only their own."],
    gallery: ["Photos stay in the stake", "After the activity, photos stay in the app, visible only to stake members."],
    quick: ["New activity? A name and a date.", null],
    numTitle: "Rome Italy East Stake, since March 2026", n1: ["326", "sign-ups"], n2: ["116", "permission slips signed by phone"],
    cta: ["Could your stake use it too? Write to Paolo Celestini.", "gugditalia.it"],
    faqLabel: "Frequently asked questions",
    faq: [
      ["Who can sign up?", "Youth, leaders and adult helpers. Parents register their children from their own account."],
      ["Is an account required?", "The stake decides for each activity: a name and email can be enough."],
      ["Anything to install?", "No: it opens in the phone's browser."],
      ["Who sees the data?", "Sign-ups: admins and the unit leader. Surveys: no names. Medical notes: admins. Photos: stake members."],
      ["Is it an official Church app?", "No: it's a local tool, born in one stake."],
    ],
  },
};
const M = G.main, V = G.vert, jobs = [];
const job = (out, w, h, html) => jobs.push({ out: `plates/${out}.png`, w, h, html });
// shared backgrounds
job("bg-main", M.w, M.h, H.bgHTML({ w: M.w, h: M.h, sun: { x: 1380, y: -120, r: 330 } }));
job("bg-vert", V.w, V.h, H.bgHTML({ w: V.w, h: V.h, sun: { x: 640, y: -160, r: 330 } }));
job("frame-phone", M.w, M.h, H.phoneFrame(M.w, M.h, M.phone));
job("frame-desk", M.w, M.h, H.deskFrame(M.w, M.h, M.desk, "gugditalia.it"));
job("frame-vphone", V.w, V.h, H.phoneFrame(V.w, V.h, V.phone, 1.5));
job("mask-phone", M.phone.w, M.phone.h, H.phoneMask(M.phone));
job("mask-vphone", V.phone.w, V.phone.h, H.phoneMask(V.phone, 1.5));
for (const [L, t] of Object.entries(TX)) {
  const col = (title, line) => H.textCol({ x: 130, y: 540, w: 540, title, line }) + H.brand(130, 960);
  for (const k of ["regs", "stats", "surveys", "reg", "par", "unit", "rooms", "gallery"]) job(`${L}-text-${k}`, M.w, M.h, col(...t[k]));
  // full cards
  const card = (inner, bg = T.primary) => `<div class="abs" style="inset:0;background:${bg}"></div>
    <div class="abs" style="right:-160px;top:-200px;width:620px;height:620px;border-radius:50%;background:#ffffff;opacity:.07"></div>${inner}`;
  job(`${L}-hook`, M.w, M.h, card(H.textCol({ x: 260, y: 520, w: 1400, title: t.hook, size: 84, align: "center", color: "#ffffff" }) + H.brand(130, 960, 46, "#ffffff")));
  job(`${L}-cta`, M.w, M.h, card(H.textCol({ x: 260, y: 470, w: 1400, title: t.cta[0], size: 76, align: "center", color: "#ffffff", line: null }) +
    `<div class="abs" style="left:0;right:0;top:720px;text-align:center;font-size:44px;font-weight:700;color:${T.accent}">${t.cta[1]}</div>` + H.brand(130, 960, 46, "#ffffff")));
  const big = (n, x) => `<div class="abs" style="left:${x}px;top:430px;width:640px;text-align:center"><div style="font-size:200px;line-height:1;font-weight:900;color:${T.primary};letter-spacing:-4px">${n[0]}</div><div style="font-size:36px;margin-top:18px;color:${T.ink};font-weight:500">${H.esc(n[1])}</div></div>`;
  job(`${L}-numbers`, M.w, M.h, H.bgHTML({ w: M.w, h: M.h, sun: { x: 1380, y: -120, r: 330 } }) +
    `<div class="abs" style="left:0;right:0;top:250px;text-align:center"><div style="width:72px;height:9px;border-radius:5px;background:${T.accent};margin:0 auto 30px"></div><div style="font-size:52px;font-weight:700;color:${T.ink}">${H.esc(t.numTitle)}</div></div>` +
    big(t.n1, 300) + big(t.n2, 980) + H.brand(130, 960));
  // FAQ: one summary card, a row per question
  job(`${L}-faq`, M.w, M.h, H.bgHTML({ w: M.w, h: M.h, sun: { x: 1640, y: -330, r: 280 } }) +
    `<div class="abs" style="left:200px;top:540px;width:1520px;transform:translateY(-50%)">
      <div style="display:flex;align-items:center;gap:18px;font-size:30px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${T.primary};margin-bottom:34px">
        <span style="width:72px;height:9px;border-radius:5px;background:${T.accent}"></span>${H.esc(t.faqLabel)}</div>
      ${t.faq.map(([q, ans], i) => `<div style="display:flex;gap:48px;align-items:baseline;padding:26px 0;border-top:${i ? `2px solid rgba(29,42,51,.10)` : "none"}">
        <div style="flex:0 0 560px;font-size:40px;line-height:1.2;font-weight:700;color:${T.ink}">${H.esc(q)}</div>
        <div style="flex:1;font-size:36px;line-height:1.35;color:${T.muted}">${H.esc(ans)}</div></div>`).join("")}</div>` + H.brand(130, 960));
  // vertical teaser
  const vcol = title => H.textCol({ x: 90, y: 300, w: 900, title, size: 70, align: "center" });
  for (const k of ["reg", "rooms", "gallery"]) job(`${L}-vtext-${k}`, V.w, V.h, vcol(t[k][0]));
  const vcard = (title, line) => card(H.textCol({ x: 90, y: 860, w: 900, title, size: 84, align: "center", color: "#ffffff" }) +
    (line ? `<div class="abs" style="left:0;right:0;top:1250px;text-align:center;font-size:52px;font-weight:700;color:${T.accent}">${line}</div>` : "") +
    `<div class="abs" style="left:0;right:0;bottom:120px;display:flex;justify-content:center">${H.brand(0, 0, 60, "#ffffff").replace('class="abs brand"', 'class="brand"').replace("left:0px;top:0px;", "")}</div>`);
  job(`${L}-vhook`, V.w, V.h, vcard(t.hook));
  job(`${L}-vcta`, V.w, V.h, vcard(t.cta[0], t.cta[1]));
}
await render(jobs);
console.log("plates", jobs.length);
