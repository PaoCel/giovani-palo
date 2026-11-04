import test from "node:test";
import assert from "node:assert/strict";

import {
  getAdminEventTabFromPath,
  getAdminEventTabHref,
  getAdminEventTabs,
} from "../src/utils/adminEventTabs.ts";

// Schede della scheda attività admin (src/utils/adminEventTabs.ts), estratte
// da AdminEventDetailPage nel restyling. Le rotte qui sotto sono i figli
// events/:eventId di /admin in src/routes/router.tsx, nello stesso ordine.
// Il comportamento è quello della pagina su HEAD: stessi suffissi, stessi
// deep link, stessa barra.
//
// getAdminEventTabFromPath(pathname, search):
// 1. Decide il suffisso del pathname. comitati vale come committees, sondaggi
//    come surveys, rooms apre la scheda overnight.
// 2. ?tab=program sulla rotta di base apre program. È letto prima di records.
// 3. ?tab=records sulla rotta di base, oppure un pathname che finisce con
//    /records, apre records. /records non è fra le rotte registrate: è
//    riconosciuto se la rotta viene aggiunta.
// 4. Il resto, compresa la rotta di base, apre details.
//
// Casi particolari:
// - form-builder non ha un ramo: la rotta è registrata e cade su details.
// - galleria è l'alias di gallery come comitati e sondaggi. Fino al restyling
//   (fase 6c) apriva details, perché il controllo era solo endsWith("/gallery").
//   Il link della scheda Galleria resta /gallery.
//
// getAdminEventTabHref ricostruisce il deep link. Per ogni scheda, rileggere
// pathname e search di quel link deve restituire la stessa scheda.
// Un eventId con trattino e underscore (abc-123_X) non sposta la scheda:
// entra nel percorso così com'è, senza codifica.
//
// getAdminEventTabs: ordine fisso della barra. program solo per l'admin,
// overnight solo se il pernottamento c'è e con l'etichetta ricevuta (Stanze
// o Tende, decise dal chiamante), questions e records solo se abilitati.
// Le altre sette ci sono sempre. Id univoci, etichette non vuote.

const PLAIN_ID = "evt";
const ODD_ID = "abc-123_X";
const EVENT_IDS = [PLAIN_ID, ODD_ID];

// [suffisso, scheda aperta oggi]. Ordine del router.
const REGISTERED_ROUTES = [
  ["", "details"],
  // Nessuna scheda form-builder: la rotta registrata apre details.
  ["/form-builder", "details"],
  ["/committees", "committees"],
  ["/comitati", "committees"],
  ["/registrations", "registrations"],
  ["/consents", "consents"],
  ["/rooms", "overnight"],
  ["/questions", "questions"],
  ["/stats", "stats"],
  ["/surveys", "surveys"],
  ["/sondaggi", "surveys"],
  ["/gallery", "gallery"],
  // /galleria è l'alias di /gallery (fino al restyling apriva details).
  ["/galleria", "gallery"],
];

const HREF_BY_TAB = {
  details: (eventId) => `/admin/events/${eventId}`,
  program: (eventId) => `/admin/events/${eventId}?tab=program`,
  committees: (eventId) => `/admin/events/${eventId}/comitati`,
  registrations: (eventId) => `/admin/events/${eventId}/registrations`,
  consents: (eventId) => `/admin/events/${eventId}/consents`,
  overnight: (eventId) => `/admin/events/${eventId}/rooms`,
  questions: (eventId) => `/admin/events/${eventId}/questions`,
  records: (eventId) => `/admin/events/${eventId}?tab=records`,
  surveys: (eventId) => `/admin/events/${eventId}/surveys`,
  gallery: (eventId) => `/admin/events/${eventId}/gallery`,
  stats: (eventId) => `/admin/events/${eventId}/stats`,
};

const TAB_ORDER = [
  "details",
  "program",
  "committees",
  "registrations",
  "consents",
  "overnight",
  "questions",
  "records",
  "surveys",
  "gallery",
  "stats",
];

const FIXED_LABELS = {
  details: "Dettagli",
  program: "Programma",
  committees: "Comitati",
  registrations: "Iscritti",
  consents: "Consensi",
  questions: "Domande",
  records: "Record",
  surveys: "Sondaggi",
  gallery: "Galleria",
  stats: "Statistiche",
};

const ALWAYS_PRESENT = [
  "details",
  "committees",
  "registrations",
  "consents",
  "surveys",
  "gallery",
  "stats",
];

