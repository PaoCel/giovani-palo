import { collection, doc, getDocs, updateDoc } from "firebase/firestore";

import { db } from "@/services/firebase/app";
import type { ConsentTask } from "@/types";

function tasksCollection(stakeId: string, activityId: string) {
  return collection(db, "stakes", stakeId, "activities", activityId, "consentTasks");
}

/**
 * Compiti per gli admin dopo la revoca di un consenso foto o social. Li crea
 * la callable `parentConsentUpdate`; qui si leggono e si segnano fatti (o di
 * nuovo da fare). Lettura da server: non deve mostrare compiti già chiusi.
 */
export const consentTasksService = {
  async listTasks(stakeId: string, activityId: string): Promise<ConsentTask[]> {
    const snap = await getDocs(tasksCollection(stakeId, activityId));
    return snap.docs
      .map((d) => ({ ...(d.data() as Omit<ConsentTask, "id">), id: d.id }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  },

  /** Scrive solo `status`, `doneAt` e `doneByUid`, come richiedono le rules. */
  async setTaskDone(
    stakeId: string,
    activityId: string,
    taskId: string,
    done: boolean,
    adminUid: string,
  ): Promise<void> {
    await updateDoc(
      doc(db, "stakes", stakeId, "activities", activityId, "consentTasks", taskId),
      done
        ? {
            status: "done",
            doneAt: new Date().toISOString(),
            doneByUid: adminUid,
          }
        : {
            status: "todo",
            doneAt: null,
            doneByUid: null,
          },
    );
  },
};
