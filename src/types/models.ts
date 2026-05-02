export type UserRole = "admin" | "participant" | "super_admin" | "unit_leader";
export type GenderRoleCategory = "giovane_uomo" | "giovane_donna" | "dirigente";
export type YouthGroup = "Giovani Uomini" | "Giovani Donne" | "Dirigente";
export type EventAudience = "congiunta" | "giovane_uomo" | "giovane_donna";
export type EventStatus =
  | "draft"
  | "planned"
  | "confirmed"
  | "registrations_open"
  | "registrations_closed"
  | "completed"
  | "cancelled";
export type RegistrationStatus =
  | "draft"
  | "submitted"
  | "confirmed"
  | "waitlist"
  | "active"
  | "cancelled";
export type RegistrationAttemptStatus = "started" | "succeeded" | "failed";
export type RegistrationAttemptStep =
  | "submit_started"
  | "registration_saved"
  | "recovery_saved"
  | "completed"
  | "pdf_generated"
  | "submit_failed"
  | "pdf_failed";
export type CustomFieldType = "shortText" | "longText" | "select" | "checkbox";
export type StandardFieldKey =
  | "birthDate"
  | "youthGroup"
  | "genderRoleCategory"
  | "phone"
  | "unitName"
  | "city"
  | "transportMode"
  | "roomPreference1Name"
  | "roomPreference2Name"
  | "roomNotes"
  | "allergies"
  | "dietaryNotes"
  | "medicalNotes"
  | "photoInternalConsent"
  | "photoPublicConsent"
  | "parentConfirmed";
export type RoomPreferenceKey = "roomPreference1Name" | "roomPreference2Name";
export type RoomPreferenceMatchStatus = "matched" | "unmatched";

export interface StandardFieldOverride {
  label?: string;
  helpText?: string;
  options?: string[];
}

export type StandardFieldOverrides = Partial<
  Record<StandardFieldKey, StandardFieldOverride>
>;

export type RegistrationAnswerValue = string | boolean | number | string[] | null;
export type RegistrationAnswers = Record<string, RegistrationAnswerValue>;

export interface RoomPreferenceMatch {
  key: RoomPreferenceKey;
  rawValue: string;
  normalizedValue: string;
  matchedRegistrationId: string | null;
  matchedFullName: string | null;
  matchedCategory: GenderRoleCategory | "";
  score: number | null;
  status: RoomPreferenceMatchStatus;
  updatedAt: string;
}

export type RoomPreferenceMatches = Partial<
  Record<RoomPreferenceKey, RoomPreferenceMatch | null>
>;

