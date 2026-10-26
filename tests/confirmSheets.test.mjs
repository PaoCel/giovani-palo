import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { Fragment, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GALLERIA } from "../src/copy/galleria.ts";
import { importWithFakeDom, installFakeDom } from "./support/fakeDom.mjs";
import { findElements, mountHooks, textOf } from "./support/reactHooks.mjs";

// I fogli di conferma che hanno preso il posto dei dialoghi del browser
// (docs/FLUSSO_GENITORE.md: "mai un dialogo del browser"):
//  - testi del foglio "Elimina" della galleria, per foto e per video;
//  - `ConfirmSheet` con `tone="danger"`: il tasto che toglie qualcosa è rosso,
//    la scelta sicura resta quella in evidenza e viene prima;
//  - `useSheetKeys` / `GalleryConfirmSheet`: Esc e frecce restano al foglio,
//    così il lightbox sotto non si chiude e non cambia foto; la pagina sotto è
//    inerte, Tab resta nel foglio, il focus torna al pulsante di partenza.
//
// Non c'è un DOM: `ConfirmSheet` si rende in testo con react-dom/server; gli
// effetti e i gestori del foglio girano nell'esecutore di hook di
// `tests/support/reactHooks.mjs` (che non usa gli interni di React) con un DOM
// finto (`tests/support/fakeDom.mjs`). Con un DOM vero le stesse cose le prova
// il collaudo nel browser.
//
// Comando: node --test tests/confirmSheets.test.mjs

// Alias `@/`, `.tsx`, `.css` e lo scambio di "react" nei file di src/.
register("./support/aliasLoader.mjs", import.meta.url);
register("./support/reactHooksLoader.mjs", import.meta.url);

// `src/hooks/useModalLayer.ts` crea la pila degli strati solo se c'è un `document`
// quando si carica: i componenti si importano con un DOM finto, che poi si toglie
// (il rendering su testo deve vedere un ambiente senza browser).
const { ConfirmSheet } = await importWithFakeDom(() => import("../src/components/ConfirmSheet.tsx"));
const { GalleryConfirmSheet, getDeleteMediaCopy, useSheetKeys } = await importWithFakeDom(
  () => import("../src/components/gallery/GalleryConfirmSheet.tsx"),
);

// ---------------------------------------------------------------------------
// getDeleteMediaCopy
// ---------------------------------------------------------------------------

test("getDeleteMediaCopy: il video ha titolo e tasti del video", () => {
  assert.deepEqual(getDeleteMediaCopy("video"), {
    title: GALLERIA.eliminaVideoTitolo,
    cancelLabel: GALLERIA.tieniVideo,
    confirmLabel: GALLERIA.confermaEliminaVideo,
  });
});

test("getDeleteMediaCopy: la foto ha titolo e tasti della foto", () => {
  assert.deepEqual(getDeleteMediaCopy("image"), {
    title: GALLERIA.eliminaFotoTitolo,
    cancelLabel: GALLERIA.tieniFoto,
    confirmLabel: GALLERIA.confermaEliminaFoto,
  });
});

test("getDeleteMediaCopy: ogni tipo nomina il proprio contenuto e mai l'altro", () => {
  const video = getDeleteMediaCopy("video");
  const image = getDeleteMediaCopy("image");

  for (const text of Object.values(video)) {
    assert.match(text, /video/iu, text);
    assert.doesNotMatch(text, /foto/iu, text);
  }
  for (const text of Object.values(image)) {
    assert.match(text, /foto/iu, text);
    assert.doesNotMatch(text, /video/iu, text);
  }

  // Foto e video non condividono nessuna frase.
  for (const key of Object.keys(video)) {
    assert.notEqual(video[key], image[key], key);
  }
});

test("getDeleteMediaCopy: la scelta sicura è «Tieni…», quella che elimina è «Sì, elimina…»", () => {
  for (const type of ["video", "image"]) {
    const { title, cancelLabel, confirmLabel } = getDeleteMediaCopy(type);
    assert.match(cancelLabel, /^Tieni /u, type);
    assert.match(confirmLabel, /^Sì, elimina /u, type);
    assert.match(title, /^Eliminare .+\?$/u, type);
    // Mai un segnaposto a schermo.
    for (const text of [title, cancelLabel, confirmLabel]) {
      assert.doesNotMatch(text, /\{\w+\}/u, text);
    }
    // Il titolo è una domanda, i tasti sono risposte: nessun tasto si chiama come il titolo.
    assert.notEqual(cancelLabel, title);
    assert.notEqual(confirmLabel, title);
    assert.notEqual(cancelLabel, confirmLabel);
  }
});

