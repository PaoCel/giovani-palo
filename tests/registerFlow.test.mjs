import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRegisterSearch,
  clearStoredRegisterFor,
  getRegisterBackTarget,
  getRegisterProgressIndex,
  getRegisterRole,
  getRequestedRegisterChoice,
  parseRegisterFor,
  parseRegisterPasso,
  readStoredRegisterFor,
  resolveRegisterFlow,
  writeStoredRegisterFor,
} from "../src/utils/registerFlow.ts";

// Passi dell'iscrizione a un'attività (docs/FLUSSO_GENITORE.md, "Navigazione",
// B, C, "Account già esistente o sbagliato", "Utente che sbaglia"), con le
// regole provvisorie della fase 3: le schede "serve-genitore" e "solo-figli"
// stanno al posto di quello che arriverà con le fasi 5 e 6.
//
// I risultati attesi vengono dalla spec, non dal codice: `expectedFlow` qui
// sotto è la tabella della spec scritta come funzione, e il test la confronta
// con `resolveRegisterFlow` su tutte le combinazioni di ingresso. In più si
// prova che ogni risultato è stabile (rimesso in ingresso dà lo stesso
// risultato: niente rimbalzi di redirect) e alcune invarianti della spec
// ("il passo account, una volta entrati, non torna più", G6, ...).
//
// Comando: node --test tests/registerFlow.test.mjs

const PER_VALUES = [null, "io", "figlio"];
const PASSO_VALUES = [null, "chi", "account", "dati", "figlio", "modulo"];
const ACCOUNT_VALUES = ["none", "guest", "user"];
const ROLE_VALUES = ["participant", "parent", "staff"];
const BOOLEANS = [false, true];
const SCREENS = ["chi", "account", "dati", "figlio", "modulo", "serve-genitore", "solo-figli"];

const makeState = (overrides = {}) => ({
  per: null,
  passo: null,
  account: "none",
  profileComplete: false,
  role: "participant",
  isMinor: false,
  guestAllowed: false,
  childSelected: false,
  ...overrides,
});

/** Tutte le combinazioni di ingresso (3 × 6 × 3 × 2 × 3 × 2 × 2 × 2 = 2592). */
function* allStates() {
  for (const per of PER_VALUES) {
    for (const passo of PASSO_VALUES) {
      for (const account of ACCOUNT_VALUES) {
        for (const profileComplete of BOOLEANS) {
          for (const role of ROLE_VALUES) {
            for (const isMinor of BOOLEANS) {
              for (const guestAllowed of BOOLEANS) {
                for (const childSelected of BOOLEANS) {
                  yield { per, passo, account, profileComplete, role, isMinor, guestAllowed, childSelected };
                }
              }
            }
          }
        }
      }
    }
  }
}

const describeState = (state) => JSON.stringify(state);

/** Valori canonici per l'URL di ogni schermata (per resta quello passato). */
function canonical(screen, per) {
  if (screen === "serve-genitore" || screen === "solo-figli") {
    return { screen, per, passo: null };
  }

  if (screen === "chi") {
    return { screen, per, passo: per ? "chi" : null };
  }

  return { screen, per, passo: screen };
}

/**
 * Schermata attesa secondo la spec. Ritorna undefined per le combinazioni che
 * la spec non descrive (account di un minore con ruolo diverso da
 * `participant`): lì si provano solo stabilità e invarianti.
 */
function expectedFlow(state) {
  const { per, passo, account } = state;
  const user = account === "user";
  const completeUser = user && state.profileComplete;

  // B: "Quando: sempre, tranne per un account di un minore, che va dritto a F".
  // "Account già esistente": ragazzo arrivato dalla riga "Sei un genitore?" →
  // serve l'account di un genitore.
  if (completeUser && state.isMinor) {
    if (state.role !== "participant") {
      return undefined;
    }
    return per === "figlio" ? canonical("serve-genitore", "figlio") : canonical("modulo", "io");
  }

  // Senza scelta, o con "Cambia" (passo=chi): B, con la scelta conservata.
  if (per === null || passo === "chi") {
    return canonical("chi", per);
  }

  // C: non entrato.
  if (account === "none") {
    return canonical("account", per);
  }

  // Ospite: G6, niente ospite per un figlio; "Continua senza account" solo
  // per "Partecipo io" e solo se l'attività accetta ospiti; si arriva al
  // modulo solo dopo averlo scelto (passo=modulo).
  if (account === "guest") {
    if (per === "figlio" || !state.guestAllowed) {
      return canonical("account", per);
    }
    return passo === "modulo" ? canonical("modulo", per) : canonical("account", per);
  }

  // Account vero col profilo da completare: D. Il passo account non torna più.
  if (!state.profileComplete) {
    return canonical("dati", per);
  }

  if (per === "io") {
    // Interim fase 3: il genitore completo che sceglie "Partecipo io" vede la
    // scheda "solo-figli" (D-io arriva con la fase 5).
    return state.role === "parent" ? canonical("solo-figli", per) : canonical("modulo", per);
  }

  // per === "figlio": interim fase 3, solo l'account `parent` iscrive figli
  // (G2 arriva con la fase 6).
  if (state.role !== "parent") {
    return canonical("serve-genitore", per);
  }

  if (passo === "figlio") {
    return canonical("figlio", per);
  }

  return state.childSelected ? canonical("modulo", per) : canonical("figlio", per);
}

