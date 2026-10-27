export type ActivityMomentType = "info" | "turni";
export type ActivityMomentStatus = "draft" | "published" | "hidden";
export interface MomentEntry {
  registrationId: string;
  revision: number;
  status: "approved" | "withdrawn";
  withdrawnReason:
    | "participant"
    | "registration_inactive"
    | "ownership_changed"
    | "account_deleted"
    | null;
  restoreBlockedReason: "full" | "closed" | null;
  titleSnapshot: string;
  startsAtSnapshot: string;
}
export interface ActivityMoment {
  id: string;
  type: ActivityMomentType;
  title: string;
  description: string;
  place: string;
  startsAt: string;
  endsAt: string;
  status: ActivityMomentStatus;
  revision: number;
  visibleFrom: string | null;
  capacity: number | null;
  taken: number;
  hasEntries: boolean;
  participation: {
    opensAt: string;
    closesAt: string;
    customWindow: boolean;
  } | null;
  updatedAt: string | null;
}
export interface ParticipantMoment extends ActivityMoment {
  restricted: boolean;
  participationOpen: boolean;
  entries: MomentEntry[];
}
export interface MomentPerson {
  registrationId: string;
  displayName: string;
  isSelf: boolean;
  eligible: boolean;
}
export interface MomentsContext {
  serverNow: string;
  people: MomentPerson[];
  moments: ParticipantMoment[];
}
export interface MomentFields {
  type: ActivityMomentType;
  title: string;
  startsAt: string;
  endsAt?: string;
  place?: string;
  description?: string;
  capacity?: number;
  customWindow?: boolean;
  opensAt?: string;
  closesAt?: string;
}
export type MomentAdminAction =
  | "save"
  | "publish"
  | "hide"
  | "show"
  | "draft"
  | "delete";
export interface MomentAdminRequest {
  action: MomentAdminAction;
  momentId: string;
  requestId: string;
  expectedRevision: number | null;
  fields?: MomentFields;
}
export interface MomentRosterRow {
  registrationId: string;
  displayName: string;
  status: "approved";
}

export interface MomentParticipantRequest {
  action: "join" | "withdraw";
  momentId: string;
  registrationId: string;
  expectedRevision: number | null;
  requestId: string;
}
