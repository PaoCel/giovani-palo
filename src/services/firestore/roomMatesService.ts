import { httpsCallable } from "firebase/functions";

import { functions } from "@/services/firebase/app";
import {
  NO_ASSIGNED_ROOM,
  parseAssignedRoomResult,
  type AssignedRoomResult,
} from "@/utils/roomMates";

export type { AssignedRoom, AssignedRoomMate, AssignedRoomResult } from "@/utils/roomMates";

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

const assignedCallable = httpsCallable<
  { stakeId: string; activityId: string; childId?: string },
  unknown
>(functions, "roomMates");

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

  // Stanza assegnata e compagni (docs/ROOM_MANAGEMENT.md, «Compagni di
  // stanza»): la propria iscrizione, o quella del figlio con `childId`. Il
  // server decide tutto dal token; nessuna cache, così chi annulla sparisce
  // alla lettura dopo. Errori della callable (not-found, rete) al chiamante.
  async getAssigned(input: {
    stakeId: string;
    activityId: string;
    childId?: string | null;
  }): Promise<AssignedRoomResult> {
    if (!input.stakeId || !input.activityId) {
      return NO_ASSIGNED_ROOM;
    }

    const result = await assignedCallable({
      stakeId: input.stakeId,
      activityId: input.activityId,
      ...(input.childId ? { childId: input.childId } : {}),
    });
    return parseAssignedRoomResult(result.data);
  },
};
