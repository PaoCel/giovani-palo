import test from "node:test";
import assert from "node:assert/strict";

import { ANNUNCIATA } from "../src/copy/annunciata.ts";
import { CATALOGO } from "../src/copy/catalogo.ts";
import { MOMENTI } from "../src/copy/momenti.ts";
import { fillCopy } from "../src/copy/parole.ts";
import { getRegistrationAvailability } from "../src/utils/events.ts";
import {
  getPublicEventPhase,
  getPublicEventState,
  getRegistrationCountdown,
  hasEventEnded,
} from "../src/utils/publicEventState.ts";

// Stato pubblico di un'attività (pill del catalogo, del dettaglio e di
// /me/activities), src/utils/publicEventState.ts. Il bug di produzione: il
// 4 novembre 2026 un'attività finita a ottobre con status "registrations_open"
// diceva «Iscrizioni aperte» mentre il tasto diceva «Iscrizioni non
// disponibili».
//
// Fase, in ordine di priorità:
// 0. status "draft" => draft, subito dopo "cancelled": vince sulle date di
//    fine e sulla finestra d'iscrizione. Etichetta «Bozza», tono neutral.
// 1. status "cancelled" => cancelled, qualunque siano le date.
// 2. status "completed" => ended, anche con date future.
// 3. attività finita (fine < adesso; senza fine vale l'inizio) => ended,
//    qualunque sia lo status (planned compresa: niente «Iscrizioni a breve»).
// 4. status "planned" => announced, a prescindere dalle date d'iscrizione
//    (anche dentro la finestra o nel passato). Etichetta «Iscrizioni a breve»,
//    tono info. getRegistrationAvailability è sempre "not-open-yet".
// 5. status diverso da "registrations_open" (confirmed, registrations_closed):
//    prima dell'apertura => upcoming, altrimenti closed, anche dentro la
//    finestra d'iscrizione.
// 6. status "registrations_open": prima dell'apertura => upcoming, dopo la
//    chiusura => closed, dentro la finestra => open. Gli estremi sono
//    inclusi: adesso === apertura e adesso === chiusura sono open.
// 7. date d'iscrizione vuote o non valide, attività non finita => open, senza
//    errori.
//
// Etichette e toni: open => «Iscrizioni aperte» (success); announced =>
// «Iscrizioni a breve» (info); upcoming => «Iscrizioni dal {data}» (info),
// con giorno e mese breve in it-IT e l'anno solo se l'apertura cade in un
// anno diverso da quello di adesso; closed => «Iscrizioni chiuse» (warning);
// ended => «Conclusa» (neutral); cancelled => «Annullata» (danger).
//
// Il conto alla rovescia (getRegistrationCountdown) è null se la chiusura è
// passata, non valida o a 7 giorni o più; altrimenti «Le iscrizioni chiudono
// tra N giorni | N ore | N minuti», con il numero arrotondato per difetto e
// l'unità più grande che ci sta (almeno 1 minuto).
//
// La fase deve restare coerente con il tasto d'iscrizione
// (getRegistrationAvailability), che legge l'ora corrente: per quel confronto
// le date sono relative a Date.now(), con margini di ore.
//
// I valori attesi vengono dalla spec, non dal codice; le etichette sono le
// costanti dei file di copy. Le date si costruiscono con `new Date(anno, mese,
// giorno, ora)` locali: l'unica regola che dipende dal fuso è quella
// dell'anno, e usa mezzogiorno per stare lontano dai cambi di data.
//
// Comando: TZ=Europe/Rome node --test tests/publicEventState.test.mjs

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const local = (year, month, day, hour = 12, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).getTime();
const iso = (time) => new Date(time).toISOString();

// 4 novembre 2026, mezzogiorno.
const NOW = local(2026, 11, 4);

/** Attività in corso fra un mese, iscrizioni dal 1 al 20 novembre 2026. */
const event = (overrides = {}) => ({
  status: "registrations_open",
  startDate: iso(local(2026, 12, 5)),
  endDate: iso(local(2026, 12, 6)),
  registrationOpen: iso(local(2026, 11, 1)),
  registrationClose: iso(local(2026, 11, 20)),
  ...overrides,
});

