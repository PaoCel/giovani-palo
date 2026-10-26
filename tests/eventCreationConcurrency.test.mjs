import test from "node:test";
import assert from "node:assert/strict";
import { getActivityRequirementChanges, nextEventRevision } from "../src/utils/eventCreation.ts";

const types = ["standard", "overnight", "trip", "camp", "multi_day"];
const requirements = value => ({
  requiresAccount: value,
  requiresParentAuthorization: value,
  requiresEmergencyContacts: value,
  requiresMedicalNotes: value,
});

for (const before of types) {
  for (const after of types) {
    test(`requisiti ${before} → ${after}: conserva le scelte nella stessa classe`, () => {
      const sameClass = (before === "standard") === (after === "standard");
      assert.deepEqual(getActivityRequirementChanges(before, after), sameClass ? {} : requirements(after !== "standard"));
      const customized = { ...requirements(false), requiresAccount: true };
      if (sameClass) assert.deepEqual({ ...customized, ...getActivityRequirementChanges(before, after) }, customized);
    });
  }
}

test("revisione: primo salvataggio e valore legacy invalido usano l'ora fornita", () => {
  const now = Date.parse("2027-01-01T12:00:00.000Z");
  for (const previous of [undefined, "", "non-una-data"]) {
    assert.equal(nextEventRevision(previous, now), new Date(now).toISOString());
  }
});

test("revisione: due salvataggi nello stesso millisecondo restano distinguibili", () => {
  const now = Date.parse("2027-01-01T12:00:00.000Z");
  const first = nextEventRevision(undefined, now);
  const second = nextEventRevision(first, now);
  const third = nextEventRevision(second, now);
  assert.ok(Date.parse(second) > Date.parse(first));
  assert.ok(Date.parse(third) > Date.parse(second));
  assert.equal(new Date(third).toISOString(), third);
});

test("revisione: orologio indietro non riutilizza una revisione precedente", () => {
  const previous = "2027-01-01T12:00:00.123Z";
  for (const offset of [-86400000, -1, 0, 1, 86400000]) {
    const now = Date.parse(previous) + offset;
    const next = nextEventRevision(previous, now);
    assert.ok(Date.parse(next) > Date.parse(previous));
    assert.ok(Date.parse(next) >= now);
    assert.equal(next, new Date(next).toISOString());
  }
});

test("revisione: senza ora esplicita usa un istante corrente valido", () => {
  const before = Date.now();
  const next = nextEventRevision(undefined);
  const after = Date.now();
  assert.ok(Date.parse(next) >= before && Date.parse(next) <= after);
});
