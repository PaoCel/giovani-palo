import test from "node:test";
import assert from "node:assert/strict";

import { createLayerStack } from "../src/utils/modalLayers.ts";

// Pila degli strati modali aperti (`src/utils/modalLayers.ts`): solo lo strato
// più alto resta raggiungibile con la tastiera e con uno screen reader, gli
// altri figli di <body> sono `inert`. Ogni apertura o chiusura, anche fuori
// ordine, ricalcola tutto; torna attivo solo ciò che la pila ha reso inerte.
//
// La pila non vede il DOM: riceve da `host.children()` l'elenco dei figli di
// <body>. Qui sono oggetti con `inert` (e `contains`, quando serve).
//
// Comando: node --test tests/layerStack.test.mjs

// Un figlio di <body>; `inside` sono gli strati che contiene (un wrapper).
function node(name, { inert = false, inside = [] } = {}) {
  return {
    name,
    inert,
    contains(other) {
      return other === this || inside.includes(other);
    },
  };
}

// <body> con i suoi figli, che si possono aggiungere e togliere.
function createBody(...nodes) {
  const children = [...nodes];
  return {
    children,
    add(...added) {
      children.push(...added);
    },
    remove(removed) {
      children.splice(children.indexOf(removed), 1);
    },
    stack: createLayerStack({ children: () => children }),
  };
}

const inertNames = (body) => body.children.filter((child) => child.inert).map((child) => child.name);

test("aprire uno strato rende inerti gli altri figli di body e lascia attivo lui", () => {
  const page = node("pagina");
  const toast = node("avvisi");
  const sheet = node("foglio");
  const body = createBody(page, toast, sheet);

  body.stack.open(sheet);
  assert.deepEqual(inertNames(body), ["pagina", "avvisi"]);
  assert.equal(sheet.inert, false);
  assert.equal(body.stack.size(), 1);
});

test("chiudere l'unico strato riattiva tutto", () => {
  const page = node("pagina");
  const sheet = node("foglio");
  const body = createBody(page, sheet);

  const close = body.stack.open(sheet);
  close();
  assert.deepEqual(inertNames(body), []);
  assert.equal(body.stack.size(), 0);
});

test("due strati uno sull'altro: resta attivo solo quello in cima", () => {
  const page = node("pagina");
  const first = node("primo");
  const second = node("secondo");
  const body = createBody(page, first);

  body.stack.open(first);
  body.add(second);
  body.stack.open(second);

  assert.deepEqual(inertNames(body), ["pagina", "primo"]);
  assert.equal(second.inert, false);
  assert.equal(body.stack.size(), 2);
});

test("chiusi in ordine: prima torna attivo il primo strato, poi la pagina", () => {
  const page = node("pagina");
  const first = node("primo");
  const second = node("secondo");
  const body = createBody(page, first);

  const closeFirst = body.stack.open(first);
  body.add(second);
  const closeSecond = body.stack.open(second);

  body.remove(second);
  closeSecond();
  assert.deepEqual(inertNames(body), ["pagina"], "il primo strato torna raggiungibile, la pagina no");
  assert.equal(first.inert, false);

  body.remove(first);
  closeFirst();
  assert.deepEqual(inertNames(body), []);
});

test("chiusi fuori ordine: il foglio sotto se ne va mentre quello sopra resta aperto", () => {
  const page = node("pagina");
  const below = node("sotto");
  const above = node("sopra");
  const body = createBody(page, below);

  const closeBelow = body.stack.open(below);
  body.add(above);
  const closeAbove = body.stack.open(above);

  // Il foglio sotto si chiude e il suo nodo sparisce da body.
  body.remove(below);
  closeBelow();
  assert.equal(body.stack.size(), 1);
  assert.deepEqual(inertNames(body), ["pagina"], "la pagina resta inerte finché c'è lo strato sopra");
  assert.equal(above.inert, false);
  assert.equal(below.inert, false, "il nodo che non c'è più non resta inerte");

  body.remove(above);
  closeAbove();
  assert.deepEqual(inertNames(body), []);
});

test("chiudere fuori ordine con il nodo ancora in body non lo riattiva finché non sparisce", () => {
  const page = node("pagina");
  const below = node("sotto");
  const above = node("sopra");
  const body = createBody(page, below);

  const closeBelow = body.stack.open(below);
  body.add(above);
  body.stack.open(above);

  // Lo strato sotto esce dalla pila ma il suo nodo c'è ancora: sta sotto lo strato sopra.
  closeBelow();
  assert.equal(below.inert, true);

  // Sparito dal DOM (l'osservatore chiama sync): si ripulisce.
  body.remove(below);
  body.stack.sync();
  assert.equal(below.inert, false);
  assert.deepEqual(inertNames(body), ["pagina"]);
});

