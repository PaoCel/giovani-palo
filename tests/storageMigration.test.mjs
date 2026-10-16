// Logica pura della migrazione di bucket Storage (tools/lib/storageMigration.mjs):
// piano di sincronizzazione, riscrittura dei riferimenti al bucket e dei campi
// di un documento Firestore in formato REST. Nessuna rete, nessun emulatore.
//
// Rilancio dalla radice del repository:
//   node --test tests/storageMigration.test.mjs
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  metadataKey,
  planSync,
  rewriteBucketReference,
  rewriteDocumentFields,
} from "../tools/lib/storageMigration.mjs";

// ---------------------------------------------------------------------------
// Costruttori di comodo
// ---------------------------------------------------------------------------

/** Oggetto Storage come lo costruisce listObjects (generation e metageneration sono stringhe). */
const obj = (crc32c, generation, metadata = {}, metageneration = "1") => ({
  crc32c,
  generation: String(generation),
  metageneration: String(metageneration),
  metadata,
});

/** Riga del checkpoint come la scrive snapshot(): stato dell'ultima copia. */
const cp = (srcGen, srcCrc, srcMeta, dstGen) => ({
  srcGen: String(srcGen),
  srcCrc,
  srcMeta: typeof srcMeta === "string" ? srcMeta : metadataKey(srcMeta),
  dstGen: String(dstGen),
});

const plan = ({ source = [], dest = [], checkpoint = [] }) =>
  planSync({ source: new Map(source), dest: new Map(dest), checkpoint: new Map(checkpoint) });

const only = (actions, name) => actions.filter((a) => a.name === name);

// ---------------------------------------------------------------------------
// metadataKey
// ---------------------------------------------------------------------------

describe("metadataKey", () => {
  test("l'ordine delle chiavi non cambia l'impronta", () => {
    assert.equal(
      metadataKey({ uploadedBy: "u1", mediaId: "m1", firebaseStorageDownloadTokens: "t" }),
      metadataKey({ firebaseStorageDownloadTokens: "t", mediaId: "m1", uploadedBy: "u1" }),
    );
  });

  test("valori o chiavi diverse danno impronte diverse", () => {
    assert.notEqual(metadataKey({ a: "1" }), metadataKey({ a: "2" }));
    assert.notEqual(metadataKey({ a: "1" }), metadataKey({ b: "1" }));
    assert.notEqual(metadataKey({ a: "1" }), metadataKey({ a: "1", b: "2" }));
  });

  test("metadata assenti, null e vuoti sono la stessa cosa", () => {
    assert.equal(metadataKey(undefined), metadataKey({}));
    assert.equal(metadataKey(null), metadataKey({}));
  });

  test("l'impronta è una stringa (finisce nel checkpoint JSONL)", () => {
    assert.equal(typeof metadataKey({ a: "1" }), "string");
    assert.equal(JSON.parse(JSON.stringify({ k: metadataKey({ a: "1" }) })).k, metadataKey({ a: "1" }));
  });
});

// ---------------------------------------------------------------------------
// planSync
// ---------------------------------------------------------------------------