const phase = (overrides, now = NOW) => getPublicEventPhase(event(overrides), now);

test("annullata: cancelled anche se le date direbbero aperta o conclusa", () => {
  assert.equal(phase({ status: "cancelled" }), "cancelled");
  assert.equal(
    phase({ status: "cancelled", startDate: iso(local(2026, 10, 1)), endDate: iso(local(2026, 10, 2)) }),
    "cancelled",
  );
});

test("bozza: draft vince su date finite e finestra d'iscrizione", () => {
  // Dentro la finestra d'iscrizione.
  assert.equal(phase({ status: "draft" }), "draft");
  // Attività già finita.
  assert.equal(
    phase({ status: "draft", startDate: iso(local(2026, 10, 10)), endDate: iso(local(2026, 10, 12)) }),
    "draft",
  );
  // Prima dell'apertura e dopo la chiusura.
  assert.equal(phase({ status: "draft" }, local(2026, 10, 20)), "draft");
  assert.equal(phase({ status: "draft" }, local(2026, 11, 25)), "draft");
  // Date d'iscrizione vuote.
  assert.equal(phase({ status: "draft", registrationOpen: "", registrationClose: "" }), "draft");
});

test("completed: ended anche con date future", () => {
  assert.equal(phase({ status: "completed" }), "ended");
});

test("attività finita: ended qualunque sia lo status (il bug di produzione)", () => {
  const finita = { startDate: iso(local(2026, 10, 10)), endDate: iso(local(2026, 10, 12)) };
  for (const status of [
    "registrations_open",
    "planned",
    "confirmed",
    "registrations_closed",
  ]) {
    assert.equal(phase({ ...finita, status }), "ended", status);
  }
});

test("attività finita: senza fine vale l'inizio", () => {
  assert.equal(
    phase({ startDate: iso(local(2026, 10, 10)), endDate: "" }),
    "ended",
  );
  assert.equal(
    phase({ startDate: iso(local(2026, 12, 10)), endDate: "" }),
    "open",
  );
});

test("status diverso da registrations_open: upcoming prima dell'apertura, poi closed", () => {
  for (const status of ["confirmed", "registrations_closed"]) {
    assert.equal(phase({ status }, local(2026, 10, 20)), "upcoming", `${status} prima`);
    // Dentro la finestra d'iscrizione, ma lo status non è aperto.
    assert.equal(phase({ status }, NOW), "closed", `${status} dentro la finestra`);
    assert.equal(phase({ status }, local(2026, 11, 25)), "closed", `${status} dopo`);
  }
});

test("planned: fase announced a prescindere dalle date d'iscrizione", () => {
  assert.equal(phase({ status: "planned" }, local(2026, 10, 20)), "announced", "prima dell'apertura");
  assert.equal(phase({ status: "planned" }, NOW), "announced", "dentro la finestra");
  assert.equal(phase({ status: "planned" }, local(2026, 11, 25)), "announced", "dopo la chiusura");
  assert.equal(
    phase({ status: "planned", registrationOpen: "", registrationClose: "" }),
    "announced",
    "date d'iscrizione vuote",
  );
  assert.equal(
    phase({ status: "planned", registrationOpen: iso(local(2026, 10, 1)), registrationClose: iso(local(2026, 10, 20)) }),
    "announced",
    "finestra già nel passato, attività ancora in corso",
  );
});

test("registrations_open: prima, dentro e dopo la finestra", () => {
  assert.equal(phase({}, local(2026, 10, 31)), "upcoming");
  assert.equal(phase({}, NOW), "open");
  assert.equal(phase({}, local(2026, 11, 21)), "closed");
});

test("registrations_open: gli estremi della finestra sono inclusi", () => {
  const open = local(2026, 11, 1);
  const close = local(2026, 11, 20);
  assert.equal(phase({}, open - 1), "upcoming");
  assert.equal(phase({}, open), "open");
  assert.equal(phase({}, close), "open");
  assert.equal(phase({}, close + 1), "closed");
});

