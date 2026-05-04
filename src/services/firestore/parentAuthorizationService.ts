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
  expiresAt?: string | null;
  legalVersions?: ParentAuthorizationLegalVersions;
}

interface ConfirmInput {
  token: string;
  consents: ParentAuthorizationConsents;
  photoConsent: PhotoConsentDecision;
  socialPublicationConsent: PhotoConsentDecision;
  signatureDataUrl?: string | null;
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
};