// ---------------------------------------------------------------------------
// parseRegisterFor / parseRegisterPasso / getRegisterRole
// ---------------------------------------------------------------------------

test("parseRegisterFor: solo io e figlio, scritti esatti", () => {
  assert.equal(parseRegisterFor("io"), "io");
  assert.equal(parseRegisterFor("figlio"), "figlio");

  for (const value of [null, undefined, "", "IO", "Figlio", " io", "io ", "figlia", "tu", "genitore", "constructor", "__proto__", "toString"]) {
    assert.equal(parseRegisterFor(value), null, `per=${JSON.stringify(value)}`);
  }
});

test("parseRegisterPasso: solo i cinque passi, scritti esatti", () => {
  for (const passo of ["chi", "account", "dati", "figlio", "modulo"]) {
    assert.equal(parseRegisterPasso(passo), passo);
  }

  // Le due schede sono schermate, non passi: non si aprono dall'URL.
  for (const value of [
    null,
    undefined,
    "",
    "Chi",
    "MODULO",
    " dati",
    "serve-genitore",
    "solo-figli",
    "iscrizione",
    "constructor",
    "__proto__",
    "toString",
    "length",
  ]) {
    assert.equal(parseRegisterPasso(value), null, `passo=${JSON.stringify(value)}`);
  }
});

test("getRegisterRole: parent, participant, tutto il resto è staff", () => {
  assert.equal(getRegisterRole("parent"), "parent");
  assert.equal(getRegisterRole("participant"), "participant");

  for (const role of ["unit_leader", "admin", "super_admin", ""]) {
    assert.equal(getRegisterRole(role), "staff", `role=${JSON.stringify(role)}`);
  }
});

// ---------------------------------------------------------------------------
// resolveRegisterFlow: casi della spec, uno per riga
// ---------------------------------------------------------------------------

