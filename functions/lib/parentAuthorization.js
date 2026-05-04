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

const {
  REGION,
  APP_PUBLIC_URL,
  PARENT_AUTHORIZATION_TOKEN_TTL_DAYS,
  STORAGE_PATH_PARENT_AUTH_PDF,
  STORAGE_PATH_PARENT_AUTH_SIGNATURE,
} = require("./config");
const {
  LEGAL_DOC_VERSIONS,
  PARENT_CONSENT_CHECKBOXES,
} = require("./legalDocs");
const { sendParentAuthorizationEmail, BrevoError } = require("./brevo");
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

async function loadRegistration(db, stakeId, activityId, registrationId) {
  const snapshot = await db
    .doc(
      `stakes/${stakeId}/activities/${activityId}/registrations/${registrationId}`,
    )
    .get();
  if (!snapshot.exists) return null;
  return { id: snapshot.id, ...snapshot.data() };
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

  const parentEmail = asString(request.parentEmail).trim().toLowerCase();
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

    return {
      status: "valid",
      activityTitle: token.activityTitle || "",
      activityStartDate: token.activityStartDate || "",
      activityEndDate: token.activityEndDate || "",
      participantName: token.participantName || "",
      parentEmail: token.parentEmail || "",
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

    // Salva firma su Storage (se fornita).
    let signaturePath = null;
    let signatureUrl = null;
    let signatureBuffer = null;

    const decoded = decodeBase64Image(signatureDataUrl);
    if (decoded && decoded.length > 100) {
      signatureBuffer = decoded;
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
          metadata: { tokenHash, confirmedAt },
        },
      });
      signatureUrl = null; // path interno, niente URL pubblico
    }

    // Genera PDF audit (lazy-load pdfkit per non rallentare il bootstrap del deploy).
    let pdfPath = null;
    let pdfUrl = null;
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

      pdfPath = `${STORAGE_PATH_PARENT_AUTH_PDF(
        stakeId,
        activityId,
        registrationId,
      )}/${tokenHash}.pdf`;
      const pdfFile = storage.bucket().file(pdfPath);
      await pdfFile.save(pdfBuffer, {
        contentType: "application/pdf",
        resumable: false,
        metadata: {
          metadata: { tokenHash, confirmedAt },
        },
      });
    } catch (error) {
      logger.error("PDF generation failed.", {
        stakeId,
        activityId,
        registrationId,
        tokenId: tokenHash,
        error: error.message,
      });
      // Non blocchiamo la conferma se PDF fallisce: l'audit log resta.
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
      ipAddress,
      userAgent,
      updatedAt: confirmedAt,
    };

    await registrationRef.set(
      {
        parentAuthorization: newState,
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
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Login richiesto.");
    }

    const stakeId = asString(request.data?.stakeId).trim();
    const activityId = asString(request.data?.activityId).trim();
    const registrationId = asString(request.data?.registrationId).trim();

    if (!stakeId || !activityId || !registrationId) {
      throw new HttpsError("invalid-argument", "Parametri mancanti.");
    }

    const db = getFirestore();
    const storage = getStorage();

    // Verifica permessi admin
    const userDoc = await db.doc(`users/${request.auth.uid}`).get();
    if (!userDoc.exists) {
      throw new HttpsError("permission-denied", "Profilo utente non trovato.");
    }
    const user = userDoc.data();
    const isAdmin = user.role === "admin" || user.role === "super_admin";
    const isStakeMatch = user.role === "super_admin" || user.stakeId === stakeId;
    if (!isAdmin || !isStakeMatch) {
      throw new HttpsError("permission-denied", "Servono privilegi admin.");
    }

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

module.exports = {
  onRegistrationPendingParentAuth,
  parentAuthorizationGetContext,
  parentAuthorizationConfirm,
  parentAuthorizationReject,
  parentAuthorizationResend,
};
