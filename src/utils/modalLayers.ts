// Strati modali aperti (fogli, modali, conferme): solo il più alto resta
// raggiungibile con la tastiera e con uno screen reader, gli altri figli di
// <body> sono `inert`. Ogni apertura o chiusura, anche fuori ordine (il foglio
// sotto che si chiude da solo mentre una conferma è aperta sopra), ricalcola
// tutto da capo; torna attivo solo ciò che la pila ha reso inerte.
//
// Questo file lo carica anche Node (tests/): niente DOM e niente alias "@/".

export interface LayerElement {
  inert: boolean;
  contains?(other: unknown): boolean;
}

export function createLayerStack<T extends LayerElement>(host: { children: () => Iterable<T> }) {
  const layers: T[] = [];
  const managed = new Set<T>();

  // Il figlio di <body> che contiene lo strato più alto resta attivo.
  function holdsTop(element: T, top: T) {
    return element === top || (typeof element.contains === "function" && element.contains(top));
  }

  function sync() {
    const top = layers.length > 0 ? layers[layers.length - 1] : null;
    const children = Array.from(host.children());

    for (const element of Array.from(managed)) {
      if (!top || holdsTop(element, top) || !children.includes(element)) {
        element.inert = false;
        managed.delete(element);
      }
    }

    if (!top) return;

    for (const element of children) {
      // Già inerte per altri motivi: non è nostro, non si tocca.
      if (holdsTop(element, top) || managed.has(element) || element.inert) continue;
      element.inert = true;
      managed.add(element);
    }
  }

  return {
    open(layer: T) {
      layers.push(layer);
      sync();
      return () => {
        const index = layers.lastIndexOf(layer);
        if (index !== -1) layers.splice(index, 1);
        sync();
      };
    },
    sync,
    size: () => layers.length,
  };
}
