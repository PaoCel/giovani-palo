import test from "node:test";
import assert from "node:assert/strict";

import { getInitials, isNavLinkActive } from "../src/utils/shellNavigation.ts";

// Navigazione della testata comune (task gugd-restyling, fase 4),
// src/utils/shellNavigation.ts: voce attiva delle barre e iniziali
// dell'avatar. I link qui sotto sono copiati da src/layouts/AdminLayout.tsx e
// src/layouts/UserLayout.tsx: se cambi uno dei due, aggiorna anche questo file.
//
// isNavLinkActive(link, pathname), regole:
// 1. Uguaglianza esatta dopo aver tolto le barre finali da entrambi i lati
//    (solo la radice "/" resta com'è).
// 2. Senza `end`, una voce è accesa anche sulle pagine sotto di lei, ma solo
//    al confine di segmento: "/admin/events" non accende "/admin/eventsfoo",
//    "/me" non accende "/mentor".
// 3. Con `end` (la home dell'area, "/admin" o "/me") solo il percorso esatto:
//    altrimenti Home resterebbe accesa su ogni pagina dell'area.
// 4. `alsoActive`: altri percorsi (sempre per prefisso, `end` non si applica)
//    che accendono la voce. Su telefono «Altro» resta acceso su Gallerie, Feed,
//    Statistiche e Iscrizioni, che dentro la barra in basso non hanno una voce.
// 5. Per ogni pagina dell'admin deve esserci esattamente una voce accesa, sia
//    nella barra in basso (5 voci) sia nella barra laterale a desktop (7).
//
// getInitials(name): prima lettera del primo e dell'ultimo nome in maiuscolo
// (it-IT); una sola parola, una lettera; niente nome, stringa vuota (l'avatar
// mostra l'icona). Separatori: spazi, "@", ".", "_", "-" (così "mario.rossi",
// il prefisso dell'email usato come ripiego, dà "MR"). Apostrofi e simboli si
// tolgono dalle parole, le lettere Unicode restano.

const home = { to: "/admin", end: true };
const events = { to: "/admin/events" };
const people = { to: "/admin/persone" };
const calendar = { to: "/admin/calendar" };
const galleries = { to: "/admin/galleries" };
const feed = { to: "/admin/feed" };

const adminBottomLinks = {
  Home: home,
  Attività: events,
  Persone: people,
  Calendario: calendar,
  Altro: {
    to: "/admin/settings",
    alsoActive: ["/admin/galleries", "/admin/feed", "/admin/stats", "/admin/registrations"],
  },
};

const adminRailLinks = {
  Home: home,
  Attività: events,
  Persone: people,
  Calendario: calendar,
  Gallerie: galleries,
  Feed: feed,
  Altro: { to: "/admin/settings", alsoActive: ["/admin/stats", "/admin/registrations"] },
};

const userLinks = {
  Home: { to: "/me", end: true },
  Calendario: { to: "/me/calendar" },
  Attività: { to: "/me/activities" },
  Profilo: { to: "/me/profile" },
};

