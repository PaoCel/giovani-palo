// Un DOM finto, quanto basta ai fogli e ai modali (`window`, `document`,
// `HTMLElement`), per provare la logica che li governa senza un browser. Il
// comportamento con un DOM vero lo prova il collaudo nel browser.
//
// `installFakeDom()` mette i globali e ritorna `restore()`, da chiamare dopo
// `unmount()` degli hook (la loro pulizia toglie i listener da `window`).
// Ogni cosa che conta per l'ordine (inert, focus) finisce in `log`.
//
// `src/hooks/useModalLayer.ts` decide all'import se esiste un `document` (la pila
// degli strati si crea solo nel browser): i test lo importano con
// `importWithFakeDom`, poi usano un DOM finto nuovo per ogni prova.

class HTMLElementStub {}

export function installFakeDom() {
  const log = [];
  const listeners = [];
  const captureOf = (options) => options === true || options?.capture === true;

  const fakeWindow = {
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
    // Come il browser: prima i listener in cattura, poi gli altri (se nessuno ha
    // fermato l'evento).
    press(key, extra = {}) {
      const event = {
        key,
        shiftKey: false,
        ...extra,
        stopped: false,
        stopPropagation() {
          this.stopped = true;
        },
      };
      for (const capture of [true, false]) {
        for (const item of [...listeners]) {
          if (item.type !== "keydown" || item.capture !== capture) continue;
          if (!capture && event.stopped) continue;
          item.fn(event);
        }
      }
      return event;
    },
  };

  const fakeDocument = { activeElement: null, body: { nodeType: 1, children: [] } };

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

  const saved = new Map();
  const set = (name, value) => {
    saved.set(name, name in globalThis ? { had: true, value: globalThis[name] } : { had: false });
    globalThis[name] = value;
  };
  set("window", fakeWindow);
  set("document", fakeDocument);
  set("HTMLElement", HTMLElementStub);
  set("MutationObserver", FakeMutationObserver);

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
      for (const [name, previous] of saved) {
        if (previous.had) globalThis[name] = previous.value;
        else delete globalThis[name];
      }
      saved.clear();
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
