import test from "node:test";
import assert from "node:assert/strict";

import { GUARDIA } from "../src/copy/guardia.ts";
import { ADULT_GUARD_AGE } from "../src/utils/childChoice.ts";
import {
  clearAdultGuardConfirmations,
  getAdultGuardAge,
  getAdultGuardKey,
  getAdultGuardSentence,
  isAdultCategory,
  needsExistingAccountGuard,
  readAdultGuardConfirmations,
  writeAdultGuardConfirmation,
} from "../src/utils/adultGuard.ts";

// Guardia adulto (docs/FLUSSO_GENITORE.md, G, "Utente che sbaglia" e scelta
// G1): chi si iscrive da sé a un'attività per i giovani con almeno 19 anni
// compiuti il PRIMO GIORNO dell'attività sceglie chi partecipa. Qui le parti
// pure: l'età che fa scattare la guardia, quando scatta in cima al modulo, la
// frase "Il 24 aprile 2027 avrai 47 anni." e la conferma "Confermo, partecipo
// io come giovane" in sessionStorage.
//
// I valori attesi vengono dalla spec, non dal codice: la soglia è 19 anni
// compiuti il primo giorno (G1: a 18 anni si può essere ancora nei giovani), la
// frase è quella scritta in G, i dirigenti e gli accompagnatori non passano
// dalla guardia, e la conferma vale per account, attività e data di nascita.
//
// Le date si costruiscono con `new Date(anno, mese, giorno, ora)` locali: i casi
// valgono in qualunque fuso giri il processo.
//
// Comando: node --test tests/adultGuard.test.mjs

// Primo giorno di un'attività di esempio: sabato 24 aprile 2027 (spec, G).
const FIRST_DAY = new Date(2027, 3, 24);

// ---------------------------------------------------------------------------
// getAdultGuardAge
// ---------------------------------------------------------------------------

test("soglia della guardia: 19 anni (G1)", () => {
  assert.equal(ADULT_GUARD_AGE, 19);
});

test("getAdultGuardAge: 18 anni e 364 giorni il primo giorno → la guardia non scatta", () => {
  // Compie 19 anni il 25 aprile 2027, il giorno dopo l'inizio.
  assert.equal(getAdultGuardAge("2008-04-25", FIRST_DAY), null);
});

test("getAdultGuardAge: compie 19 anni proprio il primo giorno → scatta, con 19", () => {
  assert.equal(getAdultGuardAge("2008-04-24", FIRST_DAY), 19);
});

test("getAdultGuardAge: compie 19 anni il giorno prima del primo giorno → scatta, con 19", () => {
  assert.equal(getAdultGuardAge("2008-04-23", FIRST_DAY), 19);
});

test("getAdultGuardAge: compie 19 anni il giorno dopo il primo giorno → non scatta", () => {
  // Attività che comincia il 23 aprile: chi è nato il 24 aprile 2008 compie
  // 19 anni il giorno dopo (e il primo giorno ne ha 18).
  assert.equal(getAdultGuardAge("2008-04-24", new Date(2027, 3, 23)), null);
});

test("getAdultGuardAge: «18 anni compiuti, ancora nei giovani» (spec) → la guardia non scatta", () => {
  assert.equal(getAdultGuardAge("2009-01-01", FIRST_DAY), null);
  assert.equal(getAdultGuardAge("2009-04-24", FIRST_DAY), null);
  assert.equal(getAdultGuardAge("2009-04-25", FIRST_DAY), null);
});

test("getAdultGuardAge: giovani veri e ragazzi sotto i 18 → non scatta", () => {
  for (const birthDate of ["2013-05-02", "2011-03-14", "2010-09-01", "2009-12-31"]) {
    assert.equal(getAdultGuardAge(birthDate, FIRST_DAY), null, birthDate);
  }
});

