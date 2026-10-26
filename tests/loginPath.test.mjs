import test from "node:test";
import assert from "node:assert/strict";

import { getLoginPath } from "../src/utils/activityLinks.ts";

// Il pulsante "Accedi" dell'intestazione deve riportare alla pagina da cui si
// parte, non alla home (docs/FLUSSO_GENITORE.md, schermata A): per questo
// `getLoginPath` mette la pagina corrente in `?redirect=`. Qui si prova che il
// ritorno sia fedele (percorso, query e hash arrivano identici dopo la
// decodifica) e che non si possa mai usare per rimbalzare su /login stessa o
// su un indirizzo esterno.
//
// Comando: node --test tests/loginPath.test.mjs

// Legge l'indirizzo prodotto come lo leggerebbe il browser. La base è fittizia:
// serve solo a far capire a `URL` che il percorso è relativo.
const parse = (value) => new URL(value, "https://app.example");

test("senza ritorno: /login e basta", () => {
  assert.equal(getLoginPath(), "/login");
  assert.equal(getLoginPath(undefined), "/login");
  assert.equal(getLoginPath(null), "/login");
  assert.equal(getLoginPath(undefined, undefined), "/login");
});

test("percorso interno con query: il ritorno è codificato e si ritrova identico", () => {
  const redirect = "/activities/abc?stake=x";
  const login = getLoginPath(redirect);
  const url = parse(login);

  assert.equal(url.pathname, "/login");
  assert.equal(url.searchParams.get("redirect"), redirect);
  // La query del ritorno non deve diventare un parametro di /login.
  assert.equal(url.searchParams.has("stake"), false);
  assert.deepEqual([...url.searchParams.keys()], ["redirect"]);
  // E in chiaro nell'indirizzo c'è un solo "?": quello di /login.
  assert.equal(login.split("?").length, 2);
});

test("query con più parametri, hash e caratteri speciali tornano identici", () => {
  for (const redirect of [
    "/activities/abc/register?stake=gugd&x=1",
    "/activities/abc/record?stake=s1#top",
    "/activities/abc#iscrizione",
    "/me/activities/abc123",
    "/activities/àbc?nome=Marco%20Rossi&q=a+b",
    "/family?scheda=crea&redirect=/x",
  ]) {
    const url = parse(getLoginPath(redirect));
    assert.equal(url.pathname, "/login", redirect);
    assert.equal(url.searchParams.get("redirect"), redirect, redirect);
    // L'hash del ritorno resta dentro il parametro, non diventa quello di /login.
    assert.equal(url.hash, "", redirect);
  }
});

test("scheda crea: aggiunge scheda=crea con e senza ritorno", () => {
  assert.equal(getLoginPath(undefined, "crea"), "/login?scheda=crea");
  assert.equal(getLoginPath(null, "crea"), "/login?scheda=crea");

  const redirect = "/me/activities/abc123";
  const url = parse(getLoginPath(redirect, "crea"));
  assert.equal(url.pathname, "/login");
  assert.equal(url.searchParams.get("scheda"), "crea");
  assert.equal(url.searchParams.get("redirect"), redirect);

  // Senza `scheda` il parametro non c'è: si apre "Accedi".
  assert.equal(parse(getLoginPath(redirect)).searchParams.has("scheda"), false);
});

test("un ritorno scartato non toglie la scheda scelta", () => {
  assert.equal(getLoginPath("/login", "crea"), "/login?scheda=crea");
  assert.equal(getLoginPath("//evil.example", "crea"), "/login?scheda=crea");
  assert.equal(getLoginPath("/\\evil.example", "crea"), "/login?scheda=crea");
  assert.equal(getLoginPath("", "crea"), "/login?scheda=crea");
});

test("ritorni scartati: /login stessa, indirizzi esterni, percorsi non interni", () => {
  for (const redirect of [
    // verso /login stessa, in ogni forma
    "/login",
    "/login?redirect=/x",
    "/login/",
    "/login#top",
    "/login/crea",
    // vuoti
    "",
    null,
    undefined,
    // fuori dal sito
    "//evil.example",
    "//evil.example/x",
    "https://evil.example/x",
    "http://evil.example",
    "javascript:alert(1)",
    // slash + backslash: per il browser vale come "//" e porta fuori dal sito
    "/\\evil.example",
    "/\\evil.example/x",
    "/\\/evil.example",
    // non è un percorso assoluto
    "activities/x",
    "login",
  ]) {
    assert.equal(getLoginPath(redirect), "/login", String(redirect));
  }
});

test("un percorso che comincia con login ma è un altro resta", () => {
  for (const redirect of ["/loginx", "/login-help", "/login2/x", "/loginx?a=1"]) {
    const url = parse(getLoginPath(redirect));
    assert.equal(url.pathname, "/login", redirect);
    assert.equal(url.searchParams.get("redirect"), redirect, redirect);
  }
});
