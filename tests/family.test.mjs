import test from "node:test";
import assert from "node:assert/strict";

import { getRegistrationAvailability } from "../src/utils/events.ts";
import {
  FAMILY_MIN_AGE,
  canManageFamily,
  getAccountHomePath,
  suggestsChildAfterOwn,
} from "../src/utils/family.ts";
import { getRegistrationLookupFromSession } from "../src/utils/session.ts";

// Famiglia su ogni account adulto (docs/FLUSSO_GENITORE.md, fase 6, scelta
// G2 = a): "può avere figli" non è più il ruolo `parent`.
//
// - `canManageFamily`: vale per `parent`, `unit_leader`, `admin`, `super_admin`
//   e per un `participant` con almeno 18 anni oggi; mai per un ospite, un
//   minore o un partecipante senza data.
// - `getAccountHomePath`: la pagina iniziale del ruolo; Famiglia è la casa solo
//   dell'account da genitore, per gli altri la barra ha "Home" e "Famiglia".
// - `suggestsChildAfterOwn`: dopo la propria iscrizione, "Iscrivi tuo figlio o
//   tua figlia" per un dirigente (H e la sua scheda) e per chi ha già figli;
//   non per un partecipante giovane senza figli.
// - `getRegistrationAvailability` con `forChild`: l'idoneità di genere si
//   valuta sul figlio scelto (E), non sulla categoria dell'account.
// - `getRegistrationLookupFromSession`: l'iscrizione di un figlio è il
//   documento `child_{uid}_{figlio}` per ogni account non ospite.
//
// I valori attesi vengono dalla spec, non dal codice. Le date si costruiscono
// con `new Date(anno, mese, giorno, ora)` locali: i casi valgono in qualunque
// fuso giri il processo.
//
// Comando: node --test tests/family.test.mjs

/** Sessione minima per `canManageFamily` (FamilySessionLike). */
const familySession = ({ role = "participant", birthDate, isAuthenticated = true, isAnonymous = false } = {}) => ({
  isAuthenticated,
  isAnonymous,
  profile: { role, birthDate },
});

const ADULT_ROLES = ["parent", "unit_leader", "admin", "super_admin"];
const ALL_ROLES = ["participant", ...ADULT_ROLES];

// Oggi, a mezzogiorno: tutti i compleanni dei test sono relativi a questo giorno.
const TODAY = new Date(2026, 9, 19, 12);

// ---------------------------------------------------------------------------
// FAMILY_MIN_AGE
// ---------------------------------------------------------------------------

test("FAMILY_MIN_AGE: 18 anni, la stessa soglia dell'account di un minore (B)", () => {
  assert.equal(FAMILY_MIN_AGE, 18);
});

// ---------------------------------------------------------------------------
// canManageFamily
// ---------------------------------------------------------------------------

test("canManageFamily: senza sessione non si gestisce nessuna famiglia", () => {
  assert.equal(canManageFamily(null, TODAY), false);
  assert.equal(canManageFamily(undefined, TODAY), false);
});

test("canManageFamily: chi non è entrato non gestisce la famiglia, qualunque ruolo e data", () => {
  for (const role of ALL_ROLES) {
    for (const birthDate of [undefined, "1980-05-17"]) {
      assert.equal(
        canManageFamily(familySession({ role, birthDate, isAuthenticated: false }), TODAY),
        false,
        `role=${role} birthDate=${birthDate}`,
      );
    }
  }
});

test("canManageFamily: l'ospite (sessione anonima) non gestisce la famiglia, qualunque ruolo e data", () => {
  // G6: un figlio non si iscrive da un ospite. Vale anche se la sessione
  // anonima ha un profilo con un ruolo da adulto o una data da maggiorenne.
  for (const role of ALL_ROLES) {
    for (const isAuthenticated of [true, false]) {
      for (const birthDate of [undefined, "1980-05-17"]) {
        assert.equal(
          canManageFamily(familySession({ role, birthDate, isAuthenticated, isAnonymous: true }), TODAY),
          false,
          `role=${role} isAuthenticated=${isAuthenticated} birthDate=${birthDate}`,
        );
      }
    }
  }
});

