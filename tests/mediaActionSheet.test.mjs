import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

import { importWithFakeDom, installFakeDom } from "./support/fakeDom.mjs";
import { findElements, mountHooks, textOf } from "./support/reactHooks.mjs";

// Foglio delle azioni su una foto o un video della galleria admin
// (`src/components/admin/gallery/MediaActionSheet.tsx`):
//  - "Elimina" non chiude più il foglio: chiama solo `onDelete`. La conferma si
//    apre sopra e "Tieni" torna al foglio, che si chiude da solo quando il
//    documento sparisce;
//  - il foglio sta nella pila degli strati (`useInertBackground`) e Esc lo chiude
//    solo se è in cima: con una conferma (un AppModal) aperta sopra, Esc è della
//    conferma;
//  - le altre azioni (cover, sposta) fanno la loro cosa e poi chiudono.
//
// Non c'è un DOM: gli hook girano nell'esecutore di `tests/support/reactHooks.mjs`
// con il DOM finto di `tests/support/fakeDom.mjs`. Il foglio ascolta Esc su
// `document`, l'AppModal su `window`: il DOM finto li fa girare nell'ordine del
// browser (prima `document`, poi `window`). Con un DOM vero le stesse cose le
// prova il collaudo nel browser.
//
// Comando: node --test tests/mediaActionSheet.test.mjs

// Alias `@/`, `.tsx`, `.css` e lo scambio di "react" nei file di src/.
register("./support/aliasLoader.mjs", import.meta.url);
register("./support/reactHooksLoader.mjs", import.meta.url);

// La pila degli strati nasce solo se c'è un `document` quando il modulo si
// carica, e i due componenti devono condividere la stessa pila.
const { MediaActionSheet } = await importWithFakeDom(
  () => import("../src/components/admin/gallery/MediaActionSheet.tsx"),
);
const { AppModal } = await importWithFakeDom(() => import("../src/components/AppModal.tsx"));

const MEDIA = { id: "m2", type: "image", filename: "campo.jpg", optimizedUrl: "https://example.test/campo.jpg" };
const GALLERY = { id: "g1", title: "Campo estivo", coverMediaId: "m1" };

// Una pagina e, sopra, i fogli che i test aprono. Il foglio delle azioni conta
// le chiamate ai suoi gestori in `calls`, nell'ordine in cui arrivano.
function createEnv(t) {
  const dom = installFakeDom();
  const page = dom.element("pagina");
  dom.document.body.children = [page];
  const mounts = [];
  t.after(() => {
    for (const hooks of mounts.reverse()) hooks.unmount();
    dom.restore();
  });

  function openSheet(props = {}) {
    const element = dom.element("foglio-azioni");
    dom.document.body.children = [...dom.document.body.children, element];
    const calls = [];
    const hooks = mountHooks(MediaActionSheet, {
      attach: (node) => (node.props.role === "dialog" ? element : null),
    });
    mounts.push(hooks);
    const sheetProps = {
      media: MEDIA,
      gallery: GALLERY,
      position: 1,
      total: 3,
      busy: false,
      onClose: () => calls.push("chiudi"),
      onSetCover: () => calls.push("cover"),
      onMove: (direction) => calls.push(`sposta:${direction}`),
      onDelete: () => calls.push("elimina"),
      ...props,
    };
    const tree = hooks.render(sheetProps);
    return {
      calls,
      element,
      hooks,
      tree,
      sheetProps,
      // Il genitore ridisegna il foglio con un `onClose` nuovo.
      rerender: (extra) => hooks.render({ ...sheetProps, ...extra }),
      // Il genitore toglie il foglio dalla pagina.
      remove() {
        dom.document.body.children = dom.document.body.children.filter((child) => child !== element);
        hooks.unmount();
      },
    };
  }

  // Un AppModal (la conferma «Elimina…» è un ConfirmSheet, cioè un AppModal).
  function openModal(name = "conferma") {
    const backdrop = dom.element(`sfondo-${name}`);
    const dialog = dom.element(`dialogo-${name}`);
    dom.document.body.children = [...dom.document.body.children, backdrop];
    const hooks = mountHooks(AppModal, {
      attach: (node) =>
        node.props.role === "dialog"
          ? dialog
          : String(node.props.className).includes("app-modal-backdrop")
            ? backdrop
            : null,
    });
    mounts.push(hooks);
    const modal = {
      closed: 0,
      backdrop,
      remove() {
        dom.document.body.children = dom.document.body.children.filter((child) => child !== backdrop);
        hooks.unmount();
      },
    };
    hooks.render({ title: name, onClose: () => (modal.closed += 1), children: "Testo" });
    return modal;
  }

  return { dom, page, openSheet, openModal };
}

// I pulsanti del foglio, per testo: l'icona sta in un `span` a parte.
const buttonsOf = (tree) => findElements(tree, (el) => el.type === "button");
const buttonWith = (tree, label) => {
  const found = buttonsOf(tree).filter((el) => textOf(el).includes(label));
  assert.equal(found.length, 1, `«${label}»: trovati ${found.length} pulsanti`);
  return found[0];
};
const click = (button) => button.props.onClick({ stopPropagation() {} });

