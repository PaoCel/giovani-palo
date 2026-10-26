// Appartenenza al palo (S2), parte pura del client (`src/utils/stakeMembership.ts`)
// provata DALLA SPEC di docs/APPARTENENZA_AL_PALO.md («Chi vede, chi scrive»,
// «Contratto di autorizzazione», «Callable e trigger: interfaccia», «Client
// della fase 3: superfici, stati e ritorni»), da chi non ha scritto il codice:
// se una prova è rossa, codice e spec non dicono la stessa cosa e uno dei due
// è un bug.
//
// Cosa si prova:
//  - chi è membro (`memberAccessOf`): staff dal ruolo del profilo nel palo
//    (stesso ramo delle rules), membro dal proprio `members/{uid}` attivo, mai
//    da `users.stakeId`; una sessione anonima non è mai membro, qualunque
//    documento abbia; finché il documento non è arrivato né contenuto né
//    lucchetto (`loading`);
//  - i testi delle superfici chiuse e il banner per ogni stato, con i tetti
//    del rifiuto (7 giorni, 3 rifiuti);
//  - le date in italiano ("dal 28 ottobre", "dall'8 ottobre", "il 1° novembre");
//  - la coda dello staff: ordine, finestra di 30 giorni, "da confermare da
//    tempo" solo per l'admin, "Annulla rifiuto" solo admin o chi ha rifiutato;
//  - le etichette della coda: "Passata dal dirigente" (notMyUnit) e "Il
//    dirigente non lo conosce" (markUnknown del dirigente, unità svuotata:
//    scelta S2-3), con i loro testi;
//  - la lettura del documento (`mapStakeMember`) e i messaggi per ogni
//    `details.reason` della callable, mai in inglese.
//
// Le date si costruiscono con `new Date(anno, mese - 1, giorno, 12)` in ora
// locale, mai da stringhe ISO: il giorno del mese non deve dipendere dal fuso.
//
// Comando: node --test tests/stakeMembershipClient.test.mjs
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FirebaseError } from "firebase/app";

import { PALO } from "../src/copy/palo.ts";
import {
  DECLINE_COOLDOWN_MS,
  MAX_DECLINES,
  RECENT_WINDOW_MS,
  canUndoDecline,
  fromDateLabel,
  initialsOf,
  isMigratedAccount,
  isStakeStaffRole,
  lockedMessageOf,
  mapStakeMember,
  memberAccessOf,
  membershipBannerOf,
  membershipErrorMessage,
  onDateLabel,
  pendingQueue,
  recentDeclined,
  reviewQueue,
  waitingLabel,
  wasPassedByUnitLeader,
  wasUnknownToUnitLeader,
} from "../src/utils/stakeMembership.ts";

const STAKE = "roma-est";
const OTHER_STAKE = "milano";
const UNIT = { id: "unit-1", name: "Rione Uno" };
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const local = (year, month, day, hour = 12, minute = 0) => new Date(year, month - 1, day, hour, minute).getTime();
const NOW = local(2026, 10, 21, 15);
const STATUSES = ["pending", "active", "declined", "withdrawn", "removed", "blocked"];
const OUT_STATUSES = ["declined", "withdrawn", "removed", "blocked"];

/** Documento members già letto dal client, con i campi che la spec elenca. */
function memberWith(status, extra = {}) {
  return {
    uid: "uid-persona",
    stakeId: STAKE,
    status,
    staffRole: null,
    claimedUnitId: UNIT.id,
    claimedUnitName: UNIT.name,
    displayName: "Marco Rossi",
    birthYear: 2009,
    registrationHints: [],
    reviewNeeded: false,
    requestedAtMs: NOW - 2 * DAY,
    decidedAtMs: null,
    decidedBy: "",
    declineCount: 0,
    version: 1,
    sourceKinds: [],
    previous: null,
    ...extra,
  };
}

const loaded = (member) => ({ loading: false, member });
const LOADING = { loading: true, member: null };

