import test from "node:test";
import assert from "node:assert/strict";

import { ADMIN_ELENCHI } from "../src/copy/adminElenchi.ts";
import { fillCopy } from "../src/copy/parole.ts";
import {
  getMonthAriaLabel,
  isPastAdminEvent,
  splitAdminEvents,
} from "../src/utils/adminLists.ts";

// Elenchi admin (fase 6b): quali attività finiscono tra le «Concluse» di
// /admin/events, in che ordine, e il nome del mese letto dagli screen reader.
// src/utils/adminLists.ts, frasi in src/copy/adminElenchi.ts.
//
// isPastAdminEvent, in quest'ordine:
// 1. status "cancelled" o "completed" => passata, anche con date future e
//    anche quando la data di fine non si legge.
// 2. altrimenti passata solo se endDate è un istante strettamente precedente
//    a now. L'istante di fine uguale a now è ancora in corso.
// 3. endDate vuota, assente o non interpretabile => non passata. Lo status
//    "draft" non ha un'eccezione: una bozza futura resta tra le prossime,
//    una bozza con fine già passata va tra le concluse.
//
// splitAdminEvents costruisce due array nuovi e ordina quelli:
// - upcoming per startDate crescente, la più vicina in alto;
// - past per startDate decrescente, la più recente in alto.
// L'array in ingresso resta nell'ordine di partenza; gli oggetti sono gli
// stessi riferimenti. Una startDate non valida vale 0: prima fra le prossime,
// ultima fra le concluse. A parità di istante l'ordine di ingresso resta.
//
// getMonthAriaLabel legge ADMIN_ELENCHI e lo riempie con fillCopy:
// 0 => «{mese}, nessuna attività»; 1 => «{mese}, 1 attività»;
// da 2 in su => «{mese}, {n} attività». Il test confronta il risultato sia
// con la frase scritta per esteso sia con fillCopy sul testo del catalogo.
//
// Le date si costruiscono con `new Date(anno, mese, giorno, ora)` locali e
// si passano come ISO. `now` è sempre un argomento: niente Date.now().
//
// Comando: node --test tests/adminLists.test.mjs

const local = (year, month, day, hour = 12, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).getTime();
const iso = (time) => new Date(time).toISOString();

// 4 novembre 2026, mezzogiorno. Stesso istante dei test sullo stato pubblico.
const NOW = local(2026, 11, 4);

const STATI_APERTI = ["draft", "planned", "confirmed", "registrations_open", "registrations_closed"];

/** Attività ancora da fare: inizia il 5 dicembre 2026, iscrizioni aperte. */
const activity = (id, overrides = {}) => ({
  id,
  status: "registrations_open",
  startDate: iso(local(2026, 12, 5, 9)),
  endDate: iso(local(2026, 12, 6, 18)),
  ...overrides,
});

const ids = (events) => events.map((event) => event.id);

test("isPastAdminEvent: annullata o conclusa anche con date future", () => {
  const futura = {
    startDate: iso(local(2026, 12, 20, 9)),
    endDate: iso(local(2026, 12, 21, 18)),
  };
  assert.equal(isPastAdminEvent({ ...futura, status: "cancelled" }, NOW), true);
  assert.equal(isPastAdminEvent({ ...futura, status: "completed" }, NOW), true);
  // Lo status chiude la pratica prima ancora di leggere la fine.
  assert.equal(
    isPastAdminEvent({ status: "cancelled", startDate: futura.startDate, endDate: "" }, NOW),
    true,
  );
  assert.equal(
    isPastAdminEvent({ status: "completed", startDate: futura.startDate, endDate: "non-è-una-data" }, NOW),
    true,
  );
});

test("isPastAdminEvent: la fine precedente a now basta, per gli altri status", () => {
  const finita = {
    startDate: iso(local(2026, 10, 10, 9)),
    endDate: iso(local(2026, 10, 12, 18)),
  };
  const ancoraAperta = {
    startDate: iso(local(2026, 12, 5, 9)),
    endDate: iso(local(2026, 12, 6, 18)),
  };
  for (const status of STATI_APERTI) {
    assert.equal(isPastAdminEvent({ ...finita, status }, NOW), true, status);
    assert.equal(isPastAdminEvent({ ...ancoraAperta, status }, NOW), false, status);
  }
});

test("isPastAdminEvent: l'istante di fine è ancora in corso", () => {
  const base = { status: "confirmed", startDate: iso(local(2026, 11, 4, 9)) };
  assert.equal(isPastAdminEvent({ ...base, endDate: iso(NOW) }, NOW), false);
  assert.equal(isPastAdminEvent({ ...base, endDate: iso(NOW + 1) }, NOW), false);
  assert.equal(isPastAdminEvent({ ...base, endDate: iso(NOW - 1) }, NOW), true);
});

