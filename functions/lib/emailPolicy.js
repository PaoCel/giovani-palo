/**
 * Filtro destinatari e marcatura degli ambienti non di produzione.
 *
 * Funzioni pure: la politica (getEmailPolicy in ./config) viene passata da
 * fuori, così si provano senza variabili d'ambiente.
 *
 * Regola: fuori da produzione una email esce solo se OGNI destinatario è
 * nell'allowlist (To e BCC valutati uno per uno). Se nessun To resta, la mail
 * è "simulata": non parte niente, nemmeno verso i BCC ammessi.
 */

function normalizeAddress(address) {
  return String(address || "").trim().toLowerCase();
}

// Un solo indirizzo semplice. `parentEmail` arriva dal client senza validazione:
// senza questo filtro "vittima@gmail.com,x@dominio" supererebbe una voce
// "@dominio" (conta solo ciò che segue l'ultima @) e a Brevo partirebbe la
// stringa intera.
const SINGLE_ADDRESS = /^[^\s@,;<>"()[\]\\:]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** Indirizzo esatto, oppure "@dominio" che ammette tutto il dominio. */
function isAllowed(allowlist, address) {
  const normalized = normalizeAddress(address);
  if (!SINGLE_ADDRESS.test(normalized)) return false;
  const at = normalized.lastIndexOf("@");
  if (at < 1) return false;
  const domainEntry = normalized.slice(at);
  const entries = allowlist.map(normalizeAddress);
  return entries.includes(normalized) || entries.includes(domainEntry);
}

/**
 * @param {{allowlist: string[]|null}} policy
 * @param {{to: Array<{email: string, name?: string}>, bcc?: Array<{email: string, name?: string}>}} recipients
 * @returns {{simulated: boolean, to: Array, bcc: Array, suppressed: number}}
 */
function planDelivery(policy, { to = [], bcc = [] }) {
  // Solo `null` (produzione) lascia passare tutto. Un'allowlist assente o
  // malformata fuori da produzione vale "lista vuota": non esce niente.
  if (policy.allowlist === null) {
    return { simulated: false, to, bcc, suppressed: 0 };
  }
  const allowlist = Array.isArray(policy.allowlist) ? policy.allowlist : [];

  // A Brevo va l'indirizzo normalizzato, quello che ha superato il controllo.
  const normalize = (recipient) => ({ ...recipient, email: normalizeAddress(recipient.email) });
  const allowedTo = to.filter((recipient) => isAllowed(allowlist, recipient.email)).map(normalize);
  const allowedBcc = bcc.filter((recipient) => isAllowed(allowlist, recipient.email)).map(normalize);
  const suppressed = to.length - allowedTo.length + (bcc.length - allowedBcc.length);

  if (allowedTo.length === 0) {
    return { simulated: true, to: [], bcc: [], suppressed: to.length + bcc.length };
  }
  return { simulated: false, to: allowedTo, bcc: allowedBcc, suppressed };
}

const ENVIRONMENT_NOTICE =
  "Ambiente di prova: questo messaggio non è reale e non produce effetti sulle attività vere.";

/**
 * Marca oggetto e corpo di una mail non di produzione. In produzione ritorna
 * il messaggio invariato.
 */
function decorateMessage(policy, { subject, htmlContent, textContent }) {
  if (policy.isProduction) {
    return { subject, htmlContent, textContent };
  }

  const banner =
    '<div style="margin:0 0 16px;padding:10px 14px;border-radius:12px;background:#fff4d6;color:#6b4a00;font:600 13px/1.4 sans-serif;">' +
    ENVIRONMENT_NOTICE +
    "</div>";
  const bodyTag = /<body[^>]*>/i;

  return {
    subject: `${policy.subjectPrefix}${subject}`,
    htmlContent: bodyTag.test(htmlContent)
      ? htmlContent.replace(bodyTag, (match) => `${match}${banner}`)
      : `${banner}${htmlContent}`,
    textContent: `${ENVIRONMENT_NOTICE}\n\n${textContent}`,
  };
}

/** Indirizzo mascherato per i log (niente PII intera di un genitore). */
function maskAddress(address) {
  const normalized = normalizeAddress(address);
  const at = normalized.lastIndexOf("@");
  if (at < 1) return "***";
  return `${normalized[0]}***${normalized.slice(at)}`;
}

module.exports = { isAllowed, planDelivery, decorateMessage, maskAddress, ENVIRONMENT_NOTICE };
