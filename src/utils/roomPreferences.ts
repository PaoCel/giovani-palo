import type {
  GenderRoleCategory,
  Registration,
  RegistrationAnswers,
  RoomPreferenceKey,
  RoomPreferenceMatch,
  RoomPreferenceMatches,
} from "@/types";

export interface RoomPreferenceEntry {
  key: RoomPreferenceKey | "roomNotes";
  label: string;
  value: string;
  rawValue: string;
  matchedFullName: string | null;
  isMatched: boolean;
}

interface CandidateScore {
  registration: Registration;
  score: number;
}

const roomPreferenceLabels: Record<RoomPreferenceKey | "roomNotes", string> = {
  roomPreference1Name: "Compagno stanza 1",
  roomPreference2Name: "Compagno stanza 2",
  roomNotes: "Note stanza",
};

export const roomPreferenceKeys: RoomPreferenceKey[] = [
  "roomPreference1Name",
  "roomPreference2Name",
];

function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function uniqueValues(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function getTokens(value: string) {
  return normalizeRoomPreferenceName(value).split(" ").filter(Boolean);
}

function getSortedTokenSignature(value: string) {
  return uniqueValues(getTokens(value)).sort().join(" ");
}

function getTokenDiceScore(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let shared = 0;

  for (const token of leftSet) {
    if (rightSet.has(token)) {
      shared += 1;
    }
  }

  return (2 * shared) / (leftSet.size + rightSet.size);
}

function getLevenshteinDistance(left: string, right: string) {
  if (!left) {
    return right.length;
  }

  if (!right) {
    return left.length;
  }

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array(right.length + 1).fill(0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;

      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }

    for (let rightIndex = 0; rightIndex <= right.length; rightIndex += 1) {
      previous[rightIndex] = current[rightIndex];
    }
  }

  return previous[right.length];
}

function getStringSimilarity(left: string, right: string) {
  if (!left || !right) {
    return 0;
  }

  if (left === right) {
    return 1;
  }

  const maxLength = Math.max(left.length, right.length);

  if (maxLength === 0) {
    return 1;
  }

  return 1 - getLevenshteinDistance(left, right) / maxLength;
}

function getNameVariants(registration: Registration) {
  const fullName = normalizeRoomPreferenceName(registration.fullName);
  const firstLast = normalizeRoomPreferenceName(
    [registration.firstName, registration.lastName].filter(Boolean).join(" "),
  );
  const lastFirst = normalizeRoomPreferenceName(
    [registration.lastName, registration.firstName].filter(Boolean).join(" "),
  );

  return uniqueValues([fullName, firstLast, lastFirst]);
}

function getCandidateScore(
  query: string,
  sourceCategory: GenderRoleCategory | "",
  registration: Registration,
) {
  const queryTokens = getTokens(query);
  const querySignature = getSortedTokenSignature(query);
  let bestScore = 0;

  for (const candidateName of getNameVariants(registration)) {
    const candidateTokens = getTokens(candidateName);
    const candidateSignature = getSortedTokenSignature(candidateName);

    if (!candidateName || candidateTokens.length === 0) {
      continue;
    }

    if (query === candidateName) {
      bestScore = Math.max(bestScore, 1);
      continue;
    }

    if (querySignature && querySignature === candidateSignature) {
      bestScore = Math.max(bestScore, 0.99);
      continue;
    }

    const tokenDice = getTokenDiceScore(queryTokens, candidateTokens);
    const stringSimilarity = getStringSimilarity(query, candidateName);
    const prefixBonus =
      queryTokens.length > 0 &&
      queryTokens.every((token) =>
        candidateTokens.some(
          (candidateToken) =>
            candidateToken.startsWith(token) || token.startsWith(candidateToken),
        ),
      )
        ? 0.08
        : 0;

    const score = Math.min(
      0.97,
      tokenDice * 0.62 + stringSimilarity * 0.38 + prefixBonus,
    );

    bestScore = Math.max(bestScore, score);
  }

  if (sourceCategory && registration.genderRoleCategory === sourceCategory) {
    return Math.min(1, bestScore + 0.02);
  }

  return bestScore;
}

function isAcceptedMatch(bestScore: number, secondScore: number, tokensCount: number) {
  if (tokensCount < 2) {
    return false;
  }

  if (bestScore >= 0.995) {
    return true;
  }

  if (bestScore >= 0.92) {
    return true;
  }

  if (bestScore >= 0.84 && bestScore - secondScore >= 0.08) {
    return true;
  }

  return tokensCount >= 3 && bestScore >= 0.78 && bestScore - secondScore >= 0.14;
}

function toNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeRoomPreferenceName(value: string) {
  return normalizeWhitespace(stripDiacritics(value).toLowerCase())
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasRoomPreferenceFullName(value: string) {
  return getTokens(value).length >= 2;
}

export function getRegistrationTextAnswer(registration: Registration, key: string) {
  const value = registration.answers[key];
  return typeof value === "string" ? normalizeWhitespace(value) : "";
}

export function getRoomPreferenceTextFromAnswers(
  answers: RegistrationAnswers,
  key: RoomPreferenceKey,
) {
  const value = answers[key];
  return typeof value === "string" ? normalizeWhitespace(value) : "";
}

export function parseRoomPreferenceMatches(value: unknown): RoomPreferenceMatches {
  if (!value || typeof value !== "object") {
    return {};
  }

  const source = value as Record<string, unknown>;
  const matches: RoomPreferenceMatches = {};

  for (const key of roomPreferenceKeys) {
    const entry = source[key];

    if (!entry || typeof entry !== "object") {
      continue;
    }

    const data = entry as Record<string, unknown>;
    const rawValue = toNullableString(data.rawValue);
    const normalizedValue = toNullableString(data.normalizedValue);
    const updatedAt = toNullableString(data.updatedAt);

    if (!rawValue || !normalizedValue || !updatedAt) {
      continue;
    }

    matches[key] = {
      key,
      rawValue,
      normalizedValue,
      matchedRegistrationId: toNullableString(data.matchedRegistrationId),
      matchedFullName: toNullableString(data.matchedFullName),
      matchedCategory:
        data.matchedCategory === "giovane_uomo" ||
        data.matchedCategory === "giovane_donna" ||
        data.matchedCategory === "dirigente"
          ? data.matchedCategory
          : "",
      score: typeof data.score === "number" ? data.score : null,
      status: data.status === "matched" ? "matched" : "unmatched",
      updatedAt,
    };
  }

  return matches;
}

export function preserveRoomPreferenceMatchesOnSave(
  existingMatches: RoomPreferenceMatches,
  answers: RegistrationAnswers,
) {
  const nextMatches: RoomPreferenceMatches = {};

  for (const key of roomPreferenceKeys) {
    const rawValue = getRoomPreferenceTextFromAnswers(answers, key);
    const existingMatch = existingMatches[key];

    if (!rawValue || !existingMatch) {
      continue;
    }

    if (existingMatch.normalizedValue === normalizeRoomPreferenceName(rawValue)) {
      nextMatches[key] = {
        ...existingMatch,
        rawValue,
      };
    }
  }

  return nextMatches;
}

export function findRoomPreferenceMatch(
  sourceRegistration: Registration,
  key: RoomPreferenceKey,
  registrations: Registration[],
  timestamp: string,
): RoomPreferenceMatch | null {
  const rawValue = getRegistrationTextAnswer(sourceRegistration, key);
  const normalizedValue = normalizeRoomPreferenceName(rawValue);

  if (!rawValue) {
    return null;
  }

  const candidates = registrations
    .filter(
      (registration) =>
        registration.id !== sourceRegistration.id &&
        registration.registrationStatus !== "cancelled" &&
        registration.status !== "cancelled",
    )
    .map<CandidateScore>((registration) => ({
      registration,
      score: getCandidateScore(
        normalizedValue,
        sourceRegistration.genderRoleCategory,
        registration,
      ),
    }))
    .sort((left, right) => right.score - left.score);

  const bestCandidate = candidates[0] ?? null;
  const secondCandidate = candidates[1] ?? null;

  if (
    !bestCandidate ||
    !isAcceptedMatch(
      bestCandidate.score,
      secondCandidate?.score ?? 0,
      getTokens(rawValue).length,
    )
  ) {
    return {
      key,
      rawValue,
      normalizedValue,
      matchedRegistrationId: null,
      matchedFullName: null,
      matchedCategory: "",
      score: bestCandidate?.score ?? null,
      status: "unmatched",
      updatedAt: timestamp,
    };
  }

  return {
    key,
    rawValue,
    normalizedValue,
    matchedRegistrationId: bestCandidate.registration.id,
    matchedFullName: getRegistrationDisplayName(bestCandidate.registration),
    matchedCategory: bestCandidate.registration.genderRoleCategory,
    score: Math.round(bestCandidate.score * 1000) / 1000,
    status: "matched",
    updatedAt: timestamp,
  };
}

export function getRoomPreferenceLabel(key: RoomPreferenceKey | "roomNotes") {
  return roomPreferenceLabels[key];
}

export function getRoomPreferenceMatch(
  registration: Registration,
  key: RoomPreferenceKey,
) {
  return registration.roomPreferenceMatches[key] ?? null;
}

export function getRoomPreferenceResolvedName(
  registration: Registration,
  key: RoomPreferenceKey,
) {
  const match = getRoomPreferenceMatch(registration, key);

  return match?.status === "matched" && match.matchedFullName
    ? match.matchedFullName
    : getRegistrationTextAnswer(registration, key);
}

export function formatRoomPreferenceValue(
  registration: Registration,
  key: RoomPreferenceKey,
) {
  const rawValue = getRegistrationTextAnswer(registration, key);
  const match = getRoomPreferenceMatch(registration, key);

  if (!rawValue) {
    return "";
  }

  if (match?.status === "matched" && match.matchedFullName) {
    return match.matchedFullName;
  }

  return rawValue;
}

export function getRoomPreferenceEntries(registration: Registration): RoomPreferenceEntry[] {
  const entries = roomPreferenceKeys.reduce<RoomPreferenceEntry[]>((accumulator, key) => {
    const rawValue = getRegistrationTextAnswer(registration, key);

    if (!rawValue) {
      return accumulator;
    }

    const match = getRoomPreferenceMatch(registration, key);

    accumulator.push({
      key,
      label: getRoomPreferenceLabel(key),
      value: formatRoomPreferenceValue(registration, key),
      rawValue,
      matchedFullName: match?.matchedFullName ?? null,
      isMatched: match?.status === "matched" && Boolean(match.matchedRegistrationId),
    });

    return accumulator;
  }, []);

  const roomNotes = getRegistrationTextAnswer(registration, "roomNotes");

  if (roomNotes) {
    entries.push({
      key: "roomNotes",
      label: getRoomPreferenceLabel("roomNotes"),
      value: roomNotes,
      rawValue: roomNotes,
      matchedFullName: null,
      isMatched: false,
    });
  }

  return entries;
}

export function getRegistrationDisplayName(registration: Registration) {
  const fullName = [registration.lastName, registration.firstName]
    .filter(Boolean)
    .join(" ")
    .trim();

  return fullName || registration.fullName;
}
