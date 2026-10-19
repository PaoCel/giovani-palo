import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRegisterSearch,
  getRegisterBackTarget,
  getRegisterProgressIndex,
  parseRegisterPasso,
  resolveRegisterFlow,
} from "../src/utils/registerFlow.ts";

// Passo "inviata" dell'iscrizione: la schermata H "Iscrizione inviata"
// (docs/FLUSSO_GENITORE.md, H e "Navigazione"). Vale solo per un account vero
// con l'iscrizione già salvata (`submitted`) e con i prerequisiti del modulo:
// genitore con il figlio scelto, partecipante completo, account di un minore.
// Aprire o ricaricare `passo=inviata` senza quei prerequisiti porta al primo
// passo valido, con il passo canonico nell'URL, mai a un errore.
//
// I casi di prima (passi chi…modulo) sono in tests/registerFlow.test.mjs; qui
// si prova anche che `submitted` non cambia niente sugli altri passi.
//
// Comando: node --test tests/registerFlowInviata.test.mjs

const PER_VALUES = [null, "io", "figlio"];
const OLD_PASSI = [null, "chi", "account", "dati", "figlio", "modulo"];
const ACCOUNT_VALUES = ["none", "guest", "user"];
const ROLE_VALUES = ["participant", "parent", "staff"];
const BOOLEANS = [false, true];
const SUBMITTED_VALUES = [undefined, false, true];
const SCREENS = ["chi", "account", "dati", "figlio", "modulo", "inviata", "serve-genitore", "solo-figli"];

const makeState = (overrides = {}) => ({
  per: null,
  passo: "inviata",
  account: "user",
  profileComplete: true,
  role: "participant",
  isMinor: false,
  guestAllowed: false,
  childSelected: false,
  submitted: true,
  ...overrides,
});

