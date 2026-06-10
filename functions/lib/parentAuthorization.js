/**
 * Logica autorizzazione genitoriale via magic-link Brevo.
 *
 * Flusso:
 * 1. onRegistrationPendingParentAuth (Firestore trigger) - quando una registration
 *    viene creata/aggiornata con status `pending_parent_authorization` e nessun
 *    token attivo, genera un token, salva l'hash in `parentAuthorizationTokens`,
 *    invia email Brevo, scrive audit log.
 * 2. parentAuthorizationGetContext (callable pubblica) - la pagina genitore
 *    legge i dati pubblici da mostrare (titolo attivita', date, nome partecipante)
 *    passando il token in chiaro. Verifica scadenza/uso/invalidazione.
 * 3. parentAuthorizationConfirm (callable pubblica) - il genitore conferma:
 *    salva consensi nel sub-object della registration, marca token come usato,
 *    genera PDF audit e lo carica su Storage, scrive audit log, cambia status
 *    registration a "confirmed".
 * 4. parentAuthorizationReject (callable pubblica) - il genitore rifiuta:
 *    aggiorna stato a `rejected_by_parent`, invalida token, audit log.
 * 5. parentAuthorizationResend (callable admin) - reinvio: invalida vecchio token,
 *    crea nuovo, invia di nuovo email Brevo.
 */

const crypto = require("crypto");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const JSZip = require("jszip");

const {
  REGION,
  APP_PUBLIC_URL,
  PARENT_AUTHORIZATION_TOKEN_TTL_DAYS,
  STORAGE_PATH_PARENT_AUTH_PDF,
  STORAGE_PATH_PARENT_AUTH_SIGNATURE,
  STORAGE_PATH_PARENT_AUTH_SIGNATURE_CACHE,
} = require("./config");
const {
  LEGAL_DOC_VERSIONS,
  PARENT_CONSENT_CHECKBOXES,
} = require("./legalDocs");
const {
  sendParentAuthorizationEmail,
  sendSignedAuthorizationCopyEmail,
  BrevoError,
} = require("./brevo");
const { sanitizeSignaturePng } = require("./signatureImage");
// NB: pdfGenerator caricato lazy dentro parentAuthorizationConfirm. pdfkit
// inizializza font al require, supera il timeout di analisi statica del
// deploy delle Cloud Functions (10s). Lazy-load -> il bootstrap resta veloce.

const BREVO_API_KEY = defineSecret("BREVO_API_KEY");

// =============================================================================
// Helpers
// =============================================================================

function nowIso() {
  return new Date().toISOString();
}

function generateRawToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function buildAuthorizationUrl(rawToken) {
  return `${APP_PUBLIC_URL.replace(/\/$/, "")}/parent-confirm/${rawToken}`;
}

function computeExpiry() {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + PARENT_AUTHORIZATION_TOKEN_TTL_DAYS);
  return expiry.toISOString();
}

function asString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function sanitizeFilenamePart(value, fallback = "senza-nome") {
  const cleaned = asString(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._ -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || fallback).slice(0, 90);
}

function getRegistrationFileBaseName(registration) {
  const fullName =
    asString(registration.fullName).trim() ||
    `${asString(registration.firstName).trim()} ${asString(registration.lastName).trim()}`.trim();
  return sanitizeFilenamePart(fullName, registration.id || "iscritto");
}