test("ciò che era già inerte resta com'è, aperto e chiuso lo strato", () => {
  const page = node("pagina");
  const other = node("altro", { inert: true });
  const sheet = node("foglio");
  const body = createBody(page, other, sheet);

  const close = body.stack.open(sheet);
  assert.equal(other.inert, true);
  close();
  assert.equal(other.inert, true, "l'ha reso inerte qualcun altro: spetta a lui toglierlo");
  assert.equal(page.inert, false);
});

test("un figlio nato dopo l'apertura (un portale) diventa inerte alla sync e torna attivo alla chiusura", () => {
  const page = node("pagina");
  const sheet = node("foglio");
  const body = createBody(page, sheet);
  const close = body.stack.open(sheet);

  const dock = node("dock-caricamenti");
  body.add(dock);
  assert.equal(dock.inert, false, "prima della sync il browser non l'ha ancora detto alla pila");
  body.stack.sync();
  assert.equal(dock.inert, true);

  close();
  assert.equal(dock.inert, false);
  assert.equal(page.inert, false);
});

test("un figlio nato dopo e già sparito non lascia tracce", () => {
  const sheet = node("foglio");
  const body = createBody(sheet);
  const close = body.stack.open(sheet);

  const toast = node("avviso");
  body.add(toast);
  body.stack.sync();
  body.remove(toast);
  body.stack.sync();
  close();
  assert.deepEqual(inertNames(body), []);
});

test("il figlio di body che contiene lo strato in cima resta attivo", () => {
  const page = node("pagina");
  const sheet = node("foglio");
  const wrapper = node("contenitore", { inside: [sheet] });
  const body = createBody(page, wrapper);

  body.stack.open(sheet);
  assert.equal(wrapper.inert, false, "un contenitore inerte renderebbe inerte anche il foglio");
  assert.deepEqual(inertNames(body), ["pagina"]);
});

test("un contenitore già reso inerte torna attivo quando lo strato che contiene sale in cima", () => {
  const page = node("pagina");
  const wrapper = node("contenitore");
  const inner = node("dentro");
  const top = node("sopra");
  wrapper.contains = (other) => other === wrapper || other === inner;
  const body = createBody(page, wrapper);

  const closeInner = body.stack.open(inner);
  assert.equal(wrapper.inert, false, "contiene lo strato in cima");

  body.add(top);
  const closeTop = body.stack.open(top);
  assert.equal(wrapper.inert, true, "ora sta sotto lo strato in cima");

  body.remove(top);
  closeTop();
  assert.equal(wrapper.inert, false, "lo strato che contiene è di nuovo in cima");
  assert.equal(page.inert, true);
  closeInner();
  assert.deepEqual(inertNames(body), []);
});

test("senza `contains` conta solo l'identità", () => {
  const page = { name: "pagina", inert: false };
  const sheet = { name: "foglio", inert: false };
  const body = createBody(page, sheet);

  const close = body.stack.open(sheet);
  assert.equal(page.inert, true);
  assert.equal(sheet.inert, false);
  close();
  assert.equal(page.inert, false);
});

test("chiudere due volte lo stesso strato non rompe gli altri", () => {
  const page = node("pagina");
  const first = node("primo");
  const second = node("secondo");
  const body = createBody(page, first, second);

  const closeFirst = body.stack.open(first);
  body.stack.open(second);

  closeFirst();
  closeFirst();
  assert.equal(body.stack.size(), 1);
  assert.equal(second.inert, false);
  assert.equal(page.inert, true);
});

test("size conta gli strati aperti", () => {
  const first = node("primo");
  const second = node("secondo");
  const body = createBody(first, second);
  assert.equal(body.stack.size(), 0);

  const closeFirst = body.stack.open(first);
  assert.equal(body.stack.size(), 1);
  const closeSecond = body.stack.open(second);
  assert.equal(body.stack.size(), 2);
  closeSecond();
  closeFirst();
  assert.equal(body.stack.size(), 0);
});

test("senza strati aperti sync non tocca niente", () => {
  const page = node("pagina");
  const locked = node("bloccato", { inert: true });
  const body = createBody(page, locked);

  body.stack.sync();
  assert.deepEqual(inertNames(body), ["bloccato"]);
});

test("aprire e chiudere più volte di fila lascia la pagina come prima", () => {
  const page = node("pagina");
  const sheet = node("foglio");
  const body = createBody(page, sheet);

  for (let i = 0; i < 3; i += 1) {
    const close = body.stack.open(sheet);
    assert.equal(page.inert, true, `giro ${i}`);
    close();
    assert.equal(page.inert, false, `giro ${i}`);
  }
});

// ---------------------------------------------------------------------------
// I casi veri dell'app
// ---------------------------------------------------------------------------

