import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRegisterSearch,
  getRegisterBackTarget,
  getRegisterProgressIndex,
  parseRegisterPasso,
  resolveRegisterFlow,
} from "../src/utils/registerFlow.ts";

// Fase 5 e 6 del flusso genitore (docs/FLUSSO_GENITORE.md, G, D, "Account già
// esistente o sbagliato", scelta G2 = a): la guardia adulto in cima al modulo,
// «I tuoi dati» riaperti dalla guardia e il genitore che sceglie "Partecipo io".
//
// - `adultGuard`: un partecipante già entrato (profilo completo, "Partecipo
//   io") con almeno 19 anni il primo giorno vede la schermata `guardia` al
//   posto del modulo. Il passo nell'URL resta `modulo`.
// - `editOwnData`: `passo=dati` per un profilo già completo vale solo se la
//   guardia l'ha aperto ("Ho sbagliato la data", "Partecipo come dirigente"
//   lo mettono nella cronologia, non nell'URL); digitato a mano non apre niente.
// - Account `parent` che sceglie "Partecipo io": con la fase 6 va sempre a
//   «I tuoi dati» (D-io), con o senza figli: al salvataggio diventa
//   `participant` e i figli restano. Il flag provvisorio `parentHasChildren`
//   della fase 5 e la scheda `solo-figli` non esistono più.
// - Figlio scelto da un account adulto di qualunque ruolo: E, o il modulo del
//   figlio scelto; "serve-genitore" resta solo per l'account di un minore.
//
// I casi di prima (senza questi campi) sono in tests/registerFlow.test.mjs e
// tests/registerFlowInviata.test.mjs. Qui la tabella della spec è una
// funzione (`expectedFlow`), confrontata con `resolveRegisterFlow` su tutte le
// combinazioni; poi i casi uno per uno, con il perché.
//
// Comando: node --test tests/registerFlowGuardia.test.mjs

const PER_VALUES = [null, "io", "figlio"];
const PASSO_VALUES = [null, "chi", "account", "dati", "figlio", "modulo"];
const ACCOUNT_VALUES = ["none", "guest", "user"];
const ROLE_VALUES = ["participant", "parent", "staff"];
const BOOLEANS = [false, true];
const TRISTATE = [undefined, false, true];
const SCREENS = ["chi", "account", "dati", "figlio", "modulo", "guardia", "serve-genitore"];

// Un partecipante adulto entrato, col profilo completo, che ha scelto
// "Partecipo io": con `adultGuard` è il caso della guardia in cima al modulo.
const makeState = (overrides = {}) => ({
  per: "io",
  passo: null,
  account: "user",
  profileComplete: true,
  role: "participant",
  isMinor: false,
  guestAllowed: false,
  childSelected: false,
  ...overrides,
});

const describeState = (state) => JSON.stringify(state);

