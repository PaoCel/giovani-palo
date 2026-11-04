import test from "node:test";
import assert from "node:assert/strict";

import {
  getUnitActivityTabs,
  getVisibleUnitActivityTab,
  splitGroupsByMembers,
} from "../src/utils/unitActivityView.ts";

// Schede della pagina attività del dirigente di unità (task gugd-restyling,
// fase 5), src/utils/unitActivityView.ts. I flag e i fallback qui sotto sono
// quelli di src/pages/unit/UnitActivityPage.tsx: se cambi la pagina, aggiorna
// anche questo file.
//
// getUnitActivityTabs({ showOrganization, isCamp, hasUser }), regole:
// 1. Iscritti c'è sempre.
// 2. Organizzazione solo con showOrganization (nella pagina: attività caricata).
// 3. Zaino solo con isCamp E hasUser (checklist salvata per utente, solo campeggio).
// 4. L'ordine delle schede è sempre Iscritti, Organizzazione, Zaino: si filtrano
//    le tre definizioni fisse, non si riordinano.
// 5. Etichette esatte: "Iscritti", "Organizzazione", "Zaino".
//
// getVisibleUnitActivityTab(tabs, active): se la scheda scelta è ancora
// nell'elenco resta; altrimenti (zaino su un'attività che non è campeggio,
// organizzazione senza attività caricata, elenco con solo Iscritti) si torna
// a "registrations".
//
// splitGroupsByMembers(groups, memberCount): una passata, ordine conservato
// in entrambe le liste. Conteggio > 0 → withPeople, 0 → empty. L'array di
// partenza non si muta.
//
// DUBBIO: nella pagina showOrganization è Boolean(data.event) e isCamp è
// Boolean(data.event && isCampEvent(data.event)), quindi isCamp vero implica
// sempre showOrganization vero. Il modulo tratta i tre flag come indipendenti:
// { showOrganization: false, isCamp: true, hasUser: true } produce Iscritti e
// Zaino senza Organizzazione, combinazione che la pagina non può generare.

const iscritti = { id: "registrations", label: "Iscritti" };
const organizzazione = { id: "organization", label: "Organizzazione" };
const zaino = { id: "packing", label: "Zaino" };

const tabCombinations = [
  {
    input: { showOrganization: false, isCamp: false, hasUser: false },
    expected: [iscritti],
  },
  {
    input: { showOrganization: false, isCamp: false, hasUser: true },
    expected: [iscritti],
  },
  {
    input: { showOrganization: false, isCamp: true, hasUser: false },
    expected: [iscritti],
  },
  {
    input: { showOrganization: false, isCamp: true, hasUser: true },
    expected: [iscritti, zaino],
  },
  {
    input: { showOrganization: true, isCamp: false, hasUser: false },
    expected: [iscritti, organizzazione],
  },
  {
    input: { showOrganization: true, isCamp: false, hasUser: true },
    expected: [iscritti, organizzazione],
  },
  {
    input: { showOrganization: true, isCamp: true, hasUser: false },
    expected: [iscritti, organizzazione],
  },
  {
    input: { showOrganization: true, isCamp: true, hasUser: true },
    expected: [iscritti, organizzazione, zaino],
  },
];

function flagsLabel({ showOrganization, isCamp, hasUser }) {
  return `org=${showOrganization} camp=${isCamp} user=${hasUser}`;
}

function ids(tabs) {
  return tabs.map((tab) => tab.id);
}

for (const { input, expected } of tabCombinations) {
  test(`getUnitActivityTabs: ${flagsLabel(input)} → ${expected.map((tab) => tab.label).join(", ")}`, () => {
    assert.deepEqual(getUnitActivityTabs(input), expected);
  });
}

test("getUnitActivityTabs: Iscritti c'è sempre, etichetta esatta", () => {
  for (const { input } of tabCombinations) {
    const tabs = getUnitActivityTabs(input);
    assert.equal(tabs[0].id, "registrations", flagsLabel(input));
    assert.equal(tabs[0].label, "Iscritti", flagsLabel(input));
    assert.equal(tabs.filter((tab) => tab.id === "registrations").length, 1, flagsLabel(input));
  }
});

test("getUnitActivityTabs: ordine sempre Iscritti, Organizzazione, Zaino", () => {
  const canonical = ["registrations", "organization", "packing"];
  for (const { input } of tabCombinations) {
    const actual = ids(getUnitActivityTabs(input));
    assert.deepEqual(
      actual,
      canonical.filter((id) => actual.includes(id)),
      flagsLabel(input),
    );
  }
});

test("getUnitActivityTabs: Zaino solo con isCamp e hasUser", () => {
  for (const { input } of tabCombinations) {
    const hasPacking = ids(getUnitActivityTabs(input)).includes("packing");
    assert.equal(hasPacking, input.isCamp && input.hasUser, flagsLabel(input));
  }
});

test("getUnitActivityTabs: Organizzazione solo con showOrganization", () => {
  for (const { input } of tabCombinations) {
    const hasOrganization = ids(getUnitActivityTabs(input)).includes("organization");
    assert.equal(hasOrganization, input.showOrganization, flagsLabel(input));
  }
});

test("getUnitActivityTabs: etichette esatte sulle tre schede", () => {
  const tabs = getUnitActivityTabs({
    showOrganization: true,
    isCamp: true,
    hasUser: true,
  });
  assert.deepEqual(
    tabs.map((tab) => tab.label),
    ["Iscritti", "Organizzazione", "Zaino"],
  );
  assert.deepEqual(tabs, [iscritti, organizzazione, zaino]);
});