function buildUniqueFilename(baseName, usedNames, extension = ".pdf") {
  const safeBase = sanitizeFilenamePart(baseName, "iscritto");
  let candidate = `${safeBase}${extension}`;
  let counter = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${safeBase} ${counter}${extension}`;
    counter += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function escapeDispositionFilename(filename) {
  return sanitizeFilenamePart(filename, "download").replace(/["\\]/g, "");
}

async function assertAdminForStake(db, request, stakeId) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Login richiesto.");
  }

  const userDoc = await db.doc(`users/${request.auth.uid}`).get();
  if (!userDoc.exists) {
    throw new HttpsError("permission-denied", "Profilo utente non trovato.");
  }

  const user = userDoc.data() || {};
  const isAdmin = user.role === "admin" || user.role === "super_admin";
  const isStakeMatch = user.role === "super_admin" || user.stakeId === stakeId;
  if (!isAdmin || !isStakeMatch) {
    throw new HttpsError("permission-denied", "Servono privilegi admin.");
  }

  return user;
}

async function getTemporaryDownloadUrl(file, filename, expiresInMinutes = 15) {
  const expiresAtMs = Date.now() + expiresInMinutes * 60 * 1000;
  const [exists] = await file.exists();
  if (!exists) {
    throw new HttpsError("not-found", "File non trovato in Storage.");
  }

  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: expiresAtMs,
    responseDisposition: `attachment; filename="${escapeDispositionFilename(filename)}"`,
  });

  return {
    url,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

function normalizeEmail(value) {
  return asString(value).trim().toLowerCase();
}

function hashEmail(value) {
  const normalized = normalizeEmail(value);
  return normalized
    ? crypto.createHash("sha256").update(normalized, "utf8").digest("hex")
    : "";
}

function readParentAuthorizationRequest(registrationData) {
  const answers =
    registrationData && typeof registrationData.answers === "object"
      ? registrationData.answers
      : {};
  const request = answers.parentAuthorizationRequest;
  if (!request || typeof request !== "object") return null;
  return request;
}

function emptyParentAuthorizationState({ parentEmail, parentName, parentPhone, expiresAt }) {
  return {
    status: "pending_parent_authorization",
    tokenId: null,
    parentFirstName: "",
    parentLastName: "",
    parentEmail: parentEmail || "",
    parentPhone: parentPhone || "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelation: "",
    allergies: "",
    medications: "",
    medicalNotes: "",
    dietaryNotes: "",
    emailSentAt: null,
    emailLastError: null,
    emailRetryCount: 0,
    emailProvider: "brevo",
    brevoMessageId: null,
    authorizedAt: null,
    rejectedAt: null,
    expiresAt: expiresAt || null,
    legalVersions: null,
    consents: null,
    photoConsent: "not_answered",
    socialPublicationConsent: "not_answered",
    signatureUrl: null,
    signaturePath: null,
    pdfUrl: null,
    pdfPath: null,
    ipAddress: null,
    userAgent: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    parentName, // nome cognome concatenato come fallback
  };
}

async function writeAuditLog(db, stakeId, activityId, registrationId, payload) {
  const ref = db
    .collection(`stakes/${stakeId}/activities/${activityId}/consentAuditLogs`)
    .doc();

  const document = {
    id: ref.id,
    stakeId,
    activityId,
    registrationId,
    tokenId: payload.tokenId ?? null,
    event: payload.event,
    parentEmail: payload.parentEmail ?? null,
    parentName: payload.parentName ?? null,
    parentPhone: payload.parentPhone ?? null,
    legalVersions: payload.legalVersions ?? null,
    consents: payload.consents ?? null,
    photoConsent: payload.photoConsent ?? null,
    socialPublicationConsent: payload.socialPublicationConsent ?? null,
    signaturePath: payload.signaturePath ?? null,
    pdfPath: payload.pdfPath ?? null,
    auditPdfPath: payload.auditPdfPath ?? null,
    emailProvider: payload.emailProvider ?? null,
    brevoMessageId: payload.brevoMessageId ?? null,
    emailErrorCode: payload.emailErrorCode ?? null,
    emailErrorMessage: payload.emailErrorMessage ?? null,
    ipAddress: payload.ipAddress ?? null,
    userAgent: payload.userAgent ?? null,
    actorUserId: payload.actorUserId ?? null,
    createdAt: nowIso(),
  };

  await ref.set(document);
  return ref.id;
}

async function loadActivity(db, stakeId, activityId) {
  const snapshot = await db.doc(`stakes/${stakeId}/activities/${activityId}`).get();
  if (!snapshot.exists) return null;
  return { id: snapshot.id, ...snapshot.data() };
}

async function loadStake(db, stakeId) {
  const snapshot = await db.doc(`stakes/${stakeId}`).get();
  if (!snapshot.exists) return null;
  return { id: snapshot.id, ...snapshot.data() };
}

async function loadRegistration(db, stakeId, activityId, registrationId) {
  const snapshot = await db
    .doc(
      `stakes/${stakeId}/activities/${activityId}/registrations/${registrationId}`,
    )
    .get();
  if (!snapshot.exists) return null;
  return { id: snapshot.id, ...snapshot.data() };
}

function getSignatureCacheRef(db, parentEmail) {
  const emailHash = hashEmail(parentEmail);
  if (!emailHash) return null;
  return db.doc(`parentAuthorizationSignatureCache/${emailHash}`);
}

async function loadSignatureCache(db, parentEmail) {
  const ref = getSignatureCacheRef(db, parentEmail);
  if (!ref) return null;
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() || {};
  if (data.status === "revoked" || !data.signaturePath) return null;
  return { id: snapshot.id, ...data };
}

async function loadSignatureBufferFromCache({ db, storage, parentEmail }) {
  const cache = await loadSignatureCache(db, parentEmail);
  if (!cache || typeof cache.signaturePath !== "string") {
    return null;
  }

  const [buffer] = await storage.bucket().file(cache.signaturePath).download();
  return { buffer, cache };
}

async function saveReusableSignature({
  db,
  storage,
  parentEmail,
  parentName,
  signatureBuffer,
  source,
}) {
  const normalizedEmail = normalizeEmail(parentEmail);
  const emailHash = hashEmail(normalizedEmail);
  if (!emailHash || !signatureBuffer || !Buffer.isBuffer(signatureBuffer)) {
    return null;
  }

  const signaturePath = `${STORAGE_PATH_PARENT_AUTH_SIGNATURE_CACHE(emailHash)}/signature.png`;
  const savedAt = nowIso();
  await storage.bucket().file(signaturePath).save(signatureBuffer, {
    contentType: "image/png",
    resumable: false,
    metadata: {
      metadata: {
        emailHash,
        savedAt,
        sourceRegistrationId: source.registrationId || "",
        sourceActivityId: source.activityId || "",
      },
    },
  });

  await db.doc(`parentAuthorizationSignatureCache/${emailHash}`).set(
    {
      id: emailHash,
      emailHash,
      parentEmail: normalizedEmail,
      parentName: parentName || null,
      signaturePath,
      status: "active",
      createdAt: savedAt,
      updatedAt: savedAt,
      lastUsedAt: savedAt,
      sourceStakeId: source.stakeId || null,
      sourceActivityId: source.activityId || null,
      sourceRegistrationId: source.registrationId || null,
    },
    { merge: true },
  );

  return { emailHash, signaturePath };
}

// Validazione dei consensi obbligatori inviati dal genitore.
function validateRequiredConsents(consents) {
  if (!consents || typeof consents !== "object") return false;
  return PARENT_CONSENT_CHECKBOXES.every((item) => consents[item.key] === true);
}

function sanitizePhotoConsent(value) {
  if (value === "accepted" || value === "refused" || value === "revoked") {
    return value;
  }
  return "not_answered";
}

function getAnswers(registration) {
  return registration && registration.answers && typeof registration.answers === "object"
    ? registration.answers
    : {};
}

function getLegacyApprovalDate(registration, request, existingState) {
  const answers = getAnswers(registration);
  const candidates = [
    existingState?.authorizedAt,
    answers.parentAuthorizationAcceptedAt,
    answers.parentConfirmedAt,
    answers.parentalConsentAcceptedAt,
    request?.approvedAt,
    request?.acceptedAt,
    request?.submittedAt,
    registration.updatedAt,
    registration.createdAt,
  ];

  for (const candidate of candidates) {
    const value = asString(candidate).trim();
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return nowIso();
}

function splitName(fullName) {
  const parts = asString(fullName).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

function getLegacyParentDetails(registration) {
  const answers = getAnswers(registration);
  const request = readParentAuthorizationRequest(registration) || {};
  const existingState =
    registration.parentAuthorization && typeof registration.parentAuthorization === "object"
      ? registration.parentAuthorization
      : {};

  const signerName =
    asString(answers.parentalConsentSignerName).trim() ||
    asString(answers.photoReleaseSignerName).trim() ||
    asString(existingState.parentName).trim();
  const splitSigner = splitName(signerName);

  const firstName =
    asString(existingState.parentFirstName).trim() ||
    asString(request.parentFirstName).trim() ||
    splitSigner.firstName;
  const lastName =
    asString(existingState.parentLastName).trim() ||
    asString(request.parentLastName).trim() ||
    splitSigner.lastName;
  const parentName = `${firstName} ${lastName}`.trim() || signerName;

  return {
    existingState,
    request,
    parentFirstName: firstName,
    parentLastName: lastName,
    parentName,
    parentEmail: normalizeEmail(
      existingState.parentEmail ||
        request.parentEmail ||
        answers.parentEmail ||
        answers.parentGuardianEmail,
    ),
    parentPhone: asString(existingState.parentPhone).trim() || asString(request.parentPhone).trim(),
    emergencyContactName:
      asString(existingState.emergencyContactName).trim() ||
      asString(request.emergencyContactName).trim(),
    emergencyContactPhone:
      asString(existingState.emergencyContactPhone).trim() ||
      asString(request.emergencyContactPhone).trim(),
    emergencyContactRelation:
      asString(existingState.emergencyContactRelation).trim() ||
      asString(request.emergencyContactRelation).trim(),
    allergies: asString(existingState.allergies).trim() || asString(request.allergies).trim(),
    medications:
      asString(existingState.medications).trim() || asString(request.medications).trim(),
    medicalNotes:
      asString(existingState.medicalNotes).trim() || asString(request.medicalNotes).trim(),
    dietaryNotes:
      asString(existingState.dietaryNotes).trim() || asString(request.dietaryNotes).trim(),
  };
}

function getLegacyPhotoDecision(registration, existingValue, answerKeys) {
  const normalized = sanitizePhotoConsent(existingValue);
  if (normalized !== "not_answered") return normalized;

  const answers = getAnswers(registration);
  for (const key of answerKeys) {
    if (answers[key] === true) return "accepted";
    if (answers[key] === false) return "refused";
  }
  return "not_answered";
}

function isLegacyApprovalCandidate(registration) {
  if (!registration || registration.status === "cancelled" || registration.registrationStatus === "cancelled") {
    return false;
  }

  const existingState =
    registration.parentAuthorization && typeof registration.parentAuthorization === "object"
      ? registration.parentAuthorization
      : {};
  if (existingState.pdfPath) return false;
  if (existingState.status === "rejected_by_parent") return false;

  const answers = getAnswers(registration);
  return (
    existingState.status === "authorized" ||
    answers.parentConfirmed === true ||
    answers.parentalConsentAccepted === true
  );
}

function decodeBase64Image(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    return null;
  }
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) return null;
  const base64 = dataUrl.slice(commaIndex + 1);
  try {
    return Buffer.from(base64, "base64");
  } catch (error) {
    return null;
  }
}

// =============================================================================
// Step 1: invio iniziale autorizzazione
// =============================================================================

async function sendInitialAuthorizationEmail({
  db,
  storage,
  stakeId,
  activityId,
  registrationId,
  registration,
  activity,
}) {
  const request = readParentAuthorizationRequest(registration);
  if (!request) {
    logger.warn("Registration in pending_parent_authorization senza payload request.", {
      stakeId,
      activityId,
      registrationId,
    });
    return { skipped: true, reason: "missing_request_payload" };
  }

  const parentEmail = normalizeEmail(request.parentEmail);
  if (!parentEmail) {
    logger.warn("Parent email vuota, salto invio.", {
      stakeId,
      activityId,
      registrationId,
    });
    return { skipped: true, reason: "missing_parent_email" };
  }

  const parentFirstName = asString(request.parentFirstName).trim();
  const parentLastName = asString(request.parentLastName).trim();
  const parentName = `${parentFirstName} ${parentLastName}`.trim();
  const parentPhone = asString(request.parentPhone).trim();
  const participantName = asString(registration.fullName).trim() || "il minore";
  const activityTitle = asString(activity.title).trim() || "Attivita'";
  const activityStartDate = asString(activity.startDate);
  const activityEndDate = asString(activity.endDate) || activityStartDate;
  const activityLocation = asString(activity.location).trim();

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = computeExpiry();
  const authorizationUrl = buildAuthorizationUrl(rawToken);

  // Crea documento token (id = hash, non token in chiaro)
  const tokenRef = db.doc(`parentAuthorizationTokens/${tokenHash}`);
  await tokenRef.set({
    id: tokenHash,
    tokenHash,
    stakeId,
    activityId,
    registrationId,
    parentEmail,
    participantName,
    activityTitle,
    activityStartDate,
    activityEndDate,
    status: "pending",
    createdAt: nowIso(),
    expiresAt,
    usedAt: null,
    invalidatedAt: null,
    createdByUserId: null,
    createdByMode: "system",
  });

  // Inizializza/aggiorna sub-object parentAuthorization sulla registration.
  const registrationRef = db.doc(
    `stakes/${stakeId}/activities/${activityId}/registrations/${registrationId}`,
  );

  const stateBase = {
    status: "email_sent",
    tokenId: tokenHash,
    parentFirstName,
    parentLastName,
    parentEmail,
    parentPhone,
    emergencyContactName: asString(request.emergencyContactName).trim(),
    emergencyContactPhone: asString(request.emergencyContactPhone).trim(),
    emergencyContactRelation: asString(request.emergencyContactRelation).trim(),
    allergies: asString(request.allergies).trim(),
    medications: asString(request.medications).trim(),
    medicalNotes: asString(request.medicalNotes).trim(),
    dietaryNotes: asString(request.dietaryNotes).trim(),
    emailSentAt: nowIso(),
    emailLastError: null,
    emailRetryCount: 0,
    emailProvider: "brevo",
    brevoMessageId: null,
    authorizedAt: null,
    rejectedAt: null,
    expiresAt,
    legalVersions: null,
    consents: null,
    photoConsent: "not_answered",
    socialPublicationConsent: "not_answered",
    signatureUrl: null,
    signaturePath: null,
    pdfUrl: null,
    pdfPath: null,
    ipAddress: null,
    userAgent: null,
    createdAt:
      registration.parentAuthorization &&
      typeof registration.parentAuthorization.createdAt === "string"
        ? registration.parentAuthorization.createdAt
        : nowIso(),
    updatedAt: nowIso(),
  };

  // Pre-set: anche se Brevo fallisce abbiamo lo stato salvato.
  await registrationRef.set(
    {
      parentAuthorization: stateBase,
      updatedAt: nowIso(),
    },
    { merge: true },
  );

  await writeAuditLog(db, stakeId, activityId, registrationId, {
    tokenId: tokenHash,
    event: "authorization_requested",
    parentEmail,
    parentName,
    parentPhone,
  });

  // Invio email Brevo
  let brevoResult = null;
  let emailError = null;
  try {
    brevoResult = await sendParentAuthorizationEmail({
      apiKey: BREVO_API_KEY.value(),
      parentEmail,
      parentName: parentName || parentEmail,
      participantName,
      activityTitle,
      activityStartDate,
      activityEndDate,
      activityLocation,
      authorizationUrl,
      expiresAt,
    });
  } catch (error) {
    emailError = error;
    logger.error("Brevo send failed.", {
      stakeId,
      activityId,
      registrationId,
      tokenId: tokenHash,
      statusCode: error instanceof BrevoError ? error.statusCode : null,
      message: error.message,
    });
  }

  if (emailError) {
    await registrationRef.set(
      {
        parentAuthorization: {
          ...stateBase,
          status: "email_error",
          emailLastError: emailError.message ? emailError.message.slice(0, 500) : "unknown",
          emailRetryCount: FieldValue.increment(1),
          updatedAt: nowIso(),
        },
        updatedAt: nowIso(),
      },
      { merge: true },
    );

    await writeAuditLog(db, stakeId, activityId, registrationId, {
      tokenId: tokenHash,
      event: "email_failed",
      parentEmail,
      parentName,
      emailProvider: "brevo",
      emailErrorCode:
        emailError instanceof BrevoError && emailError.statusCode
          ? String(emailError.statusCode)
          : null,
      emailErrorMessage: emailError.message ? emailError.message.slice(0, 500) : null,
    });

    return { sent: false, error: emailError.message };
  }

  await registrationRef.set(
    {
      parentAuthorization: {
        ...stateBase,
        brevoMessageId: brevoResult.messageId || null,
        updatedAt: nowIso(),
      },
      updatedAt: nowIso(),
    },
    { merge: true },
  );

  await writeAuditLog(db, stakeId, activityId, registrationId, {
    tokenId: tokenHash,
    event: "email_sent",
    parentEmail,
    parentName,
    emailProvider: "brevo",
    brevoMessageId: brevoResult.messageId || null,
  });

  logger.info("Parent authorization email sent.", {
    stakeId,
    activityId,
    registrationId,
    tokenId: tokenHash,
    brevoMessageId: brevoResult.messageId || null,
  });

  return { sent: true, tokenId: tokenHash };
}

// =============================================================================
// Step 2: lookup token (per pagina genitore)
// =============================================================================

async function loadTokenByRawValue(db, rawToken) {
  if (typeof rawToken !== "string" || rawToken.length < 32) return null;
  const tokenHash = hashToken(rawToken);
  const snapshot = await db.doc(`parentAuthorizationTokens/${tokenHash}`).get();
  if (!snapshot.exists) return null;
  return { hash: tokenHash, ...snapshot.data() };
}

function deriveTokenStatus(token) {
  if (!token) return "not_found";
  if (token.status === "used") return "used";
  if (token.status === "invalidated") return "invalidated";

  const expiresAt = token.expiresAt ? new Date(token.expiresAt) : null;
  if (expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt < new Date()) {
    return "expired";
  }
  return "valid";
}

// =============================================================================
// Cloud Function: trigger Firestore (auto invio iniziale)
// =============================================================================

const onRegistrationPendingParentAuth = onDocumentWritten(
  {
    document:
      "stakes/{stakeId}/activities/{activityId}/registrations/{registrationId}",
    region: REGION,
    secrets: [BREVO_API_KEY],
  },
  async (event) => {
    const after = event.data?.after?.data();
    if (!after) {
      // delete: niente da fare
      return;
    }

    if (after.registrationStatus !== "pending_parent_authorization") {
      return;
    }

    // Se gia' c'e' un sub-object parentAuthorization con tokenId, non re-inviare.
    // Il reinvio passa da resendParentAuthorization callable.
    if (
      after.parentAuthorization &&
      typeof after.parentAuthorization === "object" &&
      after.parentAuthorization.tokenId &&
      after.parentAuthorization.status !== "email_error"
    ) {
      return;
    }

    const { stakeId, activityId, registrationId } = event.params;
    const db = getFirestore();
    const storage = getStorage();

    const activity = await loadActivity(db, stakeId, activityId);
    if (!activity) {
      logger.warn("Attivita' non trovata per parent auth send.", {
        stakeId,
        activityId,
      });
      return;
    }

    const registration = { id: registrationId, ...after };

    try {
      await sendInitialAuthorizationEmail({
        db,
        storage,
        stakeId,
        activityId,
        registrationId,
        registration,
        activity,
      });
    } catch (error) {
      logger.error("sendInitialAuthorizationEmail crashed.", {
        stakeId,
        activityId,
        registrationId,
        error: error.message,
      });
    }
  },
);

// =============================================================================
// Cloud Function: lookup pubblico per pagina genitore
// =============================================================================

const parentAuthorizationGetContext = onCall(
  {
    region: REGION,
    cors: true,
  },
  async (request) => {
    const rawToken = request.data?.token;
    if (typeof rawToken !== "string" || !rawToken.trim()) {
      throw new HttpsError("invalid-argument", "Token mancante.");
    }

    const db = getFirestore();
    const token = await loadTokenByRawValue(db, rawToken.trim());

    if (!token) {
      return { status: "not_found" };
    }

    const status = deriveTokenStatus(token);

    if (status !== "valid") {
      return {
        status,
        activityTitle: token.activityTitle || "",
        participantName: token.participantName || "",
      };
    }

    const reusableSignature = await loadSignatureCache(db, token.parentEmail || "");

    return {
      status: "valid",
      activityTitle: token.activityTitle || "",
      activityStartDate: token.activityStartDate || "",
      activityEndDate: token.activityEndDate || "",
      participantName: token.participantName || "",
      parentEmail: token.parentEmail || "",
      hasReusableSignature: Boolean(reusableSignature),
      expiresAt: token.expiresAt || null,
      legalVersions: LEGAL_DOC_VERSIONS,
    };
  },
);

// =============================================================================
// Cloud Function: conferma genitore
// =============================================================================

const parentAuthorizationConfirm = onCall(
  {
    region: REGION,
    secrets: [BREVO_API_KEY],
    cors: true,
  },
  async (request) => {
    const rawToken = request.data?.token;
    const consents = request.data?.consents;
    const photoConsent = sanitizePhotoConsent(request.data?.photoConsent);
    const socialPublicationConsent = sanitizePhotoConsent(
      request.data?.socialPublicationConsent,
    );
    const signatureDataUrl = request.data?.signatureDataUrl;
    const useStoredSignature = request.data?.useStoredSignature === true;

    if (typeof rawToken !== "string" || !rawToken.trim()) {
      throw new HttpsError("invalid-argument", "Token mancante.");
    }

    if (!validateRequiredConsents(consents)) {
      throw new HttpsError(
        "failed-precondition",
        "Devi accettare tutti i consensi obbligatori per confermare l'autorizzazione.",
      );
    }

    const db = getFirestore();
    const storage = getStorage();

    const token = await loadTokenByRawValue(db, rawToken.trim());
    if (!token) {
      throw new HttpsError("not-found", "Token non trovato.");
    }

    const tokenStatus = deriveTokenStatus(token);
    if (tokenStatus !== "valid") {
      throw new HttpsError(
        "failed-precondition",
        `Token non utilizzabile (stato: ${tokenStatus}).`,
      );
    }

    const { stakeId, activityId, registrationId, hash: tokenHash } = token;

    const registration = await loadRegistration(
      db,
      stakeId,
      activityId,
      registrationId,
    );
    if (!registration) {
      throw new HttpsError("not-found", "Iscrizione associata non trovata.");
    }

    const activity = await loadActivity(db, stakeId, activityId);
    if (!activity) {
      throw new HttpsError("not-found", "Attivita' non trovata.");
    }

    const ipAddress = (
      request.rawRequest?.headers?.["x-forwarded-for"] ||
      request.rawRequest?.ip ||
      ""
    )
      .toString()
      .split(",")[0]
      .trim()
      .slice(0, 45) || null;
    const userAgent = (
      request.rawRequest?.headers?.["user-agent"] || ""
    ).toString().slice(0, 250) || null;

    const confirmedAt = nowIso();
    const existingState =
      registration.parentAuthorization && typeof registration.parentAuthorization === "object"
        ? registration.parentAuthorization
        : {};

    const parentName = `${existingState.parentFirstName || ""} ${existingState.parentLastName || ""}`.trim();
    const parentEmail = normalizeEmail(existingState.parentEmail || token.parentEmail);

    // Salva firma su Storage (se fornita), oppure riusa quella associata
    // alla stessa email genitore.
    let signaturePath = null;
    let signatureUrl = null;
    let signatureBuffer = null;
    let signatureSource = "new";

    const decoded = decodeBase64Image(signatureDataUrl);
    if (decoded && decoded.length > 100) {
      signatureBuffer = sanitizeSignaturePng(decoded);
    } else if (useStoredSignature) {
      const reusable = await loadSignatureBufferFromCache({
        db,
        storage,
        parentEmail,
      });
      if (reusable) {
        signatureBuffer = sanitizeSignaturePng(reusable.buffer);
        signatureSource = "reused";
      }
    }

    if (!signatureBuffer || signatureBuffer.length <= 100) {
      throw new HttpsError(
        "failed-precondition",
        "Serve una firma per confermare l'autorizzazione.",
      );
    }

    if (signatureBuffer) {
      signaturePath = `${STORAGE_PATH_PARENT_AUTH_SIGNATURE(
        stakeId,
        activityId,
        registrationId,
      )}/${tokenHash}.png`;
      const file = storage.bucket().file(signaturePath);
      await file.save(decoded, {
        contentType: "image/png",
        resumable: false,
        metadata: {
          metadata: { tokenHash, confirmedAt, signatureSource },
        },
      });
      signatureUrl = null; // path interno, niente URL pubblico

      if (signatureSource === "new") {
        await saveReusableSignature({
          db,
          storage,
          parentEmail,
          parentName,
          signatureBuffer,
          source: { stakeId, activityId, registrationId },
        });
      } else {
        const signatureCacheRef = getSignatureCacheRef(db, parentEmail);
        if (signatureCacheRef) {
          await signatureCacheRef.set(
            {
              lastUsedAt: confirmedAt,
              updatedAt: confirmedAt,
              lastUsedStakeId: stakeId,
              lastUsedActivityId: activityId,
              lastUsedRegistrationId: registrationId,
            },
            { merge: true },
          );
        }
      }
    }

    const stake = await loadStake(db, stakeId);

    // Genera PDF ufficiale + PDF audit tecnico.
    let pdfPath = null;
    let pdfUrl = null;
    let conductPdfPath = null;
    let conductPdfBuffer = null;
    let auditPdfPath = null;
    let officialPdfBuffer = null;
    try {
      const {
        generateOfficialConsentPdf,
        generateChurchActivityConductPdf,
      } = require("./officialConsentPdf");
      officialPdfBuffer = await generateOfficialConsentPdf({
        activity: {
          title: activity.title || "",
          description: activity.description || activity.program || activity.publicNotes || "",
          publicNotes: activity.publicNotes || "",
          startDate: activity.startDate || "",
          endDate: activity.endDate || "",
          location: activity.location || "",
          activityType: activity.activityType || (activity.overnight ? "overnight" : "standard"),
          overnight: Boolean(activity.overnight),
          stakeName: stake?.name || "",
        },
        organization: {
          stakeName: stake?.name || "",
          unitName: registration.unitNameSnapshot || "",
          leaderName: activity.eventLeaderName || "",
          leaderPhone: activity.eventLeaderPhone || "",
          leaderEmail: activity.eventLeaderEmail || "",
        },
        participant: {
          fullName: registration.fullName || "",
          birthDate: registration.birthDate || "",
          email: registration.email || "",
          phone: registration.phone || "",
          unitName: registration.unitNameSnapshot || "",
          address:
            typeof registration.answers?.address === "string"
              ? registration.answers.address
              : "",
          city:
            typeof registration.answers?.city === "string"
              ? registration.answers.city
              : "",
          stateOrProvince:
            typeof registration.answers?.stateOrProvince === "string"
              ? registration.answers.stateOrProvince
              : "",
        },
        parent: {
          firstName: existingState.parentFirstName || "",
          lastName: existingState.parentLastName || "",
          email: parentEmail,
          phone: existingState.parentPhone || "",
        },
        emergency: {
          name: existingState.emergencyContactName || "",
          phone: existingState.emergencyContactPhone || "",
          relation: existingState.emergencyContactRelation || "",
          secondaryPhone:
            typeof registration.answers?.emergencyContactSecondaryPhone === "string"
              ? registration.answers.emergencyContactSecondaryPhone
              : "",
        },
        medical: {
          allergies: existingState.allergies || "",
          medications: existingState.medications || "",
          medicalNotes: existingState.medicalNotes || "",
          dietaryNotes: existingState.dietaryNotes || "",
        },
        confirmedAt,
        signaturePngBuffer: signatureBuffer,
      });

      pdfPath = `${STORAGE_PATH_PARENT_AUTH_PDF(
        stakeId,
        activityId,
        registrationId,
      )}/${tokenHash}-official.pdf`;
      const officialPdfFile = storage.bucket().file(pdfPath);
      await officialPdfFile.save(officialPdfBuffer, {
        contentType: "application/pdf",
        resumable: false,
        metadata: {
          metadata: { tokenHash, confirmedAt, documentKind: "official_consent" },
        },
      });

      conductPdfBuffer = await generateChurchActivityConductPdf();
      conductPdfPath = `${STORAGE_PATH_PARENT_AUTH_PDF(
        stakeId,
        activityId,
        registrationId,
      )}/${tokenHash}-conduct.pdf`;
      const conductPdfFile = storage.bucket().file(conductPdfPath);
      await conductPdfFile.save(conductPdfBuffer, {
        contentType: "application/pdf",
        resumable: false,
        metadata: {
          metadata: { tokenHash, confirmedAt, documentKind: "church_activity_conduct" },
        },
      });
    } catch (error) {
      logger.error("Official consent PDF generation failed.", {
        stakeId,
        activityId,
        registrationId,
        tokenId: tokenHash,
        error: error.message,
      });
    }

    try {
      const { generateParentAuthorizationPdf } = require("./pdfGenerator");
      const pdfBuffer = await generateParentAuthorizationPdf({
        activity: {
          title: activity.title || "",
          startDate: activity.startDate || "",
          endDate: activity.endDate || "",
          location: activity.location || "",
          activityType: activity.activityType || (activity.overnight ? "overnight" : "standard"),
          overnight: Boolean(activity.overnight),
        },
        participant: {
          fullName: registration.fullName || "",
          birthDate: registration.birthDate || "",
          email: registration.email || "",
          phone: registration.phone || "",
        },
        parent: {
          firstName: existingState.parentFirstName || "",
          lastName: existingState.parentLastName || "",
          email: existingState.parentEmail || token.parentEmail || "",
          phone: existingState.parentPhone || "",
        },
        emergency: {
          name: existingState.emergencyContactName || "",
          phone: existingState.emergencyContactPhone || "",
          relation: existingState.emergencyContactRelation || "",
        },
        medical: {
          allergies: existingState.allergies || "",
          medications: existingState.medications || "",
          medicalNotes: existingState.medicalNotes || "",
          dietaryNotes: existingState.dietaryNotes || "",
        },
        consents,
        photoConsent,
        socialPublicationConsent,
        legalVersions: LEGAL_DOC_VERSIONS,
        confirmedAt,
        ipAddress,
        userAgent,
        signaturePngBuffer: signatureBuffer,
      });

      auditPdfPath = `${STORAGE_PATH_PARENT_AUTH_PDF(
        stakeId,
        activityId,
        registrationId,
      )}/${tokenHash}-audit.pdf`;
      const pdfFile = storage.bucket().file(auditPdfPath);
      await pdfFile.save(pdfBuffer, {
        contentType: "application/pdf",
        resumable: false,
        metadata: {
          metadata: { tokenHash, confirmedAt, documentKind: "authorization_audit" },
        },
      });
    } catch (error) {
      logger.error("Audit PDF generation failed.", {
        stakeId,
        activityId,
        registrationId,
        tokenId: tokenHash,
        error: error.message,
      });
      // Non blocchiamo la conferma se PDF fallisce: l'audit log resta.
    }

    let copyEmailSentAt = null;
    let copyEmailMessageId = null;
    let copyEmailError = null;
    if (officialPdfBuffer && parentEmail) {
      try {
        const result = await sendSignedAuthorizationCopyEmail({
          apiKey: BREVO_API_KEY.value(),
          parentEmail,
          parentName: parentName || parentEmail,
          participantName: registration.fullName || token.participantName || "",
          activityTitle: activity.title || token.activityTitle || "",
          pdfBuffer: officialPdfBuffer,
          pdfFilename: `modulo-consenso-${registrationId}.pdf`,
          conductPdfBuffer,
          conductPdfFilename: `condotta-attivita-chiesa-${registrationId}.pdf`,
        });
        copyEmailSentAt = nowIso();
        copyEmailMessageId = result.messageId || null;
      } catch (error) {
        copyEmailError = error.message ? error.message.slice(0, 500) : "unknown";
        logger.error("Signed authorization copy email failed.", {
          stakeId,
          activityId,
          registrationId,
          tokenId: tokenHash,
          error: error.message,
        });
      }
    }

    // Aggiorna registration: status confirmed + sub-object completo
    const registrationRef = db.doc(
      `stakes/${stakeId}/activities/${activityId}/registrations/${registrationId}`,
    );

    const newState = {
      ...existingState,
      status: "authorized",
      tokenId: tokenHash,
      authorizedAt: confirmedAt,
      legalVersions: LEGAL_DOC_VERSIONS,
      consents,
      photoConsent,
      socialPublicationConsent,
      signaturePath,
      signatureUrl,
      pdfPath,
      pdfUrl,
      conductPdfPath,
      auditPdfPath,
      signatureSource,
      signedCopyEmailSentAt: copyEmailSentAt,
      signedCopyEmailMessageId: copyEmailMessageId,
      signedCopyEmailLastError: copyEmailError,
      ipAddress,
      userAgent,
      updatedAt: confirmedAt,
    };

    await registrationRef.set(
      {
        parentAuthorization: newState,
        parentConsentDocumentName: pdfPath ? `modulo-consenso-${registrationId}.pdf` : null,
        parentConsentDocumentPath: pdfPath,
        parentConsentDocumentUrl: null,
        parentConsentUploadedAt: pdfPath ? confirmedAt : null,
        consentSignaturePath: signaturePath,
        consentSignatureUrl: null,
        consentSignatureSetAt: confirmedAt,
        registrationStatus: "confirmed",
        updatedAt: confirmedAt,
      },
      { merge: true },
    );

    // Marca token come usato.
    await db.doc(`parentAuthorizationTokens/${tokenHash}`).set(
      {
        status: "used",
        usedAt: confirmedAt,
      },
      { merge: true },
    );

    await writeAuditLog(db, stakeId, activityId, registrationId, {
      tokenId: tokenHash,
      event: "parent_authorized",
      parentEmail: existingState.parentEmail || token.parentEmail,
      parentName: `${existingState.parentFirstName || ""} ${existingState.parentLastName || ""}`.trim(),
      parentPhone: existingState.parentPhone || null,
      legalVersions: LEGAL_DOC_VERSIONS,
      consents,
      photoConsent,
      socialPublicationConsent,
      signaturePath,
      pdfPath,
      auditPdfPath,
      ipAddress,
      userAgent,
    });

    logger.info("Parent authorization confirmed.", {
      stakeId,
      activityId,
      registrationId,
      tokenId: tokenHash,
    });

    return { ok: true };
  },
);

// =============================================================================
// Cloud Function: rifiuto genitore
// =============================================================================

const parentAuthorizationReject = onCall(
  {
    region: REGION,
    cors: true,
  },
  async (request) => {
    const rawToken = request.data?.token;
    const reason = asString(request.data?.reason).trim().slice(0, 500) || null;

    if (typeof rawToken !== "string" || !rawToken.trim()) {
      throw new HttpsError("invalid-argument", "Token mancante.");
    }

    const db = getFirestore();
    const token = await loadTokenByRawValue(db, rawToken.trim());
    if (!token) {
      throw new HttpsError("not-found", "Token non trovato.");
    }

    const tokenStatus = deriveTokenStatus(token);
    if (tokenStatus !== "valid") {
      throw new HttpsError(
        "failed-precondition",
        `Token non utilizzabile (stato: ${tokenStatus}).`,
      );
    }

    const { stakeId, activityId, registrationId, hash: tokenHash } = token;
    const rejectedAt = nowIso();

    const ipAddress = (
      request.rawRequest?.headers?.["x-forwarded-for"] ||
      request.rawRequest?.ip ||
      ""
    )
      .toString()
      .split(",")[0]
      .trim()
      .slice(0, 45) || null;
    const userAgent = (
      request.rawRequest?.headers?.["user-agent"] || ""
    ).toString().slice(0, 250) || null;

    const registrationRef = db.doc(
      `stakes/${stakeId}/activities/${activityId}/registrations/${registrationId}`,
    );

    await registrationRef.set(
      {
        registrationStatus: "rejected_by_parent",
        parentAuthorization: {
          status: "rejected_by_parent",
          rejectedAt,
          ipAddress,
          userAgent,
          updatedAt: rejectedAt,
        },
        updatedAt: rejectedAt,
      },
      { merge: true },
    );

    await db.doc(`parentAuthorizationTokens/${tokenHash}`).set(
      {
        status: "used",
        usedAt: rejectedAt,
      },
      { merge: true },
    );

    await writeAuditLog(db, stakeId, activityId, registrationId, {
      tokenId: tokenHash,
      event: "parent_rejected",
      parentEmail: token.parentEmail,
      ipAddress,
      userAgent,
      emailErrorMessage: reason,
    });

    // Alert admin via adminAlerts esistente
    await db.doc(
      `stakes/${stakeId}/adminAlerts/parent_rejected_${activityId}_${registrationId}`,
    ).set({
      type: "parent_rejected",
      stakeId,
      eventId: activityId,
      registrationId,
      eventTitle: token.activityTitle || "",
      participantName: token.participantName || "",
      title: "Autorizzazione genitore rifiutata",
      message: `Il genitore ha rifiutato l'autorizzazione per ${token.participantName || "il minore"}.`,
      severity: "warning",
      active: true,
      readBy: [],
      createdAt: rejectedAt,
      updatedAt: rejectedAt,
    });

    return { ok: true };
  },
);

