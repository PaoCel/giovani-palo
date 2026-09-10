import { collection, doc, getDocsFromServer, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/services/firebase/app";
import { layoutFromDoc, layoutToDoc, type RoomLayout } from "@/utils/roomLayout";

export const roomLayoutService = {
  // Server-first like the room plan: a stale cached layout would place rooms in the wrong spot.
  async list(stakeId: string): Promise<{ layouts: RoomLayout[]; unreadable: string[] }> {
    const snapshot = await getDocsFromServer(collection(db, "stakes", stakeId, "roomLayouts"));
    const layouts: RoomLayout[] = [];
    const unreadable: string[] = [];
    for (const document of snapshot.docs) {
      try { layouts.push(layoutFromDoc(document.id, document.data())); } catch { unreadable.push(document.id); }
    }
    return { layouts, unreadable };
  },
  async save(stakeId: string, layout: RoomLayout) {
    await setDoc(doc(db, "stakes", stakeId, "roomLayouts", layout.id), { ...layoutToDoc(layout), updatedAt: serverTimestamp() });
  },
};
