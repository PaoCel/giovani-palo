import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRegistrationStatusOnSave } from "../src/utils/registrationStatus.ts";

const existing = (registrationStatus, parentAuthorizationStatus = null) => ({
  registrationStatus,
  parentAuthorization: parentAuthorizationStatus ? { status: parentAuthorizationStatus } : null,
});

test("una nuova iscrizione parte dallo stato richiesto dal modulo", () => {
  assert.equal(resolveRegistrationStatusOnSave(null, "active"), "active");
  assert.equal(
    resolveRegistrationStatusOnSave(null, "pending_parent_authorization"),
    "pending_parent_authorization",
  );
});

test("un'iscrizione esistente conserva lo stato deciso da genitore e admin", () => {
  assert.equal(resolveRegistrationStatusOnSave(existing("confirmed"), "active"), "confirmed");
  assert.equal(
    resolveRegistrationStatusOnSave(existing("pending_parent_authorization"), "active"),
    "pending_parent_authorization",
  );
  assert.equal(
    resolveRegistrationStatusOnSave(existing("rejected_by_parent"), "active"),
    "rejected_by_parent",
  );
});

test("risalvare un'iscrizione annullata la riattiva", () => {
  assert.equal(resolveRegistrationStatusOnSave(existing("cancelled"), "active"), "active");
  assert.equal(
    resolveRegistrationStatusOnSave(existing("cancelled"), "pending_parent_authorization"),
    "pending_parent_authorization",
  );
});

test("l'autorizzazione già firmata non viene richiesta di nuovo", () => {
  assert.equal(
    resolveRegistrationStatusOnSave(
      existing("cancelled", "authorized"),
      "pending_parent_authorization",
    ),
    "active",
  );
  assert.equal(
    resolveRegistrationStatusOnSave(
      existing("cancelled", "email_sent"),
      "pending_parent_authorization",
    ),
    "pending_parent_authorization",
  );
});

test("l'annullamento richiesto vince su qualsiasi stato precedente", () => {
  assert.equal(resolveRegistrationStatusOnSave(existing("confirmed"), "cancelled"), "cancelled");
  assert.equal(resolveRegistrationStatusOnSave(null, "cancelled"), "cancelled");
});

test("i dati del genitore nel modulo impongono l'autorizzazione", () => {
  // buildChildPrefill passa al modulo una Registration sintetica "active":
  // senza questa guardia il minore risultava iscritto senza consenso.
  assert.equal(
    resolveRegistrationStatusOnSave(null, "active", { parentAuthorizationRequested: true }),
    "pending_parent_authorization",
  );
  assert.equal(
    resolveRegistrationStatusOnSave(existing("cancelled"), "active", {
      parentAuthorizationRequested: true,
    }),
    "pending_parent_authorization",
  );
});

test("un consenso già firmato non viene richiesto una seconda volta", () => {
  assert.equal(
    resolveRegistrationStatusOnSave(existing("cancelled", "authorized"), "active", {
      parentAuthorizationRequested: true,
    }),
    "active",
  );
});

test("un'iscrizione già confermata non torna indietro", () => {
  assert.equal(
    resolveRegistrationStatusOnSave(existing("confirmed", "authorized"), "active", {
      parentAuthorizationRequested: true,
    }),
    "confirmed",
  );
});

// --- Attiva senza firma che ora chiede il genitore -------------------------
// Il titolare che corregge la data di nascita (meno di 18 anni in un'attività
// con autorizzazione) restava attivo senza consenso: se il modulo raccoglie il
// genitore, un'iscrizione attiva senza firma né rifiuto passa in attesa. Le
// rules (`validRegistrationUpdate`) ammettono il passaggio; il trigger lo
// tratta come un ingresso in attesa, cioè link e mail nuovi.

const IN_ATTESA = "pending_parent_authorization";
const CON_GENITORE = { parentAuthorizationRequested: true };

// Autorizzazioni che il trigger non considera decise: tutte, tranne firma e rifiuto.
const AUTORIZZAZIONI_NON_DECISE = [
  null,
  "not_required",
  "pending_request",
  "pending_parent_authorization",
  "email_sent",
  "email_error",
  "expired",
  "revoked",
  "invalidated",
];

test("un'iscrizione attiva senza firma passa in attesa se il modulo raccoglie il genitore", () => {
  for (const autorizzazione of AUTORIZZAZIONI_NON_DECISE) {
    assert.equal(
      resolveRegistrationStatusOnSave(existing("active", autorizzazione), "pending_parent_authorization", CON_GENITORE),
      IN_ATTESA,
      String(autorizzazione),
    );
  }
});

test("attiva senza firma: passa in attesa anche se il modulo chiedeva \"active\"", () => {
  // I dati del genitore valgono quanto lo stato richiesto.
  assert.equal(resolveRegistrationStatusOnSave(existing("active"), "active", CON_GENITORE), IN_ATTESA);
  assert.equal(
    resolveRegistrationStatusOnSave(existing("active", "email_sent"), "active", CON_GENITORE),
    IN_ATTESA,
  );
});