const CASES = [
  // [descrizione, stato, atteso { screen, per, passo }]

  // Non entrato.
  ["non entrato, nessuna scelta → B", { account: "none" }, { screen: "chi", per: null, passo: null }],
  ["non entrato, passo=modulo senza scelta → B", { account: "none", passo: "modulo" }, { screen: "chi", per: null, passo: null }],
  ["non entrato, per=io → C", { account: "none", per: "io" }, { screen: "account", per: "io", passo: "account" }],
  ["non entrato, per=figlio → C genitore", { account: "none", per: "figlio" }, { screen: "account", per: "figlio", passo: "account" }],
  ["non entrato, per=figlio&passo=figlio → C (primo passo valido)", { account: "none", per: "figlio", passo: "figlio" }, { screen: "account", per: "figlio", passo: "account" }],
  ["non entrato, per=io&passo=modulo → C", { account: "none", per: "io", passo: "modulo" }, { screen: "account", per: "io", passo: "account" }],
  ["non entrato, per=io&passo=dati → C", { account: "none", per: "io", passo: "dati" }, { screen: "account", per: "io", passo: "account" }],
  ["non entrato, per=figlio&passo=chi → B con la scelta", { account: "none", per: "figlio", passo: "chi" }, { screen: "chi", per: "figlio", passo: "chi" }],
  ["non entrato, ospiti accettati ma per=io&passo=modulo → C", { account: "none", per: "io", passo: "modulo", guestAllowed: true }, { screen: "account", per: "io", passo: "account" }],

  // Ospite (sessione anonima).
  ["ospite, nessuna scelta → B", { account: "guest", guestAllowed: true }, { screen: "chi", per: null, passo: null }],
  ["ospite, per=figlio → C (G6)", { account: "guest", per: "figlio", guestAllowed: true }, { screen: "account", per: "figlio", passo: "account" }],
  ["ospite, per=figlio&passo=modulo → C (G6)", { account: "guest", per: "figlio", passo: "modulo", guestAllowed: true }, { screen: "account", per: "figlio", passo: "account" }],
  ["ospite, per=figlio&passo=figlio → C (G6)", { account: "guest", per: "figlio", passo: "figlio", guestAllowed: true }, { screen: "account", per: "figlio", passo: "account" }],
  ["ospite, per=io, attività senza ospiti, passo=modulo → C", { account: "guest", per: "io", passo: "modulo", guestAllowed: false }, { screen: "account", per: "io", passo: "account" }],
  ["ospite, per=io, ospiti accettati, senza passo → C", { account: "guest", per: "io", guestAllowed: true }, { screen: "account", per: "io", passo: "account" }],
  ["ospite, per=io, ospiti accettati, passo=dati → C", { account: "guest", per: "io", passo: "dati", guestAllowed: true }, { screen: "account", per: "io", passo: "account" }],
  ["ospite, per=io, ospiti accettati, passo=modulo → F", { account: "guest", per: "io", passo: "modulo", guestAllowed: true }, { screen: "modulo", per: "io", passo: "modulo" }],
  ["ospite, per=io&passo=chi → B con la scelta", { account: "guest", per: "io", passo: "chi", guestAllowed: true }, { screen: "chi", per: "io", passo: "chi" }],

  // Account nuovo, profilo da completare: D, il passo account non torna.
  ["profilo incompleto, nessuna scelta → B", { account: "user" }, { screen: "chi", per: null, passo: null }],
  ["profilo incompleto, per=io&passo=account → D", { account: "user", per: "io", passo: "account" }, { screen: "dati", per: "io", passo: "dati" }],
  ["profilo incompleto, per=figlio&passo=account → D", { account: "user", per: "figlio", passo: "account", role: "parent" }, { screen: "dati", per: "figlio", passo: "dati" }],
  ["profilo incompleto, per=figlio&passo=figlio → D", { account: "user", per: "figlio", passo: "figlio", role: "parent", childSelected: true }, { screen: "dati", per: "figlio", passo: "dati" }],
  ["profilo incompleto, per=io&passo=modulo → D", { account: "user", per: "io", passo: "modulo" }, { screen: "dati", per: "io", passo: "dati" }],
  ["profilo incompleto, per=io&passo=dati → D", { account: "user", per: "io", passo: "dati" }, { screen: "dati", per: "io", passo: "dati" }],
  ["profilo incompleto, per=figlio&passo=chi → B", { account: "user", per: "figlio", passo: "chi", role: "parent" }, { screen: "chi", per: "figlio", passo: "chi" }],
  ["profilo incompleto, dirigente, per=io → D", { account: "user", per: "io", role: "staff" }, { screen: "dati", per: "io", passo: "dati" }],
  ["profilo incompleto con data da minore → D (minore vale solo col profilo completo)", { account: "user", per: "io", isMinor: true }, { screen: "dati", per: "io", passo: "dati" }],

  // Account di un minore, profilo completo: niente B.
  ["minore, nessuna scelta → F per sé", { account: "user", profileComplete: true, isMinor: true }, { screen: "modulo", per: "io", passo: "modulo" }],
  ["minore, passo=chi → F per sé", { account: "user", profileComplete: true, isMinor: true, passo: "chi" }, { screen: "modulo", per: "io", passo: "modulo" }],
  ["minore, per=io&passo=chi → F per sé", { account: "user", profileComplete: true, isMinor: true, per: "io", passo: "chi" }, { screen: "modulo", per: "io", passo: "modulo" }],
  ["minore, per=io&passo=account → F per sé", { account: "user", profileComplete: true, isMinor: true, per: "io", passo: "account" }, { screen: "modulo", per: "io", passo: "modulo" }],
  ["minore, per=figlio (riga «Sei un genitore?») → serve-genitore", { account: "user", profileComplete: true, isMinor: true, per: "figlio" }, { screen: "serve-genitore", per: "figlio", passo: null }],
  ["minore, per=figlio&passo=chi → serve-genitore", { account: "user", profileComplete: true, isMinor: true, per: "figlio", passo: "chi" }, { screen: "serve-genitore", per: "figlio", passo: null }],
  ["minore, per=figlio&passo=modulo con figlio scelto → serve-genitore", { account: "user", profileComplete: true, isMinor: true, per: "figlio", passo: "modulo", childSelected: true }, { screen: "serve-genitore", per: "figlio", passo: null }],

  // Adulto completo, "Partecipo io".
  ["adulto partecipante, per=io → F", { account: "user", profileComplete: true, per: "io" }, { screen: "modulo", per: "io", passo: "modulo" }],
  ["adulto partecipante, per=io&passo=account → F", { account: "user", profileComplete: true, per: "io", passo: "account" }, { screen: "modulo", per: "io", passo: "modulo" }],
  ["dirigente, per=io → F", { account: "user", profileComplete: true, per: "io", role: "staff" }, { screen: "modulo", per: "io", passo: "modulo" }],
  ["genitore, per=io → solo-figli", { account: "user", profileComplete: true, per: "io", role: "parent" }, { screen: "solo-figli", per: "io", passo: null }],
  ["genitore, per=io&passo=modulo → solo-figli", { account: "user", profileComplete: true, per: "io", passo: "modulo", role: "parent" }, { screen: "solo-figli", per: "io", passo: null }],
  ["genitore, per=io&passo=chi → B", { account: "user", profileComplete: true, per: "io", passo: "chi", role: "parent" }, { screen: "chi", per: "io", passo: "chi" }],

  // Adulto completo, "Iscrivo mio figlio".
  ["genitore senza figlio scelto, per=figlio → E", { account: "user", profileComplete: true, per: "figlio", role: "parent" }, { screen: "figlio", per: "figlio", passo: "figlio" }],
  ["genitore senza figlio scelto, per=figlio&passo=modulo → E", { account: "user", profileComplete: true, per: "figlio", passo: "modulo", role: "parent" }, { screen: "figlio", per: "figlio", passo: "figlio" }],
  ["genitore senza figlio scelto, per=figlio&passo=account → E", { account: "user", profileComplete: true, per: "figlio", passo: "account", role: "parent" }, { screen: "figlio", per: "figlio", passo: "figlio" }],
  ["genitore con figlio scelto, per=figlio&passo=modulo → F", { account: "user", profileComplete: true, per: "figlio", passo: "modulo", role: "parent", childSelected: true }, { screen: "modulo", per: "figlio", passo: "modulo" }],
  ["genitore con figlio scelto, per=figlio senza passo → F", { account: "user", profileComplete: true, per: "figlio", role: "parent", childSelected: true }, { screen: "modulo", per: "figlio", passo: "modulo" }],
  ["genitore con figlio scelto, per=figlio&passo=dati → F", { account: "user", profileComplete: true, per: "figlio", passo: "dati", role: "parent", childSelected: true }, { screen: "modulo", per: "figlio", passo: "modulo" }],
  ["genitore con figlio scelto, per=figlio&passo=figlio → E («Cambia» dal modulo)", { account: "user", profileComplete: true, per: "figlio", passo: "figlio", role: "parent", childSelected: true }, { screen: "figlio", per: "figlio", passo: "figlio" }],
  ["genitore con figlio scelto, per=figlio&passo=chi → B", { account: "user", profileComplete: true, per: "figlio", passo: "chi", role: "parent", childSelected: true }, { screen: "chi", per: "figlio", passo: "chi" }],
  ["adulto partecipante, per=figlio → serve-genitore", { account: "user", profileComplete: true, per: "figlio" }, { screen: "serve-genitore", per: "figlio", passo: null }],
  ["adulto partecipante con child in URL, per=figlio&passo=modulo → serve-genitore", { account: "user", profileComplete: true, per: "figlio", passo: "modulo", childSelected: true }, { screen: "serve-genitore", per: "figlio", passo: null }],
  ["dirigente, per=figlio → serve-genitore", { account: "user", profileComplete: true, per: "figlio", role: "staff" }, { screen: "serve-genitore", per: "figlio", passo: null }],
  ["dirigente, per=figlio&passo=figlio → serve-genitore", { account: "user", profileComplete: true, per: "figlio", passo: "figlio", role: "staff" }, { screen: "serve-genitore", per: "figlio", passo: null }],
  ["adulto completo, nessuna scelta → B", { account: "user", profileComplete: true, role: "staff" }, { screen: "chi", per: null, passo: null }],
];

