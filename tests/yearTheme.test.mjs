import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Guardie sul tema dell'anno (`src/styles/yearTheme.css`). L'idea di prodotto:
// ogni anno cambia il tema dei giovani e si cambia SOLO quel file. Questi test
// non fissano nessun colore del 2026: controllano che il tema sia completo,
// coerente e che nessun altro file riporti la palette a mano.
//
// Comando: node --test tests/yearTheme.test.mjs

const ROOT = new URL("../", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const THEME_FILE = "src/styles/yearTheme.css";

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const rel = (path) => relative(ROOT, path);
const read = (path) => readFileSync(path, "utf8");
const sourceFiles = walk(SRC).filter((path) => /\.(css|ts|tsx)$/u.test(path));
const cssFiles = sourceFiles.filter((path) => path.endsWith(".css"));
const stylesCss = cssFiles.filter((path) => rel(path).startsWith("src/styles/"));

// Toglie i commenti /* … */ lasciando i ritorni a capo, così i numeri di riga restano veri.
const blankComments = (text) => text.replace(/\/\*[\s\S]*?\*\//gu, (comment) => comment.replace(/[^\n]/gu, " "));

// Ogni occorrenza di `pattern` con file e riga.
function occurrences(files, pattern, { stripComments = false } = {}) {
  const found = [];
  for (const file of files) {
    const text = stripComments ? blankComments(read(file)) : read(file);
    text.split("\n").forEach((line, index) => {
      for (const match of line.matchAll(pattern)) found.push({ where: `${rel(file)}:${index + 1}`, match: match[0], groups: match, line });
    });
  }
  return found;
}

// ---------------------------------------------------------------------------
// Il tema: variabili definite in yearTheme.css
// ---------------------------------------------------------------------------

const themeText = blankComments(read(join(ROOT, THEME_FILE)));
const theme = {};
for (const match of themeText.matchAll(/(--theme-[\w-]+)\s*:\s*([^;]+);/gu)) theme[match[1]] = match[2].trim();

// Risolve una variabile del tema seguendo eventuali var(--theme-…) annidati.
function resolveTheme(name, seen = []) {
  assert.ok(name in theme, `${THEME_FILE}: ${name} non è definita`);
  assert.ok(!seen.includes(name), `${THEME_FILE}: riferimento circolare su ${name}`);
  return theme[name].replace(/var\(\s*(--[\w-]+)\s*\)/gu, (_, inner) => resolveTheme(inner, [...seen, name]));
}

const hexToRgb = (hex) => {
  const clean = hex.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/u.exec(clean);
  if (short) return short.slice(1).map((digit) => Number.parseInt(digit + digit, 16));
  const long = /^#([0-9a-f]{6})$/u.exec(clean);
  assert.ok(long, `non è un esadecimale: «${hex}»`);
  return [0, 2, 4].map((offset) => Number.parseInt(long[1].slice(offset, offset + 2), 16));
};

const channel = (value) => {
  const unit = value / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
};
const luminance = ([red, green, blue]) => 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
const ratio = (left, right) => {
  const [high, low] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
};

// ---------------------------------------------------------------------------
// 1. Tutto quello che si usa è definito
// ---------------------------------------------------------------------------

test("yearTheme.css definisce tutte le --theme-* usate con var() in src/", () => {
  assert.ok(Object.keys(theme).length > 15, `variabili lette da ${THEME_FILE}: ${Object.keys(theme).length}`);
  const used = occurrences(sourceFiles, /var\(\s*(--theme-[\w-]+)/gu, { stripComments: true });
  assert.ok(used.length > 50, `var(--theme-…) trovate in src/: ${used.length}`);
  // Definita da yearTheme.css, oppure dichiarata altrove ma ammessa (misure e alias, vedi sotto).
  const declaredElsewhere = new Set(
    occurrences(cssFiles.filter((path) => rel(path) !== THEME_FILE), /(--theme-[\w-]+)\s*:/gu, { stripComments: true }).map(
      ({ groups }) => groups[1],
    ),
  );
  const missing = used
    .filter(({ groups }) => !(groups[1] in theme) && !declaredElsewhere.has(groups[1]))
    .map(({ where, groups }) => `${where}: ${groups[1]} non è definita in ${THEME_FILE}`);
  assert.deepEqual(missing, []);
});

// ---------------------------------------------------------------------------
// 2. Un solo posto per colori e font
// ---------------------------------------------------------------------------

// Criterio: fuori da yearTheme.css si possono dichiarare solo le --theme-* che
// non sono né colori né font, cioè le misure del logo (--theme-logo-max*) e
// l'alias --theme-mark-bg, che deve restare un var() verso un'altra --theme-*
// (mai un colore scritto a mano). Tutto il resto (primary, accent, ink, muted,
// line, surface, arch, tint, rgb, font…) vive solo nel tema.
const ALLOWED_OUTSIDE_THEME = [/^--theme-logo-max(?:-[\w-]+)?$/u];
const ALIAS_OUTSIDE_THEME = ["--theme-mark-bg"];

test("le --theme-* di colore e il font sono definite solo in yearTheme.css", () => {
  const declared = occurrences(cssFiles.filter((path) => rel(path) !== THEME_FILE), /(--theme-[\w-]+)\s*:\s*([^;}]*)/gu, {
    stripComments: true,
  });
  const offenders = [];
  for (const { where, groups } of declared) {
    const [, name, value] = groups;
    if (ALLOWED_OUTSIDE_THEME.some((pattern) => pattern.test(name))) {
      if (/#[0-9a-f]{3,8}\b|rgba?\(/iu.test(value)) offenders.push(`${where}: ${name} è una misura ma contiene un colore («${value.trim()}»)`);
    } else if (ALIAS_OUTSIDE_THEME.includes(name)) {
      if (!/^var\(\s*--theme-[\w-]+\s*\)$/u.test(value.trim())) {
        offenders.push(`${where}: ${name} deve essere un alias var(--theme-…), non «${value.trim()}»`);
      }
    } else {
      offenders.push(`${where}: ${name} è ridefinita fuori da ${THEME_FILE}`);
    }
  }
  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------------------
// 3. Le terne rgb corrispondono agli esadecimali
// ---------------------------------------------------------------------------

for (const base of ["primary", "accent", "ink"]) {
  test(`--theme-${base}-rgb è la terna di --theme-${base}`, () => {
    const hex = hexToRgb(resolveTheme(`--theme-${base}`));
    const triple = (theme[`--theme-${base}-rgb`] ?? "").split(",").map((part) => Number(part.trim()));
    assert.equal(triple.length, 3, `${THEME_FILE}: --theme-${base}-rgb non è una terna (${theme[`--theme-${base}-rgb`]})`);
    assert.deepEqual(triple, hex, `${THEME_FILE}: --theme-${base}-rgb = ${triple.join(", ")} ma --theme-${base} = ${hex.join(", ")}`);
  });
}

// ---------------------------------------------------------------------------
// 4. La vecchia palette non torna
// ---------------------------------------------------------------------------

// Eccezioni, con il motivo:
//  - recordNight.css, recordNightAdmin.css, recordCertificate.css: la Notte dei
//    Record ha una pelle sua, indipendente dal tema dei giovani;
//  - la riga @import dei Google Fonts in cima a base.css (carica ancora i font
//    del tema; il nome Fraunces/Manrope compare solo nell'URL);
//  - i commenti (documentano da dove si viene).
const OLD_PALETTE_EXEMPT_FILES = ["recordNight.css", "recordNightAdmin.css", "recordCertificate.css"];
const OLD_PALETTE = [
  ["#235d90", /#235d90\b/giu],
  ["#1b3f67", /#1b3f67\b/giu],
  ["#e8a857", /#e8a857\b/giu],
  ["#101c30", /#101c30\b/giu],
  ["#233247", /#233247\b/giu],
  ["rgba(35, 93, 144, …)", /rgba?\(\s*35\s*,\s*93\s*,\s*144\b/giu],
  ["rgba(27, 63, 103, …)", /rgba?\(\s*27\s*,\s*63\s*,\s*103\b/giu],
  // Stesso #101c30 scritto come terna: l'ombra --shadow-float lo usava.
  ["rgba(16, 28, 48, …) (= #101c30)", /rgba?\(\s*16\s*,\s*28\s*,\s*48\b/giu],
  ["Fraunces", /fraunces/giu],
  ["Manrope", /manrope/giu],
];

test("nei CSS di src/styles non restano la vecchia palette e i vecchi font scritti a mano", () => {
  const files = stylesCss.filter((path) => !OLD_PALETTE_EXEMPT_FILES.some((name) => path.endsWith(`/${name}`)));
  assert.ok(files.length > 20, `file CSS controllati: ${files.length}`);
  const offenders = [];
  for (const file of files) {
    const text = blankComments(read(file));
    text.split("\n").forEach((line, index) => {
      if (rel(file) === "src/styles/base.css" && /^\s*@import\b/u.test(line)) return;
      for (const [label, pattern] of OLD_PALETTE) {
        if (pattern.test(line)) offenders.push(`${rel(file)}:${index + 1}: ${label} → ${line.trim().slice(0, 100)}`);
        pattern.lastIndex = 0;
      }
    });
  }
  assert.deepEqual(offenders, []);
});

test("la riga @import di base.css è l'unica eccezione ai font vecchi: esiste ancora e sta in cima", () => {
  const lines = read(join(ROOT, "src/styles/base.css")).split("\n");
  const index = lines.findIndex((line) => /^\s*@import\b/u.test(line));
  assert.ok(index >= 0 && index < 5, "src/styles/base.css: nessun @import nelle prime righe (l'eccezione non serve più: toglila dal test)");
});

test("fuori da yearTheme.css nessun colore del tema è copiato a mano (esadecimali uguali a quelli del tema)", () => {
  // Una copia a mano di --theme-muted, --theme-line… smette di seguire il tema
  // l'anno dopo. Bianco e nero puri sono generici e ammessi. Notte dei Record
  // esclusa come sopra.
  const themeHex = new Map();
  for (const name of Object.keys(theme)) {
    if (!/^--theme-(?!.*rgb)/u.test(name) || /font|logo/u.test(name)) continue;
    const value = resolveTheme(name).trim().toLowerCase();
    if (!/^#[0-9a-f]{3,6}$/u.test(value)) continue;
    const rgb = hexToRgb(value).map((part) => part.toString(16).padStart(2, "0")).join("");
    if (rgb === "ffffff" || rgb === "000000") continue;
    themeHex.set(rgb, name);
  }
  const files = stylesCss.filter((path) => rel(path) !== THEME_FILE && !OLD_PALETTE_EXEMPT_FILES.some((name) => path.endsWith(`/${name}`)));
  const offenders = occurrences(files, /#([0-9a-f]{6}|[0-9a-f]{3})\b/giu, { stripComments: true })
    .map(({ where, groups }) => {
      const digits = groups[1].toLowerCase();
      const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits;
      return themeHex.has(full) ? `${where}: #${digits} è ${themeHex.get(full)}, usa var(${themeHex.get(full)})` : null;
    })
    .filter(Boolean);
  assert.deepEqual(offenders, []);
});

// Il testo sull'ambra è sempre --on-sand / --theme-on-accent: il blu del tema
// (--ink, --theme-primary) sull'ambra sta a 4,495:1, appena sotto AA.
test("testo su sfondo ambra: dove lo sfondo è --action-sand o --theme-accent, il color è --on-sand, --theme-on-accent o ereditato", () => {
  const AMBER_BG = /var\(\s*(?:--action-sand|--theme-accent)\s*[,)]/u;
  const ALLOWED_COLOR = /^(?:var\(\s*--on-sand\s*\)|var\(\s*--theme-on-accent\s*\)|inherit)$/u;
  let checked = 0;
  const offenders = [];
  for (const file of stylesCss) {
    const text = blankComments(read(file));
    for (const block of text.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
      const decls = block[2].split(";").map((part) => {
        const at = part.indexOf(":");
        return at < 0 ? null : [part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim()];
      }).filter(Boolean);
      const bg = decls.find(([prop, val]) => (prop === "background" || prop === "background-color") && AMBER_BG.test(val));
      if (!bg) continue;
      checked += 1;
      const color = decls.find(([prop]) => prop === "color");
      if (color && !ALLOWED_COLOR.test(color[1])) {
        const line = text.slice(0, block.index).split("\n").length + block[1].replace(/^\s*\n/u, "").split("\n").length - 1;
        offenders.push(`${rel(file)}:${line}: ${block[1].trim().split("\n").at(-1)} ha ${bg[0]}: ${bg[1]} con color: ${color[1]}`);
      }
    }
  }
  assert.ok(checked >= 5, `regole con sfondo ambra trovate: ${checked}`);
  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------------------
// 5. Contrasto AA sulle coppie del tema (valori risolti)
// ---------------------------------------------------------------------------

const WHITE = "#ffffff";
const AA_TEXT = 4.5;
const value = (token) => (token === WHITE ? hexToRgb(WHITE) : hexToRgb(resolveTheme(token)));

const PAIRS = [
  [WHITE, "--theme-primary", "testo bianco sui pulsanti e sulle fasce primarie"],
  [WHITE, "--theme-primary-strong", "testo bianco su hover e fondi scuri"],
  ["--theme-on-accent", "--theme-accent", "testo sul pulsante accento"],
  ["--theme-on-accent-tint", "--theme-accent-tint", "testo su fondo chiaro dell'accento"],
  ["--theme-primary", "--theme-primary-tint", "link e pill sul fondo tenue"],
  ["--theme-primary", "--theme-arch", "testo primario sull'arco"],
  ["--theme-ink", "--theme-surface", "testo corrente"],
  ["--theme-ink", "--theme-surface-soft", "testo corrente su fondo morbido"],
  ["--theme-muted", "--theme-surface", "testo secondario"],
  ["--theme-muted", "--theme-surface-soft", "testo secondario su fondo morbido"],
  ["--theme-muted", "--theme-arch", "testo secondario sull'arco"],
  ["--theme-muted", "--theme-primary-tint", "testo secondario sul fondo tenue"],
];

for (const [foreground, background, what] of PAIRS) {
  test(`contrasto AA: ${foreground === WHITE ? "bianco" : foreground} su ${background} (${what})`, () => {
    const measured = ratio(value(foreground), value(background));
    assert.ok(
      measured >= AA_TEXT,
      `${THEME_FILE}: ${foreground} (${foreground === WHITE ? WHITE : resolveTheme(foreground)}) su ${background} (${resolveTheme(background)}): ${measured.toFixed(2)}:1, sotto ${AA_TEXT}:1`,
    );
  });
}

// ---------------------------------------------------------------------------
// 6. Guardie su due punti dove il tema incontra altro CSS
// ---------------------------------------------------------------------------

// Dichiarazioni (con riga) di tutte le regole che hanno ESATTAMENTE questo selettore,
// anche in @media; nessun blocco annidato oltre il primo livello.
function declarationsFor(file, selector) {
  const text = blankComments(read(join(ROOT, file)));
  const found = [];
  for (const block of text.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const selectors = block[1].split(",").map((part) => part.trim().replace(/\s+/gu, " "));
    if (!selectors.includes(selector)) continue;
    const startLine = text.slice(0, block.index).split("\n").length + (block[1].match(/^\s*/u)[0].match(/\n/gu) ?? []).length;
    for (const part of block[2].split(/;(?![^(]*\))/u)) {
      const at = part.indexOf(":");
      if (at > 0) found.push({ prop: part.slice(0, at).trim().toLowerCase(), value: part.slice(at + 1).trim(), line: startLine });
    }
  }
  return found;
}

// Spezza a livello 0 di parentesi.
function splitCommas(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += char;
  }
  parts.push(current.trim());
  return parts;
}

// Contenuto di `name(...)` dentro `value`, con parentesi bilanciate; null se manca.
function functionArgs(value, name) {
  const start = value.indexOf(`${name}(`);
  if (start < 0) return null;
  let depth = 0;
  for (let index = start + name.length; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    if (value[index] === ")" && --depth === 0) return value.slice(start + name.length + 1, index);
  }
  return null;
}

// Colore di uno stop: var(--theme-…), var(--altra) che arriva al tema, oppure esadecimale.
function stopColor(stop, where) {
  const token = /^(var\(\s*(--[\w-]+)\s*\)|#[0-9a-f]{3,6})/iu.exec(stop);
  assert.ok(token, `${where}: non riesco a leggere il colore dello stop «${stop}»`);
  return token[2] ? hexToRgb(resolveTheme(token[2])) : hexToRgb(token[1]);
}

test("registerFlow.css .inviata-next: il badge bianco 13 px arriva a 4,5:1 su entrambi i capi del gradiente", () => {
  const FILE = "src/styles/registerFlow.css";
  const box = declarationsFor(FILE, ".inviata-next").filter(({ prop }) => prop === "background");
  assert.ok(box.length > 0, `${FILE}: la regola .inviata-next con background non si trova più: il test non sa dove guardare`);
  const where = `${FILE}:${box.at(-1).line}`;
  const gradient = functionArgs(box.at(-1).value, "linear-gradient");
  assert.ok(gradient, `${where}: .inviata-next non ha più un linear-gradient leggibile («${box.at(-1).value}»)`);
  const stops = splitCommas(gradient).filter((part) => !/^(?:to\s|-?[\d.]+(?:deg|turn|rad|grad)\b)/u.test(part));
  assert.ok(stops.length >= 2, `${where}: servono almeno due capi nel linear-gradient, trovati ${stops.length}`);

  const tag = declarationsFor(FILE, ".inviata-next__tag");
  const tagBg = tag.filter(({ prop }) => prop === "background" || prop === "background-color").at(-1);
  assert.ok(tagBg, `${FILE}: .inviata-next__tag non ha più un background`);
  const alpha = /^rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([\d.]+)\s*\)$/u.exec(tagBg.value);
  assert.ok(alpha, `${FILE}:${tagBg.line}: il background del badge non è più rgba(255, 255, 255, alfa): «${tagBg.value}»`);
  const tagColor = tag.filter(({ prop }) => prop === "color").at(-1)?.value ?? "(eredita)";
  assert.ok(["#fff", "#ffffff", "white", "(eredita)"].includes(tagColor.toLowerCase()), `${FILE}: il testo del badge non è bianco: ${tagColor}`);
  const inherited = declarationsFor(FILE, ".inviata-next").find(({ prop }) => prop === "color")?.value;
  if (tagColor === "(eredita)") assert.ok(["#fff", "#ffffff", "white"].includes(inherited?.toLowerCase()), `${FILE}: il testo del badge eredita ${inherited}, non bianco`);

  const opacity = Number(alpha[1]);
  const failures = [];
  const report = [];
  for (const stop of stops) {
    const base = stopColor(stop, where);
    const composed = base.map((part) => Math.round(255 * opacity + part * (1 - opacity)));
    const measured = ratio([255, 255, 255], composed);
    report.push(`${stop} → ${measured.toFixed(2)}:1`);
    if (measured < AA_TEXT) failures.push(`${where}: bianco su ${stop} con badge a ${opacity} = rgb(${composed}): ${measured.toFixed(2)}:1, sotto ${AA_TEXT}:1`);
  }
  assert.deepEqual(failures, []);
  console.log(`# inviata-next capi: ${report.join("; ")}`);
});

test("base.css: la striscia del tema .topbar::before è spenta nella pelle Notte dei Record", () => {
  const FILE = "src/styles/base.css";
  const strip = declarationsFor(FILE, ".topbar::before");
  const usesTheme = strip.some(({ prop, value }) => prop.startsWith("background") && /var\(\s*--theme-/u.test(value));
  if (!usesTheme) return; // niente striscia del tema: niente da spegnere
  const off = declarationsFor(FILE, "html.rn-skin .topbar::before");
  const switchedOff = off.some(({ prop, value }) => (prop === "content" && value === "none") || (prop === "display" && value === "none"));
  assert.ok(
    switchedOff,
    `${FILE}:${strip[0].line}: .topbar::before usa var(--theme-…) ma manca «html.rn-skin .topbar::before» con content: none o display: none: la Notte dei Record eredita la striscia`,
  );
});