test("isPastAdminEvent: data di fine illeggibile non è passata", () => {
  // Una stringa vuota o illeggibile dà NaN: l'attività non scade da sola.
  // Vale anche se l'inizio è già nel passato.
  const startDate = iso(local(2026, 10, 1, 9));
  for (const endDate of ["", "non-è-una-data", "   "]) {
    assert.equal(
      isPastAdminEvent({ status: "planned", startDate, endDate }, NOW),
      false,
      JSON.stringify(endDate),
    );
  }
  assert.equal(isPastAdminEvent({ status: "planned", startDate }, NOW), false);
});

test("isPastAdminEvent: endDate null non fa scadere l'attività", () => {
  // new Date(null) sarebbe l'istante 0 (1 gennaio 1970): un documento vecchio
  // senza data di fine finiva tra le concluse. Ora vale come data mancante.
  assert.equal(
    isPastAdminEvent(
      { status: "planned", startDate: iso(local(2026, 12, 1, 9)), endDate: null },
      NOW,
    ),
    false,
  );
});

test("splitAdminEvents non muta l'array in ingresso", () => {
  const ottobre = activity("ottobre", {
    startDate: iso(local(2026, 10, 10, 9)),
    endDate: iso(local(2026, 10, 11, 18)),
  });
  const dicembre = activity("dicembre", {
    startDate: iso(local(2026, 12, 1, 9)),
    endDate: iso(local(2026, 12, 2, 18)),
  });
  const annullata = activity("annullata", {
    status: "cancelled",
    startDate: iso(local(2026, 12, 20, 9)),
    endDate: iso(local(2026, 12, 21, 18)),
  });
  const input = [ottobre, dicembre, annullata];
  const ordine = input.slice();
  const campi = input.map((event) => ({ ...event }));

  const { upcoming, past } = splitAdminEvents(input, NOW);

  assert.equal(input.length, 3);
  assert.equal(input[0], ottobre);
  assert.equal(input[1], dicembre);
  assert.equal(input[2], annullata);
  assert.deepEqual(input, ordine);
  assert.deepEqual(
    input.map(({ id, status, startDate, endDate }) => ({ id, status, startDate, endDate })),
    campi,
  );
  // Le due liste sono array nuovi; gli oggetti restano quelli di partenza.
  assert.notEqual(upcoming, input);
  assert.notEqual(past, input);
  assert.equal(upcoming[0], dicembre);
  assert.equal(past[0], annullata);
  assert.equal(past[1], ottobre);
  assert.deepEqual(ids(upcoming), ["dicembre"]);
  assert.deepEqual(ids(past), ["annullata", "ottobre"]);
});

test("splitAdminEvents: prossime per inizio crescente, concluse per inizio decrescente", () => {
  const inCorso = activity("in-corso", {
    status: "confirmed",
    startDate: iso(local(2026, 11, 1, 9)),
    endDate: iso(local(2026, 11, 8, 18)),
  });
  const bozza = activity("bozza", {
    status: "draft",
    startDate: iso(local(2026, 11, 20, 10)),
    endDate: iso(local(2026, 11, 21, 18)),
  });
  const lontana = activity("lontana", {
    status: "planned",
    startDate: iso(local(2026, 12, 15, 9)),
    endDate: iso(local(2026, 12, 16, 18)),
  });
  const annullata = activity("annullata", {
    status: "cancelled",
    startDate: iso(local(2026, 12, 20, 9)),
    endDate: iso(local(2026, 12, 21, 18)),
  });
  const conclusa = activity("conclusa", {
    status: "completed",
    startDate: iso(local(2026, 11, 18, 9)),
    endDate: iso(local(2026, 11, 19, 18)),
  });
  const ottobre = activity("ottobre", {
    startDate: iso(local(2026, 10, 10, 9)),
    endDate: iso(local(2026, 10, 11, 18)),
  });

  const input = [ottobre, lontana, annullata, inCorso, conclusa, bozza];
  const { upcoming, past } = splitAdminEvents(input, NOW);

  // In corso (1 nov), bozza futura (20 nov), poi dicembre. Le due con date
  // future ma status chiuso stanno tra le concluse, la più recente in alto.
  assert.deepEqual(ids(upcoming), ["in-corso", "bozza", "lontana"]);
  assert.deepEqual(ids(past), ["annullata", "conclusa", "ottobre"]);
  assert.equal(upcoming.length + past.length, input.length);
  assert.deepEqual(ids(input), ["ottobre", "lontana", "annullata", "in-corso", "conclusa", "bozza"]);
});