for (const [title, overrides, expected] of CASES) {
  test(`resolveRegisterFlow: ${title}`, () => {
    assert.deepEqual(resolveRegisterFlow(makeState(overrides)), expected);
  });
}

// ---------------------------------------------------------------------------
// resolveRegisterFlow: tutte le combinazioni
// ---------------------------------------------------------------------------

test("resolveRegisterFlow: ogni combinazione dà la schermata della spec", () => {
  const mismatches = [];
  let checked = 0;

  for (const state of allStates()) {
    const expected = expectedFlow(state);
    if (expected === undefined) continue;
    checked += 1;
    const actual = resolveRegisterFlow(state);
    try {
      assert.deepEqual(actual, expected);
    } catch {
      mismatches.push(`${describeState(state)}\n  atteso ${JSON.stringify(expected)}\n  avuto  ${JSON.stringify(actual)}`);
    }
  }

  assert.ok(checked > 2000, `combinazioni controllate: ${checked}`);
  assert.deepEqual(mismatches.slice(0, 10), [], `${mismatches.length} combinazioni diverse dalla spec`);
});

test("resolveRegisterFlow: mai un errore, sempre una schermata nota", () => {
  for (const state of allStates()) {
    const result = resolveRegisterFlow(state);
    assert.ok(SCREENS.includes(result.screen), `${describeState(state)} → ${result.screen}`);
    assert.ok(PER_VALUES.includes(result.per), `${describeState(state)} → per ${result.per}`);
    assert.ok(PASSO_VALUES.includes(result.passo), `${describeState(state)} → passo ${result.passo}`);
  }
});

