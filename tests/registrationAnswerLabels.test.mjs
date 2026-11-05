import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getGenderRoleCategoryLabel } from "../src/utils/profile.ts";

// "Dati iscrizione" (/me, scheda admin, PDF): l'organizzazione si salva come
// valore ("giovane_donna") e si mostra con l'etichetta, mai il valore grezzo.
test("ogni valore dell'organizzazione ha un'etichetta italiana", () => {
  assert.equal(getGenderRoleCategoryLabel("giovane_donna"), "Giovane donna");
  assert.equal(getGenderRoleCategoryLabel("giovane_uomo"), "Giovane uomo");
  assert.equal(getGenderRoleCategoryLabel("dirigente"), "Dirigente");
  assert.equal(getGenderRoleCategoryLabel("accompagnatore"), "Accompagnatore");
});

test("le risposte dell'iscrizione usano l'etichetta per l'organizzazione", () => {
  const source = readFileSync(new URL("../src/utils/registrations.ts", import.meta.url), "utf8");
  assert.match(source, /standardField\.key === "genderRoleCategory"[\s\S]{0,120}getGenderRoleCategoryLabel\(value/);
  assert.match(source, /value: categoryLabel \|\| formatRegistrationAnswerValue\(value\)/);
});
