import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ACCEDI } from "../src/copy/accedi.ts";
import { ADMIN } from "../src/copy/admin.ts";
import { ANNULLA } from "../src/copy/annulla.ts";
import { ATTIVITA } from "../src/copy/attivita.ts";
import { CHI_ISCRIVI } from "../src/copy/chiIscrivi.ts";
import { CHI_PARTECIPA } from "../src/copy/chiPartecipa.ts";
import { CHI_SEI } from "../src/copy/chiSei.ts";
import { DOMANDE } from "../src/copy/domande.ts";
import { FAMIGLIA } from "../src/copy/famiglia.ts";
import { FIRMA } from "../src/copy/firma.ts";
import { GALLERIA } from "../src/copy/galleria.ts";
import { GUARDIA } from "../src/copy/guardia.ts";
import { HOME } from "../src/copy/home.ts";
import { INVIATA } from "../src/copy/inviata.ts";
import { ISCRITTI } from "../src/copy/iscritti.ts";
import { ISCRIZIONE } from "../src/copy/iscrizione.ts";
import { PAROLE, fillCopy } from "../src/copy/parole.ts";
import { PERCORSO } from "../src/copy/percorso.ts";
import { PROFILO } from "../src/copy/profilo.ts";
import { TIPO_ACCOUNT } from "../src/copy/tipoAccount.ts";
import { EXISTING_ACCOUNT_RETRY_MESSAGE } from "../src/utils/anonymousAccountSwitch.ts";
import { FORBIDDEN_FORMS } from "./support/glossaryForms.mjs";

// Glossario delle schermate (docs/FLUSSO_GENITORE.md, sezione "Parole"):
// una parola sola per ogni concetto, riusata per riferimento da `src/copy/`.
// Due parti: `fillCopy`, che riempie i segnaposto dei testi, e la guardia, che
// diventa rossa se in `src/` rientra una forma vietata o se i testi nuovi
// smettono di usare le parole del glossario.
//
// Le forme vietate qui sotto sono scritte per intero: la guardia legge solo
// `src/`, quindi questo file non fa scattare né lei né accentApostrophes.
//
// Comando: node --test tests/glossary.test.mjs

// ---------------------------------------------------------------------------
// fillCopy
// ---------------------------------------------------------------------------

test("fillCopy: sostituisce il segnaposto {nome}", () => {
  assert.equal(fillCopy("Ciao {nome}", { nome: "Marco" }), "Ciao Marco");
  assert.equal(fillCopy("{nome}", { nome: "Marco Rossi" }), "Marco Rossi");
  // Il segnaposto compare più volte: si sostituiscono tutte.
  assert.equal(fillCopy("{nome} e ancora {nome}", { nome: "Anna" }), "Anna e ancora Anna");
});

test("fillCopy: più segnaposto nella stessa frase", () => {
  assert.equal(
    fillCopy("{ruolo} · {unita}", { ruolo: "Dirigente", unita: "Roma 1" }),
    "Dirigente · Roma 1",
  );
  // Valori in più rispetto ai segnaposto sono ignorati.
  assert.equal(fillCopy("Ciao {nome}", { nome: "Marco", unita: "Roma 1" }), "Ciao Marco");
});

test("fillCopy: un segnaposto senza valore resta com'è", () => {
  assert.equal(fillCopy("Ciao {nome}", {}), "Ciao {nome}");
  assert.equal(
    fillCopy("{ruolo} · {unita}", { ruolo: "Dirigente" }),
    "Dirigente · {unita}",
  );
  // Nomi che esistono sul prototipo di ogni oggetto non contano come valori.
  assert.equal(fillCopy("{constructor} {toString}", {}), "{constructor} {toString}");
  // Una stringa vuota è un valore: il segnaposto sparisce.
  assert.equal(fillCopy("Ciao {nome}!", { nome: "" }), "Ciao !");
});

test("fillCopy: il testo senza segnaposto non cambia", () => {
  for (const text of [
    "",
    "Accedi",
    "Hai già un account? Scegli «Accedi».",
    "Un attimo...",
    // Graffe che non sono un segnaposto: spazi, vuote, trattini.
    "{ }",
    "{}",
    "{non un segnaposto}",
    "{nome-cognome}",
  ]) {
    assert.equal(fillCopy(text, { nome: "Marco" }), text);
  }
});

