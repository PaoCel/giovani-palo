import test from "node:test";
import assert from "node:assert/strict";

import {
  WRITE_TIMEOUT_CODE,
  WRITE_TIMEOUT_MS,
  isConnectionError,
  isOffline,
  withWriteTimeout,
} from "../src/utils/writeTimeout.ts";

// Scritture senza rete nel percorso d'iscrizione (docs/FLUSSO_GENITORE.md, E e
// F: "Invio senza rete o con errore: il pulsante torna attivo, le risposte
// restano, messaggio in italiano"). Con la cache persistente di Firestore la
// promessa di una scrittura offline non si chiude mai: dopo un tempo limite
// deve rigettare con un codice riconoscibile come errore di rete, senza
// cambiare niente se l'esito vero arriva dopo.
//
// Comando: node --test tests/writeTimeout.test.mjs

// Una promessa che non si chiude mai: la scrittura offline, in coda.
const never = () => new Promise(() => {});
const wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// withWriteTimeout
// ---------------------------------------------------------------------------

test("withWriteTimeout: se la promessa arriva prima risolve con il suo valore", async () => {
  assert.equal(await withWriteTimeout(Promise.resolve("fatto"), 20), "fatto");

  const value = { id: "child-marco" };
  assert.equal(await withWriteTimeout(Promise.resolve(value), 20), value);

  // Anche se arriva dopo un po', purché prima del limite.
  assert.equal(await withWriteTimeout(wait(5).then(() => "tardi"), 500), "tardi");

  // Un valore vuoto resta tale.
  assert.equal(await withWriteTimeout(Promise.resolve(undefined), 20), undefined);
});

test("withWriteTimeout: se la promessa non arriva rigetta con code «write-timeout» dopo il limite", async () => {
  assert.equal(WRITE_TIMEOUT_CODE, "write-timeout");

  const startedAt = Date.now();
  await assert.rejects(withWriteTimeout(never(), 20), (caught) => {
    assert.ok(caught instanceof Error, "deve essere un Error");
    assert.equal(caught.code, "write-timeout");
    // È un errore di rete: il messaggio sarà "controlla la connessione".
    assert.equal(isConnectionError(caught), true);
    return true;
  });
  // Non prima del limite (con un po' di margine per i timer).
  assert.ok(Date.now() - startedAt >= 10, "rigettata troppo presto");
});

test("withWriteTimeout: se la promessa rigetta prima inoltra lo stesso errore", async () => {
  const original = Object.assign(new Error("Missing or insufficient permissions."), {
    code: "permission-denied",
  });
  await assert.rejects(withWriteTimeout(Promise.reject(original), 20), (caught) => {
    assert.equal(caught, original);
    assert.equal(caught.code, "permission-denied");
    assert.equal(isConnectionError(caught), false);
    return true;
  });

  // Anche un valore che non è un Error passa com'è.
  await assert.rejects(withWriteTimeout(Promise.reject("rete"), 20), (caught) => caught === "rete");

  // Un errore di rete vero, arrivato prima del limite, resta quello.
  const unavailable = Object.assign(new Error("offline"), { code: "unavailable" });
  await assert.rejects(withWriteTimeout(Promise.reject(unavailable), 20), (caught) => caught === unavailable);
});

test("withWriteTimeout: un esito arrivato dopo il limite non cambia niente", async () => {
  const lateValue = deferred();
  const guarded = withWriteTimeout(lateValue.promise, 10);
  await assert.rejects(guarded, (caught) => caught.code === WRITE_TIMEOUT_CODE);
  lateValue.resolve("troppo tardi");
  assert.equal(await lateValue.promise, "troppo tardi");
  // La promessa protetta resta rigettata con il tempo scaduto.
  await assert.rejects(guarded, (caught) => caught.code === WRITE_TIMEOUT_CODE);
});

