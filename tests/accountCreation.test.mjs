import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isAccountCreationClosed } from "../src/utils/accountCreation.ts";

// Sulla demo (registrazione chiusa) "Crea un account" e Google non si mostrano
// (docs/KIT_DEMO.md, sezione 2, punto 5); in produzione restano.
test("la creazione di account è chiusa solo sullo staging", () => {
  assert.equal(isAccountCreationClosed("staging"), true);
  assert.equal(isAccountCreationClosed("production"), false);
  assert.equal(isAccountCreationClosed(undefined), false);
  assert.equal(isAccountCreationClosed(""), false);
});

test("il modulo di accesso nasconde schede e Google quando è chiusa", () => {
  const source = readFileSync(new URL("../src/components/auth/AuthCredentialsForm.tsx", import.meta.url), "utf8");
  assert.match(source, /!compactLogin && !ACCOUNT_CREATION_CLOSED \? <div aria-label=\{ACCEDI\.schede\}/);
  assert.match(source, /\{ACCOUNT_CREATION_CLOSED \? null : <button\s+className="auth-google-button"/);
  assert.match(source, /compactLogin \|\| ACCOUNT_CREATION_CLOSED \? "login" : initialMode/);
  // Niente frasi che rimandano a Google o a "Crea un account".
  assert.match(source, /ACCOUNT_CREATION_CLOSED \? ACCEDI\.demoAccountProva : leads\[mode\]/);
  assert.match(source, /!compactLogin && !ACCOUNT_CREATION_CLOSED \? <p className="auth-foot__note">/);
});