function splitHref(href) {
  const queryAt = href.indexOf("?");
  if (queryAt === -1) {
    return { pathname: href, search: "" };
  }
  return { pathname: href.slice(0, queryAt), search: href.slice(queryAt) };
}

function expectedIds({ isAdmin, overnight, questionsEnabled, recordsEnabled }) {
  return TAB_ORDER.filter((id) => {
    if (id === "program") return isAdmin;
    if (id === "overnight") return overnight;
    if (id === "questions") return questionsEnabled;
    if (id === "records") return recordsEnabled;
    return true;
  });
}

for (const [suffix, tab] of REGISTERED_ROUTES) {
  const pathLabel = suffix === "" ? " (base)" : suffix;
  test(`rotta registrata events/:eventId${pathLabel} apre ${tab}`, () => {
    for (const eventId of EVENT_IDS) {
      const pathname = `/admin/events/${eventId}${suffix}`;
      assert.equal(getAdminEventTabFromPath(pathname), tab, pathname);
      assert.equal(getAdminEventTabFromPath(pathname, ""), tab, pathname);
    }
  });
}

test("?tab=program sulla rotta di base apre program", () => {
  for (const eventId of EVENT_IDS) {
    const pathname = `/admin/events/${eventId}`;
    assert.equal(getAdminEventTabFromPath(pathname, "?tab=program"), "program");
    assert.equal(getAdminEventTabFromPath(pathname, "?altro=1&tab=program"), "program");
  }
});

test("?tab=records sulla rotta di base apre records", () => {
  for (const eventId of EVENT_IDS) {
    const pathname = `/admin/events/${eventId}`;
    assert.equal(getAdminEventTabFromPath(pathname, "?tab=records"), "records");
    assert.equal(getAdminEventTabFromPath(pathname, "?altro=1&tab=records"), "records");
  }
});

test("/records apre records, anche se la rotta non è registrata", () => {
  for (const eventId of EVENT_IDS) {
    const pathname = `/admin/events/${eventId}/records`;
    assert.equal(getAdminEventTabFromPath(pathname), "records", pathname);
    assert.equal(getAdminEventTabFromPath(pathname, ""), "records", pathname);
  }
});

test("un suffisso di rotta vince su ?tab= nella query", () => {
  assert.equal(
    getAdminEventTabFromPath(`/admin/events/${ODD_ID}/rooms`, "?tab=program"),
    "overnight",
  );
  assert.equal(
    getAdminEventTabFromPath(`/admin/events/${ODD_ID}/rooms`, "?tab=records"),
    "overnight",
  );
  assert.equal(
    getAdminEventTabFromPath(`/admin/events/${ODD_ID}/gallery`, "?tab=records"),
    "gallery",
  );
});

test("?tab=program è letto prima del suffisso /records", () => {
  assert.equal(
    getAdminEventTabFromPath(`/admin/events/${ODD_ID}/records`, "?tab=program"),
    "program",
  );
});

test("query tab sconosciuta o assente: la rotta di base resta su details", () => {
  assert.equal(getAdminEventTabFromPath(`/admin/events/${ODD_ID}`), "details");
  assert.equal(getAdminEventTabFromPath(`/admin/events/${ODD_ID}`, "?tab=gallery"), "details");
  assert.equal(getAdminEventTabFromPath(`/admin/events/${ODD_ID}`, "?tab="), "details");
});

for (const tab of Object.keys(HREF_BY_TAB)) {
  test(`andata e ritorno: ${tab}`, () => {
    for (const eventId of EVENT_IDS) {
      const href = getAdminEventTabHref(eventId, tab);
      assert.equal(href, HREF_BY_TAB[tab](eventId));
      const { pathname, search } = splitHref(href);
      assert.equal(getAdminEventTabFromPath(pathname, search), tab, href);
      assert.equal(pathname.includes(`/${eventId}`), true, href);
    }
  });
}

test("abc-123_X non cambia la scheda rispetto a un id semplice", () => {
  for (const [suffix, tab] of REGISTERED_ROUTES) {
    const plain = getAdminEventTabFromPath(`/admin/events/${PLAIN_ID}${suffix}`);
    const odd = getAdminEventTabFromPath(`/admin/events/${ODD_ID}${suffix}`);
    assert.equal(plain, tab, suffix || "(base)");
    assert.equal(odd, plain, suffix || "(base)");
  }

  for (const tab of Object.keys(HREF_BY_TAB)) {
    const plainHref = getAdminEventTabHref(PLAIN_ID, tab);
    const oddHref = getAdminEventTabHref(ODD_ID, tab);
    assert.equal(oddHref, plainHref.replaceAll(PLAIN_ID, ODD_ID));
    const plain = splitHref(plainHref);
    const odd = splitHref(oddHref);
    assert.equal(getAdminEventTabFromPath(plain.pathname, plain.search), tab);
    assert.equal(getAdminEventTabFromPath(odd.pathname, odd.search), tab);
    assert.equal(odd.pathname.includes(ODD_ID), true, oddHref);
    assert.equal(oddHref.includes("%"), false, oddHref);
  }
});

