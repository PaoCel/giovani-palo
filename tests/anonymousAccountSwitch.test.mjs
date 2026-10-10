import test from "node:test";
import assert from "node:assert/strict";

import { isRecordNightPath } from "../src/utils/activityLinks.ts";
import {
  EXISTING_ACCOUNT_RETRY_CODE,
  EXISTING_ACCOUNT_RETRY_MESSAGE,
  isExistingAccountError,
  linkOrSwitchToExistingAccount,
} from "../src/utils/anonymousAccountSwitch.ts";

// "Accedi con Google" da una sessione anonima: la decisione (collegare, oppure
// lasciare la sessione anonima ed entrare nell'account esistente) provata con
// errori finti. Il popup Google vero e l'SDK non si provano da qui.
//
// Comando: node --test tests/anonymousAccountSwitch.test.mjs

const authError = (code) => Object.assign(new Error(`Firebase: Error (${code}).`), { code });

function setup({ linkError = null, credential = { provider: "google" }, readThrows = false } = {}) {
  const calls = [];
  const deps = {
    link: async () => {
      calls.push("link");
      if (linkError) throw linkError;
      return "collegato";
    },
    readCredential: () => {
      calls.push("readCredential");
      if (readThrows) throw new Error("customData mancante");
      return credential;
    },
    discardAnonymousSession: async () => {
      calls.push("discard");
    },
    signInWithCredential: async (value) => {
      calls.push(`signIn:${value.provider}`);
      return "entrato";
    },
  };
  return { calls, run: () => linkOrSwitchToExistingAccount(deps) };
}

test("se il collegamento riesce non si tocca nient'altro", async () => {
  const { calls, run } = setup();
  assert.equal(await run(), "collegato");
  assert.deepEqual(calls, ["link"]);
});

test("Google già usato da un altro account: lascia la sessione anonima, poi entra con la credenziale", async () => {
  for (const code of ["auth/credential-already-in-use", "auth/email-already-in-use"]) {
    const { calls, run } = setup({ linkError: authError(code) });
    assert.equal(await run(), "entrato", code);
    assert.deepEqual(calls, ["link", "readCredential", "discard", "signIn:google"], code);
  }
});

test("credenziale mancante: errore leggibile e neutro, senza il testo grezzo di Firebase", async () => {
  const { calls, run } = setup({ linkError: authError("auth/credential-already-in-use"), credential: null });
  await assert.rejects(run(), (error) => {
    assert.equal(error.message, EXISTING_ACCOUNT_RETRY_MESSAGE);
    assert.equal(error.code, EXISTING_ACCOUNT_RETRY_CODE);
    assert.doesNotMatch(error.message, /auth\/|Firebase/u);
    return true;
  });
  // La sessione anonima è lasciata: al prossimo tentativo Google entra direttamente.
  assert.deepEqual(calls, ["link", "readCredential", "discard"]);
  // Una credenziale `undefined` vale come mancante.
  await assert.rejects(
    linkOrSwitchToExistingAccount({
      link: async () => {
        throw authError("auth/email-already-in-use");
      },
      readCredential: () => undefined,
      discardAnonymousSession: async () => {},
      signInWithCredential: async () => "mai",
    }),
    (error) => error.message === EXISTING_ACCOUNT_RETRY_MESSAGE,
  );
  // Anche se la lettura della credenziale lancia, l'utente vede lo stesso testo.
  const throwing = setup({ linkError: authError("auth/email-already-in-use"), readThrows: true });
  await assert.rejects(throwing.run(), (error) => error.message === EXISTING_ACCOUNT_RETRY_MESSAGE);
});

test("gli altri errori restano com'erano e la sessione anonima non si tocca", async () => {
  for (const code of [
    "auth/popup-closed-by-user",
    "auth/cancelled-popup-request",
    "auth/popup-blocked",
    "auth/network-request-failed",
    "auth/provider-already-linked",
    "auth/account-exists-with-different-credential",
    "auth/user-disabled",
  ]) {
    const error = authError(code);
    const { calls, run } = setup({ linkError: error });
    await assert.rejects(run(), (caught) => caught === error, code);
    assert.deepEqual(calls, ["link"], code);
  }
  const plain = new Error("rete");
  await assert.rejects(setup({ linkError: plain }).run(), (caught) => caught === plain);
});

test("se anche l'accesso con la credenziale fallisce l'errore arriva a chi chiama", async () => {
  const failure = authError("auth/user-disabled");
  const result = linkOrSwitchToExistingAccount({
    link: async () => {
      throw authError("auth/credential-already-in-use");
    },
    readCredential: () => ({ provider: "google" }),
    discardAnonymousSession: async () => {},
    signInWithCredential: async () => {
      throw failure;
    },
  });
  await assert.rejects(result, (caught) => caught === failure);
});

test("riconosce solo gli errori di account esistente", () => {
  assert.equal(isExistingAccountError(authError("auth/credential-already-in-use")), true);
  assert.equal(isExistingAccountError(authError("auth/email-already-in-use")), true);
  for (const value of [authError("auth/popup-closed-by-user"), new Error("x"), null, undefined, "auth/email-already-in-use", { code: 5 }]) {
    assert.equal(isExistingAccountError(value), false);
  }
});

// ---------------------------------------------------------------------------
// Testo del pannello di accesso: dipende dalla pagina di provenienza
// ---------------------------------------------------------------------------

test("isRecordNightPath: la pagina pubblica dei record, anche con query o hash", () => {
  for (const path of [
    "/activities/abc123/record",
    "/activities/abc123/record/",
    "/activities/abc123/record?stake=s1",
    "/activities/abc123/record#top",
    "/activities/55FjHkqgib55rNXfgVk9/record?stake=gugd&x=1",
  ]) {
    assert.equal(isRecordNightPath(path), true, path);
  }
  for (const path of [
    "/activities/abc123/record/gestisci",
    "/activities/abc123/register",
    "/activities/abc123",
    "/activities//record",
    "/activities/abc123/recordings",
    "/me/activities/abc123/record",
    "/record",
    "/login?redirect=/activities/abc123/record",
    "https://example.com/activities/abc123/record",
    "",
    null,
    undefined,
  ]) {
    assert.equal(isRecordNightPath(path), false, String(path));
  }
});
