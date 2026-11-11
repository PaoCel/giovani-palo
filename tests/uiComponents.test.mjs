import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

// Fase 0 del restyling (docs/REDESIGN_BRIEF.md): token in `src/styles/tokens.css`,
// componenti in `src/components/ui/` (Button, ButtonLink, Card, Notice,
// EmptyState, PageHeader, Pill, Icon) con il CSS in `src/styles/ui.css`. Nessuna
// pagina li usa ancora: questo file prova il contratto del brief, non il codice.
//
//  - guardia "nessun cambio alle pagine vecchie": i token nuovi non ridefiniscono
//    quelli di base.css, ogni selettore di ui.css comincia con `.ui-`, niente
//    `nowrap`, puntini, larghezze o altezze fisse (testi più lunghi del 30-40% in
//    inglese e spagnolo, "mai etichette troncate");
//  - target: nessun controllo sotto 44 px, azione principale a 48, testo mai
//    sotto 13 px;
//  - contrasto WCAG AA (4,5:1) di ogni coppia testo/fondo, calcolato dai valori
//    scritti nei CSS (non copiati a mano);
//  - Card ink: pulsanti leggibili e anello di focus a 3:1 su fondo scuro;
//  - markup e accessibilità dei componenti: `busy`, `role` di Notice, stati vuoti
//    senza contenitori vuoti, un solo h1, card cliccabile.
//
// Il CSS si legge con un piccolo parser (niente browser: la prova di
// layout vera resta il collaudo a 320/390/430). I componenti si rendono in testo
// con react-dom/server e si leggono come albero.
//
// Comando: node --test tests/uiComponents.test.mjs

// Alias `@/`, `.tsx` e `.css` (svuotato) per i file di src/.
register("./support/aliasLoader.mjs", import.meta.url);

const { Button, ButtonLink, buttonClassName, Card, EmptyState, Icon, Notice, PageHeader, Pill } = await import(
  "../src/components/ui/index.ts"
);
const { cx } = await import("../src/components/ui/cx.ts");

const readSource = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// Parser CSS minimale: regole, @media (ricorsivo), @keyframes, custom property
// ---------------------------------------------------------------------------

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//gu, "");

// Divide fuori da parentesi e virgolette; i pezzi sono già senza spazi ai bordi.
function splitTopLevel(text, isSeparator) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === "\"" || char === "'") {
      quote = char;
    } else if (char === "(" || char === "[") {
      depth += 1;
    } else if (char === ")" || char === "]") {
      depth -= 1;
    } else if (depth === 0 && isSeparator(char)) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}
const bySemicolon = (char) => char === ";";
const byComma = (char) => char === ",";
const bySlash = (char) => char === "/";
const byWhitespace = (char) => /\s/u.test(char);

function parseDeclarations(body) {
  return splitTopLevel(body, bySemicolon)
    .map((chunk) => {
      const colon = chunk.indexOf(":");
      return colon > 0
        ? {
            prop: chunk.slice(0, colon).trim().toLowerCase(),
            value: chunk.slice(colon + 1).replace(/\s*!important\s*$/u, "").trim(),
          }
        : null;
    })
    .filter(Boolean);
}

// Ritorna { kind: "rule" | "keyframes" | "at", selectors, declarations, context }.
// `context` sono i preludi degli @media/@supports che contengono la regola.
function parseCss(source, context = []) {
  const css = stripComments(source);
  const rules = [];
  let index = 0;
  while (index < css.length) {
    const open = css.indexOf("{", index);
    if (open === -1) break;
    const statementEnd = css.indexOf(";", index);
    if (statementEnd !== -1 && statementEnd < open) {
      index = statementEnd + 1; // @import, @charset
      continue;
    }
    const prelude = css.slice(index, open).trim();
    let depth = 1;
    let end = open + 1;
    while (end < css.length && depth > 0) {
      if (css[end] === "{") depth += 1;
      else if (css[end] === "}") depth -= 1;
      end += 1;
    }
    const body = css.slice(open + 1, end - 1);
    index = end;

    if (prelude.startsWith("@")) {
      const name = /^@([\w-]+)/u.exec(prelude)[1];
      if (name.endsWith("keyframes")) {
        rules.push({ kind: "keyframes", name: prelude.replace(/^@[\w-]+\s*/u, ""), body, context });
      } else if (name === "media" || name === "supports" || name === "layer") {
        rules.push(...parseCss(body, [...context, prelude]));
      } else {
        rules.push({ kind: "at", prelude, declarations: parseDeclarations(body), context });
      }
    } else {
      rules.push({
        kind: "rule",
        selectors: splitTopLevel(prelude, byComma),
        declarations: parseDeclarations(body),
        context,
      });
    }
  }
  return rules;
}

const baseCss = readSource("src/styles/base.css");
const tokensCss = readSource("src/styles/tokens.css");
const uiCss = readSource("src/styles/ui.css");
const mainSource = readSource("src/main.tsx");

const customProperties = (declarations) =>
  Object.fromEntries(declarations.filter(({ prop }) => prop.startsWith("--")).map(({ prop, value }) => [prop, value]));

// `:root` di base.css: blocco senza figli, si legge senza il parser completo
// (il file apre con un @import che ha dei `;` dentro l'URL).
const baseRoot = {};
for (const match of stripComments(baseCss).matchAll(/(?:^|[};])\s*:root\s*\{([^}]*)\}/gu)) {
  Object.assign(baseRoot, customProperties(parseDeclarations(match[1])));
}

// Il tema dell'anno (`yearTheme.css`) è l'unico posto con i colori veri: i token
// di tokens.css e di base.css ci puntano con var(--theme-…).
const yearThemeRoot = {};
for (const match of stripComments(readSource("src/styles/yearTheme.css")).matchAll(/(?:^|[};])\s*:root\s*\{([^}]*)\}/gu)) {
  Object.assign(yearThemeRoot, customProperties(parseDeclarations(match[1])));
}

const tokensRules = parseCss(tokensCss);
const uiRules = parseCss(uiCss);

const tokensRoot = {};
for (const rule of tokensRules) {
  if (rule.kind === "rule" && rule.context.length === 0 && rule.selectors.join() === ":root") {
    Object.assign(tokensRoot, customProperties(rule.declarations));
  }
}

// Quello che vede un componente: token storici di base.css più i nuovi.
const defined = { ...yearThemeRoot, ...baseRoot, ...tokensRoot };

function resolveVars(value, seen = []) {
  return value.replace(/var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)/gu, (_, name) => {
    assert.ok(name in defined, `custom property non definita: ${name}`);
    assert.ok(!seen.includes(name), `riferimento circolare: ${name}`);
    return resolveVars(defined[name], [...seen, name]);
  });
}

// Lunghezza in px; il minimo di un clamp(). `null` se non si sa risolvere.
function toPx(value) {
  const resolved = resolveVars(value).trim();
  let match;
  if (resolved === "0") return 0;
  if ((match = /^(-?\d*\.?\d+)px$/u.exec(resolved))) return Number(match[1]);
  if ((match = /^(-?\d*\.?\d+)rem$/u.exec(resolved))) return Number(match[1]) * 16;
  if ((match = /^clamp\(\s*([^,]+),/u.exec(resolved))) return toPx(match[1]);
  return null;
}

function colorOf(value) {
  const resolved = resolveVars(value).trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/u.exec(resolved);
  if (short) return short.slice(1).map((digit) => Number.parseInt(digit + digit, 16));
  const long = /^#([0-9a-f]{6})$/u.exec(resolved);
  if (long) return [0, 2, 4].map((offset) => Number.parseInt(long[1].slice(offset, offset + 2), 16));
  return null;
}

// Dichiarazioni finali di un selettore esatto, fuori dagli @media.
function declarationsOf(selector, rules = uiRules) {
  const result = new Map();
  for (const rule of rules) {
    if (rule.kind === "rule" && rule.context.length === 0 && rule.selectors.includes(selector)) {
      for (const { prop, value } of rule.declarations) result.set(prop, value);
    }
  }
  return result;
}

// Tutte le dichiarazioni di ui.css con la regola e il selettore di provenienza.
function allDeclarations(rules = uiRules) {
  return rules
    .filter((rule) => rule.kind === "rule")
    .flatMap((rule) => rule.declarations.map((declaration) => ({ ...declaration, selectors: rule.selectors })));
}

// Classi dell'ultimo selettore composto (il "soggetto"): `.ui-card--ink .ui-card__title`
// → ["ui-card__title"], `.ui-button:disabled` → ["ui-button"].
function subjectClasses(selector) {
  const flat = selector.replace(/\[[^\]]*\]/gu, "[]").replace(/\([^)]*\)/gu, "()").trim();
  const compound = flat.split(/\s*[>+~]\s*|\s+/u).at(-1);
  return [...compound.matchAll(/\.([\w-]+)/gu)].map((match) => match[1]);
}

