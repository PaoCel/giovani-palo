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
  // Con status "invalidated": l'iscrizione è stata annullata (o non c'è più).
  reason?: "registration_cancelled";
  // "self" = link di "Autorizza ora" dall'account genitore (60 minuti).
  createdByMode?: "self" | "system" | null;
  // Chi è entrato è il genitore titolare dell'iscrizione: può firmare da Famiglia.
  canSignInApp?: boolean;
}

interface ConfirmInput {
  token: string;
  consents: ParentAuthorizationConsents;
  photoConsent: PhotoConsentDecision;
  socialPublicationConsent: PhotoConsentDecision;
  signatureDataUrl?: string | null;
  useStoredSignature?: boolean;
}

/** Stato delle scelte che la pagina del link mostra e permette di cambiare. */
export interface ParentConsentContext {
  status: "valid" | "not_signed" | "expired" | "not_found" | "mismatch";
  activityTitle?: string;
  activityStartDate?: string;
  activityEndDate?: string;
  participantName?: string;
  photoConsent?: PhotoConsentDecision;
  socialPublicationConsent?: PhotoConsentDecision;
  consentUpdatedAt?: string | null;
}

/** Con `token` (link della mail) oppure con gli id dell'iscrizione (genitore con account). */
export type UpdateConsentInput = (
  | { token: string }
  | { stakeId: string; activityId: string; registrationId: string }
) & {
  photoConsent: "accepted" | "refused";
  socialPublicationConsent: "accepted" | "refused";
  /**
   * `consentUpdatedAt` che la pagina ha visto (null se la firma non lo aveva):
   * se nel frattempo le scelte sono cambiate altrove la callable risponde
   * `consent_stale` e la pagina deve ricaricare.
   */
  expectedUpdatedAt?: string | null;
};

export interface UpdateConsentResult {
  ok: true;
  changed: boolean;
  photoConsent: PhotoConsentDecision;
  socialPublicationConsent: PhotoConsentDecision;
  receiptSent: boolean;
}

export interface ConsentCompletionCandidate {
  activityId: string;
  activityTitle: string;
  activityStartDate: string;
  registrationId: string;
  participantName: string;
  parentName: string;
  parentEmail: string;
  missing: Array<"photo" | "social">;
  alreadyRequestedAt: string | null;
}

export type ConsentCompletionResult =
  | {
      ok: true;
      dryRun: true;
      total: number;
      /** Impronta dell'elenco: da rimandare come `expectedDigest` per inviare. */
      digest: string;
      skippedAlreadyRequested: number;
      skippedNoEmail: number;
      candidates: ConsentCompletionCandidate[];
      preview: { subject: string; paragraphs: string[] } | null;
    }
  | {
      ok: true;
      dryRun: false;
      total: number;
      sent: number;
      simulated: number;
      errors: Array<{ registrationId: string; activityId: string; message: string }>;
    };

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

const getConsentContextCallable = httpsCallable<{ token: string }, ParentConsentContext>(
  functions,
  "parentConsentGetContext",
);

const updateConsentCallable = httpsCallable<UpdateConsentInput, UpdateConsentResult>(
  functions,
  "parentConsentUpdate",
);

const requestConsentCompletionCallable = httpsCallable<
  {
    stakeId: string;
    activityId?: string;
    dryRun?: boolean;
    expectedCount?: number;
    expectedDigest?: string;
    resend?: boolean;
  },
  ConsentCompletionResult
>(functions, "parentConsentRequestCompletion");

const resendCallable = httpsCallable<
  ResendInput,
  { ok: boolean; sent: boolean; tokenId: string | null }
>(functions, "parentAuthorizationResend");

// Firma dall'app: il genitore autenticato ottiene un token a vita breve per la
// stessa pagina di firma del magic-link, senza passare dalla mail.
const issueOwnTokenCallable = httpsCallable<
  { stakeId: string; activityId: string; registrationId: string },
  { ok: true; token: string; expiresAt: string }
>(functions, "parentAuthorizationIssueOwnToken");

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
  async issueOwnToken(input: {
    stakeId: string;
    activityId: string;
    registrationId: string;
  }): Promise<{ token: string; expiresAt: string }> {
    const result = await issueOwnTokenCallable(input);
    return { token: result.data.token, expiresAt: result.data.expiresAt };
  },

  async getContext(token: string): Promise<ParentAuthorizationContext> {
    const result = await getContextCallable({ token });
    return result.data;
  },

  async confirm(input: ConfirmInput): Promise<void> {
    await confirmCallable(input);
  },

  async getConsentContext(token: string): Promise<ParentConsentContext> {
    const result = await getConsentContextCallable({ token });
    return result.data;
  },

  async updateConsent(input: UpdateConsentInput): Promise<UpdateConsentResult> {
    const result = await updateConsentCallable(input);
    return result.data;
  },

  /** Simulazione di default; si invia solo con `dryRun: false`, `expectedCount` e `expectedDigest` della simulazione. */
  async requestConsentCompletion(input: {
    stakeId: string;
    activityId?: string;
    dryRun?: boolean;
    expectedCount?: number;
    expectedDigest?: string;
    resend?: boolean;
  }): Promise<ConsentCompletionResult> {
    const result = await requestConsentCompletionCallable(input);
    return result.data;
  },

  async reject(input: RejectInput): Promise<void> {
    await rejectCallable(input);
  },

  async resend(input: ResendInput) {
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
