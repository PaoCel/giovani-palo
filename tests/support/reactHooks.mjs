// Esecutore di hook per i test, senza DOM e senza toccare gli interni di React.
//
// `reactHooksLoader.mjs` fa risolvere `import ... from "react"` dei file di
// `src/` verso questo modulo. Fuori da `mountHooks` ogni hook passa a React
// vero (così `react-dom/server` rende i componenti come sempre); dentro
// `mountHooks` gli hook girano qui, con un posto per chiamata e gli effetti
// eseguiti come fa React: prima quelli di layout, poi quelli normali, le
// pulizie prima dei nuovi effetti e, alla chiusura, quelle di layout per prime.
//
// Supporta `useRef`, `useEffect`, `useLayoutEffect`, `useId`, `useCallback`,
// `useMemo`. Un altro hook dentro `mountHooks` dà un errore che lo nomina: si
// aggiunge qui sotto (un hook con stato, come `useState`, richiede anche un
// nuovo rendering, che qui non c'è).
import React from "react";

let active = null;
let nextId = 0;

const sameDeps = (previous, next) =>
  Boolean(previous) &&
  Boolean(next) &&
  previous.length === next.length &&
  next.every((dep, index) => Object.is(dep, previous[index]));

class Mount {
  slots = [];
  cursor = 0;
  pending = { layout: [], passive: [] };

  slot(type, create) {
    const index = this.cursor++;
    const existing = this.slots[index];
    if (existing && existing.type !== type) {
      throw new Error(`Gli hook non sono chiamati sempre nello stesso ordine (posto ${index})`);
    }
    this.slots[index] ??= { type, ...create() };
    return this.slots[index];
  }

  effect(kind, create, deps) {
    const slot = this.slot("effect", () => ({ kind, deps: undefined, cleanup: undefined, ran: false }));
    if (slot.ran && sameDeps(slot.deps, deps)) return;
    this.pending[kind].push({ slot, create, deps });
  }

  commit() {
    for (const kind of ["layout", "passive"]) {
      const batch = this.pending[kind];
      this.pending[kind] = [];
      for (const { slot } of batch) {
        slot.cleanup?.();
        slot.cleanup = undefined;
      }
      for (const { slot, create, deps } of batch) {
        slot.cleanup = create() ?? undefined;
        slot.deps = deps;
        slot.ran = true;
      }
    }
  }
}

const IMPLEMENTATIONS = {
  useRef(mount, initial) {
    return mount.slot("ref", () => ({ ref: { current: initial } })).ref;
  },
  useEffect(mount, create, deps) {
    mount.effect("passive", create, deps);
  },
  useLayoutEffect(mount, create, deps) {
    mount.effect("layout", create, deps);
  },
  useId(mount) {
    return mount.slot("id", () => ({ id: `:t${nextId++}:` })).id;
  },
  useCallback(mount, callback, deps) {
    const slot = mount.slot("memo", () => ({ deps: undefined, value: undefined, ran: false }));
    if (!slot.ran || !sameDeps(slot.deps, deps)) Object.assign(slot, { deps, value: callback, ran: true });
    return slot.value;
  },
  useMemo(mount, factory, deps) {
    const slot = mount.slot("memo", () => ({ deps: undefined, value: undefined, ran: false }));
    if (!slot.ran || !sameDeps(slot.deps, deps)) Object.assign(slot, { deps, value: factory(), ran: true });
    return slot.value;
  },
};

function hook(name) {
  return (...args) => {
    if (!active) return React[name](...args);
    const implementation = IMPLEMENTATIONS[name];
    if (!implementation) {
      throw new Error(
        `L'esecutore di hook dei test non supporta ${name}: aggiungilo in tests/support/reactHooks.mjs`,
      );
    }
    return implementation(active, ...args);
  };
}

export const useRef = hook("useRef");
export const useEffect = hook("useEffect");
export const useLayoutEffect = hook("useLayoutEffect");
export const useId = hook("useId");
export const useCallback = hook("useCallback");
export const useMemo = hook("useMemo");
export const useState = hook("useState");
export const useReducer = hook("useReducer");
export const useContext = hook("useContext");
export const useImperativeHandle = hook("useImperativeHandle");
export const useSyncExternalStore = hook("useSyncExternalStore");
export const useTransition = hook("useTransition");
export const useDeferredValue = hook("useDeferredValue");

export const {
  Children,
  Fragment,
  StrictMode,
  Suspense,
  cloneElement,
  createContext,
  createElement,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  startTransition,
} = React;
export default React;

// Cammina l'albero restituito da un componente (elementi e portali) e dà ai
// `ref` ad oggetto un nodo, come fa React quando monta il DOM.
function attachRefs(node, attach, seen = new Set()) {
  if (Array.isArray(node)) {
    for (const child of node) attachRefs(child, attach, seen);
  } else if (node && typeof node === "object" && !seen.has(node)) {
    seen.add(node);
    const ref = node.props?.ref;
    if (ref && typeof ref === "object" && "current" in ref && ref.current === null) {
      ref.current = attach(node) ?? null;
    }
    attachRefs(node.props?.children, attach, seen);
    attachRefs(node.children, attach, seen);
  }
}

// Monta una funzione che chiama hook (un componente o un hook): `render(...args)`
// la chiama e fa girare gli effetti, `unmount()` esegue le pulizie.
// `attach(elemento)` crea il nodo da mettere in ogni `ref` dell'albero, prima
// degli effetti: se manca, i `ref` restano `null`.
export function mountHooks(callback, { attach } = {}) {
  const mount = new Mount();

  return {
    render(...args) {
      const outer = active;
      active = mount;
      mount.cursor = 0;
      let result;
      try {
        result = callback(...args);
      } finally {
        active = outer;
      }
      if (attach) attachRefs(result, attach);
      mount.commit();
      return result;
    },
    unmount() {
      for (const kind of ["layout", "passive"]) {
        for (const slot of mount.slots) {
          if (slot?.type === "effect" && slot.kind === kind) {
            slot.cleanup?.();
            slot.cleanup = undefined;
          }
        }
      }
    },
    // Il tipo di ogni effetto, nell'ordine di dichiarazione: "layout" o "passive".
    get effectKinds() {
      return mount.slots.filter((slot) => slot?.type === "effect").map((slot) => slot.kind);
    },
  };
}

// Cammina l'albero di elementi restituito da un componente (anche dentro un
// portale) e raccoglie gli elementi che rispondono al predicato.
export function findElements(node, predicate, found = []) {
  if (Array.isArray(node)) {
    for (const child of node) findElements(child, predicate, found);
  } else if (node && typeof node === "object") {
    if (node.props && predicate(node)) found.push(node);
    findElements(node.props?.children, predicate, found);
    findElements(node.children, predicate, found);
  }
  return found;
}

// Il testo di un elemento (o di un elenco di figli).
export function textOf(node) {
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (node && typeof node === "object") return textOf(node.props?.children);
  return "";
}