test("fillCopy: i valori non sono interpretati ($&, $1, $$) né riespansi", () => {
  assert.equal(fillCopy("Ciao {nome}", { nome: "$&" }), "Ciao $&");
  assert.equal(fillCopy("Ciao {nome}", { nome: "$1 e $$" }), "Ciao $1 e $$");
  assert.equal(fillCopy("Ciao {nome}", { nome: "$`" }), "Ciao $`");
  assert.equal(fillCopy("Ciao {nome}", { nome: "a$'b" }), "Ciao a$'b");
  // Un valore che sembra un segnaposto non viene sostituito una seconda volta.
  assert.equal(fillCopy("{nome} {unita}", { nome: "{unita}", unita: "Roma 1" }), "{unita} Roma 1");
});

test("fillCopy: riempie i testi veri delle schermate", () => {
  assert.equal(fillCopy(FAMIGLIA.modificaProfilo, { nome: "Marco" }), "Modifica il profilo di Marco");
  assert.equal(
    fillCopy(ACCEDI.ruoloEUnita, { ruolo: "Dirigente", unita: "Roma 1" }),
    "Dirigente · Roma 1",
  );
  assert.doesNotMatch(fillCopy(ISCRIZIONE.salvataSulProfilo, { nome: "Marco" }), /\{|\}/u);
});

// ---------------------------------------------------------------------------
// Guardia: forme vietate in src/
// ---------------------------------------------------------------------------

// Due famiglie di controlli.
//
// 1. Frasi vietate (FORBIDDEN_FORMS, in ./support/glossaryForms.mjs): valgono
//    su tutto il testo del file, commenti compresi. Ogni forma ha l'etichetta
//    che compare nel rapporto e un'espressione che la riconosce anche spezzata
//    su più righe (JSX) o con l'apostrofo scritto come entità HTML o preceduto
//    da una barra (stringa con apice escapato). Il confronto non distingue
//    maiuscole e minuscole, tranne per "Crea account", che vale solo
//    identico: "Crea un account" è la forma giusta. "un secondo figlio" è
//    vietato solo se non continua con "o figlia". "Annulla iscrizione" è
//    vietato: la frase è "Annulla l'iscrizione".
//
// 2. La parola "login" come testo per l'utente (findLoginText): conta solo
//    dentro le stringhe e nel testo JSX, mai nei commenti, nei percorsi
//    (/login), nei valori di codice ("login" da solo, "login-required") e nei
//    nomi di classe o di id (rn-g-login, tab-login).

const lineAt = (text, index) => text.slice(0, index).split("\n").length;

// Spezza un sorgente .ts/.tsx nei pezzi che l'utente può leggere: il contenuto
// delle stringhe (apici singoli, doppi, backtick con i loro `${...}`) e il testo
// JSX tra un tag e l'altro. I commenti non sono mai testo. Non è un parser: un
// apice subito dopo una lettera è un'elisione (l'iscrizione), non l'apertura di
// una stringa, e un errore su una riga non si porta dietro le righe dopo.
function userTextSegments(source) {
  const segments = [];
  const code = source.split("");
  const blank = (from, to) => {
    for (let k = from; k < to; k += 1) if (code[k] !== "\n") code[k] = " ";
  };
  const stack = [];
  let depth = 0;
  const length = source.length;

  // `start` è il primo carattere dopo il backtick o dopo la `}` che chiude un
  // `${...}`. Ritorna dove riprende il codice.
  function readTemplate(start) {
    let k = start;
    while (k < length) {
      if (source[k] === "\\") {
        k += 2;
      } else if (source[k] === "`") {
        segments.push({ index: start, text: source.slice(start, k) });
        blank(start, k + 1);
        return k + 1;
      } else if (source[k] === "$" && source[k + 1] === "{") {
        segments.push({ index: start, text: source.slice(start, k) });
        blank(start, k + 2);
        stack.push(depth);
        depth += 1;
        return k + 2;
      } else {
        k += 1;
      }
    }
    segments.push({ index: start, text: source.slice(start) });
    blank(start, length);
    return length;
  }

  let i = 0;
  while (i < length) {
    const char = source[i];
    const next = source[i + 1];
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? length : end;
      blank(i, stop);
      i = stop;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (char === '"' || (char === "'" && !/[\p{L}\p{N}]/u.test(source[i - 1] ?? ""))) {
      let k = i + 1;
      while (k < length && source[k] !== char && source[k] !== "\n") {
        k += source[k] === "\\" ? 2 : 1;
      }
      segments.push({
        index: i + 1,
        text: source.slice(i + 1, k),
        // Per riconoscere className="...", che è codice.
        before: source.slice(Math.max(0, i - 20), i),
      });
      const stop = source[k] === char ? k + 1 : k;
      blank(i, stop);
      i = stop;
    } else if (char === "`") {
      blank(i, i + 1);
      i = readTemplate(i + 1);
    } else if (char === "}" && stack.length > 0 && stack[stack.length - 1] === depth - 1) {
      stack.pop();
      depth -= 1;
      blank(i, i + 1);
      i = readTemplate(i + 1);
    } else {
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      i += 1;
    }
  }

  // Quello che resta è codice; il testo JSX sta tra `>` o `}` e `<` o `{`.
  const rest = code.join("");
  for (const match of rest.matchAll(/[>}]([^<>{}]+)(?=[<{])/gu)) {
    segments.push({ index: match.index + 1, text: match[1] });
  }
  return segments;
}