function* allStates(passi) {
  for (const per of PER_VALUES) {
    for (const passo of passi) {
      for (const account of ACCOUNT_VALUES) {
        for (const profileComplete of BOOLEANS) {
          for (const role of ROLE_VALUES) {
            for (const isMinor of BOOLEANS) {
              for (const guestAllowed of BOOLEANS) {
                for (const childSelected of BOOLEANS) {
                  for (const submitted of SUBMITTED_VALUES) {
                    yield { per, passo, account, profileComplete, role, isMinor, guestAllowed, childSelected, submitted };
                  }
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

/**
 * Secondo la spec: H si apre solo con un account vero, l'iscrizione salvata e
 * i prerequisiti del modulo. Ritorna il `per` di H, oppure null se H non vale.
 */
function expectedInviataPer(state) {
  if (state.account !== "user" || state.submitted !== true || !state.profileComplete) {
    return null;
  }

  // Account di un minore: il suo modulo è sempre "io"; con la scelta del figlio
  // vede la scheda "serve l'account di un genitore", non H.
  if (state.isMinor && state.role === "participant") {
    return state.per === "figlio" ? null : "io";
  }

  if (state.per === "io") {
    // Il genitore completo che sceglie "Partecipo io" vede "solo-figli".
    return state.role === "parent" ? null : "io";
  }

  if (state.per === "figlio") {
    // Solo l'account da genitore, e solo con il figlio scelto.
    return state.role === "parent" && state.childSelected ? "figlio" : null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// parseRegisterPasso
// ---------------------------------------------------------------------------

test("parseRegisterPasso: «inviata» è un passo, scritto esatto", () => {
  assert.equal(parseRegisterPasso("inviata"), "inviata");

  for (const value of ["Inviata", "INVIATA", " inviata", "inviata ", "inviato", "inviate", "h"]) {
    assert.equal(parseRegisterPasso(value), null, `passo=${JSON.stringify(value)}`);
  }
});

// ---------------------------------------------------------------------------
// resolveRegisterFlow con passo=inviata: casi della spec, uno per riga
// ---------------------------------------------------------------------------

const CASES = [
  // H valida.
  {
    title: "genitore con il figlio scelto e iscrizione salvata → H",
    state: { per: "figlio", role: "parent", childSelected: true },
    expected: { screen: "inviata", per: "figlio", passo: "inviata" },
  },
  {
    title: "partecipante completo con la sua iscrizione → H",
    state: { per: "io", role: "participant" },
    expected: { screen: "inviata", per: "io", passo: "inviata" },
  },
  {
    title: "dirigente che partecipa con la sua iscrizione → H",
    state: { per: "io", role: "staff" },
    expected: { screen: "inviata", per: "io", passo: "inviata" },
  },
  {
    title: "account di un minore, per assente → H per «io»",
    state: { per: null, isMinor: true },
    expected: { screen: "inviata", per: "io", passo: "inviata" },
  },
  {
    title: "account di un minore, per=io → H",
    state: { per: "io", isMinor: true },
    expected: { screen: "inviata", per: "io", passo: "inviata" },
  },

  // Senza l'iscrizione salvata: il modulo.
  {
    title: "partecipante senza submitted → modulo",
    state: { per: "io", submitted: false },
    expected: { screen: "modulo", per: "io", passo: "modulo" },
  },
  {
    title: "partecipante con submitted assente → modulo",
    state: { per: "io", submitted: undefined },
    expected: { screen: "modulo", per: "io", passo: "modulo" },
  },
  {
    title: "genitore con il figlio scelto senza submitted → modulo del figlio",
    state: { per: "figlio", role: "parent", childSelected: true, submitted: false },
    expected: { screen: "modulo", per: "figlio", passo: "modulo" },
  },
  {
    title: "account di un minore senza submitted → modulo",
    state: { per: null, isMinor: true, submitted: false },
    expected: { screen: "modulo", per: "io", passo: "modulo" },
  },

  // Ospite: H solo per un account vero.
  {
    title: "ospite che ha già scelto «Continua senza account» → modulo, non H",
    state: { per: "io", account: "guest", guestAllowed: true, profileComplete: false },
    expected: { screen: "modulo", per: "io", passo: "modulo" },
  },
  {
    title: "ospite su un'attività che chiede l'account → account",
    state: { per: "io", account: "guest", guestAllowed: false, profileComplete: false },
    expected: { screen: "account", per: "io", passo: "account" },
  },
  {
    title: "ospite con un figlio (G6) → account",
    state: { per: "figlio", account: "guest", guestAllowed: true, profileComplete: false, role: "parent", childSelected: true },
    expected: { screen: "account", per: "figlio", passo: "account" },
  },

  // Senza account.
  {
    title: "senza account, per=io → account",
    state: { per: "io", account: "none", profileComplete: false },
    expected: { screen: "account", per: "io", passo: "account" },
  },
  {
    title: "senza account, per=figlio → account",
    state: { per: "figlio", account: "none", profileComplete: false, role: "parent", childSelected: true },
    expected: { screen: "account", per: "figlio", passo: "account" },
  },
  {
    title: "senza account e senza per → Chi partecipa?",
    state: { per: null, account: "none", profileComplete: false },
    expected: { screen: "chi", per: null, passo: null },
  },

  // Profilo incompleto.
  {
    title: "profilo incompleto, per=io → I tuoi dati",
    state: { per: "io", profileComplete: false },
    expected: { screen: "dati", per: "io", passo: "dati" },
  },
  {
    title: "profilo incompleto, per=figlio → I tuoi dati",
    state: { per: "figlio", profileComplete: false, role: "parent", childSelected: true },
    expected: { screen: "dati", per: "figlio", passo: "dati" },
  },

  // Genitore.
  {
    title: "genitore senza figlio scelto → Chi iscrivi?",
    state: { per: "figlio", role: "parent", childSelected: false },
    expected: { screen: "figlio", per: "figlio", passo: "figlio" },
  },
  {
    title: "genitore completo con per=io → scheda solo-figli",
    state: { per: "io", role: "parent" },
    expected: { screen: "solo-figli", per: "io", passo: null },
  },

  // Account che non iscrivono figli (fino alla fase 6).
  {
    title: "partecipante adulto con per=figlio → serve l'account di un genitore",
    state: { per: "figlio", role: "participant", childSelected: true },
    expected: { screen: "serve-genitore", per: "figlio", passo: null },
  },
  {
    title: "dirigente con per=figlio → serve l'account di un genitore",
    state: { per: "figlio", role: "staff", childSelected: true },
    expected: { screen: "serve-genitore", per: "figlio", passo: null },
  },
  {
    title: "account di un minore con per=figlio → serve l'account di un genitore",
    state: { per: "figlio", isMinor: true, childSelected: true },
    expected: { screen: "serve-genitore", per: "figlio", passo: null },
  },

  // Senza scelta.
  {
    title: "account completo senza per → Chi partecipa?",
    state: { per: null, role: "participant" },
    expected: { screen: "chi", per: null, passo: null },
  },
  {
    title: "genitore completo senza per → Chi partecipa?",
    state: { per: null, role: "parent", childSelected: true },
    expected: { screen: "chi", per: null, passo: null },
  },
];

for (const { title, state, expected } of CASES) {
  test(`resolveRegisterFlow con passo=inviata: ${title}`, () => {
    const input = makeState(state);
    assert.deepEqual(resolveRegisterFlow(input), expected, describeState(input));
  });
}

// ---------------------------------------------------------------------------
// resolveRegisterFlow con passo=inviata: tutte le combinazioni
// ---------------------------------------------------------------------------

test("resolveRegisterFlow: H solo per account vero, iscrizione salvata e prerequisiti del modulo", () => {
  for (const state of allStates(["inviata"])) {
    const actual = resolveRegisterFlow(state);
    const per = expectedInviataPer(state);

    if (per) {
      assert.deepEqual(actual, { screen: "inviata", per, passo: "inviata" }, describeState(state));
    } else {
      assert.notEqual(actual.screen, "inviata", describeState(state));
      assert.notEqual(actual.passo, "inviata", describeState(state));
    }
  }
});

test("resolveRegisterFlow: senza H, passo=inviata porta dove porterebbe passo=modulo", () => {
  for (const state of allStates(["inviata"])) {
    if (expectedInviataPer(state)) {
      continue;
    }

    assert.deepEqual(
      resolveRegisterFlow(state),
      resolveRegisterFlow({ ...state, passo: "modulo" }),
      describeState(state),
    );
  }
});

test("resolveRegisterFlow con passo=inviata: sempre una schermata nota, con per e passo canonici", () => {
  for (const state of allStates(["inviata"])) {
    const actual = resolveRegisterFlow(state);
    assert.ok(SCREENS.includes(actual.screen), `${describeState(state)} → ${actual.screen}`);

    if (actual.screen === "serve-genitore" || actual.screen === "solo-figli") {
      assert.equal(actual.passo, null, describeState(state));
    } else if (actual.screen === "chi") {
      assert.equal(actual.passo, actual.per ? "chi" : null, describeState(state));
    } else {
      assert.equal(actual.passo, actual.screen, describeState(state));
    }
  }
});

test("resolveRegisterFlow con passo=inviata: rimettere per/passo canonici non fa rimbalzare", () => {
  for (const state of allStates(["inviata"])) {
    const first = resolveRegisterFlow(state);
    const second = resolveRegisterFlow({ ...state, per: first.per, passo: first.passo });
    assert.deepEqual(second, first, describeState(state));
  }
});

test("resolveRegisterFlow: submitted non cambia niente sui passi di prima", () => {
  for (const state of allStates(OLD_PASSI)) {
    if (state.submitted === undefined) {
      continue;
    }

    const withoutFlag = { ...state };
    delete withoutFlag.submitted;
    const actual = resolveRegisterFlow(state);
    assert.deepEqual(actual, resolveRegisterFlow(withoutFlag), describeState(state));
    // H non si apre da un altro passo, neanche con l'iscrizione salvata.
    assert.notEqual(actual.screen, "inviata", describeState(state));
  }
});

// ---------------------------------------------------------------------------
// Freccia, percorso e URL
// ---------------------------------------------------------------------------

test("getRegisterBackTarget: da «Iscrizione inviata» si torna all'attività", () => {
  for (const per of PER_VALUES) {
    for (const isMinor of BOOLEANS) {
      assert.deepEqual(getRegisterBackTarget("inviata", per, isMinor), { kind: "activity" }, `per=${per} minore=${isMinor}`);
    }
  }
});

test("getRegisterProgressIndex: su «Iscrizione inviata» il percorso non si mostra", () => {
  for (const per of PER_VALUES) {
    assert.equal(getRegisterProgressIndex("inviata", per), null, `per=${per}`);
  }
});

test("buildRegisterSearch: passo=inviata con il figlio, gli altri parametri restano", () => {
  const current = new URLSearchParams("stake=roma-est&per=figlio&passo=modulo&child=marco");
  const next = Object.fromEntries(
    new URLSearchParams(buildRegisterSearch(current, { per: "figlio", passo: "inviata", child: "marco" })),
  );
  assert.deepEqual(next, { stake: "roma-est", per: "figlio", passo: "inviata", child: "marco" });

  // Il passo letto dall'URL costruito è di nuovo "inviata".
  assert.equal(parseRegisterPasso(next.passo), "inviata");
});