test("canManageFamily: genitore, dirigente e admin sì, senza bisogno della data di nascita", () => {
  for (const role of ADULT_ROLES) {
    for (const birthDate of [undefined, null, "", "non-una-data"]) {
      assert.equal(
        canManageFamily(familySession({ role, birthDate }), TODAY),
        true,
        `role=${role} birthDate=${JSON.stringify(birthDate)}`,
      );
    }
  }
});

test("canManageFamily: per i ruoli da adulto conta il ruolo, non l'età", () => {
  // La spec mette il limite dei 18 anni solo sul partecipante.
  for (const role of ADULT_ROLES) {
    assert.equal(canManageFamily(familySession({ role, birthDate: "2015-03-01" }), TODAY), true, role);
  }
});

test("canManageFamily: un ruolo sconosciuto o scritto diverso non gestisce la famiglia", () => {
  for (const role of ["", "guest", "moderator", "Parent", "PARTICIPANT", "unit-leader", "admin "]) {
    assert.equal(canManageFamily(familySession({ role, birthDate: "1980-05-17" }), TODAY), false, JSON.stringify(role));
  }
});

test("canManageFamily: partecipante maggiorenne sì, minorenne no", () => {
  assert.equal(canManageFamily(familySession({ birthDate: "1980-05-17" }), TODAY), true);
  assert.equal(canManageFamily(familySession({ birthDate: "2000-01-01" }), TODAY), true);
  assert.equal(canManageFamily(familySession({ birthDate: "2010-06-30" }), TODAY), false);
  assert.equal(canManageFamily(familySession({ birthDate: "2020-01-01" }), TODAY), false);
  // Molto vecchia ma valida: la data "assurda" la ferma il modulo, non qui.
  assert.equal(canManageFamily(familySession({ birthDate: "1900-01-01" }), TODAY), true);
});

test("canManageFamily: partecipante senza data di nascita (profilo da completare) no", () => {
  for (const birthDate of [undefined, null, ""]) {
    assert.equal(canManageFamily(familySession({ birthDate }), TODAY), false, `birthDate=${JSON.stringify(birthDate)}`);
  }
  // Anche la chiave assente del tutto dal profilo.
  assert.equal(
    canManageFamily({ isAuthenticated: true, isAnonymous: false, profile: { role: "participant" } }, TODAY),
    false,
  );
});

test("canManageFamily: partecipante con una data non valida no", () => {
  for (const birthDate of [
    "non-una-data",
    "19/05/1990",
    "1990-13-01",
    "1990-00-10",
    "1990-02-30",
    "1990-04-31",
    "2023-02-29",
  ]) {
    assert.equal(canManageFamily(familySession({ birthDate }), TODAY), false, `birthDate=${JSON.stringify(birthDate)}`);
  }
});

test("canManageFamily: partecipante con una data nel futuro no", () => {
  assert.equal(canManageFamily(familySession({ birthDate: "2026-10-20" }), TODAY), false);
  assert.equal(canManageFamily(familySession({ birthDate: "2027-01-01" }), TODAY), false);
  assert.equal(canManageFamily(familySession({ birthDate: "2999-12-31" }), TODAY), false);
});

test("canManageFamily: 18 anni compiuti oggi sì, il giorno prima no, il giorno dopo sì", () => {
  // Compleanno il 19 ottobre 2008; oggi è il 19 ottobre 2026.
  const session = familySession({ birthDate: "2008-10-19" });

  assert.equal(canManageFamily(session, new Date(2026, 9, 18, 12)), false, "il giorno prima: ha ancora 17 anni");
  assert.equal(canManageFamily(session, new Date(2026, 9, 19, 12)), true, "oggi compie 18 anni");
  assert.equal(canManageFamily(session, new Date(2026, 9, 20, 12)), true, "il giorno dopo ha 18 anni");
  assert.equal(canManageFamily(session, new Date(2027, 9, 19, 12)), true, "a 19 anni");
});

test("canManageFamily: il compleanno vale a qualunque ora del giorno", () => {
  const session = familySession({ birthDate: "2008-10-19" });

  assert.equal(canManageFamily(session, new Date(2026, 9, 18, 23, 59, 59, 999)), false, "un attimo prima");
  assert.equal(canManageFamily(session, new Date(2026, 9, 19, 0, 0, 0, 0)), true, "mezzanotte");
  assert.equal(canManageFamily(session, new Date(2026, 9, 19, 23, 59, 59, 999)), true, "fine giornata");
});