const LOGIN_WORD = /(?<![\p{L}\p{N}_])login(?![\p{L}\p{N}_])/giu;

// Righe in cui "login" è un testo per l'utente (vedi sopra). `ignore` sono
// intervalli già segnalati da una frase vietata che contiene "login".
function findLoginText(source, ignore = []) {
  const found = [];
  for (const { index, text, before: context = "" } of userTextSegments(source)) {
    // "login" da solo, in minuscolo, è un valore di codice (mode === "login").
    if (text.trim() === "login") continue;
    // Le classi CSS sono codice: className="login-box login".
    if (/\bclass(?:Name)?\s*=\s*$/u.test(context)) continue;
    for (const match of text.matchAll(LOGIN_WORD)) {
      const before = text[match.index - 1] ?? "";
      const after = text[match.index + "login".length] ?? "";
      // Nome di classe, di id o di stato: rn-g-login, tab-login, login-required.
      if (before === "-" || after === "-") continue;
      // Percorso: /login, ma non "account/login" (lì "/" è un separatore nel testo).
      if (before === "/" && !/[\p{L}\p{N}]/u.test(text[match.index - 2] ?? "")) continue;
      // Indirizzo completo: https://esempio.it/login.
      const token = text.slice(text.lastIndexOf(" ", match.index) + 1).split(/\s/u)[0];
      if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(token)) continue;
      const at = index + match.index;
      if (ignore.some(([from, to]) => at >= from && at < to)) continue;
      found.push({ line: lineAt(source, at), form: "login" });
    }
  }
  return found;
}

function findForbiddenForms(text) {
  const found = [];
  const covered = [];
  for (const [form, pattern] of FORBIDDEN_FORMS) {
    for (const match of text.matchAll(pattern)) {
      found.push({ line: lineAt(text, match.index), form });
      if (/login/iu.test(match[0])) covered.push([match.index, match.index + match[0].length]);
    }
  }
  found.push(...findLoginText(text, covered));
  return found.sort((a, b) => a.line - b.line);
}

const forms = (text) => findForbiddenForms(text).map((entry) => entry.form);

// --- Rilevatore (unit) ------------------------------------------------------