test("getAdultGuardAge: dà l'età compiuta il primo giorno, non l'anno di nascita", () => {
  // L'esempio della spec: «Il 24 aprile 2027 avrai 47 anni.»
  assert.equal(getAdultGuardAge("1980-04-24", FIRST_DAY), 47);
  // Il compleanno è il giorno dopo: 46 anni compiuti, non 47.
  assert.equal(getAdultGuardAge("1980-04-25", FIRST_DAY), 46);
  assert.equal(getAdultGuardAge("1980-12-31", FIRST_DAY), 46);
  assert.equal(getAdultGuardAge("1980-01-01", FIRST_DAY), 47);
  assert.equal(getAdultGuardAge("1920-01-01", FIRST_DAY), 107);
});

test("getAdultGuardAge: l'ora del primo giorno non conta, vale il giorno di calendario", () => {
  for (const hour of [0, 7, 12, 23]) {
    const firstDay = new Date(2027, 3, 24, hour, hour === 23 ? 59 : 0);
    assert.equal(getAdultGuardAge("2008-04-24", firstDay), 19, `ore ${hour}`);
    assert.equal(getAdultGuardAge("2008-04-25", firstDay), null, `ore ${hour}`);
  }
});

test("getAdultGuardAge: la soglia segue il primo giorno dell'attività, non oggi", () => {
  // Nato il 1º settembre 2008: compie 19 anni il 1º settembre 2027.
  assert.equal(getAdultGuardAge("2008-09-01", new Date(2027, 7, 31)), null);
  assert.equal(getAdultGuardAge("2008-09-01", new Date(2027, 8, 1)), 19);
  assert.equal(getAdultGuardAge("2008-09-01", new Date(2027, 8, 2)), 19);
  // Cambia solo la data dell'attività: stessa persona, altro esito.
  assert.equal(getAdultGuardAge("2008-09-01", new Date(2026, 8, 1)), null);
});

test("getAdultGuardAge: 29 febbraio, giorni senza ambiguità", () => {
  // Nato il 29 febbraio 2008 (anno bisestile).
  const birth = "2008-02-29";
  // Il 27 febbraio 2027 (non bisestile) ha ancora 18 anni.
  assert.equal(getAdultGuardAge(birth, new Date(2027, 1, 27)), null);
  // Dal 1º marzo 2027 ne ha 19 in ogni convenzione.
  assert.equal(getAdultGuardAge(birth, new Date(2027, 2, 1)), 19);
  assert.equal(getAdultGuardAge(birth, new Date(2027, 2, 2)), 19);
  // Il giorno prima del compleanno vero (28 febbraio 2028) ne ha 19, il 29
  // febbraio 2028 (bisestile) ne compie 20.
  assert.equal(getAdultGuardAge(birth, new Date(2028, 1, 28)), 19);
  assert.equal(getAdultGuardAge(birth, new Date(2028, 1, 29)), 20);
  // Il 28 febbraio 2027 la spec non dice se sia già il compleanno: non si prova.
  // Una data del 29 febbraio in un anno non bisestile non esiste.
  assert.equal(getAdultGuardAge("2007-02-29", FIRST_DAY), null);
});

test("getAdultGuardAge: data di nascita vuota, mancante o non valida → null", () => {
  for (const value of [
    "",
    "   ",
    null,
    undefined,
    "abc",
    "2008",
    "2008-04",
    "2008-4-24",
    "24/04/2008",
    "2008/04/24",
    "2008-13-01",
    "2008-00-10",
    "2008-04-31",
    "2008-02-30",
    "2007-02-29",
    "0000-00-00",
  ]) {
    assert.equal(getAdultGuardAge(value, FIRST_DAY), null, `data ${JSON.stringify(value)}`);
  }
});

test("getAdultGuardAge: data di nascita nel futuro rispetto al primo giorno → null", () => {
  for (const birthDate of ["2027-04-25", "2027-12-31", "2030-01-01", "2099-01-01"]) {
    assert.equal(getAdultGuardAge(birthDate, FIRST_DAY), null, birthDate);
  }
  // Nato il primo giorno stesso: zero anni.
  assert.equal(getAdultGuardAge("2027-04-24", FIRST_DAY), null);
});

// ---------------------------------------------------------------------------
// isAdultCategory
// ---------------------------------------------------------------------------

test("isAdultCategory: dirigenti e accompagnatori sono adulti per definizione", () => {
  assert.equal(isAdultCategory("dirigente"), true);
  assert.equal(isAdultCategory("accompagnatore"), true);
});

