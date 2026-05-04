/**
 * Configurazione lato server per il flusso di autorizzazione genitoriale.
 *
 * Niente segreti qui dentro: la BREVO_API_KEY vive in Secret Manager
 * (defineSecret in lib/parentAuthorization.js).
 *
 * Per cambiare URL o sender modifica i valori qui sotto e ridepoia le functions.
 */

const REGION = "europe-west1";

// URL pubblico dell'app frontend, usato per costruire i magic link.
const APP_PUBLIC_URL = "https://gugditalia.it";

// Sender email transazionale Brevo (deve corrispondere a un sender verificato).
const BREVO_SENDER_EMAIL = "noreply@gugditalia.it";
const BREVO_SENDER_NAME = "gugditalia";

// Reply-to: dove vanno le risposte del genitore se preme "rispondi".
const BREVO_REPLY_TO_EMAIL = "supporto@gugditalia.it";
const BREVO_REPLY_TO_NAME = "Supporto gugditalia";

// Testo di supporto mostrato in email + pagina genitore.
const SUPPORT_CONTACT_TEXT =
  "Per assistenza contatta il dirigente della tua unita'.";

// Scadenza token magic-link in giorni.
const PARENT_AUTHORIZATION_TOKEN_TTL_DAYS = 14;

// Endpoint Brevo Transactional Email.
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

// Storage path per PDF audit + firme genitore.
const STORAGE_PATH_PARENT_AUTH_PDF = (stakeId, activityId, registrationId) =>
  `protected/stakes/${stakeId}/activities/${activityId}/parent-authorization-pdfs/${registrationId}`;

const STORAGE_PATH_PARENT_AUTH_SIGNATURE = (
  stakeId,
  activityId,
  registrationId,
) =>
  `protected/stakes/${stakeId}/activities/${activityId}/parent-authorization-signatures/${registrationId}`;

module.exports = {
  REGION,
  APP_PUBLIC_URL,
  BREVO_SENDER_EMAIL,
  BREVO_SENDER_NAME,
  BREVO_REPLY_TO_EMAIL,
  BREVO_REPLY_TO_NAME,
  SUPPORT_CONTACT_TEXT,
  PARENT_AUTHORIZATION_TOKEN_TTL_DAYS,
  BREVO_API_URL,
  STORAGE_PATH_PARENT_AUTH_PDF,
  STORAGE_PATH_PARENT_AUTH_SIGNATURE,
};
