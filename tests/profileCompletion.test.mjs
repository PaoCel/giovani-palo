import test from "node:test";
import assert from "node:assert/strict";

import {
  BIRTH_DATE_MIN,
  canBecomeParent,
  canChooseAccountType,
  getAgeOn,
  isAcceptableBirthDate,
  isEmailDerivedName,
  isMinorOn,
  isPlaceholderName,
  needsProfileCompletion,
  parseCalendarDate,
  shouldApplyAccountType,
  toCalendarDateValue,
} from "../src/utils/profileCompletion.ts";

// Profilo da completare, tipo di account scelto da sé, età e date di nascita
// (docs/FLUSSO_GENITORE.md, B, D e "Utente che sbaglia"):
// - io: Nome, Cognome, Data di nascita, Organizzazione e Unità;
// - genitore: Nome, Cognome, Comune, Unità (i dati anagrafici stanno sui figli);
// - account di un minore: meno di 18 anni oggi;
// - il campo data non accetta date future né prima del 1920.
//
// Tutte le date sono giorni di calendario locali, costruiti con
// new Date(anno, mese - 1, giorno): mai stringhe ISO con orario, che
// cambierebbero giorno a seconda del fuso della macchina.
//
// Comando: node --test tests/profileCompletion.test.mjs

const day = (year, month, date, hours = 0, minutes = 0) => new Date(year, month - 1, date, hours, minutes);

// ---------------------------------------------------------------------------
// needsProfileCompletion
// ---------------------------------------------------------------------------

const participant = (overrides = {}) => ({
  role: "participant",
  fullName: "Marco Rossi",
  birthDate: "2010-05-04",
  genderRoleCategory: "giovane_uomo",
  unitName: "Rione Uno",
  stakeId: "palo-roma",
  city: "",
  ...overrides,
});

const parent = (overrides = {}) => ({
  role: "parent",
  fullName: "Paola Rossi",
  birthDate: "",
  genderRoleCategory: "",
  unitName: "Rione Uno",
  stakeId: "palo-roma",
  city: "Roma",
  ...overrides,
});

test("needsProfileCompletion: partecipante completo, il comune non serve", () => {
  assert.equal(needsProfileCompletion(participant()), false);
  assert.equal(needsProfileCompletion(participant({ city: "Roma" })), false);
});

test("needsProfileCompletion: partecipante, manca un campo alla volta", () => {
  for (const field of ["fullName", "birthDate", "genderRoleCategory", "unitName", "stakeId"]) {
    assert.equal(needsProfileCompletion(participant({ [field]: "" })), true, `manca ${field}`);
  }
});

test("needsProfileCompletion: «Partecipante» è un nome segnaposto", () => {
  assert.equal(needsProfileCompletion(participant({ fullName: "Partecipante" })), true);
  assert.equal(needsProfileCompletion(parent({ fullName: "Partecipante" })), true);
});

test("needsProfileCompletion: genitore completo senza data di nascita né gruppo", () => {
  assert.equal(needsProfileCompletion(parent()), false);
});

test("needsProfileCompletion: genitore, manca un campo alla volta", () => {
  for (const field of ["fullName", "unitName", "stakeId", "city"]) {
    assert.equal(needsProfileCompletion(parent({ [field]: "" })), true, `manca ${field}`);
  }
});

test("needsProfileCompletion: account nuovo appena creato (profilo di ensureProfileForUser)", () => {
  // Payload di creazione: nome da Google o dall'email, tutto il resto vuoto.
  const fresh = { role: "participant", fullName: "marco.rossi", birthDate: "", genderRoleCategory: "", unitName: "", stakeId: "palo-roma", city: "" };
  assert.equal(needsProfileCompletion(fresh), true);
  assert.equal(needsProfileCompletion({ ...fresh, role: "parent" }), true);
});

