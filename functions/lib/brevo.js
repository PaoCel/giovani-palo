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

function buildRegistrationSenderName(participantName) {
  const name = String(participantName || "").trim();
  return name ? `Registrazione - ${name} GU - GD` : BREVO_SENDER_NAME;
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
<body style="margin:0;padding:0;background-color:#eef3f8;font-family:Arial,Helvetica,sans-serif;color:#18324f;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    Conferma i dati e firma il modulo per ${escapeHtml(participantName)}. Il link scade il ${escapeHtml(expirationFormatted)}.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef3f8;padding:28px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:94%;background-color:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #dbe5ee;box-shadow:0 12px 34px rgba(24,50,79,0.12);">
          <tr>
            <td style="background-color:#18324f;padding:22px 30px;color:#ffffff;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="margin:0 0 4px 0;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#b9d5f1;">Piattaforma attività per Giovani Uomini e Giovani Donne in Italia</p>
                    <p style="margin:0;font-size:21px;line-height:1.25;font-weight:700;color:#ffffff;">Autorizzazione attività</p>
                  </td>
                  <td align="right" style="font-size:12px;color:#dce9f6;">Link sicuro via email</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 34px 12px 34px;">
              <p style="margin:0 0 10px 0;font-size:15px;line-height:1.55;color:#53677d;">Ciao ${escapeHtml(parentName) || "genitore o tutore"},</p>
              <h1 style="margin:0 0 12px 0;font-size:27px;line-height:1.22;color:#18324f;">Serve la tua firma per autorizzare ${escapeHtml(participantName)}</h1>
              <p style="margin:0;font-size:16px;line-height:1.6;color:#53677d;">
                Abbiamo preparato il modulo con i dati inseriti in fase di iscrizione.
                Apri il link, controlla che sia tutto corretto e firma nel riquadro.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 34px 8px 34px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7fafc;border-radius:14px;border:1px solid #dbe5ee;">
                <tr>
                  <td style="padding:18px 20px;">
                    <p style="margin:0 0 8px 0;font-size:12px;color:#6a7e93;text-transform:uppercase;letter-spacing:0.08em;">Attività</p>
                    <p style="margin:0 0 12px 0;font-size:19px;font-weight:700;color:#18324f;">${escapeHtml(activityTitle)}</p>
                    <p style="margin:0 0 5px 0;font-size:14px;line-height:1.45;color:#53677d;">
                      <strong>Date:</strong> ${escapeHtml(activityDateRange)}
                    </p>
                    ${
                      activityLocation
                        ? `<p style="margin:0;font-size:14px;line-height:1.45;color:#53677d;"><strong>Luogo:</strong> ${escapeHtml(activityLocation)}</p>`
                        : ""
                    }
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 34px 8px 34px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fff8ec;border-radius:14px;border:1px solid #f0d9b4;">
                <tr>
                  <td style="padding:16px 18px;font-size:14px;line-height:1.55;color:#644510;">
                    <strong>Cosa devi fare:</strong> apri il link, verifica i dati del modulo,
                    scegli i consensi foto/video e firma. Di solito richiede meno di 2 minuti.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 34px 12px 34px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color:#276fbf;border-radius:10px;">
                    <a href="${authorizationUrl}" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;">Apri e firma il modulo</a>
                  </td>
                </tr>
              </table>
              <p style="margin:16px 0 0 0;font-size:12px;line-height:1.5;color:#6a7e93;text-align:center;">
                Se il pulsante non funziona, copia e incolla questo indirizzo nel browser:<br />
                <a href="${authorizationUrl}" style="color:#276fbf;word-break:break-all;">${authorizationUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 34px 28px 34px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="50%" style="padding:12px 12px 12px 0;border-top:1px solid #edf2f7;font-size:13px;line-height:1.5;color:#53677d;">
                    <strong style="color:#18324f;">Link personale</strong><br />
                    Non inoltrare questa email. Il link scade il ${escapeHtml(expirationFormatted)}.
                  </td>
                  <td width="50%" style="padding:12px 0 12px 12px;border-top:1px solid #edf2f7;font-size:13px;line-height:1.5;color:#53677d;">
                    <strong style="color:#18324f;">Dopo la firma</strong><br />
                    Riceverai una copia PDF del modulo firmato via email.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 34px 26px 34px;background-color:#f7fafc;border-top:1px solid #dbe5ee;">
              <p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;color:#53677d;">
                ${escapeHtml(SUPPORT_CONTACT_TEXT)}
              </p>
              <p style="margin:0;font-size:11px;line-height:1.45;color:#7c8da0;">
                Piattaforma sviluppata e gestita a titolo personale dal titolare individuale.
                Non è una piattaforma ufficiale della Chiesa di Gesù Cristo dei Santi degli
                Ultimi Giorni né di altra organizzazione religiosa.
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
    `ti scriviamo per chiederti di autorizzare la partecipazione di ${participantName} all'attività indicata di seguito.`,
    "",
    `Attività: ${activityTitle}`,
    `Date: ${activityDateRange}`,
    activityLocation ? `Luogo: ${activityLocation}` : "",
    "",
    "Per autorizzare la partecipazione apri questo link e completa la procedura:",
    authorizationUrl,
    "",
    `Il link è personale, non condividerlo. Scade il ${expirationFormatted}.`,
    "",
    SUPPORT_CONTACT_TEXT,
    "",
    "---",
    "Piattaforma sviluppata e gestita a titolo personale dal titolare individuale.",
    "Non è una piattaforma ufficiale della Chiesa di Gesù Cristo dei Santi degli Ultimi Giorni né di altra organizzazione religiosa.",
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
    sender: {
      email: BREVO_SENDER_EMAIL,
      name: buildRegistrationSenderName(participantName),
    },
    to: [{ email: parentEmail, name: parentName || parentEmail }],
    replyTo: { email: BREVO_REPLY_TO_EMAIL, name: BREVO_REPLY_TO_NAME },
    subject,
    htmlContent,
    textContent,
    tags: ["parent-authorization"],
    // Disabilita open + click tracking per migliorare deliverability:
    // il pixel tracking 1x1 senza alt costa -0.5 sul mail-tester e per
    // l'autorizzazione genitore non serve la metrica "email aperta".
    headers: {
      "X-Mailin-Track-Opens": "0",
      "X-Mailin-Track-Clicks": "0",
      "X-Track-Opens": "0",
      "X-Track-Clicks": "0",
    },
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

function buildSignedAuthorizationCopyHtml({
  recipientName,
  participantName,
  activityTitle,
}) {
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(`Modulo firmato per ${activityTitle}`)}</title>
</head>
<body style="margin:0;padding:0;background-color:#eef3f8;font-family:Arial,Helvetica,sans-serif;color:#18324f;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    Il PDF firmato per ${escapeHtml(participantName)} è allegato a questa email.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef3f8;padding:28px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:94%;background-color:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #dbe5ee;box-shadow:0 12px 34px rgba(24,50,79,0.12);">
          <tr>
            <td style="background-color:#18324f;padding:22px 30px;color:#ffffff;">
              <p style="margin:0 0 4px 0;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#b9d5f1;">Piattaforma attività per Giovani Uomini e Giovani Donne in Italia</p>
              <p style="margin:0;font-size:21px;line-height:1.25;font-weight:700;color:#ffffff;">Modulo firmato</p>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 34px 12px 34px;">
              <p style="margin:0 0 10px 0;font-size:15px;line-height:1.55;color:#53677d;">Grazie ${escapeHtml(recipientName) || ""},</p>
              <h1 style="margin:0 0 12px 0;font-size:27px;line-height:1.22;color:#18324f;">La firma è stata registrata</h1>
              <p style="margin:0;font-size:16px;line-height:1.6;color:#53677d;">
                In allegato trovi il modulo "Consenso e informazioni mediche" compilato
                e firmato per <strong>${escapeHtml(participantName)}</strong>, insieme
                al documento "Condotta durante le attività della Chiesa".
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 34px 8px 34px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7fafc;border-radius:14px;border:1px solid #dbe5ee;">
                <tr>
                  <td style="padding:18px 20px;">
                    <p style="margin:0 0 8px 0;font-size:12px;color:#6a7e93;text-transform:uppercase;letter-spacing:0.08em;">Attività</p>
                    <p style="margin:0;font-size:19px;font-weight:700;color:#18324f;">${escapeHtml(activityTitle)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 34px 12px 34px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#edf8f0;border-radius:14px;border:1px solid #cde9d4;">
                <tr>
                  <td style="padding:16px 18px;font-size:14px;line-height:1.55;color:#205a32;">
                    Gli organizzatori ricevono una copia degli stessi documenti. Conserva
                    questa email per i tuoi archivi e tieni a portata di mano anche il
                    regolamento allegato.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 34px 28px 34px;">
              <p style="margin:0;font-size:13px;line-height:1.55;color:#53677d;">
                Nota: gli eventuali consensi foto/video selezionati nella pagina sono registrati
                separatamente nella piattaforma. Quando sarà disponibile un modulo ufficiale
                dedicato, potremo allegare anche quello.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 34px 26px 34px;background-color:#f7fafc;border-top:1px solid #dbe5ee;">
              <p style="margin:0;font-size:11px;line-height:1.45;color:#7c8da0;">
                Piattaforma sviluppata e gestita a titolo personale dal titolare individuale.
                Non è una piattaforma ufficiale della Chiesa di Gesù Cristo dei Santi degli
                Ultimi Giorni né di altra organizzazione religiosa.
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

function buildSignedAuthorizationCopyText({
  recipientName,
  participantName,
  activityTitle,
}) {
  return [
    `Gentile ${recipientName || "genitore o tutore"},`,
    "",
    `in allegato trovi il modulo "Consenso e informazioni mediche" firmato per ${participantName} e per l'attività ${activityTitle}.`,
    "Trovi anche il documento separato \"Condotta durante le attività della Chiesa\".",
    "Gli organizzatori ricevono una copia degli stessi documenti.",
    "",
    "---",
    "Piattaforma sviluppata e gestita a titolo personale dal titolare individuale.",
    "Non è una piattaforma ufficiale della Chiesa di Gesù Cristo dei Santi degli Ultimi Giorni né di altra organizzazione religiosa.",
  ].join("\n");
}

async function sendSignedAuthorizationCopyEmail({
  apiKey,
  parentEmail,
  parentName,
  participantName,
  activityTitle,
  pdfBuffer,
  pdfFilename,
  conductPdfBuffer,
  conductPdfFilename,
}) {
  if (!apiKey) {
    throw new BrevoError("BREVO_API_KEY non configurata.", 0, null);
  }

  if (!parentEmail || !pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
    throw new BrevoError("Parametri email modulo firmato incompleti.", 0, null);
  }

  const subject = `Modulo firmato - ${activityTitle}`;
  const htmlContent = buildSignedAuthorizationCopyHtml({
    recipientName: parentName || parentEmail,
    participantName,
    activityTitle,
  });
  const textContent = buildSignedAuthorizationCopyText({
    recipientName: parentName || parentEmail,
    participantName,
    activityTitle,
  });

  const bcc =
    BREVO_REPLY_TO_EMAIL && BREVO_REPLY_TO_EMAIL !== parentEmail
      ? [{ email: BREVO_REPLY_TO_EMAIL, name: BREVO_REPLY_TO_NAME }]
      : undefined;

  const payload = {
    sender: {
      email: BREVO_SENDER_EMAIL,
      name: buildRegistrationSenderName(participantName),
    },
    to: [{ email: parentEmail, name: parentName || parentEmail }],
    ...(bcc ? { bcc } : {}),
    replyTo: { email: BREVO_REPLY_TO_EMAIL, name: BREVO_REPLY_TO_NAME },
    subject,
    htmlContent,
    textContent,
    attachment: [
      {
        name: pdfFilename || "modulo-consenso-firmato.pdf",
        content: pdfBuffer.toString("base64"),
      },
      ...(conductPdfBuffer && Buffer.isBuffer(conductPdfBuffer)
        ? [
            {
              name: conductPdfFilename || "condotta-attivita-chiesa.pdf",
              content: conductPdfBuffer.toString("base64"),
            },
          ]
        : []),
    ],
    tags: ["parent-authorization-copy"],
    headers: {
      "X-Mailin-Track-Opens": "0",
      "X-Mailin-Track-Clicks": "0",
      "X-Track-Opens": "0",
      "X-Track-Clicks": "0",
    },
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
  sendSignedAuthorizationCopyEmail,
  BrevoError,
  formatDateRangeIt,
};
