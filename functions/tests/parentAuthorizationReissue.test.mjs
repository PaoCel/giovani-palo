import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { shouldReissueParentAuthorization } = require("../lib/parentAuthorization.js");

function registration({ requestEmail, stateEmail, status = "email_sent" }) {
  return {
    answers: {
      parentAuthorizationRequest: {
        parentFirstName: "Genitore",
        parentLastName: "Esempio",
        parentEmail: requestEmail,
        parentPhone: "3000000000",
      },
    },
    parentAuthorization: {
      status,
      tokenId: "token-esistente",
      parentEmail: stateEmail,
    },
  };
}

test("il modulo che cambia la mail del genitore fa ripartire la richiesta", () => {
  assert.equal(
    shouldReissueParentAuthorization(
      registration({ requestEmail: "padre@example.invalid", stateEmail: "madre@example.invalid" }),
    ),
    true,
  );
});

test("la stessa mail, anche scritta diversamente, non rimanda nulla", () => {
  assert.equal(
    shouldReissueParentAuthorization(
      registration({ requestEmail: " Madre@Example.invalid ", stateEmail: "madre@example.invalid" }),
    ),
    false,
  );
});

test("una decisione già presa del genitore non si sposta di casella", () => {
  for (const status of ["authorized", "rejected_by_parent", "revoked"]) {
    assert.equal(
      shouldReissueParentAuthorization(
        registration({
          requestEmail: "padre@example.invalid",
          stateEmail: "madre@example.invalid",
          status,
        }),
      ),
      false,
      `status ${status}`,
    );
  }
});

test("un link scaduto può essere spostato su un altro genitore", () => {
  assert.equal(
    shouldReissueParentAuthorization(
      registration({
        requestEmail: "padre@example.invalid",
        stateEmail: "madre@example.invalid",
        status: "expired",
      }),
    ),
    true,
  );
});

test("senza richiesta, senza stato o senza mail nuova non si fa nulla", () => {
  assert.equal(shouldReissueParentAuthorization({}), false);
  assert.equal(
    shouldReissueParentAuthorization({ answers: { parentAuthorizationRequest: { parentEmail: "x@y.invalid" } } }),
    false,
  );
  assert.equal(
    shouldReissueParentAuthorization(
      registration({ requestEmail: "", stateEmail: "madre@example.invalid" }),
    ),
    false,
  );
});