// Regole il cui soggetto è la radice di un componente (`.ui-button`,
// `.ui-button--lg`, `.ui-pill--info`), non un suo pezzo interno (`__spinner`).
function rulesOnRoots(names) {
  const isRoot = (name) => names.some((base) => name === `ui-${base}` || name.startsWith(`ui-${base}--`));
  return uiRules.filter(
    (rule) => rule.kind === "rule" && rule.selectors.some((selector) => subjectClasses(selector).some(isRoot)),
  );
}

// Dimensione del font dichiarata da `font-size` o dallo shorthand `font`.
function fontSizesIn(declarations) {
  const sizes = [];
  for (const { prop, value, selectors } of declarations) {
    if (prop === "font-size") {
      sizes.push({ selectors, source: value, px: toPx(value) });
    } else if (prop === "font") {
      const tokens = splitTopLevel(resolveVars(value).replace(/\s*\/\s*/gu, "/"), byWhitespace);
      const sizeToken = tokens.find((token) => !/^(?:normal|bold|italic|oblique|small-caps|\d{3})$/u.test(token));
      const size = sizeToken ? splitTopLevel(sizeToken, bySlash)[0] : "";
      sizes.push({ selectors, source: value, px: toPx(size) });
    }
  }
  return sizes;
}

const normalized = (value) =>
  value
    .replace(/\s+/gu, "")
    .replace(/(?<!\d)0\./gu, ".")
    .toLowerCase();

// ---------------------------------------------------------------------------
// Contrasto WCAG (stesso calcolo di recordNightContrast.test.mjs)
// ---------------------------------------------------------------------------

const channel = (value) => {
  const unit = value / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
};
const luminance = ([red, green, blue]) => 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
const ratio = (left, right) => {
  const [high, low] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
};

const WHITE = "#ffffff";
// Un nome di token (`--info-ink`) o un esadecimale scritto così com'è nel CSS.
const paint = (name) => {
  const color = colorOf(name.startsWith("--") ? `var(${name})` : name);
  assert.ok(color, `colore non leggibile: ${name}`);
  return color;
};

function contrastFailures(pairs, minimum) {
  return pairs
    .map(([foreground, background, where]) => ({
      where: `${foreground} su ${background} (${where})`,
      value: ratio(paint(foreground), paint(background)),
    }))
    .filter(({ value }) => value < minimum)
    .map(({ where, value }) => `${where}: ${value.toFixed(2)}:1`);
}

// ---------------------------------------------------------------------------
// Rendering: markup → albero leggero
// ---------------------------------------------------------------------------

const VOID_TAGS = new Set(["img", "link", "meta", "br", "hr", "input", "source"]);
const decodeEntities = (text) =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");

function parseHtml(markup) {
  const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  const token = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/gu;
  for (const match of markup.matchAll(token)) {
    const [, closing, tag, rawAttributes, selfClosing, text] = match;
    if (text !== undefined) {
      stack.at(-1).children.push(decodeEntities(text));
    } else if (closing) {
      while (stack.length > 1 && stack.pop().tag !== tag);
    } else {
      const attrs = {};
      for (const attribute of rawAttributes.matchAll(/([^\s=]+)(?:="([^"]*)")?/gu)) {
        attrs[attribute[1]] = decodeEntities(attribute[2] ?? "");
      }
      const node = { tag, attrs, children: [] };
      stack.at(-1).children.push(node);
      if (!selfClosing && !VOID_TAGS.has(tag)) stack.push(node);
    }
  }
  return root;
}

const elementsOf = (node) => node.children.filter((child) => typeof child !== "string");
function findAll(node, predicate, found = []) {
  for (const child of elementsOf(node)) {
    if (predicate(child)) found.push(child);
    findAll(child, predicate, found);
  }
  return found;
}
const classesOf = (node) => (node.attrs.class ?? "").split(/\s+/u).filter(Boolean);
const hasClass = (node, name) => classesOf(node).includes(name);
const byClass = (node, name) => findAll(node, (child) => hasClass(child, name));
const byTag = (node, tag) => findAll(node, (child) => child.tag === tag);
const textOf = (node) =>
  node.children.map((child) => (typeof child === "string" ? child : textOf(child))).join("");
const has = (node, attribute) => attribute in node.attrs;
const classSet = (text) => new Set(text.split(/\s+/u).filter(Boolean));

// React 19 mette un <link rel="preload"> davanti a un <img>: la radice è il
// primo elemento che non è un <link>.
function render(element) {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, element));
  const tree = parseHtml(html);
  return { html, tree, root: elementsOf(tree).find((node) => node.tag !== "link") };
}

const rootOf = (element) => render(element).root;

// ---------------------------------------------------------------------------
// 1. Guardia "nessun cambio alle pagine vecchie"
// ---------------------------------------------------------------------------

test("i parser leggono i CSS: token di base.css e di tokens.css, regole dentro @media", () => {
  assert.ok(Object.keys(baseRoot).length > 20, `custom property di base.css: ${Object.keys(baseRoot).length}`);
  for (const name of ["--primary", "--heading", "--text", "--bg", "--radius-lg"]) {
    assert.ok(name in baseRoot, `${name} manca da base.css :root`);
  }
  assert.ok(Object.keys(tokensRoot).length > 40, `custom property di tokens.css: ${Object.keys(tokensRoot).length}`);
  assert.ok(uiRules.filter((rule) => rule.kind === "rule").length > 50);
  assert.ok(
    uiRules.some((rule) => rule.kind === "rule" && rule.context.length > 0),
    "nessuna regola letta dentro un @media",
  );
  assert.ok(uiRules.some((rule) => rule.kind === "keyframes"));
});

test("tokens.css non ridefinisce nessuna custom property del :root di base.css", () => {
  const redefined = tokensRules
    .filter((rule) => rule.kind === "rule")
    .flatMap((rule) => rule.declarations)
    .map(({ prop }) => prop)
    .filter((prop) => prop in baseRoot);
  assert.deepEqual(redefined, [], "ridefinire un token storico cambia le pagine non ancora rifatte");
});

test("tokens.css dichiara solo custom property, solo su :root", () => {
  for (const rule of tokensRules) {
    assert.equal(rule.kind, "rule", `at-rule inattesa: ${rule.name ?? rule.prelude}`);
    assert.deepEqual(rule.selectors, [":root"]);
    for (const { prop } of rule.declarations) {
      assert.ok(prop.startsWith("--"), `${prop}: una proprietà vera in tokens.css cambia le pagine vecchie`);
    }
  }
});

test("main.tsx importa tokens.css prima di base.css", () => {
  const tokens = mainSource.indexOf("@/styles/tokens.css");
  const base = mainSource.indexOf("@/styles/base.css");
  assert.ok(tokens !== -1 && base !== -1, "import mancante");
  assert.ok(tokens < base, "tokens.css deve venire prima di base.css");
});

test("ui.css: ogni selettore comincia con .ui- e le animazioni si chiamano ui-*", () => {
  const offenders = [];
  for (const rule of uiRules) {
    if (rule.kind === "keyframes") {
      if (!rule.name.startsWith("ui-")) offenders.push(`@keyframes ${rule.name}`);
    } else if (rule.kind === "at") {
      offenders.push(rule.prelude);
    } else {
      for (const selector of rule.selectors) {
        if (!/^\.ui-[a-z]/u.test(selector)) offenders.push(selector);
      }
    }
  }
  assert.deepEqual(offenders, [], "selettori che possono toccare le pagine vecchie");
});