test("getDeleteMediaCopy: i testi vengono dal catalogo GALLERIA e non sono vuoti", () => {
  for (const type of ["video", "image"]) {
    for (const text of Object.values(getDeleteMediaCopy(type))) {
      assert.ok(text.trim().length > 0, type);
      assert.ok(Object.values(GALLERIA).includes(text), `${type}: «${text}» non è in GALLERIA`);
    }
  }
});

// ---------------------------------------------------------------------------
// ConfirmSheet e il tono "danger"
// ---------------------------------------------------------------------------

// I tre tasti del foglio, letti dal testo: { label, classes, disabled }.
function readButtons(markup) {
  const buttons = [];
  for (const match of markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gu)) {
    const [, attributes, inner] = match;
    buttons.push({
      label: inner.replace(/<[^>]*>/gu, ""),
      classes: (/class="([^"]*)"/u.exec(attributes)?.[1] ?? "").split(/\s+/u).filter(Boolean),
      disabled: /\bdisabled(?:=|\s|$)/u.test(attributes),
      index: match.index,
    });
  }
  return buttons;
}

const SHEET = {
  title: "Annulli la tua iscrizione?",
  body: "Non risulterai più tra gli iscritti.",
  cancelLabel: "Tieni",
  confirmLabel: "Annulla",
  onCancel: () => {},
  onConfirm: () => {},
};

function renderSheet(props = {}) {
  const buttons = readButtons(renderToStaticMarkup(createElement(ConfirmSheet, { ...SHEET, ...props })));
  const byLabel = (label) => buttons.find((button) => button.label === label);
  return { buttons, cancel: byLabel(props.cancelLabel ?? SHEET.cancelLabel), confirm: byLabel(props.confirmLabel ?? SHEET.confirmLabel) };
}

test("ConfirmSheet: con tone=\"danger\" il tasto di conferma è rosso", () => {
  const { confirm } = renderSheet({ tone: "danger" });
  assert.ok(confirm, "tasto di conferma non trovato");
  assert.ok(confirm.classes.includes("button--danger"), confirm.classes.join(" "));
  assert.ok(!confirm.classes.includes("button--ghost"), confirm.classes.join(" "));
});

test("ConfirmSheet: senza tone il tasto di conferma resta ghost", () => {
  const { confirm } = renderSheet();
  assert.ok(confirm, "tasto di conferma non trovato");
  assert.ok(confirm.classes.includes("button--ghost"), confirm.classes.join(" "));
  assert.ok(!confirm.classes.includes("button--danger"), confirm.classes.join(" "));
});

test("ConfirmSheet: tone=\"neutral\" è come non averlo", () => {
  const { confirm } = renderSheet({ tone: "neutral" });
  assert.ok(confirm.classes.includes("button--ghost"), confirm.classes.join(" "));
  assert.ok(!confirm.classes.includes("button--danger"), confirm.classes.join(" "));
});

test("ConfirmSheet: la scelta sicura viene prima ed è in evidenza, con ogni tono", () => {
  for (const tone of [undefined, "neutral", "danger"]) {
    const { cancel, confirm } = renderSheet({ tone });
    assert.ok(cancel && confirm, `tone ${tone}: tasti non trovati`);
    assert.ok(cancel.index < confirm.index, `tone ${tone}: «${SHEET.cancelLabel}» deve stare prima di «${SHEET.confirmLabel}»`);
    assert.ok(cancel.classes.includes("button--primary"), `tone ${tone}: ${cancel.classes.join(" ")}`);
    // Il tono colora solo il tasto che toglie qualcosa.
    assert.ok(!cancel.classes.includes("button--danger"), `tone ${tone}`);
  }
});