// ---------------------------------------------------------------------------
// «Elimina»
// ---------------------------------------------------------------------------

test("MediaActionSheet: «Elimina» chiama solo onDelete e non chiude il foglio", (t) => {
  const { calls, tree } = createEnv(t).openSheet();

  click(buttonWith(tree, "Elimina"));
  assert.deepEqual(calls, ["elimina"], "il foglio deve restare aperto sotto la conferma");
});

test("MediaActionSheet: «Elimina» è bloccato mentre il foglio lavora", (t) => {
  const env = createEnv(t);
  assert.equal(buttonWith(env.openSheet({ busy: false }).tree, "Elimina").props.disabled, false);
  assert.equal(buttonWith(env.openSheet({ busy: true }).tree, "Elimina").props.disabled, true);
});

test("MediaActionSheet: «Elimina» non porta con sé altre azioni, nemmeno se premuto due volte", (t) => {
  const { calls, tree } = createEnv(t).openSheet();
  const remove = buttonWith(tree, "Elimina");

  click(remove);
  click(remove);
  assert.deepEqual(calls, ["elimina", "elimina"]);
});

// ---------------------------------------------------------------------------
// Le altre azioni
// ---------------------------------------------------------------------------

test("MediaActionSheet: cover e sposta fanno la loro azione e poi chiudono", (t) => {
  const { calls, tree } = createEnv(t).openSheet();

  click(buttonWith(tree, "Imposta come cover"));
  click(buttonWith(tree, "Sposta avanti"));
  click(buttonWith(tree, "Sposta dopo"));
  assert.deepEqual(calls, ["cover", "chiudi", "sposta:up", "chiudi", "sposta:down", "chiudi"]);
});

test("MediaActionSheet: «Chiudi» chiude e basta", (t) => {
  const { calls, tree } = createEnv(t).openSheet();

  click(buttonWith(tree, "Chiudi"));
  assert.deepEqual(calls, ["chiudi"]);
});

test("MediaActionSheet: il fondo chiude, il pannello no", (t) => {
  const { calls, tree } = createEnv(t).openSheet();
  const root = findElements(tree, (el) => el.props.role === "dialog")[0];
  const panel = findElements(tree, (el) => el.props.className === "media-sheet__panel")[0];

  let stopped = 0;
  panel.props.onClick({ stopPropagation: () => (stopped += 1) });
  assert.equal(stopped, 1, "un clic sul pannello non deve arrivare al fondo");
  assert.deepEqual(calls, []);

  root.props.onClick();
  assert.deepEqual(calls, ["chiudi"]);
});

test("MediaActionSheet: la cover attuale e i limiti dell'ordine bloccano i loro pulsanti", (t) => {
  const env = createEnv(t);

  // Foto in mezzo, non è la cover.
  const middle = env.openSheet({ position: 1, total: 3 }).tree;
  assert.equal(buttonWith(middle, "Imposta come cover").props.disabled, false);
  assert.equal(buttonWith(middle, "Sposta avanti").props.disabled, false);
  assert.equal(buttonWith(middle, "Sposta dopo").props.disabled, false);

  // Prima della fila: non si sposta più avanti.
  const first = env.openSheet({ position: 0, total: 3 }).tree;
  assert.equal(buttonWith(first, "Sposta avanti").props.disabled, true);
  assert.equal(buttonWith(first, "Sposta dopo").props.disabled, false);

  // Ultima della fila: non si sposta più dopo.
  const last = env.openSheet({ position: 2, total: 3 }).tree;
  assert.equal(buttonWith(last, "Sposta dopo").props.disabled, true);
  assert.equal(buttonWith(last, "Sposta avanti").props.disabled, false);

  // È già la cover.
  const cover = env.openSheet({ gallery: { ...GALLERY, coverMediaId: MEDIA.id } }).tree;
  assert.equal(buttonWith(cover, "Cover attuale").props.disabled, true);
});

// ---------------------------------------------------------------------------
// Esc e la pila degli strati
// ---------------------------------------------------------------------------

test("MediaActionSheet: da solo, Esc lo chiude una volta", (t) => {
  const env = createEnv(t);
  const { calls } = env.openSheet();

  const event = env.dom.window.press("Escape");
  assert.deepEqual(calls, ["chiudi"]);
  assert.equal(event.stopped, false, "il foglio non ferma l'evento: lo prende e basta");
});

test("MediaActionSheet: gli altri tasti non lo chiudono", (t) => {
  const env = createEnv(t);
  const { calls } = env.openSheet();

  for (const key of ["Enter", " ", "Tab", "ArrowLeft", "a", "escape"]) {
    env.dom.window.press(key);
  }
  assert.deepEqual(calls, []);
});

test("MediaActionSheet: con un AppModal aperto sopra, Esc chiude solo l'AppModal", (t) => {
  const env = createEnv(t);
  const sheet = env.openSheet();
  const modal = env.openModal();

  env.dom.window.press("Escape");
  assert.equal(modal.closed, 1);
  assert.deepEqual(sheet.calls, [], "Esc ha chiuso anche il foglio sotto la conferma");
});