// =============================================================================
// Cloud Function: reinvio admin
// =============================================================================

const parentAuthorizationResend = onCall(
  {
    region: REGION,
    secrets: [BREVO_API_KEY],
    cors: true,
  },
  async (request) => {
    const stakeId = asString(request.data?.stakeId).trim();
    const activityId = asString(request.data?.activityId).trim();
    const registrationId = asString(request.data?.registrationId).trim();

    if (!stakeId || !activityId || !registrationId) {
      throw new HttpsError("invalid-argument", "Parametri mancanti.");
    }

    const db = getFirestore();
    const storage = getStorage();

    await assertAdminForStake(db, request, stakeId);

    const registration = await loadRegistration(db, stakeId, activityId, registrationId);
    if (!registration) {
      throw new HttpsError("not-found", "Iscrizione non trovata.");
    }

    const activity = await loadActivity(db, stakeId, activityId);
    if (!activity) {
      throw new HttpsError("not-found", "Attivita' non trovata.");
    }

    // Invalida vecchio token (se esiste).
    const oldTokenId =
      registration.parentAuthorization &&
      typeof registration.parentAuthorization === "object"
        ? registration.parentAuthorization.tokenId
        : null;

    if (oldTokenId) {
      await db.doc(`parentAuthorizationTokens/${oldTokenId}`).set(
        {
          status: "invalidated",
          invalidatedAt: nowIso(),
        },
        { merge: true },
      );

      await writeAuditLog(db, stakeId, activityId, registrationId, {
        tokenId: oldTokenId,
        event: "token_invalidated",
        actorUserId: request.auth.uid,
      });
    }

    // Riusa la logica di invio iniziale forzando un nuovo invio.
    // Reset dello stato per permettere al re-send: tolgo tokenId cosi' la
    // funzione interna ne crea uno nuovo (il check di skip avviene su
    // `email_error` o `tokenId presente AND status != email_error`).
    await db.doc(
      `stakes/${stakeId}/activities/${activityId}/registrations/${registrationId}`,
    ).set(
      {
        parentAuthorization: {
          ...(registration.parentAuthorization || {}),
          tokenId: null,
          status: "pending_parent_authorization",
          updatedAt: nowIso(),
        },
      },
      { merge: true },
    );

    // Re-fetch registration per avere lo stato aggiornato
    const refreshed = await loadRegistration(db, stakeId, activityId, registrationId);

    const result = await sendInitialAuthorizationEmail({
      db,
      storage,
      stakeId,
      activityId,
      registrationId,
      registration: refreshed,
      activity,
    });

    if (oldTokenId) {
      await writeAuditLog(db, stakeId, activityId, registrationId, {
        tokenId: result.tokenId || null,
        event: "email_resent",
        actorUserId: request.auth.uid,
        emailProvider: "brevo",
      });
    }

    return { ok: true, sent: Boolean(result.sent), tokenId: result.tokenId || null };
  },
);

