import { doc, setDoc } from "firebase/firestore";

import { db } from "@/services/firebase/app";
import { getDocCacheFirst } from "@/services/firestore/cacheFirst";

function getPackingChecklistReference(stakeId: string, activityId: string, userId: string) {
  return doc(db, "stakes", stakeId, "activities", activityId, "packingChecklists", userId);
}

function normalizeCheckedItemIds(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export const packingChecklistService = {
  async getCheckedItemIds(stakeId: string, activityId: string, userId: string): Promise<string[]> {
    const snapshot = await getDocCacheFirst(getPackingChecklistReference(stakeId, activityId, userId));

    if (!snapshot.exists()) {
      return [];
    }

    return normalizeCheckedItemIds(snapshot.data().checkedItemIds);
  },

  async saveCheckedItemIds(
    stakeId: string,
    activityId: string,
    userId: string,
    checkedItemIds: string[],
  ): Promise<void> {
    await setDoc(
      getPackingChecklistReference(stakeId, activityId, userId),
      {
        userId,
        checkedItemIds: Array.from(new Set(checkedItemIds)),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  },
};
