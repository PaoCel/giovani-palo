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
