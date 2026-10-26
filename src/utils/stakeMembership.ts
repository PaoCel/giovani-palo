// Appartenenza al palo, parte pura del client (docs/APPARTENENZA_AL_PALO.md,
// «Client della fase 3»): chi è membro, quale banner, cosa mostra la coda.
// "Membro" viene da `stakes/{s}/members/{uid}`, mai da `users.stakeId`.
//
// Questo file lo carica anche Node (tests/): niente alias "@/".

import { PALO } from "../copy/palo.ts";
import { fillCopy } from "../copy/parole.ts";
import { getCallableErrorReason } from "./callableError.ts";
import { getAdminActionError } from "./adminErrors.ts";

export type MemberStatus = "pending" | "active" | "declined" | "withdrawn" | "removed" | "blocked";

const MEMBER_STATUSES: readonly MemberStatus[] = ["pending", "active", "declined", "withdrawn", "removed", "blocked"];

export interface StakeMemberPrevious {
  action: string;
  by: string;
  status: MemberStatus | null;
  /** Unità dichiarata prima dell'azione ("" se non c'era). */
  claimedUnitId: string;
}

export interface StakeMember {
  uid: string;
  stakeId: string;
  status: MemberStatus;
  staffRole: "admin" | "unit_leader" | null;
  claimedUnitId: string;
  claimedUnitName: string;
  displayName: string;
  birthYear: number | null;
  registrationHints: { activityId: string; title: string }[];
  reviewNeeded: boolean;
  requestedAtMs: number | null;
  decidedAtMs: number | null;
  decidedBy: string;
  declineCount: number;
  version: number;
  sourceKinds: string[];
  previous: StakeMemberPrevious | null;
}

// Stessi tetti del server (functions/lib/stakeMembership.js).
export const DECLINE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_DECLINES = 3;
// Scheda "Rifiutate" e "da confermare da tempo".
export const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function millis(value: unknown): number | null {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** Stato di prima (`members/{uid}/staff/previous`, o il campo vecchio). */
export function mapStakePrevious(value: unknown): StakeMemberPrevious | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  return {
    action: text(raw.action),
    by: text(raw.by),
    status: MEMBER_STATUSES.includes(raw.status as MemberStatus) ? (raw.status as MemberStatus) : null,
    claimedUnitId: text(raw.claimedUnitId),
  };
}

export function mapStakeMember(stakeId: string, uid: string, data: Record<string, unknown>): StakeMember | null {
  const status = data.status as MemberStatus;
  if (!MEMBER_STATUSES.includes(status)) return null;
  const staffRole = data.staffRole === "admin" || data.staffRole === "unit_leader" ? data.staffRole : null;
  const hints = Array.isArray(data.registrationHints) ? data.registrationHints : [];
  const sources = Array.isArray(data.sources) ? data.sources : [];
  return {
    uid,
    stakeId,
    status,
    staffRole,
    claimedUnitId: text(data.claimedUnitId),
    claimedUnitName: text(data.claimedUnitName),
    displayName: text(data.displayName),
    birthYear: typeof data.birthYear === "number" ? data.birthYear : null,
    registrationHints: hints
      .filter((hint): hint is { activityId: string; title: string } =>
        Boolean(hint) && typeof (hint as { title?: unknown }).title === "string",
      )
      .map((hint) => ({ activityId: text(hint.activityId), title: text(hint.title) })),
    reviewNeeded: data.reviewNeeded === true,
    requestedAtMs: millis(data.requestedAt),
    decidedAtMs: millis(data.decidedAt),
    decidedBy: text(data.decidedBy),
    declineCount: typeof data.declineCount === "number" ? data.declineCount : 0,
    version: typeof data.version === "number" ? data.version : 0,
    sourceKinds: sources
      .map((source) => (source && typeof source === "object" ? text((source as { kind?: unknown }).kind) : ""))
      .filter(Boolean),
    // Dal 2026-10-22 il server lo tiene in `staff/previous` (solo staff): qui
    // resta null, salvo documenti scritti prima. La pagina Persone lo legge a parte.
    previous: mapStakePrevious(data.previous),
  };
}

// ---------------------------------------------------------------------------
// Chi è membro
// ---------------------------------------------------------------------------

/** Stato del proprio documento members: `loading` finché non arriva. */
export type OwnMembership =
  | { loading: true; member: null }
  | { loading: false; member: StakeMember | null };

