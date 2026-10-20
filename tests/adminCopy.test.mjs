import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ADMIN } from "../src/copy/admin.ts";
import { ANNULLA } from "../src/copy/annulla.ts";
import { DOMANDE } from "../src/copy/domande.ts";
import { GALLERIA } from "../src/copy/galleria.ts";
import { PAROLE, fillCopy } from "../src/copy/parole.ts";
import { FORBIDDEN_FORMS } from "./support/glossaryForms.mjs";

// I testi dei fogli di conferma dell'admin (`src/copy/admin.ts`), che hanno
// preso il posto dei dialoghi del browser. Per ogni foglio: un titolo che è una
// domanda, un corpo, la scelta sicura (viene prima), il tasto che toglie o
// invia qualcosa («Sì, …») e il testo di attesa. Le parti variabili sono
// segnaposto `{nome}`, `{attivita}`, `{titolo}`, `{n}` riempiti da `fillCopy`;
// le frasi che esistono già altrove (annullare l'iscrizione, le domande, le
// parole comuni) si riusano per riferimento, mai riscritte.
//
// Comando: node --test tests/adminCopy.test.mjs

const entries = Object.entries(ADMIN);
const keysMatching = (pattern) => entries.filter(([key]) => pattern.test(key));

// I valori con cui le schermate riempiono i segnaposto.
const VALUES = {
  nome: "Marco Rossi",
  attivita: "Campo estivo",
  titolo: "Serata di gala",
  n: "12",
};

const placeholdersOf = (text) => [...text.matchAll(/\{(\w+)\}/gu)].map((match) => match[1]);

// ---------------------------------------------------------------------------
// Forma dei testi
// ---------------------------------------------------------------------------

test("ADMIN: ogni testo è una stringa non vuota, senza spazi ai bordi né a capo", () => {
  assert.ok(entries.length > 50, `ADMIN ha solo ${entries.length} testi`);
  for (const [key, value] of entries) {
    assert.equal(typeof value, "string", `ADMIN.${key} non è una stringa`);
    assert.ok(value.trim().length > 0, `ADMIN.${key} è vuoto`);
    assert.equal(value, value.trim(), `ADMIN.${key} ha spazi ai bordi`);
    assert.doesNotMatch(value, /[\n\t]/u, `ADMIN.${key} va a capo`);
    assert.doesNotMatch(value, / {2}/u, `ADMIN.${key} ha due spazi di fila`);
  }
});

test("ADMIN: nessuna frase compare sotto due chiavi diverse", () => {
  const byText = new Map();
  for (const [key, value] of entries) {
    byText.set(value, [...(byText.get(value) ?? []), key]);
  }
  // Due chiavi con la stessa frase sono una frase scritta due volte.
  const repeated = [...byText.values()].filter((keys) => keys.length > 1);
  assert.deepEqual(repeated, []);
});

test("ADMIN: i titoli dei fogli sono domande", () => {
  const titles = keysMatching(/Titolo(?:Uno|Piu)?$/u);
  assert.ok(titles.length >= 10, `trovati solo ${titles.length} titoli`);
  for (const [key, value] of titles) {
    assert.match(value, /\?$/u, `ADMIN.${key}: «${value}» non finisce con «?»`);
    assert.equal(value.indexOf("?"), value.length - 1, `ADMIN.${key}: più di un «?»`);
    assert.match(value, /^\p{Lu}/u, `ADMIN.${key}: non comincia con la maiuscola`);
  }
});

test("ADMIN: i titoli compilati restano domande, con il valore al posto del segnaposto", () => {
  for (const [key, value] of keysMatching(/Titolo(?:Uno|Piu)?$/u)) {
    const filled = fillCopy(value, VALUES);
    assert.match(filled, /\?$/u, `ADMIN.${key}: «${filled}»`);
    for (const name of placeholdersOf(value)) {
      assert.ok(filled.includes(VALUES[name]), `ADMIN.${key}: «${filled}» non contiene ${VALUES[name]}`);
    }
  }
});

test("ADMIN: i corpi e gli errori sono frasi che finiscono con il punto", () => {
  const sentences = [...keysMatching(/Corpo(?:Bozza)?$/u), ...keysMatching(/^errore/u)];
  sentences.push(["completamentoElencoCambiato", ADMIN.completamentoElencoCambiato]);
  assert.ok(sentences.length >= 20, `trovate solo ${sentences.length} frasi`);
  for (const [key, value] of sentences) {
    assert.match(value, /\.$/u, `ADMIN.${key}: «${value}» non finisce con il punto`);
    assert.doesNotMatch(value, /\.\.$/u, `ADMIN.${key}: finisce con due punti`);
  }
});