export interface StakeSummary {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Unit {
  id: string;
  stakeId: string;
  name: string;
  type: "rione" | "ramo";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  role: UserRole;
  birthDate: string;
  genderRoleCategory: GenderRoleCategory | "";
  youthGroup: YouthGroup | "";
  unitId: string;
  unitName: string;
  stakeId: string;
  stakeSlug: string;
  stakeName: string;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
}

export interface OrganizationRegistrationDefaults {
  allowGuestRegistration: boolean;
  requireLoginForEdit: boolean;
  enabledStandardFields: StandardFieldKey[];
  fieldOverrides?: StandardFieldOverrides;
}

export type StakeRegistrationDefaults = OrganizationRegistrationDefaults;

export interface OrganizationProfile {
  id: string;
  stakeId: string;
  stakeName: string;
  stakeSlug: string;
  isActive: boolean;
  publicHomeTitle: string;
  publicHomeSubtitle: string;
  accountHelpText: string;
  codeRecoveryHelpText: string;
  units: string[];
  youngMenPresident: string;
  youngMenCounselors: string[];
  youngWomenPresident: string;
  youngWomenCounselors: string[];
  supportContact: string;
  guestRegistrationHint: string;
  minorConsentExampleImageUrl?: string;
  minorConsentExampleImagePath?: string;
  unitOptions?: Unit[];
  registrationDefaults: OrganizationRegistrationDefaults;
  updatedAt: string;
}

export interface EventStatsSummary {
  totalRegistrations?: number;
  confirmedRegistrations?: number;
  cancelledRegistrations?: number;
  totalActiveRegistrations?: number;
  totalCancelledRegistrations?: number;
  submittedByMode?: {
    authenticated: number;
    anonymous: number;
  };
}

export interface Event {
  id: string;
  activityId?: string;
  stakeId: string;
  title: string;
  slug: string;
  description: string;
  year: number;
  audience: EventAudience;
  startDate: string;
  endDate: string;
  location: string;
  program: string;
  publicNotes: string;
  organizerNotes: string;
  menuInfo: string;
  allergiesInfo: string;
  roomsInfo: string;
  heroImageUrl: string;
  heroImagePath: string;
  coverImageUrl?: string;
  coverImagePath?: string;
  status: EventStatus;
  isPublic: boolean;
  isVisible: boolean;
  allowGuestRegistration: boolean;
  requireLoginForEdit: boolean;
  registrationOpen: string;
  registrationClose: string;
  registrationOpenAt?: string;
  registrationCloseAt?: string;
  maxParticipants: number | null;
  overnight: boolean;
  templateId: string | null;
  questionsEnabled: boolean;
  requiresParentalConsent: boolean;
  requiresPhotoRelease: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  statsSummary?: EventStatsSummary | null;
}

export interface CustomField {
  id: string;
  key: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  helpText?: string;
  options?: string[];
  order?: number;
  presetOrigin?: string;
  visibilityRules?: Record<string, unknown> | null;
}

export interface EventFormConfig {
  allowGuestRegistration: boolean;
  requireLoginForEdit: boolean;
  enabledStandardFields: StandardFieldKey[];
  customFields: CustomField[];
  templateId?: string | null;
}

export interface Registration {
  id: string;
  eventId: string;
  activityId: string;
  stakeId: string;
  userId: string | null;
  anonymousAuthUid?: string | null;
  anonymousUid: string | null;
  anonymousTokenId: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  birthDate: string;
  genderRoleCategory: GenderRoleCategory | "";
  youthGroup: YouthGroup | "";
  unitId: string;
  unitName?: string;
  unitNameSnapshot: string;
  answers: RegistrationAnswers;
  roomPreferenceMatches: RoomPreferenceMatches;
  accessCode: string | null;
  recoveryCode: string | null;
  recoveryPdfGenerated: boolean;
  parentConsentDocumentName: string | null;
  parentConsentDocumentUrl: string | null;
  parentConsentDocumentPath: string | null;
  parentConsentUploadedAt: string | null;
  consentSignatureUrl: string | null;
  consentSignaturePath: string | null;
  consentSignatureSetAt: string | null;
  parentIdDocumentName: string | null;
  parentIdDocumentUrl: string | null;
  parentIdDocumentPath: string | null;
  parentIdUploadedAt: string | null;
  linkedLaterToUserId: string | null;
  status?: "active" | "cancelled";
  registrationStatus: RegistrationStatus;
  submittedByMode: "authenticated" | "anonymous";
  assignedRoomId: string | null;
  assignedTempleShiftId: string | null;
  assignedServiceTeamIds: string[];
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string | null;
}

export interface RegistrationAttemptLog {
  id: string;
  stakeId: string;
  eventId: string;
  eventTitle: string;
  registrationId: string | null;
  userId: string | null;
  anonymousUid: string | null;
  submittedByMode: "authenticated" | "anonymous";
  fullName: string;
  email: string;
  phone: string;
  status: RegistrationAttemptStatus;
  lastStep: RegistrationAttemptStep;
  route: string;
  displayMode: "browser" | "standalone" | "unknown";
  online: boolean;
  userAgent: string;
  registrationStatus: RegistrationStatus | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminEventWorkspace {
  event: Event;
  formConfig: EventFormConfig;
  registrations: Registration[];
}

export interface RegistrationLookup {
  userId: string | null;
  anonymousAuthUid?: string | null;
  anonymousUid?: string | null;
}

export interface EventWriteInput {
  title: string;
  description: string;
  year: number;
  audience: EventAudience;
  startDate: string;
  endDate: string;
  location: string;
  program: string;
  publicNotes?: string;
  organizerNotes?: string;
  menuInfo?: string;
  allergiesInfo?: string;
  roomsInfo?: string;
  heroImageUrl: string;
  heroImagePath?: string;
  coverImageUrl?: string;
  coverImagePath?: string;
  status: EventStatus;
  isPublic: boolean;
  isVisible?: boolean;
  registrationOpen: string;
  registrationClose: string;
  registrationOpenAt?: string;
  registrationCloseAt?: string;
  maxParticipants: number | null;
  overnight: boolean;
  templateId?: string | null;
  allowGuestRegistration?: boolean;
  requireLoginForEdit?: boolean;
  questionsEnabled?: boolean;
  requiresParentalConsent?: boolean;
  requiresPhotoRelease?: boolean;
}

export type QuestionStatus = "active" | "hidden";

export interface Question {
  id: string;
  eventId: string;
  stakeId: string;
  registrationId: string;
  authorUserId: string | null;
  authorAnonymousUid: string | null;
  authorName: string | null;
  text: string;
  isAnonymous: boolean;
  status: QuestionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionWriteInput {
  text: string;
  isAnonymous: boolean;
}

export interface RegistrationWriteInput {
  firstName?: string;
  lastName?: string;
  fullName: string;
  email: string;
  phone: string;
  birthDate?: string;
  genderRoleCategory?: GenderRoleCategory | "";
  unitId?: string;
  unitName?: string;
  answers: RegistrationAnswers;
  accessCode?: string | null;
  status?: "active" | "cancelled";
  registrationStatus: RegistrationStatus;
}

export interface Room {
  id: string;
  eventId: string;
  name: string;
  capacity: number;
  notes?: string;
}

export interface TempleShift {
  id: string;
  eventId: string;
  title: string;
  startTime: string;
  endTime: string;
  location: string;
}

export interface ServiceTeam {
  id: string;
  eventId: string;
  name: string;
  description: string;
}

export interface MenuItem {
  id: string;
  eventId: string;
  title: string;
  description: string;
}

export interface Alert {
  id: string;
  type?: "registration_created";
  stakeId?: string;
  eventId?: string;
  registrationId?: string | null;
  eventTitle?: string;
  participantName?: string;
  submittedByMode?: "authenticated" | "anonymous";
  title: string;
  message: string;
  severity: "info" | "warning" | "critical" | "success";
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
  readBy?: string[];
}

export type PushPermissionState =
  | "default"
  | "denied"
  | "granted"
  | "unsupported";

export interface AdminPushSubscription {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    auth: string;
    p256dh: string;
  };
}

export interface AdminPushDevice {
  id: string;
  stakeId: string;
  userId: string;
  userName: string;
  role: "admin" | "super_admin";
  permission: PushPermissionState;
  subscription: AdminPushSubscription | null;
  userAgent: string;
  platform: string;
  isStandalone: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  lastDeliveredAt?: string | null;
  lastError?: string | null;
}

export type SupportEventKind =
  | "registration_submit_started"
  | "registration_submit_succeeded"
  | "registration_submit_failed"
  | "anonymous_recovery_started"
  | "anonymous_recovery_succeeded"
  | "anonymous_recovery_failed";

export type SupportEventSeverity = "info" | "warning" | "error";

export interface SupportEvent {
  id: string;
  stakeId: string;
  eventId: string | null;
  eventTitle: string;
  registrationId: string | null;
  kind: SupportEventKind;
  severity: SupportEventSeverity;
  route: string;
  actorUid: string;
  actorMode: "authenticated" | "anonymous";
  fullName: string;
  email: string;
  phone: string;
  message: string;
  errorCode: string;
  registrationStatus: RegistrationStatus | "";
  isStandalone: boolean;
  isOnline: boolean;
  createdAt: string;
}
