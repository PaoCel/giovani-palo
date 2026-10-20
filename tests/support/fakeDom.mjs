// Un DOM finto, quanto basta ai fogli e ai modali (`window`, `document`,
// `HTMLElement`), per provare la logica che li governa senza un browser. Il
// comportamento con un DOM vero lo prova il collaudo nel browser.
//
// `installFakeDom()` mette i globali e ritorna `restore()`, da chiamare dopo
// `unmount()` degli hook (la loro pulizia toglie i listener da `window` e `document`).
// Ogni cosa che conta per l'ordine (inert, focus) finisce in `log`.
//
// `src/hooks/useModalLayer.ts` decide all'import se esiste un `document` (la pila
// degli strati si crea solo nel browser): i test lo importano con
// `importWithFakeDom`, poi usano un DOM finto nuovo per ogni prova.

class HTMLElementStub {}

// I globali com'erano prima del primo DOM finto ancora installato. Un test che
// ne installa più d'uno (un ciclo) li restituisce tutti con `restore()`, in
// qualunque ordine: solo l'ultimo rimette l'ambiente senza browser.
const originals = new Map();
let installed = 0;

export function installFakeDom() {
  const log = [];
  const captureOf = (options) => options === true || options?.capture === true;

  // Un bersaglio di eventi (window o document): registra e toglie i listener
  // con la stessa chiave (tipo, funzione, fase) del browser.
  function createTarget() {
    const listeners = [];
    return {
      listeners,
      addEventListener(type, fn, options) {
        listeners.push({ type, fn, capture: captureOf(options) });
      },
      removeEventListener(type, fn, options) {
        const index = listeners.findIndex(
          (item) => item.type === type && item.fn === fn && item.capture === captureOf(options),
        );
        if (index >= 0) listeners.splice(index, 1);
      },
    };
  }

  const fakeWindow = createTarget();
  // `body.style` serve a chi blocca lo scorrimento della pagina (overflow).
  const fakeDocument = {
    ...createTarget(),
    activeElement: null,
    body: { nodeType: 1, children: [], style: {} },
  };

  // Come il browser: un tasto premuto su un elemento della pagina sale da
  // window (cattura) a document (cattura, poi bubbling) e torna a window
  // (bubbling). `stopPropagation` ferma i bersagli che seguono; gli altri
  // listener dello stesso bersaglio e della stessa fase girano comunque.
  fakeWindow.press = (key, extra = {}) => {
    const event = {
      key,
      shiftKey: false,
      ...extra,
      stopped: false,
      stopPropagation() {
        this.stopped = true;
      },
    };
    for (const [target, capture] of [
      [fakeWindow, true],
      [fakeDocument, true],
      [fakeDocument, false],
      [fakeWindow, false],
    ]) {
      if (event.stopped) break;
      for (const item of [...target.listeners]) {
        if (item.type === "keydown" && item.capture === capture) item.fn(event);
      }
    }
    return event;
  };

  // MutationObserver finto: `trigger()` chiama il callback come farebbe il
  // browser dopo che un figlio di <body> è nato o sparito.
  const observers = [];
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.observed = [];
      this.disconnected = false;
      observers.push(this);
    }

    observe(target, options) {
      this.observed.push({ target, options });
    }

    disconnect() {
      this.disconnected = true;
    }

    trigger() {
      if (!this.disconnected) this.callback([], this);
    }
  }

  // Un elemento: `inert` e `focus()` lasciano traccia in `log`; `focusables` è
  // ciò che `querySelectorAll` restituisce.
  class FakeElement extends HTMLElementStub {
    constructor(name, props = {}) {
      super();
      this.name = name;
      this.isConnected = true;
      this.descendants = [];
      this.focusables = [];
      this.selectors = [];
      this.focusOptions = [];
      this._inert = false;
      Object.assign(this, props);
    }

    get inert() {
      return this._inert;
    }

    set inert(value) {
      this._inert = value;
      log.push(`inert:${this.name}:${value}`);
    }

    focus(options) {
      fakeDocument.activeElement = this;
      this.focusOptions.push(options);
      log.push(`focus:${this.name}`);
    }

    contains(other) {
      return other === this || this.descendants.includes(other);
    }

    querySelectorAll(selector) {
      this.selectors.push(selector);
      return this.focusables;
    }
  }

  const set = (name, value) => {
    if (installed === 0) {
      originals.set(name, name in globalThis ? { had: true, value: globalThis[name] } : { had: false });
    }
    globalThis[name] = value;
  };
  set("window", fakeWindow);
  set("document", fakeDocument);
  set("HTMLElement", HTMLElementStub);
  set("MutationObserver", FakeMutationObserver);
  installed += 1;
  let restored = false;

  return {
    window: fakeWindow,
    document: fakeDocument,
    observers,
    log,
    // Elemento che `instanceof HTMLElement` riconosce.
    element: (name, props) => new FakeElement(name, props),
    // Un nodo che NON è un HTMLElement (un SVG, per esempio).
    plainNode: (name) => ({ name, inert: false }),
    restore() {
      if (restored) return;
      restored = true;
      installed -= 1;
      if (installed > 0) return;
      for (const [name, previous] of originals) {
        if (previous.had) globalThis[name] = previous.value;
        else delete globalThis[name];
      }
      originals.clear();
    },
  };
}

// Esegue `load` (di solito un `import()`) con un DOM finto, poi lo toglie.
export async function importWithFakeDom(load) {
  const dom = installFakeDom();
  try {
    return await load();
  } finally {
    dom.restore();
  }
}
