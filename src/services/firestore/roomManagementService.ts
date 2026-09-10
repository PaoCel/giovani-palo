import { doc, getDocFromServer } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/services/firebase/app";
import { emptyRoomPlan, type RoomPlan } from "../../../functions/lib/roomPlannerCore.mjs";

const save = httpsCallable<{
  stakeId: string; activityId: string; plan: RoomPlan; expectedRevision: number;
}, { plan: RoomPlan }>(functions, "roomManagementSave");

export const roomManagementService = {
  async load(stakeId: string, activityId: string): Promise<RoomPlan> {
    // The revision must be current before editing a shared administrative draft.
    const snapshot = await getDocFromServer(doc(db, "stakes", stakeId, "activities", activityId, "management", "rooms"));
    if (!snapshot.exists()) return emptyRoomPlan();
    const { savedAt: _savedAt, ...plan } = snapshot.data();
    return plan as RoomPlan;
  },
  async save(stakeId: string, activityId: string, plan: RoomPlan, expectedRevision: number) {
    return (await save({ stakeId, activityId, plan, expectedRevision })).data.plan;
  },
};
