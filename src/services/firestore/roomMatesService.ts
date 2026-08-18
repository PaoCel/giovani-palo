import { httpsCallable } from "firebase/functions";

import { functions } from "@/services/firebase/app";

export interface RoomMateSuggestion {
  name: string;
  score: number;
}

interface SuggestionsResult {
  suggestions: RoomMateSuggestion[];
  exact?: boolean;
}

const suggestionsCallable = httpsCallable<
  { stakeId: string; query: string },
  SuggestionsResult
>(functions, "roomMateSuggestions");

// I nomi non arrivano mai in blocco: si interroga il server a ogni ricerca.
// Questa cache evita solo di ripetere la STESSA ricerca (l'utente che cancella
// una lettera e la riscrive) e vive per la sessione della tab.
const cache = new Map<string, RoomMateSuggestion[]>();

export const roomMatesService = {
  async search(stakeId: string, query: string): Promise<RoomMateSuggestion[]> {
    const trimmed = query.trim();

    if (!stakeId || trimmed.length < 2) {
      return [];
    }

    const cacheKey = `${stakeId}|${trimmed.toLowerCase()}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const result = await suggestionsCallable({ stakeId, query: trimmed });
    const suggestions = Array.isArray(result.data?.suggestions)
      ? result.data.suggestions.filter(
          (item): item is RoomMateSuggestion =>
            Boolean(item) && typeof item.name === "string",
        )
      : [];

    cache.set(cacheKey, suggestions);
    return suggestions;
  },
};