test("isPlaceholderName: vuoto o «Partecipante»", () => {
  assert.equal(isPlaceholderName(""), true);
  assert.equal(isPlaceholderName(null), true);
  assert.equal(isPlaceholderName(undefined), true);
  assert.equal(isPlaceholderName("Partecipante"), true);
  assert.equal(isPlaceholderName("Marco Rossi"), false);
});

// ---------------------------------------------------------------------------
// canChooseAccountType
// ---------------------------------------------------------------------------

test("canChooseAccountType: solo partecipante e genitore cambiano tipo da soli", () => {
  assert.equal(canChooseAccountType("participant"), true);
  assert.equal(canChooseAccountType("parent"), true);
  for (const role of ["unit_leader", "admin", "super_admin", "", "PARENT", "guest"]) {
    assert.equal(canChooseAccountType(role), false, `role=${JSON.stringify(role)}`);
  }
});

// ---------------------------------------------------------------------------
// parseCalendarDate / toCalendarDateValue
// ---------------------------------------------------------------------------

test("parseCalendarDate: giorno locale a mezzanotte", () => {
  const date = parseCalendarDate("2009-01-05");
  assert.ok(date instanceof Date);
  assert.equal(date.getFullYear(), 2009);
  assert.equal(date.getMonth(), 0);
  assert.equal(date.getDate(), 5);
  assert.equal(date.getHours(), 0);
  assert.equal(date.getMinutes(), 0);
  assert.equal(date.getTime(), day(2009, 1, 5).getTime());
});

test("parseCalendarDate: 29 febbraio solo negli anni bisestili", () => {
  assert.equal(parseCalendarDate("2024-02-29")?.getTime(), day(2024, 2, 29).getTime());
  assert.equal(parseCalendarDate("2000-02-29")?.getTime(), day(2000, 2, 29).getTime());
  assert.equal(parseCalendarDate("2023-02-29"), null);
  assert.equal(parseCalendarDate("1900-02-29"), null);
});

test("parseCalendarDate: date che non esistono → null", () => {
  for (const value of ["2023-02-30", "2023-04-31", "2023-13-01", "2023-00-10", "2023-01-00", "2023-01-32"]) {
    assert.equal(parseCalendarDate(value), null, value);
  }
});

test("parseCalendarDate: formati sbagliati → null", () => {
  for (const value of [
    "",
    " ",
    "2023-1-5",
    "23-01-05",
    "2023/01/05",
    "05/01/2023",
    "05-01-2023",
    "2023-01-05T00:00:00",
    "2023-01-05T00:00:00.000Z",
    " 2023-01-05",
    "2023-01-05 ",
    "20230105",
    "domani",
    null,
    undefined,
    20230105,
    {},
  ]) {
    assert.equal(parseCalendarDate(value), null, JSON.stringify(value));
  }
});

test("toCalendarDateValue: ritorno a YYYY-MM-DD con gli zeri", () => {
  assert.equal(toCalendarDateValue(day(2009, 1, 5)), "2009-01-05");
  assert.equal(toCalendarDateValue(day(2009, 12, 31, 23, 59)), "2009-12-31");
  assert.equal(toCalendarDateValue(parseCalendarDate("2024-02-29")), "2024-02-29");
});

// ---------------------------------------------------------------------------
// getAgeOn / isMinorOn
// ---------------------------------------------------------------------------

test("getAgeOn: il giorno del compleanno gli anni sono compiuti, il giorno prima no", () => {
  assert.equal(getAgeOn("2008-10-19", day(2026, 10, 19)), 18);
  assert.equal(getAgeOn("2008-10-19", day(2026, 10, 18)), 17);
  assert.equal(getAgeOn("2008-10-19", day(2026, 10, 20)), 18);
  // L'ora del giorno non conta.
  assert.equal(getAgeOn("2008-10-19", day(2026, 10, 19, 0, 1)), 18);
  assert.equal(getAgeOn("2008-10-19", day(2026, 10, 18, 23, 59)), 17);
});

