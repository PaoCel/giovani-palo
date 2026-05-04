/**
 * Client Brevo Transactional Email API.
 * Doc: https://developers.brevo.com/reference/sendtransacemail
 *
 * Usa fetch nativo Node 22+. Niente SDK Brevo (evita dipendenza in piu'
 * solo per chiamare un singolo endpoint REST).
 */

const {
  BREVO_API_URL,
  BREVO_SENDER_EMAIL,
  BREVO_SENDER_NAME,
  BREVO_REPLY_TO_EMAIL,
  BREVO_REPLY_TO_NAME,
  SUPPORT_CONTACT_TEXT,
} = require("./config");

class BrevoError extends Error {
  constructor(message, statusCode, body) {
    super(message);
    this.name = "BrevoError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateRangeIt(startIso, endIso) {
  const safeStart = startIso ? new Date(startIso) : null;
  const safeEnd = endIso ? new Date(endIso) : null;

  if (!safeStart || Number.isNaN(safeStart.getTime())) {
    return "data da definire";
  }

  const formatter = new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  if (
    safeEnd &&
    !Number.isNaN(safeEnd.getTime()) &&
    formatter.format(safeStart) !== formatter.format(safeEnd)
  ) {
    return `${formatter.format(safeStart)} - ${formatter.format(safeEnd)}`;
  }

  return formatter.format(safeStart);
}

function buildAuthorizationEmailHtml({
  parentName,
  participantName,
  activityTitle,
  activityDateRange,
  activityLocation,
  authorizationUrl,
  expirationFormatted,
}) {
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(`Autorizzazione richiesta per ${activityTitle}`)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f7fa;font-family:Arial,Helvetica,sans-serif;color:#142746;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid rgba(20,39,70,0.08);">
          <tr>
            <td style="padding:28px 32px 16px 32px;">
              <h1 style="margin:0 0 8px 0;font-size:22px;line-height:1.3;color:#142746;">Autorizzazione richiesta</h1>
              <p style="margin:0;font-size:15px;line-height:1.5;color:#4a5b78;">
                Gentile ${escapeHtml(parentName) || "genitore o tutore"},<br />
                ti scriviamo per chiederti di autorizzare la partecipazione di
                <strong>${escapeHtml(participantName)}</strong>
                all'attivita' indicata di seguito.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 8px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7fc;border-radius:10px;border:1px solid rgba(20,39,70,0.08);">
                <tr>
                  <td style="padding:16px 18px;">
                    <p style="margin:0 0 6px 0;font-size:13px;color:#4a5b78;text-transform:uppercase;letter-spacing:0.04em;">Attivita'</p>
                    <p style="margin:0 0 14px 0;font-size:17px;font-weight:700;color:#142746;">${escapeHtml(activityTitle)}</p>
                    <p style="margin:0 0 4px 0;font-size:14px;color:#4a5b78;">
                      <strong>Date:</strong> ${escapeHtml(activityDateRange)}
                    </p>
                    ${
                      activityLocation
                        ? `<p style="margin:0;font-size:14px;color:#4a5b78;"><strong>Luogo:</strong> ${escapeHtml(activityLocation)}</p>`
                        : ""
                    }
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 8px 32px;">
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.5;color:#142746;">
                Per autorizzare la partecipazione apri il link qui sotto e completa la procedura.
                Ti chiederemo di confermare alcuni consensi e di apporre una firma elettronica.
                Ci vorranno circa 2 minuti.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="background-color:#266ec4;border-radius:8px;">
                    <a href="${authorizationUrl}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;">Apri il link di autorizzazione</a>
                  </td>
                </tr>
              </table>
              <p style="margin:18px 0 0 0;font-size:13px;color:#6b7894;text-align:center;">
                Se il pulsante non funziona, copia e incolla questo indirizzo nel browser:<br />
                <a href="${authorizationUrl}" style="color:#266ec4;word-break:break-all;">${authorizationUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px;">
              <p style="margin:0;font-size:13px;line-height:1.5;color:#6b7894;">
                <strong>Importante:</strong> il link e' personale, non condividerlo con altre persone.
                Scade il <strong>${escapeHtml(expirationFormatted)}</strong>.
                Se ricevi questa email per errore o non sei il genitore o tutore, ignorala.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px 28px 32px;border-top:1px solid rgba(20,39,70,0.08);">
              <p style="margin:0;font-size:13px;line-height:1.5;color:#6b7894;">
                ${escapeHtml(SUPPORT_CONTACT_TEXT)}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildAuthorizationEmailText({
  parentName,
  participantName,
  activityTitle,
  activityDateRange,
  activityLocation,
  authorizationUrl,
  expirationFormatted,
}) {
  return [
    `Gentile ${parentName || "genitore o tutore"},`,
    "",
    `ti scriviamo per chiederti di autorizzare la partecipazione di ${participantName} all'attivita' indicata di seguito.`,
    "",
    `Attivita': ${activityTitle}`,
    `Date: ${activityDateRange}`,
    activityLocation ? `Luogo: ${activityLocation}` : "",
    "",
    "Per autorizzare la partecipazione apri questo link e completa la procedura:",
    authorizationUrl,
    "",
    `Il link e' personale, non condividerlo. Scade il ${expirationFormatted}.`,
    "",
    SUPPORT_CONTACT_TEXT,
  ]
    .filter(Boolean)
    .join("\n");
}

async function sendParentAuthorizationEmail({
  apiKey,
  parentEmail,
  parentName,
  participantName,
  activityTitle,
  activityStartDate,
  activityEndDate,
  activityLocation,
  authorizationUrl,
  expiresAt,
}) {
  if (!apiKey) {
    throw new BrevoError("BREVO_API_KEY non configurata.", 0, null);
  }

  const activityDateRange = formatDateRangeIt(activityStartDate, activityEndDate);
  const expirationFormatted = expiresAt
    ? new Intl.DateTimeFormat("it-IT", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(expiresAt))
    : "data scadenza non disponibile";

  const subject = `Autorizzazione richiesta per ${activityTitle}`;

  const htmlContent = buildAuthorizationEmailHtml({
    parentName,
    participantName,
    activityTitle,
    activityDateRange,
    activityLocation,
    authorizationUrl,
    expirationFormatted,
  });

  const textContent = buildAuthorizationEmailText({
    parentName,
    participantName,
    activityTitle,
    activityDateRange,
    activityLocation,
    authorizationUrl,
    expirationFormatted,
  });

  const payload = {
    sender: { email: BREVO_SENDER_EMAIL, name: BREVO_SENDER_NAME },
    to: [{ email: parentEmail, name: parentName || parentEmail }],
    replyTo: { email: BREVO_REPLY_TO_EMAIL, name: BREVO_REPLY_TO_NAME },
    subject,
    htmlContent,
    textContent,
    tags: ["parent-authorization"],
  };

  const response = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new BrevoError(
      `Brevo API error ${response.status}: ${text || response.statusText}`,
      response.status,
      text,
    );
  }

  const result = await response.json().catch(() => ({}));
  return {
    messageId:
      typeof result.messageId === "string" ? result.messageId : null,
    provider: "brevo",
  };
}

module.exports = {
  sendParentAuthorizationEmail,
  BrevoError,
  formatDateRangeIt,
};