test("resolveRegisterFlow: per e passo restituiti sono quelli canonici della schermata", () => {
  for (const state of allStates()) {
    const result = resolveRegisterFlow(state);
    assert.deepEqual(result, canonical(result.screen, result.per), describeState(state));
  }
});

test("resolveRegisterFlow: idempotente, rimettere per/passo canonici non fa rimbalzare", () => {
  for (const state of allStates()) {
    const first = resolveRegisterFlow(state);
    const second = resolveRegisterFlow({ ...state, per: first.per, passo: first.passo });
    assert.deepEqual(second, first, `${describeState(state)}\n  primo ${JSON.stringify(first)}\n  poi   ${JSON.stringify(second)}`);
    // E una terza volta, per sicurezza contro i cicli di due passi.
    const third = resolveRegisterFlow({ ...state, per: second.per, passo: second.passo });
    assert.deepEqual(third, second, describeState(state));
  }
});

test("resolveRegisterFlow: la scelta «per chi» resta quella dell'URL (salvo l'account di un minore)", () => {
  for (const state of allStates()) {
    const result = resolveRegisterFlow(state);
    const minorAccount = state.account === "user" && state.profileComplete && state.isMinor && state.role === "participant";
    if (minorAccount) {
      assert.equal(result.per, state.per === "figlio" ? "figlio" : "io", describeState(state));
    } else {
      assert.equal(result.per, state.per, describeState(state));
    }
  }
});

test("resolveRegisterFlow: invarianti della spec su tutte le combinazioni", () => {
  for (const state of allStates()) {
    const { screen, per } = resolveRegisterFlow(state);
    const label = `${describeState(state)} → ${screen}`;

    // "Il passo account, una volta entrati, non torna più".
    if (state.account === "user") {
      assert.notEqual(screen, "account", label);
    }

    // Senza account: solo B o C.
    if (state.account === "none") {
      assert.ok(screen === "chi" || screen === "account", label);
    }

    // Ospite: mai D o E; il modulo solo per "Partecipo io" con ospiti accettati (G6).
    if (state.account === "guest") {
      assert.ok(["chi", "account", "modulo"].includes(screen), label);
      if (screen === "modulo") {
        assert.equal(per, "io", label);
        assert.equal(state.guestAllowed, true, label);
      }
    }

    // Un figlio si iscrive solo da un account `parent` col profilo completo.
    if (screen === "figlio" || (screen === "modulo" && per === "figlio")) {
      assert.equal(state.account, "user", label);
      assert.equal(state.profileComplete, true, label);
      assert.equal(state.role, "parent", label);
    }

    // Il modulo di un figlio solo con un figlio scelto.
    if (screen === "modulo" && per === "figlio") {
      assert.equal(state.childSelected, true, label);
    }

    // "Partecipo io" non porta mai a E né alla scheda "serve-genitore".
    if (per === "io") {
      assert.ok(screen !== "figlio" && screen !== "serve-genitore", label);
    }

    // "Iscrivo mio figlio" non porta mai a "solo-figli".
    if (per === "figlio") {
      assert.notEqual(screen, "solo-figli", label);
    }

    // L'account di un minore completo non vede mai B.
    if (state.account === "user" && state.profileComplete && state.isMinor && state.role === "participant") {
      assert.notEqual(screen, "chi", label);
    }
  }
});

// ---------------------------------------------------------------------------
// getRegisterBackTarget
// ---------------------------------------------------------------------------

test("getRegisterBackTarget: da B si torna all'attività", () => {
  for (const per of PER_VALUES) {
    assert.deepEqual(getRegisterBackTarget("chi", per, false), { kind: "activity" });
  }
});

test("getRegisterBackTarget: l'account di un minore torna sempre all'attività", () => {
  for (const screen of SCREENS) {
    for (const per of PER_VALUES) {
      assert.deepEqual(getRegisterBackTarget(screen, per, true), { kind: "activity" }, `${screen} per=${per}`);
    }
  }
});

test("getRegisterBackTarget: dal modulo di un figlio si torna a «Chi iscrivi?»", () => {
  assert.deepEqual(getRegisterBackTarget("modulo", "figlio", false), { kind: "step", per: "figlio", passo: "figlio" });
});

test("getRegisterBackTarget: dagli altri passi si torna a B con la scelta di prima", () => {
  const cases = [
    ["account", "io"],
    ["account", "figlio"],
    ["dati", "io"],
    ["dati", "figlio"],
    ["figlio", "figlio"],
    ["modulo", "io"],
    ["serve-genitore", "figlio"],
    ["solo-figli", "io"],
  ];
  for (const [screen, per] of cases) {
    assert.deepEqual(getRegisterBackTarget(screen, per, false), { kind: "step", per, passo: "chi" }, `${screen} per=${per}`);
  }
});