test("withWriteTimeout: un rifiuto arrivato dopo il limite non lascia rifiuti non gestiti", async (t) => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  t.after(() => process.off("unhandledRejection", onUnhandled));

  // Chi chiama tiene solo la promessa protetta, non quella originale: è il
  // caso della scrittura offline che fallisce quando torna la rete.
  const lateFailure = deferred();
  const guarded = withWriteTimeout(lateFailure.promise, 10);
  await assert.rejects(guarded, (caught) => caught.code === WRITE_TIMEOUT_CODE);

  lateFailure.reject(Object.assign(new Error("dopo"), { code: "permission-denied" }));

  // Lascia passare microtask e un giro di event loop.
  await wait(30);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(unhandled, [], "rifiuti non gestiti dopo il limite");
  await assert.rejects(guarded, (caught) => caught.code === WRITE_TIMEOUT_CODE);
});

test("withWriteTimeout: ferma il timer quando la promessa si chiude prima", async (t) => {
  const clear = t.mock.method(globalThis, "clearTimeout");
  await withWriteTimeout(Promise.resolve("ok"), 500);
  assert.equal(clear.mock.callCount(), 1);
  await assert.rejects(withWriteTimeout(Promise.reject(new Error("no")), 500), /no/u);
  assert.equal(clear.mock.callCount(), 2);
});

test("withWriteTimeout: il limite predefinito è WRITE_TIMEOUT_MS, un tempo sensato", async (t) => {
  assert.ok(Number.isFinite(WRITE_TIMEOUT_MS));
  // Abbastanza per una rete lenta, non tanto da lasciare il pulsante bloccato.
  assert.ok(WRITE_TIMEOUT_MS >= 5000 && WRITE_TIMEOUT_MS <= 30000, `WRITE_TIMEOUT_MS=${WRITE_TIMEOUT_MS}`);

  t.mock.timers.enable({ apis: ["setTimeout"] });
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  let rejected = null;
  withWriteTimeout(never()).catch((error) => {
    rejected = error;
  });

  t.mock.timers.tick(WRITE_TIMEOUT_MS - 1);
  await flush();
  assert.equal(rejected, null, "rigettata prima del limite predefinito");

  t.mock.timers.tick(1);
  await flush();
  assert.ok(rejected, "non rigettata allo scadere del limite predefinito");
  assert.equal(rejected.code, WRITE_TIMEOUT_CODE);
});

// ---------------------------------------------------------------------------
// isConnectionError
// ---------------------------------------------------------------------------

test("isConnectionError: tempo scaduto e rete assente, anche con il prefisso firestore/ o functions/", () => {
  for (const code of [
    "write-timeout",
    "unavailable",
    "deadline-exceeded",
    "firestore/unavailable",
    "firestore/deadline-exceeded",
    "functions/unavailable",
    "functions/deadline-exceeded",
  ]) {
    assert.equal(isConnectionError(Object.assign(new Error(code), { code })), true, code);
    // Anche un oggetto semplice con il codice.
    assert.equal(isConnectionError({ code }), true, `${code} (oggetto semplice)`);
  }
});

test("isConnectionError: permessi, altri errori ed errori senza code → falso", () => {
  for (const code of [
    "permission-denied",
    "firestore/permission-denied",
    "functions/permission-denied",
    "invalid-argument",
    "not-found",
    "already-exists",
    "unauthenticated",
    "",
    "UNAVAILABLE",
    "storage/unavailable",
  ]) {
    assert.equal(isConnectionError({ code }), false, JSON.stringify(code));
  }

  for (const value of [new Error("unavailable"), new Error("write-timeout"), {}, null, undefined, "unavailable", 42]) {
    assert.equal(isConnectionError(value), false, String(value));
  }
});

// ---------------------------------------------------------------------------
// isOffline
// ---------------------------------------------------------------------------

function withNavigator(t, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  t.after(() => {
    if (original) {
      Object.defineProperty(globalThis, "navigator", original);
    } else {
      delete globalThis.navigator;
    }
  });
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
}

test("isOffline: navigator.onLine falso → offline", (t) => {
  withNavigator(t, { onLine: false });
  assert.equal(isOffline(), true);
});

test("isOffline: navigator.onLine vero → non offline", (t) => {
  withNavigator(t, { onLine: true });
  assert.equal(isOffline(), false);
});

test("isOffline: navigator senza onLine → non offline (non si sa, non si blocca)", (t) => {
  withNavigator(t, {});
  assert.equal(isOffline(), false);
});

test("isOffline: senza navigator (Node, prerender) → non offline", (t) => {
  withNavigator(t, undefined);
  assert.equal(isOffline(), false);
});
