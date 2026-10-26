import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ADMIN } from "../src/copy/admin.ts";
import { getAdminActionError } from "../src/utils/adminErrors.ts";

// Esito di un'azione partita da un modale admin (`src/components/admin/ModalFeedback.tsx`):
// l'errore o l'informazione stanno dentro il modale, perché la pagina sotto è
// coperta e inerte. Niente da mostrare, niente nel DOM; l'informazione è un
// `status` (si legge senza interrompere), l'errore un `alert` (si legge subito).
//
// Non c'è un DOM: il componente si rende in testo con react-dom/server.
//
// Comando: node --test tests/modalFeedback.test.mjs

// `.tsx`, alias `@/` e `.css` nei file di src/.
register("./support/aliasLoader.mjs", import.meta.url);

const { ModalFeedback } = await import("../src/components/admin/ModalFeedback.tsx");

const render = (props) => renderToStaticMarkup(createElement(ModalFeedback, props));

// Il testo che l'utente legge: i tag tolti e le entità HTML di React decodificate.
const readable = (markup) =>
  markup
    .replace(/<[^>]*>/gu, "")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

// ---------------------------------------------------------------------------
// Niente da mostrare
// ---------------------------------------------------------------------------

test("ModalFeedback: senza errore né informazione non rende niente", () => {
  for (const props of [
    { error: null },
    { error: null, info: null },
    { error: null, info: undefined },
    { error: "", info: "" },
    { error: "", info: null },
    { error: null, info: "" },
  ]) {
    assert.equal(render(props), "", JSON.stringify(props));
  }
});

test("ModalFeedback: `info` si può omettere", () => {
  assert.equal(render({ error: null }), "");
  assert.ok(render({ error: "Impossibile salvare le impostazioni." }).includes("form-error"));
});

// ---------------------------------------------------------------------------
// Errore
// ---------------------------------------------------------------------------

test("ModalFeedback: l'errore è un avviso con la classe dell'errore, dentro .modal-feedback", () => {
  assert.equal(
    render({ error: "Impossibile eliminare la galleria." }),
    '<div class="modal-feedback"><p class="form-error" role="alert">Impossibile eliminare la galleria.</p></div>',
  );
});

test("ModalFeedback: l'errore non ha il ruolo dell'informazione", () => {
  const markup = render({ error: "Errore." });
  assert.match(markup, /role="alert"/u);
  assert.doesNotMatch(markup, /role="status"/u);
  assert.doesNotMatch(markup, /form-success/u);
});

// ---------------------------------------------------------------------------
// Informazione
// ---------------------------------------------------------------------------

test("ModalFeedback: l'informazione è uno stato con la classe del successo, dentro .modal-feedback", () => {
  assert.equal(
    render({ error: null, info: "Email inviate." }),
    '<div class="modal-feedback"><p class="form-success" role="status">Email inviate.</p></div>',
  );
});

test("ModalFeedback: l'informazione non ha il ruolo dell'errore", () => {
  const markup = render({ error: null, info: "Fatto." });
  assert.match(markup, /role="status"/u);
  assert.doesNotMatch(markup, /role="alert"/u);
  assert.doesNotMatch(markup, /form-error/u);
});

// ---------------------------------------------------------------------------
// Tutti e due
// ---------------------------------------------------------------------------

test("ModalFeedback: con errore e informazione li mostra insieme, l'informazione prima, in un solo contenitore", () => {
  const markup = render({ error: "Impossibile inviare.", info: "Controllo fatto." });
  assert.equal(
    markup,
    '<div class="modal-feedback">' +
      '<p class="form-success" role="status">Controllo fatto.</p>' +
      '<p class="form-error" role="alert">Impossibile inviare.</p>' +
      "</div>",
  );
  assert.equal(markup.match(/class="modal-feedback"/gu).length, 1);
});

// ---------------------------------------------------------------------------
// Testo
// ---------------------------------------------------------------------------

test("ModalFeedback: il testo è testo, mai HTML", () => {
  const markup = render({ error: '<img src=x onerror="alert(1)"> & "ciao"', info: "<b>ok</b>" });
  assert.doesNotMatch(markup, /<img|<b>/u, markup);
  // L'informazione viene prima dell'errore.
  assert.equal(readable(markup), '<b>ok</b><img src=x onerror="alert(1)"> & "ciao"');
});

test("ModalFeedback: mostra le frasi vere dell'admin, apostrofi compresi", () => {
  for (const text of [
    ADMIN.erroreEliminaAttivita,
    ADMIN.erroreEliminaIscrizione,
    ADMIN.completamentoElencoCambiato,
    ADMIN.erroreRete,
  ]) {
    assert.equal(readable(render({ error: text })), text);
    assert.equal(readable(render({ error: null, info: text })), text);
  }
});

test("ModalFeedback: mostra il messaggio che getAdminActionError ricava da un errore", () => {
  const error = Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
  const message = getAdminActionError(error, ADMIN.erroreEliminaPost);
  assert.equal(readable(render({ error: message })), "Impossibile eliminare il post. (codice: permission-denied)");
});

test("ModalFeedback: rende lo stesso testo a ogni chiamata", () => {
  const props = { error: "Errore.", info: "Info." };
  assert.equal(render(props), render(props));
});

// ---------------------------------------------------------------------------
// Gli stili ci sono
// ---------------------------------------------------------------------------

test("ModalFeedback: le tre classi che usa hanno uno stile in base.css", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const css = readFileSync(path.join(root, "src", "styles", "base.css"), "utf8");
  for (const selector of [".modal-feedback", ".form-error", ".form-success"]) {
    const escaped = selector.replaceAll(".", "\\.");
    assert.match(css, new RegExp(`^${escaped}\\s*\\{`, "mu"), `${selector} non ha una regola in base.css`);
  }
});
