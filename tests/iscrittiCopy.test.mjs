import test from "node:test";
import assert from "node:assert/strict";

import { CHI_ISCRIVI } from "../src/copy/chiIscrivi.ts";
import { ISCRITTI } from "../src/copy/iscritti.ts";
import { ISCRIZIONE } from "../src/copy/iscrizione.ts";
import { PAROLE, fillCopy } from "../src/copy/parole.ts";
import { PROFILO } from "../src/copy/profilo.ts";
import { FORBIDDEN_FORMS } from "./support/glossaryForms.mjs";

// I testi dell'aggiunta a mano, della correzione dei dati e della
// riattivazione (`src/copy/iscritti.ts`, spec in `docs/ADMIN_ISCRITTI.md`).
// Controlli sul copy, non sulla logica (quella è in adminRegistration.test.mjs):
// forma dei testi, segnaposto, glossario («ha meno di 18 anni», mai «minore»,
// «minorenne» o «maggiorenne»), frasi riusate per riferimento, parole citate
// dalla spec.
//
// Comando: node --test tests/iscrittiCopy.test.mjs

const entries = Object.entries(ISCRITTI);
const segnapostoDi = (testo) => [...testo.matchAll(/\{(\w+)\}/gu)].map((match) => match[1]);

// ---------------------------------------------------------------------------
// Forma
// ---------------------------------------------------------------------------

test("ISCRITTI: ogni testo è una stringa non vuota, senza spazi ai bordi né a capo", () => {
  assert.ok(entries.length > 60, `ISCRITTI ha solo ${entries.length} testi`);
  for (const [chiave, valore] of entries) {
    assert.equal(typeof valore, "string", `ISCRITTI.${chiave} non è una stringa`);
    assert.ok(valore.trim().length > 0, `ISCRITTI.${chiave} è vuoto`);
    assert.equal(valore, valore.trim(), `ISCRITTI.${chiave} ha spazi ai bordi`);
    assert.doesNotMatch(valore, /[\n\t]/u, `ISCRITTI.${chiave} va a capo`);
    assert.doesNotMatch(valore, / {2}/u, `ISCRITTI.${chiave} ha due spazi di fila`);
  }
});

test("ISCRITTI: nessuna frase compare sotto due chiavi diverse", () => {
  const perTesto = new Map();
  for (const [chiave, valore] of entries) {
    perTesto.set(valore, [...(perTesto.get(valore) ?? []), chiave]);
  }
  const ripetute = [...perTesto.values()].filter((chiavi) => chiavi.length > 1);
  assert.deepEqual(ripetute, [], "frasi scritte due volte: una chiave sola, riusata per riferimento");
});

test("ISCRITTI: le frasi lunghe (sette parole o più) finiscono con il punto o il punto di domanda", () => {
  // Sotto le sette parole sono etichette di tasti e campi («Sì, riattiva e
  // manda la mail»), che non hanno il punto.
  const frasi = entries.filter(([, valore]) => valore.split(/\s+/u).length >= 7);
  assert.ok(frasi.length > 15, "controllo sulle frasi lunghe troppo corto per provare qualcosa");
  for (const [chiave, valore] of frasi) {
    assert.match(valore, /[.?]$/u, `ISCRITTI.${chiave}: «${valore}»`);
  }
  for (const [chiave, valore] of entries) {
    assert.doesNotMatch(valore, /\.\.\.\./u, `ISCRITTI.${chiave}`);
    assert.doesNotMatch(valore, /[,;:]$/u, `ISCRITTI.${chiave} finisce con la punteggiatura di mezzo`);
  }
});

test("ISCRITTI: i messaggi di errore sono frasi con il punto, anche quelli corti", () => {
  const errori = entries.filter(([chiave]) => chiave.startsWith("errore"));
  assert.ok(errori.length >= 8, `trovati solo ${errori.length} errori`);
  for (const [chiave, valore] of errori) {
    assert.match(valore, /\.$/u, `ISCRITTI.${chiave}: «${valore}»`);
  }
});

// ---------------------------------------------------------------------------
// Segnaposto
// ---------------------------------------------------------------------------

