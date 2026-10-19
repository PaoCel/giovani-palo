import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Guardia contro i dialoghi del browser (`window.confirm`, `window.alert`,
// `window.prompt` e le forme nude `confirm(`, `alert(`, `prompt(`) in `src/`.
// La spec (docs/FLUSSO_GENITORE.md) dice "mai un dialogo del browser": nel
// pannello e in alcune PWA non compare, e chi lo chiude senza leggere non lascia
// traccia. Le conferme stanno dentro la pagina (ConfirmSheet, GalleryConfirmSheet).
//
// Restano dialoghi del browser solo nelle pagine admin, in attesa di una
// decisione di Paolo. Sono in una allowlist con il NUMERO esatto di occorrenze
// per file: un dialogo nuovo in admin fa diventare il test rosso, e uno tolto
// obbliga ad abbassare il numero (così la lista non invecchia).
//
// La ricerca non è una regex sul testo ma una visita dell'albero del codice
// (compilatore TypeScript del progetto): commenti, stringhe e testo JSX non
// contano, `service.confirm(` e `async confirm(` neanche, e le righe spezzate
// si contano una volta sola.
//
// Comando: node --test tests/browserDialogs.test.mjs

// ---------------------------------------------------------------------------
// Il cercatore
// ---------------------------------------------------------------------------

const DIALOG_NAMES = new Set(["confirm", "alert", "prompt"]);
// Gli oggetti globali da cui si raggiunge il dialogo.
const GLOBAL_OBJECTS = new Set(["window", "globalThis", "self"]);

// (window as any).confirm, window!.confirm: si guarda sotto il rivestimento.
function unwrap(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isGlobalObject(node) {
  const inner = unwrap(node);
  return ts.isIdentifier(inner) && GLOBAL_OBJECTS.has(inner.text);
}

// Ritorna [{ line, text }] con una voce per ogni uso di un dialogo del browser.
export function findBrowserDialogs(source, fileName = "file.tsx") {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found = [];
  const add = (node) => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    found.push({ line: line + 1, text: node.getText(sourceFile).replace(/\s+/gu, " ") });
  };

  const visit = (node) => {
    if (
      // window.confirm, window?.confirm, globalThis.alert, self.prompt
      ts.isPropertyAccessExpression(node) &&
      isGlobalObject(node.expression) &&
      DIALOG_NAMES.has(node.name.text)
    ) {
      add(node);
    } else if (
      // window["confirm"]
      ts.isElementAccessExpression(node) &&
      isGlobalObject(node.expression) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      DIALOG_NAMES.has(node.argumentExpression.text)
    ) {
      add(node);
    } else if (
      // confirm("x"), alert("x"), prompt("x") nudi
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      DIALOG_NAMES.has(node.expression.text)
    ) {
      add(node);
    } else if (
      // const { confirm } = window;
      ts.isBindingElement(node) &&
      ts.isObjectBindingPattern(node.parent) &&
      ts.isVariableDeclaration(node.parent.parent) &&
      node.parent.parent.initializer &&
      isGlobalObject(node.parent.parent.initializer) &&
      DIALOG_NAMES.has((node.propertyName ?? node.name).text)
    ) {
      add(node);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

const dialoghi = (count) => `${count} ${count === 1 ? "dialogo" : "dialoghi"} del browser`;

// Confronta i conteggi trovati con l'allowlist; ritorna i problemi, uno per riga.
export function checkDialogs(foundByFile, allowlist) {
  const problems = [];
  const files = new Set([...foundByFile.keys(), ...Object.keys(allowlist)]);

  for (const file of [...files].sort()) {
    const found = foundByFile.get(file) ?? 0;
    const allowed = allowlist[file] ?? 0;
    if (found === allowed) continue;

    if (found > allowed && !(file in allowlist)) {
      problems.push(
        `${file}: ${dialoghi(found)}. Gli utenti non ne vedono mai: usa ConfirmSheet ` +
          "(docs/FLUSSO_GENITORE.md). Nelle pagine admin chiedi a Paolo prima di aggiungerne.",
      );
    } else if (found > allowed) {
      problems.push(
        `${file}: ${dialoghi(found)}, ammessi ${allowed}. Chiedi a Paolo prima di ` +
          "aggiungerne un altro in admin: l'alternativa è ConfirmSheet.",
      );
    } else {
      problems.push(
        `${file}: ${dialoghi(found)}, nell'allowlist ne risultano ${allowed}. ` +
          "Bene: abbassa il numero (o togli il file) in tests/browserDialogs.test.mjs.",
      );
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// La guardia sa riconoscere un dialogo
// ---------------------------------------------------------------------------

const countOf = (source, fileName) => findBrowserDialogs(source, fileName).length;

test("il cercatore prende window.confirm, window.alert e window.prompt", () => {
  assert.equal(countOf('window.confirm("x");'), 1);
  assert.equal(countOf('window.alert("x");'), 1);
  assert.equal(countOf('window.prompt("x");'), 1);
  assert.equal(countOf('const ok = window.confirm("Eliminare il post?");'), 1);
  assert.equal(countOf('if (!window.confirm("x")) return;'), 1);
});

test("il cercatore prende confirm, alert e prompt nudi", () => {
  assert.equal(countOf('if (!confirm("x")) return;'), 1);
  assert.equal(countOf('alert("x");'), 1);
  assert.equal(countOf('const nome = prompt("Come ti chiami?");'), 1);
  assert.equal(countOf('await confirm("x");'), 1);
  assert.equal(countOf('const ok = confirm("x") && confirm("y");'), 2);
});

test("il cercatore prende le forme meno ovvie", () => {
  for (const source of [
    'globalThis.confirm("x");',
    'self.alert("x");',
    'window["confirm"]("x");',
    "window['prompt']('x');",
    'window.confirm?.("x");',
    '(window as any).confirm("x");',
    'window!.alert("x");',
    '(window as unknown as Window).prompt("x");',
    "const { confirm } = window;",
    "const { alert: avviso } = globalThis;",
    "const sceglie = window.confirm;",
  ]) {
    assert.equal(countOf(source, "forma.ts"), 1, source);
  }
});

test("il cercatore conta una volta sola una chiamata spezzata su più righe, dalla riga in cui comincia", () => {
  const source = [
    "function f() {",
    "  const confirmed = window.confirm(",
    '    "Rimuovere questa pattuglia e salvare?",',
    "  );",
    "  return confirmed;",
    "}",
  ].join("\n");
  const found = findBrowserDialogs(source, "multi.ts");
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 2);
});

test("il cercatore dà il numero di riga di ogni occorrenza", () => {
  const source = ['alert("a");', "", 'window.confirm("b");', "", "if (prompt('c')) {}"].join("\n");
  assert.deepEqual(
    findBrowserDialogs(source, "righe.ts").map((item) => item.line),
    [1, 3, 5],
  );
});

test("il cercatore funziona anche in un file .tsx con testo JSX e apostrofi", () => {
  const source = [
    "export function Pagina() {",
    "  return (",
    "    <div>",
    "      <p>L'iscrizione è annullata, l'attività resta.</p>",
    '      <button onClick={() => alert("x")}>Annulla l\'iscrizione</button>',
    "      <button onClick={() => window.confirm('y')}>Elimina</button>",
    "    </div>",
    "  );",
    "}",
  ].join("\n");
  assert.deepEqual(
    findBrowserDialogs(source, "Pagina.tsx").map((item) => item.line),
    [5, 6],
  );
});

test("il cercatore non prende i metodi di un oggetto", () => {
  for (const source of [
    "await parentAuthorizationService.confirm({ id });",
    "parentAuthorizationService.confirm(input);",
    "this.confirm(input);",
    "service.alert(x);",
    "deferredPrompt.prompt();",
    "const result = await deferredPrompt.prompt();",
    "window.location.assign(url);",
    "window.open(url);",
    "window.addEventListener('keydown', onKey, true);",
    "const dialog = props.confirm;",
    "options?.confirm?.(x);",
  ]) {
    assert.equal(countOf(source, "metodi.ts"), 0, source);
  }
});

test("il cercatore non prende le definizioni", () => {
  for (const source of [
    "export const service = { async confirm(input: ConfirmInput): Promise<void> {} };",
    "class Servizio { async confirm(input: ConfirmInput) {} }",
    "class Servizio { confirm = async () => {}; }",
    "const azioni = { confirm: true, alert: false, prompt: null };",
    "interface Props { confirm: () => void; alert?: string }",
    "type Servizio = { prompt(): Promise<void> };",
    "function alert() {}",
    "const { confirm } = props;",
    "const { alert } = useToast();",
  ]) {
    assert.equal(countOf(source, "definizioni.ts"), 0, source);
  }
});

test("il cercatore non prende nomi che contengono la parola", () => {
  for (const source of [
    "handleConfirm();",
    "onConfirm();",
    "confirmed = true;",
    "showAlert(x);",
    "alertCount + 1;",
    "promptUser(x);",
    "const ok = isConfirmed(x);",
    "await confirmRegistration(id);",
  ]) {
    assert.equal(countOf(source, "nomi.ts"), 0, source);
  }
});

test("il cercatore non prende commenti, stringhe e testo JSX", () => {
  const source = [
    "// Conferma dentro la pagina al posto di window.confirm(",
    "/* niente alert('x') né window.prompt('y') */",
    "/**",
    " * if (!confirm('x')) return;",
    " */",
    'const a = "window.confirm(\\"x\\")";',
    "const b = 'alert(\"x\")';",
    "const c = `prompt(${x})`;",
    "export const Testo = () => <p>confirm(&quot;x&quot;) e window.alert(1)</p>;",
  ].join("\n");
  assert.equal(countOf(source, "testo.tsx"), 0);
});

test("il cercatore, su un file vuoto o senza dialoghi, non trova niente", () => {
  assert.deepEqual(findBrowserDialogs(""), []);
  assert.deepEqual(findBrowserDialogs("export const x = 1;\n"), []);
});

// ---------------------------------------------------------------------------
// Il confronto con l'allowlist
// ---------------------------------------------------------------------------

test("checkDialogs: i conteggi uguali all'allowlist non danno problemi", () => {
  const found = new Map([["src/pages/admin/A.tsx", 2]]);
  assert.deepEqual(checkDialogs(found, { "src/pages/admin/A.tsx": 2 }), []);
  assert.deepEqual(checkDialogs(new Map(), {}), []);
});

test("checkDialogs: un dialogo in un file fuori dall'allowlist dice di chiedere a Paolo e di usare ConfirmSheet", () => {
  const problems = checkDialogs(new Map([["src/pages/me/Nuova.tsx", 1]]), {});
  assert.equal(problems.length, 1);
  assert.match(problems[0], /src\/pages\/me\/Nuova\.tsx/u);
  assert.match(problems[0], /Paolo/u);
  assert.match(problems[0], /ConfirmSheet/u);
});

test("checkDialogs: un dialogo in più in un file dell'allowlist dice di chiedere a Paolo", () => {
  const problems = checkDialogs(new Map([["src/pages/admin/A.tsx", 3]]), { "src/pages/admin/A.tsx": 2 });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /src\/pages\/admin\/A\.tsx/u);
  assert.match(problems[0], /Paolo/u);
});

test("checkDialogs: un dialogo in meno obbliga ad abbassare il numero", () => {
  const problems = checkDialogs(new Map([["src/pages/admin/A.tsx", 1]]), { "src/pages/admin/A.tsx": 2 });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /abbassa/u);

  // Anche se il file ne ha perso uno solo e non compare più fra i trovati.
  const none = checkDialogs(new Map(), { "src/pages/admin/A.tsx": 2 });
  assert.equal(none.length, 1);
  assert.match(none[0], /abbassa/u);
});

// ---------------------------------------------------------------------------
// Scansione di src/
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

// Dialoghi del browser ancora ammessi: solo pagine admin, finché Paolo non
// decide con cosa sostituirli. Numero ESATTO di occorrenze per file.
// Aggiungere una riga o alzare un numero richiede il via libera di Paolo.
const ADMIN_ALLOWLIST = {
  "src/pages/admin/AdminEventDetailPage.tsx": 7,
  "src/pages/admin/AdminFeedPage.tsx": 1,
  "src/components/admin/gallery/GalleryAdminPanel.tsx": 2,
  "src/components/SurveyEditor.tsx": 1,
};

// Percorsi degli utenti, ripuliti dei dialoghi del browser (task gugd-finitura-famiglia).
const USER_FILES = [
  "src/pages/me/MyActivityDetailPage.tsx",
  "src/pages/public/ParentConfirmPage.tsx",
  "src/components/QuestionsSection.tsx",
  "src/components/gallery/ActivityGallery.tsx",
  "src/components/feed/MediaLightbox.tsx",
  "src/components/gallery/ReportMediaSheet.tsx",
  // I fogli che li sostituiscono.
  "src/components/ConfirmSheet.tsx",
  "src/components/gallery/GalleryConfirmSheet.tsx",
];

function listSourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

const relativeToRoot = (file) => path.relative(ROOT, file).split(path.sep).join("/");

const files = listSourceFiles(SRC);
const dialogsByFile = new Map();
const linesByFile = new Map();
for (const file of files) {
  const found = findBrowserDialogs(readFileSync(file, "utf8"), file);
  if (found.length > 0) {
    const name = relativeToRoot(file);
    dialogsByFile.set(name, found.length);
    linesByFile.set(name, found.map((item) => item.line));
  }
}

test("la scansione vede davvero i file di src/", () => {
  // Se la scansione non vede i file, il test non prova niente.
  assert.ok(files.length > 100, `scansionati solo ${files.length} file in src/`);
  const names = files.map(relativeToRoot);
  for (const known of [...USER_FILES, ...Object.keys(ADMIN_ALLOWLIST)]) {
    assert.ok(names.includes(known), `${known} non è fra i file scansionati`);
  }
  // E il cercatore, su un file vero, trova quello che c'è: l'allowlist non è vuota per caso.
  assert.ok(dialogsByFile.size > 0, "nessun dialogo trovato: il cercatore o la scansione sono rotti");
});

test("in src/ i dialoghi del browser sono solo quelli dell'allowlist admin, in numero esatto", () => {
  const problems = checkDialogs(dialogsByFile, ADMIN_ALLOWLIST);
  assert.deepEqual(
    problems,
    [],
    `\n${problems.join("\n")}\n(righe trovate: ${JSON.stringify(Object.fromEntries(linesByFile))})`,
  );
});

test("l'allowlist ammette soltanto i quattro file admin", () => {
  assert.deepEqual(Object.keys(ADMIN_ALLOWLIST).sort(), [
    "src/components/SurveyEditor.tsx",
    "src/components/admin/gallery/GalleryAdminPanel.tsx",
    "src/pages/admin/AdminEventDetailPage.tsx",
    "src/pages/admin/AdminFeedPage.tsx",
  ]);
  for (const file of Object.keys(ADMIN_ALLOWLIST)) {
    assert.ok(existsSync(path.join(ROOT, file)), `${file} non esiste più: toglilo dall'allowlist`);
    assert.ok(Number.isInteger(ADMIN_ALLOWLIST[file]) && ADMIN_ALLOWLIST[file] > 0, file);
  }
});

test("i percorsi degli utenti non hanno nessun dialogo del browser", () => {
  for (const file of USER_FILES) {
    const absolute = path.join(ROOT, file);
    assert.ok(existsSync(absolute), `${file} non esiste`);
    assert.ok(!(file in ADMIN_ALLOWLIST), `${file} non può stare nell'allowlist admin`);

    const found = findBrowserDialogs(readFileSync(absolute, "utf8"), absolute);
    assert.deepEqual(
      found,
      [],
      `${file} ha un dialogo del browser: gli utenti vedono un foglio dentro la pagina (ConfirmSheet), mai un dialogo`,
    );
  }
});

test("i componenti con un dialogo ammesso li importano solo file admin", () => {
  // Un componente comune con un dialogo lo vedrebbero anche gli utenti: l'allowlist
  // regge solo finché chi importa SurveyEditor e GalleryAdminPanel sta in admin.
  const adminOnly = ["src/components/SurveyEditor.tsx", "src/components/admin/gallery/GalleryAdminPanel.tsx"];
  const isAdminFile = (file) => file.startsWith("src/pages/admin/") || file.startsWith("src/components/admin/");

  for (const component of adminOnly) {
    const alias = "@/" + component.slice("src/".length).replace(/\.tsx$/u, "");
    const pattern = new RegExp(`from\\s+["']${alias}["']`, "u");
    const importers = files
      .map(relativeToRoot)
      .filter((file) => file !== component && pattern.test(readFileSync(path.join(ROOT, file), "utf8")));

    assert.ok(importers.length > 0, `${component}: nessun file lo importa, controlla il percorso`);
    for (const importer of importers) {
      assert.ok(
        isAdminFile(importer),
        `${importer} importa ${component}, che ha un dialogo del browser ammesso solo in admin`,
      );
    }
  }
});
