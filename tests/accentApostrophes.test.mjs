import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Guardia contro l'apostrofo al posto della lettera accentata nei testi
// italiani (e^ per è, attivita^ per attività, Gesu^ per Gesù). Uno sweep ha
// sostituito tutte le occorrenze: questo test diventa rosso se ne rientra una.
//
// Gli esempi "sbagliati" qui sotto usano ^ al posto dell'apostrofo e vengono
// convertiti a runtime con ap(), così questo file non contiene mai la forma
// vietata e non fa scattare se stesso.

const ACCENT_WORDS = [
  // -à
  "attivita", "unita", "societa", "responsabilita", "qualita", "necessita",
  "modalita", "finalita", "tracciabilita", "priorita", "portabilita", "liceita",
  "dignita", "conformita", "identita", "citta", "universita", "eta", "facolta",
  "possibilita", "disponibilita", "novita", "quantita",
  // futuri in -à
  "verra", "sara", "restera", "inviera", "comparira", "chiedera", "potra",
  "dovra", "avra", "fara", "andra", "dara", "stara",
  // monosillabi e altre parole
  "gia", "piu", "puo", "cio", "cosi", "si", "Gesu", "perche", "finche",
  "anziche", "ne", "cioe", "e",
];

// Ogni parola vale in minuscolo e con l'iniziale maiuscola (Attivita^, E^).
const WORD_PATTERN = ACCENT_WORDS.map(
  (word) => `[${word[0].toLowerCase()}${word[0].toUpperCase()}]${word.slice(1)}`,
).join("|");

// Prima della parola: né lettera/cifra/underscore né apostrofo/virgolette
// (sono stringhe di codice), salvo l'apostrofo di elisione, cioè preceduto a
// sua volta da una lettera (dell'attivita^). Dopo la parola: un apostrofo non
// seguito da lettera, cifra o underscore.
// Secondo ramo: una stringa tra virgolette doppie che COMINCIA con la forma
// sbagliata ("E^ tardi", "Attivita^ del campo") è un testo, non codice, a meno
// che l'apostrofo chiuda la stringa ("attivita^").
const DETECTOR = new RegExp(
  `(?:(?<![\\p{L}\\p{N}_'"])|(?<=\\p{L}'))(${WORD_PATTERN})'(?![\\p{L}\\p{N}_])` +
    `|(?<=")(${WORD_PATTERN})'(?=[\\s.,;:!?)\\]])`,
  "gu",
);

function findAccentApostrophes(text) {
  const matches = [];
  let line = 1;
  let cursor = 0;
  for (const match of text.matchAll(DETECTOR)) {
    for (let i = text.indexOf("\n", cursor); i !== -1 && i < match.index; i = text.indexOf("\n", i + 1)) {
      line += 1;
    }
    cursor = match.index;
    matches.push({ line, word: match[1] ?? match[2] });
  }
  return matches;
}

const ap = (text) => text.replaceAll("^", "'");
const words = (text) => findAccentApostrophes(ap(text)).map((m) => m.word);

// --- Rilevatore (unit) ------------------------------------------------------

const MUST_FLAG = [
  ["Non e^ valido", ["e"]],
  ["E^ uno strumento", ["E"]],
  ["dell^attivita^ scelta", ["attivita"]],
  ["la tua unita^.", ["unita"]],
  ["Gesu^ Cristo", ["Gesu"]],
  ["perche^", ["perche"]],
  ["non c^e^ ne^ altro", ["e", "ne"]],
  ["Piu^ tardi", ["Piu"]],
  ["cosi^,", ["cosi"]],
  ["Attivita^ del campo", ["Attivita"]],
  ["Identita^ e Unita^", ["Identita", "Unita"]],
  ["Finche^ non arriva", ["Finche"]],
  ["Non verra^ e sara^ tardi", ["verra", "sara"]],
  ["ci sara^\nma non cio^", ["sara", "cio"]],
  // testo tra virgolette doppie che comincia con la forma sbagliata
  ['label: "Attivita^ del campo"', ["Attivita"]],
  ['<p>"E^ tardi"</p>', ["E"]],
  ['t("Gesu^ Cristo")', ["Gesu"]],
];

for (const [input, expected] of MUST_FLAG) {
  test(`rileva: ${JSON.stringify(ap(input))}`, () => {
    assert.deepEqual(words(input), expected);
  });
}