// ---------------------------------------------------------------------------
// getRegisterProgressIndex
// ---------------------------------------------------------------------------

test("getRegisterProgressIndex: segmento attivo del percorso", () => {
  assert.equal(getRegisterProgressIndex("account", "io"), 0);
  assert.equal(getRegisterProgressIndex("account", "figlio"), 0);
  // "Il tuo account · Tuo figlio · Iscrizione": i dati del genitore sono il suo account.
  assert.equal(getRegisterProgressIndex("dati", "figlio"), 0);
  // "Partecipo io": "I tuoi dati" viene dopo "Il tuo account".
  assert.equal(getRegisterProgressIndex("dati", "io"), 1);
  assert.equal(getRegisterProgressIndex("figlio", "figlio"), 1);
});

test("getRegisterProgressIndex: nessun percorso su B, modulo e schede", () => {
  for (const screen of ["chi", "modulo", "serve-genitore", "solo-figli"]) {
    for (const per of PER_VALUES) {
      assert.equal(getRegisterProgressIndex(screen, per), null, `${screen} per=${per}`);
    }
  }
});

// ---------------------------------------------------------------------------
// buildRegisterSearch
// ---------------------------------------------------------------------------

const read = (search) => Object.fromEntries(new URLSearchParams(search));

test("buildRegisterSearch: imposta per e passo, gli altri parametri restano", () => {
  const current = new URLSearchParams("stake=roma-est&redirect=%2Fme");
  const search = buildRegisterSearch(current, { per: "figlio", passo: "figlio" });
  assert.deepEqual(read(search), { stake: "roma-est", redirect: "/me", per: "figlio", passo: "figlio" });
  assert.ok(!search.startsWith("?"), search);
});

test("buildRegisterSearch: sostituisce per e passo già presenti", () => {
  const current = new URLSearchParams("per=io&passo=dati&stake=roma-est");
  assert.deepEqual(read(buildRegisterSearch(current, { per: "figlio", passo: "account" })), {
    per: "figlio",
    passo: "account",
    stake: "roma-est",
  });
});

test("buildRegisterSearch: per e passo null li tolgono", () => {
  const current = new URLSearchParams("per=io&passo=dati&stake=roma-est");
  assert.deepEqual(read(buildRegisterSearch(current, { per: null, passo: null })), { stake: "roma-est" });
  assert.deepEqual(read(buildRegisterSearch(current, { per: "io", passo: null })), { per: "io", stake: "roma-est" });
});

test("buildRegisterSearch: child undefined lascia il figlio com'era", () => {
  const current = new URLSearchParams("per=figlio&passo=modulo&child=figlio-1&stake=roma-est");
  assert.deepEqual(read(buildRegisterSearch(current, { per: "figlio", passo: "figlio" })), {
    per: "figlio",
    passo: "figlio",
    child: "figlio-1",
    stake: "roma-est",
  });
});

test("buildRegisterSearch: child null o vuoto lo tolgono, un id lo imposta", () => {
  const current = new URLSearchParams("per=figlio&passo=modulo&child=figlio-1&stake=roma-est");
  assert.equal(read(buildRegisterSearch(current, { per: "figlio", passo: "figlio", child: null })).child, undefined);
  assert.equal(read(buildRegisterSearch(current, { per: "figlio", passo: "figlio", child: "" })).child, undefined);
  assert.equal(read(buildRegisterSearch(current, { per: "figlio", passo: "modulo", child: "figlio-2" })).child, "figlio-2");
  assert.equal(
    read(buildRegisterSearch(new URLSearchParams("stake=x"), { per: "figlio", passo: "modulo", child: "figlio-3" })).child,
    "figlio-3",
  );
});

test("buildRegisterSearch: non modifica i parametri ricevuti", () => {
  const current = new URLSearchParams("per=io&passo=dati&child=figlio-1&stake=roma-est");
  const before = current.toString();
  buildRegisterSearch(current, { per: null, passo: null, child: null });
  assert.equal(current.toString(), before);
});

test("buildRegisterSearch: valori con caratteri speciali restano leggibili", () => {
  const current = new URLSearchParams();
  current.set("stake", "palo & co/1");
  const search = buildRegisterSearch(current, { per: "figlio", passo: "modulo", child: "id con spazi&=" });
  assert.equal(new URLSearchParams(search).get("stake"), "palo & co/1");
  assert.equal(new URLSearchParams(search).get("child"), "id con spazi&=");
});