test("canManageFamily: i compleanni a cavallo di mese e di anno", () => {
  // 31 dicembre: il giorno prima è ancora minorenne.
  const newYearsEve = familySession({ birthDate: "2008-12-31" });
  assert.equal(canManageFamily(newYearsEve, new Date(2026, 11, 30, 12)), false);
  assert.equal(canManageFamily(newYearsEve, new Date(2026, 11, 31, 12)), true);

  // 1 gennaio: il 31 dicembre prima ha ancora 17 anni.
  const newYearsDay = familySession({ birthDate: "2009-01-01" });
  assert.equal(canManageFamily(newYearsDay, new Date(2026, 11, 31, 12)), false);
  assert.equal(canManageFamily(newYearsDay, new Date(2027, 0, 1, 12)), true);

  // Mese del compleanno uguale ma giorno dopo oggi: non ancora, anche con un
  // mese "più avanti" e un giorno "più indietro" (si controlla il mese prima).
  const lateInMonth = familySession({ birthDate: "2008-10-31" });
  assert.equal(canManageFamily(lateInMonth, new Date(2026, 9, 19, 12)), false);
  const earlyInMonth = familySession({ birthDate: "2008-09-30" });
  assert.equal(canManageFamily(earlyInMonth, new Date(2026, 9, 19, 12)), true);
  const nextMonthEarlyDay = familySession({ birthDate: "2008-11-01" });
  assert.equal(canManageFamily(nextMonthEarlyDay, new Date(2026, 9, 19, 12)), false);
});

test("canManageFamily: senza `today` usa la data di oggi", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 9, 19, 12).getTime() });

  assert.equal(canManageFamily(familySession({ birthDate: "2008-10-19" })), true, "compie 18 anni oggi");
  assert.equal(canManageFamily(familySession({ birthDate: "2008-10-20" })), false, "li compie domani");
  assert.equal(canManageFamily(familySession({ role: "parent" })), true);
  assert.equal(canManageFamily(null), false);
});

test("canManageFamily: non modifica la sessione ricevuta", () => {
  const session = familySession({ birthDate: "2008-10-19" });
  const before = JSON.stringify(session);
  canManageFamily(session, TODAY);
  assert.equal(JSON.stringify(session), before);
});

// ---------------------------------------------------------------------------
// getAccountHomePath
// ---------------------------------------------------------------------------

test("getAccountHomePath: ogni ruolo ha la sua area", () => {
  assert.equal(getAccountHomePath("admin"), "/admin");
  assert.equal(getAccountHomePath("super_admin"), "/admin");
  assert.equal(getAccountHomePath("unit_leader"), "/unit");
  assert.equal(getAccountHomePath("participant"), "/me");
});

test("getAccountHomePath: Famiglia è la casa solo dell'account da genitore", () => {
  assert.equal(getAccountHomePath("parent"), "/family");

  for (const role of ["participant", "unit_leader", "admin", "super_admin"]) {
    assert.notEqual(getAccountHomePath(role), "/family", role);
  }
});

test("getAccountHomePath: un ruolo sconosciuto va a /me, non a una pagina riservata", () => {
  for (const role of ["", "guest", "Parent", "ADMIN", "unit-leader"]) {
    assert.equal(getAccountHomePath(role), "/me", JSON.stringify(role));
  }
});

// ---------------------------------------------------------------------------
// suggestsChildAfterOwn
// ---------------------------------------------------------------------------

const CATEGORIES = ["giovane_uomo", "giovane_donna", "dirigente", "accompagnatore", ""];

test("suggestsChildAfterOwn: chi non può avere figli non riceve mai il suggerimento", () => {
  // Un minore, un ospite, un partecipante senza data: qualunque ruolo,
  // categoria e figli salvati.
  for (const role of ALL_ROLES) {
    for (const category of CATEGORIES) {
      for (const hasChildren of [false, true]) {
        assert.equal(
          suggestsChildAfterOwn({ canManageFamily: false, role, category, hasChildren }),
          false,
          `role=${role} category=${category} hasChildren=${hasChildren}`,
        );
      }
    }
  }
});