test("ui.css: ogni var(--x) usata è definita in tokens.css o nel :root di base.css", () => {
  for (const [name, css] of [["ui.css", uiCss], ["tokens.css", tokensCss]]) {
    const used = [...stripComments(css).matchAll(/var\(\s*(--[\w-]+)/gu)].map((match) => match[1]);
    if (css === uiCss) assert.ok(used.length > 50, `${name}: var() letti: ${used.length}`);
    const missing = [...new Set(used)].filter((token) => !(token in defined));
    assert.deepEqual(missing, [], `${name}: token inesistenti`);
  }
});

test("ui.css non usa i toni storici --warning e --danger (sul loro fondo tenue non arrivano ad AA)", () => {
  const used = [...stripComments(uiCss).matchAll(/var\(\s*(--(?:warning|danger)(?:-soft)?)\s*[,)]/gu)].map(
    (match) => match[1],
  );
  assert.deepEqual(used, []);
});

test("ui.css: niente white-space: nowrap, puntini o line-clamp (testi più lunghi del 40%)", () => {
  const offenders = allDeclarations()
    .filter(
      ({ prop, value }) =>
        (prop === "white-space" && /nowrap/u.test(value)) ||
        prop === "text-overflow" ||
        prop === "line-clamp" ||
        prop === "-webkit-line-clamp",
    )
    .map(({ selectors, prop, value }) => `${selectors.join(", ")} { ${prop}: ${value} }`);
  assert.deepEqual(offenders, []);
});

const FIXED_LENGTH = /^-?\d*\.?\d+(?:px|rem|pt|cm|mm|in)$/u;

test("ui.css: pulsanti e pill senza width né min-width fissi", () => {
  const rules = rulesOnRoots(["button", "pill"]);
  assert.ok(rules.length >= 8, `regole di pulsanti e pill lette: ${rules.length}`);
  const offenders = allDeclarations(rules)
    .filter(({ prop, value }) => (prop === "width" || prop === "min-width") && FIXED_LENGTH.test(resolveVars(value).trim()))
    .map(({ selectors, prop, value }) => `${selectors.join(", ")} { ${prop}: ${value} }`);
  assert.deepEqual(offenders, [], "una larghezza fissa non regge «Cancel registration» o «Cancelar inscripción»");
});

test("ui.css: nessuna altezza fissa su pulsanti, pill, schede, avvisi, stati vuoti, testata (solo min-height)", () => {
  const rules = rulesOnRoots(["button", "pill", "card", "notice", "empty", "page-header"]);
  assert.ok(rules.length >= 20, `regole lette: ${rules.length}`);
  const offenders = allDeclarations(rules)
    .filter(({ prop }) => prop === "height" || prop === "max-height")
    .map(({ selectors, prop, value }) => `${selectors.join(", ")} { ${prop}: ${value} }`);
  assert.deepEqual(offenders, []);
});

test("pulsanti: il testo va a capo invece di uscire dal bordo", () => {
  const button = declarationsOf(".ui-button");
  assert.equal(button.get("max-width"), "100%");
  assert.match(button.get("overflow-wrap") ?? "", /^(?:anywhere|break-word)$/u);
  assert.ok(!/hidden|clip/u.test(button.get("overflow") ?? ""), "overflow nasconde il testo che non entra");
  // La riga del testo non deve stringersi sotto l'altezza minima: l'altezza cresce.
  assert.ok(!button.has("height"));
});

test("testata, card, avvisi e stati vuoti: i blocchi vanno a capo e il testo può restringersi", () => {
  const wraps = [
    ".ui-page-header",
    ".ui-page-header__actions",
    ".ui-card__head",
    ".ui-card__foot",
    ".ui-notice__action",
    ".ui-empty__actions",
  ];
  for (const selector of wraps) {
    assert.equal(declarationsOf(selector).get("flex-wrap"), "wrap", `${selector} senza flex-wrap: wrap`);
  }
  const shrinks = [".ui-card", ".ui-card__titles", ".ui-card__body", ".ui-card__content", ".ui-notice__content", ".ui-page-header__text"];
  for (const selector of shrinks) {
    assert.equal(declarationsOf(selector).get("min-width"), "0", `${selector} senza min-width: 0`);
  }
  // La colonna del testo nelle card cliccabili e negli avvisi non deve spingere il resto fuori.
  assert.match(declarationsOf(".ui-card--link").get("grid-template-columns") ?? "", /minmax\(0,\s*1fr\)/u);
  assert.match(declarationsOf(".ui-notice").get("grid-template-columns") ?? "", /minmax\(0,\s*1fr\)/u);
});

test("titoli di testata e card: una parola lunga va a capo", () => {
  for (const selector of [".ui-page-header__title", ".ui-card__title"]) {
    assert.match(declarationsOf(selector).get("overflow-wrap") ?? "", /^(?:anywhere|break-word)$/u, selector);
  }
});

test("testi di avvisi, schede, stati vuoti e testata: una parola lunga (email, link) non sborda", () => {
  // overflow-wrap si eredita: vale il primo valore trovato risalendo verso la radice.
  const chains = [
    [".ui-notice__title", ".ui-notice__content", ".ui-notice"],
    [".ui-notice__body", ".ui-notice__content", ".ui-notice"],
    [".ui-notice__action", ".ui-notice__content", ".ui-notice"],
    [".ui-card__subtitle", ".ui-card__titles", ".ui-card__head", ".ui-card"],
    [".ui-card__body", ".ui-card"],
    [".ui-card__foot", ".ui-card"],
    [".ui-empty__title", ".ui-empty"],
    [".ui-empty__description", ".ui-empty"],
    [".ui-page-header__eyebrow", ".ui-page-header__text", ".ui-page-header"],
    [".ui-page-header__description", ".ui-page-header__text", ".ui-page-header"],
  ];
  const unprotected = chains
    .filter((chain) => {
      const value = chain.map((selector) => declarationsOf(selector).get("overflow-wrap")).find(Boolean);
      return !/^(?:anywhere|break-word)$/u.test(value ?? "");
    })
    .map((chain) => chain[0]);
  assert.deepEqual(unprotected, []);
});

test("ui.css: ogni animazione ha la sua variante per prefers-reduced-motion e le transizioni usano i token di durata", () => {
  const animated = uiRules.filter(
    (rule) => rule.kind === "rule" && rule.context.length === 0 && rule.declarations.some(({ prop }) => prop === "animation"),
  );
  assert.ok(animated.length > 0, "nessuna animazione letta");
  for (const rule of animated) {
    const reduced = uiRules.some(
      (other) =>
        other.kind === "rule" &&
        other.context.some((prelude) => /prefers-reduced-motion:\s*reduce/u.test(prelude)) &&
        other.selectors.some((selector) => rule.selectors.includes(selector)),
    );
    assert.ok(reduced, `${rule.selectors.join(", ")}: manca la variante prefers-reduced-motion`);
  }
  for (const { prop, value, selectors } of allDeclarations()) {
    if (prop === "transition") {
      assert.ok(!/\d(?:ms|s)\b/u.test(value), `${selectors.join(", ")}: durata scritta a mano in «${value}»`);
      assert.match(value, /var\(--duration/u, selectors.join(", "));
    }
  }
});

// ---------------------------------------------------------------------------
// Token: i valori del brief ("Token: cosa c'è e cosa manca")
// ---------------------------------------------------------------------------

test("tokens.css: scala, colori, radius, target, livelli, ombre e movimento del brief", () => {
  const expected = {
    "--space-1": "4px", "--space-2": "8px", "--space-3": "12px", "--space-4": "16px",
    "--space-5": "20px", "--space-6": "24px", "--space-7": "32px", "--space-8": "48px",
    "--gutter": "16px", "--content-max": "1100px",
    "--text-xs": "13px", "--text-sm": "14px", "--text-md": "16px", "--text-lg": "18px",
    "--title-sm": "22px", "--title-md": "26px", "--title-lg": "30px",
    "--title-xl": "clamp(32px, 7vw, 44px)",
    "--leading-tight": "1.15", "--leading-body": "1.5",
    "--surface-warm": "#edece5", "--focus-ring": "#bb7626",
    "--radius-inset": "12px", "--radius-control": "16px", "--radius-card": "20px",
    "--radius-sheet": "22px", "--radius-pill": "999px",
    "--target": "44px", "--control": "48px",
    "--z-raised": "1", "--z-sticky": "30", "--z-dock": "40", "--z-popover": "60",
    "--z-sheet": "1000", "--z-modal": "1250", "--z-toast": "1400",
    "--duration-fast": "150ms", "--duration": "220ms", "--ease": "cubic-bezier(.2,.7,.2,1)",
  };
  const mismatches = Object.entries(expected)
    .filter(([name, value]) => normalized(tokensRoot[name] ?? "(manca)") !== normalized(value))
    .map(([name, value]) => `${name}: ${tokensRoot[name] ?? "(manca)"} invece di ${value}`);
  assert.deepEqual(mismatches, []);

  // Colori e font vengono dal tema dell'anno: il token deve puntare alla variabile
  // giusta di yearTheme.css (non un esadecimale) e la catena deve arrivare a un
  // colore leggibile. Quale colore sia è affare del tema, non di questo test.
  const fromTheme = {
    "--text-secondary": "--theme-muted", "--ink": "--theme-primary", "--action-sand": "--theme-accent",
    "--surface-card": "--theme-surface", "--surface-cool": "--theme-arch", "--line": "--theme-line",
    "--sand-soft": "--theme-accent-tint", "--on-sand-soft": "--theme-on-accent-tint",
    "--font-display": "--theme-font", "--font-body": "--theme-font",
  };
  const notThemed = Object.entries(fromTheme)
    .filter(([name, source]) => (baseRoot[name] ?? tokensRoot[name])?.replace(/\s+/gu, "") !== `var(${source})`)
    .map(([name, source]) => `${name}: ${tokensRoot[name] ?? "(manca)"} invece di var(${source})`);
  assert.deepEqual(notThemed, []);
  for (const name of Object.keys(fromTheme).filter((key) => !key.startsWith("--font"))) {
    assert.ok(colorOf(`var(${name})`), `${name}: la catena di var() non arriva a un colore esadecimale`);
  }
  assert.match(resolveVars("var(--font-display)"), /sans-serif/u, "il font del tema ha un generico di riserva");

  // Ombra della card: stessa forma di sempre; il colore non è fissato qui
  // (che non sia quello vecchio lo controlla yearTheme.test.mjs).
  assert.match(
    normalized(tokensRoot["--shadow-card"]),
    /^04px18pxrgba\(\d+,\d+,\d+,\.05\)$/u,
  );
});

test("tokens.css: --gutter sale a 24 px da 768 px e il movimento si azzera con prefers-reduced-motion", () => {
  const inMedia = (pattern) =>
    tokensRules.filter((rule) => rule.kind === "rule" && rule.context.some((prelude) => pattern.test(prelude)));
  const wide = inMedia(/min-width:\s*768px/u).flatMap((rule) => rule.declarations);
  assert.equal(wide.find(({ prop }) => prop === "--gutter")?.value, "24px");
  const reduced = Object.fromEntries(
    inMedia(/prefers-reduced-motion:\s*reduce/u).flatMap((rule) => rule.declarations.map(({ prop, value }) => [prop, value])),
  );
  assert.equal(reduced["--duration-fast"], "0ms");
  assert.equal(reduced["--duration"], "0ms");
});

test("tokens.css: una scala di livelli sola, con i toast sempre in cima", () => {
  const levels = ["--z-raised", "--z-sticky", "--z-dock", "--z-popover", "--z-sheet", "--z-modal", "--z-toast"].map((name) =>
    Number(tokensRoot[name]),
  );
  assert.deepEqual(levels, [...levels].sort((a, b) => a - b), "i livelli non crescono");
  assert.equal(new Set(levels).size, levels.length, "due livelli uguali");
  // Brief: i toast stanno sopra ai fogli (1000) e alle modali (1250).
  assert.ok(Number(tokensRoot["--z-toast"]) > 1250);
});

// ---------------------------------------------------------------------------
// 2. Target e dimensione del testo
// ---------------------------------------------------------------------------

test("target: --target è 44 px e --control 48 px", () => {
  assert.equal(toPx("var(--target)"), 44);
  assert.equal(toPx("var(--control)"), 48);
});

test("pulsanti: min-height 44 px (md) e 48 px (lg), mai sotto, e i link tappabili uguali", () => {
  assert.equal(toPx(declarationsOf(".ui-button").get("min-height")), 44);
  assert.equal(toPx(declarationsOf(".ui-button--lg").get("min-height")), 48);

  const tappable = uiRules.filter(
    (rule) =>
      rule.kind === "rule" &&
      rule.selectors.some((selector) => subjectClasses(selector).some((name) => /^ui-button(?:--|$)/u.test(name))),
  );
  const heights = allDeclarations(tappable).filter(({ prop }) => prop === "min-height" || prop === "height");
  assert.ok(heights.length >= 2);
  for (const { prop, value, selectors } of heights) {
    const px = toPx(value);
    assert.notEqual(px, null, `${selectors.join(", ")}: ${prop} ${value} non risolvibile, estendi il test`);
    assert.ok(px >= 44, `${selectors.join(", ")}: ${prop} ${value} = ${px}px sotto 44`);
  }

  // Il link «indietro» della testata è un controllo: 44 anche lui.
  assert.ok(toPx(declarationsOf(".ui-page-header__back").get("min-height")) >= 44);
});

test("pill: alta 28 px, testo 13 px (non si tocca: un filtro toccabile è un Button)", () => {
  assert.equal(toPx(declarationsOf(".ui-pill").get("min-height")), 28);
  assert.equal(toPx(declarationsOf(".ui-pill").get("font-size")), 13);
});

test("--text-xs è 13 px e nessun font-size di ui.css scende sotto 13 px", () => {
  assert.equal(toPx("var(--text-xs)"), 13);
  for (const name of Object.keys(tokensRoot).filter((token) => /^--(?:text-(?:xs|sm|md|lg)|title-(?:sm|md|lg|xl))$/u.test(token))) {
    assert.ok(toPx(`var(${name})`) >= 13, `${name} sotto 13 px`);
  }

  const sizes = fontSizesIn(allDeclarations());
  assert.ok(sizes.length >= 12, `dichiarazioni di font lette: ${sizes.length}`);
  const bad = sizes
    .filter(({ px }) => px === null || px < 13)
    .map(({ selectors, source, px }) => `${selectors.join(", ")}: ${source} (${px === null ? "non risolvibile" : `${px}px`})`);
  assert.deepEqual(bad, [], "font-size sotto 13 px, oppure relativo: il test non sa dire se arriva a 13");
});

// ---------------------------------------------------------------------------
// 3. Contrasto WCAG AA (≥ 4,5:1) dai valori dei CSS
// ---------------------------------------------------------------------------

const AA = 4.5;

test("contrasto: testo e fondo di ogni tono (info, success, warning, danger, sabbia)", () => {
  assert.deepEqual(
    contrastFailures(
      [
        ["--info-ink", "--info-surface", "info"],
        ["--success-ink", "--success-surface", "success"],
        ["--warning-ink", "--warning-surface", "warning"],
        ["--danger-ink", "--danger-surface", "danger"],
        ["--on-sand-soft", "--sand-soft", "sabbia"],
      ],
      AA,
    ),
    [],
  );
});

test("contrasto: testo secondario su card, fondo freddo, fondo caldo e sfondo della pagina", () => {
  assert.deepEqual(
    contrastFailures(
      ["--surface-card", "--surface-cool", "--surface-warm", "--bg"].map((background) => [
        "--text-secondary",
        background,
        "testo secondario",
      ]),
      AA,
    ),
    [],
  );
});

test("contrasto: bianco su --primary (base.css), --ink e --danger-ink", () => {
  assert.deepEqual(
    contrastFailures(
      [
        [WHITE, "--primary", "Button primary"],
        [WHITE, "--ink", "Button primary in hover, Card ink"],
        [WHITE, "--danger-ink", "Button danger"],
      ],
      AA,
    ),
    [],
  );
});

// Il blu del tema (--ink) non è più una coppia usata sulla sabbia: la guardia sui
// sorgenti sta in yearTheme.test.mjs («testo su sfondo ambra»).
test("contrasto: testo sulla sabbia dell'azione (--on-sand)", () => {
  assert.deepEqual(
    contrastFailures(
      [
        ["--on-sand", "--action-sand", "testo su azione sabbia"],
      ],
      AA,
    ),
    [],
  );
});

test("contrasto: testo e titolo sulle superfici dove i componenti li mettono", () => {
  const surfaces = [
    "--surface-card", "--surface-cool", "--surface-warm",
    "--info-surface", "--success-surface", "--warning-surface", "--danger-surface",
  ];
  assert.deepEqual(
    contrastFailures(
      surfaces.flatMap((background) => [
        ["--text", background, "corpo di card e avvisi"],
        ["--heading", background, "titoli, pill neutra"],
      ]),
      AA,
    ),
    [],
  );
});

test("contrasto: --primary su card, pagina e fondo info (Button secondary, ghost e ghost in hover, link «indietro»)", () => {
  assert.deepEqual(
    contrastFailures(
      ["--surface-card", "--bg", "--info-surface", "--surface-cool"].map((background) => ["--primary", background, "testo primario"]),
      AA,
    ),
    [],
  );
});

test("contrasto: sottotitolo della Card ink, letto dal CSS, su --ink", () => {
  const subtitle = declarationsOf(".ui-card--ink .ui-card__subtitle").get("color");
  assert.ok(subtitle, "colore del sottotitolo non trovato");
  assert.deepEqual(contrastFailures([[subtitle, "--ink", "sottotitolo Card ink"]], AA), []);
});

test("ui.css: ogni regola con colore e fondo espliciti passa AA (fondi tenui e pieni)", () => {
  const checked = [];
  const failures = [];
  for (const rule of uiRules) {
    if (rule.kind !== "rule") continue;
    const declarations = new Map(rule.declarations.map(({ prop, value }) => [prop, value]));
    const background = declarations.get("background-color") ?? declarations.get("background");
    const foreground = declarations.get("color");
    if (!background || !foreground) continue;
    const back = colorOf(background);
    const front = colorOf(foreground);
    if (!back || !front) continue; // trasparente, currentColor, gradiente
    const value = ratio(front, back);
    checked.push(rule.selectors.join(", "));
    if (value < AA) failures.push(`${rule.selectors.join(", ")}: ${foreground} su ${background} = ${value.toFixed(2)}:1`);
  }
  assert.ok(checked.length >= 10, `coppie lette dal CSS: ${checked.length}`);
  assert.deepEqual(failures, []);
});

test("focus: l'anello (--focus-ring) arriva a 3:1 sulle superfici chiare dove sta un controllo", () => {
  assert.deepEqual(
    contrastFailures(
      [
        "--surface-card", "--bg", "--surface-cool", "--surface-warm",
        "--info-surface", "--success-surface", "--warning-surface", "--danger-surface",
      ].map((background) => ["--focus-ring", background, "anello di focus"]),
      3,
    ),
    [],
  );
  const ring = declarationsOf(".ui-button:focus-visible");
  assert.match(ring.get("outline") ?? "", /var\(--focus-ring\)/u, "pulsante senza anello di focus");
});

// Card ink: --focus-ring resta #bb7626 in :root (serve alle superfici chiare) e
// dentro la card i figli lo ridefiniscono. Il colore arriva dal CSS.
const ringRules = uiRules.filter(
  (rule) => rule.kind === "rule" && rule.declarations.some(({ prop }) => prop === "--focus-ring"),
);

test("focus nella Card ink: i figli ridefiniscono --focus-ring e il valore risolto arriva a 3:1 su --ink", () => {
  const inkRule = ringRules.find((rule) => rule.selectors.includes(".ui-card--ink > *"));
  assert.ok(inkRule, "manca la regola .ui-card--ink > * che cambia --focus-ring");
  const value = inkRule.declarations.find(({ prop }) => prop === "--focus-ring").value;
  const ring = colorOf(value);
  assert.ok(ring, `valore di --focus-ring non leggibile: ${value}`);
  const measured = ratio(ring, paint("--ink"));
  assert.ok(measured >= 3, `${value} su --ink: ${measured.toFixed(2)}:1, sotto 3:1`);

  // L'anello dei controlli usa la variabile, quindi la ridefinizione arriva fino al pulsante.
  assert.match(declarationsOf(".ui-button:focus-visible").get("outline") ?? "", /var\(--focus-ring\)/u);
});

test("focus nella Card ink: la ridefinizione vale per i figli, non per la card (l'anello della .ui-card--link sta sul fondo pagina)", () => {
  assert.ok(ringRules.length >= 1);
  for (const rule of ringRules) {
    for (const selector of rule.selectors) {
      assert.match(selector, /^\.ui-card--ink\s*>\s*\*$|^\.ui-card--ink\s+\S/u, `${selector} tocca la card stessa`);
    }
  }
  for (const selector of [".ui-card", ".ui-card--ink", ".ui-card--link", ".ui-card--link:focus-visible"]) {
    assert.ok(!declarationsOf(selector).has("--focus-ring"), `${selector} ridefinisce --focus-ring`);
  }
  // La card cliccabile usa l'anello di :root, e quello arriva a 3:1 sul fondo della pagina.
  assert.match(declarationsOf(".ui-card--link:focus-visible").get("outline") ?? "", /var\(--focus-ring\)/u);
  assert.deepEqual(contrastFailures([["--focus-ring", "--bg", "anello della card cliccabile"]], 3), []);
});

// Colore pieno, oppure rgba() composto sopra `base`.
function compositeOver(value, base) {
  const resolved = resolveVars(value).trim();
  const solid = colorOf(resolved);
  if (solid) return solid;
  const match = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/u.exec(resolved);
  assert.ok(match, `colore non leggibile: ${value}`);
  const alpha = Number(match[4]);
  return [1, 2, 3].map((group, channelIndex) => Math.round(Number(match[group]) * alpha + base[channelIndex] * (1 - alpha)));
}

test("Card ink, Button primary: testo su fondo sabbia a 4,5:1, fondo contro --ink a 3:1, anche in hover", () => {
  const primary = declarationsOf(".ui-card--ink .ui-button--primary");
  const hover = declarationsOf(".ui-card--ink .ui-button--primary:hover");
  assert.ok(primary.has("background") && primary.has("color"), "regola del primario nella Card ink mancante");
  const ink = paint("--ink");
  const background = compositeOver(primary.get("background"), ink);
  const text = colorOf(primary.get("color"));
  assert.ok(text, `colore del testo non leggibile: ${primary.get("color")}`);

  assert.ok(ratio(text, background) >= AA, `testo su fondo: ${ratio(text, background).toFixed(2)}:1`);
  assert.ok(ratio(background, ink) >= 3, `fondo del tasto contro --ink: ${ratio(background, ink).toFixed(2)}:1, il tasto non si distingue dalla card`);

  // In hover il testo non cambia: deve restare leggibile sul fondo nuovo.
  assert.ok(hover.has("background"), "manca il fondo in hover");
  assert.ok(!hover.has("color") || colorOf(hover.get("color")), "colore in hover non leggibile");
  const hoverText = hover.has("color") ? colorOf(hover.get("color")) : text;
  const hoverBackground = compositeOver(hover.get("background"), ink);
  assert.ok(ratio(hoverText, hoverBackground) >= AA, `testo in hover: ${ratio(hoverText, hoverBackground).toFixed(2)}:1`);
});

test("Card ink, Button secondary e ghost: testo bianco su --ink a 4,5:1, anche col fondo in hover", () => {
  const ink = paint("--ink");
  for (const variant of ["secondary", "ghost"]) {
    const rule = declarationsOf(`.ui-card--ink .ui-button--${variant}`);
    const text = colorOf(rule.get("color") ?? "");
    assert.ok(text, `${variant}: colore del testo mancante o illeggibile`);
    assert.deepEqual(text, [255, 255, 255], `${variant}: il testo dovrebbe essere bianco`);
    assert.ok(ratio(text, ink) >= AA, `${variant}: bianco su --ink ${ratio(text, ink).toFixed(2)}:1`);
  }
  // Il secondario è trasparente: il fondo che conta è quello della card.
  assert.equal(declarationsOf(".ui-card--ink .ui-button--secondary").get("background"), "transparent");

  const ghostHover = declarationsOf(".ui-card--ink .ui-button--ghost:hover").get("background");
  assert.ok(ghostHover, "manca il fondo del ghost in hover");
  const hoverBackground = compositeOver(ghostHover, ink);
  assert.ok(ratio([255, 255, 255], hoverBackground) >= AA, `bianco sul ghost in hover: ${ratio([255, 255, 255], hoverBackground).toFixed(2)}:1`);
});

// ---------------------------------------------------------------------------
// 4. Button e ButtonLink
// ---------------------------------------------------------------------------

test("Button: di default è type=\"button\", primario, alto 44 (nessuna classe lg) e libero", () => {
  const button = rootOf(createElement(Button, null, "Salva"));
  assert.equal(button.tag, "button");
  assert.equal(button.attrs.type, "button", "dentro un form non deve inviare");
  assert.deepEqual(classSet(button.attrs.class), new Set(["ui-button", "ui-button--primary"]));
  assert.ok(!has(button, "disabled"));
  assert.ok(!has(button, "aria-busy"));
  assert.equal(textOf(button), "Salva");
});

test("Button: type=\"submit\" passato dal chiamante resta tale", () => {
  assert.equal(rootOf(createElement(Button, { type: "submit" }, "Invia")).attrs.type, "submit");
});

test("Button: una classe per variante, per taglia lg e per block; la classe del chiamante si aggiunge", () => {
  for (const variant of ["primary", "secondary", "ghost", "danger"]) {
    const classes = classSet(rootOf(createElement(Button, { variant }, "Ok")).attrs.class);
    assert.ok(classes.has("ui-button") && classes.has(`ui-button--${variant}`), variant);
    assert.equal(classes.size, 2, `${variant}: classi in più ${[...classes]}`);
  }
  assert.ok(classSet(rootOf(createElement(Button, { size: "lg" }, "Ok")).attrs.class).has("ui-button--lg"));
  assert.ok(!classSet(rootOf(createElement(Button, { size: "md" }, "Ok")).attrs.class).has("ui-button--lg"));
  assert.ok(classSet(rootOf(createElement(Button, { block: true }, "Ok")).attrs.class).has("ui-button--block"));
  assert.ok(!classSet(rootOf(createElement(Button, { block: false }, "Ok")).attrs.class).has("ui-button--block"));
  const custom = classSet(rootOf(createElement(Button, { className: "mia-classe" }, "Ok")).attrs.class);
  assert.ok(custom.has("mia-classe") && custom.has("ui-button"));
});

test("Button: busy blocca il tasto, dichiara aria-busy, mostra la rotella e nasconde l'icona", () => {
  for (const iconPosition of ["start", "end"]) {
    const button = rootOf(createElement(Button, { busy: true, icon: "plus", iconPosition }, "Salva"));
    assert.ok(has(button, "disabled"), "busy deve disabilitare");
    assert.equal(button.attrs["aria-busy"], "true");
    const spinners = byClass(button, "ui-button__spinner");
    assert.equal(spinners.length, 1, "una rotella");
    assert.equal(spinners[0].attrs["aria-hidden"], "true", "la rotella è decorativa");
    assert.equal(byTag(button, "svg").length, 0, `icona ancora visibile con iconPosition=${iconPosition}`);
    assert.equal(textOf(button), "Salva", "il testo resta, così la larghezza non salta");
  }
});

test("Button: senza busy niente rotella e niente aria-busy; disabled da solo non dichiara busy", () => {
  const idle = rootOf(createElement(Button, { busy: false }, "Salva"));
  assert.equal(byClass(idle, "ui-button__spinner").length, 0);
  assert.ok(!has(idle, "aria-busy"));
  assert.ok(!has(idle, "disabled"));

  const disabled = rootOf(createElement(Button, { disabled: true }, "Salva"));
  assert.ok(has(disabled, "disabled"));
  assert.ok(!has(disabled, "aria-busy"));
  assert.equal(byClass(disabled, "ui-button__spinner").length, 0);
});

test("Button: l'icona sta a sinistra di default e a destra con iconPosition=\"end\"", () => {
  const tags = (props) => elementsOf(rootOf(createElement(Button, props, "Avanti"))).map((node) => node.tag);
  assert.deepEqual(tags({ icon: "plus" }), ["svg", "span"]);
  assert.deepEqual(tags({ icon: "plus", iconPosition: "start" }), ["svg", "span"]);
  assert.deepEqual(tags({ icon: "plus", iconPosition: "end" }), ["span", "svg"]);
  assert.deepEqual(tags({}), ["span"]);
  const icon = byTag(rootOf(createElement(Button, { icon: "plus" }, "Avanti")), "svg")[0];
  assert.ok(hasClass(icon, "ui-icon"));
  assert.equal(icon.attrs["aria-hidden"], "true", "l'icona accanto a un testo è decorativa");
});

test("buttonClassName: stesse classi del Button, con i default primary/md/non block", () => {
  assert.deepEqual(classSet(buttonClassName()), new Set(["ui-button", "ui-button--primary"]));
  assert.deepEqual(
    classSet(buttonClassName({ variant: "danger", size: "lg", block: true })),
    new Set(["ui-button", "ui-button--danger", "ui-button--lg", "ui-button--block"]),
  );
  const props = { variant: "secondary", size: "lg", block: true };
  assert.deepEqual(classSet(buttonClassName(props)), classSet(rootOf(createElement(Button, props, "Ok")).attrs.class));
});

test("ButtonLink: è un <a> con l'href e le stesse classi del Button, senza attributi da pulsante", () => {
  for (const props of [{}, { variant: "ghost" }, { variant: "secondary", size: "lg", block: true }]) {
    const link = rootOf(createElement(ButtonLink, { to: "/activities", ...props }, "Vedi le attività"));
    assert.equal(link.tag, "a");
    assert.equal(link.attrs.href, "/activities");
    assert.deepEqual(classSet(link.attrs.class), classSet(buttonClassName(props)), JSON.stringify(props));
    assert.ok(!has(link, "type") && !has(link, "disabled") && !has(link, "aria-busy"));
    assert.equal(textOf(link), "Vedi le attività");
  }
  const withIcon = rootOf(createElement(ButtonLink, { to: "/x", icon: "arrow-right", iconPosition: "end" }, "Avanti"));
  assert.deepEqual(elementsOf(withIcon).map((node) => node.tag), ["span", "svg"]);
  assert.ok(classSet(rootOf(createElement(ButtonLink, { to: "/x", className: "mia" }, "Ok")).attrs.class).has("mia"));
});

// ---------------------------------------------------------------------------
// 5. Notice
// ---------------------------------------------------------------------------

test("Notice: role=\"alert\" per danger, role=\"status\" per gli altri toni", () => {
  const roles = Object.fromEntries(
    ["info", "success", "warning", "danger"].map((tone) => [tone, rootOf(createElement(Notice, { tone, title: "Titolo" })).attrs.role]),
  );
  assert.deepEqual(roles, { info: "status", success: "status", warning: "status", danger: "alert" });
});

test("Notice: live=\"none\" non mette nessun role; live esplicito vince sul tono", () => {
  for (const tone of ["info", "success", "warning", "danger"]) {
    const silent = rootOf(createElement(Notice, { tone, live: "none", title: "Fisso" }));
    assert.ok(!has(silent, "role"), `${tone} con live="none" ha role="${silent.attrs.role}"`);
  }
  assert.equal(rootOf(createElement(Notice, { tone: "info", live: "alert" }, "Testo")).attrs.role, "alert");
  assert.equal(rootOf(createElement(Notice, { tone: "danger", live: "status" }, "Testo")).attrs.role, "status");
});

test("Notice: il tono è quello passato, non si deduce dal titolo", () => {
  const notice = rootOf(createElement(Notice, { tone: "info", title: "Errore: qualcosa non va" }));
  assert.equal(notice.attrs.role, "status");
  assert.ok(!hasClass(notice, "ui-notice--danger"));
  for (const tone of ["success", "warning", "danger"]) {
    const classes = classSet(rootOf(createElement(Notice, { tone, title: "Titolo" })).attrs.class);
    assert.ok(classes.has("ui-notice") && classes.has(`ui-notice--${tone}`), tone);
  }
  assert.deepEqual(classSet(rootOf(createElement(Notice, { tone: "info" }, "Testo")).attrs.class), new Set(["ui-notice"]));
});

test("Notice: icona di default per tono (info, spunta, allarme, allarme), decorativa, e sostituibile", () => {
  const pathOf = (node) => byTag(node, "path").map((path) => path.attrs.d).join("|");
  const iconPath = (name) => pathOf(rootOf(createElement(Icon, { name })));
  const noticeIcon = (props) => {
    const svgs = byClass(rootOf(createElement(Notice, props, "Testo")), "ui-notice__icon");
    assert.equal(svgs.length, 1, "una sola icona");
    assert.equal(svgs[0].tag, "svg");
    assert.equal(svgs[0].attrs["aria-hidden"], "true");
    return pathOf(svgs[0]);
  };

  assert.equal(noticeIcon({ tone: "info" }), iconPath("info"));
  assert.equal(noticeIcon({ tone: "success" }), iconPath("check"));
  assert.equal(noticeIcon({ tone: "warning" }), iconPath("alert"));
  assert.equal(noticeIcon({ tone: "danger" }), iconPath("alert"));
  assert.notEqual(noticeIcon({ tone: "info" }), noticeIcon({ tone: "success" }));
  assert.notEqual(noticeIcon({ tone: "info" }), noticeIcon({ tone: "danger" }));
  assert.equal(noticeIcon({ tone: "info", icon: "heart" }), iconPath("heart"));
});

test("Notice: titolo, testo e azione ognuno nel suo contenitore; senza, niente contenitori vuoti", () => {
  const full = rootOf(
    createElement(Notice, { tone: "warning", title: "Iscrizioni chiuse", action: createElement(Button, null, "Scrivici") }, "Il termine è passato."),
  );
  assert.equal(textOf(byClass(full, "ui-notice__title")[0]), "Iscrizioni chiuse");
  assert.equal(textOf(byClass(full, "ui-notice__body")[0]), "Il termine è passato.");
  assert.equal(byTag(byClass(full, "ui-notice__action")[0], "button").length, 1);

  const bare = rootOf(createElement(Notice, { tone: "info", title: "Solo titolo" }));
  assert.equal(byClass(bare, "ui-notice__body").length, 0);
  assert.equal(byClass(bare, "ui-notice__action").length, 0);
  const bodyOnly = rootOf(createElement(Notice, { tone: "info" }, "Solo testo"));
  assert.equal(byClass(bodyOnly, "ui-notice__title").length, 0);
});

// ---------------------------------------------------------------------------
// 6. EmptyState
// ---------------------------------------------------------------------------

test("EmptyState: titolo (h2), descrizione, azione e azione secondaria, in quest'ordine", () => {
  const empty = rootOf(
    createElement(EmptyState, {
      title: "Nessuna attività",
      description: "Con questi filtri non c'è niente.",
      action: createElement(Button, null, "Mostra tutto il periodo"),
      secondaryAction: createElement(ButtonLink, { to: "/", variant: "ghost" }, "Torna alla home"),
    }),
  );
  assert.ok(hasClass(empty, "ui-empty"));
  const heading = byClass(empty, "ui-empty__title")[0];
  assert.equal(heading.tag, "h2");
  assert.equal(textOf(heading), "Nessuna attività");
  assert.equal(textOf(byClass(empty, "ui-empty__description")[0]), "Con questi filtri non c'è niente.");

  const actions = byClass(empty, "ui-empty__actions");
  assert.equal(actions.length, 1);
  assert.deepEqual(elementsOf(actions[0]).map((node) => node.tag), ["button", "a"]);
  assert.equal(textOf(elementsOf(actions[0])[0]), "Mostra tutto il periodo");
  assert.equal(textOf(elementsOf(actions[0])[1]), "Torna alla home");
  // Titolo, descrizione e azioni si leggono in questo ordine.
  assert.deepEqual(
    elementsOf(empty).map((node) => classesOf(node).find((name) => name.startsWith("ui-empty__"))),
    ["ui-empty__title", "ui-empty__description", "ui-empty__actions"],
  );
});

test("EmptyState: headingAs=\"h3\" cambia il livello del titolo", () => {
  const empty = rootOf(createElement(EmptyState, { title: "Vuoto", action: null, headingAs: "h3" }));
  assert.equal(byClass(empty, "ui-empty__title")[0].tag, "h3");
  assert.equal(byTag(empty, "h2").length, 0);
});

test("EmptyState: con action={null} e senza azione secondaria non c'è nessun contenitore delle azioni", () => {
  const empty = rootOf(createElement(EmptyState, { title: "Nessun comitato", description: "Niente da fare qui.", action: null }));
  assert.equal(byClass(empty, "ui-empty__actions").length, 0);
  assert.equal(byTag(empty, "button").length + byTag(empty, "a").length, 0);

  const withSecondary = rootOf(
    createElement(EmptyState, { title: "Vuoto", action: null, secondaryAction: createElement(ButtonLink, { to: "/" }, "Altrove") }),
  );
  const actions = byClass(withSecondary, "ui-empty__actions");
  assert.equal(actions.length, 1);
  assert.deepEqual(elementsOf(actions[0]).map((node) => node.tag), ["a"]);
});

test("EmptyState: senza descrizione niente paragrafo vuoto", () => {
  const empty = rootOf(createElement(EmptyState, { title: "Vuoto", action: createElement(Button, null, "Crea") }));
  assert.equal(byClass(empty, "ui-empty__description").length, 0);
  assert.equal(byTag(empty, "p").length, 0);
});

test("EmptyState: l'illustrazione è decorativa (alt vuoto) e compare solo se passata", () => {
  const { tree } = render(createElement(EmptyState, { title: "Vuoto", action: null, illustration: "/assets/comitati.webp" }));
  const images = findAll(tree, (node) => node.tag === "img");
  assert.equal(images.length, 1);
  assert.ok(has(images[0], "alt"), "manca l'attributo alt");
  assert.equal(images[0].attrs.alt, "");
  assert.equal(images[0].attrs.src, "/assets/comitati.webp");
  assert.ok(hasClass(images[0], "ui-empty__art"));

  const none = render(createElement(EmptyState, { title: "Vuoto", action: null }));
  assert.equal(findAll(none.tree, (node) => node.tag === "img").length, 0);
});

// ---------------------------------------------------------------------------
// 7. Card
// ---------------------------------------------------------------------------

test("Card: senza `to` è una <section> senza link né freccia", () => {
  const card = rootOf(createElement(Card, { title: "Programma" }, "Contenuto"));
  assert.equal(card.tag, "section");
  assert.ok(hasClass(card, "ui-card"));
  assert.ok(!hasClass(card, "ui-card--link"));
  assert.equal(byTag(card, "a").length, 0);
  assert.equal(byClass(card, "ui-card__arrow").length, 0);
});

test("Card: con `to` è un <a> con href e la freccia a destra, e non una <section>", () => {
  const { tree, root } = render(createElement(Card, { to: "/me/activities/abc", title: "Campo estivo", subtitle: "12 luglio" }, "Dettagli"));
  assert.equal(root.tag, "a");
  assert.equal(root.attrs.href, "/me/activities/abc");
  assert.ok(hasClass(root, "ui-card") && hasClass(root, "ui-card--link"));
  assert.equal(byTag(tree, "section").length, 0);
  const arrows = byClass(root, "ui-card__arrow");
  assert.equal(arrows.length, 1);
  assert.equal(arrows[0].tag, "svg");
  assert.equal(arrows[0].attrs["aria-hidden"], "true");
  // La freccia è l'ultimo figlio: sta a destra del contenuto.
  assert.equal(elementsOf(root).at(-1), arrows[0]);
  assert.equal(textOf(byClass(root, "ui-card__title")[0]), "Campo estivo");
});

test("Card: la freccia è larga e alta 20 px (brief) e l'icona non prende tutto lo spazio", () => {
  const arrow = declarationsOf(".ui-card__arrow");
  assert.equal(toPx(arrow.get("width")), 20);
  assert.equal(toPx(arrow.get("height")), 20);
  // Il difetto di /unit: un'icona senza dimensione occupa la riga intera.
  const icon = declarationsOf(".ui-icon");
  assert.match(icon.get("width") ?? "", /^1\.25em$/u);
  assert.match(icon.get("height") ?? "", /^1\.25em$/u);
});

test("Card: le varianti default, cool, warm e ink sono classi; `to` si somma alla variante", () => {
  const classes = (props) => classSet(rootOf(createElement(Card, { title: "T", ...props }, "x")).attrs.class);
  assert.deepEqual(classes({}), new Set(["ui-card"]));
  assert.deepEqual(classes({ variant: "default" }), new Set(["ui-card"]));
  for (const variant of ["cool", "warm", "ink"]) {
    assert.deepEqual(classes({ variant }), new Set(["ui-card", `ui-card--${variant}`]), variant);
  }
  assert.deepEqual(classes({ variant: "ink", to: "/x" }), new Set(["ui-card", "ui-card--ink", "ui-card--link"]));
  assert.ok(classes({ className: "mia" }).has("mia"));
});

test("Card: il titolo è h2 di default e h3 con titleAs; mai un h1", () => {
  const html = (props) => render(createElement(Card, { title: "Titolo", ...props }, "x"));
  assert.equal(byClass(html({}).root, "ui-card__title")[0].tag, "h2");
  assert.equal(byClass(html({ titleAs: "h3" }).root, "ui-card__title")[0].tag, "h3");
  assert.equal(byClass(html({ titleAs: "h3", to: "/x" }).root, "ui-card__title")[0].tag, "h3");
  assert.equal(byTag(html({}).tree, "h1").length, 0);
});

test("Card: sottotitolo, azione di testata e piede nei loro contenitori", () => {
  const card = rootOf(
    createElement(
      Card,
      { title: "Comitati", subtitle: "Cinque", headerAction: createElement(Pill, null, "5"), footer: createElement(Button, null, "Scegli") },
      createElement("p", null, "Corpo"),
    ),
  );
  const head = byClass(card, "ui-card__head")[0];
  assert.equal(textOf(byClass(head, "ui-card__subtitle")[0]), "Cinque");
  assert.equal(byClass(head, "ui-pill").length, 1, "headerAction dentro la testata");
  assert.equal(byTag(byClass(card, "ui-card__foot")[0], "button").length, 1);
  assert.equal(textOf(byClass(card, "ui-card__body")[0]), "Corpo");
  // Ordine di lettura: testata, corpo, piede.
  assert.deepEqual(
    elementsOf(card).map((node) => classesOf(node)[0]),
    ["ui-card__head", "ui-card__body", "ui-card__foot"],
  );
});

test("Card: senza titolo, corpo e piede non restano contenitori vuoti", () => {
  const onlyBody = rootOf(createElement(Card, null, "Solo corpo"));
  assert.equal(byClass(onlyBody, "ui-card__head").length, 0);
  assert.equal(byClass(onlyBody, "ui-card__foot").length, 0);
  assert.equal(byClass(onlyBody, "ui-card__body").length, 1);

  const onlyTitle = rootOf(createElement(Card, { title: "Solo titolo" }));
  assert.equal(byClass(onlyTitle, "ui-card__body").length, 0);
  assert.equal(byClass(onlyTitle, "ui-card__foot").length, 0);
  assert.equal(byClass(onlyTitle, "ui-card__subtitle").length, 0);

  const onlyAction = rootOf(createElement(Card, { headerAction: createElement(Pill, null, "3") }));
  assert.equal(byClass(onlyAction, "ui-card__titles").length, 0, "nessun blocco titoli senza titolo né sottotitolo");
  assert.equal(byClass(onlyAction, "ui-card__head").length, 1);
});

// ---------------------------------------------------------------------------
// 8. PageHeader
// ---------------------------------------------------------------------------

test("PageHeader: un solo <h1> con il titolo, anche con occhiello, descrizione, indietro e azioni", () => {
  const { tree, root } = render(
    createElement(PageHeader, {
      title: "Le tue attività",
      eyebrow: "Palo di Roma",
      description: "Tutto quello che ti aspetta.",
      back: { to: "/me", label: "Indietro" },
      actions: createElement(Button, null, "Nuova"),
    }),
  );
  assert.equal(root.tag, "header");
  const headings = byTag(tree, "h1");
  assert.equal(headings.length, 1);
  assert.equal(textOf(headings[0]), "Le tue attività");
  assert.ok(hasClass(headings[0], "ui-page-header__title"));
  for (const level of ["h2", "h3", "h4"]) assert.equal(byTag(tree, level).length, 0, level);
});

test("PageHeader: ordine di lettura indietro, occhiello, titolo, descrizione, poi le azioni", () => {
  const root = rootOf(
    createElement(PageHeader, {
      title: "Titolo",
      eyebrow: "Occhiello",
      description: "Descrizione",
      back: { to: "/", label: "Indietro" },
      actions: createElement(Button, null, "Azione"),
    }),
  );
  const [text, actions] = elementsOf(root);
  assert.ok(hasClass(text, "ui-page-header__text") && hasClass(actions, "ui-page-header__actions"));
  assert.deepEqual(
    elementsOf(text).map((node) => classesOf(node)[0]),
    ["ui-page-header__back", "ui-page-header__eyebrow", "ui-page-header__title", "ui-page-header__description"],
  );
});

test("PageHeader: il link indietro è un <a> con href e l'etichetta come testo; l'icona è decorativa", () => {
  const back = byClass(rootOf(createElement(PageHeader, { title: "T", back: { to: "/unit/persone", label: "Torna alle persone" } })), "ui-page-header__back");
  assert.equal(back.length, 1);
  assert.equal(back[0].tag, "a");
  assert.equal(back[0].attrs.href, "/unit/persone");
  assert.equal(textOf(back[0]), "Torna alle persone");
  const icons = byTag(back[0], "svg");
  assert.equal(icons.length, 1);
  assert.equal(icons[0].attrs["aria-hidden"], "true", "l'etichetta è già il nome accessibile");
});

test("PageHeader: le azioni stanno nel loro contenitore; senza azioni, indietro, occhiello o descrizione non c'è niente di vuoto", () => {
  const withActions = rootOf(
    createElement(PageHeader, { title: "T", actions: [createElement(Button, { key: "a" }, "Uno"), createElement(Button, { key: "b" }, "Due")] }),
  );
  const container = byClass(withActions, "ui-page-header__actions");
  assert.equal(container.length, 1);
  assert.deepEqual(byTag(container[0], "button").map(textOf), ["Uno", "Due"]);

  const bare = rootOf(createElement(PageHeader, { title: "Solo titolo" }));
  for (const name of ["actions", "back", "eyebrow", "description"]) {
    assert.equal(byClass(bare, `ui-page-header__${name}`).length, 0, name);
  }
  assert.equal(byTag(bare, "h1").length, 1);
});

// ---------------------------------------------------------------------------
// Pill
// ---------------------------------------------------------------------------

test("Pill: classe base, una classe per tono (il neutro non ne ha), testo e props passate", () => {
  assert.deepEqual(classSet(rootOf(createElement(Pill, null, "12")).attrs.class), new Set(["ui-pill"]));
  for (const tone of ["info", "success", "warning", "danger", "sand"]) {
    assert.deepEqual(classSet(rootOf(createElement(Pill, { tone }, "x")).attrs.class), new Set(["ui-pill", `ui-pill--${tone}`]), tone);
  }
  const pill = rootOf(createElement(Pill, { className: "mia", "aria-label": "12 persone" }, "12"));
  assert.ok(hasClass(pill, "mia") && hasClass(pill, "ui-pill"));
  assert.equal(pill.attrs["aria-label"], "12 persone");
  assert.equal(textOf(pill), "12");
});

test("Pill: il pallino è decorativo e prende il posto dell'icona; l'icona compare solo se passata", () => {
  const dot = rootOf(createElement(Pill, { dot: true, icon: "check" }, "Aperte"));
  assert.equal(byClass(dot, "ui-pill__dot")[0].attrs["aria-hidden"], "true");
  assert.equal(byTag(dot, "svg").length, 0, "con dot l'icona non si vede");

  const icon = rootOf(createElement(Pill, { icon: "check" }, "Fatto"));
  assert.equal(byTag(icon, "svg").length, 1);
  assert.equal(byClass(icon, "ui-pill__dot").length, 0);

  const plain = rootOf(createElement(Pill, null, "Solo testo"));
  assert.equal(elementsOf(plain).length, 0);
});

// ---------------------------------------------------------------------------
// 9. Icon, cx, esportazioni
// ---------------------------------------------------------------------------

test("Icon: ha sempre la classe ui-icon e conserva quella passata", () => {
  const plain = rootOf(createElement(Icon, { name: "home" }));
  assert.equal(plain.tag, "svg");
  assert.deepEqual(classSet(plain.attrs.class), new Set(["ui-icon"]));

  const custom = classSet(rootOf(createElement(Icon, { name: "home", className: "mia-classe altra" })).attrs.class);
  assert.deepEqual(custom, new Set(["ui-icon", "mia-classe", "altra"]));

  for (const className of ["", undefined]) {
    assert.ok(classSet(rootOf(createElement(Icon, { name: "home", className })).attrs.class).has("ui-icon"));
  }
});

test("Icon: decorativa di default; con un titolo e decorative=false diventa un'immagine con nome", () => {
  const decorative = rootOf(createElement(Icon, { name: "alert" }));
  assert.equal(decorative.attrs["aria-hidden"], "true");
  assert.ok(!has(decorative, "role"));

  const named = rootOf(createElement(Icon, { name: "alert", decorative: false, title: "Attenzione" }));
  assert.equal(named.attrs.role, "img");
  assert.ok(!has(named, "aria-hidden"));
  assert.equal(textOf(byTag(named, "title")[0]), "Attenzione");
});

test("Icon: le icone che i componenti usano esistono davvero (nessuna cade nel segno più di riserva)", () => {
  const pathOf = (name) =>
    byTag(rootOf(createElement(Icon, { name })), "path")
      .map((path) => path.attrs.d)
      .join("|");
  const fallback = pathOf("nome-che-non-esiste");
  const used = ["info", "check", "alert", "arrow-right", "arrow-left"];
  for (const name of used) assert.notEqual(pathOf(name), fallback, `${name} manca da AppIcon`);
  assert.equal(new Set(used.map(pathOf)).size, used.length, "icone distinte");
});

test("cx: unisce le classi vere e scarta false, null, undefined e stringhe vuote", () => {
  assert.equal(cx("a", false, null, undefined, "", "b", 0 > 1 && "c"), "a b");
  assert.equal(cx(), "");
});

test("l'indice esporta i componenti del brief e nient'altro che si possa confondere con le pagine vecchie", async () => {
  const exports = await import("../src/components/ui/index.ts");
  assert.deepEqual(
    Object.keys(exports).sort(),
    ["Button", "ButtonLink", "Card", "EmptyState", "Icon", "Notice", "PageHeader", "Pill", "buttonClassName"],
  );
});
