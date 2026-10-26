import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

import { importWithFakeDom, installFakeDom } from "./support/fakeDom.mjs";
import { findElements, mountHooks } from "./support/reactHooks.mjs";

// Strato aperto sopra la pagina (AppModal, GalleryConfirmSheet): `src/hooks/useModalLayer.ts`.
//  - `keepTabInside`: Tab e Maiusc+Tab girano fra i controlli dello strato e non
//    escono verso il browser;
//  - `useInertBackground`: la pagina sotto diventa `inert` attraverso la pila
//    degli strati (la logica della pila è in tests/layerStack.test.mjs); qui il
//    collegamento: lo strato, l'osservatore dei figli di <body>, l'effetto di layout;
//  - `isTopLayer`: vero solo per lo strato in cima alla pila (o se non c'è pila);
//    è ciò che fa chiudere con Esc un solo modale alla volta;
//  - `AppModal` li usa tutti e tre: collegamento provato in fondo, con due
//    modali impilati.
//
// Non c'è un DOM: un contenitore finto con i suoi controlli e un `document`
// finto (`tests/support/fakeDom.mjs`); gli hook girano nell'esecutore di
// `tests/support/reactHooks.mjs`, che non usa gli interni di React. Con un DOM
// vero le stesse cose le prova il collaudo nel browser.
//
// Comando: node --test tests/modalLayer.test.mjs

// Alias `@/`, `.tsx`, `.css` e lo scambio di "react" nei file di src/.
register("./support/aliasLoader.mjs", import.meta.url);
register("./support/reactHooksLoader.mjs", import.meta.url);

// La pila degli strati nasce solo se c'è un `document` quando il modulo si carica.
const { isTopLayer, keepTabInside, useInertBackground } = await importWithFakeDom(
  () => import("../src/hooks/useModalLayer.ts"),
);
const { AppModal } = await importWithFakeDom(() => import("../src/components/AppModal.tsx"));

// ---------------------------------------------------------------------------
// keepTabInside
// ---------------------------------------------------------------------------

// Un contenitore con tre controlli, il focus su `active`.
function setup(t, activeName = "contenitore", controls = ["primo", "medio", "ultimo"]) {
  const dom = installFakeDom();
  t.after(() => dom.restore());
  const container = dom.element("contenitore");
  const focusables = controls.map((name) => dom.element(name));
  container.focusables = focusables;
  const byName = Object.fromEntries([container, ...focusables].map((element) => [element.name, element]));
  dom.document.activeElement = byName[activeName] ?? null;
  dom.log.length = 0;
  return { dom, container, focusables, byName };
}

function press(container, key, { shiftKey = false } = {}) {
  const event = {
    key,
    shiftKey,
    prevented: 0,
    preventDefault() {
      this.prevented += 1;
    },
  };
  keepTabInside(event, container);
  return event;
}

test("keepTabInside: Tab sull'ultimo controllo torna al primo", (t) => {
  const { dom, container } = setup(t, "ultimo");
  const event = press(container, "Tab");
  assert.equal(event.prevented, 1);
  assert.equal(dom.document.activeElement.name, "primo");
});

test("keepTabInside: Maiusc+Tab sul primo controllo va all'ultimo", (t) => {
  const { dom, container } = setup(t, "primo");
  const event = press(container, "Tab", { shiftKey: true });
  assert.equal(event.prevented, 1);
  assert.equal(dom.document.activeElement.name, "ultimo");
});

test("keepTabInside: Maiusc+Tab con il focus sul contenitore stesso va all'ultimo", (t) => {
  // All'apertura il focus sta sul foglio, non su un controllo.
  const { dom, container } = setup(t, "contenitore");
  const event = press(container, "Tab", { shiftKey: true });
  assert.equal(event.prevented, 1);
  assert.equal(dom.document.activeElement.name, "ultimo");
});

test("keepTabInside: Tab con il focus sul contenitore lascia fare al browser (va al primo controllo)", (t) => {
  const { dom, container } = setup(t, "contenitore");
  const event = press(container, "Tab");
  assert.equal(event.prevented, 0);
  assert.equal(dom.document.activeElement.name, "contenitore");
  assert.deepEqual(dom.log, []);
});