test("isAdultCategory: giovani e categoria assente non lo sono", () => {
  for (const category of ["giovane_uomo", "giovane_donna", "", null, undefined]) {
    assert.equal(isAdultCategory(category), false, `categoria ${JSON.stringify(category)}`);
  }
});

// ---------------------------------------------------------------------------
// needsExistingAccountGuard (F: partecipante già entrato)
// ---------------------------------------------------------------------------

// Una Giovane Donna nata nel 1980: partecipante completa, senza iscrizione, che
// non ha ancora confermato. Con questi valori la guardia scatta.
const GUARD_INPUT = {
  role: "participant",
  profileComplete: true,
  category: "giovane_donna",
  birthDate: "1980-04-24",
  firstDay: FIRST_DAY,
  hasOwnRegistration: false,
  confirmed: false,
};

test("needsExistingAccountGuard: partecipante completo, giovane, 19+ anni, senza iscrizione → scatta", () => {
  assert.equal(needsExistingAccountGuard(GUARD_INPUT), true);
  assert.equal(needsExistingAccountGuard({ ...GUARD_INPUT, category: "giovane_uomo" }), true);
});

test("needsExistingAccountGuard: scatta anche compiendo 19 anni proprio il primo giorno", () => {
  assert.equal(needsExistingAccountGuard({ ...GUARD_INPUT, birthDate: "2008-04-24" }), true);
});

test("needsExistingAccountGuard: ogni condizione da sola la spegne", () => {
  const cases = [
    ["ruolo parent", { role: "parent" }],
    ["ruolo unit_leader", { role: "unit_leader" }],
    ["ruolo admin", { role: "admin" }],
    ["ruolo super_admin", { role: "super_admin" }],
    ["ruolo vuoto", { role: "" }],
    ["profilo incompleto", { profileComplete: false }],
    ["iscrizione già fatta (quella si modifica)", { hasOwnRegistration: true }],
    ["già confermato per questa data", { confirmed: true }],
    ["categoria dirigente", { category: "dirigente" }],
    ["categoria accompagnatore", { category: "accompagnatore" }],
    ["18 anni e 364 giorni", { birthDate: "2008-04-25" }],
    ["data di nascita da ragazzo", { birthDate: "2011-03-14" }],
    ["data di nascita vuota", { birthDate: "" }],
    ["data di nascita mancante", { birthDate: null }],
    ["data di nascita impossibile", { birthDate: "1980-02-30" }],
  ];

  for (const [label, override] of cases) {
    assert.equal(needsExistingAccountGuard({ ...GUARD_INPUT, ...override }), false, label);
  }
});

test("needsExistingAccountGuard: l'età si conta al primo giorno, non oggi", () => {
  // Ragazza che compie 19 anni il 1º settembre 2027: attività ad aprile
  // (ne ha 18) senza guardia, attività a settembre con la guardia.
  const input = { ...GUARD_INPUT, birthDate: "2008-09-01" };
  assert.equal(needsExistingAccountGuard({ ...input, firstDay: new Date(2027, 3, 24) }), false);
  assert.equal(needsExistingAccountGuard({ ...input, firstDay: new Date(2027, 8, 1) }), true);
});

// ---------------------------------------------------------------------------
// getAdultGuardSentence
// ---------------------------------------------------------------------------

test("getAdultGuardSentence: la frase della spec, «Il 24 aprile 2027 avrai 47 anni.»", () => {
  const sentence = getAdultGuardSentence(47, FIRST_DAY);
  assert.equal(sentence.text, "Il 24 aprile 2027 avrai 47 anni.");
});

test("getAdultGuardSentence: le parti dividono la frase dove va il grassetto", () => {
  const { before, anni, after, text } = getAdultGuardSentence(47, FIRST_DAY);
  assert.equal(before, "Il 24 aprile 2027 avrai ");
  assert.equal(anni, "47 anni");
  assert.equal(after, ".");
  assert.equal(`${before}${anni}${after}`, text);
});

