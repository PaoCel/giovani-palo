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
// Vale per l'apostrofo ASCII e per le entità HTML che lo scrivono nel JSX.
//
// Gli esempi "sbagliati" qui sotto usano ^ al posto dell'apostrofo, {apos} al
// posto dell'entità nominale e {39} al posto di quella numerica: vengono
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

// L'apostrofo è quello ASCII oppure l'entità HTML nominale o numerica (JSX).
const APOSTROPHE = "(?:'|&apos;|&#39;)";

// Prima della parola: né lettera/cifra/underscore né apostrofo/virgolette
// (sono stringhe di codice), né un'entità-apostrofo, salvo l'apostrofo di
// elisione, cioè preceduto a sua volta da una lettera (dell'attivita^, e anche
// con l'entità al posto del primo apostrofo). Dopo la parola: un apostrofo (o
// entità) non seguito da lettera, cifra o underscore.
// Secondo ramo: una stringa tra virgolette doppie che COMINCIA con la forma
// sbagliata ("E^ tardi", "Attivita^ del campo") è un testo, non codice, a meno
// che l'apostrofo chiuda la stringa ("attivita^").
const DETECTOR = new RegExp(
  `(?:(?<![\\p{L}\\p{N}_'"])(?<!&apos;)(?<!&#39;)|(?<=\\p{L}${APOSTROPHE}))` +
    `(${WORD_PATTERN})(${APOSTROPHE})(?![\\p{L}\\p{N}_])` +
    `|(?<=")(${WORD_PATTERN})(${APOSTROPHE})(?=[\\s.,;:!?)\\]])`,
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
    matches.push({
      line,
      word: match[1] ?? match[3],
      apostrophe: match[2] ?? match[4],
    });
  }
  return matches;
}

const ap = (text) =>
  text.replaceAll("^", "'").replaceAll("{apos}", "&apos;").replaceAll("{39}", "&#39;");
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
  // entità HTML nel JSX: nominale e numerica, stesse regole dell'apostrofo
  ["attivita{apos}", ["attivita"]],
  ["dell{apos}attivita{apos}", ["attivita"]],
  ["sara{apos} in stato", ["sara"]],
  ["Piu{39} tardi", ["Piu"]],
  ["E{apos} uno strumento", ["E"]],
  ["non c{apos}e{apos} ne{39} altro", ["e", "ne"]],
  ["<p>Non puo{apos} essere</p>", ["puo"]],
  ["Finche{apos}, Cosi{39}.", ["Finche", "Cosi"]],
  // elisione e chiusura con forme diverse
  ["dell^attivita{apos} e dell{apos}unita^", ["attivita", "unita"]],
  ['label="Attivita{apos} del campo"', ["Attivita"]],
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
  // entità HTML: senza entità finale, stringa isolata tra entità, parola non intera
  "dell{apos}attivita",
  "{apos}attivita{apos}",
  "{39}si{39}",
  "{apos}e{apos}",
  "l{apos}anno",
  "attivita{apos}a e sara{apos}_x e piu{39}8",
  "parente{apos} e abate{39}",
  "x_attivita{apos} e 1e{apos}",
  "un po{apos} di tempo e c{apos}è",
  'const k = "attivita{apos}"',
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
      for (const mark of ["^", "{apos}", "{39}"]) {
        assert.deepEqual(words(`prima ${form}${mark} dopo`), [form], `${form}${mark}`);
      }
    }
  }
});

test("il numero di riga è 1-based e conta i ritorni a capo", () => {
  const text = ap("riga uno\nriga due e^ qui\n\nquarta: cosi{apos}\r\nquinta: Gesu{39}");
  assert.deepEqual(findAccentApostrophes(text), [
    { line: 2, word: "e", apostrophe: "'" },
    { line: 4, word: "cosi", apostrophe: "&apos;" },
    { line: 5, word: "Gesu", apostrophe: "&#39;" },
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
    for (const { line, word, apostrophe } of findAccentApostrophes(text)) {
      offenders.push(`${file}:${line} ${word}${apostrophe}`);
    }
  }

  assert.ok(scanned > 0, "nessun file tracciato scansionato: git ls-files non ha restituito nulla?");

  if (offenders.length > 0) {
    const shown = offenders.slice(0, MAX_REPORTED);
    const rest = offenders.length - shown.length;
    assert.fail(
      [
        `Trovati ${offenders.length} apostrofi (o entità HTML) al posto della lettera accentata (scrivi è, à, ù, ì, ò):`,
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
