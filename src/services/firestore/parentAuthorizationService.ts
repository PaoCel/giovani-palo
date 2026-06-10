import { httpsCallable } from "firebase/functions";

import { functions } from "@/services/firebase/app";
import type {
  ParentAuthorizationConsents,
  ParentAuthorizationLegalVersions,
  PhotoConsentDecision,
} from "@/types";

export type ParentTokenStatus =
  | "valid"
  | "used"
  | "invalidated"
  | "expired"
  | "not_found";

export interface ParentAuthorizationContext {
  status: ParentTokenStatus;
  activityTitle?: string;
  activityStartDate?: string;
  activityEndDate?: string;
  participantName?: string;
  parentEmail?: string;
  hasReusableSignature?: boolean;
  expiresAt?: string | null;
  legalVersions?: ParentAuthorizationLegalVersions;
}

interface ConfirmInput {
  token: string;
  consents: ParentAuthorizationConsents;
  photoConsent: PhotoConsentDecision;
  socialPublicationConsent: PhotoConsentDecision;
  signatureDataUrl?: string | null;
  useStoredSignature?: boolean;
}

interface RejectInput {
  token: string;
  reason?: string;
}

interface ResendInput {
  stakeId: string;
  activityId: string;
  registrationId: string;
}

interface SignedConsentUrlInput {
  stakeId: string;
  activityId: string;
  registrationId: string;
  documentKind?: "official" | "conduct" | "audit";
}

interface SignedConsentDownloadResult {
  ok: boolean;
  url: string;
  filename: string;
  expiresAt: string;
}

interface SignedConsentsZipInput {
  stakeId: string;
  activityId: string;
}

interface SignedConsentsZipResult extends SignedConsentDownloadResult {
  count: number;
}

interface BackfillLegacyApprovalsInput {
  stakeId: string;
  activityId: string;
  dryRun?: boolean;
}

interface BackfillLegacyApprovalsResult {
  ok: boolean;
  dryRun: boolean;
  candidates: number;
  processed: number;
  emailed: number;
  skipped: number;
  errors: Array<{
    registrationId: string;
    reason: string;
    message?: string;
  }>;
}

const getContextCallable = httpsCallable<{ token: string }, ParentAuthorizationContext>(
  functions,
  "parentAuthorizationGetContext",
);

const confirmCallable = httpsCallable<ConfirmInput, { ok: true }>(
  functions,
  "parentAuthorizationConfirm",
);

const rejectCallable = httpsCallable<RejectInput, { ok: true }>(
  functions,
  "parentAuthorizationReject",
);

const resendCallable = httpsCallable<
  ResendInput,
  { ok: boolean; sent: boolean; tokenId: string | null }
>(functions, "parentAuthorizationResend");

const getSignedConsentUrlCallable = httpsCallable<
  SignedConsentUrlInput,
  SignedConsentDownloadResult
>(functions, "parentAuthorizationGetSignedConsentUrl");

const downloadSignedConsentsZipCallable = httpsCallable<
  SignedConsentsZipInput,
  SignedConsentsZipResult
>(functions, "parentAuthorizationDownloadSignedConsentsZip");

const backfillLegacyApprovalsCallable = httpsCallable<
  BackfillLegacyApprovalsInput,
  BackfillLegacyApprovalsResult
>(functions, "parentAuthorizationBackfillLegacyApprovals");

export const parentAuthorizationService = {
  async getContext(token: string): Promise<ParentAuthorizationContext> {
    const result = await getContextCallable({ token });
    return result.data;
  },

  async confirm(input: ConfirmInput): Promise<void> {
    await confirmCallable(input);
  },

  async reject(input: RejectInput): Promise<void> {
    await rejectCallable(input);
  },

  async resendByAdmin(input: ResendInput) {
    const result = await resendCallable(input);
    return result.data;
  },

  async getSignedConsentDownloadUrl(input: SignedConsentUrlInput) {
    const result = await getSignedConsentUrlCallable(input);
    return result.data;
  },

  async downloadSignedConsentsZip(input: SignedConsentsZipInput) {
    const result = await downloadSignedConsentsZipCallable(input);
    return result.data;
  },

  async backfillLegacyApprovals(input: BackfillLegacyApprovalsInput) {
    const result = await backfillLegacyApprovalsCallable(input);
    return result.data;
  },
};