test("getAdultGuardSentence: 19 anni, la soglia", () => {
  assert.equal(getAdultGuardSentence(19, FIRST_DAY).text, "Il 24 aprile 2027 avrai 19 anni.");
  assert.equal(getAdultGuardSentence(19, FIRST_DAY).anni, "19 anni");
});

test("getAdultGuardSentence: il primo giorno del mese", () => {
  // La spec non dice se «1» o «1º»: valgono tutte e due.
  const { text } = getAdultGuardSentence(19, new Date(2027, 4, 1));
  assert.match(text, /^Il 1º? maggio 2027 avrai 19 anni\.$/u, text);
});

test("getAdultGuardSentence: il mese in italiano, minuscolo, ogni mese", () => {
  const months = [
    "gennaio",
    "febbraio",
    "marzo",
    "aprile",
    "maggio",
    "giugno",
    "luglio",
    "agosto",
    "settembre",
    "ottobre",
    "novembre",
    "dicembre",
  ];

  months.forEach((month, index) => {
    const { text } = getAdultGuardSentence(30, new Date(2027, index, 15));
    assert.equal(text, `Il 15 ${month} 2027 avrai 30 anni.`);
  });
});

test("getAdultGuardSentence: ultimo giorno dell'anno e anno nuovo", () => {
  assert.equal(
    getAdultGuardSentence(25, new Date(2027, 11, 31)).text,
    "Il 31 dicembre 2027 avrai 25 anni.",
  );
  assert.match(
    getAdultGuardSentence(25, new Date(2028, 0, 1)).text,
    /^Il 1º? gennaio 2028 avrai 25 anni\.$/u,
  );
});

test("getAdultGuardSentence: l'ora del primo giorno non cambia la frase", () => {
  assert.equal(
    getAdultGuardSentence(47, new Date(2027, 3, 24, 23, 59)).text,
    "Il 24 aprile 2027 avrai 47 anni.",
  );
});

test("getAdultGuardSentence: nessun segnaposto resta nel testo", () => {
  const { before, anni, after, text } = getAdultGuardSentence(47, FIRST_DAY);
  for (const part of [before, anni, after, text]) {
    assert.doesNotMatch(part, /[{}]/u, part);
  }
});

test("GUARDIA: i testi della scheda sono quelli della spec", () => {
  assert.equal(GUARDIA.titolo, "Attività per i giovani");
  assert.equal(GUARDIA.chiPartecipa, "Chi partecipa?");
  assert.equal(GUARDIA.iscrivoFiglio, "Iscrivo mio figlio o mia figlia");
  assert.equal(GUARDIA.dirigente, "Partecipo come dirigente o accompagnatore");
  assert.equal(GUARDIA.dataSbagliata, "Ho sbagliato la data");
  assert.equal(GUARDIA.confermo, "Confermo, partecipo io come giovane");
});

// ---------------------------------------------------------------------------
// Conferma «Confermo, partecipo io come giovane» (sessionStorage)
// ---------------------------------------------------------------------------

/** sessionStorage finto: una Map, con i tre metodi che usa il codice. */
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** Storage che lancia sempre (Safari in navigazione privata, quota piena). */
function makeThrowingStorage(methods = ["getItem", "setItem", "removeItem"]) {
  const fail = () => {
    throw new Error("storage non disponibile");
  };
  const base = makeStorage();
  return {
    getItem: methods.includes("getItem") ? fail : base.getItem,
    setItem: methods.includes("setItem") ? fail : base.setItem,
    removeItem: methods.includes("removeItem") ? fail : base.removeItem,
  };
}

/** Nome della voce che il codice scrive nello storage (letto, non copiato). */
const STORAGE_NAME = (() => {
  const probe = makeStorage();
  writeAdultGuardConfirmation("sonda", probe);
  return [...probe.map.keys()][0];
})();

/** L'unica voce che il codice scrive nello storage, già letta come JSON. */
function onlyStoredValue(storage) {
  assert.equal(storage.map.size, 1, `voci nello storage: ${[...storage.map.keys()].join(", ")}`);
  return JSON.parse([...storage.map.values()][0]);
}