// Quali segnaposto ha ogni testo. Un testo nuovo con un segnaposto deve
// entrare qui: così nessuna parte variabile resta scritta a metà.
const SEGNAPOSTO_ATTESI = {
  anniConAutorizzazione: ["anni"],
  unitaVisibile: ["unita"],
  genitoreSotto: ["nome"],
  esitoAttiva: ["nome"],
  esitoAttesaMail: ["nome", "email"],
  esitoAttesaSenzaEmail: ["nome"],
  doppione: ["nome", "dettagli"],
  aggiuntaOk: ["nome"],
  aggiuntaDa: ["admin", "data"],
  aggiuntaIl: ["data"],
  chiediSotto: ["nome"],
  prima: ["valore"],
  modificaOk: ["nome"],
  effettoMenoDi18Mail: ["email"],
  effettoUnita: ["nuova", "vecchia"],
  effettoUnitaNuova: ["nuova"],
  effettoStanza: ["stanza"],
  riattivaTitolo: ["nome"],
  riattivataInAttesa: ["nome"],
};

test("ISCRITTI: ogni testo ha i segnaposto previsti, né più né meno", () => {
  for (const [chiave, valore] of entries) {
    assert.deepEqual(segnapostoDi(valore), SEGNAPOSTO_ATTESI[chiave] ?? [], `ISCRITTI.${chiave}: ${valore}`);
  }
  for (const chiave of Object.keys(SEGNAPOSTO_ATTESI)) {
    assert.ok(chiave in ISCRITTI, `ISCRITTI.${chiave} non esiste più`);
  }
});

test("ISCRITTI: riempiti i segnaposto non resta nessuna graffa", () => {
  const valori = {
    anni: "17",
    unita: "Rione Nord",
    nome: "Marco Rossi",
    email: "genitore@example.com",
    dettagli: "nato il 2010-05-01, Rione Nord",
    admin: "Paolo Celestini",
    data: "20 ottobre 2026",
    valore: "Rione Nord",
    nuova: "Rione Sud",
    vecchia: "Rione Nord",
    stanza: "Stanza 4",
  };
  for (const [chiave, valore] of entries) {
    const riempito = fillCopy(valore, valori);
    assert.doesNotMatch(riempito, /[{}]/u, `ISCRITTI.${chiave}: ${riempito}`);
    for (const nome of SEGNAPOSTO_ATTESI[chiave] ?? []) {
      assert.ok(riempito.includes(valori[nome]), `ISCRITTI.${chiave} non usa {${nome}}`);
    }
  }
});

test("ISCRITTI: un segnaposto senza valore resta visibile", () => {
  assert.equal(fillCopy(ISCRITTI.esitoAttesaMail, { nome: "Marco" }).includes("{email}"), true);
});

// ---------------------------------------------------------------------------
// Glossario
// ---------------------------------------------------------------------------

test("ISCRITTI: mai «minore», «minorenne» o «maggiorenne»: si dice «ha meno di 18 anni»", () => {
  for (const [chiave, valore] of entries) {
    assert.doesNotMatch(valore, /minor(?:e|i|enne|enni)\b/iu, `ISCRITTI.${chiave}: ${valore}`);
    assert.doesNotMatch(valore, /maggiorenn[ei]/iu, `ISCRITTI.${chiave}: ${valore}`);
  }
});

test("ISCRITTI: gli avvisi sull'età dicono 18 anni, come la regola", () => {
  assert.match(ISCRITTI.effettoMenoDi18Mail, /^Ha meno di 18 anni/u);
  assert.match(ISCRITTI.effettoMenoDi18SenzaEmail, /^Ha meno di 18 anni/u);
  assert.match(ISCRITTI.effettoDa18, /^Ha 18 anni o più/u);
  assert.match(ISCRITTI.erroreDataNascita, /1920/u, "il limite del 1920 è quello di isValidBirthDate");
});

test("ISCRITTI: nessuna forma vietata dal glossario", () => {
  for (const [chiave, valore] of entries) {
    for (const [etichetta, forma] of FORBIDDEN_FORMS) {
      assert.equal([...valore.matchAll(forma)].length, 0, `ISCRITTI.${chiave} contiene «${etichetta}»: ${valore}`);
    }
    assert.doesNotMatch(valore, /login/iu, `ISCRITTI.${chiave}: ${valore}`);
  }
});