test("la guardia riconosce ogni forma vietata", () => {
  const MUST_FLAG = [
    ["<Link>Login o crea un account</Link>", ["Login o crea"]],
    ['label: "Fai login"', ["Fai login"]],
    ["Vai al login", ["Vai al login"]],
    ["Login / Account", ["Login / Account"]],
    ["Login/Account", ["Login / Account"]],
    ["Entra nell'app", ["Entra nell'app"]],
    ["<p>Entra nell&apos;app</p>", ["Entra nell'app"]],
    ["<p>Entra nell&#39;app</p>", ["Entra nell'app"]],
    ["'Entra nell\\'app'", ["Entra nell'app"]],
    ["Entra nell’app", ["Entra nell'app"]],
    ["Registrati con Google", ["Registrati con Google"]],
    ["Accedi con Google", ["Accedi con Google"]],
    ["Scegli quale figlio/a iscrivere", ["figlio/a"]],
    ["i figli/e", ["figli/e"]],
    ["il ragazzo/a", ["ragazzo/a"]],
    ["Crea account", ["Crea account"]],
    ["<button>Crea account</button>", ["Crea account"]],
    // la forma giusta accanto a quella vietata: scatta solo la seconda
    ["Crea un account oppure Crea account.", ["Crea account"]],
    // maiuscole e minuscole non cambiano l'esito
    ["fai LOGIN", ["Fai login"]],
    ["accedi con google", ["Accedi con Google"]],
    // frase spezzata su due righe (JSX)
    ["Accedi con\n  Google", ["Accedi con Google"]],
    ["Entra\n  nell&apos;app", ["Entra nell'app"]],
    // più forme nello stesso testo
    ["Fai login o Accedi con Google", ["Fai login", "Accedi con Google"]],
    // un secondo figlio, se non è "o figlia"
    ["Aggiungi un secondo figlio", ["un secondo figlio"]],
    ["<p>Un Secondo Figlio</p>", ["un secondo figlio"]],
    ["Aggiungi un secondo\n  figlio.", ["un secondo figlio"]],
    ["un secondo figlio oppure altro", ["un secondo figlio"]],
    ["un secondo figlio o una figlia", ["un secondo figlio"]],
    // annullare l'iscrizione: l'articolo non si perde
    ["Annulla iscrizione", ["Annulla iscrizione"]],
    ["<button>Annulla iscrizione</button>", ["Annulla iscrizione"]],
    ["<button>Annulla\n  iscrizione</button>", ["Annulla iscrizione"]],
    ['label: "annulla iscrizione"', ["Annulla iscrizione"]],
    ["Sì, ANNULLA ISCRIZIONE", ["Annulla iscrizione"]],
  ];
  for (const [input, expected] of MUST_FLAG) {
    assert.deepEqual(forms(input), expected, JSON.stringify(input));
  }
});

test("la guardia lascia stare le forme giuste e i nomi di codice", () => {
  for (const input of [
    "Accedi",
    "Crea un account",
    "Accedi o crea un account",
    "Continua con Google",
    "Aggiungi un figlio o una figlia",
    "Aggiungi un secondo figlio o figlia",
    "un secondo figlio\n  o figlia",
    "Un Secondo Figlio O Figlia",
    "Annulla l'iscrizione",
    "<button>Annulla l&apos;iscrizione</button>",
    "Sì, annulla l'iscrizione",
    "Annulla l'iscrizione di Marco a «Campo estivo»",
    "annullaIscrizione",
    "Annulla iscrizioni",
    "Esci e cambia account",
    "Cambia account",
    "Entra",
    "Entra nell'area riservata",
    "creaUnAccount",
    "createAccount()",
    "getLoginPath(redirect)",
    "const login = 1;",
    "/login?redirect=/x",
    "/figlio/abc",
    "figlio/abc",
  ]) {
    assert.deepEqual(forms(input), [], JSON.stringify(input));
  }
});

test("login come testo per l'utente: stringhe e testo JSX", () => {
  const MUST_FLAG = [
    // stringhe tra virgolette, apici e backtick
    ['placeholder="Richiedi login per modificare l\'iscrizione"', 1],
    ["const t = 'Se non fai il login, i tuoi dati restano qui.';", 1],
    ['const t = "Login obbligatorio";', 1],
    ["const t = `Fai il login ${nome}`;", 1],
    ["const t = `${nome}: serve il login`;", 1],
    ['<Field label="Testo guida nella schermata account/login." />', 1],
    // "Login" con la maiuscola da solo è un'etichetta, non un valore di codice
    ['<Button label="Login" />', 1],
    // testo JSX: dopo un tag, dopo un'espressione, su più righe, con un'elisione
    ["<p>Prima di continuare fai il login</p>", 1],
    ["<p>{nome} ha fatto login</p>", 1],
    ["<p>\n  Torna al login\n</p>", 1],
    ["<p>L'ospite deve fare login</p>", 1],
    ["<p>Serve il login <strong>adesso</strong></p>", 1],
    ["<p><strong>Subito</strong> dopo il login</p>", 1],
    // testo con login in mezzo
    ['const t = "Premi login per entrare";', 1],
    // due occorrenze in due stringhe
    ['const a = "il login"; const b = "senza login";', 2],
  ];
  for (const [input, count] of MUST_FLAG) {
    const hits = findLoginText(input);
    assert.equal(hits.length, count, JSON.stringify(input));
    for (const hit of hits) assert.equal(hit.form, "login");
  }
});