// =============================================================================
// Cloud Function: fallback approvazioni legacy
// =============================================================================

const parentAuthorizationBackfillLegacyApprovals = onCall(
  {
    region: REGION,
    secrets: [BREVO_API_KEY],
    timeoutSeconds: 300,
    memory: "512MiB",
    cors: true,
  },
  async (request) => {
    const stakeId = asString(request.data?.stakeId).trim();
    const activityId = asString(request.data?.activityId).trim();
    const dryRun = request.data?.dryRun === true;

    if (!stakeId || !activityId) {
      throw new HttpsError("invalid-argument", "Parametri mancanti.");
    }

    const db = getFirestore();
    const storage = getStorage();
    await assertAdminForStake(db, request, stakeId);

    const [activity, stake, registrationsSnapshot] = await Promise.all([
      loadActivity(db, stakeId, activityId),
      loadStake(db, stakeId),
      db.collection(`stakes/${stakeId}/activities/${activityId}/registrations`).get(),
    ]);

    if (!activity) {
      throw new HttpsError("not-found", "Attivita non trovata.");
    }

    const candidates = registrationsSnapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter(isLegacyApprovalCandidate);

    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        candidates: candidates.length,
        processed: 0,
        emailed: 0,
        skipped: 0,
        errors: [],
      };
    }

    const result = {
      ok: true,
      dryRun: false,
      candidates: candidates.length,
      processed: 0,
      emailed: 0,
      skipped: 0,
      errors: [],
    };

    const {
      generateOfficialConsentPdf,
      generateChurchActivityConductPdf,
    } = require("./officialConsentPdf");

    for (const registration of candidates) {
      const registrationId = registration.id;
      const parentDetails = getLegacyParentDetails(registration);
      const acceptedAt = getLegacyApprovalDate(
        registration,
        parentDetails.request,
        parentDetails.existingState,
      );
      const parentName =
        parentDetails.parentName ||
        `${parentDetails.parentFirstName} ${parentDetails.parentLastName}`.trim();

      if (!parentDetails.parentEmail || !parentName) {
        result.skipped += 1;
        result.errors.push({
          registrationId,
          reason: "missing_parent_identity",
        });
        continue;
      }

      const legacyTokenId = `legacy-${crypto
        .createHash("sha256")
        .update(`${stakeId}/${activityId}/${registrationId}/${acceptedAt}`)
        .digest("hex")
        .slice(0, 32)}`;
      const photoConsent = getLegacyPhotoDecision(
        registration,
        parentDetails.existingState.photoConsent,
        ["photoReleaseAccepted", "photoInternalConsent"],
      );
      const socialPublicationConsent = getLegacyPhotoDecision(
        registration,
        parentDetails.existingState.socialPublicationConsent,
        ["photoPublicConsent", "adultSocialPublicationConsent"],
      );
      const consents = Object.fromEntries(
        PARENT_CONSENT_CHECKBOXES.map((item) => [item.key, true]),
      );

      try {
        const officialPdfBuffer = await generateOfficialConsentPdf({
          activity: {
            title: activity.title || "",
            description: activity.description || activity.program || activity.publicNotes || "",
            publicNotes: activity.publicNotes || "",
            startDate: activity.startDate || "",
            endDate: activity.endDate || "",
            location: activity.location || "",
            activityType: activity.activityType || (activity.overnight ? "overnight" : "standard"),
            overnight: Boolean(activity.overnight),
            stakeName: stake?.name || "",
          },
          organization: {
            stakeName: stake?.name || "",
            unitName: registration.unitNameSnapshot || "",
            leaderName: activity.eventLeaderName || "",
            leaderPhone: activity.eventLeaderPhone || "",
            leaderEmail: activity.eventLeaderEmail || "",
          },
          participant: {
            fullName: registration.fullName || "",
            birthDate: registration.birthDate || "",
            email: registration.email || "",
            phone: registration.phone || "",
            unitName: registration.unitNameSnapshot || "",
            address:
              typeof registration.answers?.address === "string"
                ? registration.answers.address
                : "",
            city:
              typeof registration.answers?.city === "string"
                ? registration.answers.city
                : "",
            stateOrProvince:
              typeof registration.answers?.stateOrProvince === "string"
                ? registration.answers.stateOrProvince
                : "",
          },
          parent: {
            firstName: parentDetails.parentFirstName,
            lastName: parentDetails.parentLastName,
            email: parentDetails.parentEmail,
            phone: parentDetails.parentPhone,
          },
          emergency: {
            name: parentDetails.emergencyContactName,
            phone: parentDetails.emergencyContactPhone,
            relation: parentDetails.emergencyContactRelation,
            secondaryPhone:
              typeof registration.answers?.emergencyContactSecondaryPhone === "string"
                ? registration.answers.emergencyContactSecondaryPhone
                : "",
          },
          medical: {
            allergies: parentDetails.allergies,
            medications: parentDetails.medications,
            medicalNotes: parentDetails.medicalNotes,
            dietaryNotes: parentDetails.dietaryNotes,
          },
          confirmedAt: acceptedAt,
          signatureText: parentName,
        });

        const conductPdfBuffer = await generateChurchActivityConductPdf();
        const pdfPath = `${STORAGE_PATH_PARENT_AUTH_PDF(
          stakeId,
          activityId,
          registrationId,
        )}/${legacyTokenId}-official.pdf`;
        const conductPdfPath = `${STORAGE_PATH_PARENT_AUTH_PDF(
          stakeId,
          activityId,
          registrationId,
        )}/${legacyTokenId}-conduct.pdf`;

        await Promise.all([
          storage.bucket().file(pdfPath).save(officialPdfBuffer, {
            contentType: "application/pdf",
            resumable: false,
            metadata: {
              metadata: {
                tokenHash: legacyTokenId,
                confirmedAt: acceptedAt,
                documentKind: "official_consent",
                signatureSource: "legacy_typed",
              },
            },
          }),
          storage.bucket().file(conductPdfPath).save(conductPdfBuffer, {
            contentType: "application/pdf",
            resumable: false,
            metadata: {
              metadata: {
                tokenHash: legacyTokenId,
                confirmedAt: acceptedAt,
                documentKind: "church_activity_conduct",
                signatureSource: "legacy_typed",
              },
            },
          }),
        ]);

        let copyEmailSentAt = null;
        let copyEmailMessageId = null;
        let copyEmailError = null;
        try {
          const emailResult = await sendSignedAuthorizationCopyEmail({
            apiKey: BREVO_API_KEY.value(),
            parentEmail: parentDetails.parentEmail,
            parentName,
            participantName: registration.fullName || "",
            activityTitle: activity.title || "",
            pdfBuffer: officialPdfBuffer,
            pdfFilename: `modulo-consenso-${registrationId}.pdf`,
            conductPdfBuffer,
            conductPdfFilename: `condotta-attivita-chiesa-${registrationId}.pdf`,
          });
          copyEmailSentAt = nowIso();
          copyEmailMessageId = emailResult.messageId || null;
          result.emailed += 1;
        } catch (error) {
          copyEmailError = error.message ? error.message.slice(0, 500) : "unknown";
          result.errors.push({
            registrationId,
            reason: "email_failed",
            message: copyEmailError,
          });
        }

        const newState = {
          ...(parentDetails.existingState || {}),
          status: "authorized",
          tokenId: legacyTokenId,
          parentFirstName: parentDetails.parentFirstName,
          parentLastName: parentDetails.parentLastName,
          parentEmail: parentDetails.parentEmail,
          parentPhone: parentDetails.parentPhone,
          emergencyContactName: parentDetails.emergencyContactName,
          emergencyContactPhone: parentDetails.emergencyContactPhone,
          emergencyContactRelation: parentDetails.emergencyContactRelation,
          allergies: parentDetails.allergies,
          medications: parentDetails.medications,
          medicalNotes: parentDetails.medicalNotes,
          dietaryNotes: parentDetails.dietaryNotes,
          authorizedAt: acceptedAt,
          legalVersions: LEGAL_DOC_VERSIONS,
          consents,
          photoConsent,
          socialPublicationConsent,
          signaturePath: null,
          signatureUrl: null,
          signatureSource: "legacy_typed",
          pdfPath,
          pdfUrl: null,
          conductPdfPath,
          auditPdfPath: null,
          signedCopyEmailSentAt: copyEmailSentAt,
          signedCopyEmailMessageId: copyEmailMessageId,
          signedCopyEmailLastError: copyEmailError,
          ipAddress: null,
          userAgent: null,
          updatedAt: nowIso(),
        };

        await db
          .doc(`stakes/${stakeId}/activities/${activityId}/registrations/${registrationId}`)
          .set(
            {
              parentAuthorization: newState,
              parentConsentDocumentName: `modulo-consenso-${registrationId}.pdf`,
              parentConsentDocumentPath: pdfPath,
              parentConsentDocumentUrl: null,
              parentConsentUploadedAt: acceptedAt,
              consentSignaturePath: null,
              consentSignatureUrl: null,
              consentSignatureSetAt: acceptedAt,
              registrationStatus: "confirmed",
              updatedAt: nowIso(),
            },
            { merge: true },
          );

        await writeAuditLog(db, stakeId, activityId, registrationId, {
          tokenId: legacyTokenId,
          event: "parent_authorized",
          parentEmail: parentDetails.parentEmail,
          parentName,
          parentPhone: parentDetails.parentPhone || null,
          legalVersions: LEGAL_DOC_VERSIONS,
          consents,
          photoConsent,
          socialPublicationConsent,
          signaturePath: null,
          pdfPath,
          auditPdfPath: null,
          actorUserId: request.auth.uid,
        });

        result.processed += 1;
      } catch (error) {
        result.errors.push({
          registrationId,
          reason: "conversion_failed",
          message: error.message ? error.message.slice(0, 500) : "unknown",
        });
      }
    }

    return result;
  },
);

