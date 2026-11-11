import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { DEMO_TITLE_PREFIX, formatPageTitle } from "../src/utils/pageTitle.ts";

// Sullo staging (demo) il titolo della scheda porta il prefisso "[DEMO] ";
// in produzione il titolo resta com'è.
test("il prefisso demo è «[DEMO] » con lo spazio finale", () => {
  assert.equal(DEMO_TITLE_PREFIX, "[DEMO] ");
});

test("sullo staging il titolo prende il prefisso demo", () => {
  assert.equal(formatPageTitle("Attività", "staging"), "[DEMO] Attività");
});

test("in produzione, senza ambiente o con ambiente vuoto il titolo non cambia", () => {
  assert.equal(formatPageTitle("Attività", "production"), "Attività");
  assert.equal(formatPageTitle("Attività", undefined), "Attività");
  assert.equal(formatPageTitle("Attività", ""), "Attività");
});

test("un titolo che ha già il prefisso non lo prende due volte", () => {
  assert.equal(formatPageTitle("[DEMO] Attività", "staging"), "[DEMO] Attività");
  // Ripetere la funzione sul proprio risultato non cambia nulla.
  const once = formatPageTitle("Attività", "staging");
  assert.equal(formatPageTitle(once, "staging"), once);
});

test("fuori dallo staging il prefisso già presente non viene toccato", () => {
  assert.equal(formatPageTitle("[DEMO] Attività", "production"), "[DEMO] Attività");
});

// Titolo vuoto sullo staging: la scheda deve comunque dire che è la demo, e il
// risultato non deve mai avere il prefisso doppio.
test("titolo vuoto sullo staging: resta riconoscibile come demo, senza doppio prefisso", () => {
  const result = formatPageTitle("", "staging");
  assert.ok(result.startsWith("[DEMO]"), `atteso un titolo che inizia con [DEMO], ottenuto «${result}»`);
  assert.equal(formatPageTitle(result, "staging"), result);
  assert.equal(formatPageTitle("", "production"), "");
});

// Guardia contro la ricaduta: ogni `document.title = …` sotto src/ deve passare
// da pageTitle(...) oppure ripristinare il titolo salvato prima (previousTitle).
const SRC_DIR = fileURLToPath(new URL("../src/", import.meta.url));
const REPO_DIR = path.dirname(SRC_DIR.replace(/\/$/, ""));

function listSourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

// Restituisce le assegnazioni a document.title non ammesse, con file e riga.
export function findBareTitleAssignments(source, file = "<memoria>") {
  const violations = [];
  // Anche su più righe (`document.title =\n  "x"`); `==` e `===` sono confronti.
  const assignment = /document\.title\s*(\+?=)(?!=)\s*([^;\n]*)/g;
  let match;
  while ((match = assignment.exec(source)) !== null) {
    const lineStart = source.lastIndexOf("\n", match.index) + 1;
    const prefix = source.slice(lineStart, match.index).trim();
    // Righe di commento: non sono codice.
    if (prefix.startsWith("//") || prefix.startsWith("*") || prefix.startsWith("/*")) continue;

    const operator = match[1];
    const value = match[2].trim();
    const allowed = operator === "=" && (/^pageTitle\(/.test(value) || /^previousTitle\s*$/.test(value));
    if (!allowed) {
      const line = source.slice(0, match.index).split("\n").length;
      violations.push(`${file}:${line}  document.title ${operator} ${value}`);
    }
  }
  return violations;
}

test("la guardia segnala un document.title assegnato a una stringa nuda", () => {
  assert.equal(findBareTitleAssignments('document.title = "Ciao";').length, 1);
  assert.equal(findBareTitleAssignments("document.title = title;").length, 1);
  assert.equal(findBareTitleAssignments('document.title =\n  "Ciao";').length, 1);
  assert.equal(findBareTitleAssignments("document.title += ' x';").length, 1);
  assert.match(findBareTitleAssignments('\n\ndocument.title = "Ciao";', "a/b.tsx")[0], /^a\/b\.tsx:3 /);
});

test("la guardia accetta pageTitle(...), il ripristino del titolo salvato e i confronti", () => {
  assert.deepEqual(findBareTitleAssignments("document.title = pageTitle(title);"), []);
  assert.deepEqual(findBareTitleAssignments("document.title = previousTitle;"), []);
  assert.deepEqual(findBareTitleAssignments("if (document.title === 'x') {}"), []);
  assert.deepEqual(findBareTitleAssignments('// document.title = "x";'), []);
});

test("ogni assegnazione a document.title sotto src/ passa da pageTitle() o ripristina il titolo salvato", () => {
  const violations = [];
  for (const file of listSourceFiles(SRC_DIR)) {
    violations.push(...findBareTitleAssignments(readFileSync(file, "utf8"), path.relative(REPO_DIR, file)));
  }
  assert.deepEqual(
    violations,
    [],
    `document.title assegnato senza pageTitle() (perde il prefisso [DEMO] sullo staging):\n${violations.join("\n")}`,
  );
});