test("ConfirmSheet: occupato, tutti e due i tasti sono bloccati e il rosso resta", () => {
  const { cancel, confirm, buttons } = renderSheet({
    tone: "danger",
    busy: true,
    busyLabel: "Annullamento...",
  });
  assert.equal(confirm, undefined, "durante l'attesa il tasto cambia testo");
  const busyButton = buttons.find((button) => button.label === "Annullamento...");
  assert.ok(busyButton, "manca il testo di attesa");
  assert.ok(busyButton.disabled);
  assert.ok(busyButton.classes.includes("button--danger"), busyButton.classes.join(" "));
  assert.ok(cancel.disabled);
});

test("ConfirmSheet: l'errore compare nel foglio, il testo e il titolo pure", () => {
  const markup = renderToStaticMarkup(
    createElement(ConfirmSheet, { ...SHEET, tone: "danger", error: "Impossibile annullare l'iscrizione." }),
  );
  assert.ok(markup.includes(SHEET.title), markup);
  assert.ok(markup.includes(SHEET.body), markup);
  assert.match(markup, /role="alert"/u);
  assert.ok(markup.includes("Impossibile annullare"), markup);
  assert.doesNotMatch(
    renderToStaticMarkup(createElement(ConfirmSheet, { ...SHEET, error: null })),
    /role="alert"/u,
  );
});

test("ConfirmSheet: due fogli aperti insieme hanno ciascuno il proprio titolo come nome", () => {
  const markup = renderToStaticMarkup(
    createElement(
      Fragment,
      null,
      createElement(ConfirmSheet, { ...SHEET, title: "Primo foglio" }),
      createElement(ConfirmSheet, { ...SHEET, title: "Secondo foglio" }),
    ),
  );

  const labelledBy = [...markup.matchAll(/aria-labelledby="([^"]+)"/gu)].map((match) => match[1]);
  const headings = [...markup.matchAll(/<h2 id="([^"]+)">([^<]*)<\/h2>/gu)].map((match) => ({
    id: match[1],
    text: match[2],
  }));

  assert.equal(labelledBy.length, 2);
  assert.deepEqual(
    headings.map((heading) => heading.text),
    ["Primo foglio", "Secondo foglio"],
  );
  assert.deepEqual(labelledBy, headings.map((heading) => heading.id), "ogni dialogo prende il nome dal proprio titolo");
  assert.notEqual(labelledBy[0], labelledBy[1], "i due fogli condividono lo stesso id");
});

// ---------------------------------------------------------------------------
// useSheetKeys
// ---------------------------------------------------------------------------

function mountSheetKeys(t, onCancel) {
  const dom = installFakeDom();
  const hooks = mountHooks(useSheetKeys);
  hooks.render(onCancel);
  t.after(() => {
    hooks.unmount();
    dom.restore();
  });
  return { fakeWindow: dom.window, ...hooks };
}

test("useSheetKeys: ascolta i tasti su window in fase di cattura, così arriva prima del lightbox", (t) => {
  const { fakeWindow } = mountSheetKeys(t, () => {});
  assert.equal(fakeWindow.listeners.length, 1);
  assert.equal(fakeWindow.listeners[0].type, "keydown");
  assert.equal(fakeWindow.listeners[0].capture, true, "senza cattura il lightbox sente Esc per primo");
});

test("useSheetKeys: Esc chiude il foglio e non arriva al lightbox sotto", (t) => {
  let cancelled = 0;
  const { fakeWindow } = mountSheetKeys(t, () => {
    cancelled += 1;
  });

  // Il lightbox ascolta su document, fase di bubbling.
  let lightboxHeard = 0;
  fakeWindow.addEventListener("keydown", () => {
    lightboxHeard += 1;
  });

  const event = fakeWindow.press("Escape");
  assert.equal(cancelled, 1);
  assert.equal(event.stopped, true);
  assert.equal(lightboxHeard, 0, "Esc ha chiuso anche il lightbox");
});

test("useSheetKeys: le frecce non cambiano foto sotto il foglio e non lo chiudono", (t) => {
  let cancelled = 0;
  const { fakeWindow } = mountSheetKeys(t, () => {
    cancelled += 1;
  });
  let lightboxHeard = 0;
  fakeWindow.addEventListener("keydown", () => {
    lightboxHeard += 1;
  });

  for (const key of ["ArrowLeft", "ArrowRight"]) {
    const event = fakeWindow.press(key);
    assert.equal(event.stopped, true, key);
  }
  assert.equal(cancelled, 0, "una freccia ha chiuso il foglio");
  assert.equal(lightboxHeard, 0, "una freccia è arrivata al lightbox");
});