test("login non scatta nei percorsi, nei valori di codice, nelle classi e nei commenti", () => {
  const MUST_NOT_FLAG = [
    // percorsi
    'const to = "/login";',
    "const to = '/login?redirect=/x';",
    "const to = `/login?redirect=${encodeURIComponent(path)}`;",
    '<Navigate replace to="/login" />',
    '<Link to="/login">Accedi</Link>',
    'const a = "https://app.example/login";',
    "{ path: \"/login\", element: <LoginPage /> },",
    // valori di codice
    'if (mode === "login") {}',
    'type AuthMode = "login" | "signup";',
    'useState<AuthMode>("login")',
    "setMode('login');",
    'return "login-required";',
    'availability === "login-required"',
    // nomi di classe e di id
    '<div className="rn-g-login">',
    'const id = `${authIds}-tab-login`;',
    '<div className="login-box login">',
    // identificatori e chiavi di codice
    "const loginPath = getLoginPath(redirect);",
    "const tabIds = { login: 1, signup: 2 };",
    "session.requireLoginForEdit",
    // commenti, di ogni tipo
    "// Non vuole login e non crea nessuna sessione.",
    "const x = 1; // senza login",
    "/* richiede il login */",
    "/**\n * Chi non ha fatto il login\n * vede l'invito.\n */",
    "<div>{/* il login sta nel pannello */}</div>",
    // il testo giusto
    '<Button>Accedi</Button>',
    'const t = "Richiedi un account per modificare l\'iscrizione";',
    // una stringa che chiude dopo un'elisione non si porta dietro il resto
    "const a = 'dell'; const login = 1;",
  ];
  for (const input of MUST_NOT_FLAG) {
    assert.deepEqual(findLoginText(input), [], JSON.stringify(input));
  }
});

test("login: la riga è quella giusta, anche dopo template e commenti", () => {
  const source = [
    "// Non vuole login",                                  // 1
    "const a = `/login?redirect=${encodeURIComponent(`${x}`)}`;", // 2
    "const b = 'ok';",                                      // 3
    "/* il login",                                          // 4
    "   continua */",                                       // 5
    'const c = "Fai il login";',                            // 6
    "const d = <p>{nome} usa il login</p>;",                // 7
  ].join("\n");
  assert.deepEqual(findLoginText(source), [
    { line: 6, form: "login" },
    { line: 7, form: "login" },
  ]);
});

test("una frase vietata con login è segnalata una volta sola", () => {
  assert.deepEqual(findForbiddenForms('const a = "Fai login";'), [{ line: 1, form: "Fai login" }]);
  assert.deepEqual(findForbiddenForms("<p>Vai al login</p>"), [{ line: 1, form: "Vai al login" }]);
  assert.deepEqual(forms('const a = "Vai al login e poi fai il login";'), ["Vai al login", "login"]);
});

test("la guardia dà il numero di riga, 1-based", () => {
  const text = ["riga uno", "Crea un account", "Fai login", "", "poi Accedi con Google qui"].join("\n");
  assert.deepEqual(findForbiddenForms(text), [
    { line: 3, form: "Fai login" },
    { line: 5, form: "Accedi con Google" },
  ]);
  // Una forma spezzata su due righe conta dalla riga in cui comincia.
  assert.deepEqual(findForbiddenForms("a\nAccedi con\nGoogle"), [{ line: 2, form: "Accedi con Google" }]);
});

// --- Scansione di src/ ------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

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

const MAX_REPORTED = 30;

test("in src/ non compare nessuna forma vietata dal glossario", () => {
  const offenders = [];
  const files = listSourceFiles(SRC);

  for (const file of files) {
    const relative = path.relative(ROOT, file).split(path.sep).join("/");
    for (const { line, form } of findForbiddenForms(readFileSync(file, "utf8"))) {
      offenders.push(`${relative}:${line} ${form}`);
    }
  }

  // Se la scansione non vede i file, il test non prova niente.
  assert.ok(files.length > 50, `scansionati solo ${files.length} file in src/`);
  assert.ok(
    files.some((file) => file.endsWith(path.join("src", "copy", "parole.ts"))),
    "src/copy/parole.ts non è tra i file scansionati",
  );

  if (offenders.length > 0) {
    const shown = offenders.slice(0, MAX_REPORTED);
    const rest = offenders.length - shown.length;
    assert.fail(
      [
        `Trovate ${offenders.length} forme fuori glossario (docs/FLUSSO_GENITORE.md, "Parole"):`,
        ...shown.map((entry) => `  ${entry}`),
        ...(rest > 0 ? [`  ... e altre ${rest}`] : []),
      ].join("\n"),
    );
  }
});