test("splitAdminEvents: la bozza futura resta fra le prossime, quella finita fra le concluse", () => {
  const futura = activity("bozza-futura", {
    status: "draft",
    startDate: iso(local(2026, 12, 1, 9)),
    endDate: iso(local(2026, 12, 2, 18)),
  });
  const finita = activity("bozza-finita", {
    status: "draft",
    startDate: iso(local(2026, 10, 1, 9)),
    endDate: iso(local(2026, 10, 2, 18)),
  });
  const { upcoming, past } = splitAdminEvents([finita, futura], NOW);
  assert.deepEqual(ids(upcoming), ["bozza-futura"]);
  assert.deepEqual(ids(past), ["bozza-finita"]);
});

test("splitAdminEvents: chi finisce nell'istante di now resta fra le prossime", () => {
  const sulFilo = activity("sul-filo", {
    startDate: iso(local(2026, 11, 4, 9)),
    endDate: iso(NOW),
  });
  const { upcoming, past } = splitAdminEvents([sulFilo], NOW);
  assert.deepEqual(ids(upcoming), ["sul-filo"]);
  assert.deepEqual(past, []);
});

test("splitAdminEvents: tre attività nello stesso giorno restano in ordine di orario", () => {
  const sera = activity("sera", {
    startDate: iso(local(2026, 11, 15, 18, 30)),
    endDate: iso(local(2026, 11, 15, 21)),
  });
  const mattina = activity("mattina", {
    startDate: iso(local(2026, 11, 15, 9)),
    endDate: iso(local(2026, 11, 15, 12)),
  });
  const pomeriggio = activity("pomeriggio", {
    startDate: iso(local(2026, 11, 15, 14)),
    endDate: iso(local(2026, 11, 15, 17)),
  });
  const prossime = splitAdminEvents([sera, mattina, pomeriggio], NOW);
  assert.deepEqual(ids(prossime.upcoming), ["mattina", "pomeriggio", "sera"]);
  assert.deepEqual(prossime.past, []);

  // Stesso giorno già finito: tra le concluse l'orario più tardo sta in alto.
  const seraPassata = activity("sera-passata", {
    startDate: iso(local(2026, 10, 10, 18, 30)),
    endDate: iso(local(2026, 10, 10, 21)),
  });
  const mattinaPassata = activity("mattina-passata", {
    startDate: iso(local(2026, 10, 10, 9)),
    endDate: iso(local(2026, 10, 10, 12)),
  });
  const pomeriggioPassato = activity("pomeriggio-passato", {
    startDate: iso(local(2026, 10, 10, 14)),
    endDate: iso(local(2026, 10, 10, 17)),
  });
  const concluse = splitAdminEvents([mattinaPassata, seraPassata, pomeriggioPassato], NOW);
  assert.deepEqual(ids(concluse.past), ["sera-passata", "pomeriggio-passato", "mattina-passata"]);
  assert.deepEqual(concluse.upcoming, []);
});

test("splitAdminEvents: a parità di inizio conserva l'ordine di ingresso", () => {
  const stessoInizio = iso(local(2026, 11, 15, 10));
  const stessaFine = iso(local(2026, 11, 15, 12));
  const seconda = activity("seconda", { startDate: stessoInizio, endDate: stessaFine });
  const terza = activity("terza", { startDate: stessoInizio, endDate: stessaFine });
  const prima = activity("prima", { startDate: stessoInizio, endDate: stessaFine });
  const { upcoming, past } = splitAdminEvents([seconda, terza, prima], NOW);
  assert.deepEqual(ids(upcoming), ["seconda", "terza", "prima"]);
  assert.deepEqual(past, []);

  const inizioPassato = iso(local(2026, 10, 2, 10));
  const finePassata = iso(local(2026, 10, 2, 12));
  const a = activity("a", { startDate: inizioPassato, endDate: finePassata });
  const b = activity("b", { startDate: inizioPassato, endDate: finePassata });
  const finite = splitAdminEvents([a, b], NOW);
  assert.deepEqual(ids(finite.past), ["a", "b"]);
  assert.deepEqual(finite.upcoming, []);
});