test("suggestsChildAfterOwn: il dirigente iscritto lui riceve «Iscrivi tuo figlio o tua figlia»", () => {
  // Tabella «Account già esistente», riga 3 e fase 6: staff di qualunque
  // categoria, con o senza figli salvati.
  for (const role of ["unit_leader", "admin", "super_admin"]) {
    for (const category of CATEGORIES) {
      for (const hasChildren of [false, true]) {
        assert.equal(
          suggestsChildAfterOwn({ canManageFamily: true, role, category, hasChildren }),
          true,
          `role=${role} category=${category} hasChildren=${hasChildren}`,
        );
      }
    }
  }
});

test("suggestsChildAfterOwn: l'account da genitore lo riceve", () => {
  for (const category of CATEGORIES) {
    for (const hasChildren of [false, true]) {
      assert.equal(
        suggestsChildAfterOwn({ canManageFamily: true, role: "parent", category, hasChildren }),
        true,
        `category=${category} hasChildren=${hasChildren}`,
      );
    }
  }
});

test("suggestsChildAfterOwn: un partecipante dirigente o accompagnatore lo riceve, anche senza figli salvati", () => {
  for (const category of ["dirigente", "accompagnatore"]) {
    for (const hasChildren of [false, true]) {
      assert.equal(
        suggestsChildAfterOwn({ canManageFamily: true, role: "participant", category, hasChildren }),
        true,
        `category=${category} hasChildren=${hasChildren}`,
      );
    }
  }
});

test("suggestsChildAfterOwn: un partecipante giovane lo riceve solo se ha già figli salvati", () => {
  // Un diciottenne iscritto come giovane non ha l'aria di un genitore: per lui
  // il suggerimento è rumore. Con figli salvati sì.
  for (const category of ["giovane_uomo", "giovane_donna", ""]) {
    assert.equal(
      suggestsChildAfterOwn({ canManageFamily: true, role: "participant", category, hasChildren: false }),
      false,
      `category=${category} senza figli`,
    );
    assert.equal(
      suggestsChildAfterOwn({ canManageFamily: true, role: "participant", category, hasChildren: true }),
      true,
      `category=${category} con figli`,
    );
  }
});