test("getAgeOn: compleanno a fine anno e a inizio anno", () => {
  assert.equal(getAgeOn("2008-12-31", day(2026, 12, 30)), 17);
  assert.equal(getAgeOn("2008-12-31", day(2026, 12, 31)), 18);
  assert.equal(getAgeOn("2008-01-01", day(2025, 12, 31)), 17);
  assert.equal(getAgeOn("2008-01-01", day(2026, 1, 1)), 18);
});

test("getAgeOn: nato il 29 febbraio", () => {
  // Anno bisestile: compie gli anni il 29.
  assert.equal(getAgeOn("2008-02-29", day(2028, 2, 28)), 19);
  assert.equal(getAgeOn("2008-02-29", day(2028, 2, 29)), 20);
  // Anno non bisestile: il 27 febbraio no, il 1° marzo sì.
  assert.equal(getAgeOn("2008-02-29", day(2026, 2, 27)), 17);
  assert.equal(getAgeOn("2008-02-29", day(2026, 3, 1)), 18);
  // Il 28 febbraio la spec non dice nulla: convenzione adottata, compie gli
  // anni il 1° marzo (per un giorno resta minore, la scelta prudente).
  assert.equal(getAgeOn("2008-02-29", day(2026, 2, 28)), 17);
});

test("getAgeOn: nato oggi ha 0 anni; data futura o non valida → null", () => {
  assert.equal(getAgeOn("2026-10-19", day(2026, 10, 19)), 0);
  assert.equal(getAgeOn("2026-10-20", day(2026, 10, 19)), null);
  assert.equal(getAgeOn("2027-01-01", day(2026, 10, 19)), null);
  for (const value of ["", null, undefined, "2023-02-30", "19/10/2008", "2008-10-19T10:00:00"]) {
    assert.equal(getAgeOn(value, day(2026, 10, 19)), null, JSON.stringify(value));
  }
});

test("isMinorOn: 17 anni e 364 giorni è minore, 18 compiuti oggi no", () => {
  assert.equal(isMinorOn("2008-10-19", day(2026, 10, 18)), true);
  assert.equal(isMinorOn("2008-10-19", day(2026, 10, 19)), false);
  assert.equal(isMinorOn("2008-10-19", day(2026, 10, 18, 23, 59)), true);
  assert.equal(isMinorOn("2012-02-26", day(2026, 10, 19)), true);
  assert.equal(isMinorOn("1980-04-24", day(2026, 10, 19)), false);
});

test("isMinorOn: senza data valida non è un account di un minore", () => {
  for (const value of ["", null, undefined, "2023-02-30", "2027-01-01"]) {
    assert.equal(isMinorOn(value, day(2026, 10, 19)), false, JSON.stringify(value));
  }
});

// ---------------------------------------------------------------------------
// isAcceptableBirthDate
// ---------------------------------------------------------------------------

test("isAcceptableBirthDate: oggi sì, domani no", () => {
  const today = day(2026, 10, 19);
  assert.equal(isAcceptableBirthDate("2026-10-19", today), true);
  assert.equal(isAcceptableBirthDate("2026-10-20", today), false);
  assert.equal(isAcceptableBirthDate("2030-01-01", today), false);
});

test("isAcceptableBirthDate: oggi resta accettato anche a fine giornata", () => {
  assert.equal(isAcceptableBirthDate("2026-10-19", day(2026, 10, 19, 23, 59)), true);
  assert.equal(isAcceptableBirthDate("2026-10-20", day(2026, 10, 19, 23, 59)), false);
});

test("isAcceptableBirthDate: dal 1920 in poi", () => {
  const today = day(2026, 10, 19);
  assert.equal(BIRTH_DATE_MIN, "1920-01-01");
  assert.equal(isAcceptableBirthDate("1920-01-01", today), true);
  assert.equal(isAcceptableBirthDate("1919-12-31", today), false);
  assert.equal(isAcceptableBirthDate("1900-06-15", today), false);
  assert.equal(isAcceptableBirthDate("2010-05-04", today), true);
});

