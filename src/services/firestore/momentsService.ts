import { httpsCallable } from "firebase/functions";
import { functions } from "@/services/firebase/app";
import type {
  ActivityMoment,
  MomentAdminRequest,
  MomentEntry,
  MomentParticipantRequest,
  MomentRosterRow,
  MomentsContext,
} from "@/types/moments";
const adminCall = httpsCallable<
  Record<string, unknown>,
  {
    moments?: ActivityMoment[];
    moment?: ActivityMoment | null;
    entries?: MomentRosterRow[];
    deleted?: boolean;
  }
>(functions, "momentsAdmin", { timeout: 30_000 });
const participantCall = httpsCallable<
  Record<string, unknown>,
  MomentsContext & { entry?: MomentEntry }
>(functions, "momentsParticipant", { timeout: 30_000 });
export const momentsService = {
  async adminContext(
    stakeId: string,
    activityId: string,
  ): Promise<ActivityMoment[]> {
    return (
      (await adminCall({ action: "context", stakeId, activityId })).data
        .moments ?? []
    );
  },
  async adminMutate(
    stakeId: string,
    activityId: string,
    request: MomentAdminRequest,
  ) {
    return (await adminCall({ ...request, stakeId, activityId })).data;
  },
  async roster(
    stakeId: string,
    activityId: string,
    momentId: string,
  ): Promise<MomentRosterRow[]> {
    return (
      (await adminCall({ action: "roster", stakeId, activityId, momentId }))
        .data.entries ?? []
    );
  },
  async context(stakeId: string, activityId: string): Promise<MomentsContext> {
    return (await participantCall({ action: "context", stakeId, activityId }))
      .data;
  },
  async participate(
    stakeId: string,
    activityId: string,
    request: MomentParticipantRequest,
  ) {
    return (
      (await participantCall({ ...request, stakeId, activityId })).data.entry ??
      null
    );
  },
};
