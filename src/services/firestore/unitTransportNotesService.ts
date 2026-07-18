import {
  collection,
  deleteDoc,
  doc,
  setDoc,
} from "firebase/firestore";

import { db } from "@/services/firebase/app";
import { getDocsCacheFirst } from "@/services/firestore/cacheFirst";

export const unitTransportNotesService = {
  async listResolved(stakeId: string, activityId: string): Promise<string[]> {
    const snap = await getDocsCacheFirst(
      collection(db, "stakes", stakeId, "activities", activityId, "transportNotes"),
    );
    return snap.docs.map((d) => d.id);
  },

  async markResolved(
    stakeId: string,
    activityId: string,
    registrationId: string,
    resolvedByUid: string,
  ): Promise<void> {
    await setDoc(
      doc(db, "stakes", stakeId, "activities", activityId, "transportNotes", registrationId),
      {
        registrationId,
        resolvedByUid,
        resolvedAt: new Date().toISOString(),
      },
    );
  },

  async clearResolved(
    stakeId: string,
    activityId: string,
    registrationId: string,
  ): Promise<void> {
    await deleteDoc(
      doc(db, "stakes", stakeId, "activities", activityId, "transportNotes", registrationId),
    );
  },
};