// --- Testi in src/copy/ -----------------------------------------------------

const COPY = {
  PAROLE,
  ACCEDI,
  ADMIN,
  ANNULLA,
  ATTIVITA,
  CHI_ISCRIVI,
  CHI_PARTECIPA,
  CHI_SEI,
  DOMANDE,
  FAMIGLIA,
  FIRMA,
  GALLERIA,
  GUARDIA,
  HOME,
  INVIATA,
  ISCRITTI,
  ISCRIZIONE,
  PERCORSO,
  PROFILO,
  TIPO_ACCOUNT,
};

test("ogni testo di src/copy/ è una stringa non vuota", () => {
  for (const [name, copy] of Object.entries(COPY)) {
    const entries = Object.entries(copy);
    assert.ok(entries.length > 0, `${name} è vuoto`);
    for (const [key, value] of entries) {
      assert.equal(typeof value, "string", `${name}.${key} non è una stringa`);
      assert.ok(value.trim().length > 0, `${name}.${key} è vuoto`);
    }
  }
});

test("schede e pulsanti riusano le parole del glossario", () => {
  assert.equal(ACCEDI.google, PAROLE.continuaConGoogle);
  assert.equal(ACCEDI.schedaAccedi, PAROLE.accedi);
  assert.equal(ACCEDI.schedaCrea, PAROLE.creaUnAccount);
  assert.equal(ACCEDI.titoloAccedi, PAROLE.accedi);
  assert.equal(ACCEDI.titoloCrea, PAROLE.creaUnAccount);
  assert.equal(ACCEDI.inviaAccedi, PAROLE.accedi);
  assert.equal(ACCEDI.inviaCrea, PAROLE.creaUnAccount);
  assert.equal(ISCRIZIONE.accedi, PAROLE.accedi);
  assert.equal(ISCRIZIONE.creaUnAccount, PAROLE.creaUnAccount);
  // Aggiungere un figlio ha una sola frase, uguale in iscrizione e in famiglia.
  assert.equal(ISCRIZIONE.aggiungiFiglio, PAROLE.aggiungiFiglio);
  assert.equal(FAMIGLIA.aggiungiFiglio, PAROLE.aggiungiFiglio);
  assert.equal(ISCRIZIONE.aggiungiFiglio, FAMIGLIA.aggiungiFiglio);
});

test("annullare l'iscrizione: le parole comuni stanno in ANNULLA e Famiglia le riusa", () => {
  assert.equal(FAMIGLIA.annullaIscrizione, ANNULLA.annullaIscrizione);
  assert.equal(FAMIGLIA.annullamento, ANNULLA.annullamento);
  assert.equal(FAMIGLIA.annullata, ANNULLA.annullata);
  assert.equal(FAMIGLIA.erroreAnnulla, ANNULLA.errore);
});

test("Autorizza ora: una parola sola, nel pulsante e nei testi che la citano", () => {
  assert.equal(PAROLE.autorizzaOra, "Autorizza ora");
  assert.equal(FAMIGLIA.autorizzaOra, PAROLE.autorizzaOra);

  // I testi che mandano a "Autorizza ora" la nominano tra caporali, con la
  // parola del glossario e non riscritta.
  const quoted = `«${PAROLE.autorizzaOra}»`;
  assert.ok(FAMIGLIA.riprendiFirma.includes(quoted), FAMIGLIA.riprendiFirma);

  const citing = Object.entries(FIRMA).filter(([, value]) => /autorizza\s+ora/iu.test(value));
  assert.ok(citing.length > 0, "nessun testo di FIRMA nomina Autorizza ora: il controllo non prova niente");
  for (const [key, value] of citing) {
    assert.ok(value.includes(quoted), `FIRMA.${key}: ${value}`);
  }
});

