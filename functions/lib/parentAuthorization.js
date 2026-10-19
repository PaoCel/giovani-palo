/**
 * Logica autorizzazione genitoriale via magic-link Brevo.
 *
 * Flusso:
 * 1. onRegistrationPendingParentAuth (Firestore trigger) - quando una registration
 *    viene creata/aggiornata con status `pending_parent_authorization` e nessun
 *    token attivo, genera un token, salva l'hash in `parentAuthorizationTokens`,
 *    invia email Brevo, scrive audit log.
 * 2. parentAuthorizationGetContext (callable pubblica) - la pagina genitore
 *    legge i dati pubblici da mostrare (titolo attività, date, nome partecipante)
 *    passando il token in chiaro. Verifica scadenza/uso/invalidazione.
 * 3. parentAuthorizationConfirm (callable pubblica) - il genitore conferma:
 *    salva consensi nel sub-object della registration, marca token come usato,
 *    genera PDF audit e lo carica su Storage, scrive audit log, cambia status
 *    registration a "confirmed".
 * 4. parentAuthorizationReject (callable pubblica) - il genitore rifiuta:
 *    aggiorna stato a `rejected_by_parent`, invalida token, audit log.
 * 5. parentAuthorizationResend (callable admin) - reinvio: invalida vecchio token,
 *    crea nuovo, invia di nuovo email Brevo.
 *
 * Ogni emissione (mail, reinvio, "Autorizza ora") passa da una transazione
 * sull'iscrizione che invalida tutti i token pendenti e annota il nuovo: per
 * ogni iscrizione resta un solo link valido.
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
  getAppPublicUrl,
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
const {
  CONSENT_TEXT_VERSION,
  validateConsentChoices,
  issueConsentLink,
} = require("./consentCore");
// NB: pdfGenerator caricato lazy dentro parentAuthorizationConfirm. pdfkit
// inizializza font al require, supera il timeout di analisi statica del
// deploy delle Cloud Functions (10s). Lazy-load -> il bootstrap resta veloce.

const BREVO_API_KEY = defineSecret("BREVO_API_KEY");

// Tetto ai riprovi automatici di invio della mail di autorizzazione: oltre,
// resta il reinvio manuale dell'admin.
const MAX_EMAIL_RETRIES = 3;

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
  return `${getAppPublicUrl().replace(/\/$/, "")}/parent-confirm/${rawToken}`;
}

function buildConsentUrl(rawToken) {
  return `${getAppPublicUrl().replace(/\/$/, "")}/parent-consent/${rawToken}`;
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

async function assertCanResendParentAuthorization(db, request, stakeId, registration) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Login richiesto.");
  }

  const userDoc = await db.doc(`users/${request.auth.uid}`).get();
  if (!userDoc.exists) {
    throw new HttpsError("permission-denied", "Profilo utente non trovato.");
  }

  const user = userDoc.data() || {};
  const isAdmin =
    (user.role === "admin" && user.stakeId === stakeId) ||
    user.role === "super_admin";
  const isUnitLeaderForRegistration =
    user.role === "unit_leader" &&
    user.stakeId === stakeId &&
    typeof user.unitId === "string" &&
    user.unitId.length > 0 &&
    registration.unitId === user.unitId;

  if (!isAdmin && !isUnitLeaderForRegistration) {
    throw new HttpsError(
      "permission-denied",
      "Puoi reinviare autorizzazioni solo per la tua unità.",
    );
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

// Campi sanitari del modulo copiati sull'autorizzazione ancora aperta. In
// transazione, sul documento attuale e non sullo snapshot dell'evento, che
// arriva anche con secondi di ritardo: riscrivere tutto `parentAuthorization`
// da lì rimetteva un link già sostituito o lo stato di prima di una firma.
async function syncPendingParticipantDetails(db, registrationRef, eventTokenId) {
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(registrationRef);
    if (!snapshot.exists) return false;
    const registration = snapshot.data();
    const request = readParentAuthorizationRequest(registration);
    const state = registration.parentAuthorization;
    if (!request || !state || typeof state !== "object") return false;
    if (!isAwaitingParentAuthorization(registration)) return false;
    if (DECIDED_PARENT_AUTH_STATUSES.includes(state.status)) return false;
    if (annotatedTokenId(state) !== eventTokenId) return false;

    const nextDetails = Object.fromEntries(
      PARENT_DETAIL_KEYS.map((key) => [key, asString(request[key]).trim()]),
    );
    const changed = PARENT_DETAIL_KEYS.some((key) => asString(state[key]) !== nextDetails[key]);
    if (!changed) return false;

    const update = { updatedAt: nowIso(), "parentAuthorization.updatedAt": nowIso() };
    for (const key of PARENT_DETAIL_KEYS) {
      update[`parentAuthorization.${key}`] = nextDetails[key];
    }
    tx.update(registrationRef, update);
    return true;
  });
}

const PARENT_DETAIL_KEYS = [
  "emergencyContactName",
  "emergencyContactPhone",
  "emergencyContactRelation",
  "allergies",
  "medications",
  "medicalNotes",
  "dietaryNotes",
];

function isAwaitingParentAuthorization(registration) {
  return registration?.registrationStatus === "pending_parent_authorization";
}

// Stati in cui l'autorizzazione non è ancora stata decisa dal genitore: solo
// qui ha senso spostare la richiesta su un altro indirizzo.
const REISSUABLE_PARENT_AUTH_STATUSES = [
  "pending_request",
  "pending_parent_authorization",
  "email_sent",
  "expired",
];

// La mail del genitore nel modulo non è quella dell'ultimo invio.
function parentEmailChanged(registration) {
  const state = registration.parentAuthorization;
  const request = readParentAuthorizationRequest(registration);
  if (!request || !state || typeof state !== "object") return false;

  const nextEmail = normalizeEmail(request.parentEmail);
  if (!nextEmail) return false;

  return nextEmail !== normalizeEmail(state.parentEmail);
}

function shouldReissueParentAuthorization(registration) {
  const state = registration.parentAuthorization;
  if (!state || typeof state !== "object") return false;
  if (!REISSUABLE_PARENT_AUTH_STATUSES.includes(asString(state.status))) return false;
  return parentEmailChanged(registration);
}

// Stesso invio della callable di reinvio, ma innescato dal modulo invece che
// da un admin. Nella transazione si ricontrolla che la mail sia ancora da
// spostare e che il link annotato sia quello visto dall'evento: un evento
// consegnato due volte non manda una seconda mail.
async function reissueParentAuthorizationForNewParentEmail({
  db,
  stakeId,
  activityId,
  registrationId,
  registration,
}) {
  const activity = await loadActivity(db, stakeId, activityId);
  if (!activity) {
    logger.warn("Attività non trovata per reissue parent auth.", {
      stakeId,
      activityId,
      registrationId,
    });
    return;
  }

  try {
    const result = await sendInitialAuthorizationEmail({
      db,
      stakeId,
      activityId,
      registrationId,
      activity,
      expectedTokenId: annotatedTokenId(registration.parentAuthorization),
      shouldStillSend: (current) =>
        isAwaitingParentAuthorization(current) && shouldReissueParentAuthorization(current),
    });
    if (result.skipped) return;

    await writeAuditLog(db, stakeId, activityId, registrationId, {
      tokenId: result.tokenId || null,
      event: "email_resent",
      actorUserId: null,
      emailProvider: "brevo",
    });
  } catch (error) {
    logger.error("Reinvio autorizzazione al nuovo genitore fallito.", {
      stakeId,
      activityId,
      registrationId,
      detail: error.message,
    });
  }
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

async function writeAuditLog(db, stakeId, activityId, registrationId, payload, tx = null) {
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
    previousPhotoConsent: payload.previousPhotoConsent ?? null,
    previousSocialPublicationConsent: payload.previousSocialPublicationConsent ?? null,
    consentTextVersion: payload.consentTextVersion ?? null,
    consentVia: payload.consentVia ?? null,
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

  if (tx) {
    tx.set(ref, document);
  } else {
    await ref.set(document);
  }
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

const DECIDED_PARENT_AUTH_STATUSES = ["authorized", "rejected_by_parent"];

function annotatedTokenId(state) {
  return state && typeof state === "object" && typeof state.tokenId === "string" && state.tokenId
    ? state.tokenId
    : null;
}

// Un solo link vivo per iscrizione: si leggono tutti i token pendenti, non
// solo l'ultimo annotato sull'iscrizione. Gli invii falliti e i vecchi
// reinvii ne lasciavano indietro di orfani, e due link validi nella stessa
// casella sono un modo sicuro di far firmare la cosa sbagliata.
// L'id iscrizione (`child_<uid>_<figlio>`, `user_<uid>`) è lo stesso in
// tutte le attività: senza palo e attività si invaliderebbero anche i link
// dello stesso figlio su altre attività o su un altro palo.
// Sono letture di transazione: vanno fatte prima di ogni scrittura.
async function readPendingTokens(tx, db, { stakeId, activityId, registrationId, tokenId }) {
  const pendenti = await tx.get(
    db
      .collection("parentAuthorizationTokens")
      .where("stakeId", "==", stakeId)
      .where("activityId", "==", activityId)
      .where("registrationId", "==", registrationId)
      .where("status", "==", "pending"),
  );
  const tokens = [...pendenti.docs];
  // Il token annotato sull'iscrizione si invalida comunque, anche se il suo
  // documento non porta palo/attività (token molto vecchi).
  if (tokenId && !tokens.some((token) => token.id === tokenId)) {
    const annotato = await tx.get(db.doc(`parentAuthorizationTokens/${tokenId}`));
    if (annotato.exists && annotato.data().status === "pending") tokens.push(annotato);
  }
  return tokens;
}

async function invalidateTokens(tx, db, tokens, { stakeId, activityId, registrationId, actorUserId }) {
  for (const token of tokens) {
    tx.update(token.ref, { status: "invalidated", invalidatedAt: nowIso() });
    await writeAuditLog(
      db,
      stakeId,
      activityId,
      registrationId,
      { tokenId: token.id, event: "token_invalidated", actorUserId },
      tx,
    );
  }
}

// Esito della mail sull'iscrizione, solo se il link annotato è ancora quello
// spedito e nessuno ha già deciso: un reinvio o un "Autorizza ora" arrivati
// nel frattempo hanno il loro stato, e una firma appena fatta non si
// riscrive. Solo i campi della mail: il resto l'ha scritto l'emissione.
// La mail ormai è partita (o fallita): un errore qui si registra nei log e
// non diventa un errore del reinvio, che l'admin ripeterebbe con un'altra mail.
async function recordEmailOutcome(db, registrationRef, tokenId, fields) {
  try {
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(registrationRef);
      const state = snapshot.exists ? snapshot.data().parentAuthorization : null;
      if (annotatedTokenId(state) !== tokenId) return;
      if (DECIDED_PARENT_AUTH_STATUSES.includes(state.status)) return;

      const update = { updatedAt: nowIso(), "parentAuthorization.updatedAt": nowIso() };
      for (const [key, value] of Object.entries(fields)) {
        update[`parentAuthorization.${key}`] = value;
      }
      tx.update(registrationRef, update);
    });
  } catch (error) {
    logger.error("Esito dell'invio autorizzazione non registrato.", {
      registrationPath: registrationRef.path,
      tokenId,
      detail: error.message,
    });
  }
}

// Emette il link e manda la mail. L'emissione è una transazione
// sull'iscrizione: invalida tutti i link pendenti, crea il nuovo e lo annota.
// Prima reinvio e trigger scrivevano `tokenId: null` e poi spedivano: quella
// scrittura intermedia faceva ripartire il trigger, che emetteva un secondo
// link e mandava una seconda mail, entrambi validi (2026-10-19).
// - expectedTokenId (trigger): il link annotato che l'evento ha visto; se un
//   altro giro ne ha già emesso uno, questo si ferma. Le callable non lo
//   passano: il reinvio dell'admin sostituisce quello che c'è.
// - shouldStillSend (trigger): ricontrolla nella transazione la condizione
//   che ha fatto partire l'invio.
async function sendInitialAuthorizationEmail({
  db,
  stakeId,
  activityId,
  registrationId,
  activity,
  expectedTokenId,
  shouldStillSend = null,
  actorUserId = null,
}) {
  const registrationRef = db.doc(
    `stakes/${stakeId}/activities/${activityId}/registrations/${registrationId}`,
  );
  const activityTitle = asString(activity.title).trim() || "Attività";
  const activityStartDate = asString(activity.startDate);
  const activityEndDate = asString(activity.endDate) || activityStartDate;
  const activityLocation = asString(activity.location).trim();

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = computeExpiry();
  const authorizationUrl = buildAuthorizationUrl(rawToken);

  const issued = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(registrationRef);
    if (!snapshot.exists) return { skipped: true, reason: "registration_missing" };
    const registration = { id: registrationId, ...snapshot.data() };
    if (isCancelledRegistration(registration)) {
      return { skipped: true, reason: "registration_cancelled" };
    }

    const state =
      registration.parentAuthorization && typeof registration.parentAuthorization === "object"
        ? registration.parentAuthorization
        : null;
    // Un'autorizzazione già firmata (o rifiutata) non si tocca: un invio
    // arrivato in ritardo ne cancellerebbe firma, PDF e consensi.
    if (DECIDED_PARENT_AUTH_STATUSES.includes(state?.status)) {
      return { skipped: true, reason: "already_decided", status: state.status };
    }

    const currentTokenId = annotatedTokenId(state);
    if (expectedTokenId !== undefined && currentTokenId !== expectedTokenId) {
      return { skipped: true, reason: "superseded" };
    }
    if (shouldStillSend && !shouldStillSend(registration)) {
      return { skipped: true, reason: "superseded" };
    }

    const request = readParentAuthorizationRequest(registration);
    if (!request) return { skipped: true, reason: "missing_request_payload" };
    const parentEmail = normalizeEmail(request.parentEmail);
    if (!parentEmail) return { skipped: true, reason: "missing_parent_email" };

    const stale = await readPendingTokens(tx, db, {
      stakeId,
      activityId,
      registrationId,
      tokenId: currentTokenId,
    });

    const parentFirstName = asString(request.parentFirstName).trim();
    const parentLastName = asString(request.parentLastName).trim();
    const parentName = `${parentFirstName} ${parentLastName}`.trim();
    const parentPhone = asString(request.parentPhone).trim();
    const participantName = asString(registration.fullName).trim() || "il minore";

    await invalidateTokens(tx, db, stale, { stakeId, activityId, registrationId, actorUserId });

    // Documento token (id = hash, non token in chiaro)
    tx.set(db.doc(`parentAuthorizationTokens/${tokenHash}`), {
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

    // Stato salvato prima dell'invio: anche se Brevo fallisce resta annotato.
    tx.set(
      registrationRef,
      {
        parentAuthorization: {
          status: "email_sent",
          tokenId: tokenHash,
          // Il link valido torna quello della mail (vedi parentAuthorizationIssueOwnToken).
          selfTokenIssuedAt: null,
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
          // Conservato fino all'invio riuscito: azzerarlo qui rimetteva a zero
          // i tentativi a ogni giro e rendeva il tetto inefficace.
          emailRetryCount: Number(state?.emailRetryCount ?? 0),
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
          createdAt: typeof state?.createdAt === "string" ? state.createdAt : nowIso(),
          updatedAt: nowIso(),
        },
        updatedAt: nowIso(),
      },
      { merge: true },
    );

    await writeAuditLog(
      db,
      stakeId,
      activityId,
      registrationId,
      {
        tokenId: tokenHash,
        event: "authorization_requested",
        parentEmail,
        parentName,
        parentPhone,
      },
      tx,
    );

    return { skipped: false, parentEmail, parentName, participantName };
  });

  if (issued.skipped) {
    if (issued.reason === "missing_request_payload") {
      logger.warn("Registration in pending_parent_authorization senza payload request.", {
        stakeId,
        activityId,
        registrationId,
      });
    } else if (issued.reason === "missing_parent_email") {
      logger.warn("Parent email vuota, salto invio.", {
        stakeId,
        activityId,
        registrationId,
      });
    }
    return issued;
  }

  const { parentEmail, parentName, participantName } = issued;

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
    await recordEmailOutcome(db, registrationRef, tokenHash, {
      status: "email_error",
      emailLastError: emailError.message ? emailError.message.slice(0, 500) : "unknown",
      emailRetryCount: FieldValue.increment(1),
    });

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

    return { sent: false, tokenId: tokenHash, error: emailError.message };
  }

  await recordEmailOutcome(db, registrationRef, tokenHash, {
    brevoMessageId: brevoResult.messageId || null,
    emailRetryCount: 0,
  });

  await writeAuditLog(db, stakeId, activityId, registrationId, {
    tokenId: tokenHash,
    event: "email_sent",
    parentEmail,
    parentName,
    // "simulated": fuori produzione, destinatario fuori allowlist (nessuna mail partita).
    emailProvider: brevoResult.provider === "simulated" ? "simulated" : "brevo",
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

// Un'iscrizione annullata (da /me, da Famiglia o dall'admin) non si conferma
// né si rifiuta con un link ancora valido: prima la conferma la rimetteva in
// "confirmed" e il rifiuto in "rejected_by_parent".
const CANCELLED_REGISTRATION_MESSAGE = "L'iscrizione è annullata.";

function isCancelledRegistration(registration) {
  return registration?.status === "cancelled" || registration?.registrationStatus === "cancelled";
}

const ALREADY_AUTHORIZED_MESSAGE = "L'autorizzazione è già stata firmata.";
const ALREADY_REJECTED_MESSAGE = "Il genitore ha rifiutato l'autorizzazione.";
const MISSING_PARENT_DATA_MESSAGE =
  "Mancano i dati del genitore: riapri il modulo di iscrizione e salvalo.";

function assertParentAuthorizationOpen(status) {
  if (status === "authorized") {
    throw new HttpsError("failed-precondition", ALREADY_AUTHORIZED_MESSAGE);
  }
  if (status === "rejected_by_parent") {
    throw new HttpsError("failed-precondition", ALREADY_REJECTED_MESSAGE);
  }
}

// Scrittura finale di conferma o rifiuto: fra il primo controllo e la
// scrittura passano secondi (PDF, Storage, mail). In transazione si rilegge
// l'iscrizione: annullata o cancellata nel frattempo, non si tocca. Nella
// stessa transazione il link usato diventa "used" e ogni altro link pendente
// dell'iscrizione si invalida: un reinvio partito durante la firma lasciava
// valido il link nuovo, e la sua mail chiedeva una seconda firma.
async function writeIfRegistrationActive(db, registrationRef, data, { token, usedAt }) {
  await db.runTransaction(async (tx) => {
    const current = await tx.get(registrationRef);
    if (!current.exists) {
      throw new HttpsError("not-found", "Iscrizione associata non trovata.");
    }
    if (isCancelledRegistration(current.data())) {
      throw new HttpsError("failed-precondition", CANCELLED_REGISTRATION_MESSAGE);
    }
    const pendenti = await readPendingTokens(tx, db, {
      stakeId: token.stakeId,
      activityId: token.activityId,
      registrationId: token.registrationId,
      tokenId: annotatedTokenId(current.data().parentAuthorization),
    });

    tx.set(registrationRef, data, { merge: true });
    tx.set(
      db.doc(`parentAuthorizationTokens/${token.hash}`),
      { status: "used", usedAt },
      { merge: true },
    );
    await invalidateTokens(
      tx,
      db,
      pendenti.filter((pendente) => pendente.id !== token.hash),
      {
        stakeId: token.stakeId,
        activityId: token.activityId,
        registrationId: token.registrationId,
        actorUserId: null,
      },
    );
  });
}

// Il genitore entrato è titolare dell'iscrizione del link: la pagina di firma
// può mandarlo a "Autorizza ora" in Famiglia. Nessuna lettura in più.
function canSignInApp(request, token) {
  const uid = request.auth?.uid;
  return Boolean(
    uid &&
      typeof token?.registrationId === "string" &&
      token.registrationId.startsWith(`child_${uid}_`),
  );
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

// Un invio fallito lascia status email_error, e ogni scrittura successiva
// sul documento fa ripartire il trigger: senza tetto, un disservizio del
// provider lo mette in rincorsa su se stesso (visto in emulatore il
// 2026-09-17, un token nuovo per ogni giro). Dopo qualche tentativo si
// fermano i riprovi automatici: resta il reinvio manuale dell'admin. Una
// mail corretta nel modulo vale un tentativo in più anche oltre il tetto
// (l'errore poteva essere proprio l'indirizzo): l'invio scrive il nuovo
// indirizzo, quindi un altro fallimento si ferma di nuovo qui.
function retryCapReached(registration) {
  const state = registration.parentAuthorization;
  return Boolean(
    state &&
      typeof state === "object" &&
      state.status === "email_error" &&
      Number(state.emailRetryCount ?? 0) >= MAX_EMAIL_RETRIES &&
      !parentEmailChanged(registration),
  );
}

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

    if (retryCapReached(after)) {
      logger.warn("Invio autorizzazione sospeso: troppi tentativi falliti.", {
        stakeId: event.params.stakeId,
        activityId: event.params.activityId,
        registrationId: event.params.registrationId,
        tentativi: Number(after.parentAuthorization.emailRetryCount ?? 0),
      });
      return;
    }

    // Se già c'è un sub-object parentAuthorization con tokenId, non re-inviare.
    // Il reinvio passa dalla callable parentAuthorizationResend.
    if (
      after.parentAuthorization &&
      typeof after.parentAuthorization === "object" &&
      after.parentAuthorization.tokenId &&
      after.parentAuthorization.status !== "email_error"
    ) {
      const { stakeId, activityId, registrationId } = event.params;
      const db = getFirestore();
      const registrationRef = db.doc(
        `stakes/${stakeId}/activities/${activityId}/registrations/${registrationId}`,
      );

      // Il modulo può correggere il genitore (mail sbagliata, altro genitore).
      // Finché nessuno ha firmato, il token vecchio va invalidato e la mail
      // rispedita al nuovo indirizzo: sincronizzare solo i campi sanitari
      // lasciava l'autorizzazione appesa alla casella sbagliata, senza errori
      // e senza modo di accorgersene (2026-09-17).
      if (shouldReissueParentAuthorization(after)) {
        await reissueParentAuthorizationForNewParentEmail({
          db,
          stakeId,
          activityId,
          registrationId,
          registration: after,
        });
        return;
      }

      await syncPendingParticipantDetails(
        db,
        registrationRef,
        annotatedTokenId(after.parentAuthorization),
      );
      return;
    }

    const { stakeId, activityId, registrationId } = event.params;
    const db = getFirestore();

    const activity = await loadActivity(db, stakeId, activityId);
    if (!activity) {
      logger.warn("Attività non trovata per parent auth send.", {
        stakeId,
        activityId,
      });
      return;
    }

    try {
      await sendInitialAuthorizationEmail({
        db,
        stakeId,
        activityId,
        registrationId,
        activity,
        // Il link che questo evento ha visto (nessuno, o quello dell'invio
        // fallito): due scritture ravvicinate del modulo, o un evento
        // consegnato due volte, non emettono un secondo link.
        expectedTokenId: annotatedTokenId(after.parentAuthorization),
        shouldStillSend: (current) =>
          isAwaitingParentAuthorization(current) && !retryCapReached(current),
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
// Cloud Function: firma dall'app per il genitore già autenticato
// =============================================================================

// Il magic-link nasce per il genitore senza account. Chi ha un account
// famiglia è già identificato: gli emettiamo un token a vita breve, senza
// mandare nessuna mail, e lo mandiamo alla stessa pagina di firma. Così
// modulo, PDF ufficiale, log di consenso e copia firmata restano una sola
// implementazione.
const PARENT_SELF_TOKEN_TTL_MINUTES = 60;

// Controlli di "Autorizza ora", ripetuti nella transazione: fra la prima
// lettura e la scrittura l'iscrizione può essere annullata o firmata.
function assertCanIssueOwnToken(registration, uid) {
  if (!registration) {
    throw new HttpsError("not-found", "Iscrizione non trovata.");
  }

  // Solo il genitore che gestisce quell'iscrizione.
  if (registration.parentUid !== uid) {
    throw new HttpsError(
      "permission-denied",
      "Puoi firmare solo le iscrizioni dei tuoi figli.",
    );
  }

  if (isCancelledRegistration(registration)) {
    throw new HttpsError("failed-precondition", CANCELLED_REGISTRATION_MESSAGE);
  }

  const state =
    registration.parentAuthorization && typeof registration.parentAuthorization === "object"
      ? registration.parentAuthorization
      : null;

  if (state?.status === "authorized") {
    throw new HttpsError("failed-precondition", ALREADY_AUTHORIZED_MESSAGE);
  }

  const req = readParentAuthorizationRequest(registration);
  if (!req) {
    throw new HttpsError("failed-precondition", MISSING_PARENT_DATA_MESSAGE);
  }

  return { state, req };
}

const parentAuthorizationIssueOwnToken = onCall(
  {
    region: REGION,
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
    const uid = request.auth.uid;
    const registration = await loadRegistration(db, stakeId, activityId, registrationId);
    assertCanIssueOwnToken(registration, uid);

    const activity = await loadActivity(db, stakeId, activityId);
    if (!activity) {
      throw new HttpsError("not-found", "Attività non trovata.");
    }

    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(
      Date.now() + PARENT_SELF_TOKEN_TTL_MINUTES * 60 * 1000,
    ).toISOString();
    const registrationRef = db.doc(
      `stakes/${stakeId}/activities/${activityId}/registrations/${registrationId}`,
    );

    // Come per ogni mail: in transazione sull'iscrizione si invalidano tutti
    // i link pendenti (readPendingTokens) e si annota il nuovo, così una mail
    // in volo non lascia un secondo link valido.
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(registrationRef);
      const { state, req } = assertCanIssueOwnToken(
        snapshot.exists ? snapshot.data() : null,
        uid,
      );
      const stale = await readPendingTokens(tx, db, {
        stakeId,
        activityId,
        registrationId,
        tokenId: annotatedTokenId(state),
      });

      const email = normalizeEmail(req.parentEmail);
      const parentFirstName = asString(req.parentFirstName).trim();
      const parentLastName = asString(req.parentLastName).trim();

      await invalidateTokens(tx, db, stale, {
        stakeId,
        activityId,
        registrationId,
        actorUserId: uid,
      });

      tx.set(db.doc(`parentAuthorizationTokens/${tokenHash}`), {
        id: tokenHash,
        tokenHash,
        stakeId,
        activityId,
        registrationId,
        parentEmail: email,
        participantName: asString(snapshot.data().fullName).trim(),
        activityTitle: asString(activity.title).trim(),
        activityStartDate: asString(activity.startDate),
        activityEndDate: asString(activity.endDate) || asString(activity.startDate),
        status: "pending",
        createdAt: nowIso(),
        expiresAt,
        usedAt: null,
        invalidatedAt: null,
        createdByUserId: uid,
        createdByMode: "self",
      });

      tx.set(
        registrationRef,
        {
          parentAuthorization: {
            ...(state || emptyParentAuthorizationState({
              parentEmail: email,
              parentName: `${parentFirstName} ${parentLastName}`.trim(),
              parentPhone: asString(req.parentPhone).trim(),
              expiresAt,
            })),
            tokenId: tokenHash,
            status: "pending_parent_authorization",
            parentEmail: email,
            parentFirstName,
            parentLastName,
            expiresAt,
            emailLastError: null,
            // Famiglia lo legge per dire "Riprendi da «Autorizza ora»": da qui
            // in poi il link della mail non vale più. Lo azzera ogni nuova mail.
            selfTokenIssuedAt: nowIso(),
            updatedAt: nowIso(),
          },
        },
        { merge: true },
      );

      await writeAuditLog(
        db,
        stakeId,
        activityId,
        registrationId,
        {
          tokenId: tokenHash,
          event: "token_issued_in_app",
          parentEmail: email,
          actorUserId: uid,
        },
        tx,
      );
    });

    return { ok: true, token: rawToken, expiresAt };
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
      return { status: "not_found", canSignInApp: false };
    }

    const status = deriveTokenStatus(token);

    if (status !== "valid") {
      return {
        status,
        activityTitle: token.activityTitle || "",
        participantName: token.participantName || "",
        canSignInApp: canSignInApp(request, token),
      };
    }

    // Link valido ma iscrizione annullata o cancellata: la pagina lo dice
    // subito, invece di far firmare e poi rifiutare.
    const registration = await loadRegistration(
      db,
      token.stakeId,
      token.activityId,
      token.registrationId,
    );
    // Stato "invalidated" con un motivo: le PWA già installate conoscono solo
    // gli stati di deriveTokenStatus e su uno nuovo andrebbero in errore.
    if (!registration || isCancelledRegistration(registration)) {
      return {
        status: "invalidated",
        reason: "registration_cancelled",
        activityTitle: token.activityTitle || "",
        participantName: token.participantName || "",
        canSignInApp: canSignInApp(request, token),
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
      // "self" = link di "Autorizza ora" (60 minuti): la pagina dice da dove
      // riprendere se la firma resta a metà.
      createdByMode: token.createdByMode || null,
      canSignInApp: canSignInApp(request, token),
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

    // Le due scelte su foto e social sono obbligatorie e si possono solo
    // acconsentire o rifiutare: "senza risposta" non è un consenso. Una scheda
    // aperta prima del rilascio manda ancora `not_answered`: riceve questo
    // errore e il client le chiede di ricaricare la pagina.
    const { photoConsent, socialPublicationConsent } = validateConsentChoices(
      request.data?.photoConsent,
      request.data?.socialPublicationConsent,
    );

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
    if (isCancelledRegistration(registration)) {
      throw new HttpsError("failed-precondition", CANCELLED_REGISTRATION_MESSAGE);
    }

    const activity = await loadActivity(db, stakeId, activityId);
    if (!activity) {
      throw new HttpsError("not-found", "Attività non trovata.");
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
      // signatureBuffer, non decoded: con firma riusata decoded è null e
      // comunque va salvata la versione sanificata (trim + alpha).
      await file.save(signatureBuffer, {
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

    // Link per cambiare le scelte su foto e social senza account: sta nella
    // copia firmata. Se non si riesce a crearlo la firma resta valida.
    let consentUrl = null;
    if (parentEmail) {
      try {
        const link = await issueConsentLink(db, {
          stakeId,
          activityId,
          registrationId,
          parentEmail,
          kind: "signed_copy",
        });
        consentUrl = buildConsentUrl(link.rawToken);
      } catch (error) {
        logger.error("Consent link creation failed.", {
          stakeId,
          activityId,
          registrationId,
          error: error.message,
        });
      }
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
          photoConsent,
          socialPublicationConsent,
          consentUrl,
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
      consentTextVersion: CONSENT_TEXT_VERSION,
      consentUpdatedAt: confirmedAt,
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

    await writeIfRegistrationActive(
      db,
      registrationRef,
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
      { token, usedAt: confirmedAt },
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
      consentTextVersion: CONSENT_TEXT_VERSION,
      consentVia: "signature",
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

    // Senza questa lettura il set(merge) qui sotto ricreava un'iscrizione
    // cancellata e spostava un'annullata in "rejected_by_parent".
    const registration = await loadRegistration(db, stakeId, activityId, registrationId);
    if (!registration) {
      throw new HttpsError("not-found", "Iscrizione associata non trovata.");
    }
    if (isCancelledRegistration(registration)) {
      throw new HttpsError("failed-precondition", CANCELLED_REGISTRATION_MESSAGE);
    }

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

    await writeIfRegistrationActive(
      db,
      registrationRef,
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
      { token, usedAt: rejectedAt },
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
// Cloud Function: reinvio admin o dirigente della stessa unità
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

    const registration = await loadRegistration(db, stakeId, activityId, registrationId);
    if (!registration) {
      throw new HttpsError("not-found", "Iscrizione non trovata.");
    }
    if (isCancelledRegistration(registration)) {
      throw new HttpsError("failed-precondition", CANCELLED_REGISTRATION_MESSAGE);
    }

    await assertCanResendParentAuthorization(
      db,
      request,
      stakeId,
      registration,
    );

    // Un'autorizzazione già decisa non si riapre con un reinvio: prima la
    // scrittura intermedia la rimetteva in attesa e la nuova mail ne
    // cancellava firma, PDF e consensi.
    assertParentAuthorizationOpen(registration.parentAuthorization?.status);

    const activity = await loadActivity(db, stakeId, activityId);
    if (!activity) {
      throw new HttpsError("not-found", "Attività non trovata.");
    }

    // Nessuna scrittura intermedia con `tokenId: null`: faceva ripartire il
    // trigger, che mandava una seconda mail con un secondo link valido.
    // L'emissione invalida tutti i link pendenti nella stessa transazione.
    const result = await sendInitialAuthorizationEmail({
      db,
      stakeId,
      activityId,
      registrationId,
      activity,
      actorUserId: request.auth.uid,
    });

    // Cancellata, annullata o decisa fra la prima lettura e la transazione.
    if (result.reason === "registration_missing") {
      throw new HttpsError("not-found", "Iscrizione non trovata.");
    }
    if (result.reason === "registration_cancelled") {
      throw new HttpsError("failed-precondition", CANCELLED_REGISTRATION_MESSAGE);
    }
    if (result.reason === "already_decided") {
      assertParentAuthorizationOpen(result.status);
    }
    // Prima tornava { sent: false } dopo aver invalidato il link: ora non si
    // tocca niente e l'admin legge cosa manca.
    if (result.reason === "missing_request_payload" || result.reason === "missing_parent_email") {
      throw new HttpsError("failed-precondition", MISSING_PARENT_DATA_MESSAGE);
    }

    if (result.tokenId && annotatedTokenId(registration.parentAuthorization)) {
      await writeAuditLog(db, stakeId, activityId, registrationId, {
        tokenId: result.tokenId,
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
  // Usati da parentConsent.js (cambio scelte e richiesta di completamento).
  consentHelpers: {
    BREVO_API_KEY,
    assertAdminForStake,
    buildConsentUrl,
    loadActivity,
    loadRegistration,
    normalizeEmail,
    writeAuditLog,
  },
  // Esportata per il test: decide se la richiesta va spostata su un'altra
  // casella (functions/tests/parentAuthorizationReissue.test.mjs).
  shouldReissueParentAuthorization,
  onRegistrationPendingParentAuth,
  parentAuthorizationGetContext,
  parentAuthorizationConfirm,
  parentAuthorizationReject,
  parentAuthorizationResend,
  parentAuthorizationIssueOwnToken,
  parentAuthorizationBackfillLegacyApprovals,
  parentAuthorizationGetSignedConsentUrl,
  parentAuthorizationDownloadSignedConsentsZip,
};