test("isAcceptableBirthDate: vuota o non valida → no", () => {
  const today = day(2026, 10, 19);
  for (const value of ["", null, undefined, "2023-02-30", "2023-02-29", "04/05/2010", "2010-05-04T00:00:00", "0050-01-01"]) {
    assert.equal(isAcceptableBirthDate(value, today), false, JSON.stringify(value));
  }
});

// ---------------------------------------------------------------------------
// shouldApplyAccountType: il tipo scelto in "per chi" si scrive solo su un
// account appena creato, da completare, con un ruolo che può sceglierlo
// ---------------------------------------------------------------------------

// Profilo appena creato da ensureProfileForUser: nome dall'email, resto vuoto.
const freshProfile = (overrides = {}) => ({
  role: "participant",
  fullName: "mario.rossi",
  birthDate: "",
  genderRoleCategory: "",
  unitName: "",
  stakeId: "palo-roma",
  city: "",
  ...overrides,
});

test("shouldApplyAccountType: account nuovo da completare, tipo diverso → sì", () => {
  assert.equal(shouldApplyAccountType({ accountType: "parent", isNewAccount: true, profile: freshProfile() }), true);
  assert.equal(
    shouldApplyAccountType({ accountType: "participant", isNewAccount: true, profile: freshProfile({ role: "parent" }) }),
    true,
  );
});

test("shouldApplyAccountType: senza tipo scelto → no", () => {
  assert.equal(shouldApplyAccountType({ accountType: undefined, isNewAccount: true, profile: freshProfile() }), false);
});

test("shouldApplyAccountType: account esistente mai, anche da completare", () => {
  for (const accountType of ["participant", "parent"]) {
    for (const role of ["participant", "parent"]) {
      assert.equal(
        shouldApplyAccountType({ accountType, isNewAccount: false, profile: freshProfile({ role }) }),
        false,
        `${role} → ${accountType}`,
      );
    }
  }
  // Il ragazzo esistente col profilo incompleto non diventa genitore entrando.
  assert.equal(shouldApplyAccountType({ accountType: "parent", isNewAccount: false, profile: participant({ unitName: "" }) }), false);
});

test("shouldApplyAccountType: account nuovo ma già completo → no", () => {
  assert.equal(shouldApplyAccountType({ accountType: "parent", isNewAccount: true, profile: participant() }), false);
  assert.equal(shouldApplyAccountType({ accountType: "participant", isNewAccount: true, profile: parent() }), false);
});

test("shouldApplyAccountType: dirigenti e admin restano quello che sono", () => {
  for (const role of ["unit_leader", "admin", "super_admin"]) {
    for (const accountType of ["participant", "parent"]) {
      assert.equal(
        shouldApplyAccountType({ accountType, isNewAccount: true, profile: freshProfile({ role }) }),
        false,
        `${role} → ${accountType}`,
      );
    }
  }
});

test("shouldApplyAccountType: stesso ruolo → no (niente scrittura inutile)", () => {
  assert.equal(shouldApplyAccountType({ accountType: "participant", isNewAccount: true, profile: freshProfile() }), false);
  assert.equal(
    shouldApplyAccountType({ accountType: "parent", isNewAccount: true, profile: freshProfile({ role: "parent" }) }),
    false,
  );
});

