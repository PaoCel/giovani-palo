import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  type QueryConstraint,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { db, functions } from "@/services/firebase/app";
import {
  mapStakeMember,
  mapStakePrevious,
  type MemberStatus,
  type StakeMember,
  type StakeMemberPrevious,
} from "@/utils/stakeMembership";

// Appartenenza al palo (docs/APPARTENENZA_AL_PALO.md, parte B). Il documento
// `stakes/{s}/members/{uid}` lo scrive solo il server: il client legge e
// chiama la callable `stakeMembership`.

export type StakeMembershipAction =
  | "request"
  | "withdraw"
  | "leave"
  | "approve"
  | "decline"
  | "hasAccount"
  | "notMyUnit"
  | "confirmKnown"
  | "markUnknown"
  | "undo";

export interface StakeMembershipResult {
  ok: true;
  action: StakeMembershipAction;
  status: MemberStatus;
  version: number;
  changed: boolean;
}

const stakeMembershipCallable = httpsCallable<
  { action: StakeMembershipAction; stakeId: string; uid?: string; version?: number },
  StakeMembershipResult
>(functions, "stakeMembership");

function memberDoc(stakeId: string, uid: string) {
  return doc(db, "stakes", stakeId, "members", uid);
}

function membersCollection(stakeId: string) {
  return collection(db, "stakes", stakeId, "members");
}

export type MemberQueueKind = "pending" | "declined" | "review";

// Sole uguaglianze (nessun indice composto). Il dirigente di unità filtra
// sempre per la sua unità dichiarata: senza filtro le rules negano la query.
function queueConstraints(kind: MemberQueueKind, unitId: string | null): QueryConstraint[] {
  const scope = unitId ? [where("claimedUnitId", "==", unitId)] : [];
  if (kind === "review") return [...scope, where("reviewNeeded", "==", true)];
  return [...scope, where("status", "==", kind)];
}

export const stakeMembersService = {
  /**
   * Il proprio documento, in tempo reale. `fromServer` dice se "non esiste"
   * è la risposta del server o solo la cache vuota.
   */
  subscribeOwn(
    stakeId: string,
    uid: string,
    onNext: (member: StakeMember | null, fromServer: boolean) => void,
    onError: (error: Error) => void,
  ): Unsubscribe {
    return onSnapshot(
      memberDoc(stakeId, uid),
      { includeMetadataChanges: true },
      (snapshot) => {
        const member = snapshot.exists() ? mapStakeMember(stakeId, uid, snapshot.data()) : null;
        onNext(member, !snapshot.metadata.fromCache);
      },
      onError,
    );
  },

  /** Coda dello staff: `unitId` per il dirigente di unità, null per l'admin. */
  subscribeQueue(
    stakeId: string,
    kind: MemberQueueKind,
    unitId: string | null,
    onNext: (members: StakeMember[]) => void,
    onError: (error: Error) => void,
  ): Unsubscribe {
    return onSnapshot(
      query(membersCollection(stakeId), ...queueConstraints(kind, unitId)),
      (snapshot) => {
        onNext(
          snapshot.docs
            .map((item) => mapStakeMember(stakeId, item.id, item.data()))
            .filter((member): member is StakeMember => member !== null),
        );
      },
      onError,
    );
  },

  /** Nota dello staff ("stesso nome e data"): mai leggibile dal richiedente. */
  async getStaffNoteKind(stakeId: string, uid: string): Promise<string | null> {
    const snapshot = await getDoc(doc(db, "stakes", stakeId, "members", uid, "staff", "note"));
    if (!snapshot.exists()) return null;
    const kind = snapshot.get("kind");
    return typeof kind === "string" ? kind : null;
  },

  /**
   * Stato di prima dell'ultima azione (azione, chi, unità): vive in un
   * documento dello staff, mai leggibile dal richiedente.
   */
  async getStaffPrevious(stakeId: string, uid: string): Promise<StakeMemberPrevious | null> {
    const snapshot = await getDoc(doc(db, "stakes", stakeId, "members", uid, "staff", "previous"));
    return snapshot.exists() ? mapStakePrevious(snapshot.data()) : null;
  },

  async run(input: { action: StakeMembershipAction; stakeId: string; uid?: string; version?: number }) {
    const response = await stakeMembershipCallable(input);
    return response.data;
  },
};