test("il messaggio di account già esistente nomina il pulsante Continua con Google", () => {
  assert.equal(typeof EXISTING_ACCOUNT_RETRY_MESSAGE, "string");
  assert.ok(
    EXISTING_ACCOUNT_RETRY_MESSAGE.includes(PAROLE.continuaConGoogle),
    EXISTING_ACCOUNT_RETRY_MESSAGE,
  );
});

test("nelle schermate del genitore non compare la parola minore", () => {
  // "minore" vale solo nei testi legali e nell'autorizzazione (glossario).
  const values = [
    ...Object.values(COPY).flatMap((copy) => Object.values(copy)),
    EXISTING_ACCOUNT_RETRY_MESSAGE,
  ];
  for (const value of values) {
    assert.doesNotMatch(value, /minor[ei]/iu, value);
  }
});

test("nei testi di src/copy/ non compare la parola login", () => {
  // Per l'utente si dice "Accedi" (glossario). Vale per ogni valore.
  const values = [
    ...Object.entries(COPY).flatMap(([name, copy]) =>
      Object.entries(copy).map(([key, value]) => [`${name}.${key}`, value]),
    ),
    ["EXISTING_ACCOUNT_RETRY_MESSAGE", EXISTING_ACCOUNT_RETRY_MESSAGE],
  ];
  for (const [name, value] of values) {
    assert.doesNotMatch(value, /login/iu, `${name}: ${value}`);
  }
});