test("shouldApplyAccountType: vero solo con tutte e cinque le condizioni", () => {
  const profiles = {
    nuovo: freshProfile(),
    completo: participant(),
    genitoreNuovo: freshProfile({ role: "parent" }),
    genitoreCompleto: parent(),
    dirigente: freshProfile({ role: "unit_leader" }),
    admin: freshProfile({ role: "admin" }),
  };
  for (const accountType of [undefined, "participant", "parent"]) {
    for (const isNewAccount of [false, true]) {
      for (const [name, profile] of Object.entries(profiles)) {
        const expected = Boolean(
          accountType &&
            isNewAccount &&
            profile.role !== accountType &&
            (profile.role === "participant" || profile.role === "parent") &&
            needsProfileCompletion(profile),
        );
        assert.equal(
          shouldApplyAccountType({ accountType, isNewAccount, profile }),
          expected,
          `${name} new=${isNewAccount} → ${accountType}`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// canBecomeParent: mai l'account di un minore, mai dirigenti e admin
// ---------------------------------------------------------------------------

test("canBecomeParent: partecipante o genitore senza data → sì", () => {
  const today = day(2026, 10, 19);
  for (const role of ["participant", "parent"]) {
    for (const birthDate of ["", null, undefined]) {
      assert.equal(canBecomeParent(role, birthDate, today), true, `${role} ${JSON.stringify(birthDate)}`);
    }
  }
});

test("canBecomeParent: adulto → sì, anche con 18 anni compiuti oggi", () => {
  const today = day(2026, 10, 19);
  assert.equal(canBecomeParent("participant", "1980-04-24", today), true);
  assert.equal(canBecomeParent("parent", "1980-04-24", today), true);
  assert.equal(canBecomeParent("participant", "2008-10-19", today), true);
});

test("canBecomeParent: data di nascita da minore → no, anche col profilo da completare", () => {
  const today = day(2026, 10, 19);
  assert.equal(canBecomeParent("participant", "2012-02-26", today), false);
  // 17 anni e 364 giorni.
  assert.equal(canBecomeParent("participant", "2008-10-20", today), false);
  // Il ruolo non conta: con una data da minore non si diventa genitore.
  assert.equal(canBecomeParent("parent", "2011-03-14", today), false);
});

test("canBecomeParent: dirigenti e admin → no, con o senza data", () => {
  const today = day(2026, 10, 19);
  for (const role of ["unit_leader", "admin", "super_admin", ""]) {
    for (const birthDate of ["", "1980-04-24"]) {
      assert.equal(canBecomeParent(role, birthDate, today), false, `${role} ${birthDate}`);
    }
  }
});

// ---------------------------------------------------------------------------
// isEmailDerivedName: il nome provvisorio preso dall'email
// ---------------------------------------------------------------------------

test("isEmailDerivedName: nome uguale alla parte prima della @ → sì", () => {
  assert.equal(isEmailDerivedName("mario.rossi", "mario.rossi@x.it"), true);
  assert.equal(isEmailDerivedName("paola_r82", "paola_r82@example.invalid"), true);
});

test("isEmailDerivedName: spazi intorno al nome non contano", () => {
  assert.equal(isEmailDerivedName("  mario.rossi  ", "mario.rossi@x.it"), true);
  assert.equal(isEmailDerivedName("mario.rossi\n", "mario.rossi@x.it"), true);
});

test("isEmailDerivedName: un nome vero → no", () => {
  assert.equal(isEmailDerivedName("Mario Rossi", "mario.rossi@x.it"), false);
  assert.equal(isEmailDerivedName("Mario", "mario.rossi@x.it"), false);
  assert.equal(isEmailDerivedName("mario.rossi", "paola.rossi@x.it"), false);
  assert.equal(isEmailDerivedName("mario.rossi@x.it", "mario.rossi@x.it"), false);
});

test("isEmailDerivedName: vuoti o null → no", () => {
  for (const [fullName, email] of [
    ["", "mario.rossi@x.it"],
    ["   ", "mario.rossi@x.it"],
    [null, "mario.rossi@x.it"],
    [undefined, "mario.rossi@x.it"],
    ["mario.rossi", ""],
    ["mario.rossi", null],
    ["mario.rossi", undefined],
    ["", ""],
    [null, null],
    [undefined, undefined],
    // Email senza parte locale: niente da confrontare.
    ["", "@x.it"],
  ]) {
    assert.equal(isEmailDerivedName(fullName, email), false, `${JSON.stringify(fullName)} / ${JSON.stringify(email)}`);
  }
});
