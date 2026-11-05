import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// La pill in testa al pianificatore segue lo stato del piano: a stanze
// pubblicate non dice più "Bozza riservata" (stessa frase della barra in fondo).
test("la pill di stato distingue bozza e stanze comunicate", () => {
  const source = readFileSync(new URL("../src/components/admin/RoomPlanner.tsx", import.meta.url), "utf8");
  assert.match(source, /\{dirty \? "Modifiche da salvare" : plan\.published \? "Stanze comunicate ai partecipanti" : "Bozza riservata"\}/);
  assert.equal(source.match(/"Stanze comunicate ai partecipanti"/g)?.length, 2, "una frase sola per lo stesso concetto");
});