test("splitAdminEvents: startDate non valida vale 0", () => {
  // 0 è il minimo: fra le prossime sta in cima. Due date illeggibili
  // restano nell'ordine in cui erano in ingresso.
  const rotta = activity("rotta", {
    startDate: "non-è-una-data",
    endDate: iso(local(2026, 12, 2, 18)),
  });
  const vuota = activity("vuota", {
    startDate: "",
    endDate: iso(local(2026, 12, 3, 18)),
  });
  const novembre = activity("novembre", {
    startDate: iso(local(2026, 11, 20, 9)),
    endDate: iso(local(2026, 11, 21, 18)),
  });
  const dicembre = activity("dicembre", {
    startDate: iso(local(2026, 12, 10, 9)),
    endDate: iso(local(2026, 12, 11, 18)),
  });
  const prossime = splitAdminEvents([dicembre, rotta, novembre, vuota], NOW);
  assert.deepEqual(ids(prossime.upcoming), ["rotta", "vuota", "novembre", "dicembre"]);
  assert.deepEqual(prossime.past, []);

  // Fra le concluse l'ordine è decrescente: 0 è il più antico e finisce in fondo.
  const rottaConclusa = activity("rotta-conclusa", {
    status: "cancelled",
    startDate: "non-è-una-data",
    endDate: iso(local(2026, 12, 2, 18)),
  });
  const ottobre = activity("ottobre", {
    status: "completed",
    startDate: iso(local(2026, 10, 1, 9)),
    endDate: iso(local(2026, 10, 2, 18)),
  });
  const recente = activity("recente", {
    status: "completed",
    startDate: iso(local(2026, 11, 1, 9)),
    endDate: iso(local(2026, 11, 2, 18)),
  });
  const concluse = splitAdminEvents([ottobre, rottaConclusa, recente], NOW);
  assert.deepEqual(ids(concluse.past), ["recente", "ottobre", "rotta-conclusa"]);
  assert.deepEqual(concluse.upcoming, []);
});

test("splitAdminEvents: startDate null ordina come il 1970, insieme alle date illeggibili", () => {
  // new Date(null) è 0, lo stesso ripiego di una startDate illeggibile.
  const inizioNullo = activity("inizio-nullo", {
    startDate: null,
    endDate: iso(local(2026, 12, 20, 18)),
  });
  const dopo = activity("dopo", {
    startDate: iso(local(2026, 11, 20, 9)),
    endDate: iso(local(2026, 11, 21, 18)),
  });
  const { upcoming } = splitAdminEvents([dopo, inizioNullo], NOW);
  assert.deepEqual(ids(upcoming), ["inizio-nullo", "dopo"]);
});

test("splitAdminEvents: elenco vuoto", () => {
  assert.deepEqual(splitAdminEvents([], NOW), { upcoming: [], past: [] });
});

test("getMonthAriaLabel: nessuna, una e tre attività", () => {
  assert.equal(ADMIN_ELENCHI.meseSenzaAttivita, "{mese}, nessuna attività");
  assert.equal(ADMIN_ELENCHI.meseConUnaAttivita, "{mese}, 1 attività");
  assert.equal(ADMIN_ELENCHI.meseConAttivita, "{mese}, {n} attività");

  assert.equal(getMonthAriaLabel("Novembre", 0), "Novembre, nessuna attività");
  assert.equal(
    getMonthAriaLabel("Novembre", 0),
    fillCopy(ADMIN_ELENCHI.meseSenzaAttivita, { mese: "Novembre" }),
  );

  assert.equal(getMonthAriaLabel("Novembre", 1), "Novembre, 1 attività");
  assert.equal(
    getMonthAriaLabel("Novembre", 1),
    fillCopy(ADMIN_ELENCHI.meseConUnaAttivita, { mese: "Novembre" }),
  );

  assert.equal(getMonthAriaLabel("Novembre", 3), "Novembre, 3 attività");
  assert.equal(
    getMonthAriaLabel("Novembre", 3),
    fillCopy(ADMIN_ELENCHI.meseConAttivita, { mese: "Novembre", n: "3" }),
  );
});

test("getMonthAriaLabel: dal due in su il numero entra nella frase al plurale", () => {
  assert.equal(getMonthAriaLabel("Novembre", 2), "Novembre, 2 attività");
  assert.equal(
    getMonthAriaLabel("Novembre", 2),
    fillCopy(ADMIN_ELENCHI.meseConAttivita, { mese: "Novembre", n: "2" }),
  );
  assert.equal(getMonthAriaLabel("Marzo", 12), "Marzo, 12 attività");
  assert.equal(getMonthAriaLabel("Marzo", 0), "Marzo, nessuna attività");
  assert.equal(getMonthAriaLabel("Marzo", 1), "Marzo, 1 attività");
});