// ---------------------------------------------------------------------------
// readStoredRegisterFor / writeStoredRegisterFor / clearStoredRegisterFor
// ---------------------------------------------------------------------------

class MemoryStorage {
  constructor() {
    this.items = new Map();
  }
  getItem(key) {
    return this.items.has(key) ? this.items.get(key) : null;
  }
  setItem(key, value) {
    this.items.set(key, String(value));
  }
  removeItem(key) {
    this.items.delete(key);
  }
}

const throwingStorage = {
  getItem() {
    throw new Error("SecurityError: storage bloccato");
  },
  setItem() {
    throw new Error("QuotaExceededError");
  },
  removeItem() {
    throw new Error("SecurityError: storage bloccato");
  },
};

test("storage: scritta e riletta nella stessa attività", () => {
  const storage = new MemoryStorage();
  writeStoredRegisterFor("attivita-1", "figlio", storage);
  assert.equal(readStoredRegisterFor("attivita-1", storage), "figlio");
  writeStoredRegisterFor("attivita-1", "io", storage);
  assert.equal(readStoredRegisterFor("attivita-1", storage), "io");
});

test("storage: un'altra attività non eredita la scelta", () => {
  const storage = new MemoryStorage();
  writeStoredRegisterFor("attivita-1", "figlio", storage);
  assert.equal(readStoredRegisterFor("attivita-2", storage), null);
  // Scegliere in un'altra attività sostituisce la scelta di prima.
  writeStoredRegisterFor("attivita-2", "io", storage);
  assert.equal(readStoredRegisterFor("attivita-1", storage), null);
  assert.equal(readStoredRegisterFor("attivita-2", storage), "io");
});

test("storage: clear cancella la scelta", () => {
  const storage = new MemoryStorage();
  writeStoredRegisterFor("attivita-1", "figlio", storage);
  clearStoredRegisterFor(storage);
  assert.equal(readStoredRegisterFor("attivita-1", storage), null);
  assert.equal(storage.items.size, 0);
});

test("storage: vuoto, JSON rotto o valori strani → null", () => {
  const storage = new MemoryStorage();
  assert.equal(readStoredRegisterFor("attivita-1", storage), null);

  for (const raw of [
    "{rotto",
    "",
    "null",
    "42",
    '"figlio"',
    "[]",
    JSON.stringify({ eventId: "attivita-1" }),
    JSON.stringify({ eventId: "attivita-1", per: "tutti" }),
    JSON.stringify({ eventId: "attivita-1", per: null }),
    JSON.stringify({ per: "figlio" }),
    JSON.stringify({ eventId: 1, per: "figlio" }),
  ]) {
    // Stessa chiave che usa il codice: si scrive passando da writeStoredRegisterFor
    // e poi si sporca il valore.
    writeStoredRegisterFor("attivita-1", "figlio", storage);
    const [key] = storage.items.keys();
    storage.setItem(key, raw);
    assert.equal(readStoredRegisterFor("attivita-1", storage), null, `valore ${JSON.stringify(raw)}`);
    // E nemmeno un evento con id "1" eredita un eventId numerico.
    assert.equal(readStoredRegisterFor("1", storage), null, `valore ${JSON.stringify(raw)} per l'attività "1"`);
  }
});

test("storage: uno storage che lancia non rompe niente", () => {
  assert.doesNotThrow(() => writeStoredRegisterFor("attivita-1", "figlio", throwingStorage));
  assert.equal(readStoredRegisterFor("attivita-1", throwingStorage), null);
  assert.doesNotThrow(() => clearStoredRegisterFor(throwingStorage));
});

test("storage: senza sessionStorage (null o ambiente Node) non lancia", () => {
  assert.equal(readStoredRegisterFor("attivita-1", null), null);
  assert.doesNotThrow(() => writeStoredRegisterFor("attivita-1", "io", null));
  assert.doesNotThrow(() => clearStoredRegisterFor(null));
  // Argomento omesso: in Node non c'è window, si usa lo storage di default.
  assert.equal(readStoredRegisterFor("attivita-1"), null);
  assert.doesNotThrow(() => writeStoredRegisterFor("attivita-1", "io"));
  assert.doesNotThrow(() => clearStoredRegisterFor());
});

// ---------------------------------------------------------------------------
// getRequestedRegisterChoice: la scelta quando l'URL non dice `per`
// ---------------------------------------------------------------------------

test("getRequestedRegisterChoice: con per nell'URL valgono per e passo dell'URL", () => {
  for (const per of ["io", "figlio"]) {
    for (const passo of PASSO_VALUES) {
      for (const childSelected of BOOLEANS) {
        for (const hasOwnRegistration of BOOLEANS) {
          assert.deepEqual(
            getRequestedRegisterChoice({ per, passo, childSelected, hasOwnRegistration }),
            { per, passo },
            JSON.stringify({ per, passo, childSelected, hasOwnRegistration }),
          );
        }
      }
    }
  }
});

