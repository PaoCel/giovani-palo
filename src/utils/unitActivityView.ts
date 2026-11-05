// Scheda attività del dirigente di unità (task gugd-restyling, fase 5): quali
// schede si vedono e come si dividono comitati e gruppi tra quelli con persone
// e quelli vuoti (questi ultimi in una riga di chip, non una card a testa).
//
// Questo file lo carica anche Node (tests/): niente alias "@/" sui valori.

export type UnitActivityTab = "registrations" | "organization" | "packing";

export interface UnitActivityTabDefinition {
  id: UnitActivityTab;
  label: string;
}

const TABS: UnitActivityTabDefinition[] = [
  { id: "registrations", label: "Iscritti" },
  { id: "organization", label: "Organizzazione" },
  { id: "packing", label: "Zaino" },
];

/**
 * Iscritti c'è sempre; Organizzazione quando l'attività è caricata (comitati e
 * gruppi valgono per ogni tipo, così «Gestisci» resta raggiungibile); Zaino
 * solo sul campeggio e con un account iscritto all'attività (la checklist si
 * salva per utente e le rules la aprono solo a chi ha un'iscrizione propria):
 * `hasUser` lo passa la pagina già combinato con l'iscrizione.
 */
export function getUnitActivityTabs(input: {
  showOrganization: boolean;
  isCamp: boolean;
  hasUser: boolean;
}): UnitActivityTabDefinition[] {
  return TABS.filter(
    (tab) =>
      tab.id === "registrations" ||
      (tab.id === "organization" && input.showOrganization) ||
      (tab.id === "packing" && input.isCamp && input.hasUser),
  );
}

/**
 * La scheda scelta se c'è ancora; altrimenti (attività senza zaino, dati non
 * ancora arrivati, cambio di attività) si torna agli iscritti.
 */
export function getVisibleUnitActivityTab(
  tabs: UnitActivityTabDefinition[],
  active: UnitActivityTab,
): UnitActivityTab {
  return tabs.some((tab) => tab.id === active) ? active : "registrations";
}

/** Divide i gruppi tenendo l'ordine: prima conta, poi si mostrano. */
export function splitGroupsByMembers<T>(
  groups: T[],
  memberCount: (group: T) => number,
): { withPeople: T[]; empty: T[] } {
  const withPeople: T[] = [];
  const empty: T[] = [];
  for (const group of groups) {
    (memberCount(group) > 0 ? withPeople : empty).push(group);
  }
  return { withPeople, empty };
}
