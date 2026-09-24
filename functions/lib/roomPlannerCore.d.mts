export type RoomCategory = "unassigned" | "boys" | "girls" | "staff_male" | "staff_female" | "couple";
export type AdultGender = "male" | "female";

export interface Room {
  id: string;
  name: string;
  capacity: number;
  floor: string;
  category: RoomCategory;
  accessible: boolean;
  notes: string;
  minAge: number | null;
  maxAge: number | null;
}

export interface RoomPlan {
  rooms: Room[];
  assignments: Record<string, string>;
  lockedIds: string[];
  adultGenders: Record<string, AdultGender>;
  couples: Array<{ firstId: string; secondId: string; confirmed: boolean }>;
  /** Con true ogni iscritto assegnato vede il nome della propria stanza. Assente nei piani salvati prima della funzione. */
  published?: boolean;
  revision: number;
  updatedAt: string;
}

export interface PlannerRegistration {
  id: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  birthDate?: string;
  genderRoleCategory?: string;
  registrationStatus?: string;
  status?: string;
  userId?: string | null;
  parentUid?: string | null;
  childId?: string | null;
  anonymousUid?: string | null;
  linkedLaterToUserId?: string | null;
  answers?: Record<string, unknown>;
  roomPreferenceMatches?: Partial<Record<string, {
    matchedRegistrationId?: string | null;
    rawValue?: string;
    status?: string;
  } | null>>;
}

export interface PreferenceLink {
  fromId: string;
  toId: string | null;
  label: string;
  key: string;
}

export const categoryLabels: Readonly<Record<RoomCategory, string>>;
export function emptyRoomPlan(): RoomPlan;
export function eligibleRegistrations<T extends PlannerRegistration>(registrations: readonly T[]): T[];
export function ageAt(birthDate: unknown, referenceDate: Date | string): number | null;
export function validateRoomPlan(plan: RoomPlan, registrations: readonly PlannerRegistration[], referenceDate: Date | string): string[];
export function assignmentProblem(person: PlannerRegistration, room: Room, plan: RoomPlan, registrations: readonly PlannerRegistration[], referenceDate: Date | string): string | null;
export function buildPreferenceLinks(registrations: readonly PlannerRegistration[]): PreferenceLink[];
export function proposeRoomPlan(plan: RoomPlan, registrations: readonly PlannerRegistration[], referenceDate: Date | string, options?: {
  recalculate?: boolean;
  occupyAllRoomsFirst?: boolean;
  youthFloors?: { boys: string; girls: string };
}): RoomPlan;
export function roomSummary(plan: RoomPlan, registrations: readonly PlannerRegistration[]): {
  assigned: number;
  totalBeds: number;
  freeBeds: number;
  preferencesMet: number;
  preferencesTotal: number;
  unresolvedPreferences: number;
};