test("ADMIN: il tasto che conferma comincia con «Sì, » e non ha punteggiatura finale", () => {
  const confirms = keysMatching(/^conferma/u);
  assert.ok(confirms.length >= 8, `trovati solo ${confirms.length} tasti`);
  for (const [key, value] of confirms) {
    assert.match(value, /^Sì, /u, `ADMIN.${key}: «${value}»`);
    assert.doesNotMatch(value, /[.?!]$/u, `ADMIN.${key}: «${value}»`);
  }
});

test("ADMIN: la scelta sicura non comincia con «Sì, » e non ha punteggiatura finale", () => {
  const keeps = [...keysMatching(/^tieni/u), ["nonOra", ADMIN.nonOra], ["nonInviare", ADMIN.nonInviare]];
  assert.ok(keeps.length >= 8, `trovati solo ${keeps.length} tasti`);
  for (const [key, value] of keeps) {
    assert.doesNotMatch(value, /^Sì/u, `ADMIN.${key}: «${value}»`);
    assert.doesNotMatch(value, /[.?!]$/u, `ADMIN.${key}: «${value}»`);
  }
});

test("ADMIN: i testi di attesa finiscono con tre puntini", () => {
  for (const key of ["annullamento", "eliminazione", "salvataggio", "generazione", "invio"]) {
    assert.match(ADMIN[key], /\.\.\.$/u, `ADMIN.${key}: «${ADMIN[key]}»`);
  }
});

// Per ogni foglio i quattro testi che l'admin legge insieme: titolo, corpo, la
// scelta sicura e il tasto che conferma.
const SHEETS = {
  annullaIscrizione: ["annullaIscrizioneTitolo", "annullaIscrizioneCorpo", "tieniIscrizione", "confermaAnnulla"],
  eliminaIscrizione: [
    "eliminaIscrizioneTitolo",
    "eliminaIscrizioneCorpo",
    "tieniIscrizione",
    "confermaEliminaIscrizione",
  ],
  eliminaAttivita: ["eliminaAttivitaTitolo", "eliminaAttivitaCorpo", "tieniAttivita", "confermaEliminaAttivita"],
  eliminaPattuglia: [
    "eliminaPattugliaTitolo",
    "eliminaPattugliaCorpo",
    "tieniPattuglia",
    "confermaEliminaPattuglia",
  ],
  eliminaPattugliaConBozza: [
    "eliminaPattugliaTitolo",
    "eliminaPattugliaCorpoBozza",
    "tieniPattuglia",
    "confermaEliminaPattuglia",
  ],
  eliminaDomanda: ["eliminaDomandaTitolo", "eliminaDomandaCorpo", "tieniDomanda", "confermaEliminaDomanda"],
  eliminaDomandaSondaggio: [
    "eliminaDomandaSondaggioTitolo",
    "eliminaDomandaSondaggioCorpo",
    "tieniDomanda",
    "confermaEliminaDomanda",
  ],
  moduliVecchioMetodo: [
    "moduliVecchioMetodoTitolo",
    "moduliVecchioMetodoCorpo",
    "nonOra",
    "confermaModuliVecchioMetodo",
  ],
  completamentoUno: ["completamentoTitoloUno", "completamentoCorpo", "nonInviare", "confermaCompletamentoUno"],
  completamentoPiu: ["completamentoTitoloPiu", "completamentoCorpo", "nonInviare", "confermaCompletamentoPiu"],
  eliminaPost: ["eliminaPostTitolo", "eliminaPostCorpo", "tieniPost", "confermaEliminaPost"],
  eliminaGalleria: ["eliminaGalleriaTitolo", "eliminaGalleriaCorpo", "tieniGalleria", "confermaEliminaGalleria"],
};

test("fogli: ogni testo di ogni foglio esiste in ADMIN", () => {
  for (const [sheet, keys] of Object.entries(SHEETS)) {
    for (const key of keys) {
      assert.equal(typeof ADMIN[key], "string", `${sheet}: manca ADMIN.${key}`);
    }
  }
});

test("fogli: titolo, corpo, scelta sicura e conferma sono quattro frasi diverse", () => {
  for (const [sheet, keys] of Object.entries(SHEETS)) {
    const texts = keys.map((key) => ADMIN[key]);
    assert.equal(new Set(texts).size, 4, `${sheet}: due testi del foglio sono uguali`);
  }
});

