import test from "node:test";
import assert from "node:assert/strict";

import { isRecordsCloseAfterEnd } from "../src/utils/recordNight.ts";

// Il form dell'attività rifiuta una chiusura delle iscrizioni ai record oltre la
// fine dell'attività. I valori arrivano da <input type="datetime-local"> (senza
// fuso), la fine nello stesso formato.

test("chiusura prima della fine: ammessa (caso reale della gita)", () => {
  assert.equal(isRecordsCloseAfterEnd("2026-10-17T08:00", "2026-10-17T18:00"), false);
});

test("chiusura dopo l'inizio ma prima della fine: ammessa (serata a metà viaggio)", () => {
  // Attività dal 15 al 17: la chiusura del 16 cade durante, non è un errore.
  assert.equal(isRecordsCloseAfterEnd("2026-10-16T21:00", "2026-10-17T18:00"), false);
});

test("chiusura uguale alla fine: ammessa", () => {
  assert.equal(isRecordsCloseAfterEnd("2026-10-17T18:00", "2026-10-17T18:00"), false);
});

test("chiusura dopo la fine: rifiutata, anche di un solo minuto", () => {
  assert.equal(isRecordsCloseAfterEnd("2026-10-17T18:01", "2026-10-17T18:00"), true);
  assert.equal(isRecordsCloseAfterEnd("2026-10-18T08:00", "2026-10-17T18:00"), true);
});

test("campi vuoti: nessun errore da mostrare", () => {
  assert.equal(isRecordsCloseAfterEnd("", "2026-10-17T18:00"), false);
  assert.equal(isRecordsCloseAfterEnd("2026-10-17T08:00", ""), false);
  assert.equal(isRecordsCloseAfterEnd("", ""), false);
});

test("stringhe illeggibili: non rifiuta, lascia la parola alle altre validazioni", () => {
  assert.equal(isRecordsCloseAfterEnd("non-una-data", "2026-10-17T18:00"), false);
  assert.equal(isRecordsCloseAfterEnd("2026-10-17T08:00", "non-una-data"), false);
  assert.equal(isRecordsCloseAfterEnd("abc", "xyz"), false);
});

test("stringhe ISO con Z: stesso confronto sull'istante", () => {
  assert.equal(isRecordsCloseAfterEnd("2026-10-17T06:00:00Z", "2026-10-17T16:00:00Z"), false);
  assert.equal(isRecordsCloseAfterEnd("2026-10-17T16:00:00Z", "2026-10-17T16:00:00Z"), false);
  assert.equal(isRecordsCloseAfterEnd("2026-10-17T16:00:01Z", "2026-10-17T16:00:00Z"), true);
  // Stesso istante scritto con fusi diversi: non è dopo la fine.
  assert.equal(isRecordsCloseAfterEnd("2026-10-17T18:00:00+02:00", "2026-10-17T16:00:00Z"), false);
});
