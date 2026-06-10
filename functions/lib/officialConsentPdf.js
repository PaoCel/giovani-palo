/**
 * Compilazione del modulo ufficiale "Consenso e informazioni mediche".
 *
 * Il template è un AcroForm: usiamo i campi esistenti per i dati principali
 * e disegniamo la firma PNG sopra il campo firma corretto.
 */

const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { formatDateRangeIt } = require("./brevo");

const TEMPLATE_PATH = path.join(
  __dirname,
  "..",
  "assets",
  "parent-consent-template.pdf",
);

function asString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function compact(value) {
  return asString(value).replace(/\s+/g, " ").trim();
}

function truncate(value, maxLength) {
  const text = compact(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function formatDateIt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("it-IT").format(date);
}

function calculateAge(birthDate, referenceDate) {
  if (!birthDate) return "";
  const birth = new Date(birthDate);
  const reference = referenceDate ? new Date(referenceDate) : new Date();
  if (Number.isNaN(birth.getTime()) || Number.isNaN(reference.getTime())) return "";

  let age = reference.getFullYear() - birth.getFullYear();
  const monthDelta = reference.getMonth() - birth.getMonth();
  if (
    monthDelta < 0 ||
    (monthDelta === 0 && reference.getDate() < birth.getDate())
  ) {
    age -= 1;
  }
  return age >= 0 ? String(age) : "";
}

function isMinorBirthDate(birthDate, referenceDate) {
  const age = Number(calculateAge(birthDate, referenceDate));
  return Number.isFinite(age) && age < 18;
}

function drawText(page, font, value, x, y, options = {}) {
  const text = truncate(value, options.maxLength || 120);
  if (!text) return;

  page.drawText(text, {
    x,
    y,
    size: options.size || 8,
    font,
    color: rgb(0, 0, 0),
  });
}

function drawMultilineText(page, font, value, x, y, options = {}) {
  const text = compact(value);
  if (!text) return;

  const maxChars = options.maxChars || 90;
  const maxLines = options.maxLines || 2;
  const words = text.split(" ");
  const lines = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);

  lines.forEach((line, index) => {
    page.drawText(truncate(line, maxChars), {
      x,
      y: y - index * (options.lineHeight || 9),
      size: options.size || 7,
      font,
      color: rgb(0, 0, 0),
    });
  });
}

function drawCheck(page, font, x, y, checked) {
  if (!checked) return;
  page.drawText("X", {
    x,
    y,
    size: 8,
    font,
    color: rgb(0, 0, 0),
  });
}

function getBooleanByText(value) {
  return compact(value).length > 0;
}

function getMedicalSummary(payload) {
  const parts = [];
  const medical = payload.medical || {};

  if (medical.medications) {
    parts.push(`Farmaci: ${compact(medical.medications)}`);
  }
  if (medical.medicalNotes) {
    parts.push(`Note mediche: ${compact(medical.medicalNotes)}`);
  }
  if (medical.dietaryNotes) {
    parts.push(`Note alimentari: ${compact(medical.dietaryNotes)}`);
  }
  if (medical.allergies) {
    parts.push(`Allergie: ${compact(medical.allergies)}`);
  }

  return parts.join(" | ");
}

async function drawSignature(pdfDoc, payload, signaturePngBuffer) {
  const pages = pdfDoc.getPages();
  const firstPage = pages[0];
  if (!firstPage) return;

  const isMinor = isMinorBirthDate(
    payload.participant.birthDate,
    payload.activity.startDate || payload.confirmedAt,
  );

  const target = isMinor
    ? { x: 38, y: 27, width: 190, height: 20 }
    : { x: 38, y: 49, width: 190, height: 20 };

  if (
    signaturePngBuffer &&
    Buffer.isBuffer(signaturePngBuffer) &&
    signaturePngBuffer.length >= 500
  ) {
    let signatureImage = null;
    try {
      signatureImage = await pdfDoc.embedPng(signaturePngBuffer);
    } catch (error) {
      signatureImage = null;
    }

    if (signatureImage) {
      firstPage.drawImage(signatureImage, {
        x: target.x,
        y: target.y,
        width: target.width,
        height: target.height,
      });
      return;
    }
  }

  const typedSignature = compact(payload.signatureText);
  if (!typedSignature) return;

  const signatureFont = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
  firstPage.drawText(truncate(typedSignature, 44), {
    x: target.x + 4,
    y: target.y + 5,
    size: 13,
    font: signatureFont,
    color: rgb(0, 0, 0),
  });

}