test("suggestsChildAfterOwn: tutte le combinazioni", () => {
  const STAFF = new Set(["unit_leader", "admin", "super_admin"]);
  const LEADER_CATEGORIES = new Set(["dirigente", "accompagnatore"]);

  for (const canManage of [false, true]) {
    for (const role of [...ALL_ROLES, "", "guest"]) {
      for (const category of [...CATEGORIES, "altro"]) {
        for (const hasChildren of [false, true]) {
          const looksLikeParent =
            STAFF.has(role) || role === "parent" || LEADER_CATEGORIES.has(category) || hasChildren;
          assert.equal(
            suggestsChildAfterOwn({ canManageFamily: canManage, role, category, hasChildren }),
            canManage && looksLikeParent,
            `canManage=${canManage} role=${role} category=${category} hasChildren=${hasChildren}`,
          );
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// getRegistrationAvailability: con e senza forChild
// ---------------------------------------------------------------------------

const makeEvent = (overrides = {}) => ({
  status: "registrations_open",
  registrationOpen: "2000-01-01T00:00:00.000Z",
  registrationClose: "2999-12-31T23:59:59.000Z",
  audience: "giovane_donna",
  ...overrides,
});

const makeFormConfig = (allowGuestRegistration = false) => ({ allowGuestRegistration });

const makeAccount = ({ category = "", isParent = false, isAnonymous = false, isAuthenticated = true } = {}) => ({
  isAuthenticated,
  isAnonymous,
  isParent,
  profile: { genderRoleCategory: category },
});

const availability = (event, session, options, formConfig = makeFormConfig()) =>
  options === undefined
    ? getRegistrationAvailability(event, formConfig, session)
    : getRegistrationAvailability(event, formConfig, session, options);

test("disponibilità: attività solo GD, un giovane uomo non si iscrive, ma può iscrivere un figlio", () => {
  const event = makeEvent({ audience: "giovane_donna" });
  const session = makeAccount({ category: "giovane_uomo" });

  assert.equal(availability(event, session), "restricted-audience");
  assert.equal(availability(event, session, {}), "restricted-audience");
  assert.equal(availability(event, session, { forChild: false }), "restricted-audience");
  assert.equal(availability(event, session, { forChild: undefined }), "restricted-audience");
  // E: l'idoneità si valuta sul figlio scelto, non sull'account.
  assert.equal(availability(event, session, { forChild: true }), "open");
});

test("disponibilità: attività solo GD, un accompagnatore non si iscrive, ma può iscrivere un figlio", () => {
  const event = makeEvent({ audience: "giovane_donna" });
  const session = makeAccount({ category: "accompagnatore" });

  assert.equal(availability(event, session), "restricted-audience");
  assert.equal(availability(event, session, { forChild: true }), "open");
});

test("disponibilità: attività solo GU, una giovane donna non si iscrive, ma può iscrivere un figlio", () => {
  const event = makeEvent({ audience: "giovane_uomo" });
  const session = makeAccount({ category: "giovane_donna" });

  assert.equal(availability(event, session), "restricted-audience");
  assert.equal(availability(event, session, { forChild: true }), "open");
});

test("disponibilità: un profilo senza categoria (da completare) a un'attività riservata", () => {
  for (const audience of ["giovane_donna", "giovane_uomo"]) {
    const event = makeEvent({ audience });
    const session = makeAccount({ category: "" });

    assert.equal(availability(event, session), "restricted-audience", audience);
    assert.equal(availability(event, session, { forChild: true }), "open", audience);
  }
});

test("disponibilità: chi è già idoneo resta aperto, con o senza forChild", () => {
  const event = makeEvent({ audience: "giovane_donna" });

  for (const category of ["giovane_donna", "dirigente"]) {
    const session = makeAccount({ category });
    assert.equal(availability(event, session), "open", category);
    assert.equal(availability(event, session, { forChild: true }), "open", category);
  }
});

test("disponibilità: attività congiunta, aperta a ogni categoria, con o senza forChild", () => {
  const event = makeEvent({ audience: "congiunta" });

  for (const category of ["giovane_uomo", "giovane_donna", "dirigente", "accompagnatore", ""]) {
    const session = makeAccount({ category });
    assert.equal(availability(event, session), "open", category);
    assert.equal(availability(event, session, { forChild: true }), "open", category);
  }
});

test("disponibilità: l'account da genitore (isParent) è aperto anche senza forChild", () => {
  for (const audience of ["giovane_donna", "giovane_uomo"]) {
    for (const category of ["giovane_uomo", "giovane_donna", ""]) {
      const session = makeAccount({ category, isParent: true });
      assert.equal(availability(makeEvent({ audience }), session), "open", `${audience} ${category}`);
      assert.equal(availability(makeEvent({ audience }), session, { forChild: true }), "open", `${audience} ${category}`);
    }
  }
});

test("disponibilità: forChild non scavalca gli stati dell'attività", () => {
  const session = makeAccount({ category: "giovane_uomo" });

  const cases = [
    ["iscrizioni non ancora aperte", makeEvent({ registrationOpen: "2999-01-01T00:00:00.000Z" }), "not-open-yet"],
    ["iscrizioni già chiuse (data)", makeEvent({ registrationClose: "2000-06-01T00:00:00.000Z" }), "closed"],
    ["attività annullata", makeEvent({ status: "cancelled" }), "closed"],
    ["attività conclusa", makeEvent({ status: "completed" }), "closed"],
    ["iscrizioni chiuse (stato)", makeEvent({ status: "registrations_closed" }), "closed"],
  ];

  for (const [title, event, expected] of cases) {
    assert.equal(availability(event, session), expected, title);
    assert.equal(availability(event, session, { forChild: true }), expected, `${title} con forChild`);
  }
});

test("disponibilità: forChild non apre a chi non è entrato né all'ospite", () => {
  const event = makeEvent({ audience: "giovane_donna" });
  const sessions = [
    ["nessuna sessione", null],
    ["ospite (sessione anonima)", makeAccount({ isAnonymous: true, category: "giovane_donna" })],
    ["sessione non autenticata", makeAccount({ isAuthenticated: false, category: "giovane_donna" })],
  ];

  for (const allowGuest of [false, true]) {
    for (const [title, session] of sessions) {
      const baseline = availability(event, session, undefined, makeFormConfig(allowGuest));
      const forChild = availability(event, session, { forChild: true }, makeFormConfig(allowGuest));

      assert.equal(baseline, allowGuest ? "guest-allowed" : "login-required", `${title} allowGuest=${allowGuest}`);
      assert.equal(forChild, baseline, `${title} allowGuest=${allowGuest} con forChild`);
      assert.notEqual(forChild, "open", `${title} allowGuest=${allowGuest}`);
    }
  }
});

// ---------------------------------------------------------------------------
// getRegistrationLookupFromSession
// ---------------------------------------------------------------------------

const makeLookupSession = ({ uid = "uid-adulto", role = "participant", isAnonymous = false, isParent = false } = {}) => ({
  firebaseUser: { uid },
  isAnonymous,
  isParent,
  profile: { role },
});

const NONE = { userId: null, anonymousAuthUid: null, anonymousUid: null };

test("lookup: senza sessione non c'è niente da cercare, anche con un figlio", () => {
  assert.deepEqual(getRegistrationLookupFromSession(null), NONE);
  assert.deepEqual(getRegistrationLookupFromSession(null, "figlio-1"), NONE);
});

test("lookup: l'ospite cerca la sua iscrizione anonima, mai quella di un figlio (G6)", () => {
  const session = makeLookupSession({ uid: "uid-ospite", isAnonymous: true });
  const expected = { userId: null, anonymousAuthUid: "uid-ospite", anonymousUid: "uid-ospite" };

  assert.deepEqual(getRegistrationLookupFromSession(session), expected);
  // Anche se arriva un `child` nell'URL: un ospite non ha figli.
  assert.deepEqual(getRegistrationLookupFromSession(session, "figlio-1"), expected);
});

test("lookup: account senza figlio scelto cerca la propria iscrizione, per ogni ruolo", () => {
  for (const [role, isParent] of [
    ["parent", true],
    ["participant", false],
    ["unit_leader", false],
    ["admin", false],
    ["super_admin", false],
  ]) {
    const session = makeLookupSession({ uid: "uid-1", role, isParent });

    for (const childId of [undefined, null, ""]) {
      assert.deepEqual(
        getRegistrationLookupFromSession(session, childId),
        { userId: "uid-1", anonymousAuthUid: null, anonymousUid: null },
        `role=${role} childId=${JSON.stringify(childId)}`,
      );
    }
  }
  assert.deepEqual(getRegistrationLookupFromSession(makeLookupSession({ uid: "uid-2" })), {
    userId: "uid-2",
    anonymousAuthUid: null,
    anonymousUid: null,
  });
});

test("lookup: con un figlio scelto l'iscrizione è child_{uid}_{figlio}, per ogni account non ospite (G2)", () => {
  // Non solo l'account da genitore: partecipante adulto, dirigente e admin
  // iscrivono i figli allo stesso modo e li ritrovano nello stesso documento.
  for (const [role, isParent] of [
    ["parent", true],
    ["participant", false],
    ["unit_leader", false],
    ["admin", false],
    ["super_admin", false],
  ]) {
    const session = makeLookupSession({ uid: "uid-genitore", role, isParent });

    assert.deepEqual(
      getRegistrationLookupFromSession(session, "figlio-7"),
      {
        userId: null,
        anonymousAuthUid: null,
        anonymousUid: null,
        parentUid: "uid-genitore",
        childId: "figlio-7",
      },
      `role=${role}`,
    );
  }
});

test("lookup: un figlio scelto toglie il lookup sull'account, mai i due insieme", () => {
  const lookup = getRegistrationLookupFromSession(makeLookupSession({ role: "unit_leader" }), "figlio-1");

  assert.equal(lookup.userId, null);
  assert.equal(lookup.parentUid, "uid-adulto");
  assert.equal(lookup.childId, "figlio-1");
});

test("lookup: la propria iscrizione non porta parentUid né childId", () => {
  const lookup = getRegistrationLookupFromSession(makeLookupSession({ role: "participant" }));

  assert.equal("parentUid" in lookup, false);
  assert.equal("childId" in lookup, false);
});