test("date d'iscrizione vuote o non valide con registrations_open: open, senza errori", () => {
  assert.equal(phase({ registrationOpen: "", registrationClose: "" }), "open");
  assert.equal(phase({ registrationOpen: "boh", registrationClose: "mai" }), "open");
  assert.equal(phase({ registrationOpen: "", registrationClose: iso(local(2026, 11, 20)) }), "open");
});

test("coerenza con getRegistrationAvailability per un ospite", () => {
  const now = Date.now();
  const formConfig = { allowGuestRegistration: true };
  const casi = [
    // [descrizione, overrides, fase attesa, disponibilità attesa]
    ["aperta", { registrationOpen: iso(now - DAY), registrationClose: iso(now + DAY) }, "open", "guest-allowed"],
    ["non ancora aperta", { registrationOpen: iso(now + DAY), registrationClose: iso(now + 2 * DAY) }, "upcoming", "not-open-yet"],
    ["chiusa per data", { registrationOpen: iso(now - 2 * DAY), registrationClose: iso(now - DAY) }, "closed", "closed"],
    ["planned prima dell'apertura", { status: "planned", registrationOpen: iso(now + DAY), registrationClose: iso(now + 2 * DAY) }, "announced", "not-open-yet"],
    ["planned dentro la finestra", { status: "planned", registrationOpen: iso(now - DAY), registrationClose: iso(now + DAY) }, "announced", "not-open-yet"],
    ["planned dopo la chiusura", { status: "planned", registrationOpen: iso(now - 2 * DAY), registrationClose: iso(now - DAY) }, "announced", "not-open-yet"],
    ["registrations_closed dentro la finestra", { status: "registrations_closed", registrationOpen: iso(now - DAY), registrationClose: iso(now + DAY) }, "closed", "closed"],
  ];

  for (const [descrizione, overrides, faseAttesa, disponibilitaAttesa] of casi) {
    const e = event({ startDate: iso(now + 30 * DAY), endDate: iso(now + 31 * DAY), ...overrides });
    assert.equal(getPublicEventPhase(e, now), faseAttesa, `${descrizione}: fase`);
    assert.equal(getRegistrationAvailability(e, formConfig, null), disponibilitaAttesa, `${descrizione}: tasto`);
  }
});

test("planned: not-open-yet anche con sessione autenticata e dentro la finestra", () => {
  const now = Date.now();
  const e = event({
    status: "planned",
    startDate: iso(now + 30 * DAY),
    endDate: iso(now + 31 * DAY),
    registrationOpen: iso(now - DAY),
    registrationClose: iso(now + DAY),
  });
  const session = {
    isAuthenticated: true,
    isAnonymous: false,
    isParent: false,
    profile: { genderRoleCategory: "giovane_uomo" },
  };
  assert.equal(getPublicEventPhase(e, now), "announced");
  assert.equal(getRegistrationAvailability(e, { allowGuestRegistration: true }, session), "not-open-yet");
  assert.equal(getRegistrationAvailability(e, { allowGuestRegistration: true }, { ...session, isParent: true }), "not-open-yet");
});

test("getPublicEventState: etichetta e tono per ogni fase", () => {
  assert.deepEqual(getPublicEventState(event(), NOW), {
    phase: "open",
    label: CATALOGO.iscrizioniAperte,
    tone: "success",
  });
  assert.deepEqual(getPublicEventState(event({ status: "planned" }), NOW), {
    phase: "announced",
    label: ANNUNCIATA.iscrizioniABreve,
    tone: "info",
  });
  assert.deepEqual(
    getPublicEventState(event({ startDate: iso(local(2026, 10, 1)), endDate: iso(local(2026, 10, 2)) }), NOW),
    { phase: "ended", label: CATALOGO.conclusa, tone: "neutral" },
  );
  assert.deepEqual(getPublicEventState(event({ status: "draft" }), NOW), {
    phase: "draft",
    label: CATALOGO.bozza,
    tone: "neutral",
  });
  assert.deepEqual(getPublicEventState(event({ status: "cancelled" }), NOW), {
    phase: "cancelled",
    label: CATALOGO.annullata,
    tone: "danger",
  });
});