const MUST_NOT_FLAG = [
  "un po^ di tempo",
  "c^è",
  "com^è andata",
  "l^attivita",
  "^attivita^",
  "parent^",
  "type: ^e^",
  "è già più unità",
  // la parola deve essere intera: niente lettere, cifre o underscore prima
  "parente^ e abate^",
  "x_attivita^ e 1e^",
  // l'apostrofo non deve introdurre un'altra parola
  "attivita^a e e^8 e si^_x",
  // apostrofo o virgolette prima della parola senza elisione: stringa di codice
  'const k = "attivita^"',
  "[^si^, ^no^]",
  // parole non in elenco
  "dell^anno e l^ora",
];

for (const input of MUST_NOT_FLAG) {
  test(`non rileva: ${JSON.stringify(ap(input))}`, () => {
    assert.deepEqual(words(input), []);
  });
}

test("ogni parola dell'elenco è rilevata, in minuscolo e maiuscolo iniziale", () => {
  for (const word of ACCENT_WORDS) {
    const lower = word[0].toLowerCase() + word.slice(1);
    const upper = word[0].toUpperCase() + word.slice(1);
    for (const form of [lower, upper]) {
      assert.deepEqual(words(`prima ${form}^ dopo`), [form], form);
    }
  }
});

test("il numero di riga è 1-based e conta i ritorni a capo", () => {
  const text = ap("riga uno\nriga due e^ qui\n\nquarta: cosi^\r\nquinta: Gesu^");
  assert.deepEqual(findAccentApostrophes(text), [
    { line: 2, word: "e" },
    { line: 4, word: "cosi" },
    { line: 5, word: "Gesu" },
  ]);
});

// --- Scansione del repo -----------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELF = path
  .relative(ROOT, fileURLToPath(import.meta.url))
  .split(path.sep)
  .join("/");

const SKIPPED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".ico", ".pdf",
  ".woff", ".woff2", ".ttf", ".lock",
]);
// Nomi ufficiali dei comuni (Castelnovo ne^ Monti, Cappella de^ Picenardi, Vo^).
const SKIPPED_FILES = new Set([
  "package-lock.json",
  "src/config/italianMunicipalityOptions.json",
  SELF,
]);

function listTrackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return output.split("\0").filter(Boolean);
}

function isSkipped(file) {
  return (
    SKIPPED_FILES.has(file) ||
    path.posix.basename(file) === "package-lock.json" ||
    SKIPPED_EXTENSIONS.has(path.posix.extname(file).toLowerCase())
  );
}

// Ritorna il testo del file, o null se va saltato (mancante, non regolare,
// binario).
function readTextFile(file) {
  const fullPath = path.join(ROOT, file);
  try {
    if (!statSync(fullPath).isFile()) return null;
    const buffer = readFileSync(fullPath);
    if (buffer.includes(0)) return null;
    return buffer.toString("utf8");
  } catch {
    return null;
  }
}

const MAX_REPORTED = 30;

test("nei file tracciati non ci sono apostrofi al posto degli accenti", () => {
  const offenders = [];
  let scanned = 0;
  for (const file of listTrackedFiles()) {
    if (isSkipped(file)) continue;
    const text = readTextFile(file);
    if (text === null) continue;
    scanned += 1;
    for (const { line, word } of findAccentApostrophes(text)) {
      offenders.push(`${file}:${line} ${word}'`);
    }
  }

  assert.ok(scanned > 0, "nessun file tracciato scansionato: git ls-files non ha restituito nulla?");

  if (offenders.length > 0) {
    const shown = offenders.slice(0, MAX_REPORTED);
    const rest = offenders.length - shown.length;
    assert.fail(
      [
        `Trovati ${offenders.length} apostrofi al posto della lettera accentata (scrivi è, à, ù, ì, ò):`,
        ...shown.map((entry) => `  ${entry}`),
        ...(rest > 0 ? [`  ... e altre ${rest}`] : []),
      ].join("\n"),
    );
  }
});

test("questo file di test non contiene la forma vietata", () => {
  const text = readTextFile(SELF);
  assert.notEqual(text, null, `impossibile leggere ${SELF}`);
  assert.deepEqual(findAccentApostrophes(text), []);
});
