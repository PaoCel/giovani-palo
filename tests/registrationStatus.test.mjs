import test from "node:test";
import assert from "node:assert/strict";
import { resolveRegistrationStatusOnSave } from "../src/utils/registrationStatus.ts";

const existing = (registrationStatus, parentAuthorizationStatus = null) => ({
  registrationStatus,
  parentAuthorization: parentAuthorizationStatus ? { status: parentAuthorizationStatus } : null,
});

test("una nuova iscrizione parte dallo stato richiesto dal modulo", () => {
  assert.equal(resolveRegistrationStatusOnSave(null, "active"), "active");
  assert.equal(
    resolveRegistrationStatusOnSave(null, "pending_parent_authorization"),
    "pending_parent_authorization",
  );
});

test("un'iscrizione esistente conserva lo stato deciso da genitore e admin", () => {
  assert.equal(resolveRegistrationStatusOnSave(existing("confirmed"), "active"), "confirmed");
  assert.equal(
    resolveRegistrationStatusOnSave(existing("pending_parent_authorization"), "active"),
    "pending_parent_authorization",
  );
  assert.equal(
    resolveRegistrationStatusOnSave(existing("rejected_by_parent"), "active"),
    "rejected_by_parent",
  );
});

test("risalvare un'iscrizione annullata la riattiva", () => {
  assert.equal(resolveRegistrationStatusOnSave(existing("cancelled"), "active"), "active");
  assert.equal(
    resolveRegistrationStatusOnSave(existing("cancelled"), "pending_parent_authorization"),
    "pending_parent_authorization",
  );
});

test("l'autorizzazione già firmata non viene richiesta di nuovo", () => {
  assert.equal(
    resolveRegistrationStatusOnSave(
      existing("cancelled", "authorized"),
      "pending_parent_authorization",
    ),
    "active",
  );
  assert.equal(
    resolveRegistrationStatusOnSave(
      existing("cancelled", "email_sent"),
      "pending_parent_authorization",
    ),
    "pending_parent_authorization",
  );
});

test("l'annullamento richiesto vince su qualsiasi stato precedente", () => {
  assert.equal(resolveRegistrationStatusOnSave(existing("confirmed"), "cancelled"), "cancelled");
  assert.equal(resolveRegistrationStatusOnSave(null, "cancelled"), "cancelled");
});