test("getAdultGuardKey: una chiave per account, attività e data di nascita", () => {
  const base = { uid: "uid-1", eventId: "evento-1", birthDate: "1980-04-24" };
  const key = getAdultGuardKey(base);

  assert.equal(typeof key, "string");
  assert.equal(getAdultGuardKey({ ...base }), key, "stessi valori, stessa chiave");

  for (const override of [
    { uid: "uid-2" },
    { eventId: "evento-2" },
    { birthDate: "1980-04-25" },
  ]) {
    assert.notEqual(getAdultGuardKey({ ...base, ...override }), key, JSON.stringify(override));
  }

  // Ognuno dei tre valori entra nella chiave: nessuno è perso per strada.
  for (const value of Object.values(base)) {
    assert.ok(key.includes(value), `${key} non contiene ${value}`);
  }
});

test("conferma: senza niente scritto, l'insieme è vuoto", () => {
  const confirmations = readAdultGuardConfirmations(makeStorage());
  assert.ok(confirmations instanceof Set);
  assert.equal(confirmations.size, 0);
});

test("conferma: scritta e riletta, vale per quella chiave e per nessun'altra", () => {
  const storage = makeStorage();
  const confirmed = { uid: "uid-1", eventId: "evento-1", birthDate: "1980-04-24" };
  writeAdultGuardConfirmation(getAdultGuardKey(confirmed), storage);

  const confirmations = readAdultGuardConfirmations(storage);
  assert.equal(confirmations.has(getAdultGuardKey(confirmed)), true);

  // Cambiando la data di nascita la guardia torna (G: «vale per account,
  // attività e data»), così come cambiando attività o account.
  for (const override of [
    { birthDate: "1981-04-24" },
    { eventId: "evento-2" },
    { uid: "uid-2" },
  ]) {
    assert.equal(
      confirmations.has(getAdultGuardKey({ ...confirmed, ...override })),
      false,
      JSON.stringify(override),
    );
  }
});

test("conferma: più chiavi convivono", () => {
  const storage = makeStorage();
  writeAdultGuardConfirmation("a", storage);
  writeAdultGuardConfirmation("b", storage);
  writeAdultGuardConfirmation("c", storage);

  assert.deepEqual([...readAdultGuardConfirmations(storage)].sort(), ["a", "b", "c"]);
});

test("conferma: la scrittura è idempotente, la stessa chiave non si duplica", () => {
  const storage = makeStorage();
  writeAdultGuardConfirmation("a", storage);
  writeAdultGuardConfirmation("a", storage);
  writeAdultGuardConfirmation("a", storage);

  assert.deepEqual(onlyStoredValue(storage), ["a"]);
  assert.deepEqual([...readAdultGuardConfirmations(storage)], ["a"]);
});

test("conferma: riscrivere una chiave già presente non fa perdere le altre", () => {
  const storage = makeStorage();
  writeAdultGuardConfirmation("a", storage);
  writeAdultGuardConfirmation("b", storage);
  writeAdultGuardConfirmation("a", storage);

  assert.deepEqual([...readAdultGuardConfirmations(storage)].sort(), ["a", "b"]);
});

test("conferma: tetto di 20 voci, restano le ultime", () => {
  const storage = makeStorage();
  for (let index = 1; index <= 25; index += 1) {
    writeAdultGuardConfirmation(`chiave-${index}`, storage);
  }

  const confirmations = readAdultGuardConfirmations(storage);
  assert.equal(confirmations.size, 20);
  assert.equal(onlyStoredValue(storage).length, 20);

  // Le cinque più vecchie escono, le venti più recenti restano.
  for (let index = 1; index <= 5; index += 1) {
    assert.equal(confirmations.has(`chiave-${index}`), false, `chiave-${index}`);
  }
  for (let index = 6; index <= 25; index += 1) {
    assert.equal(confirmations.has(`chiave-${index}`), true, `chiave-${index}`);
  }
});

test("conferma: a 20 voci piene, una chiave già presente non toglie niente", () => {
  const storage = makeStorage();
  for (let index = 1; index <= 20; index += 1) {
    writeAdultGuardConfirmation(`chiave-${index}`, storage);
  }
  writeAdultGuardConfirmation("chiave-7", storage);

  const confirmations = readAdultGuardConfirmations(storage);
  assert.equal(confirmations.size, 20);
  for (let index = 1; index <= 20; index += 1) {
    assert.equal(confirmations.has(`chiave-${index}`), true, `chiave-${index}`);
  }
});

