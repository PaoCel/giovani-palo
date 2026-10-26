import test from "node:test";
import assert from "node:assert/strict";
import { getSurveyHref, getSurveyBySlug } from "../src/utils/surveyLinks.ts";

test("sondaggio noto: link breve e risoluzione esplicita", () => {
  const eventId = "55FjHkqgib55rNXfgVk9";
  assert.equal(getSurveyHref(eventId), "/sondaggio/tempio-ottobre-2026");
  assert.deepEqual(getSurveyBySlug("tempio-ottobre-2026"), {
    slug: "tempio-ottobre-2026", stakeId: "roma-est", eventId,
  });
});

test("altri eventi: conserva il link esistente con id codificato", () => {
  assert.equal(getSurveyHref("evento-prova"), "/campeggio/evento-prova?tab=sondaggio");
  assert.equal(getSurveyHref("evento /?&à"), "/campeggio/evento%20%2F%3F%26%C3%A0?tab=sondaggio");
});

test("slug sconosciuto: nessun evento implicito", () => {
  for (const slug of ["", "sconosciuto", "Tempio-ottobre-2026", "tempio-ottobre-2026/altro", "__proto__", "constructor"]) {
    assert.equal(getSurveyBySlug(slug), null);
  }
});
