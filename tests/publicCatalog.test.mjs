import test from "node:test";
import assert from "node:assert/strict";

import {
  formatHomeWhen,
  formatListWhen,
  monthKey,
  monthLabel,
  publicActivityTypeLabel,
  publicActivityTypeOf,
  resolvePublicCatalogStakeId,
} from "../src/utils/publicCatalog.ts";

// Il palo pubblico non si sceglie da solo: senza una scelta resta tutta Italia.
test("senza palo scelto resta tutta Italia", () => {
  assert.equal(resolvePublicCatalogStakeId(null, "", ["roma-est", "milano-est"]), "");
  assert.equal(resolvePublicCatalogStakeId(null, "", null), "");
});

test("un palo memorizzato o nell'indirizzo vale solo se è attivo", () => {
  assert.equal(resolvePublicCatalogStakeId(null, "milano-est", ["roma-est", "milano-est"]), "milano-est");
  assert.equal(
    resolvePublicCatalogStakeId("roma-est", "milano-est", ["roma-est", "milano-est"]),
    "roma-est",
  );
  assert.equal(resolvePublicCatalogStakeId("sconosciuto", "milano-est", ["roma-est", "milano-est"]), "milano-est");
  assert.equal(resolvePublicCatalogStakeId("sconosciuto", "sconosciuto", ["roma-est"]), "");
});

test("finché l'elenco pali non è arrivato ci si fida della scelta già fatta", () => {
  assert.equal(resolvePublicCatalogStakeId("roma-est", "", null), "roma-est");
  assert.equal(resolvePublicCatalogStakeId(null, "milano-est", null), "milano-est");
});

test("le date pubbliche seguono il calendario italiano", () => {
  const gala = {
    startDate: new Date(2027, 0, 16, 17, 0).toISOString(),
    endDate: new Date(2027, 0, 16, 22, 30).toISOString(),
    location: "Centro di Palo",
  };

  assert.deepEqual(formatHomeWhen(gala), {
    date: "Sab 16 gen 2027",
    suffix: ", 17:00 · Centro di Palo",
  });
  assert.equal(
    formatListWhen(gala),
    "Sabato 16 gennaio 2027, 17:00–22:30 · Centro di Palo",
  );

  const camp = {
    startDate: new Date(2026, 6, 15, 0, 0).toISOString(),
    endDate: new Date(2026, 6, 18, 0, 0).toISOString(),
    location: "Nazzano (RM)",
  };

  assert.equal(formatListWhen(camp), "Mercoledì 15 – sabato 18 luglio 2026 · Nazzano (RM)");
  assert.equal(monthKey(gala.startDate), "2027-01");
  assert.equal(monthLabel("2027-01"), "Gennaio 2027");
});

test("il tipo in elenco usa le etichette corte del mockup", () => {
  assert.equal(publicActivityTypeOf({ overnight: true }), "overnight");
  assert.equal(publicActivityTypeOf({ activityType: "camp" }), "camp");
  assert.equal(publicActivityTypeLabel("overnight"), "Pernottamento");
  assert.equal(publicActivityTypeLabel("standard"), "Attività");
});