test("getRequestedRegisterChoice: senza per e con un figlio scelto («Gestisci» di Famiglia) → modulo del figlio", () => {
  for (const passo of PASSO_VALUES) {
    for (const hasOwnRegistration of BOOLEANS) {
      assert.deepEqual(
        getRequestedRegisterChoice({ per: null, passo, childSelected: true, hasOwnRegistration }),
        { per: "figlio", passo: "modulo" },
        JSON.stringify({ passo, hasOwnRegistration }),
      );
    }
  }
});

test("getRequestedRegisterChoice: senza per, senza figlio, con la propria iscrizione → il proprio modulo", () => {
  for (const passo of PASSO_VALUES) {
    assert.deepEqual(
      getRequestedRegisterChoice({ per: null, passo, childSelected: false, hasOwnRegistration: true }),
      { per: "io", passo: "modulo" },
      `passo=${passo}`,
    );
  }
});

test("getRequestedRegisterChoice: senza per, senza figlio né iscrizione → nessuna scelta, passo invariato", () => {
  for (const passo of PASSO_VALUES) {
    assert.deepEqual(
      getRequestedRegisterChoice({ per: null, passo, childSelected: false, hasOwnRegistration: false }),
      { per: null, passo },
      `passo=${passo}`,
    );
  }
});

/** URL letto (per, passo, child) → scelta → schermata, come fa la pagina. */
function resolveFromUrl(state, hasOwnRegistration) {
  const choice = getRequestedRegisterChoice({
    per: state.per,
    passo: state.passo,
    childSelected: state.childSelected,
    hasOwnRegistration,
  });
  return resolveRegisterFlow({ ...state, per: choice.per, passo: choice.passo });
}

test("composizione: genitore completo, child nell'URL senza per → modulo del figlio, il figlio non si perde", () => {
  for (const passo of PASSO_VALUES) {
    for (const hasOwnRegistration of BOOLEANS) {
      const state = makeState({ account: "user", profileComplete: true, role: "parent", childSelected: true, passo });
      assert.deepEqual(
        resolveFromUrl(state, hasOwnRegistration),
        { screen: "modulo", per: "figlio", passo: "modulo" },
        JSON.stringify({ passo, hasOwnRegistration }),
      );
    }
  }
});

test("composizione: solo la propria iscrizione, per assente → il proprio modulo per chi può averlo", () => {
  // Adulto partecipante e dirigente: F per sé.
  for (const role of ["participant", "staff"]) {
    const state = makeState({ account: "user", profileComplete: true, role });
    assert.deepEqual(resolveFromUrl(state, true), { screen: "modulo", per: "io", passo: "modulo" }, role);
  }
  // Ospite con la sua iscrizione, attività che accetta ospiti: F.
  assert.deepEqual(
    resolveFromUrl(makeState({ account: "guest", guestAllowed: true }), true),
    { screen: "modulo", per: "io", passo: "modulo" },
  );
  // Senza iscrizione né figlio: B.
  assert.deepEqual(
    resolveFromUrl(makeState({ account: "user", profileComplete: true, role: "parent" }), false),
    { screen: "chi", per: null, passo: null },
  );
});

test("composizione: nessun rimbalzo per ogni combinazione di figlio scelto e iscrizione propria", () => {
  for (const state of allStates()) {
    for (const hasOwnRegistration of BOOLEANS) {
      const first = resolveFromUrl(state, hasOwnRegistration);
      // La pagina riscrive per/passo canonici (child resta): stessa schermata.
      const second = resolveFromUrl({ ...state, per: first.per, passo: first.passo }, hasOwnRegistration);
      const label = `${describeState(state)} own=${hasOwnRegistration}\n  primo ${JSON.stringify(first)}\n  poi   ${JSON.stringify(second)}`;
      assert.deepEqual(second, first, label);
      const third = resolveFromUrl({ ...state, per: second.per, passo: second.passo }, hasOwnRegistration);
      assert.deepEqual(third, second, label);
    }
  }
});

test("composizione: con un figlio scelto o un'iscrizione propria la scelta non torna mai vuota", () => {
  for (const state of allStates()) {
    for (const hasOwnRegistration of BOOLEANS) {
      if (!state.childSelected && !hasOwnRegistration) continue;
      const result = resolveFromUrl(state, hasOwnRegistration);
      assert.notEqual(result.per, null, `${describeState(state)} own=${hasOwnRegistration}`);
      // Con child nell'URL e per assente si resta sul figlio.
      if (state.per === null && state.childSelected) {
        assert.equal(result.per, "figlio", `${describeState(state)} own=${hasOwnRegistration}`);
      }
    }
  }
});