/**
 * - `guest`: senza account personale (visitatore, ospite anonimo);
 * - `member`: membro attivo, o staff del palo (stesso ramo delle rules);
 * - `waiting`: in coda, o senza documento (richiesta in arrivo);
 * - `out`: rifiutato, uscito, rimosso, bloccato;
 * - `loading`: il documento non è ancora arrivato (né contenuto né lucchetto).
 */
export type MemberAccess = "loading" | "guest" | "member" | "waiting" | "out";

export interface MemberAccessInput {
  signedIn: boolean;
  anonymous: boolean;
  role: string;
  profileStakeId: string;
  stakeId: string;
  membership: OwnMembership;
}

export function isStakeStaffRole(role: string, profileStakeId: string, stakeId: string) {
  if (role === "super_admin") return true;
  return (role === "admin" || role === "unit_leader") && Boolean(stakeId) && profileStakeId === stakeId;
}

export function memberAccessOf(input: MemberAccessInput): MemberAccess {
  if (!input.signedIn || input.anonymous || !input.stakeId) return "guest";
  if (isStakeStaffRole(input.role, input.profileStakeId, input.stakeId)) return "member";
  if (input.membership.loading) return "loading";
  const status = input.membership.member?.status;
  if (status === "active") return "member";
  if (!status || status === "pending") return "waiting";
  return "out";
}

/** Testo al posto di una superficie dei membri chiusa (null: nessun testo). */
export function lockedMessageOf(access: MemberAccess, kind: "foto" | "record" | "sondaggi"): string | null {
  if (access === "waiting") return PALO.siSbloccano;
  if (access !== "out") return null;
  if (kind === "record") return PALO.soloMembriRecord;
  if (kind === "sondaggi") return PALO.soloMembriSondaggi;
  return PALO.soloMembriFoto;
}

// ---------------------------------------------------------------------------
// Banner dell'utente
// ---------------------------------------------------------------------------

export type MembershipBanner =
  /**
   * `unitName`: unità che la verifica (vuota se non c'è); `toAdmins`: la
   * richiesta non ha un'unità (passata agli admin o profilo senza unità), quindi
   * la conferma un admin.
   */
  | { kind: "pending"; unitName: string; toAdmins: boolean }
  | { kind: "declined"; retryAtMs: number | null; canRetry: boolean; tooMany: boolean }
  | { kind: "withdrawn" }
  | { kind: "removed" };

export interface MembershipBannerInput {
  access: MemberAccess;
  profileComplete: boolean;
  member: StakeMember | null;
  nowMs: number;
}

export function membershipBannerOf(input: MembershipBannerInput): MembershipBanner | null {
  const { access, member } = input;
  if (!input.profileComplete || access === "guest" || access === "loading" || access === "member") return null;
  if (access === "waiting") {
    const toAdmins = Boolean(member && member.status === "pending" && !member.claimedUnitId);
    return { kind: "pending", unitName: member?.claimedUnitId ? member.claimedUnitName : "", toAdmins };
  }
  if (!member) return null;
  if (member.status === "declined") {
    const tooMany = member.declineCount >= MAX_DECLINES;
    const retryAtMs = member.decidedAtMs === null ? null : member.decidedAtMs + DECLINE_COOLDOWN_MS;
    return { kind: "declined", retryAtMs: tooMany ? null : retryAtMs, canRetry: !tooMany && (retryAtMs === null || input.nowMs >= retryAtMs), tooMany };
  }
  if (member.status === "withdrawn") return { kind: "withdrawn" };
  return { kind: "removed" };
}

// ---------------------------------------------------------------------------
// Date in italiano: "dal 28 ottobre", "dall'8 ottobre", "il 1° ottobre"
// ---------------------------------------------------------------------------

const MONTHS = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
];

function dayAndMonth(ms: number) {
  const date = new Date(ms);
  const day = date.getDate();
  return { day, label: `${day === 1 ? "1°" : day} ${MONTHS[date.getMonth()]}` };
}

// 8 e 11 iniziano con una vocale: "l'8", "dall'11".
function startsWithVowelSound(day: number) {
  return day === 8 || day === 11;
}

export function fromDateLabel(ms: number) {
  const { day, label } = dayAndMonth(ms);
  return startsWithVowelSound(day) ? `dall'${label}` : `dal ${label}`;
}

export function onDateLabel(ms: number) {
  const { day, label } = dayAndMonth(ms);
  return startsWithVowelSound(day) ? `l'${label}` : `il ${label}`;
}

// ---------------------------------------------------------------------------
// Coda dello staff
// ---------------------------------------------------------------------------