test("useSheetKeys: gli altri tasti passano senza essere toccati", (t) => {
  let cancelled = 0;
  const { fakeWindow } = mountSheetKeys(t, () => {
    cancelled += 1;
  });
  let lightboxHeard = 0;
  fakeWindow.addEventListener("keydown", () => {
    lightboxHeard += 1;
  });

  for (const key of ["Enter", " ", "a", "ArrowUp", "Tab"]) {
    assert.equal(fakeWindow.press(key).stopped, false, key);
  }
  assert.equal(cancelled, 0);
  assert.equal(lightboxHeard, 5);
});

test("useSheetKeys: un nuovo onCancel non registra un secondo listener e vale subito", (t) => {
  const calls = [];
  const { fakeWindow, render } = mountSheetKeys(t, () => calls.push("vecchio"));

  render(() => calls.push("nuovo"));
  assert.equal(fakeWindow.listeners.length, 1, "il listener è stato registrato di nuovo");

  fakeWindow.press("Escape");
  assert.deepEqual(calls, ["nuovo"]);
});

test("useSheetKeys: alla chiusura del foglio toglie il listener dalla stessa fase", (t) => {
  let cancelled = 0;
  const { fakeWindow, unmount } = mountSheetKeys(t, () => {
    cancelled += 1;
  });
  assert.equal(fakeWindow.listeners.length, 1);

  unmount();
  assert.equal(fakeWindow.listeners.length, 0, "il listener è rimasto su window");

  // Chiuso il foglio, Esc torna al lightbox.
  let lightboxHeard = 0;
  fakeWindow.addEventListener("keydown", () => {
    lightboxHeard += 1;
  });
  const event = fakeWindow.press("Escape");
  assert.equal(event.stopped, false);
  assert.equal(lightboxHeard, 1);
  assert.equal(cancelled, 0);
});

// ---------------------------------------------------------------------------
// GalleryConfirmSheet
// ---------------------------------------------------------------------------

const GALLERY_SHEET = {
  title: "Eliminare questa foto?",
  body: "Sparisce dalla galleria per tutti e non si può recuperare.",
  cancelLabel: "Tieni la foto",
  confirmLabel: "Sì, elimina la foto",
};

test("GalleryConfirmSheet: fuori da un browser non rende niente e non rompe il rendering su testo", () => {
  const markup = renderToStaticMarkup(
    createElement(GalleryConfirmSheet, { ...GALLERY_SHEET, onCancel: () => {}, onConfirm: () => {} }),
  );
  assert.equal(markup, "");
});

// Una pagina con un pulsante "Elimina" che ha il focus; un foglio che si apre.
// `open(props)` monta il foglio e ritorna l'albero e i nodi finti; alla fine del
// test si chiude tutto nell'ordine giusto (prima gli hook, poi i globali).
function createEnv(t) {
  const dom = installFakeDom();
  const mounts = [];
  t.after(() => {
    for (const hooks of mounts.reverse()) hooks.unmount();
    dom.restore();
  });

  const page = dom.element("pagina");
  const trigger = dom.element("elimina");
  dom.document.body.children = [page];
  dom.document.activeElement = trigger;

  function open(props = {}) {
    const layer = dom.element("strato");
    const sheet = dom.element("foglio");
    dom.document.body.children = [...dom.document.body.children, layer];
    // I `ref` ricevono i nodi finti, come farebbe React montando il DOM.
    const attach = (element) =>
      element.props.role === "dialog" ? layer : element.props.className === "ag-sheet" ? sheet : null;
    const hooks = mountHooks(GalleryConfirmSheet, { attach });
    mounts.push(hooks);
    const portal = hooks.render({ onCancel: () => {}, onConfirm: () => {}, ...GALLERY_SHEET, ...props });
    return { tree: portal.children, hooks, layer, sheet };
  }

  return { dom, page, trigger, open };
}

const buttonsOf = (tree) =>
  findElements(tree, (el) => el.type === "button" && el.props.className?.includes("ag-btn"));
const scrimOf = (tree) =>
  findElements(tree, (el) => el.type === "button" && el.props.className?.includes("ag-sheet-scrim"))[0];