test("fogli: la scelta sicura sta prima nel foglio e non è un «Sì»", () => {
  for (const [sheet, [, , keep, confirm]] of Object.entries(SHEETS)) {
    assert.doesNotMatch(ADMIN[keep], /^Sì/u, `${sheet}: la scelta sicura dice sì`);
    assert.match(ADMIN[confirm], /^Sì, /u, `${sheet}: il tasto che conferma non dice sì`);
  }
});

test("fogli: gli invii a persone reali avvisano che non si annullano", () => {
  assert.match(ADMIN.completamentoCorpo, /non si può annullare/u);
  assert.match(ADMIN.moduliVecchioMetodoCorpo, /non si possono richiamare/u);
});

test("fogli: i fogli che eliminano per sempre lo dicono", () => {
  for (const key of [
    "eliminaIscrizioneCorpo",
    "eliminaAttivitaCorpo",
    "eliminaDomandaCorpo",
    "eliminaPostCorpo",
    "eliminaGalleriaCorpo",
  ]) {
    assert.match(ADMIN[key], /non si può recuperare/iu, `ADMIN.${key}`);
  }
});

test("fogli: l'eliminazione di un'iscrizione rimanda ad «annullala», che si può riattivare", () => {
  assert.match(ADMIN.eliminaIscrizioneCorpo, /annullala/u);
  assert.match(ADMIN.eliminaIscrizioneCorpo, /riattivare/u);
  // E l'annullamento dice che si riattiva.
  assert.match(ADMIN.annullaIscrizioneCorpo, /riattivarla/u);
});

test("fogli: eliminare una pattuglia con la bozza dice che salva anche il resto", () => {
  assert.notEqual(ADMIN.eliminaPattugliaCorpoBozza, ADMIN.eliminaPattugliaCorpo);
  assert.match(ADMIN.eliminaPattugliaCorpoBozza, /altre modifiche/u);
  assert.doesNotMatch(ADMIN.eliminaPattugliaCorpo, /altre modifiche/u);
  assert.match(ADMIN.confermaEliminaPattuglia, /salva/u, "il tasto deve dire che salva");
});

// ---------------------------------------------------------------------------
// Segnaposto
// ---------------------------------------------------------------------------

test("segnaposto: ogni segnaposto di ADMIN è uno di quelli che le schermate riempiono", () => {
  for (const [key, value] of entries) {
    for (const name of placeholdersOf(value)) {
      assert.ok(
        Object.hasOwn(VALUES, name),
        `ADMIN.${key}: {${name}} non è fra ${Object.keys(VALUES).join(", ")} (un refuso, o un valore nuovo da dare a fillCopy)`,
      );
    }
  }
});

test("segnaposto: riempiti con i valori giusti non resta nessuna graffa", () => {
  for (const [key, value] of entries) {
    const filled = fillCopy(value, VALUES);
    assert.doesNotMatch(filled, /[{}]/u, `ADMIN.${key}: «${filled}»`);
  }
});

test("segnaposto: senza graffe fuori dai segnaposto", () => {
  for (const [key, value] of entries) {
    assert.doesNotMatch(value.replace(/\{\w+\}/gu, ""), /[{}]/u, `ADMIN.${key}: «${value}»`);
  }
});

test("segnaposto: i testi che ne hanno sono quelli attesi, con i segnaposto attesi", () => {
  const actual = Object.fromEntries(
    entries.map(([key, value]) => [key, placeholdersOf(value)]).filter(([, names]) => names.length > 0),
  );
  assert.deepEqual(actual, {
    annullaIscrizioneTitolo: ["nome"],
    annullaIscrizioneCorpo: ["attivita"],
    eliminaIscrizioneTitolo: ["nome"],
    eliminaAttivitaTitolo: ["attivita"],
    eliminaPattugliaTitolo: ["nome"],
    completamentoTitoloPiu: ["n"],
    confermaCompletamentoPiu: ["n"],
    eliminaPostTitolo: ["titolo"],
    eliminaGalleriaTitolo: ["titolo"],
  });
});