test("ChildSheet sotto, conferma «Esci» sopra: se il foglio sotto si chiude per primo la pagina resta inerte", () => {
  const page = node("pagina");
  const childSheet = node("ChildSheet");
  const exitConfirm = node("conferma-esci");
  const body = createBody(page, childSheet);

  const closeChildSheet = body.stack.open(childSheet);
  body.add(exitConfirm);
  const closeExitConfirm = body.stack.open(exitConfirm);
  assert.deepEqual(inertNames(body), ["pagina", "ChildSheet"]);

  // Il foglio sotto si chiude da solo (per esempio dopo un invio andato a buon fine).
  body.remove(childSheet);
  closeChildSheet();
  assert.equal(page.inert, true, "la conferma è ancora aperta: la pagina non è raggiungibile");
  assert.equal(exitConfirm.inert, false);

  body.remove(exitConfirm);
  closeExitConfirm();
  assert.equal(page.inert, false);
});

test("ChildSheet sotto, conferma «Esci» sopra: chiusi nell'ordine inverso torna tutto uguale", () => {
  const page = node("pagina");
  const childSheet = node("ChildSheet");
  const exitConfirm = node("conferma-esci");
  const body = createBody(page, childSheet);

  const closeChildSheet = body.stack.open(childSheet);
  body.add(exitConfirm);
  const closeExitConfirm = body.stack.open(exitConfirm);

  body.remove(exitConfirm);
  closeExitConfirm();
  assert.deepEqual(inertNames(body), ["pagina"]);
  assert.equal(childSheet.inert, false, "il foglio sotto torna raggiungibile");

  body.remove(childSheet);
  closeChildSheet();
  assert.deepEqual(inertNames(body), []);
});

test("due strati aperti nello stesso istante, con i nodi già in body: resta attivo l'ultimo aperto", () => {
  const page = node("pagina");
  const first = node("primo");
  const second = node("secondo");
  const body = createBody(page, first, second);

  // I due effetti girano nello stesso commit: la pila vede entrambi i nodi
  // fin dalla prima apertura.
  const closeFirst = body.stack.open(first);
  assert.deepEqual(inertNames(body), ["pagina", "secondo"]);
  const closeSecond = body.stack.open(second);
  assert.deepEqual(inertNames(body), ["pagina", "primo"]);
  assert.equal(second.inert, false, "uno strato aperto non resta inerte per colpa dell'altro");

  closeSecond();
  assert.deepEqual(inertNames(body), ["pagina", "secondo"], "ora in cima c'è il primo");
  closeFirst();
  assert.deepEqual(inertNames(body), []);
});

test("due strati aperti nello stesso istante e chiusi nello stesso istante, in tutti e due gli ordini", () => {
  for (const order of [["first", "second"], ["second", "first"]]) {
    const page = node("pagina");
    const first = node("primo");
    const second = node("secondo");
    const body = createBody(page, first, second);
    const closers = { first: body.stack.open(first), second: body.stack.open(second) };

    for (const which of order) closers[which]();
    assert.deepEqual(inertNames(body), [], `chiusura ${order.join(" poi ")}`);
    assert.equal(body.stack.size(), 0);
  }
});

test("un figlio tolto da body mentre lo strato è aperto esce dal calcolo e, se torna, si rende inerte di nuovo", () => {
  const page = node("pagina");
  const toast = node("avviso");
  const sheet = node("foglio");
  const body = createBody(page, toast, sheet);
  const close = body.stack.open(sheet);
  assert.equal(toast.inert, true);

  body.remove(toast);
  body.stack.sync();
  assert.equal(toast.inert, false, "un nodo uscito da body non resta inerte per sempre");
  assert.equal(page.inert, true);

  // Lo stesso nodo rimesso in body mentre lo strato è ancora aperto.
  body.add(toast);
  body.stack.sync();
  assert.equal(toast.inert, true);

  close();
  assert.equal(toast.inert, false);
  assert.equal(page.inert, false);
});

test("sync ripetuta senza cambiamenti non muta niente", () => {
  const page = node("pagina");
  const sheet = node("foglio");
  const body = createBody(page, sheet);
  body.stack.open(sheet);

  const writes = [];
  Object.defineProperty(page, "inert", {
    get: () => true,
    set: (value) => writes.push(value),
    configurable: true,
  });
  body.stack.sync();
  body.stack.sync();
  assert.deepEqual(writes, [], "ogni sync non deve riscrivere ciò che è già a posto");
});

// ---------------------------------------------------------------------------
// top(): lo strato più alto
// ---------------------------------------------------------------------------

// `top()` dice a ogni modale se è lui quello in cima: Esc chiude solo quello
// (src/hooks/useModalLayer.ts, `isTopLayer`).