test("ogni oggetto esportato da src/copy/ è coperto da questi controlli", async () => {
  // Un file nuovo in src/copy/ deve entrare in COPY: altrimenti i suoi testi
  // sfuggirebbero ai controlli (non vuoti, niente minore, niente login).
  const copyDir = path.join(SRC, "copy");
  const files = readdirSync(copyDir).filter((file) => file.endsWith(".ts"));
  assert.ok(files.length >= 6, `trovati solo ${files.length} file in src/copy/`);

  const covered = new Set(Object.values(COPY));
  for (const file of files) {
    const module = await import(pathToFileURL(path.join(copyDir, file)).href);
    for (const [name, value] of Object.entries(module)) {
      if (typeof value === "object" && value !== null) {
        assert.ok(covered.has(value), `src/copy/${file}: ${name} non è in COPY (tests/glossary.test.mjs)`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Il figlio nei testi nuovi di "Chi iscrivi?" e "Iscrizione inviata"
// ---------------------------------------------------------------------------

// Glossario (docs/FLUSSO_GENITORE.md, "Parole"): il figlio di cui non si sa il
// nome è sempre "figlio o figlia" ("Iscrivo mio figlio o mia figlia", "Per: un
// figlio o una figlia"); più figli sono "i tuoi figli". Le coppie ammesse sono
// "figlio o figlia" e quelle con l'articolo o il possessivo accordato (un/una,
// mio/mia, tuo/tua, suo/sua). Il plurale "figli" non conta.
const FIGLIO_PAIR = /\b(?:(un|mio|tuo|suo)\s+)?figlio\s+o\s+(?:(una|mia|tua|sua)\s+)?figlia\b/giu;
const FIGLIO_AGREEMENT = { un: "una", mio: "mia", tuo: "tua", suo: "sua" };

/** Il testo con le coppie ammesse tolte: ciò che resta non deve dire figlio né figlia. */
function withoutAllowedFiglio(value) {
  return value.replace(FIGLIO_PAIR, (match, before, after) => {
    const left = before?.toLowerCase();
    const right = after?.toLowerCase();
    // "figlio o figlia" senza determinanti, oppure con la coppia accordata.
    if (!left && !right) {
      return "";
    }
    if (left && right && FIGLIO_AGREEMENT[left] === right) {
      return "";
    }
    // "un figlio o figlia", "tuo figlio o mia figlia": restano e vengono segnalate.
    return match;
  });
}

test("glossario del figlio: la guardia riconosce le forme giuste e quelle sbagliate", () => {
  for (const ok of [
    "Aggiungi un figlio o una figlia",
    "Iscrivo mio figlio o mia figlia",
    "Aggiungi tuo figlio o tua figlia: i dati restano nel tuo account.",
    "Iscrivi un altro figlio o figlia",
    "Per ognuno dei tuoi figli.",
    "Iscrivi i tuoi figli",
    "Famiglia",
  ]) {
    assert.doesNotMatch(withoutAllowedFiglio(ok), /\bfigli[oa]\b/iu, ok);
  }

  for (const wrong of [
    "Iscrivi tuo figlio",
    "Iscrivi un altro figlio",
    "Il figlio è iscritto.",
    "Aggiungi la figlia",
    "Figlio/a",
    "tuo figlio o mia figlia",
    "un figlio o figlia",
    "Aggiungi un figlio o una figlia, poi il figlio.",
  ]) {
    assert.match(withoutAllowedFiglio(wrong), /\bfigli[oa]\b/iu, wrong);
  }
});

test("nei testi di Chi iscrivi? e Iscrizione inviata il figlio è sempre «figlio o figlia»", () => {
  const values = [CHI_ISCRIVI, INVIATA].flatMap((copy, index) =>
    Object.entries(copy).map(([key, value]) => [`${index === 0 ? "CHI_ISCRIVI" : "INVIATA"}.${key}`, value]),
  );

  // Il controllo deve provare qualcosa: almeno un testo nomina il figlio.
  assert.ok(
    values.some(([, value]) => /\bfigli[oa]?\b/iu.test(value)),
    "nessun testo di CHI_ISCRIVI o INVIATA nomina un figlio: il controllo non prova niente",
  );

  for (const [name, value] of values) {
    assert.doesNotMatch(withoutAllowedFiglio(value), /\bfigli[oa]\b/iu, `${name}: ${value}`);
  }
});

test("Chi iscrivi? riusa i testi di Famiglia per la modifica e per la rete", () => {
  assert.equal(CHI_ISCRIVI.modificaDi, FAMIGLIA.modificaProfilo);
  assert.equal(CHI_ISCRIVI.foglioTitoloModifica, FAMIGLIA.modificaProfilo);
  assert.equal(CHI_ISCRIVI.erroreRete, FAMIGLIA.erroreRete);
});

test("errore di rete delle scritture: una frase sola in PAROLE, riusata per riferimento", () => {
  // Offline la scrittura resta in coda e il pulsante si sblocca: la frase che lo
  // dice è una, in PAROLE; Famiglia, Domande e Galleria la riusano e chi
  // riusa Famiglia la eredita.
  assert.ok(PAROLE.erroreRete.trim().length > 0);
  assert.equal(FAMIGLIA.erroreRete, PAROLE.erroreRete);
  assert.equal(DOMANDE.erroreRete, PAROLE.erroreRete);
  assert.equal(GALLERIA.erroreRete, PAROLE.erroreRete);
  assert.equal(CHI_ISCRIVI.erroreRete, PAROLE.erroreRete);
  assert.equal(PROFILO.erroreRete, PAROLE.erroreRete);

  // E non è riscritta a mano, da sola, da nessun'altra parte di src/ (una copia
  // smetterebbe di cambiare insieme alle altre). Una frase più lunga che
  // comincia allo stesso modo, come invioRete di Iscrizione, è un testo diverso.
  const asLiteral = ['"', "'", "`"].map((quote) => `${quote}${PAROLE.erroreRete}${quote}`);
  const writtenIn = listSourceFiles(SRC)
    .filter((file) => {
      const text = readFileSync(file, "utf8");
      return asLiteral.some((literal) => text.includes(literal));
    })
    .map((file) => path.relative(ROOT, file).split(path.sep).join("/"));
  assert.deepEqual(writtenIn, ["src/copy/parole.ts"]);
});

test("la guardia adulto riusa i testi di Chi partecipa? e dice sempre «figlio o figlia»", () => {
  // Titolo e prima opzione sono quelli di B, non riscritti (docs/FLUSSO_GENITORE.md, G).
  assert.equal(GUARDIA.chiPartecipa, CHI_PARTECIPA.titolo);
  assert.equal(GUARDIA.iscrivoFiglio, CHI_PARTECIPA.iscrivoFiglio);

  // Il controllo deve provare qualcosa: almeno un testo nomina il figlio.
  assert.ok(
    Object.values(GUARDIA).some((value) => /\bfigli[oa]?\b/iu.test(value)),
    "nessun testo di GUARDIA nomina un figlio: il controllo non prova niente",
  );

  for (const [key, value] of Object.entries(GUARDIA)) {
    assert.doesNotMatch(withoutAllowedFiglio(value), /\bfigli[oa]\b/iu, `GUARDIA.${key}: ${value}`);
  }
});