// =============================================================================
// Cloud Function: download admin modulo firmato
// =============================================================================

const parentAuthorizationGetSignedConsentUrl = onCall(
  {
    region: REGION,
    cors: true,
  },
  async (request) => {
    const stakeId = asString(request.data?.stakeId).trim();
    const activityId = asString(request.data?.activityId).trim();
    const registrationId = asString(request.data?.registrationId).trim();
    const documentKind = asString(request.data?.documentKind, "official").trim();

    if (!stakeId || !activityId || !registrationId) {
      throw new HttpsError("invalid-argument", "Parametri mancanti.");
    }

    const db = getFirestore();
    const storage = getStorage();
    await assertAdminForStake(db, request, stakeId);

    const registration = await loadRegistration(db, stakeId, activityId, registrationId);
    if (!registration) {
      throw new HttpsError("not-found", "Iscrizione non trovata.");
    }

    const parentAuthorization =
      registration.parentAuthorization && typeof registration.parentAuthorization === "object"
        ? registration.parentAuthorization
        : {};

    const pathByKind = {
      official: parentAuthorization.pdfPath,
      conduct: parentAuthorization.conductPdfPath,
      audit: parentAuthorization.auditPdfPath,
    };
    const storagePath = pathByKind[documentKind] || pathByKind.official;

    if (!storagePath) {
      throw new HttpsError("failed-precondition", "Modulo firmato non disponibile.");
    }

    const suffix =
      documentKind === "conduct"
        ? "regolamento"
        : documentKind === "audit"
          ? "audit"
          : "modulo-firmato";
    const filename = `${getRegistrationFileBaseName(registration)} - ${suffix}.pdf`;
    const file = storage.bucket().file(storagePath);
    const signed = await getTemporaryDownloadUrl(file, filename, 15);

    return {
      ok: true,
      url: signed.url,
      filename,
      expiresAt: signed.expiresAt,
    };
  },
);

