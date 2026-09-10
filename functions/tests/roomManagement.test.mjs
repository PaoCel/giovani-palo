import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  cleanupRegistrationReferences,
  parsePlan,
} = require("../lib/roomManagement.js");

function validPlan() {
  return {
    rooms: [{
      id: "staff",
      name: "Staff",
      capacity: 2,
      floor: "terra",
      category: "staff_male",
      accessible: true,
      notes: "",
      minAge: null,
      maxAge: null,
    }],
    assignments: {},
    lockedIds: [],
    adultGenders: {},
    couples: [],
    revision: 0,
    updatedAt: "",
  };
}

test("il parser rifiuta campi iniettati e non corregge valori invalidi", () => {
  assert.throws(() => parsePlan({ ...validPlan(), published: true }), /campi non ammessi/);
  assert.throws(() => parsePlan({ ...validPlan(), rooms: [{ ...validPlan().rooms[0], capacity: 0 }] }), /Capienza/);
  assert.throws(() => parsePlan({ ...validPlan(), assignments: { person: "path/room" } }), /ID stanza assegnata/);
  const specialMap = JSON.parse('{"__proto__":"staff"}');
  assert.throws(() => parsePlan({ ...validPlan(), assignments: specialMap }), /Assegnazioni: ID/);
  assert.throws(() => parsePlan({ ...validPlan(), assignments: { constructor: "staff" } }), /Assegnazioni: ID/);
  assert.throws(() => parsePlan({ ...validPlan(), rooms: [{ ...validPlan().rooms[0], capacity: 51 }] }), /Capienza/);
});

test("la pulizia elimina ogni riferimento e incrementa la revisione", () => {
  const result = cleanupRegistrationReferences({
    ...validPlan(),
    assignments: { deleted: "staff", kept: "staff" },
    lockedIds: ["deleted", "kept"],
    adultGenders: { deleted: "male", kept: "male" },
    couples: [{ firstId: "deleted", secondId: "kept", confirmed: true }],
    revision: 4,
  }, "deleted", "2026-07-15T12:00:00.000Z");
  assert.deepEqual(result, {
    assignments: { kept: "staff" },
    adultGenders: { kept: "male" },
    lockedIds: ["kept"],
    couples: [],
    revision: 5,
    updatedAt: "2026-07-15T12:00:00.000Z",
  });
  assert.equal(cleanupRegistrationReferences(validPlan(), "absent", "now"), null);
});

test("la cancellazione di un coniuge libera il posto matrimoniale dell'altro", () => {
  const plan = validPlan();
  plan.rooms.push({ ...plan.rooms[0], id: "couple", category: "couple" });
  plan.assignments = { deleted: "couple", kept: "couple" };
  plan.lockedIds = ["deleted", "kept"];
  plan.couples = [{ firstId: "deleted", secondId: "kept", confirmed: true }];
  const cleaned = cleanupRegistrationReferences(plan, "deleted", "now");
  assert.deepEqual(cleaned.assignments, {});
  assert.deepEqual(cleaned.lockedIds, []);
});
