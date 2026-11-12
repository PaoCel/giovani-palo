// Renders backgrounds, text overlays and device frames as PNGs (Roboto + theme colors).
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright-core");
import fs from "node:fs";
const EXE = process.env.CHROME_PATH || process.env.HOME + "/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const LOGO = "data:image/png;base64," + fs.readFileSync(new URL("../../public/brand-logo.png", import.meta.url)).toString("base64");
export const T = { primary: "#005581", primaryStrong: "#00405f", accent: "#fcb448", accentTint: "#feecd1", ink: "#1d2a33", muted: "#5f6163", arch: "#e6f5f7", tint: "#ddf1f7" };
// geometry shared with the compositor
export const G = {
  main: { w: 1920, h: 1080,
    phone: { x: 1057, y: 120, w: 406, h: 879 },          // screen rect (390x844 css)
    desk: { x: 716, y: 215, w: 1104, h: 690 } },          // screen rect (1280x800 css)
  vert: { w: 1080, h: 1920, phone: { x: 228, y: 530, w: 624, h: 1350 } },
};
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const head = `<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>*{margin:0;box-sizing:border-box}html,body{background:transparent;font-family:Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.abs{position:absolute}.brand{display:flex;align-items:center;gap:14px;font-weight:700;color:${T.primary}}
.brand img{height:100%;width:auto}</style>`;
const bgHTML = ({ w, h, sun }) => `<div class="abs" style="inset:0;width:${w}px;height:${h}px;background:linear-gradient(160deg,${T.arch} 0%,#ffffff 55%,#fff8ec 100%)"></div>
<div class="abs" style="left:${sun.x}px;top:${sun.y}px;width:${sun.r * 2}px;height:${sun.r * 2}px;border-radius:50%;background:${T.accent};opacity:.22"></div>
<svg class="abs" style="left:0;top:${h - h * 0.22}px" width="${w}" height="${h * 0.22}" viewBox="0 0 100 22" preserveAspectRatio="none"><path d="M0 10 C 20 2, 35 16, 55 9 S 85 4, 100 11 L100 22 L0 22Z" fill="${T.tint}" opacity=".7"/><path d="M0 16 C 25 9, 45 20, 65 14 S 90 11, 100 15 L100 22 L0 22Z" fill="${T.primary}" opacity=".08"/></svg>`;
const hole = (W, H, o, i) => `<svg class="abs" style="left:0;top:0" width="${W}" height="${H}"><defs><filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#1d2a33" flood-opacity=".22"/></filter></defs>
<path filter="url(#sh)" fill-rule="evenodd" fill="${o.fill}" d="${rr(o.x, o.y, o.w, o.h, o.r)} ${rr(i.x, i.y, i.w, i.h, i.r)}"/>${o.extra || ""}</svg>`;
function rr(x, y, w, h, r) { return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`; }
const phoneFrame = (W, H, s, k = 1) => { const b = 14 * k, top = 40 * k; return hole(W, H, { x: s.x - b, y: s.y - top, w: s.w + 2 * b, h: s.h + top + b, r: 58 * k, fill: T.ink,
  extra: `<rect x="${s.x + s.w / 2 - 46 * k}" y="${s.y - top + 12 * k}" width="${92 * k}" height="${18 * k}" rx="${9 * k}" fill="#0b1217"/><circle cx="${s.x + s.w / 2 + 30 * k}" cy="${s.y - top + 21 * k}" r="${4 * k}" fill="#22313b"/>` }, { x: s.x + 3 * k, y: s.y + 3 * k, w: s.w - 6 * k, h: s.h - 6 * k, r: 24 * k }); };
// white rounded rect on black, same size as the phone clip: used as alpha mask
const phoneMask = (s, k = 1) => `<div class="abs" style="inset:0;background:#000"></div><div class="abs" style="left:0;top:0;width:${s.w}px;height:${s.h}px;border-radius:${28 * k}px;background:#fff"></div>`;
const deskFrame = (W, H, s, url) => { const bar = 40, b = 6; const o = { x: s.x - b, y: s.y - bar, w: s.w + 2 * b, h: s.h + bar + b, r: 16, fill: "#ffffff" };
  o.extra = [0, 1, 2].map(i => `<circle cx="${o.x + 24 + i * 22}" cy="${o.y + 20}" r="6.5" fill="${["#ff5f57", "#febc2e", "#28c840"][i]}"/>`).join("") +
    `<rect x="${o.x + o.w / 2 - 170}" y="${o.y + 8}" width="340" height="24" rx="12" fill="#f1f3f4"/><text x="${o.x + o.w / 2}" y="${o.y + 25}" font-family="Roboto" font-size="14" fill="#5f6163" text-anchor="middle">${url}</text>`;
  return hole(W, H, o, { ...s, r: 4 }); };
const textCol = ({ x, y, w, title, line, size = 62, lineSize = 29, align = "left", color = T.ink, sub = T.muted, bar = true }) =>
  `<div class="abs" style="left:${x}px;top:${y}px;width:${w}px;text-align:${align};transform:translateY(-50%)">
   ${bar ? `<div style="width:72px;height:9px;border-radius:5px;background:${T.accent};margin:${align === "center" ? "0 auto 30px" : "0 0 30px"}"></div>` : ""}
   <div style="font-size:${size}px;line-height:1.1;font-weight:700;letter-spacing:-.5px;color:${color}">${esc(title)}</div>
   ${line ? `<div style="font-size:${lineSize}px;line-height:1.35;font-weight:400;color:${sub};margin-top:26px">${esc(line)}</div>` : ""}</div>`;
const brand = (x, y, h = 46, color = T.primary) => `<div class="abs brand" style="left:${x}px;top:${y}px;height:${h}px;font-size:${h * 0.5}px;color:${color}"><img src="${LOGO}" style="${color === "#ffffff" ? "filter:brightness(0) invert(1)" : ""}">GUGD Italia</div>`;

export async function render(jobs) {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage();
  for (const j of jobs) {
    await page.setViewportSize({ width: j.w, height: j.h });
    await page.setContent(`<!doctype html><html><head>${head}</head><body style="width:${j.w}px;height:${j.h}px;position:relative;overflow:hidden">${j.html}</body></html>`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: j.out, omitBackground: true });
  }
  await browser.close();
}
export const H = { bgHTML, phoneFrame, phoneMask, deskFrame, textCol, brand, esc };