const parentAuthorizationDownloadSignedConsentsZip = onCall(
  {
    region: REGION,
    timeoutSeconds: 300,
    memory: "512MiB",
    cors: true,
  },
  async (request) => {
    const stakeId = asString(request.data?.stakeId).trim();
    const activityId = asString(request.data?.activityId).trim();

    if (!stakeId || !activityId) {
      throw new HttpsError("invalid-argument", "Parametri mancanti.");
    }

    const db = getFirestore();
    const storage = getStorage();
    await assertAdminForStake(db, request, stakeId);

    const registrationsSnapshot = await db
      .collection(`stakes/${stakeId}/activities/${activityId}/registrations`)
      .get();

    const bucket = storage.bucket();
    const zip = new JSZip();
    const usedNames = new Set();
    let addedCount = 0;

    for (const registrationDoc of registrationsSnapshot.docs) {
      const registration = { id: registrationDoc.id, ...registrationDoc.data() };
      if (registration.status === "cancelled" || registration.registrationStatus === "cancelled") {
        continue;
      }

      const parentAuthorization =
        registration.parentAuthorization && typeof registration.parentAuthorization === "object"
          ? registration.parentAuthorization
          : {};
      const pdfPath = asString(parentAuthorization.pdfPath).trim();

      if (!pdfPath || parentAuthorization.status !== "authorized") {
        continue;
      }

      const file = bucket.file(pdfPath);
      const [exists] = await file.exists();
      if (!exists) {
        logger.warn("Modulo firmato mancante durante ZIP consensi.", {
          stakeId,
          activityId,
          registrationId: registration.id,
          pdfPath,
        });
        continue;
      }

      const [buffer] = await file.download();
      const filename = buildUniqueFilename(getRegistrationFileBaseName(registration), usedNames);
      zip.file(filename, buffer);
      addedCount += 1;
    }

    if (addedCount === 0) {
      throw new HttpsError("failed-precondition", "Nessun modulo firmato disponibile.");
    }

    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    const createdAt = Date.now();
    const downloadPath =
      `protected/stakes/${stakeId}/activities/${activityId}` +
      `/parent-authorization-downloads/consensi-firmati-${createdAt}-${crypto.randomBytes(4).toString("hex")}.zip`;
    const zipFile = bucket.file(downloadPath);
    await zipFile.save(zipBuffer, {
      contentType: "application/zip",
      metadata: {
        cacheControl: "private, no-store, max-age=0",
      },
    });

    const filename = `consensi-firmati-${sanitizeFilenamePart(activityId)}.zip`;
    const signed = await getTemporaryDownloadUrl(zipFile, filename, 15);

    return {
      ok: true,
      url: signed.url,
      filename,
      count: addedCount,
      expiresAt: signed.expiresAt,
    };
  },
);

module.exports = {
  onRegistrationPendingParentAuth,
  parentAuthorizationGetContext,
  parentAuthorizationConfirm,
  parentAuthorizationReject,
  parentAuthorizationResend,
  parentAuthorizationBackfillLegacyApprovals,
  parentAuthorizationGetSignedConsentUrl,
  parentAuthorizationDownloadSignedConsentsZip,
};