// Figli di /admin in src/routes/router.tsx, con un id al posto dei parametri,
// e la voce che deve restare accesa nelle due barre.
const adminRoutes = [
  ["/admin", { bottom: "Home", rail: "Home" }],
  ["/admin/calendar", { bottom: "Calendario", rail: "Calendario" }],
  ["/admin/events", { bottom: "Attività", rail: "Attività" }],
  ["/admin/events/new", { bottom: "Attività", rail: "Attività" }],
  ["/admin/events/abc", { bottom: "Attività", rail: "Attività" }],
  ["/admin/events/abc/form-builder", { bottom: "Attività", rail: "Attività" }],
  ["/admin/events/abc/committees", { bottom: "Attività", rail: "Attività" }],
  ["/admin/events/abc/comitati", { bottom: "Attività", rail: "Attività" }],
  ["/admin/events/abc/registrations", { bottom: "Attività", rail: "Attività" }],
  ["/admin/events/abc/consents", { bottom: "Attività", rail: "Attività" }],
  ["/admin/events/abc/rooms", { bottom: "Attività", rail: "Attività" }],
  ["/admin/events/abc/questions", { bottom: "Attività", rail: "Attività" }],
  ["/admin/events/abc/stats", { bottom: "Attività", rail: "Attività" }],
  ["/admin/events/abc/surveys", { bottom: "Attività", rail: "Attività" }],
  ["/admin/events/abc/sondaggi", { bottom: "Attività", rail: "Attività" }],
  ["/admin/events/abc/gallery", { bottom: "Attività", rail: "Attività" }],
  ["/admin/events/abc/galleria", { bottom: "Attività", rail: "Attività" }],
  ["/admin/registrations", { bottom: "Altro", rail: "Altro" }],
  ["/admin/stats", { bottom: "Altro", rail: "Altro" }],
  ["/admin/feed", { bottom: "Altro", rail: "Feed" }],
  ["/admin/galleries", { bottom: "Altro", rail: "Gallerie" }],
  ["/admin/galleries/xyz", { bottom: "Altro", rail: "Gallerie" }],
  ["/admin/persone", { bottom: "Persone", rail: "Persone" }],
  ["/admin/settings", { bottom: "Altro", rail: "Altro" }],
];

function activeLabels(links, pathname) {
  return Object.entries(links)
    .filter(([, link]) => isNavLinkActive(link, pathname))
    .map(([label]) => label);
}

test("end: la home dell'area è accesa solo sul percorso esatto", () => {
  assert.equal(isNavLinkActive(home, "/admin"), true);
  assert.equal(isNavLinkActive(home, "/admin/events"), false);
  assert.equal(isNavLinkActive(home, "/admin/events/abc/registrations"), false);
  assert.equal(isNavLinkActive(userLinks.Home, "/me"), true);
  assert.equal(isNavLinkActive(userLinks.Home, "/me/profile"), false);
});

test("senza end: accesa sul percorso esatto e su quelli sotto", () => {
  assert.equal(isNavLinkActive(events, "/admin/events"), true);
  assert.equal(isNavLinkActive(events, "/admin/events/new"), true);
  assert.equal(isNavLinkActive(events, "/admin/events/abc/registrations"), true);
  assert.equal(isNavLinkActive(events, "/admin"), false);
  assert.equal(isNavLinkActive(events, "/admin/persone"), false);
});

test("barre finali: ignorate su entrambi i lati", () => {
  assert.equal(isNavLinkActive(events, "/admin/events/"), true);
  assert.equal(isNavLinkActive(events, "/admin/events//"), true);
  assert.equal(isNavLinkActive(events, "/admin/events/abc/"), true);
  assert.equal(isNavLinkActive({ to: "/admin/events/" }, "/admin/events"), true);
  assert.equal(isNavLinkActive({ to: "/admin/events/" }, "/admin/events/abc"), true);
  assert.equal(isNavLinkActive({ to: "/admin/events/" }, "/admin/eventsfoo"), false);
  assert.equal(isNavLinkActive(home, "/admin/"), true);
  assert.equal(isNavLinkActive({ to: "/admin/", end: true }, "/admin"), true);
  assert.equal(isNavLinkActive({ to: "/admin/", end: true }, "/admin/events"), false);
});

test("falsi positivi di prefisso: conta il confine di segmento", () => {
  assert.equal(isNavLinkActive(events, "/admin/eventsfoo"), false);
  assert.equal(isNavLinkActive(events, "/admin/events-old"), false);
  assert.equal(isNavLinkActive(events, "/admin/eventsfoo/bar"), false);
  assert.equal(isNavLinkActive(userLinks.Attività, "/me/activitiesfoo"), false);
  assert.equal(isNavLinkActive({ to: "/me" }, "/mentor"), false);
  assert.equal(isNavLinkActive({ to: "/me" }, "/me/profile"), true);
  assert.equal(isNavLinkActive({ to: "/me" }, "/me"), true);
});

test("percorso con query o hash non è nel pathname: non cambia l'esito", () => {
  // location.pathname non contiene mai ? né #: qui si fissa che, se arrivassero,
  // la voce NON si accende (nessuna normalizzazione nascosta da cui dipendere).
  assert.equal(isNavLinkActive(events, "/admin/events"), true);
  assert.equal(isNavLinkActive(events, "/admin/events?x=1"), false);
});