/** "da oggi", "da ieri", "da 3 giorni" (giorni di calendario). */
export function waitingLabel(requestedAtMs: number | null, nowMs: number) {
  if (requestedAtMs === null) return "";
  const start = new Date(requestedAtMs);
  const now = new Date(nowMs);
  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()) /
      DAY_MS,
  );
  if (days <= 0) return PALO.inAttesaOggi;
  if (days === 1) return PALO.inAttesaIeri;
  return fillCopy(PALO.inAttesaGiorni, { n: String(days) });
}

function byRequestedAt(left: StakeMember, right: StakeMember) {
  return (left.requestedAtMs ?? 0) - (right.requestedAtMs ?? 0) || left.displayName.localeCompare(right.displayName, "it");
}

/** Richieste in attesa, dalla più vecchia. */
export function pendingQueue(members: StakeMember[]) {
  return members.filter((member) => member.status === "pending").sort(byRequestedAt);
}

/** Rifiutate negli ultimi 30 giorni, dalla più recente. */
export function recentDeclined(members: StakeMember[], nowMs: number) {
  return members
    .filter((member) => member.status === "declined" && member.decidedAtMs !== null && nowMs - member.decidedAtMs <= RECENT_WINDOW_MS)
    .sort((left, right) => (right.decidedAtMs ?? 0) - (left.decidedAtMs ?? 0));
}

export interface ReviewItem {
  member: StakeMember;
  /** Da confermare da più di 30 giorni: in cima per l'admin. */
  overdue: boolean;
}

/** Membri attivi da confermare; per l'admin prima chi aspetta da più di 30 giorni. */
export function reviewQueue(members: StakeMember[], nowMs: number, isAdmin: boolean): ReviewItem[] {
  const items = members
    .filter((member) => member.status === "active" && member.reviewNeeded)
    .map((member) => ({
      member,
      overdue: isAdmin && member.decidedAtMs !== null && nowMs - member.decidedAtMs > RECENT_WINDOW_MS,
    }));
  return items.sort(
    (left, right) =>
      Number(right.overdue) - Number(left.overdue) || left.member.displayName.localeCompare(right.member.displayName, "it"),
  );
}

/** "Annulla rifiuto": l'admin sempre, il dirigente solo sui propri rifiuti. */
export function canUndoDecline(member: StakeMember, viewer: { isAdmin: boolean; uid: string }) {
  if (member.status !== "declined" || !member.previous || member.previous.action !== "decline") return false;
  return viewer.isAdmin || member.previous.by === viewer.uid;
}

export function wasPassedByUnitLeader(member: StakeMember) {
  return member.status === "pending" && member.previous?.action === "notMyUnit";
}

/**
 * Membro migrato che il dirigente ha segnato "Non lo conosco": accesso sospeso
 * e richiesta passata agli admin (scelta S2-3), con l'unità svuotata.
 */
export function wasUnknownToUnitLeader(member: StakeMember) {
  // L'unità c'era ed è sparita con l'azione: l'admin non la svuota mai, quindi
  // è stato il dirigente (un migrato già senza unità non prende l'etichetta).
  return (
    member.status === "pending" &&
    member.previous?.action === "markUnknown" &&
    Boolean(member.previous.claimedUnitId) &&
    !member.claimedUnitId
  );
}

export function isMigratedAccount(member: StakeMember) {
  return member.sourceKinds.includes("migration");
}

export function initialsOf(name: string) {
  const parts = name.split(/\s+/u).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return `${first}${last}`.toUpperCase() || "?";
}

// ---------------------------------------------------------------------------
// Errori della callable `stakeMembership`
// ---------------------------------------------------------------------------

export function membershipErrorMessage(error: unknown, options: { self?: boolean; nowMs?: number } = {}) {
  const reason = getCallableErrorReason(error);
  if (reason === "version_conflict") return PALO.erroreVersione;
  if (reason === "nothing_to_undo") return PALO.erroreNienteDaAnnullare;
  if (reason === "invalid_state") return PALO.erroreStato;
  if (reason === "too_many_declines") return PALO.erroreTroppiRifiuti;
  if (reason === "profile_incomplete" || reason === "stake_not_chosen") return PALO.erroreProfilo;
  if (reason === "last_admin" && options.self) return PALO.erroreUltimoAdminTuo;
  if (reason === "cooldown") {
    const retryAt = (error as { details?: { retryAt?: unknown } } | null)?.details?.retryAt;
    const ms = typeof retryAt === "string" ? Date.parse(retryAt) : NaN;
    if (Number.isFinite(ms)) return fillCopy(PALO.potraiChiedereDiNuovo, { dal: fromDateLabel(ms) });
  }
  return getAdminActionError(error, PALO.erroreGenerico);
}