test("MediaActionSheet: chiusa la conferma sopra, Esc torna al foglio", (t) => {
  const env = createEnv(t);
  const sheet = env.openSheet();
  const modal = env.openModal();

  env.dom.window.press("Escape");
  modal.remove();
  assert.deepEqual(sheet.calls, []);

  env.dom.window.press("Escape");
  assert.deepEqual(sheet.calls, ["chiudi"]);
  assert.equal(modal.closed, 1, "la conferma chiusa non sente più Esc");
});

test("MediaActionSheet: se il foglio si apre sopra un AppModal, Esc chiude il foglio e non l'AppModal", (t) => {
  const env = createEnv(t);
  const modal = env.openModal("info");
  const sheet = env.openSheet();

  env.dom.window.press("Escape");
  assert.deepEqual(sheet.calls, ["chiudi"]);
  assert.equal(modal.closed, 0, "Esc ha chiuso anche il modale sotto il foglio");

  sheet.remove();
  env.dom.window.press("Escape");
  assert.equal(modal.closed, 1);
});

test("MediaActionSheet: il foglio sotto sparisce da solo e la conferma sopra resta chiudibile con Esc", (t) => {
  // Il documento del media è stato eliminato: il foglio delle azioni si chiude
  // mentre la conferma è ancora aperta.
  const env = createEnv(t);
  const sheet = env.openSheet();
  const modal = env.openModal();

  sheet.remove();
  env.dom.window.press("Escape");
  assert.equal(modal.closed, 1);
  assert.deepEqual(sheet.calls, []);
});

test("MediaActionSheet: con due AppModal impilati sopra, il foglio non si chiude con nessun Esc", (t) => {
  const env = createEnv(t);
  const sheet = env.openSheet();
  const first = env.openModal("primo");
  const second = env.openModal("secondo");

  env.dom.window.press("Escape");
  assert.deepEqual([first.closed, second.closed], [0, 1]);
  second.remove();
  env.dom.window.press("Escape");
  assert.deepEqual([first.closed, second.closed], [1, 1]);
  assert.deepEqual(sheet.calls, []);
});

// ---------------------------------------------------------------------------
// Il foglio nella pila e i suoi effetti
// ---------------------------------------------------------------------------

test("MediaActionSheet: la pagina sotto è inerte, il foglio no, e alla chiusura torna tutto com'era", (t) => {
  const env = createEnv(t);
  const sheet = env.openSheet();

  assert.equal(env.page.inert, true);
  assert.equal(sheet.element.inert, false, "il foglio deve restare raggiungibile");

  sheet.hooks.unmount();
  assert.equal(env.page.inert, false);
});

test("MediaActionSheet: con una conferma sopra il foglio diventa inerte, chiusa la conferma torna attivo", (t) => {
  const env = createEnv(t);
  const sheet = env.openSheet();
  const modal = env.openModal();

  assert.equal(sheet.element.inert, true, "il foglio sta sotto la conferma");
  assert.equal(modal.backdrop.inert, false);

  modal.remove();
  assert.equal(sheet.element.inert, false);
  assert.equal(env.page.inert, true, "la pagina resta inerte finché c'è il foglio");
});

test("MediaActionSheet: blocca lo scorrimento della pagina finché è aperto", (t) => {
  const env = createEnv(t);
  const sheet = env.openSheet();
  assert.equal(env.dom.document.body.style.overflow, "hidden");

  sheet.hooks.unmount();
  assert.equal(env.dom.document.body.style.overflow, "");
});

test("MediaActionSheet: alla chiusura toglie il suo listener da document", (t) => {
  const env = createEnv(t);
  const sheet = env.openSheet();
  assert.equal(env.dom.document.listeners.length, 1);
  assert.equal(env.dom.document.listeners[0].type, "keydown");

  sheet.hooks.unmount();
  assert.equal(env.dom.document.listeners.length, 0);
  env.dom.window.press("Escape");
  assert.deepEqual(sheet.calls, []);
});

test("MediaActionSheet: un nuovo onClose non registra un secondo listener e vale subito", (t) => {
  const env = createEnv(t);
  const sheet = env.openSheet();

  const calls = [];
  sheet.rerender({ onClose: () => calls.push("nuovo") });
  assert.equal(env.dom.document.listeners.length, 1, "il listener è stato registrato di nuovo");
  assert.equal(env.dom.document.body.style.overflow, "hidden");

  env.dom.window.press("Escape");
  assert.deepEqual(calls, ["nuovo"]);
  assert.deepEqual(sheet.calls, []);
});

test("MediaActionSheet: fra il foglio sotto e l'AppModal sopra non resta nessun listener a chiusura finita", (t) => {
  const env = createEnv(t);
  const sheet = env.openSheet();
  const modal = env.openModal();

  modal.remove();
  sheet.hooks.unmount();
  assert.equal(env.dom.document.listeners.length, 0);
  assert.equal(env.dom.window.listeners.length, 0);
  assert.equal(env.page.inert, false);
});