test("GalleryConfirmSheet: titolo, testo, e i due tasti con la scelta sicura per prima", (t) => {
  const { tree } = createEnv(t).open();
  const buttons = buttonsOf(tree);

  assert.equal(findElements(tree, (el) => el.type === "h3").map((el) => textOf(el))[0], GALLERY_SHEET.title);
  assert.ok(findElements(tree, (el) => el.type === "p").some((el) => textOf(el) === GALLERY_SHEET.body));
  assert.deepEqual(buttons.map(textOf), [GALLERY_SHEET.cancelLabel, GALLERY_SHEET.confirmLabel]);
  assert.match(buttons[0].props.className, /ag-btn--primary/u);
  assert.match(buttons[1].props.className, /ag-btn--danger/u);
  assert.ok(buttons.every((el) => el.props.disabled === false));
});

test("GalleryConfirmSheet: i tasti chiamano i propri gestori e il fondo scuro vale «tieni»", (t) => {
  const calls = [];
  const { tree } = createEnv(t).open({
    onCancel: () => calls.push("tieni"),
    onConfirm: () => calls.push("elimina"),
  });
  const [keep, remove] = buttonsOf(tree);

  keep.props.onClick();
  scrimOf(tree).props.onClick();
  assert.deepEqual(calls, ["tieni", "tieni"]);

  remove.props.onClick();
  assert.deepEqual(calls, ["tieni", "tieni", "elimina"]);
});

test("GalleryConfirmSheet: durante l'eliminazione tutto è bloccato, anche Esc e il fondo", (t) => {
  const calls = [];
  const env = createEnv(t);
  const { tree } = env.open({
    busy: true,
    onCancel: () => calls.push("tieni"),
    onConfirm: () => calls.push("elimina"),
  });
  const buttons = buttonsOf(tree);

  assert.ok(buttons.every((el) => el.props.disabled === true));
  assert.equal(textOf(buttons[1]), GALLERIA.eliminazione);

  scrimOf(tree).props.onClick();
  const event = env.dom.window.press("Escape");
  assert.deepEqual(calls, [], "il foglio si è chiuso mentre elimina");
  // Esc resta comunque al foglio: il lightbox sotto non si chiude.
  assert.equal(event.stopped, true);
});

test("GalleryConfirmSheet: l'errore compare nel foglio come avviso", (t) => {
  const { tree } = createEnv(t).open({ error: GALLERIA.erroreElimina });
  const alerts = findElements(tree, (el) => el.props.role === "alert");
  assert.equal(alerts.length, 1);
  assert.equal(textOf(alerts[0]), GALLERIA.erroreElimina);
});

test("GalleryConfirmSheet: senza errore non c'è nessun avviso", (t) => {
  const { tree } = createEnv(t).open({ error: null });
  assert.equal(findElements(tree, (el) => el.props.role === "alert").length, 0);
});

test("GalleryConfirmSheet: è un dialogo modale con il titolo come nome", (t) => {
  const { tree } = createEnv(t).open();
  const dialog = findElements(tree, (el) => el.props.role === "dialog")[0];
  assert.ok(dialog, "manca role=dialog");
  assert.equal(dialog.props["aria-modal"], "true");
  const heading = findElements(tree, (el) => el.type === "h3")[0];
  assert.ok(heading.props.id, "il titolo non ha un id");
  assert.equal(dialog.props["aria-labelledby"], heading.props.id);
});

test("GalleryConfirmSheet: due fogli aperti insieme non condividono l'id del titolo", (t) => {
  const env = createEnv(t);
  const first = env.open({ title: "Primo" });
  const second = env.open({ title: "Secondo" });
  const idOf = (tree) => findElements(tree, (el) => el.type === "h3")[0].props.id;
  assert.ok(idOf(first.tree) && idOf(second.tree));
  assert.notEqual(idOf(first.tree), idOf(second.tree));
});

test("GalleryConfirmSheet: il fondo scuro non è un controllo per tastiera né per screen reader", (t) => {
  const { tree } = createEnv(t).open();
  const scrim = scrimOf(tree);
  assert.equal(scrim.props["aria-hidden"], "true");
  assert.equal(scrim.props.tabIndex, -1, "Tab si fermerebbe su un controllo invisibile");
  assert.equal(scrim.props["aria-label"], undefined, "un'etichetta duplicherebbe «Tieni…» per lo screen reader");
  assert.equal(scrim.props.type, "button");
});