describe("planSync", () => {
  test("niente da fare se sorgente, destinazione e checkpoint sono vuoti", () => {
    assert.deepEqual(plan({}), []);
  });

  test("un oggetto che manca nella destinazione si copia, con precondizione di destinazione assente", () => {
    const actions = plan({ source: [["a.jpg", obj("AAA", 1)]] });
    assert.deepEqual(actions, [{ type: "copy", name: "a.jpg", ifDestGeneration: 0 }]);
  });

  test("manca nella destinazione ma il checkpoint dice che era stato copiato: si ricopia da capo", () => {
    // Destinazione cancellata a mano dopo la copia: la sorgente c'è ancora, quindi si ripristina.
    const actions = plan({
      source: [["a.jpg", obj("AAA", 1)]],
      checkpoint: [["a.jpg", cp(1, "AAA", {}, 5)]],
    });
    assert.deepEqual(actions, [{ type: "copy", name: "a.jpg", ifDestGeneration: 0 }]);
  });

  test("contenuto e metadata uguali con checkpoint: unchanged, con la generation della destinazione", () => {
    const actions = plan({
      source: [["a.jpg", obj("AAA", 1, { uploadedBy: "u1" })]],
      dest: [["a.jpg", obj("AAA", 7, { uploadedBy: "u1" })]],
      checkpoint: [["a.jpg", cp(1, "AAA", { uploadedBy: "u1" }, 7)]],
    });
    assert.deepEqual(actions, [{ type: "unchanged", name: "a.jpg", dstGen: "7" }]);
  });

  test("contenuto e metadata uguali senza checkpoint: adopt (il checkpoint si ricostruisce)", () => {
    const actions = plan({
      source: [["a.jpg", obj("AAA", 1, { uploadedBy: "u1" })]],
      dest: [["a.jpg", obj("AAA", 7, { uploadedBy: "u1" })]],
    });
    assert.deepEqual(actions, [{ type: "adopt", name: "a.jpg", dstGen: "7" }]);
  });

  test("metadata con chiavi in ordine diverso sono uguali: nessuna patch e nessun conflitto", () => {
    const source = [["a.jpg", obj("AAA", 1, { x: "1", y: "2", z: "3" })]];
    const dest = [["a.jpg", obj("AAA", 7, { z: "3", x: "1", y: "2" })]];
    assert.equal(plan({ source, dest })[0].type, "adopt");
    assert.equal(
      plan({ source, dest, checkpoint: [["a.jpg", cp(1, "AAA", { y: "2", z: "3", x: "1" }, 7)]] })[0].type,
      "unchanged",
    );
  });

  describe("stesso contenuto, metadata diversi", () => {
    test("cambiati nella sorgente dopo l'ultima copia e destinazione ancora la nostra: patchMetadata", () => {
      // Caso tipico: token di download revocato nel vecchio bucket prima del passaggio.
      const actions = plan({
        source: [["a.jpg", obj("AAA", 1, { firebaseStorageDownloadTokens: "nuovo" })]],
        dest: [["a.jpg", obj("AAA", 7, { firebaseStorageDownloadTokens: "vecchio" }, "3")]],
        checkpoint: [["a.jpg", cp(1, "AAA", { firebaseStorageDownloadTokens: "vecchio" }, 7)]],
      });
      assert.deepEqual(actions, [
        { type: "patchMetadata", name: "a.jpg", dstGen: "7", ifDestMetageneration: "3" },
      ]);
    });

    test("cambiati solo nella destinazione: destNewer, non si tocca niente", () => {
      // Dopo il passaggio è la destinazione quella viva: un token revocato lì deve restare.
      const actions = plan({
        source: [["a.jpg", obj("AAA", 1, { firebaseStorageDownloadTokens: "vecchio" })]],
        dest: [["a.jpg", obj("AAA", 7, { firebaseStorageDownloadTokens: "revocato-sul-nuovo" })]],
        checkpoint: [["a.jpg", cp(1, "AAA", { firebaseStorageDownloadTokens: "vecchio" }, 7)]],
      });
      assert.deepEqual(actions, [{ type: "destNewer", name: "a.jpg" }]);
    });

    test("destNewer vale anche se la destinazione è stata riscritta con lo stesso contenuto (generation diversa)", () => {
      const actions = plan({
        source: [["a.jpg", obj("AAA", 1, { t: "1" })]],
        dest: [["a.jpg", obj("AAA", 99, { t: "2" })]],
        checkpoint: [["a.jpg", cp(1, "AAA", { t: "1" }, 7)]],
      });
      assert.equal(actions[0].type, "destNewer");
    });

    test("senza checkpoint non si sa chi è cambiato: conflict, con la ragione", () => {
      const actions = plan({
        source: [["a.jpg", obj("AAA", 1, { t: "1" })]],
        dest: [["a.jpg", obj("AAA", 7, { t: "2" })]],
      });
      assert.equal(actions.length, 1);
      assert.equal(actions[0].type, "conflict");
      assert.equal(actions[0].name, "a.jpg");
      assert.match(actions[0].reason, /metadata diversi/);
    });

    test("sorgente cambiata ma destinazione riscritta (generation diversa dal checkpoint): conflict, niente patch", () => {
      const actions = plan({
        source: [["a.jpg", obj("AAA", 1, { t: "nuovo" })]],
        dest: [["a.jpg", obj("AAA", 99, { t: "vecchio" })]],
        checkpoint: [["a.jpg", cp(1, "AAA", { t: "vecchio" }, 7)]],
      });
      assert.deepEqual(actions.map((a) => a.type), ["conflict"]);
    });

    test("metadata tolti nella sorgente (insieme più piccolo) sono un cambiamento della sorgente: patchMetadata", () => {
      const actions = plan({
        source: [["a.jpg", obj("AAA", 1, {})]],
        dest: [["a.jpg", obj("AAA", 7, { t: "1" }, "2")]],
        checkpoint: [["a.jpg", cp(1, "AAA", { t: "1" }, 7)]],
      });
      assert.deepEqual(actions.map((a) => a.type), ["patchMetadata"]);
    });

    // Nota per chi corregge il codice: oggi "destinazione ancora quella scritta da noi" è
    // verificata solo con la generation, che NON cambia quando si modificano i metadata
    // (cambia la metageneration). Se i metadata cambiano su entrambi i lati, planSync
    // risponde patchMetadata e la patch riscrive i metadata della destinazione con
    // quelli della sorgente: un token revocato sul bucket nuovo torna valido.
    // Il checkpoint basta a vederlo: srcMeta è anche lo stato della destinazione al momento
    // della copia, quindi la destinazione è intatta solo se metadataKey(dest) === srcMeta.
    test(
      "metadata cambiati su entrambi i lati: non si sovrascrive la destinazione con una patch",
      () => {
        const actions = plan({
          source: [["a.jpg", obj("AAA", 1, { firebaseStorageDownloadTokens: "nuovo-sorgente" })]],
          dest: [["a.jpg", obj("AAA", 7, { firebaseStorageDownloadTokens: "revocato-su-destinazione" }, "4")]],
          checkpoint: [["a.jpg", cp(1, "AAA", { firebaseStorageDownloadTokens: "originale" }, 7)]],
        });
        assert.equal(actions.length, 1);
        assert.notEqual(actions[0].type, "patchMetadata");
      },
    );
  });

  describe("contenuto diverso", () => {
    test("destinazione ancora quella scritta da noi e sorgente con generation nuova: recopy con precondizione", () => {
      const actions = plan({
        source: [["a.jpg", obj("BBB", 2)]],
        dest: [["a.jpg", obj("AAA", 7)]],
        checkpoint: [["a.jpg", cp(1, "AAA", {}, 7)]],
      });
      assert.deepEqual(actions, [{ type: "recopy", name: "a.jpg", ifDestGeneration: "7" }]);
    });

    test("destinazione cambiata dopo la copia: conflict, non si ricopia", () => {
      const actions = plan({
        source: [["a.jpg", obj("BBB", 2)]],
        dest: [["a.jpg", obj("CCC", 99)]],
        checkpoint: [["a.jpg", cp(1, "AAA", {}, 7)]],
      });
      assert.equal(actions.length, 1);
      assert.equal(actions[0].type, "conflict");
      assert.match(actions[0].reason, /contenuto diverso/);
    });

    test("senza checkpoint e contenuto diverso: conflict", () => {
      const actions = plan({
        source: [["a.jpg", obj("BBB", 2)]],
        dest: [["a.jpg", obj("CCC", 99)]],
      });
      assert.deepEqual(actions.map((a) => a.type), ["conflict"]);
    });

    test("contenuto diverso ma generation della sorgente uguale a quella del checkpoint: conflict, non recopy", () => {
      // La sorgente non risulta cambiata dopo la copia: la differenza non viene da lei.
      const actions = plan({
        source: [["a.jpg", obj("BBB", 1)]],
        dest: [["a.jpg", obj("AAA", 7)]],
        checkpoint: [["a.jpg", cp(1, "AAA", {}, 7)]],
      });
      assert.deepEqual(actions.map((a) => a.type), ["conflict"]);
    });

    // Stessa classe del caso "entrambi i lati" qui sopra: recopy usa rewriteTo, che
    // porta con sé i metadata della sorgente, quindi cancella anche un token revocato
    // sul bucket nuovo (la generation del contenuto non è cambiata, i metadata sì).
    test(
      "contenuto cambiato nella sorgente e metadata cambiati nella destinazione: non si ricopia in silenzio",
      () => {
        const actions = plan({
          source: [["a.jpg", obj("BBB", 2, { firebaseStorageDownloadTokens: "originale" })]],
          dest: [["a.jpg", obj("AAA", 7, { firebaseStorageDownloadTokens: "revocato-su-destinazione" })]],
          checkpoint: [["a.jpg", cp(1, "AAA", { firebaseStorageDownloadTokens: "originale" }, 7)]],
        });
        assert.equal(actions.length, 1);
        assert.notEqual(actions[0].type, "recopy");
      },
    );
  });

  describe("cancellazioni dalla destinazione", () => {
    test("nel checkpoint, sparito dalla sorgente, destinazione invariata: deleteFromDest con precondizione", () => {
      const actions = plan({
        dest: [["a.jpg", obj("AAA", 7)]],
        source: [["altro.jpg", obj("ZZZ", 1)]],
        checkpoint: [["a.jpg", cp(1, "AAA", {}, 7)]],
      });
      assert.deepEqual(only(actions, "a.jpg"), [{ type: "deleteFromDest", name: "a.jpg", ifDestGeneration: "7" }]);
    });

    test("sparito dalla sorgente ma destinazione cambiata dopo la copia: non si cancella", () => {
      const actions = plan({
        dest: [["a.jpg", obj("AAA", 99)]],
        source: [["altro.jpg", obj("ZZZ", 1)]],
        checkpoint: [["a.jpg", cp(1, "AAA", {}, 7)]],
      });
      assert.deepEqual(only(actions, "a.jpg"), []);
    });

    test("sparito dalla sorgente e già assente dalla destinazione: niente da fare", () => {
      const actions = plan({
        source: [["altro.jpg", obj("ZZZ", 1)]],
        checkpoint: [["a.jpg", cp(1, "AAA", {}, 7)]],
      });
      assert.deepEqual(only(actions, "a.jpg"), []);
    });

    test("MAI cancellare gli oggetti nati solo nella destinazione", () => {
      // Dopo il passaggio l'app scrive solo sul bucket nuovo: quei file non esistono nella sorgente
      // e non sono nel checkpoint, quindi non sono nostri.
      const actions = plan({
        source: [["vecchio.jpg", obj("AAA", 1)]],
        dest: [
          ["vecchio.jpg", obj("AAA", 7)],
          ["nato-dopo-1.jpg", obj("BBB", 8)],
          ["nato-dopo-2.jpg", obj("CCC", 9)],
        ],
        checkpoint: [["vecchio.jpg", cp(1, "AAA", {}, 7)]],
      });
      assert.equal(actions.filter((a) => a.type === "deleteFromDest").length, 0);
      assert.deepEqual(only(actions, "nato-dopo-1.jpg"), []);
      assert.deepEqual(only(actions, "nato-dopo-2.jpg"), []);
    });

    test("solo destinazione e checkpoint vuoto (anche con sorgente vuota): nessuna azione", () => {
      assert.deepEqual(plan({ dest: [["x.jpg", obj("AAA", 1)], ["y.jpg", obj("BBB", 2)]] }), []);
    });

    test("un nome nato nella destinazione con lo stesso nome di uno copiato e cancellato (generation nuova) non si tocca", () => {
      // Il checkpoint ricorda la generation scritta da noi (7): se ora è un'altra, l'oggetto è nuovo.
      const actions = plan({
        source: [["altro.jpg", obj("ZZZ", 1)]],
        dest: [["riuso.jpg", obj("NEW", 42)]],
        checkpoint: [["riuso.jpg", cp(1, "OLD", {}, 7)]],
      });
      assert.deepEqual(only(actions, "riuso.jpg"), []);
    });
  });

  test("un piano misto restituisce un'azione per oggetto, sorgente prima e cancellazioni dopo", () => {
    const actions = plan({
      source: [
        ["nuovo.jpg", obj("N", 1)],
        ["uguale.jpg", obj("U", 1)],
        ["adottato.jpg", obj("A", 1)],
        ["cambiato.jpg", obj("C2", 2)],
      ],
      dest: [
        ["uguale.jpg", obj("U", 10)],
        ["adottato.jpg", obj("A", 11)],
        ["cambiato.jpg", obj("C1", 12)],
        ["cancellato.jpg", obj("D", 13)],
        ["solo-dest.jpg", obj("S", 14)],
      ],
      checkpoint: [
        ["uguale.jpg", cp(1, "U", {}, 10)],
        ["cambiato.jpg", cp(1, "C1", {}, 12)],
        ["cancellato.jpg", cp(1, "D", {}, 13)],
      ],
    });
    assert.deepEqual(
      actions.map((a) => [a.name, a.type]),
      [
        ["nuovo.jpg", "copy"],
        ["uguale.jpg", "unchanged"],
        ["adottato.jpg", "adopt"],
        ["cambiato.jpg", "recopy"],
        ["cancellato.jpg", "deleteFromDest"],
      ],
    );
  });

  test("non modifica sorgente, destinazione e checkpoint", () => {
    const source = new Map([["a.jpg", obj("AAA", 1, { t: "1" })]]);
    const dest = new Map([["a.jpg", obj("AAA", 7, { t: "1" })]]);
    const checkpoint = new Map([["gone.jpg", cp(1, "G", {}, 3)]]);
    const snapshot = JSON.stringify([[...source], [...dest], [...checkpoint]]);
    planSync({ source, dest, checkpoint });
    assert.equal(JSON.stringify([[...source], [...dest], [...checkpoint]]), snapshot);
  });
});

