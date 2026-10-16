/**
 * Logica pura dei consensi foto e social del genitore (nessun accesso a
 * Firestore, così si prova senza emulatori) e piccoli helper per i link di
 * gestione delle scelte, che non richiedono un account.
 *
 * Valori memorizzati su `parentAuthorization.photoConsent` e
 * `socialPublicationConsent`:
 *   accepted     il genitore ha acconsentito
 *   refused      il genitore ha detto no fin dall'inizio
 *   revoked      prima sì, ora no
 *   not_answered firma raccolta prima dell'obbligo di risposta: vale come
 *                NESSUN consenso (decisione C1-a del 2026-10-16)
 *
 * Il modulo e il cambio di scelta accettano solo `accepted` o `refused`.
 */

const crypto = require("crypto");
const { HttpsError } = require("firebase-functions/v2/https");

// Versione del testo mostrato accanto alle due domande. Va incrementata se il
// testo delle domande o dell'informativa foto cambia (src/constants/legalDocs.ts).
const CONSENT_TEXT_VERSION = "v2-2026-10";

const CHOICE_REQUIRED_MESSAGE = "Scegli una risposta per le foto e per i social";
const SOCIAL_NEEDS_PHOTO_MESSAGE =
  "Per pubblicare sui social serve anche il consenso alle foto";

// I link di gestione delle scelte restano validi un anno: la revoca deve
// restare possibile anche a distanza di mesi dall'attività.
const CONSENT_LINK_TTL_DAYS = 365;

function isChoice(value) {
  return value === "accepted" || value === "refused";
}

/**
 * Valida le due risposte arrivate dal client. Lancia `invalid-argument` con un
 * messaggio italiano se manca una risposta o se la combinazione è incoerente.
 * `details.reason` permette al client nuovo di distinguere i due casi.
 */
function validateConsentChoices(photoConsent, socialPublicationConsent) {
  if (!isChoice(photoConsent) || !isChoice(socialPublicationConsent)) {
    throw new HttpsError("invalid-argument", CHOICE_REQUIRED_MESSAGE, {
      reason: "consent_required",
    });
  }
  if (socialPublicationConsent === "accepted" && photoConsent !== "accepted") {
    throw new HttpsError("invalid-argument", SOCIAL_NEEDS_PHOTO_MESSAGE, {
      reason: "social_needs_photo",
    });
  }
  return { photoConsent, socialPublicationConsent };
}

/** Valore da salvare dato quello precedente e la scelta nuova (accepted|refused). */
function nextStoredValue(previous, choice) {
  if (choice === "accepted") return "accepted";
  // "Non acconsento" dopo un sì è una revoca; un revoked resta tale.
  if (previous === "accepted" || previous === "revoked") return "revoked";
  return "refused";
}

/**
 * Calcola l'effetto di un cambio di scelte sullo stato esistente.
 * @returns {{
 *   photoConsent: string, socialPublicationConsent: string,
 *   previousPhotoConsent: string, previousSocialPublicationConsent: string,
 *   changed: boolean, photoRevoked: boolean, socialRevoked: boolean
 * }}
 */
function resolveConsentUpdate(existing, input) {
  const choices = validateConsentChoices(
    input?.photoConsent,
    input?.socialPublicationConsent,
  );
  const previousPhoto = normalizeStored(existing?.photoConsent);
  const previousSocial = normalizeStored(existing?.socialPublicationConsent);
  const photoConsent = nextStoredValue(previousPhoto, choices.photoConsent);
  const socialPublicationConsent = nextStoredValue(
    previousSocial,
    choices.socialPublicationConsent,
  );
  return {
    photoConsent,
    socialPublicationConsent,
    previousPhotoConsent: previousPhoto,
    previousSocialPublicationConsent: previousSocial,
    changed:
      photoConsent !== previousPhoto || socialPublicationConsent !== previousSocial,
    photoRevoked: previousPhoto === "accepted" && photoConsent === "revoked",
    socialRevoked: previousSocial === "accepted" && socialPublicationConsent === "revoked",
  };
}

function normalizeStored(value) {
  return value === "accepted" || value === "refused" || value === "revoked"
    ? value
    : "not_answered";
}

/** True se la scelta manca (firma raccolta prima dell'obbligo). */
function isUnanswered(value) {
  return normalizeStored(value) === "not_answered";
}

function consentLabel(value) {
  return normalizeStored(value) === "accepted" ? "Acconsento" : "Non acconsento";
}

// -----------------------------------------------------------------------------
// Link di gestione delle scelte (senza account)
// -----------------------------------------------------------------------------

function hashLinkToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function computeConsentLinkExpiry(now = new Date()) {
  const expiry = new Date(now.getTime());
  expiry.setDate(expiry.getDate() + CONSENT_LINK_TTL_DAYS);
  return expiry.toISOString();
}

/**
 * Crea un link di gestione per l'iscrizione e ritorna il token in chiaro (solo
 * qui: in archivio resta l'hash). I link precedenti restano validi: le vecchie
 * email devono continuare a funzionare.
 */
async function issueConsentLink(db, { stakeId, activityId, registrationId, parentEmail, kind }) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const hash = hashLinkToken(rawToken);
  const createdAt = new Date().toISOString();
  const expiresAt = computeConsentLinkExpiry();
  await db.doc(`parentConsentLinks/${hash}`).set({
    tokenHash: hash,
    stakeId,
    activityId,
    registrationId,
    parentEmail: String(parentEmail || "").trim().toLowerCase(),
    kind,
    createdAt,
    expiresAt,
  });
  return { rawToken, expiresAt };
}

/** Stato del link: valid | expired | not_found | mismatch (mail del genitore cambiata). */
function deriveConsentLinkStatus(link, registration, now = new Date()) {
  if (!link) return "not_found";
  if (!registration) return "not_found";
  if (link.invalidatedAt) return "not_found";
  const expiry = link.expiresAt ? new Date(link.expiresAt) : null;
  if (!expiry || Number.isNaN(expiry.getTime()) || expiry.getTime() <= now.getTime()) {
    return "expired";
  }
  const currentEmail = String(registration.parentAuthorization?.parentEmail || "")
    .trim()
    .toLowerCase();
  if (!currentEmail || currentEmail !== link.parentEmail) return "mismatch";
  return "valid";
}

module.exports = {
  CONSENT_TEXT_VERSION,
  CHOICE_REQUIRED_MESSAGE,
  SOCIAL_NEEDS_PHOTO_MESSAGE,
  CONSENT_LINK_TTL_DAYS,
  validateConsentChoices,
  nextStoredValue,
  resolveConsentUpdate,
  isUnanswered,
  consentLabel,
  hashLinkToken,
  computeConsentLinkExpiry,
  issueConsentLink,
  deriveConsentLinkStatus,
};
