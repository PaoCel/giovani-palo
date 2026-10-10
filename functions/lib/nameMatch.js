/**
 * Confronto fra nomi di persona: funzioni pure, senza accesso ai dati.
 *
 * Estratte da roomMates.js (suggerimenti compagni di stanza) senza cambiarne
 * il comportamento, così le usa anche la Notte dei Record per proporre allo
 * staff a quale iscrizione collegare una richiesta senza account. Chi le
 * modifica sposta i punteggi di entrambe le funzioni: i test di roomMates e
 * di recordNightGuest lo mostrano.
 */

// Soglia sotto cui un candidato non si propone (stessa di roomMateSuggestions).
const MIN_MATCH_SCORE = 0.45;

function stripDiacritics(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeName(value) {
  return stripDiacritics(String(value || ""))
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTokens(value) {
  return normalizeName(value).split(" ").filter(Boolean);
}

// I nomi arrivano dalle iscrizioni con maiuscole ballerine ("Camilla
// fiorillo"): si sistemano solo i pezzi scritti tutti minuscoli, per non
// rovinare "De Luca" o "D'Angelo" già scritti bene.
function titleCaseToken(token) {
  if (token !== token.toLowerCase()) {
    return token;
  }

  return token.replace(/(^|['\u2019-])([a-zà-ÿ])/g, (_, prefix, letter) => prefix + letter.toUpperCase());
}

function toDisplayName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(titleCaseToken)
    .join(" ");
}

function isUsableName(value) {
  return toTokens(value).length >= 2;
}

function levenshtein(left, right) {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }

  return previous[right.length];
}

function similarity(left, right) {
  const longest = Math.max(left.length, right.length);
  if (!longest) return 0;
  return 1 - levenshtein(left, right) / longest;
}

/**
 * Punteggio 0..1 tra quello che ha scritto il ragazzo e un nome del bacino.
 * Il nome parziale ("camilla") deve pescare "Camilla Fiorillo", ma un typo
 * ("camila fiorilo") deve pescarlo comunque.
 */
function scoreCandidate(queryTokens, candidateTokens) {
  if (!queryTokens.length || !candidateTokens.length) return 0;

  const queryText = queryTokens.join(" ");
  const candidateText = candidateTokens.join(" ");

  if (queryText === candidateText) return 1;

  const used = new Set();
  let matched = 0;

  for (const token of queryTokens) {
    let bestIndex = -1;
    let bestScore = 0;

    candidateTokens.forEach((candidateToken, index) => {
      if (used.has(index)) return;

      const tokenScore =
        candidateToken === token
          ? 1
          : candidateToken.startsWith(token) && token.length >= 3
            ? 0.92
            : similarity(token, candidateToken) >= 0.8
              ? 0.8
              : 0;

      if (tokenScore > bestScore) {
        bestScore = tokenScore;
        bestIndex = index;
      }
    });

    if (bestIndex >= 0) {
      used.add(bestIndex);
      matched += bestScore;
    }
  }

  if (!matched) return 0;

  // Copertura sul lato query: chi scrive solo il nome deve comunque vedere il
  // candidato, ma con punteggio sotto 1 così il client sa di dover chiedere
  // conferma invece di dare per buono il match.
  const queryCoverage = matched / queryTokens.length;
  const candidateCoverage = matched / candidateTokens.length;

  return queryCoverage * 0.75 + candidateCoverage * 0.25;
}

module.exports = {
  MIN_MATCH_SCORE,
  stripDiacritics,
  normalizeName,
  toTokens,
  titleCaseToken,
  toDisplayName,
  isUsableName,
  levenshtein,
  similarity,
  scoreCandidate,
};
