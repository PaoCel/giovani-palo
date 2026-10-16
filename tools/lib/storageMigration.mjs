// Logica pura della migrazione di bucket (tools/migrate-storage-bucket.mjs):
// decisioni di sincronizzazione e riscrittura degli URL, senza rete.

/** Hash stabile dei metadata custom di un oggetto (ordine delle chiavi ignorato). */
export function metadataKey(metadata) {
  const entries = Object.entries(metadata || {}).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

/**
 * Cosa fare di ogni oggetto, confrontando sorgente, destinazione e checkpoint.
 * `source` e `dest`: Map nome → { generation, crc32c, metadata }.
 * `checkpoint`: Map nome → { srcGen, srcCrc, srcMeta, dstGen } dell'ultima copia.
 *
 * Regole:
 * - nella sorgente e non nella destinazione: copia;
 * - contenuto uguale e metadata uguali: niente (si registra se manca nel checkpoint);
 * - contenuto uguale, metadata diversi: se sono cambiati solo nella sorgente dopo
 *   l'ultima copia (token revocati, file corretti) si riallineano; se è cambiata
 *   solo la destinazione (dopo il passaggio è lei quella viva) si lascia; se sono
 *   cambiati entrambi, conflitto da guardare;
 * - contenuto diverso: si ricopia solo se la destinazione è ancora quella
 *   scritta da noi e la sorgente è cambiata; se è cambiata solo la destinazione
 *   si lascia; altrimenti conflitto da guardare;
 * - nel checkpoint, sparito dalla sorgente, destinazione invariata: era stato
 *   copiato e poi cancellato (media tolto, account cancellato), si toglie
 *   anche dalla destinazione. Quello che nasce solo nella destinazione non si tocca.
 */
export function planSync({ source, dest, checkpoint }) {
  const actions = [];
  for (const [name, s] of source) {
    const d = dest.get(name);
    const c = checkpoint.get(name);
    if (!d) {
      actions.push({ type: "copy", name, ifDestGeneration: 0 });
      continue;
    }
    // La destinazione è "intatta" se è ancora quella scritta dall'ultima copia:
    // stessa generation (contenuto) e stessi metadata (una revoca dei token sul
    // bucket nuovo cambia solo i metadata, non la generation).
    const destIntact = c && c.dstGen === d.generation && metadataKey(d.metadata) === c.srcMeta;
    if (d.crc32c === s.crc32c) {
      if (metadataKey(d.metadata) === metadataKey(s.metadata)) {
        actions.push({ type: c ? "unchanged" : "adopt", name, dstGen: d.generation });
        continue;
      }
      if (!c) {
        actions.push({ type: "conflict", name, reason: "metadata diversi, nessun checkpoint che dica chi è cambiato" });
        continue;
      }
      const sourceChanged = c.srcMeta !== metadataKey(s.metadata);
      if (sourceChanged && destIntact) {
        actions.push({ type: "patchMetadata", name, dstGen: d.generation, ifDestMetageneration: d.metageneration });
      } else if (!sourceChanged) {
        actions.push({ type: "destNewer", name });
      } else {
        actions.push({ type: "conflict", name, reason: "metadata cambiati su entrambi i bucket dopo la copia" });
      }
      continue;
    }
    if (destIntact && c.srcGen !== s.generation) {
      actions.push({ type: "recopy", name, ifDestGeneration: d.generation });
    } else if (c && c.srcGen === s.generation && !destIntact) {
      actions.push({ type: "destNewer", name });
    } else {
      actions.push({ type: "conflict", name, reason: "contenuto diverso e destinazione cambiata dopo la copia" });
    }
  }
  for (const [name, c] of checkpoint) {
    if (source.has(name)) continue;
    const d = dest.get(name);
    if (d && d.generation === c.dstGen) {
      actions.push({ type: "deleteFromDest", name, ifDestGeneration: d.generation });
    }
  }
  return actions;
}

/** Sostituisce il bucket in un URL o riferimento Storage; null se la stringa non lo nomina. */
export function rewriteBucketReference(value, from, to) {
  if (typeof value !== "string" || !value.includes(from)) return null;
  const pairs = [
    [`/v0/b/${from}/o/`, `/v0/b/${to}/o/`],
    [`/v0/b/${from}/o?`, `/v0/b/${to}/o?`],
    [`://storage.googleapis.com/${from}/`, `://storage.googleapis.com/${to}/`],
    [`://storage.googleapis.com/download/storage/v1/b/${from}/o/`, `://storage.googleapis.com/download/storage/v1/b/${to}/o/`],
    [`gs://${from}/`, `gs://${to}/`],
    [`://${from}.storage.googleapis.com/`, `://${to}.storage.googleapis.com/`],
  ];
  let next = value;
  for (const [a, b] of pairs) next = next.split(a).join(b);
  return next === value ? null : next;
}

const SIMPLE_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const quoteSegment = (s) => (SIMPLE_SEGMENT.test(s) ? s : "`" + s.replace(/\\/g, "\\\\").replace(/`/g, "\\`") + "`");

/**
 * Percorre i campi di un documento REST di Firestore e riscrive i riferimenti al
 * bucket vecchio. Ritorna { changes, fields, mask, leftovers }: `fields` è il
 * corpo della PATCH (solo i campi toccati), `mask` le field path per updateMask.
 * Dentro un array si riscrive l'array intero (Firestore non indirizza gli elementi).
 * `leftovers` conta le stringhe che nominano ancora `from` dopo la riscrittura
 * (formato sconosciuto, o riscritte solo in parte): vanno guardate a mano.
 */
export function rewriteDocumentFields(fields, from, to) {
  const result = { changes: 0, fields: {}, mask: [], leftovers: 0 };

  const rewriteValue = (v) => {
    if (v == null) return { value: v, changed: 0 };
    if ("stringValue" in v) {
      const next = rewriteBucketReference(v.stringValue, from, to);
      if ((next ?? v.stringValue).includes(from)) result.leftovers++;
      if (next != null) return { value: { stringValue: next }, changed: 1 };
      return { value: v, changed: 0 };
    }
    if ("mapValue" in v) {
      let changed = 0;
      const out = {};
      for (const [k, x] of Object.entries(v.mapValue.fields || {})) {
        const r = rewriteValue(x);
        out[k] = r.value;
        changed += r.changed;
      }
      return { value: changed ? { mapValue: { fields: out } } : v, changed };
    }
    if ("arrayValue" in v) {
      let changed = 0;
      const out = (v.arrayValue.values || []).map((x) => {
        const r = rewriteValue(x);
        changed += r.changed;
        return r.value;
      });
      return { value: changed ? { arrayValue: { values: out } } : v, changed };
    }
    return { value: v, changed: 0 };
  };

  // Scende nelle mappe per mascherare la foglia, così un aggiornamento
  // concorrente di un altro campo della stessa mappa non viene sovrascritto.
  // Ritorna un valore REST con le sole foglie cambiate, o null.
  const visit = (v, segments) => {
    if (v && "mapValue" in v) {
      const out = {};
      for (const [k, x] of Object.entries(v.mapValue.fields || {})) {
        const r = visit(x, [...segments, k]);
        if (r) out[k] = r;
      }
      return Object.keys(out).length ? { mapValue: { fields: out } } : null;
    }
    const r = rewriteValue(v);
    if (!r.changed) return null;
    result.changes += r.changed;
    result.mask.push(segments.map(quoteSegment).join("."));
    return r.value;
  };

  for (const [k, v] of Object.entries(fields || {})) {
    const r = visit(v, [k]);
    if (r) result.fields[k] = r;
  }
  return result;
}
