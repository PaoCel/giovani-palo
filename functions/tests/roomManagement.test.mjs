import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  cleanupRegistrationReferences,
  parsePlan,
  registrationRoomPatch,
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

test("il parser accetta solo il flag di pubblicazione booleano, assente nei piani vecchi", () => {
  assert.equal(parsePlan(validPlan()).published, false);
  assert.equal(parsePlan({ ...validPlan(), published: true }).published, true);
  assert.throws(() => parsePlan({ ...validPlan(), published: "yes" }), /pubblicazione/);
});

test("la pubblicazione comunica la stanza e la bozza la ritira senza toccare i legacy", () => {
  const plan = { ...validPlan(), assignments: { boy: "staff" }, published: true };
  assert.deepEqual(registrationRoomPatch({ id: "boy" }, plan), { assignedRoomId: "staff", assignedRoomName: "Staff" });
  assert.equal(registrationRoomPatch({ id: "boy", assignedRoomId: "staff", assignedRoomName: "Staff" }, plan), null);
  assert.deepEqual(registrationRoomPatch({ id: "boy", assignedRoomId: "staff", assignedRoomName: "Vecchia" }, plan), { assignedRoomId: "staff", assignedRoomName: "Staff" });
  assert.deepEqual(registrationRoomPatch({ id: "other", assignedRoomName: "Staff" }, plan), { assignedRoomId: null, assignedRoomName: null });
  assert.deepEqual(registrationRoomPatch({ id: "boy", assignedRoomId: "staff", assignedRoomName: "Staff" }, { ...plan, published: false }), { assignedRoomId: null, assignedRoomName: null });
  assert.equal(registrationRoomPatch({ id: "boy" }, { ...plan, published: false }), null);
  assert.equal(registrationRoomPatch({ id: "boy", assignedRoomId: "legacy" }, { ...plan, published: false }), null);
  assert.deepEqual(registrationRoomPatch({ id: "boy" }, { ...plan, assignments: { boy: "missing-room" } }), null);
});

test("il parser rifiuta campi iniettati e non corregge valori invalidi", () => {
  assert.throws(() => parsePlan({ ...validPlan(), notes: "x" }), /campi non ammessi/);
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