test("segnaposto: i titoli compilati dicono chi e che cosa", () => {
  assert.equal(
    fillCopy(ADMIN.annullaIscrizioneTitolo, VALUES),
    "Annullare l'iscrizione di Marco Rossi?",
  );
  assert.ok(
    fillCopy(ADMIN.annullaIscrizioneCorpo, VALUES).startsWith("Non risulterà più tra gli iscritti di «Campo estivo»."),
    fillCopy(ADMIN.annullaIscrizioneCorpo, VALUES),
  );
  assert.equal(fillCopy(ADMIN.eliminaIscrizioneTitolo, VALUES), "Eliminare l'iscrizione di Marco Rossi?");
  assert.equal(fillCopy(ADMIN.eliminaAttivitaTitolo, VALUES), "Eliminare «Campo estivo»?");
  assert.equal(fillCopy(ADMIN.eliminaPattugliaTitolo, VALUES), "Eliminare la pattuglia «Marco Rossi»?");
  assert.equal(fillCopy(ADMIN.eliminaPostTitolo, VALUES), "Eliminare il post «Serata di gala»?");
  assert.equal(fillCopy(ADMIN.eliminaGalleriaTitolo, VALUES), "Eliminare la galleria «Serata di gala»?");
});

test("segnaposto: un valore con $&, graffe o virgolette entra com'è", () => {
  for (const nome of ["$&", "{nome}", "«Marco»", 'Anna "la rossa"', "L'Aquila", "?"]) {
    const filled = fillCopy(ADMIN.eliminaIscrizioneTitolo, { nome });
    assert.equal(filled, `Eliminare l'iscrizione di ${nome}?`);
  }
});

test("segnaposto: un valore dimenticato si vede a schermo invece di sparire", () => {
  assert.equal(fillCopy(ADMIN.eliminaPostTitolo, {}), "Eliminare il post «{titolo}»?");
  assert.equal(fillCopy(ADMIN.eliminaPostTitolo, { nome: "Marco" }), "Eliminare il post «{titolo}»?");
});

// ---------------------------------------------------------------------------
// Singolare e plurale delle email
// ---------------------------------------------------------------------------

test("email: la versione al singolare non ha segnaposto e dice «1 email» a «il genitore»", () => {
  assert.deepEqual(placeholdersOf(ADMIN.completamentoTitoloUno), []);
  assert.deepEqual(placeholdersOf(ADMIN.confermaCompletamentoUno), []);

  assert.match(ADMIN.completamentoTitoloUno, /\b1 email\b/u);
  assert.match(ADMIN.completamentoTitoloUno, /\bgenitore\b/u);
  assert.doesNotMatch(ADMIN.completamentoTitoloUno, /genitori/u);
  assert.match(ADMIN.confermaCompletamentoUno, /\b1 email\b/u);
});

test("email: la versione al plurale ha {n} e dice «email» a «i genitori»", () => {
  assert.deepEqual(placeholdersOf(ADMIN.completamentoTitoloPiu), ["n"]);
  assert.deepEqual(placeholdersOf(ADMIN.confermaCompletamentoPiu), ["n"]);

  assert.match(ADMIN.completamentoTitoloPiu, /\bemail\b/u);
  assert.match(ADMIN.completamentoTitoloPiu, /\bgenitori\b/u);
  assert.doesNotMatch(ADMIN.completamentoTitoloPiu, /\bgenitore\b/u);
  assert.match(ADMIN.confermaCompletamentoPiu, /\bemail\b/u);
});

test("email: titolo e tasto dicono lo stesso numero, per ogni numero oltre uno", () => {
  for (const n of [2, 3, 10, 99, 1000]) {
    const title = fillCopy(ADMIN.completamentoTitoloPiu, { n: String(n) });
    const confirm = fillCopy(ADMIN.confermaCompletamentoPiu, { n: String(n) });
    assert.deepEqual(title.match(/\d+/gu), [String(n)], title);
    assert.deepEqual(confirm.match(/\d+/gu), [String(n)], confirm);
    assert.match(title, new RegExp(`\\b${n} email\\b`, "u"));
    assert.match(confirm, new RegExp(`\\b${n} email\\b`, "u"));
  }
});

test("email: titolo e tasto al singolare dicono lo stesso numero, uno", () => {
  assert.deepEqual(ADMIN.completamentoTitoloUno.match(/\d+/gu), ["1"]);
  assert.deepEqual(ADMIN.confermaCompletamentoUno.match(/\d+/gu), ["1"]);
});