test("senza condizioni: solo le sette schede sempre presenti, in ordine", () => {
  assert.deepEqual(
    getAdminEventTabs({
      isAdmin: false,
      overnight: false,
      overnightLabel: "Tende",
      questionsEnabled: false,
      recordsEnabled: false,
    }),
    [
      { id: "details", label: "Dettagli" },
      { id: "committees", label: "Comitati" },
      { id: "registrations", label: "Iscritti" },
      { id: "consents", label: "Consensi" },
      { id: "surveys", label: "Sondaggi" },
      { id: "gallery", label: "Galleria" },
      { id: "stats", label: "Statistiche" },
    ],
  );
});

test("tutte le condizioni accese: ordine completo, etichetta Tende", () => {
  assert.deepEqual(
    getAdminEventTabs({
      isAdmin: true,
      overnight: true,
      overnightLabel: "Tende",
      questionsEnabled: true,
      recordsEnabled: true,
    }),
    [
      { id: "details", label: "Dettagli" },
      { id: "program", label: "Programma" },
      { id: "committees", label: "Comitati" },
      { id: "registrations", label: "Iscritti" },
      { id: "consents", label: "Consensi" },
      { id: "overnight", label: "Tende" },
      { id: "questions", label: "Domande" },
      { id: "records", label: "Record" },
      { id: "surveys", label: "Sondaggi" },
      { id: "gallery", label: "Galleria" },
      { id: "stats", label: "Statistiche" },
    ],
  );
});

test("senza admin le altre schede restano attaccate, etichetta Stanze", () => {
  assert.deepEqual(
    getAdminEventTabs({
      isAdmin: false,
      overnight: true,
      overnightLabel: "Stanze",
      questionsEnabled: true,
      recordsEnabled: true,
    }),
    [
      { id: "details", label: "Dettagli" },
      { id: "committees", label: "Comitati" },
      { id: "registrations", label: "Iscritti" },
      { id: "consents", label: "Consensi" },
      { id: "overnight", label: "Stanze" },
      { id: "questions", label: "Domande" },
      { id: "records", label: "Record" },
      { id: "surveys", label: "Sondaggi" },
      { id: "gallery", label: "Galleria" },
      { id: "stats", label: "Statistiche" },
    ],
  );
});

test("ogni combinazione: ordine fisso, condizioni, id unici, etichette non vuote", () => {
  for (const isAdmin of [false, true]) {
    for (const overnight of [false, true]) {
      for (const questionsEnabled of [false, true]) {
        for (const recordsEnabled of [false, true]) {
          for (const overnightLabel of ["Stanze", "Tende"]) {
            const options = {
              isAdmin,
              overnight,
              overnightLabel,
              questionsEnabled,
              recordsEnabled,
            };
            const list = getAdminEventTabs(options);
            const ids = list.map((tab) => tab.id);
            const where = JSON.stringify(options);

            assert.deepEqual(ids, expectedIds(options), where);
            assert.equal(new Set(ids).size, ids.length, where);

            for (const id of ALWAYS_PRESENT) {
              assert.equal(ids.includes(id), true, `${id} ${where}`);
            }
            assert.equal(ids.includes("program"), isAdmin, where);
            assert.equal(ids.includes("overnight"), overnight, where);
            assert.equal(ids.includes("questions"), questionsEnabled, where);
            assert.equal(ids.includes("records"), recordsEnabled, where);

            for (const tab of list) {
              assert.equal(typeof tab.label, "string", tab.id);
              assert.ok(tab.label.trim().length > 0, `${tab.id} ${where}`);
              if (tab.id === "overnight") {
                assert.equal(tab.label, overnightLabel, where);
              } else {
                assert.equal(tab.label, FIXED_LABELS[tab.id], `${tab.id} ${where}`);
              }
            }

            if (!overnight) {
              assert.equal(
                list.some((tab) => tab.label === overnightLabel),
                false,
                where,
              );
            }
          }
        }
      }
    }
  }
});