async function generateOfficialConsentPdf(payload) {
  const templateBytes = fs.readFileSync(TEMPLATE_PATH);
  const pdfDoc = await PDFDocument.load(templateBytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const pages = pdfDoc.getPages();
  const firstPage = pages[0];
  if (!firstPage) {
    throw new Error("Template modulo consenso senza prima pagina.");
  }
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const activity = payload.activity || {};
  const participant = payload.participant || {};
  const parent = payload.parent || {};
  const emergency = payload.emergency || {};
  const medical = payload.medical || {};
  const organization = payload.organization || {};

  drawText(firstPage, helvetica, activity.title, 38, 648, { maxLength: 78 });
  drawText(
    firstPage,
    helvetica,
    formatDateRangeIt(activity.startDate, activity.endDate),
    402,
    648,
    { maxLength: 36 },
  );
  drawMultilineText(
    firstPage,
    helvetica,
    activity.description || activity.publicNotes,
    38,
    632,
    { maxChars: 120, maxLines: 2, size: 7 },
  );
  drawText(firstPage, helvetica, participant.unitName || organization.unitName, 38, 604, {
    maxLength: 54,
  });
  drawText(firstPage, helvetica, organization.stakeName || activity.stakeName, 294, 604, {
    maxLength: 58,
  });
  drawText(firstPage, helvetica, organization.leaderName, 38, 582, { maxLength: 36 });
  drawText(firstPage, helvetica, organization.leaderPhone, 204, 582, { maxLength: 40 });
  drawText(firstPage, helvetica, organization.leaderEmail, 401, 582, { maxLength: 40 });

  drawText(firstPage, helvetica, participant.fullName, 38, 544, { maxLength: 60 });
  drawText(firstPage, helvetica, formatDateIt(participant.birthDate), 309, 544, {
    maxLength: 24,
  });
  drawText(
    firstPage,
    helvetica,
    calculateAge(participant.birthDate, activity.startDate || payload.confirmedAt),
    443,
    544,
    { maxLength: 5 },
  );
  drawText(firstPage, helvetica, participant.phone, 38, 522, { maxLength: 55 });
  drawText(firstPage, helvetica, participant.address, 38, 501, { maxLength: 50 });
  drawText(firstPage, helvetica, participant.city, 307, 501, { maxLength: 30 });
  drawText(firstPage, helvetica, participant.stateOrProvince || "Italia", 450, 501, {
    maxLength: 26,
  });

  const emergencyName =
    emergency.name ||
    `${parent.firstName || ""} ${parent.lastName || ""}`.trim();
  drawText(firstPage, helvetica, emergencyName, 38, 478, { maxLength: 38 });
  drawText(firstPage, helvetica, emergency.phone || parent.phone, 207, 478, {
    maxLength: 38,
  });
  drawText(firstPage, helvetica, emergency.secondaryPhone, 397, 478, {
    maxLength: 34,
  });

  const hasDietaryNotes = getBooleanByText(medical.dietaryNotes);
  drawCheck(firstPage, helvetica, 38, 442, hasDietaryNotes);
  drawCheck(firstPage, helvetica, 56, 442, !hasDietaryNotes);
  drawText(firstPage, helvetica, medical.dietaryNotes, 255, 441, {
    size: 7,
    maxLength: 82,
  });

  const hasAllergies = getBooleanByText(medical.allergies);
  drawCheck(firstPage, helvetica, 38, 418, hasAllergies);
  drawCheck(firstPage, helvetica, 56, 418, !hasAllergies);
  drawText(firstPage, helvetica, medical.allergies, 255, 417, {
    size: 7,
    maxLength: 82,
  });

  drawText(firstPage, helvetica, medical.medications, 38, 392, {
    size: 7,
    maxLength: 135,
  });
  drawCheck(firstPage, helvetica, 38, 370, true);

  const hasChronicNotes = getBooleanByText(medical.medicalNotes);
  drawCheck(firstPage, helvetica, 38, 330, hasChronicNotes);
  drawCheck(firstPage, helvetica, 56, 330, !hasChronicNotes);
  drawText(firstPage, helvetica, medical.medicalNotes, 267, 329, {
    size: 7,
    maxLength: 75,
  });

  drawCheck(firstPage, helvetica, 56, 297, true);
  drawMultilineText(firstPage, helvetica, getMedicalSummary(payload), 38, 268, {
    size: 7,
    maxChars: 120,
    maxLines: 2,
  });
  const isMinor = isMinorBirthDate(participant.birthDate, activity.startDate || payload.confirmedAt);
  if (isMinor) {
    drawText(firstPage, helvetica, "Firma elettronica apposta", 238, 34, {
      size: 6,
      maxLength: 42,
    });
    drawText(firstPage, helvetica, formatDateIt(payload.confirmedAt), 444, 34, {
      maxLength: 20,
    });
  } else {
    drawText(firstPage, helvetica, "Firma elettronica apposta", 238, 56, {
      size: 6,
      maxLength: 42,
    });
    drawText(firstPage, helvetica, formatDateIt(payload.confirmedAt), 444, 56, {
      maxLength: 20,
    });
  }

  await drawSignature(pdfDoc, payload, payload.signaturePngBuffer);
  while (pdfDoc.getPageCount() > 1) {
    pdfDoc.removePage(1);
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

async function generateChurchActivityConductPdf() {
  const templateBytes = fs.readFileSync(TEMPLATE_PATH);
  const templateDoc = await PDFDocument.load(templateBytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const conductDoc = await PDFDocument.create();
  const [conductPage] = await conductDoc.copyPages(templateDoc, [1]);
  conductDoc.addPage(conductPage);
  conductDoc.setTitle("Condotta durante le attivita della Chiesa");
  conductDoc.setAuthor("Piattaforma attivita giovani");

  const pdfBytes = await conductDoc.save();
  return Buffer.from(pdfBytes);
}

module.exports = {
  generateOfficialConsentPdf,
  generateChurchActivityConductPdf,
  isMinorBirthDate,
};
