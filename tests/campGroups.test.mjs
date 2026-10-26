import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCampGroupLabel, getCampGroupLabels, getCommitteeInitials } from "../src/utils/campGroups.ts";

// Product contract in ATTIVITA_MODULARI: terminology changes no assignment or permission.
const labels = {
  pattuglia: ["Pattuglia", "Pattuglie", "La tua pattuglia", "Capo pattuglia"],
  gruppo: ["Gruppo", "Gruppi", "Il tuo gruppo", "Capo gruppo"],
  compagnia: ["Compagnia", "Compagnie", "La tua compagnia", "Capo compagnia"],
  team: ["Team", "Team", "Il tuo team", "Capo team"],
  squadra: ["Squadra", "Squadre", "La tua squadra", "Capo squadra"],
};
for (const [value, expected] of Object.entries(labels)) {
  test(`denominazione ${value}: titolo, plurale, vista personale e ruolo coerenti`, () => {
    assert.equal(normalizeCampGroupLabel(value), value);
    const actual = getCampGroupLabels(value);
    assert.deepEqual([actual.singular, actual.plural, actual.your, actual.leader], expected);
    assert.equal(actual.add, `Aggiungi ${value}`);
    assert.equal(actual.remove, value === "pattuglia" || value === "compagnia" || value === "squadra"
      ? `Eliminare la ${value}` : `Eliminare il ${value}`);
    for (const text of Object.values(actual)) {
      assert.equal(typeof text, "string");
      assert.doesNotMatch(text, /\p{Extended_Pictographic}/u);
    }
  });
}

test("piano legacy o valore ignoto: terminologia Pattuglia, anche per chiavi del prototipo", () => {
  for (const value of [undefined, null, "", "sconosciuto", "constructor", "toString", "__proto__", 42, {}, []]) {
    assert.equal(normalizeCampGroupLabel(value), "pattuglia");
    assert.equal(getCampGroupLabels(value).your, "La tua pattuglia");
  }
});

test("iniziali comitato: spazi normalizzati, due parole e lettere accentate intere", () => {
  assert.equal(getCommitteeInitials("  Logistica   e materiali  "), "LE");
  assert.equal(getCommitteeInitials("Èquipe attività"), "ÈA");
  assert.equal(getCommitteeInitials("Cucina"), "C");
  assert.equal(getCommitteeInitials(" \t\n "), "");
});