// ---------------------------------------------------------------------------
// rewriteBucketReference
// ---------------------------------------------------------------------------

const FROM = "giovani-palo.firebasestorage.app";
const TO = "giovani-palo-eu";
const rw = (value) => rewriteBucketReference(value, FROM, TO);

describe("rewriteBucketReference", () => {
  const OBJ = "protected%2Fstakes%2Froma-est%2Fgalleries%2Fg1%2Ffoto.jpg";

  test("URL di download di Firebase Storage, con query e token", () => {
    assert.equal(
      rw(`https://firebasestorage.googleapis.com/v0/b/${FROM}/o/${OBJ}?alt=media&token=abc-123`),
      `https://firebasestorage.googleapis.com/v0/b/${TO}/o/${OBJ}?alt=media&token=abc-123`,
    );
  });

  test("URL dell'emulatore Storage (host e porta qualsiasi)", () => {
    assert.equal(
      rw(`http://127.0.0.1:9299/v0/b/${FROM}/o/${OBJ}?alt=media&token=abc`),
      `http://127.0.0.1:9299/v0/b/${TO}/o/${OBJ}?alt=media&token=abc`,
    );
    assert.equal(
      rw(`http://localhost:9499/v0/b/${FROM}/o/${OBJ}?alt=media`),
      `http://localhost:9499/v0/b/${TO}/o/${OBJ}?alt=media`,
    );
  });

  test("elenco degli oggetti (/o?prefix=...)", () => {
    assert.equal(
      rw(`https://firebasestorage.googleapis.com/v0/b/${FROM}/o?prefix=public%2F`),
      `https://firebasestorage.googleapis.com/v0/b/${TO}/o?prefix=public%2F`,
    );
  });

  test("URL storage.googleapis.com/<bucket>/<oggetto>", () => {
    assert.equal(
      rw(`https://storage.googleapis.com/${FROM}/public/stakes/roma-est/hero.png`),
      `https://storage.googleapis.com/${TO}/public/stakes/roma-est/hero.png`,
    );
  });

  test("URL dell'API JSON di download (storage/v1/b/<bucket>/o/...)", () => {
    assert.equal(
      rw(`https://storage.googleapis.com/download/storage/v1/b/${FROM}/o/${OBJ}?alt=media`),
      `https://storage.googleapis.com/download/storage/v1/b/${TO}/o/${OBJ}?alt=media`,
    );
  });

  test("riferimento gs://<bucket>/<oggetto>", () => {
    assert.equal(rw(`gs://${FROM}/protected/a/b.pdf`), `gs://${TO}/protected/a/b.pdf`);
  });

  test("host virtuale <bucket>.storage.googleapis.com", () => {
    assert.equal(
      rw(`https://${FROM}.storage.googleapis.com/protected/a/b.pdf`),
      `https://${TO}.storage.googleapis.com/protected/a/b.pdf`,
    );
  });

  test("più riferimenti nella stessa stringa si riscrivono tutti", () => {
    assert.equal(rw(`gs://${FROM}/a.pdf gs://${FROM}/b.pdf`), `gs://${TO}/a.pdf gs://${TO}/b.pdf`);
  });

  test("il percorso dell'oggetto resta identico, comprese codifiche e spazi", () => {
    const path = "protected%2Fstakes%2Froma%20est%2Ffoto%20%281%29.jpg";
    const out = rw(`https://firebasestorage.googleapis.com/v0/b/${FROM}/o/${path}?alt=media&token=t`);
    assert.ok(out.includes(`/o/${path}?alt=media&token=t`));
  });

  test("è idempotente: una stringa già riscritta non cambia più", () => {
    const once = rw(`gs://${FROM}/a.pdf`);
    assert.equal(rw(once), null);
  });

  describe("null quando non c'è niente da riscrivere", () => {
    test("la stringa non nomina il bucket", () => {
      assert.equal(rw("https://example.com/foto.jpg"), null);
      assert.equal(rw("testo libero"), null);
      assert.equal(rw(""), null);
    });

    test("il valore non è una stringa", () => {
      for (const v of [null, undefined, 42, true, {}, [], { stringValue: `gs://${FROM}/a` }]) {
        assert.equal(rw(v), null);
      }
    });

    test("il bucket nuovo è già al suo posto", () => {
      assert.equal(rw(`https://firebasestorage.googleapis.com/v0/b/${TO}/o/x?alt=media`), null);
    });

    test("il bucket è nominato in un formato sconosciuto (testo libero, senza percorso)", () => {
      assert.equal(rw(`bucket ${FROM} nel testo`), null);
      assert.equal(rw(`gs://${FROM}`), null);
      assert.equal(rw(`https://storage.googleapis.com/${FROM}`), null);
      assert.equal(rw(`https://firebasestorage.googleapis.com/v0/b/${FROM}`), null);
    });
  });

  // Il vecchio nome è prefisso (o suffisso) di un altro bucket: non è lo stesso bucket e
  // non va toccato in nessuno dei formati riconosciuti. Verificato a mano: oggi il codice
  // lo rispetta perché ogni schema richiede il delimitatore subito dopo (e prima) del nome.
  describe("bucket che contengono il vecchio nome come prefisso o suffisso", () => {
    const LOOKALIKES = [`${FROM}.evil.test`, `x-${FROM}`, `${FROM}-eu`, `${FROM}2`];
    const FORMATS = [
      (b) => `https://firebasestorage.googleapis.com/v0/b/${b}/o/x%2Fy.jpg?alt=media&token=t`,
      (b) => `http://127.0.0.1:9299/v0/b/${b}/o/x%2Fy.jpg?alt=media`,
      (b) => `https://firebasestorage.googleapis.com/v0/b/${b}/o?prefix=x`,
      (b) => `https://storage.googleapis.com/${b}/x/y.jpg`,
      (b) => `https://storage.googleapis.com/download/storage/v1/b/${b}/o/x%2Fy.jpg`,
      (b) => `gs://${b}/x/y.jpg`,
      (b) => `https://${b}.storage.googleapis.com/x/y.jpg`,
    ];

    for (const lookalike of LOOKALIKES) {
      test(`non tocca ${lookalike} in nessun formato`, () => {
        for (const format of FORMATS) {
          const value = format(lookalike);
          assert.equal(rw(value), null, `riscritto per errore: ${value}`);
        }
      });
    }

    test("un riferimento vero accanto a uno omonimo: si riscrive solo quello vero", () => {
      assert.equal(
        rw(`gs://${FROM}/a.pdf gs://${FROM}.evil.test/a.pdf gs://x-${FROM}/a.pdf`),
        `gs://${TO}/a.pdf gs://${FROM}.evil.test/a.pdf gs://x-${FROM}/a.pdf`,
      );
    });

    test("il nome del bucket dentro il percorso dell'oggetto non è un riferimento al bucket", () => {
      const value = `https://firebasestorage.googleapis.com/v0/b/${TO}/o/copia-di-${FROM}.jpg`;
      assert.equal(rw(value), null);
    });
  });

  test("se il vecchio nome è sottostringa del nuovo (o viceversa) non si riscrive due volte", () => {
    const out = rewriteBucketReference("gs://app/a.pdf", "app", "app-eu");
    assert.equal(out, "gs://app-eu/a.pdf");
    assert.equal(rewriteBucketReference(out, "app", "app-eu"), null);
  });
});