test("getVisibleUnitActivityTab: scheda presente resta", () => {
  const all = getUnitActivityTabs({
    showOrganization: true,
    isCamp: true,
    hasUser: true,
  });
  assert.equal(getVisibleUnitActivityTab(all, "registrations"), "registrations");
  assert.equal(getVisibleUnitActivityTab(all, "organization"), "organization");
  assert.equal(getVisibleUnitActivityTab(all, "packing"), "packing");

  const withoutPacking = getUnitActivityTabs({
    showOrganization: true,
    isCamp: false,
    hasUser: true,
  });
  assert.equal(getVisibleUnitActivityTab(withoutPacking, "organization"), "organization");
  assert.equal(getVisibleUnitActivityTab(withoutPacking, "registrations"), "registrations");
});

test("getVisibleUnitActivityTab: packing su attività non campeggio torna a registrations", () => {
  // Come in pagina: isCamp falso (non campeggio o attività non ancora camp),
  // Zaino assente, activeTab può restare "packing" dopo un cambio di attività.
  const tabs = getUnitActivityTabs({
    showOrganization: true,
    isCamp: false,
    hasUser: true,
  });
  assert.deepEqual(ids(tabs), ["registrations", "organization"]);
  assert.equal(getVisibleUnitActivityTab(tabs, "packing"), "registrations");
});

test("getVisibleUnitActivityTab: organization senza attività caricata torna a registrations", () => {
  // Come in pagina: showOrganization = Boolean(data.event), false finché
  // l'attività non è arrivata. Resta solo Iscritti.
  const tabs = getUnitActivityTabs({
    showOrganization: false,
    isCamp: false,
    hasUser: true,
  });
  assert.deepEqual(ids(tabs), ["registrations"]);
  assert.equal(getVisibleUnitActivityTab(tabs, "organization"), "registrations");
});

test("getVisibleUnitActivityTab: elenco con solo Iscritti", () => {
  const tabs = getUnitActivityTabs({
    showOrganization: false,
    isCamp: false,
    hasUser: false,
  });
  assert.deepEqual(tabs, [iscritti]);
  assert.equal(getVisibleUnitActivityTab(tabs, "registrations"), "registrations");
  assert.equal(getVisibleUnitActivityTab(tabs, "organization"), "registrations");
  assert.equal(getVisibleUnitActivityTab(tabs, "packing"), "registrations");
});

test("splitGroupsByMembers: ordine conservato in entrambe le liste", () => {
  const groups = [
    { name: "vuoto-1", n: 0 },
    { name: "pieni-1", n: 3 },
    { name: "vuoto-2", n: 0 },
    { name: "pieni-2", n: 1 },
    { name: "vuoto-3", n: 0 },
    { name: "pieni-3", n: 7 },
  ];
  const { withPeople, empty } = splitGroupsByMembers(groups, (group) => group.n);
  assert.deepEqual(
    withPeople.map((group) => group.name),
    ["pieni-1", "pieni-2", "pieni-3"],
  );
  assert.deepEqual(
    empty.map((group) => group.name),
    ["vuoto-1", "vuoto-2", "vuoto-3"],
  );
  assert.equal(withPeople[0], groups[1]);
  assert.equal(withPeople[1], groups[3]);
  assert.equal(withPeople[2], groups[5]);
  assert.equal(empty[0], groups[0]);
  assert.equal(empty[1], groups[2]);
  assert.equal(empty[2], groups[4]);
});

test("splitGroupsByMembers: conteggio 0 va in empty, maggiore di 0 in withPeople", () => {
  const zero = { name: "zero", n: 0 };
  const one = { name: "uno", n: 1 };
  const many = { name: "tanti", n: 12 };
  const { withPeople, empty } = splitGroupsByMembers(
    [zero, one, many],
    (group) => group.n,
  );
  assert.deepEqual(empty, [zero]);
  assert.deepEqual(withPeople, [one, many]);
});

test("splitGroupsByMembers: lista vuota", () => {
  const { withPeople, empty } = splitGroupsByMembers([], () => {
    assert.fail("memberCount non va chiamato sulla lista vuota");
  });
  assert.deepEqual(withPeople, []);
  assert.deepEqual(empty, []);
});

test("splitGroupsByMembers: funzione di conteggio chiamata una volta per gruppo", () => {
  const groups = [{ id: "a", n: 2 }, { id: "b", n: 0 }, { id: "c", n: 4 }];
  const seen = [];
  const { withPeople, empty } = splitGroupsByMembers(groups, (group) => {
    seen.push(group);
    return group.n;
  });
  assert.equal(seen.length, groups.length);
  assert.deepEqual(seen, groups);
  assert.deepEqual(
    withPeople.map((group) => group.id),
    ["a", "c"],
  );
  assert.deepEqual(
    empty.map((group) => group.id),
    ["b"],
  );
});

test("splitGroupsByMembers: nessuna mutazione dell'array di partenza", () => {
  const groups = [
    { name: "alpha", n: 0 },
    { name: "beta", n: 2 },
    { name: "gamma", n: 0 },
  ];
  const snapshot = groups.map((group) => ({ ...group }));
  Object.freeze(groups);
  for (const group of groups) {
    Object.freeze(group);
  }
  const { withPeople, empty } = splitGroupsByMembers(groups, (group) => group.n);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].name, "alpha");
  assert.equal(groups[1].name, "beta");
  assert.equal(groups[2].name, "gamma");
  assert.deepEqual(
    groups.map((group) => ({ ...group })),
    snapshot,
  );
  assert.notEqual(withPeople, groups);
  assert.notEqual(empty, groups);
  withPeople.push({ name: "extra", n: 9 });
  empty.push({ name: "extra-vuoto", n: 0 });
  assert.deepEqual(
    groups.map((group) => group.name),
    ["alpha", "beta", "gamma"],
  );
});