test("conferma: la ventunesima chiave toglie la più vecchia e tiene la nuova", () => {
  const storage = makeStorage();
  for (let index = 1; index <= 20; index += 1) {
    writeAdultGuardConfirmation(`chiave-${index}`, storage);
  }
  writeAdultGuardConfirmation("nuova", storage);

  const confirmations = readAdultGuardConfirmations(storage);
  assert.equal(confirmations.size, 20);
  assert.equal(confirmations.has("nuova"), true);
  assert.equal(confirmations.has("chiave-1"), false);
  assert.equal(confirmations.has("chiave-2"), true);
});

test("conferma: JSON rotto → nessuna eccezione, insieme vuoto", () => {
  for (const raw of ["{non json", "[", "]]", "undefined", "NaN", "'a'", "\u0000"]) {
    const storage = makeStorage({ [STORAGE_NAME]: raw });

    assert.doesNotThrow(() => readAdultGuardConfirmations(storage), raw);
    assert.equal(readAdultGuardConfirmations(storage).size, 0, raw);
  }
});

test("conferma: dopo un JSON rotto una nuova conferma si scrive e si rilegge", () => {
  const storage = makeStorage({ [STORAGE_NAME]: "{non json" });

  assert.doesNotThrow(() => writeAdultGuardConfirmation("b", storage));
  assert.deepEqual([...readAdultGuardConfirmations(storage)], ["b"]);
});

test("conferma: JSON valido ma non un elenco di stringhe → vuoto o solo le stringhe", () => {
  for (const raw of ["null", "42", '"testo"', "true", '{"a":1}', "[]"]) {
    const storage = makeStorage({ [STORAGE_NAME]: raw });
    assert.doesNotThrow(() => readAdultGuardConfirmations(storage), raw);
    assert.equal(readAdultGuardConfirmations(storage).size, 0, raw);
  }

  const mixed = makeStorage({
    [STORAGE_NAME]: JSON.stringify([1, null, "buona", { a: 1 }, ["x"], "altra", true]),
  });
  assert.deepEqual([...readAdultGuardConfirmations(mixed)].sort(), ["altra", "buona"]);
});

test("conferma: uno storage che lancia non lancia mai verso la pagina", () => {
  for (const methods of [
    ["getItem"],
    ["setItem"],
    ["removeItem"],
    ["getItem", "setItem", "removeItem"],
  ]) {
    const label = methods.join("+");
    const storage = makeThrowingStorage(methods);

    assert.doesNotThrow(() => readAdultGuardConfirmations(storage), `read ${label}`);
    assert.doesNotThrow(() => writeAdultGuardConfirmation("a", storage), `write ${label}`);
    assert.doesNotThrow(() => clearAdultGuardConfirmations(storage), `clear ${label}`);
  }
});

test("conferma: con getItem che lancia l'insieme è vuoto", () => {
  const storage = makeThrowingStorage(["getItem"]);
  const confirmations = readAdultGuardConfirmations(storage);
  assert.ok(confirmations instanceof Set);
  assert.equal(confirmations.size, 0);
});

test("conferma: senza storage (null) niente eccezioni e insieme vuoto", () => {
  assert.equal(readAdultGuardConfirmations(null).size, 0);
  assert.doesNotThrow(() => writeAdultGuardConfirmation("a", null));
  assert.doesNotThrow(() => clearAdultGuardConfirmations(null));
  assert.equal(readAdultGuardConfirmations(null).size, 0);
});

test("conferma: fuori dal browser (nessun window) le tre funzioni non fanno niente", () => {
  assert.equal(typeof window, "undefined");
  assert.equal(readAdultGuardConfirmations().size, 0);
  assert.doesNotThrow(() => writeAdultGuardConfirmation("a"));
  assert.doesNotThrow(() => clearAdultGuardConfirmations());
  assert.equal(readAdultGuardConfirmations().size, 0);
});