test("ISCRITTI: gli accenti sono veri, mai l'apostrofo al posto della lettera accentata", () => {
  for (const [chiave, valore] of entries) {
    assert.doesNotMatch(
      valore,
      /\b(?:[Ee]|[Uu]nita|[Aa]ttivita|[Pp]iu|[Pp]uo|[Cc]ioe|[Gg]ia|[Pp]erche)['’]/u,
      `ISCRITTI.${chiave}: ${valore}`,
    );
  }
  assert.equal(ISCRITTI.unita, "Unità");
  assert.ok(ISCRITTI.effettoStanza.startsWith("È nella stanza"));
  assert.ok(ISCRITTI.riattivaCorpoRifiuto.includes("riceverà"));
});

// ---------------------------------------------------------------------------
// Una frase sola per un concetto solo
// ---------------------------------------------------------------------------

test("ISCRITTI: le parole che esistono già altrove si riusano per riferimento", () => {
  assert.equal(ISCRITTI.nome, PROFILO.nome);
  assert.equal(ISCRITTI.cognome, PROFILO.cognome);
  assert.equal(ISCRITTI.dataNascita, PROFILO.dataNascita);
  assert.equal(ISCRITTI.giovaneUomo, PROFILO.giovaneUomo);
  assert.equal(ISCRITTI.giovaneDonna, PROFILO.giovaneDonna);
  assert.equal(ISCRITTI.dirigente, PROFILO.dirigente);
  assert.equal(ISCRITTI.accompagnatore, PROFILO.accompagnatore);
  assert.equal(ISCRITTI.selezionaUnita, PROFILO.selezionaUnita);
  assert.equal(ISCRITTI.nessunaUnita, PROFILO.nessunaUnita);
  assert.equal(ISCRITTI.aiutoNessunaUnita, PROFILO.aiutoNessunaUnita);
  assert.equal(ISCRITTI.erroreDataNascita, PROFILO.erroreDataNonValida);
  assert.equal(ISCRITTI.unita, CHI_ISCRIVI.unita);
  assert.equal(ISCRITTI.annulla, CHI_ISCRIVI.annulla);
  assert.equal(ISCRITTI.salva, CHI_ISCRIVI.salva);
  assert.equal(ISCRITTI.erroreUnitaScelta, CHI_ISCRIVI.erroreUnita);
  assert.equal(ISCRITTI.continuaACompilare, ISCRIZIONE.continuaACompilare);
  assert.equal(ISCRITTI.salvataggio, PAROLE.salvataggio);
  assert.equal(ISCRITTI.erroreRete, PAROLE.erroreRete);
});

test("ISCRITTI: il tasto dice cosa fa, e la mail si nomina solo quando parte", () => {
  assert.equal(ISCRITTI.aggiungi, "Aggiungi");
  assert.equal(ISCRITTI.aggiungiEMail, `${ISCRITTI.aggiungi} e manda la mail`);
  assert.equal(ISCRITTI.salvaEMail, `${ISCRITTI.salva} e manda la mail`);
  assert.doesNotMatch(ISCRITTI.aggiungi, /mail/iu);
  assert.doesNotMatch(ISCRITTI.salva, /mail/iu);
  assert.match(ISCRITTI.confermaRiattiva, /mail/iu);
  assert.match(ISCRITTI.riattivaCorpoMail, /mail/iu);
  assert.match(ISCRITTI.riattivaCorpoRifiuto, /mail/iu);
});

test("ISCRITTI: il rifiuto del genitore e il rifiuto riaperto si nominano nel foglio di conferma", () => {
  assert.equal(
    ISCRITTI.riattivaCorpoRifiuto,
    "Il genitore aveva rifiutato: riceverà una nuova mail per autorizzare.",
  );
  assert.ok(ISCRITTI.tieniAnnullata.length > 0);
  assert.match(ISCRITTI.riattivaTitolo, /\?$/u, "il titolo del foglio è una domanda");
  assert.match(ISCRITTI.esciSenzaSalvareTitolo, /\?$/u, "il titolo del foglio è una domanda");
});

// ---------------------------------------------------------------------------
// Parole citate dalla spec
// ---------------------------------------------------------------------------

test("ISCRITTI: i testi citati nella spec ci sono, con quelle parole", () => {
  const citati = {
    aggiungiAMano: "Aggiungi a mano",
    pillAMano: "A mano",
    pillMancaEmail: "Manca l'email del genitore",
    aggiungiEMail: "Aggiungi e manda la mail",
    salvaEMail: "Salva e manda la mail",
    apriLaSuaIscrizione: "Apri la sua iscrizione",
    aggiungiLoStesso: "Aggiungi lo stesso",
    chiediAutorizzazione: "Chiedi l'autorizzazione",
    modificaDati: "Modifica dati",
    salvando: "Salvando",
    genitore: "Genitore",
  };
  for (const [chiave, atteso] of Object.entries(citati)) {
    assert.equal(ISCRITTI[chiave], atteso, chiave);
  }
  assert.equal(fillCopy(ISCRITTI.aggiuntaDa, { admin: "Paolo", data: "20/10/2026" }), "Aggiunta a mano da Paolo, il 20/10/2026.");
  assert.ok(ISCRITTI.mancaEmailTitolo.startsWith("Manca l'email del genitore"));
});

test("ISCRITTI: gli avvisi di «Cosa succede se cambiano…» dicono quello che dice la spec", () => {
  assert.match(ISCRITTI.effettoMenoDi18Mail, /passa in attesa del genitore/u);
  assert.match(ISCRITTI.effettoMenoDi18Mail, /parte la mail a/u);
  assert.match(ISCRITTI.effettoMenoDi18SenzaEmail, /Manca l'email/u);
  assert.match(ISCRITTI.effettoMenoDi18SenzaEmail, /chiedila dopo/u);
  assert.match(ISCRITTI.effettoDa18, /torna attiva/u);
  assert.match(ISCRITTI.effettoDa18, /smette di valere/u);
  assert.match(ISCRITTI.effettoFirmaResta, /firmato/u);
  assert.match(ISCRITTI.effettoFirmaResta, /di prima/u);
  assert.match(ISCRITTI.effettoFotoGenitore, /decide il genitore/u);
  assert.match(ISCRITTI.effettoFotoPersona, /decide la persona/u);
  assert.match(
    fillCopy(ISCRITTI.effettoUnita, { nuova: "Rione Sud", vecchia: "Rione Nord" }),
    /dirigenti di Rione Sud, non più quelli di Rione Nord/u,
  );
  assert.match(fillCopy(ISCRITTI.effettoUnitaNuova, { nuova: "Rione Sud" }), /dirigenti di Rione Sud/u);
  assert.match(ISCRITTI.effettoNomeFirmato, /firmato resta con il nome di prima/u);
  assert.match(fillCopy(ISCRITTI.effettoStanza, { stanza: "Stanza 4" }), /Stanza 4.*piano stanze/u);
  assert.match(ISCRITTI.effettoProfilo, /profilo/u);
  assert.match(ISCRITTI.effettoProfilo, /prossima iscrizione/u);
});

test("ISCRITTI: gli esiti dell'aggiunta distinguono i tre casi della tabella B", () => {
  // Adulto o senza autorizzazione: nessuna parola sul genitore.
  assert.doesNotMatch(ISCRITTI.esitoAttiva, /genitore|mail/iu);
  // Con l'email: dice che la mail parte e a chi.
  assert.match(ISCRITTI.esitoAttesaMail, /in attesa del genitore/u);
  assert.match(ISCRITTI.esitoAttesaMail, /parte subito a \{email\}/u);
  // Senza email: dice che non parte niente e dove si rimedia.
  assert.match(ISCRITTI.esitoAttesaSenzaEmail, /in attesa del genitore/u);
  assert.match(ISCRITTI.esitoAttesaSenzaEmail, /non parte/u);
  assert.match(ISCRITTI.esitoAttesaSenzaEmail, /scheda/u);
  assert.deepEqual(segnapostoDi(ISCRITTI.esitoAttesaSenzaEmail), ["nome"], "senza email non c'è nessun indirizzo da nominare");
});
