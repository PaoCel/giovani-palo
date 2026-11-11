import test from "node:test";
import assert from "node:assert/strict";

import { getEffectiveEventStatus, getRegistrationAvailability } from "../src/utils/events.ts";

// Stato effettivo e disponibilità d'iscrizione (docs/ATTIVITA_MODULARI.md,
// «Settimo incremento»: planned pubblica resta «annunciata» anche dentro la
// finestra d'iscrizione).
//
// Comando: node --test tests/events.test.mjs

const DAY = 86_400_000;
const now = Date.now();

const event = (overrides = {}) => ({
  status: "registrations_open",
  isPublic: true,
  registrationOpen: new Date(now - DAY).toISOString(),
  registrationClose: new Date(now + DAY).toISOString(),
  startDate: new Date(now + 30 * DAY).toISOString(),
  endDate: new Date(now + 31 * DAY).toISOString(),
  ...overrides,
});

test("getEffectiveEventStatus: planned pubblica resta planned anche dentro la finestra", () => {
  assert.equal(getEffectiveEventStatus(event({ status: "planned" })), "planned");
  assert.equal(
    getEffectiveEventStatus(event({
      status: "planned",
      registrationOpen: new Date(now - 2 * DAY).toISOString(),
      registrationClose: new Date(now + 2 * DAY).toISOString(),
    })),
    "planned",
  );
  assert.equal(
    getEffectiveEventStatus(event({
      status: "planned",
      registrationOpen: "",
      registrationClose: "",
    })),
    "planned",
  );
});

test("getEffectiveEventStatus: bozza, aperta, cancellata restano com'erano", () => {
  assert.equal(getEffectiveEventStatus(event({ status: "draft", isPublic: false })), "draft");
  assert.equal(getEffectiveEventStatus(event({ status: "planned", isPublic: false })), "draft");
  assert.equal(getEffectiveEventStatus(event({ status: "registrations_open" })), "registrations_open");
  assert.equal(getEffectiveEventStatus(event({ status: "cancelled" })), "cancelled");
});

test("getRegistrationAvailability: planned è sempre not-open-yet, anche autenticato", () => {
  const formConfig = { allowGuestRegistration: true };
  const planned = event({ status: "planned" });
  assert.equal(getRegistrationAvailability(planned, formConfig, null), "not-open-yet");
  const session = {
    isAuthenticated: true,
    isAnonymous: false,
    isParent: false,
    profile: { genderRoleCategory: "giovane_uomo" },
  };
  assert.equal(getRegistrationAvailability(planned, formConfig, session), "not-open-yet");
  assert.equal(
    getRegistrationAvailability(event({ status: "planned", registrationOpen: "", registrationClose: "" }), formConfig, session),
    "not-open-yet",
  );
});
