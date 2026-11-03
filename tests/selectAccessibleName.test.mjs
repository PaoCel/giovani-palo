import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Guardia sul nome accessibile delle <select> dentro una <label>.
//
// Una <select> annidata nella sua <label> prende come nome accessibile anche il
// testo di tutte le opzioni ("Tipo Stelline Risposta aperta N campi"), e i
// locator dei test e gli screen reader leggono quel nome sporco. La correzione
// è sempre la stessa (esempio: src/components/activities/ActivityProgram.tsx,
// la select "scegliPersona"):
//
//   const labelId = useId();
//   <label className="field">
//     <span className="field__label" id={labelId}>Testo</span>
//     <select aria-labelledby={labelId} ...>
//
// Il nome diventa solo il testo della span. Il test analizza ogni src/**/*.tsx
// con il compilatore TypeScript (niente regex) e diventa rosso se una <select>
// dentro una <label> non ha né aria-labelledby né aria-label.
//
// Comando: node --test tests/selectAccessibleName.test.mjs
//
// Controlli (funzione `findSelectNameIssues`, esportata e provata sotto su
// stringhe TSX in linea):
//
// 1. "nome-mancante": una <select> con un antenato <label> senza aria-labelledby
//    e senza aria-label.
//
// 2. "id-mancante": una <select> in una <label> con aria-labelledby, ma la
//    <label> non contiene l'elemento a cui punta. Il controllo è statico e
//    confronta il TESTO dell'espressione, senza spazi né virgole finali: quello di aria-labelledby
//    (`labelId`, `fieldLabelId(key)`, `${ids}-unita`, "tipo") deve comparire
//    identico dentro la label, in uno di questi posti:
//      - il valore dell'attributo `id` di un elemento JSX (<span id={labelId}>);
//      - la prop `id` o `labelId` di un componente (<Label id={labelId} .../>);
//      - un argomento di una chiamata di funzione, come in
//        renderFieldLabel(label, key, required, fieldLabelId(key));
//      - il valore di una proprietà `id`/`labelId` di un oggetto passato a una
//        chiamata (renderLabel({ text, id: labelId }), anche `{ labelId }`).
//    Un id qualsiasi non basta: <span id={a}> con aria-labelledby={b} è segnalato.
//    Le stringhe valgono per il loro valore (apici singoli o doppi). Le opzioni
//    della select e le altre select della label non contano.
//
// Limiti dichiarati (analisi statica, niente tipi):
//   - una <select> con `{...props}` e senza aria-labelledby/aria-label espliciti
//     non è segnalata: la spread può portare l'attributo;
//   - una <select> resa da un componente e usata dentro una <label> da un altro
//     file non si vede (qui si guarda solo l'albero JSX di ogni file);
//   - un'aria-labelledby che punta a un elemento FUORI dalla <label> è segnalata
//     da "id-mancante": la forma voluta è la span con id dentro la label.

const SELECT = "select";
const LABEL = "label";

function attributeName(attribute) {
  return ts.isJsxAttribute(attribute) ? attribute.name.getText() : null;
}

function findAttribute(opening, name) {
  return opening.attributes.properties.find((attribute) => attributeName(attribute) === name);
}

// Forma confrontabile di un'espressione: senza parentesi esterne, senza spazi e
// senza virgole finali; una stringa vale per il suo valore, qualunque siano gli apici.
function canonical(node) {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  if (ts.isStringLiteralLike(current)) {
    return JSON.stringify(current.text);
  }
  // Senza spazi e senza la virgola finale che il formattatore aggiunge quando la
  // chiamata va a capo: fieldLabelId(\n `x`,\n) è fieldLabelId(`x`).
  return current.getText().replace(/\s+/gu, "").replace(/,(?=[)\]}])/gu, "");
}

// Forma confrontabile del valore di un attributo JSX: {expr} senza graffe,
// oppure la stringa letterale. Vuota se l'attributo non ha valore.
function attributeValue(attribute) {
  const initializer = attribute.initializer;
  if (!initializer) return "";
  if (ts.isJsxExpression(initializer)) {
    return initializer.expression ? canonical(initializer.expression) : "";
  }
  return canonical(initializer);
}