test("GalleryConfirmSheet: la pagina sotto è inerte mentre il foglio è aperto e torna attiva alla chiusura", (t) => {
  const env = createEnv(t);
  const { hooks, layer } = env.open();

  assert.equal(env.page.inert, true);
  assert.equal(layer.inert, false, "il foglio deve restare raggiungibile");

  hooks.unmount();
  assert.equal(env.page.inert, false);
});

test("GalleryConfirmSheet: il lightbox sotto, già in body, diventa inerte e poi torna attivo", (t) => {
  const env = createEnv(t);
  const lightbox = env.dom.element("lightbox");
  env.dom.document.body.children = [env.page, lightbox];
  const { hooks } = env.open();

  assert.equal(lightbox.inert, true);
  hooks.unmount();
  assert.equal(lightbox.inert, false);
});

test("GalleryConfirmSheet: l'inert è un effetto di layout, uno solo", (t) => {
  const { hooks } = createEnv(t).open();
  assert.equal(hooks.effectKinds.filter((kind) => kind === "layout").length, 1);
});

test("GalleryConfirmSheet: all'apertura il focus va al foglio, a pagina già inerte", (t) => {
  const env = createEnv(t);
  const { sheet } = env.open();

  assert.equal(env.dom.document.activeElement, sheet);
  assert.deepEqual(sheet.focusOptions, [{ preventScroll: true }]);
  assert.ok(
    env.dom.log.indexOf("inert:pagina:true") < env.dom.log.indexOf("focus:foglio"),
    env.dom.log.join(" > "),
  );
});

test("GalleryConfirmSheet: alla chiusura il focus torna al pulsante di partenza, a pagina già attiva", (t) => {
  const env = createEnv(t);
  const { hooks } = env.open();
  env.dom.log.length = 0;

  hooks.unmount();
  assert.equal(env.dom.document.activeElement, env.trigger);
  assert.deepEqual(env.trigger.focusOptions, [{ preventScroll: true }]);
  // Un elemento inerte non prende il focus: prima si riattiva la pagina.
  assert.deepEqual(env.dom.log, ["inert:pagina:false", "focus:elimina"]);
});

test("GalleryConfirmSheet: se il pulsante di partenza non c'è più, il focus non va a vuoto", (t) => {
  const env = createEnv(t);
  const { hooks } = env.open();
  env.trigger.isConnected = false;
  env.dom.log.length = 0;

  hooks.unmount();
  assert.ok(!env.dom.log.includes("focus:elimina"), env.dom.log.join(" > "));
});

test("GalleryConfirmSheet: Tab resta nel foglio, in avanti e all'indietro", (t) => {
  const env = createEnv(t);
  const { tree, sheet } = env.open();
  const keep = env.dom.element("tieni");
  const remove = env.dom.element("elimina-foto");
  sheet.focusables = [keep, remove];

  const sheetElement = findElements(tree, (el) => el.props.className === "ag-sheet")[0];
  assert.equal(typeof sheetElement.props.onKeyDown, "function", "il foglio non ascolta i tasti");
  const press = (key, shiftKey = false) => {
    const event = { key, shiftKey, prevented: 0, preventDefault() { this.prevented += 1; } };
    sheetElement.props.onKeyDown(event);
    return event;
  };

  // Dall'ultimo controllo si torna al primo.
  env.dom.document.activeElement = remove;
  assert.equal(press("Tab").prevented, 1);
  assert.equal(env.dom.document.activeElement, keep);

  // Dal primo, all'indietro, si va all'ultimo.
  assert.equal(press("Tab", true).prevented, 1);
  assert.equal(env.dom.document.activeElement, remove);

  // In mezzo non si interviene.
  env.dom.document.activeElement = keep;
  assert.equal(press("Tab").prevented, 0);
  assert.equal(env.dom.document.activeElement, keep);
});

test("GalleryConfirmSheet: chiudendo, il listener dei tasti e l'inert se ne vanno insieme", (t) => {
  const env = createEnv(t);
  const { hooks } = env.open();
  assert.equal(env.dom.window.listeners.length, 1);

  hooks.unmount();
  assert.equal(env.dom.window.listeners.length, 0);
  assert.equal(env.page.inert, false);
});