test("email: il titolo al plurale riempito con 1 sarebbe sbagliato, per questo c'è il singolare", () => {
  // «Mandare 1 email ai genitori?»: la schermata sceglie il singolare quando il
  // numero è uno. Il tasto, invece, ha le stesse parole nelle due versioni.
  assert.notEqual(fillCopy(ADMIN.completamentoTitoloPiu, { n: "1" }), ADMIN.completamentoTitoloUno);
  assert.equal(fillCopy(ADMIN.confermaCompletamentoPiu, { n: "1" }), ADMIN.confermaCompletamentoUno);
});

test("email: il titolo e il tasto non nominano mai il numero in lettere", () => {
  for (const key of ["completamentoTitoloUno", "completamentoTitoloPiu", "confermaCompletamentoUno", "confermaCompletamentoPiu"]) {
    assert.doesNotMatch(ADMIN[key], /\b(?:una|un|due|tre|quattro|cinque)\s+email\b/iu, key);
  }
});

test("email: stesse parole al singolare e al plurale, a parte il numero e il genitore", () => {
  // Il singolare si ricava dal plurale cambiando solo ciò che cambia davvero.
  assert.equal(
    ADMIN.completamentoTitoloUno,
    fillCopy(ADMIN.completamentoTitoloPiu, { n: "1" }).replace("ai genitori", "al genitore"),
  );
  assert.equal(ADMIN.confermaCompletamentoUno, fillCopy(ADMIN.confermaCompletamentoPiu, { n: "1" }));
});

// ---------------------------------------------------------------------------
// Frasi riusate per riferimento
// ---------------------------------------------------------------------------

const REUSED = [
  ["tieniIscrizione", ANNULLA.tieniIscrizione],
  ["confermaAnnulla", ANNULLA.confermaAnnulla],
  ["annullamento", ANNULLA.annullamento],
  ["erroreAnnulla", ANNULLA.errore],
  ["eliminaDomandaTitolo", DOMANDE.eliminaTitolo],
  ["tieniDomanda", DOMANDE.tieni],
  ["confermaEliminaDomanda", DOMANDE.conferma],
  ["erroreEliminaDomanda", DOMANDE.errore],
  ["eliminazione", PAROLE.eliminazione],
  ["erroreRete", PAROLE.erroreRete],
];

test("riferimenti: le frasi già scritte altrove sono identiche all'originale", () => {
  assert.equal(ADMIN.tieniIscrizione, ANNULLA.tieniIscrizione);
  assert.equal(ADMIN.confermaAnnulla, ANNULLA.confermaAnnulla);
  assert.equal(ADMIN.annullamento, ANNULLA.annullamento);
  assert.equal(ADMIN.erroreAnnulla, ANNULLA.errore);
  assert.equal(ADMIN.eliminaDomandaTitolo, DOMANDE.eliminaTitolo);
  assert.equal(ADMIN.tieniDomanda, DOMANDE.tieni);
  assert.equal(ADMIN.confermaEliminaDomanda, DOMANDE.conferma);
  assert.equal(ADMIN.erroreEliminaDomanda, DOMANDE.errore);
  assert.equal(ADMIN.eliminazione, PAROLE.eliminazione);
  assert.equal(ADMIN.erroreRete, PAROLE.erroreRete);
});

test("riferimenti: «Eliminazione...» è una sola in PAROLE, ADMIN, DOMANDE e GALLERIA", () => {
  assert.equal(PAROLE.eliminazione, "Eliminazione...");
  assert.equal(ADMIN.eliminazione, PAROLE.eliminazione);
  assert.equal(DOMANDE.eliminazione, PAROLE.eliminazione);
  assert.equal(GALLERIA.eliminazione, PAROLE.eliminazione);
});

test("riferimenti: l'errore di rete è quello di PAROLE, come in DOMANDE e GALLERIA", () => {
  assert.equal(ADMIN.erroreRete, PAROLE.erroreRete);
  assert.equal(DOMANDE.erroreRete, PAROLE.erroreRete);
  assert.equal(GALLERIA.erroreRete, PAROLE.erroreRete);
});

test("riferimenti: annullare l'iscrizione ha le stesse parole dell'admin e del genitore (ANNULLA)", () => {
  // Il foglio dell'admin e quello del genitore usano la stessa scelta sicura,
  // lo stesso tasto, lo stesso testo di attesa e lo stesso errore.
  for (const [key, source] of REUSED.slice(0, 4)) {
    assert.equal(ADMIN[key], source, key);
  }
});