/** Persona firmata con un account vero, profilo sul palo. */
function access(overrides = {}) {
  return memberAccessOf({
    signedIn: true,
    anonymous: false,
    role: "participant",
    profileStakeId: STAKE,
    stakeId: STAKE,
    membership: loaded(null),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Chi è membro: `memberAccessOf`
// ---------------------------------------------------------------------------
describe("memberAccessOf: chi non ha un account personale è ospite", () => {
  test("visitatore senza login: guest, qualunque documento", () => {
    assert.equal(access({ signedIn: false }), "guest");
    assert.equal(access({ signedIn: false, membership: loaded(memberWith("active")) }), "guest");
    assert.equal(access({ signedIn: false, membership: LOADING }), "guest");
  });

  test("sessione anonima: guest anche con un members attivo o un profilo da staff", () => {
    // Contratto: «una sessione anonima non è mai membro, qualunque documento abbia».
    assert.equal(access({ anonymous: true }), "guest");
    assert.equal(access({ anonymous: true, membership: loaded(memberWith("active")) }), "guest");
    assert.equal(access({ anonymous: true, role: "admin" }), "guest");
    assert.equal(access({ anonymous: true, role: "unit_leader", membership: loaded(memberWith("active", { staffRole: "unit_leader" })) }), "guest");
    assert.equal(access({ anonymous: true, role: "super_admin" }), "guest");
  });

  test("senza un palo scelto: guest, anche per un admin", () => {
    assert.equal(access({ stakeId: "", profileStakeId: "" }), "guest");
    assert.equal(access({ stakeId: "", profileStakeId: "", role: "admin" }), "guest");
    assert.equal(access({ stakeId: "", membership: loaded(memberWith("active")) }), "guest");
  });
});

describe("memberAccessOf: lo staff decide dal ruolo del profilo, come le rules", () => {
  for (const role of ["admin", "unit_leader"]) {
    test(`${role} del palo: member anche senza documento, in caricamento o con il documento removed`, () => {
      assert.equal(access({ role }), "member");
      assert.equal(access({ role, membership: LOADING }), "member");
      assert.equal(access({ role, membership: loaded(memberWith("removed")) }), "member");
      assert.equal(access({ role, membership: loaded(memberWith("pending")) }), "member");
    });

    test(`${role} di un altro palo: nessun potere qui, conta il documento members`, () => {
      assert.equal(access({ role, profileStakeId: OTHER_STAKE, membership: LOADING }), "loading");
      assert.equal(access({ role, profileStakeId: OTHER_STAKE }), "waiting");
      assert.equal(access({ role, profileStakeId: OTHER_STAKE, membership: loaded(memberWith("active")) }), "member");
      assert.equal(access({ role, profileStakeId: OTHER_STAKE, membership: loaded(memberWith("declined")) }), "out");
    });
  }

  test("super admin: member in ogni palo, qualunque sia il palo del profilo", () => {
    assert.equal(access({ role: "super_admin" }), "member");
    assert.equal(access({ role: "super_admin", profileStakeId: OTHER_STAKE }), "member");
    assert.equal(access({ role: "super_admin", profileStakeId: "", membership: LOADING }), "member");
  });

  test("isStakeStaffRole: solo admin, unit_leader del palo e super_admin", () => {
    assert.equal(isStakeStaffRole("admin", STAKE, STAKE), true);
    assert.equal(isStakeStaffRole("unit_leader", STAKE, STAKE), true);
    assert.equal(isStakeStaffRole("super_admin", OTHER_STAKE, STAKE), true);
    assert.equal(isStakeStaffRole("admin", OTHER_STAKE, STAKE), false);
    assert.equal(isStakeStaffRole("unit_leader", OTHER_STAKE, STAKE), false);
    assert.equal(isStakeStaffRole("participant", STAKE, STAKE), false);
    assert.equal(isStakeStaffRole("parent", STAKE, STAKE), false);
    assert.equal(isStakeStaffRole("admin", "", ""), false);
  });
});

describe("memberAccessOf: chi non è staff decide dal proprio documento members", () => {
  test("documento non ancora arrivato: loading (né contenuto né lucchetto)", () => {
    assert.equal(access({ membership: LOADING }), "loading");
    assert.equal(access({ role: "parent", membership: LOADING }), "loading");
  });

  test("members attivo: member, anche da confermare (reviewNeeded)", () => {
    assert.equal(access({ membership: loaded(memberWith("active")) }), "member");
    assert.equal(access({ membership: loaded(memberWith("active", { reviewNeeded: true })) }), "member");
  });

  test("nessun documento o pending: waiting", () => {
    assert.equal(access(), "waiting");
    assert.equal(access({ membership: loaded(memberWith("pending")) }), "waiting");
  });

  test("users.stakeId del palo senza documento non dà niente: waiting, non member", () => {
    // Il cuore di S2: il palo scelto nel profilo non è appartenenza.
    assert.equal(access({ profileStakeId: STAKE, membership: loaded(null) }), "waiting");
  });

  for (const status of OUT_STATUSES) {
    test(`${status}: out`, () => {
      assert.equal(access({ membership: loaded(memberWith(status)) }), "out");
    });
  }

  test("members attivo di un altro palo non vale qui", () => {
    // Il documento letto è quello del palo richiesto: qui manca.
    assert.equal(access({ profileStakeId: OTHER_STAKE, membership: loaded(null) }), "waiting");
  });
});

// ---------------------------------------------------------------------------
// Superfici dei membri chiuse: `lockedMessageOf`
// ---------------------------------------------------------------------------
describe("lockedMessageOf: i testi delle superfici chiuse", () => {
  test("in attesa (pending o nessun documento): «Si sbloccano dopo la verifica.» per ogni superficie", () => {
    for (const kind of ["foto", "record", "sondaggi"]) {
      assert.equal(lockedMessageOf("waiting", kind), "Si sbloccano dopo la verifica.");
      assert.equal(lockedMessageOf("waiting", kind), PALO.siSbloccano);
    }
  });

  test("fuori: una frase per superficie, «solo ai membri del palo»", () => {
    assert.equal(lockedMessageOf("out", "foto"), "Foto e video sono visibili solo ai membri del palo.");
    assert.equal(lockedMessageOf("out", "foto"), PALO.soloMembriFoto);
    assert.equal(lockedMessageOf("out", "record"), "I record sono visibili solo ai membri del palo.");
    assert.equal(lockedMessageOf("out", "record"), PALO.soloMembriRecord);
    assert.equal(lockedMessageOf("out", "sondaggi"), "I sondaggi sono solo per i membri del palo.");
    assert.equal(lockedMessageOf("out", "sondaggi"), PALO.soloMembriSondaggi);
    for (const kind of ["foto", "record", "sondaggi"]) {
      assert.match(lockedMessageOf("out", kind), /membri del palo\.$/u);
      assert.notEqual(lockedMessageOf("out", kind), lockedMessageOf("waiting", kind), "fuori e in attesa non dicono la stessa cosa");
    }
  });

  test("membro, in caricamento, ospite: nessun testo", () => {
    for (const kind of ["foto", "record", "sondaggi"]) {
      assert.equal(lockedMessageOf("member", kind), null);
      assert.equal(lockedMessageOf("loading", kind), null, "finché il documento non è arrivato niente lucchetto");
      assert.equal(lockedMessageOf("guest", kind), null);
    }
  });
});

// ---------------------------------------------------------------------------
// Banner dell'utente: `membershipBannerOf`
// ---------------------------------------------------------------------------
const banner = (overrides = {}) =>
  membershipBannerOf({ access: "waiting", profileComplete: true, member: null, nowMs: NOW, ...overrides });

describe("membershipBannerOf: quando non c'è banner", () => {
  test("staff e membri attivi (anche da confermare): nessun banner", () => {
    assert.equal(banner({ access: "member", member: memberWith("active") }), null);
    assert.equal(banner({ access: "member", member: memberWith("active", { reviewNeeded: true }) }), null);
    assert.equal(banner({ access: "member", member: null }), null, "staff senza documento");
    assert.equal(banner({ access: "member", member: memberWith("removed") }), null, "staff con documento removed: decide il ruolo");
  });

  test("documento in caricamento e ospite: nessun banner", () => {
    assert.equal(banner({ access: "loading" }), null);
    assert.equal(banner({ access: "guest" }), null);
    assert.equal(banner({ access: "guest", member: memberWith("declined") }), null);
  });

  test("profilo incompleto: nessun banner, c'è già «Completa il profilo»", () => {
    assert.equal(banner({ profileComplete: false }), null);
    assert.equal(banner({ profileComplete: false, member: memberWith("pending") }), null);
    for (const status of OUT_STATUSES) {
      assert.equal(banner({ profileComplete: false, access: "out", member: memberWith(status) }), null, status);
    }
  });
});

describe("membershipBannerOf: in attesa", () => {
  test("pending con l'unità dichiarata: banner pending con il nome dell'unità, non agli admin", () => {
    assert.deepEqual(banner({ member: memberWith("pending") }), { kind: "pending", unitName: UNIT.name, toAdmins: false });
  });

  test("pending senza unità (passata agli admin con notMyUnit o markUnknown, o senza unità nel profilo): unitName vuoto e toAdmins", () => {
    assert.deepEqual(banner({ member: memberWith("pending", { claimedUnitId: "", claimedUnitName: "" }) }), { kind: "pending", unitName: "", toAdmins: true });
    // Passata dal dirigente: il nome dichiarato resta nel documento, ma a verificare è un admin.
    const passed = memberWith("pending", { claimedUnitId: "", previous: { action: "notMyUnit", by: "uid-dirigente", status: "pending", claimedUnitId: UNIT.id } });
    assert.deepEqual(banner({ member: passed }), { kind: "pending", unitName: "", toAdmins: true });
    const unknown = memberWith("pending", { claimedUnitId: "", previous: { action: "markUnknown", by: "uid-dirigente", status: "active", claimedUnitId: UNIT.id } });
    assert.deepEqual(banner({ member: unknown }), { kind: "pending", unitName: "", toAdmins: true });
  });

  test("markUnknown dell'admin: l'unità resta e il banner nomina ancora l'unità", () => {
    const byAdmin = memberWith("pending", { previous: { action: "markUnknown", by: "uid-admin", status: "active", claimedUnitId: UNIT.id } });
    assert.deepEqual(banner({ member: byAdmin }), { kind: "pending", unitName: UNIT.name, toAdmins: false });
  });

  test("nessun documento con il profilo completo: come pending, senza unità ma non agli admin (il client chiama request)", () => {
    assert.deepEqual(banner({ member: null }), { kind: "pending", unitName: "", toAdmins: false });
  });

  test("toAdmins vale solo per pending: un documento fuori dal palo senza unità non è «agli admin»", () => {
    for (const status of OUT_STATUSES) {
      const result = banner({ access: "out", member: memberWith(status, { claimedUnitId: "", claimedUnitName: "" }) });
      assert.notEqual(result?.kind, "pending", status);
      assert.equal("toAdmins" in (result ?? {}), false, status);
    }
  });
});

describe("membershipBannerOf: rifiutato", () => {
  const declined = (overrides = {}) => banner({ access: "out", member: memberWith("declined", { decidedAtMs: NOW - 3 * DAY, declineCount: 1, decidedBy: "uid-admin", ...overrides }) });

  test("prima dei 7 giorni: retryAt = decidedAt + 7 giorni, senza «Chiedi di nuovo»", () => {
    const decidedAtMs = NOW - 3 * DAY;
    assert.deepEqual(declined({ decidedAtMs }), { kind: "declined", retryAtMs: decidedAtMs + 7 * DAY, canRetry: false, tooMany: false });
    assert.equal(DECLINE_COOLDOWN_MS, 7 * DAY, "tetto della spec: nuova richiesta solo dopo 7 giorni");
  });

  test("un attimo prima di retryAt: ancora niente bottone", () => {
    const decidedAtMs = NOW - 7 * DAY + 60_000;
    assert.equal(declined({ decidedAtMs }).canRetry, false);
  });

  test("dal giorno di retryAt: «Chiedi di nuovo»", () => {
    assert.equal(declined({ decidedAtMs: NOW - 7 * DAY }).canRetry, true, "esattamente 7 giorni dopo");
    assert.deepEqual(declined({ decidedAtMs: NOW - 8 * DAY }), { kind: "declined", retryAtMs: NOW - DAY, canRetry: true, tooMany: false });
  });

  test("dopo 3 rifiuti: tooMany, niente bottone nemmeno dopo i 7 giorni", () => {
    assert.equal(MAX_DECLINES, 3, "tetto della spec: massimo 3 rifiuti");
    assert.deepEqual(declined({ decidedAtMs: NOW - 30 * DAY, declineCount: 3 }), { kind: "declined", retryAtMs: null, canRetry: false, tooMany: true });
    assert.deepEqual(declined({ decidedAtMs: NOW - DAY, declineCount: 4 }), { kind: "declined", retryAtMs: null, canRetry: false, tooMany: true });
  });

  test("con 2 rifiuti si può ancora chiedere (dal giorno di retryAt)", () => {
    const result = declined({ decidedAtMs: NOW - 10 * DAY, declineCount: 2 });
    assert.equal(result.tooMany, false);
    assert.equal(result.canRetry, true);
  });
});

describe("membershipBannerOf: fuori dal palo", () => {
  test("withdrawn: «Non fai parte di nessun palo» con «Chiedi di entrare»", () => {
    assert.deepEqual(banner({ access: "out", member: memberWith("withdrawn") }), { kind: "withdrawn" });
  });

  test("removed e blocked: lo stesso banner «Non fai più parte di questo palo», nessuna azione", () => {
    assert.deepEqual(banner({ access: "out", member: memberWith("removed") }), { kind: "removed" });
    assert.deepEqual(banner({ access: "out", member: memberWith("blocked") }), { kind: "removed" });
  });

  test("i testi del banner esistono e non rivelano il motivo del rifiuto", () => {
    assert.equal(PALO.fuoriTitolo, "Non fai parte di nessun palo");
    assert.equal(PALO.rimossoTitolo, "Non fai più parte di questo palo");
    assert.equal(PALO.attesaTitolo, "Stiamo verificando che tu faccia parte del palo");
    assert.equal(PALO.rifiutoTitolo, "Non siamo riusciti a confermare che fai parte del palo");
    assert.equal(PALO.nonRicordiAccount, "Non ricordi con quale account sei entrato?");
    assert.equal(PALO.chiediDiEntrare, "Chiedi di entrare");
    assert.equal(PALO.chiediDiNuovo, "Chiedi di nuovo");
    assert.equal(PALO.ritiraRichiesta, "Ritira la richiesta");
    // "Ho sbagliato palo" arriva con la scelta del palo (S3): oggi il profilo
    // non la offre e il bottone porterebbe in un vicolo cieco.
    assert.equal("hoSbagliatoPalo" in PALO, false);
    assert.equal(PALO.chiVerifica, "Chi verifica?");
    assert.doesNotMatch(PALO.rifiutoCorpo, /nome|data di nascita|account/iu, "il motivo interno non arriva al richiedente");
  });

  test("in coda senza unità: «Lo conferma un admin del palo.», senza un dirigente che verifica", () => {
    assert.equal(PALO.attesaCorpoAdmin, "Lo conferma un admin del palo. Intanto puoi iscriverti alle attività.");
    assert.doesNotMatch(PALO.attesaCorpoAdmin, /dirigente/u, "senza unità non c'è un dirigente che verifica");
    assert.match(PALO.chiVerificaCorpoAdmin, /^Un admin del palo conferma che ti conosce/u);
    assert.match(PALO.chiVerificaCorpo, /^Un dirigente della tua unità o un admin del palo/u);
    assert.notEqual(PALO.chiVerificaCorpoAdmin, PALO.chiVerificaCorpo);
    for (const key of ["attesaCorpoAdmin", "chiVerificaCorpoAdmin"]) {
      assert.doesNotMatch(PALO[key], ENGLISH, key);
      assert.doesNotMatch(PALO[key], /[a-z]'(?=\s|$)/u, `${key}: apostrofo al posto dell'accento`);
    }
  });
});

// ---------------------------------------------------------------------------
// Date in italiano
// ---------------------------------------------------------------------------
describe("fromDateLabel e onDateLabel", () => {
  test("«dal» davanti a consonante, «dall'» davanti a 8 e 11, «1°» per il primo del mese", () => {
    assert.equal(fromDateLabel(local(2026, 10, 28)), "dal 28 ottobre");
    assert.equal(fromDateLabel(local(2026, 10, 8)), "dall'8 ottobre");
    assert.equal(fromDateLabel(local(2026, 10, 11)), "dall'11 ottobre");
    assert.equal(fromDateLabel(local(2026, 11, 1)), "dal 1° novembre");
    assert.equal(fromDateLabel(local(2026, 10, 18)), "dal 18 ottobre");
    assert.equal(fromDateLabel(local(2027, 1, 31)), "dal 31 gennaio");
  });

  test("«il» e «l'»", () => {
    assert.equal(onDateLabel(local(2026, 11, 1)), "il 1° novembre");
    assert.equal(onDateLabel(local(2026, 10, 8)), "l'8 ottobre");
    assert.equal(onDateLabel(local(2026, 10, 11)), "l'11 ottobre");
    assert.equal(onDateLabel(local(2026, 10, 18)), "il 18 ottobre");
    assert.equal(onDateLabel(local(2026, 12, 25)), "il 25 dicembre");
  });

  test("il giorno è quello locale anche a mezzanotte e un minuto", () => {
    assert.equal(onDateLabel(local(2026, 10, 8, 0, 1)), "l'8 ottobre");
    assert.equal(fromDateLabel(local(2026, 10, 28, 23, 59)), "dal 28 ottobre");
  });

  test("l'apostrofo è quello dritto, mai un accento al suo posto", () => {
    assert.ok(fromDateLabel(local(2026, 10, 8)).startsWith("dall'"));
    assert.ok(onDateLabel(local(2026, 10, 8)).startsWith("l'"));
  });
});

// ---------------------------------------------------------------------------
// Coda dello staff
// ---------------------------------------------------------------------------
describe("waitingLabel: da quanto aspetta, in giorni di calendario", () => {
  test("stesso giorno: «da oggi»", () => {
    assert.equal(waitingLabel(NOW - 3 * HOUR, NOW), PALO.inAttesaOggi);
    assert.equal(waitingLabel(NOW - 3 * HOUR, NOW), "da oggi");
    assert.equal(waitingLabel(NOW, NOW), "da oggi");
  });

  test("ieri alle 23:00 e ora le 09:00: «da ieri», non «da oggi» (10 ore)", () => {
    const now = local(2026, 10, 21, 9);
    const requestedAt = local(2026, 10, 20, 23);
    assert.equal(waitingLabel(requestedAt, now), PALO.inAttesaIeri);
    assert.equal(waitingLabel(requestedAt, now), "da ieri");
  });

  test("N giorni: «da N giorni», contando i giorni di calendario", () => {
    assert.equal(waitingLabel(NOW - 3 * DAY, NOW), "da 3 giorni");
    assert.equal(waitingLabel(local(2026, 10, 1, 23, 30), local(2026, 10, 21, 0, 30)), "da 20 giorni");
    assert.equal(waitingLabel(NOW - 45 * DAY, NOW), "da 45 giorni");
  });

  test("senza data: stringa vuota", () => {
    assert.equal(waitingLabel(null, NOW), "");
  });

  test("data nel futuro (orologio del telefono avanti): «da oggi», niente numeri negativi", () => {
    assert.equal(waitingLabel(NOW + 2 * DAY, NOW), "da oggi");
  });
});

const named = (status, name, extra = {}) => memberWith(status, { uid: `uid-${name.toLowerCase().replace(/\s+/gu, "-")}`, displayName: name, ...extra });

describe("pendingQueue: le richieste in attesa, dalla più vecchia", () => {
  test("solo pending, in ordine di requestedAt crescente", () => {
    const members = [
      named("pending", "Carla Verdi", { requestedAtMs: NOW - DAY }),
      named("active", "Anna Attiva", { requestedAtMs: NOW - 90 * DAY }),
      named("pending", "Bruno Neri", { requestedAtMs: NOW - 10 * DAY }),
      named("declined", "Dario Rifiutato", { requestedAtMs: NOW - 20 * DAY }),
      named("pending", "Elena Gialli", { requestedAtMs: NOW - 5 * DAY }),
      named("withdrawn", "Fabio Uscito", { requestedAtMs: NOW - 30 * DAY }),
      named("blocked", "Gino Bloccato", { requestedAtMs: NOW - 40 * DAY }),
    ];
    assert.deepEqual(pendingQueue(members).map((m) => m.displayName), ["Bruno Neri", "Elena Gialli", "Carla Verdi"]);
  });

  test("la richiesta passata agli admin (claimedUnitId vuoto) resta in coda", () => {
    const passed = named("pending", "Senza Unità", { claimedUnitId: "", previous: { action: "notMyUnit", by: "uid-dirigente", status: "pending" } });
    assert.deepEqual(pendingQueue([passed]).map((m) => m.uid), [passed.uid]);
  });

  test("non modifica l'elenco ricevuto", () => {
    const members = [named("pending", "B", { requestedAtMs: NOW }), named("pending", "A", { requestedAtMs: NOW - DAY })];
    const ids = members.map((m) => m.uid);
    pendingQueue(members);
    assert.deepEqual(members.map((m) => m.uid), ids);
  });
});

describe("recentDeclined: le rifiutate degli ultimi 30 giorni, dalla più recente", () => {
  test("solo declined entro 30 giorni, dalla più recente", () => {
    const members = [
      named("declined", "Vecchia", { decidedAtMs: NOW - 31 * DAY }),
      named("declined", "Recente", { decidedAtMs: NOW - DAY }),
      named("declined", "Media", { decidedAtMs: NOW - 15 * DAY }),
      named("declined", "Al Limite", { decidedAtMs: NOW - 30 * DAY }),
      named("pending", "In Coda", { decidedAtMs: NOW - DAY }),
      named("removed", "Rimosso", { decidedAtMs: NOW - DAY }),
      named("withdrawn", "Uscito", { decidedAtMs: NOW - DAY }),
      named("blocked", "Bloccato", { decidedAtMs: NOW - DAY }),
    ];
    assert.deepEqual(recentDeclined(members, NOW).map((m) => m.displayName), ["Recente", "Media", "Al Limite"]);
    assert.equal(RECENT_WINDOW_MS, 30 * DAY);
  });

  test("una declined senza data di decisione non compare", () => {
    assert.deepEqual(recentDeclined([named("declined", "Senza Data", { decidedAtMs: null })], NOW), []);
  });
});

describe("reviewQueue: i membri migrati da confermare", () => {
  const members = [
    named("active", "Bea Recente", { reviewNeeded: true, decidedAtMs: NOW - 5 * DAY }),
    named("active", "Aldo Vecchio", { reviewNeeded: true, decidedAtMs: NOW - 45 * DAY }),
    named("active", "Carlo Confermato", { reviewNeeded: false, decidedAtMs: NOW - 45 * DAY }),
    named("pending", "Dina In Coda", { reviewNeeded: true, decidedAtMs: NOW - 45 * DAY }),
    named("declined", "Ennio Rifiutato", { reviewNeeded: true, decidedAtMs: NOW - 45 * DAY }),
    named("active", "Zoe Limite", { reviewNeeded: true, decidedAtMs: NOW - 30 * DAY }),
  ];

  test("solo active con reviewNeeded", () => {
    const names = reviewQueue(members, NOW, false).map((item) => item.member.displayName).sort();
    assert.deepEqual(names, ["Aldo Vecchio", "Bea Recente", "Zoe Limite"]);
  });

  test("admin: chi aspetta da più di 30 giorni è in cima e segnato overdue", () => {
    const items = reviewQueue(members, NOW, true);
    assert.deepEqual(items.map((item) => [item.member.displayName, item.overdue]), [
      ["Aldo Vecchio", true],
      ["Bea Recente", false],
      ["Zoe Limite", false],
    ]);
  });

  test("dirigente di unità: mai overdue, nessuna evidenza", () => {
    const items = reviewQueue(members, NOW, false);
    assert.ok(items.every((item) => item.overdue === false));
    assert.deepEqual(items.map((item) => item.member.displayName), ["Aldo Vecchio", "Bea Recente", "Zoe Limite"]);
  });

  test("esattamente 30 giorni non è «più di 30 giorni»", () => {
    const items = reviewQueue([named("active", "Zoe Limite", { reviewNeeded: true, decidedAtMs: NOW - 30 * DAY })], NOW, true);
    assert.equal(items[0].overdue, false);
    const over = reviewQueue([named("active", "Oltre", { reviewNeeded: true, decidedAtMs: NOW - 30 * DAY - 1 })], NOW, true);
    assert.equal(over[0].overdue, true);
  });
});

describe("canUndoDecline: «Annulla rifiuto»", () => {
  const declinedBy = (by, action = "decline") => memberWith("declined", { declineCount: 1, decidedBy: by, previous: { action, by, status: "pending" } });
  const admin = { isAdmin: true, uid: "uid-admin" };
  const leader = { isAdmin: false, uid: "uid-dirigente" };

  test("l'admin annulla ogni rifiuto, anche di un dirigente", () => {
    assert.equal(canUndoDecline(declinedBy("uid-dirigente"), admin), true);
    assert.equal(canUndoDecline(declinedBy("uid-altro-admin"), admin), true);
  });

  test("il dirigente annulla solo i propri rifiuti", () => {
    assert.equal(canUndoDecline(declinedBy("uid-dirigente"), leader), true);
    assert.equal(canUndoDecline(declinedBy("uid-admin"), leader), false);
    assert.equal(canUndoDecline(declinedBy("uid-altro-dirigente"), leader), false);
  });

  test("«Ha già un account» al richiedente appare come decline: si annulla come un rifiuto", () => {
    // Fase 3: nel documento che l'utente legge l'azione resta `decline`.
    assert.equal(canUndoDecline(declinedBy("uid-dirigente", "decline"), leader), true);
  });

  test("solo su declined con l'ultima azione decline", () => {
    assert.equal(canUndoDecline(memberWith("pending", { previous: { action: "decline", by: "uid-admin", status: "declined" } }), admin), false);
    assert.equal(canUndoDecline(memberWith("declined", { previous: null }), admin), false, "senza previous niente da annullare");
    assert.equal(canUndoDecline(memberWith("declined", { previous: { action: "block", by: "uid-admin", status: "pending" } }), admin), false);
    assert.equal(canUndoDecline(memberWith("declined", { previous: { action: "undo", by: "uid-admin", status: "pending" } }), admin), false);
    for (const status of ["active", "withdrawn", "removed", "blocked"]) {
      assert.equal(canUndoDecline(memberWith(status, { previous: { action: "decline", by: "uid-admin", status: "pending" } }), admin), false, status);
    }
  });
});

describe("etichette della coda", () => {
  test("wasPassedByUnitLeader: pending con previous.action notMyUnit", () => {
    assert.equal(wasPassedByUnitLeader(memberWith("pending", { claimedUnitId: "", previous: { action: "notMyUnit", by: "uid-dirigente", status: "pending" } })), true);
    assert.equal(wasPassedByUnitLeader(memberWith("pending")), false);
    assert.equal(wasPassedByUnitLeader(memberWith("pending", { previous: { action: "decline", by: "uid-admin", status: "declined" } })), false);
    assert.equal(wasPassedByUnitLeader(memberWith("active", { previous: { action: "notMyUnit", by: "uid-dirigente", status: "pending" } })), false);
  });

  // Scelta S2-3 (2026-10-22): "Non lo conosco" del dirigente passa la richiesta
  // agli admin con l'unità svuotata; dall'admin l'unità resta e non c'è etichetta.
  // Review del 2026-10-22: l'etichetta vuole anche che l'unità ci fosse
  // (`previous.claimedUnitId` pieno), così un migrato già senza unità segnato
  // dall'admin non passa per "il dirigente non lo conosce".
  const unknownByLeader = (status = "pending", extra = {}) =>
    memberWith(status, { claimedUnitId: "", previous: { action: "markUnknown", by: "uid-dirigente", status: "active", claimedUnitId: UNIT.id }, ...extra });
  const unknownByAdmin = (extra = {}) =>
    memberWith("pending", { previous: { action: "markUnknown", by: "uid-admin", status: "active", claimedUnitId: UNIT.id }, ...extra });

  test("wasUnknownToUnitLeader: solo pending con previous.action markUnknown, unità svuotata e previous.claimedUnitId pieno", () => {
    assert.equal(wasUnknownToUnitLeader(unknownByLeader()), true);
    // Dall'admin l'unità resta: la richiesta torna nella coda del dirigente senza etichetta.
    assert.equal(wasUnknownToUnitLeader(unknownByAdmin()), false);
    assert.equal(wasUnknownToUnitLeader(unknownByLeader("pending", { claimedUnitId: UNIT.id })), false);
    // Migrato già senza unità segnato dall'admin: l'unità non c'era, nessuno l'ha svuotata.
    assert.equal(wasUnknownToUnitLeader(unknownByAdmin({ claimedUnitId: "", claimedUnitName: "", previous: { action: "markUnknown", by: "uid-admin", status: "active", claimedUnitId: "" } })), false);
    assert.equal(wasUnknownToUnitLeader(unknownByLeader("pending", { previous: { action: "markUnknown", by: "uid-dirigente", status: "active", claimedUnitId: "" } })), false);
    // «Non è della mia unità» ha la sua etichetta, non questa.
    assert.equal(wasUnknownToUnitLeader(memberWith("pending", { claimedUnitId: "", previous: { action: "notMyUnit", by: "uid-dirigente", status: "pending", claimedUnitId: UNIT.id } })), false);
    // Solo in coda: dopo «Annulla» (active) o un rifiuto (declined) niente etichetta.
    assert.equal(wasUnknownToUnitLeader(unknownByLeader("active")), false);
    assert.equal(wasUnknownToUnitLeader(unknownByLeader("declined")), false);
    for (const status of OUT_STATUSES) assert.equal(wasUnknownToUnitLeader(unknownByLeader(status)), false, status);
    // Unità vuota per altri motivi (profilo senza unità) o nessuna azione precedente.
    assert.equal(wasUnknownToUnitLeader(memberWith("pending", { claimedUnitId: "" })), false);
    assert.equal(wasUnknownToUnitLeader(memberWith("pending", { claimedUnitId: "", previous: { action: "decline", by: "uid-admin", status: "declined", claimedUnitId: UNIT.id } })), false);
    assert.equal(wasUnknownToUnitLeader(memberWith("pending")), false);
  });

  test("le due etichette non si sovrappongono: markUnknown non è «Passata dal dirigente», notMyUnit non è «Il dirigente non lo conosce»", () => {
    const passed = memberWith("pending", { claimedUnitId: "", previous: { action: "notMyUnit", by: "uid-dirigente", status: "pending", claimedUnitId: UNIT.id } });
    assert.equal(wasPassedByUnitLeader(unknownByLeader()), false);
    assert.equal(wasPassedByUnitLeader(unknownByAdmin()), false);
    assert.equal(wasUnknownToUnitLeader(passed), false);
    assert.equal(wasPassedByUnitLeader(passed), true);
  });

  test("i testi di S2-3: «Il dirigente non lo conosce» e la spiegazione per il dirigente dice che passa agli admin", () => {
    assert.equal(PALO.nonLoConosceIlDirigente, "Il dirigente non lo conosce");
    assert.equal(PALO.passataDalDirigente, "Passata dal dirigente");
    assert.equal(typeof PALO.daConfermareSpiegaDirigente, "string");
    assert.match(PALO.daConfermareSpiegaDirigente, /passa agli admin/u, "dal dirigente la richiesta passa agli admin");
    assert.match(PALO.daConfermareSpiega, /torna in coda/u, "dall'admin resta in coda");
    assert.notEqual(PALO.daConfermareSpiegaDirigente, PALO.daConfermareSpiega, "due testi: dirigente e admin");
    for (const key of ["nonLoConosceIlDirigente", "daConfermareSpiegaDirigente", "daConfermareSpiega", "passataDalDirigente"]) {
      assert.doesNotMatch(PALO[key], ENGLISH, key);
      assert.doesNotMatch(PALO[key], /[a-z]'(?=\s|$)/u, `${key}: apostrofo al posto dell'accento`);
    }
  });

  test("isMigratedAccount: «Account esistente» dal motivo migration", () => {
    assert.equal(isMigratedAccount(memberWith("pending", { sourceKinds: ["migration"] })), true);
    assert.equal(isMigratedAccount(memberWith("active", { sourceKinds: ["staff_approval", "migration"] })), true);
    assert.equal(isMigratedAccount(memberWith("pending", { sourceKinds: ["manual_registration"] })), false);
    assert.equal(isMigratedAccount(memberWith("pending", { sourceKinds: [] })), false);
  });

  test("initialsOf: prima lettera del primo e dell'ultimo nome, maiuscole", () => {
    assert.equal(initialsOf("Marco Rossi"), "MR");
    assert.equal(initialsOf("anna maria bianchi"), "AB");
    assert.equal(initialsOf("  Luca   De  Santis  "), "LS");
    assert.equal(initialsOf("Giulia"), "G");
    assert.equal(initialsOf("élodie dupont"), "ÉD");
    assert.equal(initialsOf(""), "?");
    assert.equal(initialsOf("   "), "?");
  });
});

// ---------------------------------------------------------------------------
// Lettura del documento: `mapStakeMember`
// ---------------------------------------------------------------------------
const timestamp = (ms) => ({ toMillis: () => ms, seconds: Math.floor(ms / 1000), nanoseconds: 0 });

describe("mapStakeMember", () => {
  const full = () => ({
    status: "pending",
    sources: [{ kind: "migration", ref: "a3-2026-10", at: timestamp(NOW - 100 * DAY) }, { kind: "parent_link", ref: "reg-1", at: timestamp(NOW) }],
    previous: { action: "notMyUnit", by: "uid-dirigente", status: "pending", sources: [], staffRole: null },
    staffRole: null,
    claimedUnitId: " unit-1 ",
    claimedUnitName: "Rione Uno",
    displayName: "Marco Rossi",
    birthYear: 2009,
    registrationHints: [
      { activityId: "act-1", title: "Viaggio al tempio" },
      { activityId: "act-2" },
      null,
      "testo",
      { activityId: "act-3", title: "Campeggio 2026" },
    ],
    reviewNeeded: false,
    requestedAt: timestamp(NOW - 2 * DAY),
    decidedAt: null,
    decidedBy: "",
    declineCount: 0,
    version: 4,
  });

  test("documento completo: tutti i campi della spec", () => {
    const member = mapStakeMember(STAKE, "uid-marco", full());
    assert.deepEqual(member, {
      uid: "uid-marco",
      stakeId: STAKE,
      status: "pending",
      staffRole: null,
      claimedUnitId: "unit-1",
      claimedUnitName: "Rione Uno",
      displayName: "Marco Rossi",
      birthYear: 2009,
      registrationHints: [
        { activityId: "act-1", title: "Viaggio al tempio" },
        { activityId: "act-3", title: "Campeggio 2026" },
      ],
      reviewNeeded: false,
      requestedAtMs: NOW - 2 * DAY,
      decidedAtMs: null,
      decidedBy: "",
      declineCount: 0,
      version: 4,
      sourceKinds: ["migration", "parent_link"],
      previous: { action: "notMyUnit", by: "uid-dirigente", status: "pending", claimedUnitId: "" },
    });
  });

  test("stato sconosciuto o assente: null (il documento non si usa)", () => {
    assert.equal(mapStakeMember(STAKE, "u", { ...full(), status: "approved" }), null);
    assert.equal(mapStakeMember(STAKE, "u", { ...full(), status: "" }), null);
    const { status: _status, ...withoutStatus } = full();
    assert.equal(mapStakeMember(STAKE, "u", withoutStatus), null);
    assert.equal(mapStakeMember(STAKE, "u", {}), null);
  });

  for (const status of STATUSES) {
    test(`stato ${status}: letto com'è`, () => {
      assert.equal(mapStakeMember(STAKE, "u", { ...full(), status }).status, status);
    });
  }

  test("Timestamp di Firestore (toMillis) e stringhe ISO: entrambi in millisecondi", () => {
    const requested = local(2026, 10, 18, 10);
    const decided = local(2026, 10, 20, 18);
    const fromTimestamp = mapStakeMember(STAKE, "u", { ...full(), status: "declined", requestedAt: timestamp(requested), decidedAt: timestamp(decided) });
    assert.equal(fromTimestamp.requestedAtMs, requested);
    assert.equal(fromTimestamp.decidedAtMs, decided);
    const fromIso = mapStakeMember(STAKE, "u", { ...full(), status: "declined", requestedAt: new Date(requested).toISOString(), decidedAt: new Date(decided).toISOString() });
    assert.equal(fromIso.requestedAtMs, requested);
    assert.equal(fromIso.decidedAtMs, decided);
  });

  test("date assenti o non leggibili: null, niente NaN", () => {
    const member = mapStakeMember(STAKE, "u", { ...full(), requestedAt: undefined, decidedAt: "non è una data" });
    assert.equal(member.requestedAtMs, null);
    assert.equal(member.decidedAtMs, null);
  });

  test("previous: azione, autore, stato e unità di prima; stato sconosciuto diventa null; assente resta null", () => {
    assert.deepEqual(mapStakeMember(STAKE, "u", { ...full(), previous: { action: "decline", by: "uid-admin", status: "pending" } }).previous, { action: "decline", by: "uid-admin", status: "pending", claimedUnitId: "" });
    assert.deepEqual(mapStakeMember(STAKE, "u", { ...full(), previous: { action: "decline", by: "uid-admin", status: "boh" } }).previous, { action: "decline", by: "uid-admin", status: null, claimedUnitId: "" });
    // L'unità di prima serve all'etichetta "Il dirigente non lo conosce" (review S2-3).
    assert.deepEqual(
      mapStakeMember(STAKE, "u", { ...full(), claimedUnitId: "", previous: { action: "markUnknown", by: "uid-dirigente", status: "active", claimedUnitId: UNIT.id } }).previous,
      { action: "markUnknown", by: "uid-dirigente", status: "active", claimedUnitId: UNIT.id },
    );
    assert.equal(mapStakeMember(STAKE, "u", { ...full(), previous: { action: "markUnknown", by: "uid-admin", status: "active", claimedUnitId: 7 } }).previous.claimedUnitId, "", "un valore non stringa vale come vuoto");
    assert.equal(mapStakeMember(STAKE, "u", { ...full(), previous: null }).previous, null);
    const { previous: _previous, ...withoutPrevious } = full();
    assert.equal(mapStakeMember(STAKE, "u", withoutPrevious).previous, null);
    assert.equal(mapStakeMember(STAKE, "u", { ...full(), previous: "decline" }).previous, null);
  });

  test("registrationHints: solo le voci con un titolo; valori strani ignorati", () => {
    assert.deepEqual(mapStakeMember(STAKE, "u", { ...full(), registrationHints: "no" }).registrationHints, []);
    assert.deepEqual(mapStakeMember(STAKE, "u", { ...full(), registrationHints: undefined }).registrationHints, []);
    assert.deepEqual(
      mapStakeMember(STAKE, "u", { ...full(), registrationHints: [{ title: " Solo titolo " }, { activityId: 5, title: "Numero" }] }).registrationHints,
      [{ activityId: "", title: "Solo titolo" }, { activityId: "", title: "Numero" }],
    );
  });

  test("staffRole: solo admin o unit_leader, altrimenti null", () => {
    assert.equal(mapStakeMember(STAKE, "u", { ...full(), staffRole: "admin" }).staffRole, "admin");
    assert.equal(mapStakeMember(STAKE, "u", { ...full(), staffRole: "unit_leader" }).staffRole, "unit_leader");
    assert.equal(mapStakeMember(STAKE, "u", { ...full(), staffRole: "super_admin" }).staffRole, null);
    assert.equal(mapStakeMember(STAKE, "u", { ...full(), staffRole: undefined }).staffRole, null);
  });

  test("valori mancanti: reviewNeeded false, contatori a 0, birthYear null, sources vuote", () => {
    const member = mapStakeMember(STAKE, "u", { status: "active" });
    assert.equal(member.reviewNeeded, false);
    assert.equal(member.declineCount, 0);
    assert.equal(member.version, 0);
    assert.equal(member.birthYear, null);
    assert.deepEqual(member.sourceKinds, []);
    assert.equal(member.displayName, "");
    assert.equal(member.claimedUnitId, "");
    assert.equal(mapStakeMember(STAKE, "u", { status: "active", reviewNeeded: "true" }).reviewNeeded, false, "solo il booleano true");
    assert.equal(mapStakeMember(STAKE, "u", { status: "active", birthYear: "2009" }).birthYear, null);
  });

  test("sources: solo i kind, voci non valide saltate", () => {
    assert.deepEqual(mapStakeMember(STAKE, "u", { status: "active", sources: [{ kind: "link_code" }, null, { ref: "x" }, "migration", { kind: " staff_invite " }] }).sourceKinds, ["link_code", "staff_invite"]);
  });
});

// ---------------------------------------------------------------------------
// Errori della callable: `membershipErrorMessage`
// ---------------------------------------------------------------------------
/** Errore come lo lancia l'SDK Functions: FirebaseError con `code` e `details`. */
function callableError(code, message, details) {
  return Object.assign(new FirebaseError(`functions/${code}`, message), details === undefined ? {} : { details });
}
const precondition = (reason, extra = {}, message = "Operazione non consentita in questo stato.") =>
  callableError("failed-precondition", message, { reason, ...extra });
// Parole dei messaggi inglesi di Firebase che non devono arrivare all'utente
// («errore» italiano non c'è apposta: contiene "error").
const ENGLISH = /insufficient|permission|denied|failed|precondition|internal|not found|unauthenticated/iu;

describe("membershipErrorMessage: un messaggio italiano per ogni details.reason", () => {
  test("version_conflict: «Nel frattempo qualcuno ha cambiato questa persona.»", () => {
    assert.equal(membershipErrorMessage(precondition("version_conflict")), "Nel frattempo qualcuno ha cambiato questa persona.");
    assert.equal(membershipErrorMessage(precondition("version_conflict")), PALO.erroreVersione);
  });

  test("nothing_to_undo", () => {
    assert.equal(membershipErrorMessage(precondition("nothing_to_undo")), PALO.erroreNienteDaAnnullare);
  });

  test("invalid_state: la situazione è cambiata", () => {
    assert.equal(membershipErrorMessage(precondition("invalid_state")), PALO.erroreStato);
  });

  test("too_many_declines: niente bottone, parla con un dirigente", () => {
    assert.equal(membershipErrorMessage(precondition("too_many_declines")), PALO.erroreTroppiRifiuti);
  });

  test("profile_incomplete e stake_not_chosen: completa il profilo", () => {
    assert.equal(membershipErrorMessage(precondition("profile_incomplete")), PALO.erroreProfilo);
    assert.equal(membershipErrorMessage(precondition("stake_not_chosen")), PALO.erroreProfilo);
  });

  test("last_admin su sé stesso (self: true): «Sei l'ultimo admin del palo: prima nominane un altro.»", () => {
    assert.equal(membershipErrorMessage(precondition("last_admin"), { self: true }), PALO.erroreUltimoAdminTuo);
    assert.equal(PALO.erroreUltimoAdminTuo, "Sei l'ultimo admin del palo: prima nominane un altro.");
  });

  test("last_admin su un altro (senza self): non la frase «tuo», ma un testo italiano", () => {
    const serverMessage = "Non puoi rimuovere l'ultimo admin del palo.";
    const message = membershipErrorMessage(precondition("last_admin", {}, serverMessage));
    assert.notEqual(message, PALO.erroreUltimoAdminTuo);
    assert.equal(message, serverMessage, "il messaggio italiano della callable passa così com'è");
    assert.doesNotMatch(message, ENGLISH);
    assert.notEqual(membershipErrorMessage(precondition("last_admin", {}, serverMessage), { self: false }), PALO.erroreUltimoAdminTuo);
  });

  test("cooldown con retryAt: «Potrai chiedere di nuovo dal 28 ottobre.»", () => {
    const retryAt = new Date(local(2026, 10, 28)).toISOString();
    assert.equal(membershipErrorMessage(precondition("cooldown", { retryAt })), "Potrai chiedere di nuovo dal 28 ottobre.");
  });

  test("cooldown con retryAt l'8: «dall'8 ottobre»; il 1°: «dal 1° novembre»", () => {
    assert.equal(membershipErrorMessage(precondition("cooldown", { retryAt: new Date(local(2026, 10, 8)).toISOString() })), "Potrai chiedere di nuovo dall'8 ottobre.");
    assert.equal(membershipErrorMessage(precondition("cooldown", { retryAt: new Date(local(2026, 11, 1)).toISOString() })), "Potrai chiedere di nuovo dal 1° novembre.");
  });

  test("cooldown senza retryAt leggibile: un testo italiano, non la frase con la data", () => {
    for (const details of [{ reason: "cooldown" }, { reason: "cooldown", retryAt: "boh" }, { reason: "cooldown", retryAt: 12345 }]) {
      const message = membershipErrorMessage(callableError("failed-precondition", "Puoi chiedere di nuovo fra qualche giorno.", details));
      assert.doesNotMatch(message, /\{dal\}|undefined|NaN|Invalid/u);
      assert.doesNotMatch(message, ENGLISH);
      assert.ok(message.length > 0);
    }
  });
});

describe("membershipErrorMessage: errori senza reason, mai in inglese", () => {
  test("permission-denied di Firestore: la frase generica con il codice, non il messaggio inglese", () => {
    const message = membershipErrorMessage(new FirebaseError("permission-denied", "Missing or insufficient permissions."));
    assert.equal(message, `${PALO.erroreGenerico} (codice: permission-denied)`);
    assert.ok(!message.includes("Missing or insufficient"), message);
  });

  test("functions/internal con un messaggio inglese: la frase generica con il codice", () => {
    const message = membershipErrorMessage(callableError("internal", "INTERNAL"));
    assert.ok(message.startsWith(PALO.erroreGenerico), message);
    assert.ok(!message.includes("INTERNAL"), message);
  });

  test("functions/permission-denied senza messaggio nostro: niente inglese", () => {
    const message = membershipErrorMessage(callableError("permission-denied", "PERMISSION_DENIED"));
    assert.ok(message.startsWith(PALO.erroreGenerico), message);
    assert.ok(!message.includes("PERMISSION_DENIED"), message);
  });

  test("functions/unauthenticated con il messaggio di default dell'SDK: niente inglese", () => {
    const message = membershipErrorMessage(callableError("unauthenticated", "unauthenticated"));
    assert.ok(message.startsWith(PALO.erroreGenerico), message);
    assert.ok(!/unauthenticated/iu.test(message.replace(/\(codice: [^)]+\)/u, "")), message);
  });

  test("messaggio italiano della callable (not-found, permission-denied): passa così com'è", () => {
    assert.equal(membershipErrorMessage(callableError("not-found", "Il palo non esiste.")), "Il palo non esiste.");
    assert.equal(membershipErrorMessage(callableError("permission-denied", "Non puoi agire su questa persona.")), "Non puoi agire su questa persona.");
  });

  test("errori del browser (TypeError «Failed to fetch»): la frase generica", () => {
    assert.equal(membershipErrorMessage(new TypeError("Failed to fetch")), PALO.erroreGenerico);
  });

  test("valori strani: la frase generica", () => {
    assert.equal(membershipErrorMessage(undefined), PALO.erroreGenerico);
    assert.equal(membershipErrorMessage(null), PALO.erroreGenerico);
    assert.equal(membershipErrorMessage({}), PALO.erroreGenerico);
    assert.equal(membershipErrorMessage(new Error("")), PALO.erroreGenerico);
    assert.equal(membershipErrorMessage({ details: { reason: "sconosciuta" } }), PALO.erroreGenerico);
  });

  test("un errore con un reason che non conosciamo non rompe niente", () => {
    const message = membershipErrorMessage(precondition("qualcosa_di_nuovo", {}, "Testo italiano del server."));
    assert.equal(message, "Testo italiano del server.");
  });

  test("tutte le frasi degli errori sono italiane con gli accenti veri", () => {
    for (const key of ["erroreUltimoAdminTuo", "erroreTroppiRifiuti", "erroreVersione", "erroreNienteDaAnnullare", "erroreStato", "erroreProfilo", "erroreGenerico"]) {
      const value = PALO[key];
      assert.equal(typeof value, "string", key);
      assert.doesNotMatch(value, ENGLISH, key);
      assert.doesNotMatch(value, /[a-z]'(?=\s|$)/u, `${key}: apostrofo al posto dell'accento`);
    }
  });
});