/** Tutte le combinazioni di ingresso, comprese le due novità della fase 5. */
function* allStates() {
  for (const per of PER_VALUES) {
    for (const passo of PASSO_VALUES) {
      for (const account of ACCOUNT_VALUES) {
        for (const profileComplete of BOOLEANS) {
          for (const role of ROLE_VALUES) {
            for (const isMinor of BOOLEANS) {
              for (const guestAllowed of BOOLEANS) {
                for (const childSelected of BOOLEANS) {
                  for (const adultGuard of TRISTATE) {
                    // `needsExistingAccountGuard` accende il flag solo per un
                    // account vero, col profilo completo e ruolo participant:
                    // gli altri ingressi non esistono e non si descrivono.
                    if (
                      adultGuard === true &&
                      !(account === "user" && profileComplete && role === "participant")
                    ) {
                      continue;
                    }

                    for (const editOwnData of TRISTATE) {
                      yield {
                        per,
                        passo,
                        account,
                        profileComplete,
                        role,
                        isMinor,
                        guestAllowed,
                        childSelected,
                        adultGuard,
                        editOwnData,
                      };
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
}

/** Valori canonici per l'URL di ogni schermata (per resta quello passato). */
function canonical(screen, per) {
  if (screen === "serve-genitore") {
    return { screen, per, passo: null };
  }

  if (screen === "chi") {
    return { screen, per, passo: per ? "chi" : null };
  }

  // La guardia sta in cima al modulo: il passo nell'URL è `modulo`.
  return { screen, per, passo: screen === "guardia" ? "modulo" : screen };
}

/**
 * Schermata attesa secondo la spec. Ritorna undefined per le combinazioni che
 * la spec non descrive (account di un minore con ruolo diverso da
 * `participant`).
 */
function expectedFlow(state) {
  const { per, passo, account } = state;
  const completeUser = account === "user" && state.profileComplete;

  // B: l'account di un minore va dritto a F, e la guardia non lo riguarda
  // (G: «Attività per i giovani» chiede chi partecipa a chi ha 19+ anni).
  if (completeUser && state.isMinor) {
    if (state.role !== "participant") {
      return undefined;
    }
    return per === "figlio" ? canonical("serve-genitore", "figlio") : canonical("modulo", "io");
  }

  if (per === null || passo === "chi") {
    return canonical("chi", per);
  }

  if (account === "none") {
    return canonical("account", per);
  }

  // Ospite: G6; la guardia vale solo per un account vero.
  if (account === "guest") {
    if (per === "figlio" || !state.guestAllowed) {
      return canonical("account", per);
    }
    return passo === "modulo" ? canonical("modulo", per) : canonical("account", per);
  }

  if (!state.profileComplete) {
    return canonical("dati", per);
  }

  if (per === "io") {
    // "Account già esistente", riga 2: il genitore che sceglie "Partecipo io"
    // completa i suoi dati (D-io), con o senza figli: al salvataggio diventa
    // `participant` e i figli restano.
    if (state.role === "parent") {
      return canonical("dati", per);
    }

    // D riaperta dalla guardia: «Ho sbagliato la data», «Partecipo come
    // dirigente». Solo con `editOwnData`; un `passo=dati` digitato non basta.
    if (passo === "dati" && state.editOwnData === true) {
      return canonical("dati", per);
    }

    return state.adultGuard === true ? canonical("guardia", per) : canonical("modulo", per);
  }

  // per === "figlio", G2 = a: ogni account adulto arriva a E, o al modulo del
  // figlio scelto (l'account di un minore si è fermato in cima).
  if (passo === "figlio") {
    return canonical("figlio", per);
  }

  return state.childSelected ? canonical("modulo", per) : canonical("figlio", per);
}

// ---------------------------------------------------------------------------
// Guardia in cima al modulo (F)
// ---------------------------------------------------------------------------

test("guardia: partecipante completo con per=io e adultGuard → screen guardia, passo canonico modulo", () => {
  assert.deepEqual(resolveRegisterFlow(makeState({ adultGuard: true })), {
    screen: "guardia",
    per: "io",
    passo: "modulo",
  });
});

test("guardia: vale per ogni passo con cui si arriva al modulo (null, modulo, account, figlio)", () => {
  for (const passo of [null, "modulo", "account", "figlio"]) {
    assert.deepEqual(
      resolveRegisterFlow(makeState({ adultGuard: true, passo })),
      { screen: "guardia", per: "io", passo: "modulo" },
      `passo=${passo}`,
    );
  }
});

test("guardia: senza il flag (assente o false) il partecipante va al modulo", () => {
  for (const adultGuard of [undefined, false]) {
    for (const passo of [null, "modulo", "account", "figlio"]) {
      assert.deepEqual(
        resolveRegisterFlow(makeState({ adultGuard, passo })),
        { screen: "modulo", per: "io", passo: "modulo" },
        `adultGuard=${adultGuard} passo=${passo}`,
      );
    }
  }
});

test("guardia: l'URL non cambia passo, il canonico è sempre modulo", () => {
  const result = resolveRegisterFlow(makeState({ adultGuard: true, passo: "modulo" }));
  assert.equal(result.passo, "modulo");

  // La query risultante porta `passo=modulo` e `per=io`, come il modulo.
  const search = buildRegisterSearch(new URLSearchParams("stake=abc"), {
    per: result.per,
    passo: result.passo,
  });
  assert.deepEqual(Object.fromEntries(new URLSearchParams(search)), {
    stake: "abc",
    per: "io",
    passo: "modulo",
  });
  // `modulo` è un passo valido dell'URL; `guardia` no (non è un passo).
  assert.equal(parseRegisterPasso(result.passo), "modulo");
  assert.equal(parseRegisterPasso("guardia"), null);
});

test("guardia: non si apre dall'URL, `passo=guardia` è un passo sconosciuto", () => {
  assert.equal(parseRegisterPasso("guardia"), null);
});

test("guardia: stabile, rimettere per/passo canonici non fa rimbalzare", () => {
  const state = makeState({ adultGuard: true, passo: "modulo" });
  const first = resolveRegisterFlow(state);
  const second = resolveRegisterFlow({ ...state, per: first.per, passo: first.passo });
  assert.deepEqual(second, first);
});

test("guardia: «Cambia» (passo=chi) riporta a Chi partecipa?, la guardia non si mette in mezzo", () => {
  assert.deepEqual(resolveRegisterFlow(makeState({ adultGuard: true, passo: "chi" })), {
    screen: "chi",
    per: "io",
    passo: "chi",
  });
});

test("guardia: senza una scelta (per assente) si parte da Chi partecipa?", () => {
  assert.deepEqual(resolveRegisterFlow(makeState({ adultGuard: true, per: null })), {
    screen: "chi",
    per: null,
    passo: null,
  });
});

test("guardia: per=figlio non la mostra, il flag non conta (si iscrive un figlio, non sé)", () => {
  // Un partecipante adulto che sceglie "Iscrivo mio figlio" (G2): E, con
  // «Sei entrato come …», l'account resta com'è. La guardia riguarda chi
  // partecipa lui.
  assert.deepEqual(resolveRegisterFlow(makeState({ adultGuard: true, per: "figlio" })), {
    screen: "figlio",
    per: "figlio",
    passo: "figlio",
  });
  // Senza un figlio scelto anche passo=modulo riporta a E.
  assert.deepEqual(resolveRegisterFlow(makeState({ adultGuard: true, per: "figlio", passo: "modulo" })), {
    screen: "figlio",
    per: "figlio",
    passo: "figlio",
  });
  // Con il figlio scelto, il modulo del figlio: mai la guardia.
  assert.deepEqual(
    resolveRegisterFlow(makeState({ adultGuard: true, per: "figlio", passo: "modulo", childSelected: true })),
    { screen: "modulo", per: "figlio", passo: "modulo" },
  );
});

test("guardia: l'account di un minore la ignora e va dritto al modulo", () => {
  assert.deepEqual(resolveRegisterFlow(makeState({ adultGuard: true, isMinor: true })), {
    screen: "modulo",
    per: "io",
    passo: "modulo",
  });
  assert.deepEqual(resolveRegisterFlow(makeState({ adultGuard: true, isMinor: true, per: null })), {
    screen: "modulo",
    per: "io",
    passo: "modulo",
  });
  // E con per=figlio resta la scheda «serve un genitore», non la guardia.
  assert.deepEqual(resolveRegisterFlow(makeState({ adultGuard: true, isMinor: true, per: "figlio" })), {
    screen: "serve-genitore",
    per: "figlio",
    passo: null,
  });
});

test("guardia: profilo da completare → «I tuoi dati» (D), la guardia scatta lì dentro, non in cima al modulo", () => {
  for (const adultGuard of [undefined, false, true]) {
    assert.deepEqual(
      resolveRegisterFlow(makeState({ profileComplete: false, adultGuard, passo: "modulo" })),
      { screen: "dati", per: "io", passo: "dati" },
      `adultGuard=${adultGuard}`,
    );
  }
});

test("guardia: senza account vero (non entrato, ospite) non c'è guardia", () => {
  assert.deepEqual(resolveRegisterFlow(makeState({ account: "none", adultGuard: true })), {
    screen: "account",
    per: "io",
    passo: "account",
  });
  // Ospite con "Continua senza account": il modulo, mai la guardia.
  assert.deepEqual(
    resolveRegisterFlow(makeState({ account: "guest", guestAllowed: true, passo: "modulo", adultGuard: true })),
    { screen: "modulo", per: "io", passo: "modulo" },
  );
});

test("guardia: dirigente (staff) completo con per=io va al modulo", () => {
  assert.deepEqual(resolveRegisterFlow(makeState({ role: "staff" })), {
    screen: "modulo",
    per: "io",
    passo: "modulo",
  });
});

test("guardia: la freccia in alto dalla guardia riporta a Chi partecipa?", () => {
  assert.deepEqual(getRegisterBackTarget("guardia", "io", false), {
    kind: "step",
    per: "io",
    passo: "chi",
  });
});

test("guardia: la freccia dell'account di un minore va comunque all'attività", () => {
  assert.deepEqual(getRegisterBackTarget("guardia", "io", true), { kind: "activity" });
});

test("guardia: il percorso «account · figlio · iscrizione» non si mostra", () => {
  assert.equal(getRegisterProgressIndex("guardia", "io"), null);
});

// ---------------------------------------------------------------------------
// Iscrizione inviata e guardia
// ---------------------------------------------------------------------------

test("inviata: con l'iscrizione salvata passo=inviata resta inviata", () => {
  for (const adultGuard of [undefined, false]) {
    assert.deepEqual(
      resolveRegisterFlow(makeState({ passo: "inviata", submitted: true, adultGuard })),
      { screen: "inviata", per: "io", passo: "inviata" },
      `adultGuard=${adultGuard}`,
    );
  }
});

test("inviata: senza iscrizione salvata si torna al primo passo valido (il modulo o la guardia)", () => {
  assert.deepEqual(resolveRegisterFlow(makeState({ passo: "inviata", submitted: false })), {
    screen: "modulo",
    per: "io",
    passo: "modulo",
  });
  assert.deepEqual(resolveRegisterFlow(makeState({ passo: "inviata", submitted: false, adultGuard: true })), {
    screen: "guardia",
    per: "io",
    passo: "modulo",
  });
});

// Stato che la pagina non produce mai (`needsExistingAccountGuard` spegne la
// guardia con un'iscrizione già fatta, e `submitted` implica che ci sia), ma
// la spec è chiara su H: «vale con l'iscrizione salvata e non annullata, quindi
// si ritrova ricaricando». Se il flag arrivasse acceso lo stesso, la guardia
// non deve nascondere "Iscrizione inviata".
test(
  "inviata: se arriva adultGuard acceso con l'iscrizione salvata, vince inviata",
  () => {
    assert.deepEqual(resolveRegisterFlow(makeState({ passo: "inviata", submitted: true, adultGuard: true })), {
      screen: "inviata",
      per: "io",
      passo: "inviata",
    });
  },
);

// ---------------------------------------------------------------------------
// Account genitore che sceglie "Partecipo io" (D-io, fase 6)
// ---------------------------------------------------------------------------

test("genitore completo, per=io → «I tuoi dati» (completa i dati e diventa partecipante), i figli restano", () => {
  // "Account già esistente", riga 2. Lo stato non dice se ha figli: non conta.
  for (const passo of [null, "modulo", "account", "dati", "figlio"]) {
    assert.deepEqual(
      resolveRegisterFlow(makeState({ role: "parent", passo })),
      { screen: "dati", per: "io", passo: "dati" },
      `passo=${passo}`,
    );
  }
});

test("genitore completo, per=io: editOwnData non cambia D-io", () => {
  for (const editOwnData of TRISTATE) {
    for (const passo of [null, "modulo", "dati"]) {
      assert.deepEqual(
        resolveRegisterFlow(makeState({ role: "parent", passo, editOwnData })),
        { screen: "dati", per: "io", passo: "dati" },
        `passo=${passo} editOwnData=${editOwnData}`,
      );
    }
  }
});

test("genitore: «Cambia» (passo=chi) porta a Chi partecipa? e la scelta resta", () => {
  assert.deepEqual(resolveRegisterFlow(makeState({ role: "parent", passo: "chi" })), {
    screen: "chi",
    per: "io",
    passo: "chi",
  });
});

test("genitore: per=figlio porta a E, o al modulo del figlio scelto", () => {
  assert.deepEqual(resolveRegisterFlow(makeState({ role: "parent", per: "figlio" })), {
    screen: "figlio",
    per: "figlio",
    passo: "figlio",
  });
  assert.deepEqual(
    resolveRegisterFlow(makeState({ role: "parent", per: "figlio", passo: "modulo", childSelected: true })),
    { screen: "modulo", per: "figlio", passo: "modulo" },
  );
});

test("genitore con profilo da completare: «I tuoi dati» comunque", () => {
  assert.deepEqual(resolveRegisterFlow(makeState({ role: "parent", profileComplete: false })), {
    screen: "dati",
    per: "io",
    passo: "dati",
  });
});

test("genitore: dopo il salvataggio l'account è participant e si va al modulo (o alla guardia)", () => {
  // Il salvataggio di D-io cambia il ruolo in participant (i figli restano):
  // il passo dopo è quello di qualunque partecipante completo.
  assert.deepEqual(resolveRegisterFlow(makeState({ role: "participant" })), {
    screen: "modulo",
    per: "io",
    passo: "modulo",
  });
  assert.deepEqual(resolveRegisterFlow(makeState({ role: "participant", adultGuard: true })), {
    screen: "guardia",
    per: "io",
    passo: "modulo",
  });
});

test("participant e staff con per=figlio: lo stesso E del genitore, il ruolo non conta (G2)", () => {
  const expected = { screen: "figlio", per: "figlio", passo: "figlio" };
  const expectedChild = { screen: "modulo", per: "figlio", passo: "modulo" };
  for (const role of ["participant", "parent", "staff"]) {
    assert.deepEqual(resolveRegisterFlow(makeState({ role, per: "figlio" })), expected, role);
    assert.deepEqual(
      resolveRegisterFlow(makeState({ role, per: "figlio", passo: "modulo", childSelected: true })),
      expectedChild,
      role,
    );
  }
});

// ---------------------------------------------------------------------------
// «I tuoi dati» riaperti dalla guardia (editOwnData)
// ---------------------------------------------------------------------------

test("dati: profilo completo, passo=dati senza editOwnData → modulo", () => {
  for (const editOwnData of [undefined, false]) {
    assert.deepEqual(
      resolveRegisterFlow(makeState({ passo: "dati", editOwnData })),
      { screen: "modulo", per: "io", passo: "modulo" },
      `editOwnData=${editOwnData}`,
    );
  }
});

test("dati: profilo completo, passo=dati senza editOwnData e con il flag → guardia", () => {
  for (const editOwnData of [undefined, false]) {
    assert.deepEqual(
      resolveRegisterFlow(makeState({ passo: "dati", adultGuard: true, editOwnData })),
      { screen: "guardia", per: "io", passo: "modulo" },
      `editOwnData=${editOwnData}`,
    );
  }
});

test("dati: profilo completo, passo=dati con editOwnData → dati", () => {
  assert.deepEqual(resolveRegisterFlow(makeState({ passo: "dati", editOwnData: true })), {
    screen: "dati",
    per: "io",
    passo: "dati",
  });
});

test("dati: con editOwnData vince su adultGuard (la persona sta correggendo, non vede la guardia)", () => {
  // «Ho sbagliato la data» e «Partecipo come dirigente» riaprono D per
  // salvare: la guardia non deve riportarla indietro finché non ha finito.
  assert.deepEqual(resolveRegisterFlow(makeState({ passo: "dati", adultGuard: true, editOwnData: true })), {
    screen: "dati",
    per: "io",
    passo: "dati",
  });
});

test("dati: editOwnData vale solo per passo=dati, con altri passi si va al modulo o alla guardia", () => {
  for (const passo of [null, "modulo", "account", "figlio"]) {
    assert.deepEqual(
      resolveRegisterFlow(makeState({ passo, editOwnData: true })),
      { screen: "modulo", per: "io", passo: "modulo" },
      `passo=${passo}`,
    );
    assert.deepEqual(
      resolveRegisterFlow(makeState({ passo, editOwnData: true, adultGuard: true })),
      { screen: "guardia", per: "io", passo: "modulo" },
      `passo=${passo} con guardia`,
    );
  }
});

test("dati: editOwnData con per=figlio non apre «I tuoi dati»", () => {
  // Partecipante adulto che sceglie il figlio (G2): E, non D.
  assert.deepEqual(resolveRegisterFlow(makeState({ per: "figlio", passo: "dati", editOwnData: true })), {
    screen: "figlio",
    per: "figlio",
    passo: "figlio",
  });
  // Dirigente: lo stesso.
  assert.deepEqual(
    resolveRegisterFlow(makeState({ per: "figlio", passo: "dati", role: "staff", editOwnData: true })),
    { screen: "figlio", per: "figlio", passo: "figlio" },
  );
  // Genitore: E, non D (D si apre da profilo incompleto, non da qui).
  assert.deepEqual(
    resolveRegisterFlow(makeState({ per: "figlio", passo: "dati", role: "parent", editOwnData: true })),
    { screen: "figlio", per: "figlio", passo: "figlio" },
  );
  // Genitore con il figlio scelto: il modulo del figlio.
  assert.deepEqual(
    resolveRegisterFlow(
      makeState({ per: "figlio", passo: "dati", role: "parent", childSelected: true, editOwnData: true }),
    ),
    { screen: "modulo", per: "figlio", passo: "modulo" },
  );
});

test("dati: editOwnData non apre «I tuoi dati» all'account di un minore", () => {
  assert.deepEqual(resolveRegisterFlow(makeState({ passo: "dati", isMinor: true, editOwnData: true })), {
    screen: "modulo",
    per: "io",
    passo: "modulo",
  });
});

test("dati: editOwnData non salta l'account (non entrato, ospite)", () => {
  assert.deepEqual(resolveRegisterFlow(makeState({ account: "none", passo: "dati", editOwnData: true })), {
    screen: "account",
    per: "io",
    passo: "account",
  });
  assert.deepEqual(
    resolveRegisterFlow(
      makeState({ account: "guest", guestAllowed: true, passo: "dati", editOwnData: true }),
    ),
    { screen: "account", per: "io", passo: "account" },
  );
});

test("dati: editOwnData non cambia «Chi partecipa?» (passo=chi)", () => {
  assert.deepEqual(resolveRegisterFlow(makeState({ passo: "chi", editOwnData: true })), {
    screen: "chi",
    per: "io",
    passo: "chi",
  });
});

test("dati: il profilo da completare apre D con o senza editOwnData", () => {
  for (const editOwnData of TRISTATE) {
    assert.deepEqual(
      resolveRegisterFlow(makeState({ profileComplete: false, passo: "dati", editOwnData })),
      { screen: "dati", per: "io", passo: "dati" },
      `editOwnData=${editOwnData}`,
    );
  }
});

test("dati: un dirigente (staff) può riaprire i suoi dati con editOwnData, senza guardia", () => {
  assert.deepEqual(resolveRegisterFlow(makeState({ role: "staff", passo: "dati", editOwnData: true })), {
    screen: "dati",
    per: "io",
    passo: "dati",
  });
  assert.deepEqual(resolveRegisterFlow(makeState({ role: "staff", passo: "dati" })), {
    screen: "modulo",
    per: "io",
    passo: "modulo",
  });
});

test("dati: stabile, D riaperta da editOwnData riletta con i valori canonici resta D", () => {
  const state = makeState({ passo: "dati", editOwnData: true });
  const first = resolveRegisterFlow(state);
  const second = resolveRegisterFlow({ ...state, per: first.per, passo: first.passo });
  assert.deepEqual(second, first);
});

// ---------------------------------------------------------------------------
// Tutte le combinazioni
// ---------------------------------------------------------------------------

test("resolveRegisterFlow: ogni combinazione dà la schermata della spec (con adultGuard, editOwnData)", () => {
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

  assert.ok(checked > 10000, `combinazioni controllate: ${checked}`);
  assert.deepEqual(mismatches.slice(0, 10), [], `${mismatches.length} combinazioni diverse dalla spec`);
});

test("resolveRegisterFlow: mai un errore, sempre una schermata nota, per e passo canonici", () => {
  for (const state of allStates()) {
    const result = resolveRegisterFlow(state);
    assert.ok(SCREENS.includes(result.screen), `${describeState(state)} → ${result.screen}`);
    assert.deepEqual(result, canonical(result.screen, result.per), describeState(state));
  }
});

test("resolveRegisterFlow: idempotente, rimettere per/passo canonici non fa rimbalzare", () => {
  for (const state of allStates()) {
    const first = resolveRegisterFlow(state);
    const second = resolveRegisterFlow({ ...state, per: first.per, passo: first.passo });
    assert.deepEqual(second, first, `${describeState(state)}\n  primo ${JSON.stringify(first)}\n  poi   ${JSON.stringify(second)}`);
  }
});

test("resolveRegisterFlow: la guardia compare solo con il flag acceso, per=io e un account vero completo", () => {
  for (const state of allStates()) {
    const result = resolveRegisterFlow(state);
    if (result.screen !== "guardia") continue;

    assert.equal(state.adultGuard, true, describeState(state));
    assert.equal(result.per, "io", describeState(state));
    assert.equal(state.account, "user", describeState(state));
    assert.equal(state.profileComplete, true, describeState(state));
    assert.equal(state.isMinor, false, describeState(state));
    assert.equal(result.passo, "modulo", describeState(state));
  }
});

test("resolveRegisterFlow: con il flag acceso il solo cambio è modulo → guardia", () => {
  // Ovunque il flag sia ammesso, accenderlo non sposta nient'altro: l'esito è
  // lo stesso del caso spento, salvo `modulo` che diventa `guardia`.
  for (const state of allStates()) {
    if (state.adultGuard !== true) continue;

    const on = resolveRegisterFlow(state);
    const off = resolveRegisterFlow({ ...state, adultGuard: false });

    // L'account di un minore va al modulo anche col flag acceso.
    if (off.screen === "modulo" && off.per === "io" && !state.isMinor) {
      assert.deepEqual(on, { screen: "guardia", per: "io", passo: "modulo" }, describeState(state));
    } else {
      assert.deepEqual(on, off, describeState(state));
    }
  }
});

test("resolveRegisterFlow: «I tuoi dati» per un profilo completo si apre solo con editOwnData o da genitore", () => {
  for (const state of allStates()) {
    const result = resolveRegisterFlow(state);
    const completeUser = state.account === "user" && state.profileComplete && !state.isMinor;
    if (result.screen !== "dati" || !completeUser) continue;

    // Il genitore con "Partecipo io" (D-io, con o senza figli) o la guardia che
    // riapre D per un partecipante o un dirigente.
    const opensForParent = state.role === "parent" && state.per === "io";
    const opensForGuard = state.role !== "parent" && state.passo === "dati" && state.editOwnData === true;
    assert.ok(opensForParent || opensForGuard, describeState(state));
  }
});

test("resolveRegisterFlow: un parentHasChildren avanzato in ingresso non cambia nessun esito", () => {
  for (const state of allStates()) {
    const baseline = resolveRegisterFlow(state);
    for (const parentHasChildren of [false, true]) {
      assert.deepEqual(resolveRegisterFlow({ ...state, parentHasChildren }), baseline, describeState(state));
    }
  }
});

test("resolveRegisterFlow: senza adultGuard né editOwnData, con \"Partecipo io\" il genitore va a «I tuoi dati» e gli altri al modulo", () => {
  // Stesso ingresso senza i due campi della fase 5: il genitore completo
  // completa i dati (D-io), il partecipante e il dirigente vanno al modulo,
  // passo=dati per un profilo completo porta al modulo.
  for (const state of allStates()) {
    if (state.adultGuard !== undefined || state.editOwnData !== undefined) {
      continue;
    }

    const result = resolveRegisterFlow(state);
    const completeUser = state.account === "user" && state.profileComplete && !state.isMinor;

    if (completeUser && state.per === "io" && state.passo !== "chi") {
      assert.deepEqual(
        result,
        state.role === "parent"
          ? { screen: "dati", per: "io", passo: "dati" }
          : { screen: "modulo", per: "io", passo: "modulo" },
        describeState(state),
      );
    }
  }
});
