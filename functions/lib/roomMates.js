/**
 * Suggerimenti nomi per le preferenze stanza.
 *
 * Il giovane scrive "Camilla" e il modulo deve poter chiedere "intendi Camilla
 * Fiorillo?". I nomi NON vengono mai scaricati in blocco sul client: la
 * ricerca gira qui e torna al massimo 5 risultati, così l'elenco dei
 * partecipanti (minori) non è estraibile da chi si iscrive.
 *
 * Il bacino è costruito dalle iscrizioni alle attività del palo:
 *  - nomi dei partecipanti con categoria giovane_uomo / giovane_donna
 *    (dirigenti, accompagnatori e genitori restano fuori);
 *  - nomi già indicati come preferenza stanza nelle iscrizioni precedenti,
 *    così chi non era ancora passato dalla piattaforma entra comunque in
 *    elenco per chi si iscrive dopo.
 *
 * Il bacino è tenuto in memoria dell'istanza per POOL_TTL_MS: senza cache ogni
 * tasto premuto rileggerebbe ~500 documenti.
 */

const { getFirestore } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const { REGION } = require("./config");
const {
  MIN_MATCH_SCORE,
  normalizeName,
  scoreCandidate,
  toDisplayName,
  toTokens,
  isUsableName,
} = require("./nameMatch");

const POOL_TTL_MS = 5 * 60 * 1000;
const MAX_SUGGESTIONS = 5;
const MIN_SCORE = MIN_MATCH_SCORE;
const YOUTH_CATEGORIES = new Set(["giovane_uomo", "giovane_donna"]);

const poolCache = new Map();

async function buildPool(db, stakeId) {
  const activities = await db.collection(`stakes/${stakeId}/activities`).get();
  const entries = new Map();

  function addName(rawName, source) {
    if (!isUsableName(rawName)) return;

    const key = normalizeName(rawName);
    const existing = entries.get(key);

    if (!existing) {
      entries.set(key, { name: toDisplayName(rawName), source, hits: 1 });
      return;
    }

    existing.hits += 1;
    // Il nome di un partecipante reale vince su quello digitato a mano.
    if (existing.source === "typed" && source === "participant") {
      existing.name = toDisplayName(rawName);
      existing.source = "participant";
    }
  }

  await Promise.all(
    activities.docs.map(async (activity) => {
      const registrations = await activity.ref.collection("registrations").get();

      registrations.docs.forEach((registration) => {
        const data = registration.data() || {};

        if (data.registrationStatus === "cancelled" || data.status === "cancelled") {
          return;
        }

        if (YOUTH_CATEGORIES.has(data.genderRoleCategory)) {
          addName(
            data.fullName || `${data.firstName || ""} ${data.lastName || ""}`,
            "participant",
          );
        }

        const answers = data.answers || {};
        addName(answers.roomPreference1Name, "typed");
        addName(answers.roomPreference2Name, "typed");
      });
    }),
  );

  // "Camila Guerra", "Camila Guerra Campos" e "Camila Mia Guerra Campos" sono
  // la stessa ragazza scritta in tre modi: proporle tutte costringerebbe a
  // indovinare. Le varianti in cui un nome è contenuto nell'altro finiscono in
  // un unico gruppo, con un solo nome mostrato — quello dell'iscrizione vera,
  // che è il modo in cui la persona è registrata.
  const variants = [...entries.values()].map((entry) => ({
    ...entry,
    tokens: toTokens(entry.name),
  }));
  const clusters = [];

  for (const variant of variants) {
    const cluster = clusters.find((candidate) =>
      candidate.variants.some(
        (other) =>
          other.tokens.every((token) => variant.tokens.includes(token)) ||
          variant.tokens.every((token) => other.tokens.includes(token)),
      ),
    );

    if (cluster) {
      cluster.variants.push(variant);
      continue;
    }

    clusters.push({ variants: [variant] });
  }

  return clusters.map((cluster) => {
    // Nome mostrato: quello di un'iscrizione reale (più ripetuto = più
    // affidabile), altrimenti la variante digitata più ricorrente.
    const best = [...cluster.variants].sort((left, right) => {
      if (left.source !== right.source) {
        return left.source === "participant" ? -1 : 1;
      }
      if (right.hits !== left.hits) {
        return right.hits - left.hits;
      }
      return left.tokens.length - right.tokens.length;
    })[0];

    return {
      name: best.name,
      source: best.source,
      variants: cluster.variants.map((variant) => variant.tokens),
    };
  });
}

async function getPool(db, stakeId) {
  const cached = poolCache.get(stakeId);

  if (cached && Date.now() - cached.builtAt < POOL_TTL_MS) {
    return cached.entries;
  }

  const entries = await buildPool(db, stakeId);
  poolCache.set(stakeId, { entries, builtAt: Date.now() });
  return entries;
}

const roomMateSuggestions = onCall({ region: REGION }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Login richiesto.");
  }

  if (request.auth.token?.firebase?.sign_in_provider === "anonymous") {
    throw new HttpsError("permission-denied", "Serve un account per questa ricerca.");
  }

  const stakeId = String(request.data?.stakeId || "").trim();
  const query = String(request.data?.query || "").trim();

  if (!stakeId) {
    throw new HttpsError("invalid-argument", "stakeId obbligatorio.");
  }

  const db = getFirestore();
  const userDoc = await db.doc(`users/${request.auth.uid}`).get();

  if (!userDoc.exists) {
    throw new HttpsError("permission-denied", "Profilo utente non trovato.");
  }

  const profile = userDoc.data() || {};

  if (profile.stakeId !== stakeId && profile.role !== "super_admin") {
    throw new HttpsError("permission-denied", "Palo non corrispondente al profilo.");
  }

  const queryTokens = toTokens(query);

  if (queryTokens.length === 0 || query.length < 2) {
    return { suggestions: [] };
  }

  const pool = await getPool(db, stakeId);
  const scored = pool
    .map((entry) => ({
      name: entry.name,
      // Chi scrive "Campos" deve pescare comunque il gruppo, anche se il nome
      // mostrato è "Camila Guerra".
      score: Math.max(
        ...entry.variants.map((tokens) => scoreCandidate(queryTokens, tokens)),
      ),
    }))
    .filter((entry) => entry.score >= MIN_SCORE)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_SUGGESTIONS);

  return {
    suggestions: scored,
    // Il client mostra "confermato" senza domanda solo su un match pieno.
    exact: scored.length > 0 && scored[0].score === 1,
  };
});

module.exports = { roomMateSuggestions };