function tagNameOf(element) {
  const opening = ts.isJsxElement(element) ? element.openingElement : element;
  return opening.tagName.getText();
}

function openingOf(node) {
  if (ts.isJsxElement(node)) return node.openingElement;
  if (ts.isJsxSelfClosingElement(node)) return node;
  return null;
}

const isIntrinsicTag = (tag) => /^[a-z]/u.test(tag) && !tag.includes(".");

// Visita i discendenti di `root` saltando l'albero delle <select> (le opzioni e
// le altre select non forniscono l'id della label).
function someOutsideSelects(root, predicate) {
  let found = false;
  const visit = (node) => {
    if (found) return;
    const opening = openingOf(node);
    if (opening && tagNameOf(node) === SELECT) return;
    if (predicate(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(root, visit);
  return found;
}

// Nome di una proprietà di oggetto che porta un id: `id` o `labelId`.
function isIdProperty(property) {
  return property.name !== undefined && ["id", "labelId"].includes(property.name.getText());
}

// `expected` è la forma canonica dell'aria-labelledby della select.
function labelSuppliesId(label, expected) {
  if (!expected) return false;
  return someOutsideSelects(label, (node) => {
    const opening = openingOf(node);
    if (opening) {
      const component = !isIntrinsicTag(tagNameOf(node));
      return opening.attributes.properties.some((attribute) => {
        const name = attributeName(attribute);
        if (name !== "id" && !(component && name === "labelId")) return false;
        return attributeValue(attribute) === expected;
      });
    }
    if (ts.isCallExpression(node)) {
      return node.arguments.some((argument) => {
        if (canonical(argument) === expected) return true;
        if (!ts.isObjectLiteralExpression(argument)) return false;
        return argument.properties.some((property) => {
          if (!isIdProperty(property)) return false;
          if (ts.isShorthandPropertyAssignment(property)) return property.name.getText() === expected;
          return ts.isPropertyAssignment(property) && canonical(property.initializer) === expected;
        });
      });
    }
    return false;
  });
}

/**
 * Analizza un sorgente TSX e ritorna le <select> annidate in una <label> con un
 * problema di nome accessibile.
 *
 * @param {string} source testo del file .tsx
 * @param {string} [fileName] solo per il parser
 * @returns {{ line: number, kind: "nome-mancante" | "id-mancante" }[]}
 */
export function findSelectNameIssues(source, fileName = "inline.tsx") {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const issues = [];
  let selectsInLabel = 0;
  let selects = 0;

  const visit = (node, label) => {
    const opening = openingOf(node);
    let nextLabel = label;
    if (opening && ts.isJsxElement(node) && tagNameOf(node) === LABEL) nextLabel = node;

    if (opening && tagNameOf(node) === SELECT) {
      selects += 1;
      if (label) {
        selectsInLabel += 1;
        const labelledby = findAttribute(opening, "aria-labelledby");
        const ariaLabel = findAttribute(opening, "aria-label");
        const hasSpread = opening.attributes.properties.some(ts.isJsxSpreadAttribute);
        const line = sourceFile.getLineAndCharacterOfPosition(opening.getStart(sourceFile)).line + 1;
        if (!labelledby && !ariaLabel) {
          if (!hasSpread) issues.push({ line, kind: "nome-mancante" });
        } else if (labelledby && !ariaLabel && !labelSuppliesId(label, attributeValue(labelledby))) {
          issues.push({ line, kind: "id-mancante" });
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, nextLabel));
  };
  visit(sourceFile, null);

  return Object.assign(issues, { selects, selectsInLabel });
}

const kinds = (source) => findSelectNameIssues(source).map((issue) => issue.kind);

// --- Rilevatore (unit) ------------------------------------------------------

test("segnala una select nuda dentro una label", () => {
  const source = `
    export function A() {
      return (
        <label className="field">
          <span>Tipo</span>
          <select className="input" value={v} onChange={f}>
            <option value="a">A</option>
          </select>
        </label>
      );
    }`;
  assert.deepEqual(findSelectNameIssues(source).map(({ line, kind }) => ({ line, kind })), [
    { line: 6, kind: "nome-mancante" },
  ]);
});

test("segnala anche la select self-closing, in un ramo condizionale e dentro un map", () => {
  assert.deepEqual(kinds(`const a = <label>Tipo<select /></label>;`), ["nome-mancante"]);
  assert.deepEqual(
    kinds(`const a = <label>{ok ? <select value="" /> : null}</label>;`),
    ["nome-mancante"],
  );
  assert.deepEqual(
    kinds(`const a = <label>{items.map((i) => <select key={i} />)}</label>;`),
    ["nome-mancante"],
  );
  // La label può stare lontana: la select è annidata in div e fragment.
  assert.deepEqual(
    kinds(`const a = <label><div><><span>x</span><select></select></></div></label>;`),
    ["nome-mancante"],
  );
});

test("segnala ogni select nuda, con la sua riga", () => {
  const source = [
    "const a = (",                                     // 1
    "  <div>",                                         // 2
    "    <label><span>Uno</span><select /></label>",   // 3
    "    <label>",                                     // 4
    "      Due",                                       // 5
    "      <select aria-label=\"Due\" />",             // 6 (ok)
    "      <select />",                                // 7
    "    </label>",                                    // 8
    "  </div>",                                        // 9
    ");",                                              // 10
  ].join("\n");
  assert.deepEqual(findSelectNameIssues(source).map(({ line }) => line), [3, 7]);
});

test("non segnala una select con aria-labelledby e la span con id", () => {
  assert.deepEqual(
    kinds(`
      const a = (
        <label className="field">
          <span className="field__label" id={labelId}>Tipo</span>
          <select aria-labelledby={labelId}><option>A</option></select>
        </label>
      );`),
    [],
  );
});

test("non segnala una select con aria-label o con aria-label e aria-labelledby", () => {
  assert.deepEqual(kinds(`const a = <label>Piano<select aria-label="Piano" /></label>;`), []);
  assert.deepEqual(kinds(`const a = <label><select aria-label={name} /></label>;`), []);
  assert.deepEqual(
    kinds(`const a = <label><select aria-label="x" aria-labelledby={id} /></label>;`),
    [],
  );
});

test("non segnala una label htmlFor sorella della select, né una select fuori da ogni label", () => {
  assert.deepEqual(
    kinds(`
      const a = (
        <div>
          <label htmlFor={id}>Tipo</label>
          <select id={id}><option>A</option></select>
        </div>
      );`),
    [],
  );
  assert.deepEqual(kinds(`const a = <div><select /></div>;`), []);
  assert.deepEqual(kinds(`const a = <select aria-label="x" />;`), []);
  // Un tag con il nome di una label ma di un altro componente non è una label.
  assert.deepEqual(kinds(`const a = <Label><select /></Label>;`), []);
});

test("la label deve contenere l'id a cui punta aria-labelledby", () => {
  // Nessun elemento con id nella label.
  assert.deepEqual(
    kinds(`const a = <label><span>Tipo</span><select aria-labelledby={labelId} /></label>;`),
    ["id-mancante"],
  );
  // L'id sull'opzione non conta.
  assert.deepEqual(
    kinds(`const a = <label>Tipo<select aria-labelledby={x}><option id={x}>A</option></select></label>;`),
    ["id-mancante"],
  );
  // L'id sull'elemento sorella FUORI dalla label non conta.
  assert.deepEqual(
    kinds(`const a = <div><span id={x}>Tipo</span><label><select aria-labelledby={x} /></label></div>;`),
    ["id-mancante"],
  );
  // L'id su un'altra select della stessa label non conta.
  assert.deepEqual(
    kinds(`const a = <label>Tipo<select id={x} aria-label="a" /><select aria-labelledby={x} /></label>;`),
    ["id-mancante"],
  );
});

test("un id diverso da quello di aria-labelledby non basta", () => {
  for (const source of [
    // il caso della review: span id={a}, select aria-labelledby={b}
    `<label><span id={a}>Tipo</span><select aria-labelledby={b} /></label>`,
    `<label><span id="tipo">Tipo</span><select aria-labelledby="piano" /></label>`,
    "<label><span id={`${base}-tipo`}>Tipo</span><select aria-labelledby={`${base}-piano`} /></label>",
    `<label><em id={ids.tipo}>Tipo</em><select aria-labelledby={ids.piano} /></label>`,
    // stessa funzione, argomento diverso
    `<label><span id={fieldLabelId("a")}>Tipo</span><select aria-labelledby={fieldLabelId("b")} /></label>`,
    // componente con un id diverso
    `<label><Label id={a}>Tipo</Label><select aria-labelledby={b} /></label>`,
    `<label><FieldLabel labelId={a}>Tipo</FieldLabel><select aria-labelledby={b} /></label>`,
    // chiamata con un argomento diverso, anche se nomina un id
    `<label>{renderFieldLabel(label, key, true, fieldLabelId(key))}<select aria-labelledby={fieldLabelId(other)} /></label>`,
    `<label>{renderFieldLabel(label, key, true, field.id)}<select aria-labelledby={labelId} /></label>`,
    `<label>{renderFieldLabel(label, key, true, labelId)}<select aria-labelledby={otherId} /></label>`,
    // oggetto con un id diverso
    `<label>{renderLabel({ text: label, id: a })}<select aria-labelledby={b} /></label>`,
    `<label>{renderLabel({ text: label, labelId: a })}<select aria-labelledby={b} /></label>`,
    // la prop di un componente che non si chiama id o labelId non conta, anche se il valore è uguale
    `<label><Etichetta testo="Tipo" per={labelId} /><select aria-labelledby={labelId} /></label>`,
    // un attributo id su un elemento che non è dentro la label
    `<label><select aria-labelledby={b} /></label>`,
    // aria-labelledby senza valore: niente da confrontare
    `<label><span id={a}>Tipo</span><select aria-labelledby /></label>`,
  ]) {
    assert.deepEqual(kinds(`const a = ${source};`), ["id-mancante"], source);
  }
});

test("l'id è lo stesso testo dell'aria-labelledby, su un elemento o un componente della label", () => {
  for (const source of [
    `<label><span id="tipo">Tipo</span><select aria-labelledby="tipo" /></label>`,
    // le stringhe valgono per il valore, non per gli apici
    `<label><span id='tipo'>Tipo</span><select aria-labelledby={"tipo"} /></label>`,
    "<label><span id={`${base}-tipo`}>Tipo</span><select aria-labelledby={`${base}-tipo`} /></label>",
    `<label><strong><em id={ids.tipo}>Tipo</em></strong><select aria-labelledby={ids.tipo} /></label>`,
    `<label><span id={makeId("tipo")}>Tipo</span><select aria-labelledby={makeId("tipo")} /></label>`,
    // gli spazi non contano
    `<label><span id={ fieldLabelId( "tipo" ) }>Tipo</span><select aria-labelledby={fieldLabelId("tipo")} /></label>`,
    "<label><span id={fieldLabelId(\n  `custom-${field.id}`,\n)}>Tipo</span><select aria-labelledby={fieldLabelId(`custom-${field.id}`)} /></label>",
    // componente con prop id o labelId
    `<label><Label text="Tipo" id={labelId} /><select aria-labelledby={labelId} /></label>`,
    `<label><FieldLabel labelId={labelId}>Tipo</FieldLabel><select aria-labelledby={labelId} /></label>`,
  ]) {
    assert.deepEqual(kinds(`const a = ${source};`), [], source);
  }
});

test("l'id può arrivare da una funzione che rende il testo della label", () => {
  for (const source of [
    // argomento uguale all'aria-labelledby
    `<label>{renderFieldLabel(label, key, true, labelId)}<select aria-labelledby={labelId} /></label>`,
    "<label>{renderFieldLabel(label, key, true, `${key}-label`)}<select aria-labelledby={`${key}-label`} /></label>",
    // come in RegistrationEditor.tsx: un helper che costruisce l'id, anche con un template
    `<label>{renderFieldLabel(label, key, true, fieldLabelId(key))}<select aria-labelledby={fieldLabelId(key)} /></label>`,
    "<label>{renderFieldLabel(label, key, req, fieldLabelId(`custom-${field.id}`))}<select aria-labelledby={fieldLabelId(`custom-${field.id}`)} /></label>",
    `<label>{renderFieldLabel(label, "genere", true, fieldLabelId("genere"))}<select aria-labelledby={fieldLabelId("genere")} /></label>`,
    // la chiamata dentro una prop
    `<label><Campo etichetta={renderFieldLabel(label, key, true, labelId)} /><select aria-labelledby={labelId} /></label>`,
    // oggetto con id o labelId
    `<label>{renderLabel({ text: label, id: labelId })}<select aria-labelledby={labelId} /></label>`,
    `<label>{renderLabel({ text: label, labelId })}<select aria-labelledby={labelId} /></label>`,
  ]) {
    assert.deepEqual(kinds(`const a = ${source};`), [], source);
  }
  // Una chiamata senza l'id non basta.
  assert.deepEqual(
    kinds(`const a = <label>{renderFieldLabel(label, key, true)}<select aria-labelledby={labelId} /></label>;`),
    ["id-mancante"],
  );
});

test("la select con {...props} non è segnalata, ma non nasconde le altre", () => {
  assert.deepEqual(kinds(`const a = <label>Tipo<select {...props} /></label>;`), []);
  assert.deepEqual(kinds(`const a = <label>Tipo<select {...props} /><select /></label>;`), [
    "nome-mancante",
  ]);
});

test("il conteggio distingue le select totali da quelle dentro una label", () => {
  const result = findSelectNameIssues(`
    const a = (
      <div>
        <select aria-label="a" />
        <label>Tipo<select aria-label="b" /></label>
      </div>
    );`);
  assert.equal(result.selects, 2);
  assert.equal(result.selectsInLabel, 1);
  assert.deepEqual([...result], []);
});

// --- Scansione di src/ ------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

function listTsxFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTsxFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

const REASONS = {
  "nome-mancante": "nessun aria-labelledby né aria-label",
  "id-mancante": "aria-labelledby senza un elemento con id dentro la label",
};

test("in src/ nessuna select dentro una label prende il nome dalle opzioni", () => {
  const offenders = [];
  const files = listTsxFiles(SRC);
  let selects = 0;
  let selectsInLabel = 0;

  for (const file of files) {
    const relative = path.relative(ROOT, file).split(path.sep).join("/");
    const result = findSelectNameIssues(readFileSync(file, "utf8"), relative);
    selects += result.selects;
    selectsInLabel += result.selectsInLabel;
    for (const { line, kind } of result) {
      offenders.push(`${relative}:${line} ${REASONS[kind]}`);
    }
  }

  // Se la scansione non vede i file o le select, il test non prova niente.
  assert.ok(files.length > 50, `scansionati solo ${files.length} file .tsx in src/`);
  assert.ok(selects > 0, "nessuna <select> trovata in src/: l'analisi non vede il JSX?");
  assert.ok(
    selectsInLabel > 0,
    "nessuna <select> dentro una <label> in src/: l'analisi non vede più gli antenati?",
  );

  if (offenders.length > 0) {
    assert.fail(
      [
        `Trovate ${offenders.length} <select> dentro una <label> che prendono il nome accessibile anche dal testo delle opzioni:`,
        ...offenders.map((entry) => `  ${entry}`),
        "Correzione: useId() + id sulla span del testo della label + aria-labelledby sulla select,",
        "come in src/components/activities/ActivityProgram.tsx (select \"scegliPersona\").",
      ].join("\n"),
    );
  }
});