test("keepTabInside: in mezzo ai controlli non tocca niente, in tutte e due le direzioni", (t) => {
  for (const [name, shiftKey] of [
    ["primo", false],
    ["medio", false],
    ["medio", true],
    ["ultimo", true],
  ]) {
    const { dom, container } = setup(t, name);
    const event = press(container, "Tab", { shiftKey });
    assert.equal(event.prevented, 0, `${name} shift=${shiftKey}`);
    assert.equal(dom.document.activeElement.name, name, `${name} shift=${shiftKey}`);
    assert.deepEqual(dom.log, [], `${name} shift=${shiftKey}`);
  }
});

test("keepTabInside: gli altri tasti non vengono toccati nemmeno sull'ultimo controllo", (t) => {
  const { dom, container } = setup(t, "ultimo");
  for (const key of ["Enter", "Escape", " ", "ArrowDown", "a", "Shift"]) {
    const event = press(container, key);
    assert.equal(event.prevented, 0, key);
  }
  assert.equal(dom.document.activeElement.name, "ultimo");
  assert.deepEqual(dom.log, []);
});

test("keepTabInside: senza contenitore non fa niente", (t) => {
  const { dom } = setup(t, "ultimo");
  for (const container of [null, undefined]) {
    const event = press(container, "Tab");
    assert.equal(event.prevented, 0);
  }
  assert.deepEqual(dom.log, []);
});

test("keepTabInside: un solo controllo tiene il focus sia con Tab sia con Maiusc+Tab", (t) => {
  for (const shiftKey of [false, true]) {
    const { dom, container } = setup(t, "unico", ["unico"]);
    const event = press(container, "Tab", { shiftKey });
    assert.equal(event.prevented, 1, `shift=${shiftKey}`);
    assert.equal(dom.document.activeElement.name, "unico", `shift=${shiftKey}`);
  }
});

test("keepTabInside: senza controlli blocca Tab, così il focus non esce", (t) => {
  for (const shiftKey of [false, true]) {
    const { dom, container } = setup(t, "contenitore", []);
    const event = press(container, "Tab", { shiftKey });
    assert.equal(event.prevented, 1, `shift=${shiftKey}`);
    assert.equal(dom.document.activeElement.name, "contenitore", `shift=${shiftKey}`);
    assert.deepEqual(dom.log, []);
  }
});