test("attiva con la firma o il rifiuto del genitore resta com'è", () => {
  for (const decisione of ["authorized", "rejected_by_parent"]) {
    for (const richiesto of ["active", IN_ATTESA]) {
      assert.equal(
        resolveRegistrationStatusOnSave(existing("active", decisione), richiesto, CON_GENITORE),
        "active",
        `${decisione} richiesto ${richiesto}`,
      );
    }
  }
});

test("attiva senza i dati del genitore nel modulo resta attiva", () => {
  // Adulto, o attività che non chiede l'autorizzazione: il modulo non raccoglie il genitore.
  for (const autorizzazione of AUTORIZZAZIONI_NON_DECISE) {
    for (const opzioni of [undefined, {}, { parentAuthorizationRequested: false }]) {
      assert.equal(
        resolveRegistrationStatusOnSave(existing("active", autorizzazione), "active", opzioni),
        "active",
        `${autorizzazione} ${JSON.stringify(opzioni)}`,
      );
    }
  }
});

test("solo l'attiva cambia: gli altri stati esistenti si conservano anche con i dati del genitore", () => {
  for (const stato of ["confirmed", IN_ATTESA, "rejected_by_parent", "waitlist", "submitted", "draft"]) {
    for (const autorizzazione of [null, "email_sent", "authorized", "rejected_by_parent"]) {
      for (const richiesto of ["active", IN_ATTESA]) {
        assert.equal(
          resolveRegistrationStatusOnSave(existing(stato, autorizzazione), richiesto, CON_GENITORE),
          stato,
          `${stato} + ${autorizzazione} richiesto ${richiesto}`,
        );
      }
    }
  }
});

test("l'annullamento richiesto vince anche su un'attiva che entrerebbe in attesa", () => {
  assert.equal(resolveRegistrationStatusOnSave(existing("active"), "cancelled", CON_GENITORE), "cancelled");
  assert.equal(
    resolveRegistrationStatusOnSave(existing("active", "authorized"), "cancelled", CON_GENITORE),
    "cancelled",
  );
});

test("l'annullata resta una reiscrizione: firmata torna attiva, il rifiuto e il resto tornano in attesa", () => {
  assert.equal(resolveRegistrationStatusOnSave(existing("cancelled", "authorized"), "active", CON_GENITORE), "active");
  for (const autorizzazione of AUTORIZZAZIONI_NON_DECISE.filter(Boolean).concat("rejected_by_parent")) {
    assert.equal(
      resolveRegistrationStatusOnSave(existing("cancelled", autorizzazione), "active", CON_GENITORE),
      IN_ATTESA,
      autorizzazione,
    );
  }
  // Senza i dati del genitore, un'annullata riattivata dal modulo torna attiva.
  assert.equal(resolveRegistrationStatusOnSave(existing("cancelled"), "active"), "active");
});

test("una nuova iscrizione con i dati del genitore parte in attesa, senza di loro attiva", () => {
  assert.equal(resolveRegistrationStatusOnSave(null, "active", CON_GENITORE), IN_ATTESA);
  assert.equal(resolveRegistrationStatusOnSave(null, IN_ATTESA), IN_ATTESA);
  assert.equal(resolveRegistrationStatusOnSave(null, "active", { parentAuthorizationRequested: false }), "active");
});

test("lo stato non dipende da chiamate precedenti e non modifica l'iscrizione ricevuta", () => {
  const esistente = Object.freeze({
    registrationStatus: "active",
    parentAuthorization: Object.freeze({ status: "email_sent", tokenId: "tok_1" }),
  });
  const prima = resolveRegistrationStatusOnSave(esistente, "active", CON_GENITORE);
  resolveRegistrationStatusOnSave(null, "active");
  resolveRegistrationStatusOnSave(existing("cancelled", "authorized"), "active");
  assert.equal(resolveRegistrationStatusOnSave(esistente, "active", CON_GENITORE), prima);
  assert.equal(prima, IN_ATTESA);
  assert.equal(esistente.registrationStatus, "active");
});

test("le rules del titolare ammettono il passaggio da attiva ad attesa che il modulo chiede", () => {
  // Senza questo ramo il salvataggio dell'attiva che entra in attesa verrebbe
  // rifiutato (il comportamento vero lo prova l'emulatore in functions/tests).
  const rules = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "firestore.rules"),
    "utf8",
  ).replace(/(^|\s)\/\/[^\n]*/gu, "$1");
  const inizio = rules.indexOf("function validRegistrationUpdate(");
  assert.ok(inizio > 0, "validRegistrationUpdate non trovata");
  const corpo = rules.slice(inizio, rules.indexOf("function validCampAssignmentUpdate(", inizio));
  assert.match(
    corpo,
    /prev\.registrationStatus\s*==\s*'active'\s*&&\s*next\.registrationStatus\s*==\s*'pending_parent_authorization'/u,
  );
});