test("getPublicEventState: upcoming nello stesso anno non mostra l'anno", () => {
  const state = getPublicEventState(
    event({ registrationOpen: iso(local(2026, 12, 10)), registrationClose: iso(local(2026, 12, 20)) }),
    NOW,
  );
  assert.equal(state.phase, "upcoming");
  assert.equal(state.tone, "info");
  assert.equal(state.label, fillCopy(MOMENTI.apreIl, { data: "10 dic" }));
});

test("getPublicEventState: upcoming in un altro anno mostra l'anno", () => {
  const e = event({
    registrationOpen: iso(local(2027, 1, 10)),
    registrationClose: iso(local(2027, 1, 20)),
    startDate: iso(local(2027, 2, 5)),
    endDate: iso(local(2027, 2, 6)),
  });
  // Visto dal 2026: anno presente.
  const dal2026 = getPublicEventState(e, NOW);
  assert.equal(dal2026.phase, "upcoming");
  assert.equal(dal2026.label, fillCopy(MOMENTI.apreIl, { data: "10 gen 2027" }));
  // Visto dal 1 gennaio 2027: stesso anno, niente anno.
  const dal2027 = getPublicEventState(e, local(2027, 1, 1));
  assert.equal(dal2027.phase, "upcoming");
  assert.equal(dal2027.label, fillCopy(MOMENTI.apreIl, { data: "10 gen" }));
});

test("hasEventEnded: fine, ripiego sull'inizio, entrambe vuote", () => {
  assert.equal(hasEventEnded({ startDate: iso(NOW - 3 * DAY), endDate: iso(NOW - DAY) }, NOW), true);
  assert.equal(hasEventEnded({ startDate: iso(NOW - 3 * DAY), endDate: iso(NOW + DAY) }, NOW), false);
  assert.equal(hasEventEnded({ startDate: iso(NOW - DAY), endDate: "" }, NOW), true);
  assert.equal(hasEventEnded({ startDate: iso(NOW + DAY), endDate: "" }, NOW), false);
  assert.equal(hasEventEnded({ startDate: "", endDate: "" }, NOW), false);
  assert.equal(hasEventEnded({ startDate: iso(NOW - DAY), endDate: iso(NOW + DAY) }, NOW), false);
});

test("getRegistrationCountdown: null se passata, non valida o a 7 giorni o più", () => {
  assert.equal(getRegistrationCountdown(iso(NOW - HOUR), NOW), null);
  assert.equal(getRegistrationCountdown(iso(NOW), NOW), null);
  assert.equal(getRegistrationCountdown("", NOW), null);
  assert.equal(getRegistrationCountdown("boh", NOW), null);
  assert.equal(getRegistrationCountdown(iso(NOW + 7 * DAY), NOW), null);
  assert.equal(getRegistrationCountdown(iso(NOW + 10 * DAY), NOW), null);
});

test("getRegistrationCountdown: giorni, ore e minuti", () => {
  const tra = (quando) => fillCopy(CATALOGO.chiudonoTra, { quando });
  const conto = (ms) => getRegistrationCountdown(iso(NOW + ms), NOW);

  assert.equal(conto(6 * DAY + 23 * HOUR), tra(fillCopy(CATALOGO.traGiorni, { numero: "6" })));
  assert.equal(conto(DAY), tra(CATALOGO.traUnGiorno));
  assert.equal(conto(DAY + 23 * HOUR), tra(CATALOGO.traUnGiorno));
  assert.equal(conto(2 * DAY), tra(fillCopy(CATALOGO.traGiorni, { numero: "2" })));
  assert.equal(conto(23 * HOUR + 59 * MIN), tra(fillCopy(CATALOGO.traOre, { numero: "23" })));
  assert.equal(conto(HOUR), tra(CATALOGO.traUnOra));
  assert.equal(conto(5 * HOUR), tra(fillCopy(CATALOGO.traOre, { numero: "5" })));
  assert.equal(conto(59 * MIN), tra(fillCopy(CATALOGO.traMinuti, { numero: "59" })));
  assert.equal(conto(MIN), tra(CATALOGO.traUnMinuto));
  assert.equal(conto(90_000), tra(CATALOGO.traUnMinuto));
  assert.equal(conto(10_000), tra(CATALOGO.traUnMinuto));
});