test("la radice \"/\" non viene svuotata dal taglio delle barre", () => {
  assert.equal(isNavLinkActive({ to: "/", end: true }, "/"), true);
  assert.equal(isNavLinkActive({ to: "/", end: true }, "/admin"), false);
});

test("la radice \"/\" senza end copre tutto, come NavLink di react-router", () => {
  // Trovato scrivendo questo test, corretto prima del commit: con target "/"
  // il codice cercava il prefisso "//" (barra tolta più barra aggiunta) e non
  // trovava niente sotto la radice. Nessun link delle barre ha to "/" oggi.
  assert.equal(
    isNavLinkActive({ to: "/" }, "/admin"),
    true,
    '{ to: "/" } senza end deve accendere /admin',
  );
});

test("alsoActive: Altro resta acceso su Gallerie, Feed, Statistiche, Iscrizioni", () => {
  const altro = adminBottomLinks.Altro;
  assert.equal(isNavLinkActive(altro, "/admin/settings"), true);
  assert.equal(isNavLinkActive(altro, "/admin/galleries"), true);
  assert.equal(isNavLinkActive(altro, "/admin/galleries/xyz"), true);
  assert.equal(isNavLinkActive(altro, "/admin/feed"), true);
  assert.equal(isNavLinkActive(altro, "/admin/feed/"), true);
  assert.equal(isNavLinkActive(altro, "/admin/stats"), true);
  assert.equal(isNavLinkActive(altro, "/admin/registrations"), true);
  assert.equal(isNavLinkActive(altro, "/admin/persone"), false);
  assert.equal(isNavLinkActive(altro, "/admin"), false);
  assert.equal(isNavLinkActive(altro, "/admin/events/abc/stats"), false);
});

test("alsoActive: stesso confine di segmento del percorso principale", () => {
  const altro = adminBottomLinks.Altro;
  assert.equal(isNavLinkActive(altro, "/admin/feedback"), false);
  assert.equal(isNavLinkActive(altro, "/admin/galleriesfoo"), false);
  assert.equal(isNavLinkActive(altro, "/admin/settingsfoo"), false);
});

test("alsoActive: con end sul percorso principale, gli alias valgono per prefisso", () => {
  const link = { to: "/admin", end: true, alsoActive: ["/admin/feed"] };
  assert.equal(isNavLinkActive(link, "/admin/feed/xyz"), true);
  assert.equal(isNavLinkActive(link, "/admin/events"), false);
});

test("alsoActive assente o vuoto: nessun effetto", () => {
  assert.equal(isNavLinkActive({ to: "/admin/events", alsoActive: [] }, "/admin/feed"), false);
  assert.equal(isNavLinkActive({ to: "/admin/events", alsoActive: undefined }, "/admin/feed"), false);
});

for (const [pathname, expected] of adminRoutes) {
  test(`barra in basso admin: una sola voce accesa su ${pathname}`, () => {
    assert.deepEqual(activeLabels(adminBottomLinks, pathname), [expected.bottom]);
  });

  test(`barra laterale admin: una sola voce accesa su ${pathname}`, () => {
    assert.deepEqual(activeLabels(adminRailLinks, pathname), [expected.rail]);
  });
}

test("barra admin: con barra finale la voce accesa resta la stessa", () => {
  for (const [pathname, expected] of adminRoutes) {
    assert.deepEqual(activeLabels(adminBottomLinks, `${pathname}/`), [expected.bottom], pathname);
    assert.deepEqual(activeLabels(adminRailLinks, `${pathname}/`), [expected.rail], pathname);
  }
});

test("barra admin: i percorsi fuori dall'area non accendono niente", () => {
  for (const pathname of ["/me", "/activities", "/administrator", "/adminfoo/events", "/"]) {
    assert.deepEqual(activeLabels(adminBottomLinks, pathname), [], pathname);
    assert.deepEqual(activeLabels(adminRailLinks, pathname), [], pathname);
  }
});