test("keepTabInside: cerca solo i controlli raggiungibili con Tab", (t) => {
  const { container } = setup(t, "ultimo");
  press(container, "Tab");
  assert.equal(container.selectors.length, 1);
  const selector = container.selectors[0];
  // Link, pulsanti, campi e select attivi; con tabindex solo quelli diversi da -1.
  for (const part of [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "textarea:not([disabled])",
    "select:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ]) {
    assert.ok(selector.includes(part), `manca ${part} in ${selector}`);
  }
});

test("keepTabInside: non cerca niente per i tasti che non sono Tab", (t) => {
  const { container } = setup(t, "ultimo");
  press(container, "Enter");
  assert.equal(container.selectors.length, 0);
});

// ---------------------------------------------------------------------------
// useInertBackground
// ---------------------------------------------------------------------------

// Apre uno strato: ritorna l'handle degli hook (per chiudere).
function openLayer(layer, ref = { current: layer }) {
  const hooks = mountHooks(useInertBackground);
  hooks.render(ref);
  return hooks;
}

// Un DOM finto con la pagina e, se serve, altri figli di <body>; chiude tutto a
// fine prova (la pila degli strati è una sola per modulo: va lasciata vuota).
function createLayerEnv(t, ...names) {
  const dom = installFakeDom();
  const opened = [];
  t.after(() => {
    for (const hooks of opened.reverse()) hooks.unmount();
    dom.restore();
  });
  const nodes = Object.fromEntries(names.map((name) => [name, dom.element(name)]));
  dom.document.body.children = Object.values(nodes);
  return {
    dom,
    ...nodes,
    open(layer, ref) {
      const hooks = openLayer(layer, ref);
      opened.push(hooks);
      return hooks;
    },
  };
}

test("useInertBackground: gli altri figli di body diventano inerti, lo strato no", (t) => {
  const env = createLayerEnv(t, "app", "toast", "strato");
  env.open(env.strato);

  assert.equal(env.app.inert, true);
  assert.equal(env.toast.inert, true);
  assert.equal(env.strato.inert, false, "lo strato deve restare raggiungibile");
  assert.ok(!env.dom.log.includes("inert:strato:true"));
});

test("useInertBackground: alla chiusura torna attivo ciò che era stato reso inerte", (t) => {
  const env = createLayerEnv(t, "app", "strato");
  const hooks = env.open(env.strato);

  assert.equal(env.app.inert, true);
  hooks.unmount();
  assert.equal(env.app.inert, false);
  assert.equal(env.strato.inert, false);
});

test("useInertBackground: ciò che era già inerte resta inerte alla chiusura", (t) => {
  const env = createLayerEnv(t, "app", "strato");
  const alreadyInert = env.dom.element("gia-inerte", { _inert: true });
  env.dom.document.body.children = [env.app, alreadyInert, env.strato];
  const hooks = env.open(env.strato);

  assert.ok(!env.dom.log.includes("inert:gia-inerte:true"), "non si tocca ciò che è già inerte");
  hooks.unmount();
  assert.equal(alreadyInert.inert, true, "l'ha reso inerte qualcun altro: spetta a lui toglierlo");
  assert.ok(!env.dom.log.includes("inert:gia-inerte:false"));
  assert.equal(env.app.inert, false);
});

test("useInertBackground: salta i nodi che non sono HTMLElement", (t) => {
  const env = createLayerEnv(t, "app", "strato");
  const svg = env.dom.plainNode("svg");
  env.dom.document.body.children = [svg, env.app, env.strato];
  const hooks = env.open(env.strato);

  assert.equal(svg.inert, false);
  assert.equal(env.app.inert, true);
  hooks.unmount();
  assert.equal(svg.inert, false);
});

test("useInertBackground: due strati uno sull'altro, resta raggiungibile solo quello in cima", (t) => {
  const env = createLayerEnv(t, "app", "primo-strato", "secondo-strato");
  env.dom.document.body.children = [env.app, env["primo-strato"]];
  const firstHooks = env.open(env["primo-strato"]);
  assert.equal(env.app.inert, true);
  assert.equal(env["primo-strato"].inert, false);

  env.dom.document.body.children = [env.app, env["primo-strato"], env["secondo-strato"]];
  const secondHooks = env.open(env["secondo-strato"]);
  assert.equal(env["primo-strato"].inert, true, "il primo strato va sotto il secondo");
  assert.equal(env["secondo-strato"].inert, false);

  // Chiuso il secondo, il primo torna raggiungibile e la pagina resta inerte.
  env.dom.document.body.children = [env.app, env["primo-strato"]];
  secondHooks.unmount();
  assert.equal(env["primo-strato"].inert, false);
  assert.equal(env.app.inert, true);

  // Chiuso il primo, torna tutto.
  firstHooks.unmount();
  assert.equal(env.app.inert, false);
});

test("useInertBackground: lo strato sotto si chiude per primo e quello sopra resta in cima", (t) => {
  const env = createLayerEnv(t, "app", "sotto", "sopra");
  env.dom.document.body.children = [env.app, env.sotto];
  const belowHooks = env.open(env.sotto);
  env.dom.document.body.children = [env.app, env.sotto, env.sopra];
  const aboveHooks = env.open(env.sopra);

  // Il foglio sotto sparisce da solo mentre la conferma sopra è aperta.
  env.dom.document.body.children = [env.app, env.sopra];
  belowHooks.unmount();
  assert.equal(env.sopra.inert, false);
  assert.equal(env.app.inert, true, "la pagina resta inerte finché c'è lo strato sopra");
  assert.equal(env.sotto.inert, false);

  aboveHooks.unmount();
  assert.equal(env.app.inert, false);
});

test("useInertBackground: un portale nato dopo l'apertura diventa inerte quando l'osservatore lo vede", (t) => {
  const env = createLayerEnv(t, "app", "strato");
  const hooks = env.open(env.strato);

  const dock = env.dom.element("dock-caricamenti");
  env.dom.document.body.children = [env.app, env.strato, dock];
  assert.equal(dock.inert, false);

  assert.equal(env.dom.observers.length, 1);
  env.dom.observers[0].trigger();
  assert.equal(dock.inert, true);
  assert.equal(env.strato.inert, false);

  hooks.unmount();
  assert.equal(dock.inert, false);
  assert.equal(env.app.inert, false);
});

test("useInertBackground: un solo osservatore dei figli di body, finché c'è almeno uno strato", (t) => {
  const env = createLayerEnv(t, "app", "primo", "secondo");
  env.dom.document.body.children = [env.app, env.primo];
  const firstHooks = env.open(env.primo);
  env.dom.document.body.children = [env.app, env.primo, env.secondo];
  const secondHooks = env.open(env.secondo);

  assert.equal(env.dom.observers.length, 1, "un osservatore per strato è uno spreco");
  const [observer] = env.dom.observers;
  assert.deepEqual(observer.observed, [{ target: env.dom.document.body, options: { childList: true } }]);

  secondHooks.unmount();
  assert.equal(observer.disconnected, false, "c'è ancora uno strato aperto");
  firstHooks.unmount();
  assert.equal(observer.disconnected, true, "nessuno strato: l'osservatore non serve più");
});

test("useInertBackground: riaperto dopo una chiusura, osserva di nuovo", (t) => {
  const env = createLayerEnv(t, "app", "strato");
  env.open(env.strato).unmount();
  env.open(env.strato);
  assert.equal(env.dom.observers.length, 2);
  assert.equal(env.dom.observers[0].disconnected, true);
  assert.equal(env.dom.observers[1].disconnected, false);
});

test("useInertBackground: senza lo strato (ref vuoto) non fa niente", (t) => {
  const env = createLayerEnv(t, "app");
  const hooks = env.open(null, { current: null });

  assert.equal(env.app.inert, false);
  assert.equal(env.dom.observers.length, 0);
  hooks.unmount();
  assert.deepEqual(env.dom.log, []);
});

test("useInertBackground: è un effetto di layout, non un effetto normale", (t) => {
  const env = createLayerEnv(t, "strato");
  const hooks = env.open(env.strato);
  assert.deepEqual(hooks.effectKinds, ["layout"]);
});

test("useInertBackground: un nuovo rendering con lo stesso strato non lo rifà e non lo disfa", (t) => {
  const env = createLayerEnv(t, "app", "strato");
  const ref = { current: env.strato };
  const hooks = env.open(env.strato, ref);

  env.dom.log.length = 0;
  hooks.render(ref);
  hooks.render(ref);
  assert.deepEqual(env.dom.log, []);
  assert.equal(env.app.inert, true);
  assert.equal(env.dom.observers.length, 1);

  hooks.unmount();
  assert.equal(env.app.inert, false);
  assert.deepEqual(env.dom.log, ["inert:app:false"]);
});

test("useInertBackground: senza altri figli di body non fa niente", (t) => {
  const env = createLayerEnv(t, "strato");
  const hooks = env.open(env.strato);

  hooks.unmount();
  assert.deepEqual(env.dom.log, []);
});

// ---------------------------------------------------------------------------
// AppModal usa lo strato
// ---------------------------------------------------------------------------

// Una pagina con un pulsante che ha il focus e un modale che si apre sopra.
function openModal(t) {
  const dom = installFakeDom();
  const page = dom.element("pagina");
  const trigger = dom.element("apri");
  const backdrop = dom.element("sfondo");
  const dialog = dom.element("dialogo");
  dom.document.body.children = [page, backdrop];
  dom.document.activeElement = trigger;

  const attach = (element) =>
    element.props.role === "dialog"
      ? dialog
      : String(element.props.className).includes("app-modal-backdrop")
        ? backdrop
        : null;
  const hooks = mountHooks(AppModal, { attach });
  const portal = hooks.render({ title: "Titolo", onClose: () => {}, children: "Testo" });
  t.after(() => {
    hooks.unmount();
    dom.restore();
  });
  return { dom, hooks, tree: portal.children, page, trigger, backdrop, dialog };
}

test("AppModal: la pagina sotto è inerte, il modale no, e alla chiusura torna tutto com'era", (t) => {
  const { hooks, page, backdrop } = openModal(t);
  assert.equal(page.inert, true);
  assert.equal(backdrop.inert, false);

  hooks.unmount();
  assert.equal(page.inert, false);
});

test("AppModal: l'inert è un effetto di layout, che si toglie prima che il focus torni al pulsante", (t) => {
  const { dom, hooks, trigger } = openModal(t);
  assert.equal(hooks.effectKinds.filter((kind) => kind === "layout").length, 1);

  dom.log.length = 0;
  hooks.unmount();
  assert.equal(dom.document.activeElement, trigger);
  assert.deepEqual(dom.log, ["inert:pagina:false", "focus:apri"]);
});

test("AppModal: Tab resta nel dialogo", (t) => {
  const { dom, tree, dialog } = openModal(t);
  const first = dom.element("chiudi");
  const last = dom.element("conferma");
  dialog.focusables = [first, last];

  const section = findElements(tree, (el) => el.props.role === "dialog")[0];
  assert.equal(typeof section.props.onKeyDown, "function", "il dialogo non ascolta i tasti");
  const press = (key, shiftKey = false) => {
    const event = { key, shiftKey, prevented: 0, preventDefault() { this.prevented += 1; } };
    section.props.onKeyDown(event);
    return event;
  };

  dom.document.activeElement = last;
  assert.equal(press("Tab").prevented, 1);
  assert.equal(dom.document.activeElement, first);

  assert.equal(press("Tab", true).prevented, 1);
  assert.equal(dom.document.activeElement, last);

  dom.document.activeElement = first;
  assert.equal(press("Tab").prevented, 0);
});

test("AppModal: il titolo dà il nome al dialogo con il proprio id", (t) => {
  const { tree } = openModal(t);
  const dialog = findElements(tree, (el) => el.props.role === "dialog")[0];
  const heading = findElements(tree, (el) => el.type === "h2")[0];
  assert.ok(heading.props.id);
  assert.equal(dialog.props["aria-labelledby"], heading.props.id);
});

// ---------------------------------------------------------------------------
// isTopLayer
// ---------------------------------------------------------------------------

test("isTopLayer: senza strati aperti è vero per chiunque, anche senza elemento", (t) => {
  const env = createLayerEnv(t, "app", "strato");
  assert.equal(isTopLayer(env.strato), true);
  assert.equal(isTopLayer(env.app), true);
  assert.equal(isTopLayer(null), true);
});

test("isTopLayer: con un solo strato aperto lo è lui", (t) => {
  const env = createLayerEnv(t, "app", "strato");
  env.open(env.strato);
  assert.equal(isTopLayer(env.strato), true);
});

test("isTopLayer: con due strati lo è solo quello in cima", (t) => {
  const env = createLayerEnv(t, "app", "primo", "secondo");
  env.dom.document.body.children = [env.app, env.primo];
  env.open(env.primo);
  env.dom.document.body.children = [env.app, env.primo, env.secondo];
  env.open(env.secondo);

  assert.equal(isTopLayer(env.secondo), true);
  assert.equal(isTopLayer(env.primo), false, "il primo sta sotto il secondo");
});

test("isTopLayer: chiuso quello in cima, torna in cima quello sotto", (t) => {
  const env = createLayerEnv(t, "app", "primo", "secondo");
  env.dom.document.body.children = [env.app, env.primo];
  env.open(env.primo);
  env.dom.document.body.children = [env.app, env.primo, env.secondo];
  const secondHooks = env.open(env.secondo);

  env.dom.document.body.children = [env.app, env.primo];
  secondHooks.unmount();
  assert.equal(isTopLayer(env.primo), true);
  assert.equal(isTopLayer(env.secondo), false, "uno strato chiuso non è in cima mentre ne resta uno aperto");
});

test("isTopLayer: il foglio sotto si chiude per primo e quello sopra resta in cima", (t) => {
  const env = createLayerEnv(t, "app", "sotto", "sopra");
  env.dom.document.body.children = [env.app, env.sotto];
  const belowHooks = env.open(env.sotto);
  env.dom.document.body.children = [env.app, env.sotto, env.sopra];
  env.open(env.sopra);

  env.dom.document.body.children = [env.app, env.sopra];
  belowHooks.unmount();
  assert.equal(isTopLayer(env.sopra), true);
  assert.equal(isTopLayer(env.sotto), false);
});

test("isTopLayer: chiusi tutti gli strati torna vero per chiunque", (t) => {
  const env = createLayerEnv(t, "app", "primo", "secondo");
  const firstHooks = env.open(env.primo);
  const secondHooks = env.open(env.secondo);
  assert.equal(isTopLayer(env.primo), false);

  secondHooks.unmount();
  firstHooks.unmount();
  assert.equal(isTopLayer(env.primo), true);
  assert.equal(isTopLayer(env.secondo), true);
});

test("isTopLayer: un elemento non ancora agganciato (ref vuoto) non blocca Esc", (t) => {
  const env = createLayerEnv(t, "app", "primo", "secondo");
  env.open(env.primo);
  env.open(env.secondo);
  assert.equal(isTopLayer(null), true);
});

test("isTopLayer: un elemento che non è mai stato uno strato non è in cima mentre ce n'è uno aperto", (t) => {
  const env = createLayerEnv(t, "app", "strato");
  env.open(env.strato);
  assert.equal(isTopLayer(env.app), false);
});

test("isTopLayer: senza un browser, cioè senza pila, è sempre vero", async () => {
  // La pila nasce solo se c'è un `document` quando il modulo si carica: un'altra
  // istanza del modulo, caricata senza DOM, non ce l'ha.
  assert.equal(typeof document, "undefined");
  const withoutDom = await import("../src/hooks/useModalLayer.ts?senza-dom");
  assert.notEqual(withoutDom.isTopLayer, isTopLayer, "è la stessa istanza del modulo: la prova non vale");
  assert.equal(withoutDom.isTopLayer({}), true);
  assert.equal(withoutDom.isTopLayer(null), true);
});

// ---------------------------------------------------------------------------
// AppModal: Esc chiude solo il modale in cima
// ---------------------------------------------------------------------------

// Una pagina e un numero qualsiasi di AppModal che si aprono uno sopra l'altro,
// ciascuno con i propri nodi finti e il proprio `onClose` che conta le chiamate.
function createModalsEnv(t) {
  const dom = installFakeDom();
  const page = dom.element("pagina");
  dom.document.body.children = [page];
  dom.document.activeElement = dom.element("apri");
  const opened = [];
  t.after(() => {
    for (const hooks of opened.reverse()) hooks.unmount();
    dom.restore();
  });

  function open(name) {
    const backdrop = dom.element(`sfondo-${name}`);
    const dialog = dom.element(`dialogo-${name}`);
    dom.document.body.children = [...dom.document.body.children, backdrop];
    const attach = (element) =>
      element.props.role === "dialog"
        ? dialog
        : String(element.props.className).includes("app-modal-backdrop")
          ? backdrop
          : null;
    const hooks = mountHooks(AppModal, { attach });
    opened.push(hooks);

    const modal = {
      name,
      hooks,
      backdrop,
      closed: 0,
      // Il genitore che ridisegna con un `onClose` nuovo (una freccia in linea).
      render() {
        hooks.render({ title: name, onClose: () => (modal.closed += 1), children: "Testo" });
      },
      // Il genitore toglie il modale dalla pagina.
      remove() {
        dom.document.body.children = dom.document.body.children.filter((child) => child !== backdrop);
        hooks.unmount();
      },
    };
    modal.render();
    return modal;
  }

  return { dom, page, open, press: (key) => dom.window.press(key) };
}

test("AppModal: da solo, Esc lo chiude", (t) => {
  const env = createModalsEnv(t);
  const modal = env.open("unico");

  env.press("Escape");
  assert.equal(modal.closed, 1);
});

test("AppModal: due modali aperti insieme, un Esc chiude solo quello in cima", (t) => {
  const env = createModalsEnv(t);
  const below = env.open("sotto");
  const above = env.open("sopra");

  env.press("Escape");
  assert.equal(above.closed, 1);
  assert.equal(below.closed, 0, "Esc ha chiuso anche il modale sotto");
});

test("AppModal: chiuso quello in cima, il prossimo Esc chiude l'altro", (t) => {
  const env = createModalsEnv(t);
  const below = env.open("sotto");
  const above = env.open("sopra");

  env.press("Escape");
  above.remove();
  assert.deepEqual([below.closed, above.closed], [0, 1]);

  env.press("Escape");
  assert.deepEqual([below.closed, above.closed], [1, 1], "il modale sotto è tornato in cima");
});

test("AppModal: Esc ripetuto senza che quello in cima si chiuda non tocca mai quello sotto", (t) => {
  const env = createModalsEnv(t);
  const below = env.open("sotto");
  const above = env.open("sopra");

  env.press("Escape");
  env.press("Escape");
  env.press("Escape");
  assert.equal(above.closed, 3);
  assert.equal(below.closed, 0);
});

test("AppModal: l'ordine dei listener non conta, anche se quello sotto si è registrato per ultimo", (t) => {
  const env = createModalsEnv(t);
  const below = env.open("sotto");
  const above = env.open("sopra");

  // Il genitore ridisegna il modale sotto con un `onClose` nuovo: il suo
  // listener esce e rientra, ora dopo quello del modale sopra.
  below.render();
  assert.equal(env.dom.window.listeners.length, 2);

  env.press("Escape");
  assert.equal(above.closed, 1);
  assert.equal(below.closed, 0);
});

test("AppModal: tre modali impilati, Esc chiude solo l'ultimo e poi uno alla volta", (t) => {
  const env = createModalsEnv(t);
  const modals = [env.open("uno"), env.open("due"), env.open("tre")];
  const counts = () => modals.map((modal) => modal.closed);

  env.press("Escape");
  assert.deepEqual(counts(), [0, 0, 1]);

  modals[2].remove();
  env.press("Escape");
  assert.deepEqual(counts(), [0, 1, 1]);

  modals[1].remove();
  env.press("Escape");
  assert.deepEqual(counts(), [1, 1, 1]);
});

test("AppModal: il modale sotto si chiude da solo e quello sopra resta chiudibile con Esc", (t) => {
  const env = createModalsEnv(t);
  const below = env.open("sotto");
  const above = env.open("sopra");

  below.remove();
  env.press("Escape");
  assert.equal(above.closed, 1);
  assert.equal(below.closed, 0);
});

test("AppModal: uno strato aperto sopra (un foglio che non è un AppModal) prende lui l'Esc", (t) => {
  const env = createModalsEnv(t);
  const modal = env.open("modale");

  const sheet = env.dom.element("foglio");
  env.dom.document.body.children = [...env.dom.document.body.children, sheet];
  const sheetHooks = openLayer(sheet);

  env.press("Escape");
  assert.equal(modal.closed, 0, "Esc ha chiuso il modale sotto il foglio");

  sheetHooks.unmount();
  env.press("Escape");
  assert.equal(modal.closed, 1);
});

test("AppModal: gli altri tasti non chiudono nessun modale", (t) => {
  const env = createModalsEnv(t);
  const below = env.open("sotto");
  const above = env.open("sopra");

  for (const key of ["Enter", " ", "Tab", "ArrowDown", "a", "escape", "Esc"]) {
    env.press(key);
  }
  assert.deepEqual([below.closed, above.closed], [0, 0]);
});

test("AppModal: chiuso, non ascolta più la tastiera", (t) => {
  const env = createModalsEnv(t);
  const modal = env.open("unico");
  assert.equal(env.dom.window.listeners.length, 1);

  modal.remove();
  assert.equal(env.dom.window.listeners.length, 0);
  env.press("Escape");
  assert.equal(modal.closed, 0);
});
