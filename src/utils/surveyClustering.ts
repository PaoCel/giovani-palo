// Naive clustering of free-text survey answers.
// Goal: group "cibo", "cib", "il cibo", "mi è piaciuto il cibo" into one bucket.
//
// Strategia leggera (no librerie esterne):
// 1) normalizza: minuscolo, accenti rimossi, punteggiatura via.
// 2) tokenizza in parole, scarta stopword italiane comuni e parole < 3 char.
// 3) per ogni risposta tieni solo "parole significative" (i token rimanenti).
// 4) due risposte sono nella stessa cluster se condividono almeno UN token
//    significativo OPPURE uno è prefisso dell'altro per >= 3 caratteri.
// 5) il "label" della cluster è il token più ricorrente fra i suoi membri.

const ITALIAN_STOPWORDS = new Set([
  "il", "lo", "la", "i", "gli", "le",
  "un", "uno", "una",
  "di", "a", "da", "in", "con", "su", "per", "tra", "fra",
  "del", "dello", "della", "dei", "degli", "delle",
  "al", "allo", "alla", "ai", "agli", "alle",
  "dal", "dallo", "dalla", "dai", "dagli", "dalle",
  "nel", "nello", "nella", "nei", "negli", "nelle",
  "col", "coi",
  "sul", "sullo", "sulla", "sui", "sugli", "sulle",
  "e", "o", "ma", "se", "che", "non", "anche", "molto", "poco", "tanto",
  "mi", "ti", "ci", "vi", "si", "lo", "la", "gli", "le", "ne",
  "ho", "hai", "ha", "hanno", "abbiamo", "avete",
  "sono", "sei", "è", "siamo", "siete",
  "era", "erano", "sarà", "saranno",
  "questo", "questa", "questi", "queste",
  "quello", "quella", "quelli", "quelle",
  "molto", "tanto", "tutto", "tutti", "tutte", "tutta",
  "piaciuto", "piaciuta", "piaciuti", "piaciute", "piace", "piacciono",
  "trovato", "trovata", "stato", "stata",
  "bene", "bello", "bella", "belli", "belle", "buono", "buona", "buoni", "buone",
]);

export function normalizeSurveyAnswer(value: string): string {
  return value
    .toLocaleLowerCase("it-IT")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTokens(value: string): string[] {
  const normalized = normalizeSurveyAnswer(value);
  if (!normalized) return [];
  return normalized
    .split(" ")
    .filter((token) => token.length >= 3 && !ITALIAN_STOPWORDS.has(token));
}

function shareSignificantToken(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  for (const token of a) {
    if (b.has(token)) return true;
    // anche prefisso di almeno 3 char ("cib" vs "cibo")
    for (const other of b) {
      if (token.length >= 3 && other.startsWith(token)) return true;
      if (other.length >= 3 && token.startsWith(other)) return true;
    }
  }
  return false;
}

export interface SurveyAnswerCluster {
  label: string; // token rappresentativo
  count: number;
  examples: string[]; // risposte originali (max ~5)
}

export function clusterSurveyAnswers(rawAnswers: string[]): SurveyAnswerCluster[] {
  const items = rawAnswers
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((original) => ({
      original,
      tokens: new Set(extractTokens(original)),
      normalized: normalizeSurveyAnswer(original),
    }));

  if (items.length === 0) return [];

  type Bucket = {
    label: string;
    examples: string[];
    tokenFreq: Map<string, number>;
    members: typeof items;
  };

  const buckets: Bucket[] = [];

  for (const item of items) {
    let placed = false;

    // se l'item non ha token significativi, raggruppalo per testo normalizzato
    if (item.tokens.size === 0) {
      const fallback = item.normalized || item.original;
      const existing = buckets.find((bucket) => bucket.label === fallback);
      if (existing) {
        existing.examples.push(item.original);
        existing.members.push(item);
      } else {
        buckets.push({
          label: fallback,
          examples: [item.original],
          tokenFreq: new Map(),
          members: [item],
        });
      }
      continue;
    }

    for (const bucket of buckets) {
      const bucketTokens = new Set(bucket.tokenFreq.keys());
      if (shareSignificantToken(item.tokens, bucketTokens)) {
        bucket.examples.push(item.original);
        bucket.members.push(item);
        for (const token of item.tokens) {
          bucket.tokenFreq.set(token, (bucket.tokenFreq.get(token) ?? 0) + 1);
        }
        placed = true;
        break;
      }
    }

    if (!placed) {
      const tokenFreq = new Map<string, number>();
      for (const token of item.tokens) tokenFreq.set(token, 1);
      buckets.push({
        label: "",
        examples: [item.original],
        tokenFreq,
        members: [item],
      });
    }
  }

  // calcola label come token più frequente del bucket
  for (const bucket of buckets) {
    if (bucket.label) continue;
    let bestToken = "";
    let bestCount = 0;
    for (const [token, count] of bucket.tokenFreq) {
      if (count > bestCount || (count === bestCount && token.length < bestToken.length)) {
        bestToken = token;
        bestCount = count;
      }
    }
    bucket.label = bestToken || bucket.examples[0] || "altro";
  }

  return buckets
    .map<SurveyAnswerCluster>((bucket) => ({
      label: bucket.label,
      count: bucket.members.length,
      examples: bucket.examples.slice(0, 5),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "it-IT"));
}