test("area giovane: una sola voce accesa sulle pagine con una voce", () => {
  const cases = [
    ["/me", "Home"],
    ["/me/calendar", "Calendario"],
    ["/me/activities", "Attività"],
    ["/me/activities/abc", "Attività"],
    ["/me/activities/abc/edit", "Attività"],
    ["/me/profile", "Profilo"],
    ["/me/profile/", "Profilo"],
  ];
  for (const [pathname, label] of cases) {
    assert.deepEqual(activeLabels(userLinks, pathname), [label], pathname);
  }
});

test("area giovane: sondaggi non ha una voce, quindi nessuna accesa (mai due)", () => {
  // /me/sondaggi e /me/sondaggi/:eventId stanno sotto /me ma non hanno una voce
  // nella barra: Home (end) non deve accendersi al posto loro.
  assert.deepEqual(activeLabels(userLinks, "/me/sondaggi"), []);
  assert.deepEqual(activeLabels(userLinks, "/me/sondaggi/abc"), []);
});

test("area giovane: percorsi fuori dall'area non accendono niente", () => {
  for (const pathname of ["/mentor", "/me2", "/activities", "/"]) {
    assert.deepEqual(activeLabels(userLinks, pathname), [], pathname);
  }
});

test("getInitials: due nomi", () => {
  assert.equal(getInitials("Mario Rossi"), "MR");
  assert.equal(getInitials("mario rossi"), "MR");
});

test("getInitials: tre o più nomi, primo e ultimo", () => {
  assert.equal(getInitials("Maria Antonietta Rossi"), "MR");
  assert.equal(getInitials("Anna Maria Luisa De Santis"), "AS");
});

test("getInitials: una sola parola, una lettera", () => {
  assert.equal(getInitials("Mario"), "M");
  assert.equal(getInitials("  mario  "), "M");
});

test("getInitials: lettere accentate e Unicode", () => {
  assert.equal(getInitials("Élodie Ñuñez"), "ÉÑ");
  assert.equal(getInitials("élodie ñuñez"), "ÉÑ");
  assert.equal(getInitials("Łukasz Żak"), "ŁŻ");
  assert.equal(getInitials("Åsa"), "Å");
  // Lettera fuori dal piano base: una sola unità di codice sarebbe metà lettera.
  assert.equal(getInitials("𠮷野 家"), "𠮷家");
});

test("getInitials: vuoto, null, undefined, solo spazi o simboli", () => {
  assert.equal(getInitials(""), "");
  assert.equal(getInitials(null), "");
  assert.equal(getInitials(undefined), "");
  assert.equal(getInitials("   "), "");
  assert.equal(getInitials("..."), "");
  assert.equal(getInitials("@ - _"), "");
});

test("getInitials: prefisso dell'email come ripiego", () => {
  assert.equal(getInitials("mario.rossi"), "MR");
  assert.equal(getInitials("mario_rossi"), "MR");
  assert.equal(getInitials("mario-rossi"), "MR");
  assert.equal(getInitials("mario"), "M");
  assert.equal(getInitials("mario.rossi99"), "MR");
});

test("getInitials: spazi in più, anche a capo e tab", () => {
  assert.equal(getInitials("  Mario   Rossi  "), "MR");
  assert.equal(getInitials("Mario\tRossi"), "MR");
  assert.equal(getInitials("Mario\nRossi"), "MR");
});

test("getInitials: apostrofi e simboli dentro i nomi", () => {
  assert.equal(getInitials("D'Amico Luca"), "DL");
  assert.equal(getInitials("Luca D'Amico"), "LD");
  assert.equal(getInitials("Luca D’Amico"), "LD");
  assert.equal(getInitials("(Luca) [Rossi]"), "LR");
  // Una parola fatta solo di simboli non conta come nome.
  assert.equal(getInitials("Mario ' Rossi"), "MR");
  assert.equal(getInitials("Mario Rossi ."), "MR");
});

test("getInitials: cifre contano come lettere", () => {
  assert.equal(getInitials("2 Fratelli"), "2F");
});