test("conferma: senza argomento usa window.sessionStorage", () => {
  const storage = makeStorage();
  globalThis.window = { sessionStorage: storage };

  try {
    writeAdultGuardConfirmation("a");
    assert.equal(readAdultGuardConfirmations().has("a"), true);
    assert.equal(readAdultGuardConfirmations(storage).has("a"), true);

    clearAdultGuardConfirmations();
    assert.equal(readAdultGuardConfirmations().size, 0);
    assert.equal(storage.map.size, 0);
  } finally {
    delete globalThis.window;
  }
});

test("conferma: window.sessionStorage che lancia all'accesso (storage bloccato) non rompe niente", () => {
  globalThis.window = {
    get sessionStorage() {
      throw new Error("SecurityError");
    },
  };

  try {
    assert.doesNotThrow(() => readAdultGuardConfirmations());
    assert.equal(readAdultGuardConfirmations().size, 0);
    assert.doesNotThrow(() => writeAdultGuardConfirmation("a"));
    assert.doesNotThrow(() => clearAdultGuardConfirmations());
  } finally {
    delete globalThis.window;
  }
});

test("guardia e conferma insieme: confermata una data la guardia tace, con un'altra data torna", () => {
  // Come la pagina: `confirmed` dipende da account, attività e data di nascita.
  const storage = makeStorage();
  const account = { uid: "uid-1", eventId: "evento-1" };
  const guardFor = (birthDate, who = account) =>
    needsExistingAccountGuard({
      ...GUARD_INPUT,
      birthDate,
      confirmed: readAdultGuardConfirmations(storage).has(getAdultGuardKey({ ...who, birthDate })),
    });

  assert.equal(guardFor("1980-04-24"), true, "prima della conferma");

  writeAdultGuardConfirmation(getAdultGuardKey({ ...account, birthDate: "1980-04-24" }), storage);
  assert.equal(guardFor("1980-04-24"), false, "dopo «Confermo, partecipo io come giovane»");

  // «Ho sbagliato la data»: un'altra data, ancora da 19+ anni, rimette la guardia.
  assert.equal(guardFor("1981-04-24"), true, "altra data di nascita");
  // Un altro account o un'altra attività non ereditano la conferma.
  assert.equal(guardFor("1980-04-24", { ...account, uid: "uid-2" }), true, "altro account");
  assert.equal(guardFor("1980-04-24", { ...account, eventId: "evento-2" }), true, "altra attività");

  // Uscire dall'account cancella le conferme: la guardia torna.
  clearAdultGuardConfirmations(storage);
  assert.equal(guardFor("1980-04-24"), true, "dopo clear");
});

test("conferma: clear toglie tutte le conferme e solo quelle", () => {
  const storage = makeStorage({ "un-altra-voce": "resta" });
  writeAdultGuardConfirmation("a", storage);
  writeAdultGuardConfirmation("b", storage);
  assert.equal(readAdultGuardConfirmations(storage).size, 2);

  clearAdultGuardConfirmations(storage);

  assert.equal(readAdultGuardConfirmations(storage).size, 0);
  assert.equal(storage.map.get("un-altra-voce"), "resta");
  assert.equal(storage.map.size, 1);
});

test("conferma: clear su uno storage vuoto non fa niente", () => {
  const storage = makeStorage();
  assert.doesNotThrow(() => clearAdultGuardConfirmations(storage));
  assert.equal(storage.map.size, 0);
});

test("conferma: dopo clear si può confermare di nuovo", () => {
  const storage = makeStorage();
  writeAdultGuardConfirmation("a", storage);
  clearAdultGuardConfirmations(storage);
  writeAdultGuardConfirmation("a", storage);

  assert.deepEqual([...readAdultGuardConfirmations(storage)], ["a"]);
});

test("conferma: ogni lettura dà un insieme nuovo, modificarlo non cambia lo storage", () => {
  const storage = makeStorage();
  writeAdultGuardConfirmation("a", storage);

  const first = readAdultGuardConfirmations(storage);
  first.add("intrusa");
  first.delete("a");

  assert.deepEqual([...readAdultGuardConfirmations(storage)], ["a"]);
});
