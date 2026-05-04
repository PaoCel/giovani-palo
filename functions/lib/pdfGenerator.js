/**
 * Generatore PDF audit per autorizzazione genitoriale.
 * pdfkit lavora come stream: accumulo i chunk e ritorno un Buffer.
 */

const PDFDocument = require("pdfkit");
const { LEGAL_DOCS, PARENT_CONSENT_CHECKBOXES } = require("./legalDocs");
const { formatDateRangeIt } = require("./brevo");

function formatDateTimeIt(iso) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function describePhotoConsent(value) {
  switch (value) {
    case "accepted":
      return "ACCETTATO";
    case "refused":
      return "RIFIUTATO";
    case "revoked":
      return "REVOCATO";
    case "not_answered":
    default:
      return "Non risposto";
  }
}

function ensurePageSpace(doc, neededHeight) {
  if (doc.y + neededHeight > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function sectionHeading(doc, title) {
  ensurePageSpace(doc, 40);
  doc
    .moveDown(0.6)
    .fillColor("#142746")
    .font("Helvetica-Bold")
    .fontSize(13)
    .text(title);
  doc
    .moveTo(doc.x, doc.y + 2)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y + 2)
    .strokeColor("#cfd8e3")
    .lineWidth(0.6)
    .stroke();
  doc.moveDown(0.4);
  doc.font("Helvetica").fontSize(10.5).fillColor("#142746");
}

function labelValue(doc, label, value) {
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#4a5b78");
  doc.text(label, { continued: true });
  doc.font("Helvetica").fillColor("#142746").text(` ${value || "-"}`);
}

/**
 * Genera il PDF e ritorna un Buffer.
 *
 * @param {Object} payload
 * @param {Object} payload.activity - { title, startDate, endDate, location, activityType, overnight }
 * @param {Object} payload.participant - { fullName, birthDate, email, phone }
 * @param {Object} payload.parent - { firstName, lastName, email, phone }
 * @param {Object} payload.emergency - { name, phone, relation }
 * @param {Object} payload.medical - { allergies, medications, medicalNotes, dietaryNotes }
 * @param {Object} payload.consents - mappa booleana checkboxes
 * @param {string} payload.photoConsent - "accepted" | "refused" | "not_answered" | "revoked"
 * @param {string} payload.socialPublicationConsent
 * @param {Object} payload.legalVersions - { participation, privacy, photo }
 * @param {string} payload.confirmedAt - ISO timestamp
 * @param {string} payload.ipAddress
 * @param {string} payload.userAgent
 * @param {Buffer|null} payload.signaturePngBuffer - optional, immagine firma
 * @returns {Promise<Buffer>}
 */
async function generateParentAuthorizationPdf(payload) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      info: {
        Title: `Autorizzazione genitoriale - ${payload.activity.title}`,
        Author: "Sistema iscrizioni",
        Subject: "Audit autorizzazione partecipazione minore",
      },
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header
    doc
      .fillColor("#142746")
      .font("Helvetica-Bold")
      .fontSize(18)
      .text("Autorizzazione alla partecipazione del minore", {
        align: "center",
      });
    doc
      .moveDown(0.3)
      .font("Helvetica")
      .fontSize(11)
      .fillColor("#4a5b78")
      .text(
        "Documento generato automaticamente come riepilogo del consenso elettronico raccolto.",
        { align: "center" },
      );
    doc.moveDown(1);

    // Attivita'
    sectionHeading(doc, "Attivita'");
    labelValue(doc, "Titolo:", payload.activity.title);
    labelValue(
      doc,
      "Date:",
      formatDateRangeIt(payload.activity.startDate, payload.activity.endDate),
    );
    if (payload.activity.location) {
      labelValue(doc, "Luogo:", payload.activity.location);
    }
    if (payload.activity.activityType) {
      labelValue(doc, "Tipo:", payload.activity.activityType);
    }
    if (payload.activity.overnight) {
      labelValue(doc, "Pernottamento:", "Si");
    }

    // Partecipante
    sectionHeading(doc, "Partecipante");
    labelValue(doc, "Nome e cognome:", payload.participant.fullName);
    if (payload.participant.birthDate) {
      labelValue(
        doc,
        "Data di nascita:",
        new Intl.DateTimeFormat("it-IT").format(
          new Date(payload.participant.birthDate),
        ),
      );
    }
    if (payload.participant.email) {
      labelValue(doc, "Email partecipante:", payload.participant.email);
    }
    if (payload.participant.phone) {
      labelValue(doc, "Telefono partecipante:", payload.participant.phone);
    }

    // Genitore
    sectionHeading(doc, "Genitore o tutore (firmatario)");
    labelValue(
      doc,
      "Nome e cognome:",
      `${payload.parent.firstName} ${payload.parent.lastName}`.trim(),
    );
    labelValue(doc, "Email:", payload.parent.email);
    labelValue(doc, "Telefono:", payload.parent.phone);

    // Emergenza
    if (
      payload.emergency &&
      (payload.emergency.name || payload.emergency.phone)
    ) {
      sectionHeading(doc, "Contatto di emergenza");
      labelValue(doc, "Nome e cognome:", payload.emergency.name);
      labelValue(doc, "Telefono:", payload.emergency.phone);
      if (payload.emergency.relation) {
        labelValue(doc, "Relazione:", payload.emergency.relation);
      }
    }

    // Note mediche
    const hasMedical =
      payload.medical &&
      (payload.medical.allergies ||
        payload.medical.medications ||
        payload.medical.medicalNotes ||
        payload.medical.dietaryNotes);

    if (hasMedical) {
      sectionHeading(doc, "Note mediche e alimentari dichiarate");
      if (payload.medical.allergies) {
        labelValue(doc, "Allergie:", payload.medical.allergies);
      }
      if (payload.medical.medications) {
        labelValue(doc, "Farmaci:", payload.medical.medications);
      }
      if (payload.medical.medicalNotes) {
        labelValue(doc, "Note mediche:", payload.medical.medicalNotes);
      }
      if (payload.medical.dietaryNotes) {
        labelValue(doc, "Note alimentari:", payload.medical.dietaryNotes);
      }
    }

    // Consensi
    sectionHeading(doc, "Consensi accettati");
    const consents = payload.consents || {};
    for (const item of PARENT_CONSENT_CHECKBOXES) {
      const checked = consents[item.key] === true;
      ensurePageSpace(doc, 30);
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(checked ? "#1f7a3a" : "#b14e44")
        .text(checked ? "[X] " : "[ ] ", { continued: true });
      doc
        .font("Helvetica")
        .fillColor("#142746")
        .fontSize(10)
        .text(item.label, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right - 14 });
      doc.moveDown(0.2);
    }

    // Foto/social
    sectionHeading(doc, "Liberatoria foto e video (consensi facoltativi)");
    labelValue(
      doc,
      "Foto/video uso interno:",
      describePhotoConsent(payload.photoConsent),
    );
    labelValue(
      doc,
      "Pubblicazione su canali pubblici:",
      describePhotoConsent(payload.socialPublicationConsent),
    );

    // Versioni documenti
    sectionHeading(doc, "Versioni dei documenti accettati");
    const versions = payload.legalVersions || {};
    labelValue(
      doc,
      "Autorizzazione partecipazione:",
      versions.participation || LEGAL_DOCS.participation.version,
    );
    labelValue(
      doc,
      "Informativa privacy:",
      versions.privacy || LEGAL_DOCS.privacy.version,
    );
    labelValue(
      doc,
      "Liberatoria foto:",
      versions.photo || LEGAL_DOCS.photo.version,
    );

    // Firma
    if (payload.signaturePngBuffer && Buffer.isBuffer(payload.signaturePngBuffer)) {
      sectionHeading(doc, "Firma elettronica del genitore");
      ensurePageSpace(doc, 110);
      try {
        doc.image(payload.signaturePngBuffer, {
          fit: [220, 80],
          align: "left",
        });
      } catch (imageError) {
        doc
          .fontSize(9)
          .fillColor("#b14e44")
          .text(
            `Firma non rappresentabile nel PDF (${imageError.message}).`,
          );
      }
      doc.moveDown(0.4);
      doc
        .fontSize(9)
        .fillColor("#6b7894")
        .text(
          "Firma elettronica semplice, raccolta tramite procedura elettronica con link inviato all'email del genitore.",
        );
    }

    // Audit
    sectionHeading(doc, "Audit del consenso");
    labelValue(doc, "Data e ora conferma:", formatDateTimeIt(payload.confirmedAt));
    labelValue(doc, "IP rilevato:", payload.ipAddress || "non disponibile");
    labelValue(
      doc,
      "User-Agent rilevato:",
      payload.userAgent
        ? payload.userAgent.length > 110
          ? `${payload.userAgent.slice(0, 110)}...`
          : payload.userAgent
        : "non disponibile",
    );
    labelValue(doc, "Provider email:", "Brevo (Sendinblue SAS)");
    doc
      .moveDown(0.4)
      .fontSize(9)
      .fillColor("#6b7894")
      .text(
        "Il presente consenso e' stato raccolto tramite procedura elettronica con link unico inviato " +
          "all'indirizzo email dichiarato del genitore. La firma elettronica raccolta e' considerata " +
          "firma elettronica semplice ai sensi del Regolamento eIDAS (910/2014/UE) e del CAD italiano. " +
          "Documento prodotto automaticamente dal sistema, non richiede sottoscrizione.",
      );

    doc.end();
  });
}

module.exports = {
  generateParentAuthorizationPdf,
};