// Il sorgente di `src/copy/admin.ts`, per controllare che i riferimenti restino
// riferimenti e che nessuna frase di un altro file sia stata riscritta a mano.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COPY_DIR = path.join(ROOT, "src", "copy");
const adminSource = readFileSync(path.join(COPY_DIR, "admin.ts"), "utf8");
const asLiteral = (text) => ['"', "'", "`"].map((quote) => `${quote}${text}${quote}`);

test("riferimenti: admin.ts non riscrive a mano le frasi che riusa", () => {
  for (const [key, source] of REUSED) {
    const literal = asLiteral(source).find((candidate) => adminSource.includes(candidate));
    assert.equal(literal, undefined, `ADMIN.${key}: «${source}» è scritta a mano in src/copy/admin.ts, va riusata per riferimento`);
  }
});

// Le frasi degli altri file di src/copy/ (almeno otto caratteri) che admin.ts
// contiene come stringa scritta a mano invece che per riferimento.
async function findPhrasesWrittenByHand() {
  const files = readdirSync(COPY_DIR).filter((file) => file.endsWith(".ts") && file !== "admin.ts");
  assert.ok(files.length >= 6, `trovati solo ${files.length} file in src/copy/`);

  const copied = [];
  for (const file of files) {
    const module = await import(pathToFileURL(path.join(COPY_DIR, file)).href);
    for (const [name, copy] of Object.entries(module)) {
      if (typeof copy !== "object" || copy === null) continue;
      for (const [key, value] of Object.entries(copy)) {
        if (typeof value !== "string" || value.length < 8) continue;
        if (asLiteral(value).some((candidate) => adminSource.includes(candidate))) {
          copied.push(`${name}.${key} «${value}»`);
        }
      }
    }
  }
  return copied;
}

// «Salvataggio...» è scritta a mano in ADMIN, CHI_ISCRIVI e PROFILO: una frase
// sola per un concetto solo vorrebbe un'unica voce in PAROLE (come
// «Eliminazione...») e gli altri tre file che la riusano per riferimento.
test(
  "riferimenti: nessuna frase degli altri file di src/copy/ è riscritta a mano in admin.ts",
  {
    todo:
      "ADMIN.salvataggio ripete «Salvataggio...» di CHI_ISCRIVI e PROFILO: da portare in PAROLE " +
      "come PAROLE.eliminazione",
  },
  async () => {
    assert.deepEqual(
      await findPhrasesWrittenByHand(),
      [],
      "frasi già scritte altrove: in admin.ts vanno riusate per riferimento",
    );
  },
);

// ---------------------------------------------------------------------------
// Glossario
// ---------------------------------------------------------------------------

test("glossario: le forme vietate lette dal glossario riconoscono davvero una forma", () => {
  // Se la lista fosse vuota o sbagliata il controllo sotto non proverebbe niente.
  const flagged = (text) => FORBIDDEN_FORMS.filter(([, pattern]) => [...text.matchAll(pattern)].length > 0).map(([form]) => form);
  assert.deepEqual(flagged("Accedi con Google"), ["Accedi con Google"]);
  assert.deepEqual(flagged("Annulla iscrizione"), ["Annulla iscrizione"]);
  assert.deepEqual(flagged("Annulla l'iscrizione di Marco Rossi"), []);
});

test("glossario: nei testi dell'admin non compare nessuna forma vietata, nemmeno compilati", () => {
  assert.ok(FORBIDDEN_FORMS.length >= 10, "le forme vietate non sono state lette");
  for (const [key, value] of entries) {
    for (const text of [value, fillCopy(value, VALUES)]) {
      for (const [form, pattern] of FORBIDDEN_FORMS) {
        assert.equal([...text.matchAll(pattern)].length, 0, `ADMIN.${key}: «${text}» contiene «${form}»`);
      }
    }
  }
});

test("glossario: nei testi dell'admin non compaiono «minore» né «login»", () => {
  for (const [key, value] of entries) {
    assert.doesNotMatch(value, /minor[ei]/iu, `ADMIN.${key}: «${value}»`);
    assert.doesNotMatch(value, /login/iu, `ADMIN.${key}: «${value}»`);
  }
});

test("glossario: annullare l'iscrizione ha sempre l'articolo", () => {
  for (const [key, value] of entries) {
    assert.doesNotMatch(value, /\bannull\w*\s+iscrizione\b/iu, `ADMIN.${key}: «${value}»`);
  }
});

test("glossario: i testi di attesa usano tre puntini, mai il carattere «…»", () => {
  for (const [key, value] of entries) {
    assert.doesNotMatch(value, /…/u, `ADMIN.${key}: «${value}»`);
  }
});