test("top: senza strati aperti non c'è niente in cima", () => {
  const body = createBody(node("pagina"));
  assert.equal(body.stack.top(), null);
});

test("top: un solo strato è in cima, e chiuso non resta in cima", () => {
  const page = node("pagina");
  const sheet = node("foglio");
  const body = createBody(page, sheet);

  const close = body.stack.open(sheet);
  assert.equal(body.stack.top(), sheet);

  close();
  assert.equal(body.stack.top(), null);
});

test("top: con due strati è l'ultimo aperto, chiuso lui torna in cima il primo", () => {
  const page = node("pagina");
  const first = node("primo");
  const second = node("secondo");
  const body = createBody(page, first);

  const closeFirst = body.stack.open(first);
  assert.equal(body.stack.top(), first);

  body.add(second);
  const closeSecond = body.stack.open(second);
  assert.equal(body.stack.top(), second);
  assert.equal(body.stack.size(), 2);

  body.remove(second);
  closeSecond();
  assert.equal(body.stack.top(), first);

  body.remove(first);
  closeFirst();
  assert.equal(body.stack.top(), null);
});

test("top: se il foglio sotto si chiude per primo resta in cima quello sopra", () => {
  const page = node("pagina");
  const below = node("sotto");
  const above = node("sopra");
  const body = createBody(page, below);

  const closeBelow = body.stack.open(below);
  body.add(above);
  const closeAbove = body.stack.open(above);

  body.remove(below);
  closeBelow();
  assert.equal(body.stack.top(), above, "il foglio sotto che se ne va non toglie la cima a quello sopra");
  assert.equal(body.stack.size(), 1);

  body.remove(above);
  closeAbove();
  assert.equal(body.stack.top(), null);
});

test("top: con tre strati, chiuso quello in mezzo la cima non cambia; chiusa la cima sale il primo", () => {
  const page = node("pagina");
  const first = node("primo");
  const middle = node("mezzo");
  const last = node("ultimo");
  const body = createBody(page, first, middle, last);

  const closeFirst = body.stack.open(first);
  const closeMiddle = body.stack.open(middle);
  const closeLast = body.stack.open(last);
  assert.equal(body.stack.top(), last);

  closeMiddle();
  assert.equal(body.stack.top(), last);

  closeLast();
  assert.equal(body.stack.top(), first, "il foglio in mezzo non c'è più: sale il primo");

  closeFirst();
  assert.equal(body.stack.top(), null);
});

test("top: chiudere due volte lo stesso strato non sposta la cima", () => {
  const first = node("primo");
  const second = node("secondo");
  const body = createBody(first, second);

  const closeFirst = body.stack.open(first);
  body.stack.open(second);

  closeFirst();
  closeFirst();
  assert.equal(body.stack.top(), second);
  assert.equal(body.stack.size(), 1);
});

test("top: due strati aperti nello stesso istante, con i nodi già in body: è l'ultimo aperto", () => {
  const page = node("pagina");
  const first = node("primo");
  const second = node("secondo");
  const body = createBody(page, first, second);

  const closeFirst = body.stack.open(first);
  assert.equal(body.stack.top(), first);
  const closeSecond = body.stack.open(second);
  assert.equal(body.stack.top(), second);

  // Chiusi nello stesso istante, nell'ordine di apertura: la cima passa al primo, poi a nessuno.
  closeFirst();
  assert.equal(body.stack.top(), second);
  closeSecond();
  assert.equal(body.stack.top(), null);
});

test("top: non è un effetto, leggerla non rende inerte né attivo niente", () => {
  const page = node("pagina");
  const sheet = node("foglio");
  const body = createBody(page, sheet);
  body.stack.open(sheet);

  const writes = [];
  Object.defineProperty(page, "inert", {
    get: () => true,
    set: (value) => writes.push(value),
    configurable: true,
  });
  body.stack.top();
  body.stack.top();
  assert.deepEqual(writes, []);
});

test("top: ChildSheet sotto e conferma «Esci» sopra, due aperture e chiusure di fila", () => {
  const page = node("pagina");
  const childSheet = node("ChildSheet");
  const exitConfirm = node("conferma-esci");
  const body = createBody(page, childSheet, exitConfirm);

  for (let i = 0; i < 2; i += 1) {
    const closeChildSheet = body.stack.open(childSheet);
    const closeExitConfirm = body.stack.open(exitConfirm);
    assert.equal(body.stack.top(), exitConfirm, `giro ${i}`);

    closeExitConfirm();
    assert.equal(body.stack.top(), childSheet, `giro ${i}: la conferma chiusa, Esc torna al foglio`);
    closeChildSheet();
    assert.equal(body.stack.top(), null, `giro ${i}`);
  }
});