// ---------------------------------------------------------------------------
// rewriteDocumentFields
// ---------------------------------------------------------------------------

const s = (stringValue) => ({ stringValue });
const m = (fields) => ({ mapValue: { fields } });
const arr = (...values) => ({ arrayValue: { values } });

const OLD_URL = `https://firebasestorage.googleapis.com/v0/b/${FROM}/o/a%2Fb.jpg?alt=media&token=t`;
const NEW_URL = `https://firebasestorage.googleapis.com/v0/b/${TO}/o/a%2Fb.jpg?alt=media&token=t`;
const rf = (fields) => rewriteDocumentFields(fields, FROM, TO);

describe("rewriteDocumentFields", () => {
  test("campo di primo livello: fields con il solo campo cambiato e mask col suo nome", () => {
    const r = rf({ coverImageUrl: s(OLD_URL), title: s("Viaggio") });
    assert.equal(r.changes, 1);
    assert.deepEqual(r.fields, { coverImageUrl: s(NEW_URL) });
    assert.deepEqual(r.mask, ["coverImageUrl"]);
    assert.equal(r.leftovers, 0);
  });

  test("più campi di primo livello: tutti nel corpo e nella mask, nell'ordine del documento", () => {
    const r = rf({ a: s(OLD_URL), b: s("x"), c: s(`gs://${FROM}/p.pdf`) });
    assert.equal(r.changes, 2);
    assert.deepEqual(r.fields, { a: s(NEW_URL), c: s(`gs://${TO}/p.pdf`) });
    assert.deepEqual(r.mask, ["a", "c"]);
  });

  test("mappa annidata: la mask punta alla foglia e fields contiene solo le foglie cambiate", () => {
    const r = rf({
      parentAuthorization: m({
        status: s("authorized"),
        pdfPath: s("protected/x.pdf"),
        nested: m({ docUrl: s(`gs://${FROM}/x.pdf`), keep: s("x") }),
      }),
      title: s("Tempio"),
    });
    assert.equal(r.changes, 1);
    assert.deepEqual(r.mask, ["parentAuthorization.nested.docUrl"]);
    assert.deepEqual(r.fields, {
      parentAuthorization: m({ nested: m({ docUrl: s(`gs://${TO}/x.pdf`) }) }),
    });
  });

  test("due foglie nella stessa mappa: due path nella mask, entrambe nel corpo, le altre fuori", () => {
    const r = rf({
      media: m({ storageUrl: s(OLD_URL), thumbnailUrl: s(OLD_URL), likeCount: { integerValue: "3" } }),
    });
    assert.equal(r.changes, 2);
    assert.deepEqual(r.mask, ["media.storageUrl", "media.thumbnailUrl"]);
    assert.deepEqual(r.fields, { media: m({ storageUrl: s(NEW_URL), thumbnailUrl: s(NEW_URL) }) });
  });

  test("nome di campo non semplice: il segmento va fra backtick", () => {
    const r = rf({ "weird-key": s(`https://storage.googleapis.com/${FROM}/p.pdf`) });
    assert.deepEqual(r.mask, ["`weird-key`"]);
    assert.deepEqual(r.fields, { "weird-key": s(`https://storage.googleapis.com/${TO}/p.pdf`) });
  });

  test("segmenti non semplici dentro una mappa: solo quelli che lo richiedono vanno fra backtick", () => {
    const r = rf({ info: m({ "weird-key": s(OLD_URL), ok_1: s(OLD_URL), "1abc": s(OLD_URL), "a.b": s(OLD_URL) }) });
    assert.deepEqual(r.mask, ["info.`weird-key`", "info.ok_1", "info.`1abc`", "info.`a.b`"]);
  });

  test("nomi con lettere accentate o con underscore iniziale", () => {
    const r = rf({ città: s(OLD_URL), _privato: s(OLD_URL) });
    assert.deepEqual(r.mask, ["`città`", "_privato"]);
  });

  test("backtick e backslash dentro il nome si proteggono con il backslash", () => {
    const r = rf({ "a`b": s(OLD_URL), "c\\d": s(OLD_URL) });
    assert.deepEqual(r.mask, ["`a\\`b`", "`c\\\\d`"]);
  });

  test("array: si riscrive l'array intero, gli altri elementi restano com'erano", () => {
    const r = rf({
      attachments: arr(s(OLD_URL), s("testo libero"), { integerValue: "7" }, { booleanValue: true }, m({ k: s("v") })),
    });
    assert.equal(r.changes, 1);
    assert.deepEqual(r.mask, ["attachments"]);
    assert.deepEqual(r.fields, {
      attachments: arr(s(NEW_URL), s("testo libero"), { integerValue: "7" }, { booleanValue: true }, m({ k: s("v") })),
    });
  });

  test("array con più riferimenti: changes li conta tutti, la mask ha un solo path", () => {
    const r = rf({ gallery: arr(s(OLD_URL), s("x"), s(`gs://${FROM}/a.jpg`)) });
    assert.equal(r.changes, 2);
    assert.deepEqual(r.mask, ["gallery"]);
    assert.deepEqual(r.fields.gallery.arrayValue.values, [s(NEW_URL), s("x"), s(`gs://${TO}/a.jpg`)]);
  });

  test("array dentro una mappa: la mask arriva all'array, non agli elementi", () => {
    const r = rf({ extra: m({ links: arr(s(OLD_URL)), altro: s("x") }) });
    assert.deepEqual(r.mask, ["extra.links"]);
    assert.deepEqual(r.fields, { extra: m({ links: arr(s(NEW_URL)) }) });
  });

  test("mappa dentro un array: l'array intero si riscrive, anche i campi della mappa che non cambiano restano", () => {
    const r = rf({ items: arr(m({ url: s(OLD_URL), label: s("foto") }), m({ label: s("senza url") })) });
    assert.deepEqual(r.mask, ["items"]);
    assert.deepEqual(r.fields, {
      items: arr(m({ url: s(NEW_URL), label: s("foto") }), m({ label: s("senza url") })),
    });
  });

  test("array senza riferimenti: nessuna modifica", () => {
    const r = rf({ tags: arr(s("a"), s("b")) });
    assert.equal(r.changes, 0);
    assert.deepEqual(r.mask, []);
    assert.deepEqual(r.fields, {});
  });

  describe("leftovers", () => {
    test("stringa che nomina il bucket in un formato sconosciuto: leftover, nessuna modifica", () => {
      const r = rf({ nota: s(`il file sta nel bucket ${FROM}, chiedere a Paolo`) });
      assert.equal(r.changes, 0);
      assert.equal(r.leftovers, 1);
      assert.deepEqual(r.mask, []);
      assert.deepEqual(r.fields, {});
    });

    test("i leftover si contano anche dentro mappe e array, accanto a riferimenti che si riscrivono", () => {
      const r = rf({
        a: s(OLD_URL),
        b: m({ nota: s(`bucket ${FROM}`), url: s(OLD_URL) }),
        c: arr(s(`gs://${FROM}`), s(OLD_URL)),
      });
      assert.equal(r.leftovers, 2);
      assert.equal(r.changes, 3);
      assert.deepEqual(r.mask, ["a", "b.url", "c"]);
    });

    test("l'URL di un bucket omonimo non si tocca (finisce fra i leftover, da guardare a mano)", () => {
      const lookalike = `https://firebasestorage.googleapis.com/v0/b/${FROM}.evil.test/o/x?alt=media`;
      const r = rf({ link: s(lookalike) });
      assert.equal(r.changes, 0);
      assert.deepEqual(r.fields, {});
      // Nomina comunque il vecchio nome in un formato non riconosciuto: finisce fra i leftover, da guardare a mano.
      assert.equal(r.leftovers, 1);
    });

    // Una stringa con un riferimento noto e un altro nome del bucket in formato ignoto viene
    // riscritta solo in parte: il vecchio nome resta dentro, ma non è contata fra i leftover
    // (si conta solo quando non cambia niente). A scoprirlo è poi verify (oldRefs), a dry-run
    // e rewrite invece unknownFormatLeftovers resta 0.
    test(
      "stringa riscritta in parte, con il vecchio nome ancora dentro: è un leftover",
      () => {
        const r = rf({ mista: s(`gs://${FROM}/a.pdf e poi ${FROM} nudo`) });
        assert.equal(r.changes, 1);
        assert.equal(r.leftovers, 1);
      },
    );
  });

  describe("documenti senza riferimenti", () => {
    test("nessun campo cambia: changes 0, mask vuota, fields vuoto, leftovers 0", () => {
      const r = rf({
        title: s("Tempio"),
        likeCount: { integerValue: "3" },
        ratio: { doubleValue: 0.5 },
        active: { booleanValue: true },
        nothing: { nullValue: null },
        when: { timestampValue: "2026-10-16T10:00:00Z" },
        ref: { referenceValue: "projects/p/databases/(default)/documents/users/u1" },
        place: { geoPointValue: { latitude: 41.9, longitude: 12.5 } },
        raw: { bytesValue: "AAAA" },
        nested: m({ deeper: m({ x: s("y") }), list: arr(s("a")) }),
      });
      assert.deepEqual(r, { changes: 0, fields: {}, mask: [], leftovers: 0 });
    });

    test("documento vuoto, assente o senza fields", () => {
      for (const input of [{}, undefined, null]) {
        assert.deepEqual(rf(input), { changes: 0, fields: {}, mask: [], leftovers: 0 });
      }
    });

    test("mappe e array vuoti non danno problemi", () => {
      assert.deepEqual(rf({ a: { mapValue: {} }, b: m({}), c: { arrayValue: {} }, d: arr() }), {
        changes: 0,
        fields: {},
        mask: [],
        leftovers: 0,
      });
    });
  });

  test("non modifica il documento di partenza", () => {
    const input = { a: s(OLD_URL), b: m({ c: s(OLD_URL) }), d: arr(s(OLD_URL)) };
    const before = JSON.stringify(input);
    rf(input);
    assert.equal(JSON.stringify(input), before);
  });

  test("riapplicata al risultato non cambia più niente (idempotenza della riscrittura)", () => {
    const doc = {
      a: s(OLD_URL),
      b: m({ c: s(`gs://${FROM}/x.pdf`), keep: s("x") }),
      d: arr(s(OLD_URL), s("y")),
    };
    const first = rf(doc);
    // Applica la PATCH al documento: i campi cambiati sostituiscono quelli di partenza (le mappe si fondono).
    const merged = {
      a: first.fields.a,
      b: m({ c: first.fields.b.mapValue.fields.c, keep: s("x") }),
      d: first.fields.d,
    };
    assert.deepEqual(rf(merged), { changes: 0, fields: {}, mask: [], leftovers: 0 });
  });
});
