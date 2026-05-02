import { jsPDF } from "jspdf";

import type { Event, Registration } from "@/types";
import { formatDateOnly, formatDateRange } from "@/utils/formatters";

export type ConsentPdfKind = "parental" | "photo";

interface ConsentPdfArgs {
  event: Event;
  registration: Registration;
  kind: ConsentPdfKind;
  signatureDataUrl?: string | null;
}

const PARENTAL_TITLE = "Consenso e informazioni mediche";
const PHOTO_TITLE = "Liberatoria per l'uso delle immagini";

const PARENTAL_BODY = [
  "Documento basato sul modulo della Chiesa di Gesu Cristo dei Santi degli Ultimi Giorni \"Consenso e informazioni mediche\" (versione 3/25), richiesto per gli eventi che prevedono pernottamento, viaggi al di fuori della propria zona o rischi superiori al normale (Manuale generale 20.5.5, 20.7.4, 20.7.7).",
  "Concedo a mio figlio o a chi sono tutore il permesso di partecipare all'evento e alle attivita previste e autorizzo i dirigenti adulti che supervisionano l'evento a somministrare il trattamento di emergenza al partecipante in caso di incidenti o malattie e ad agire in mia vece nell'approvare le necessarie cure mediche. L'autorizzazione vale anche per il viaggio da/per l'evento.",
  "Le informazioni mediche fornite (allergie, restrizioni alimentari, farmaci, condizioni di salute, note utili) saranno consultate solo dai dirigenti dell'evento o dal personale medico, se necessario, per intervenire in modo appropriato. Saranno trattate con riservatezza.",
  "Comprendo che le unita potrebbero non poter soddisfare ogni esigenza medica, fisica o di altro tipo: i dirigenti si confronteranno con me se servono accorgimenti specifici. Il partecipante e responsabile della propria condotta e si attiene alle norme della Chiesa, alle regole di sicurezza dell'evento e alle indicazioni dei dirigenti. La partecipazione e un privilegio che puo essere revocato in caso di comportamento inappropriato o di rischio.",
];

const PHOTO_BODY = [
  "Documento basato sulla \"Liberatoria per l'uso delle immagini\" della Chiesa di Gesu Cristo dei Santi degli Ultimi Giorni (Intellectual Reserve, Inc. - IRI), modulo IPO 37077 160.",
  "Il concedente concede irrevocabilmente all'IRI e ai suoi licenziatari, successori e aventi diritto il consenso e i pieni diritti di registrare, copiare, riprodurre, adattare, pubblicare, esibire, distribuire ed eseguire le immagini, le interviste e qualsiasi materiale reso disponibile, in qualsiasi pubblicazione o mezzo (libri, riviste, internet, video, televisione, cinema), con o senza credito al concedente.",
  "Se il concedente e minorenne, il genitore o tutore dichiara di avere la piena autorita per perfezionare la liberatoria a nome del minore e firma per suo conto.",
  "Il concedente non avra diritto, titolo o interesse in alcuna opera o pubblicazione realizzata dall'IRI in virtu di questa liberatoria. Tutte le condizioni complete (incluse le informazioni sulla legge applicabile - Stato dello Utah - e sulle controversie) sono riportate nel testo originale del modulo IRI 37077 160.",
];

export function downloadConsentPdf({
  event,
  registration,
  kind,
  signatureDataUrl,
}: ConsentPdfArgs) {
  const doc = new jsPDF();
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 18;
  const contentWidth = pageWidth - marginX * 2;
  let y = 20;

  function ensureSpace(needed: number) {
    if (y + needed > pageHeight - 20) {
      doc.addPage();
      y = 20;
    }
  }

  function writeWrapped(text: string, fontStyle: "normal" | "bold" | "italic" = "normal", size = 11) {
    doc.setFont("helvetica", fontStyle);
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text || "-", contentWidth);
    ensureSpace(lines.length * (size * 0.45));
    doc.text(lines, marginX, y);
    y += lines.length * (size * 0.5) + 2;
  }

  // Title
  doc.setFont("times", "bold");
  doc.setFontSize(18);
  doc.text(kind === "parental" ? PARENTAL_TITLE : PHOTO_TITLE, marginX, y);
  y += 9;

  // Subtitle
  doc.setFont("helvetica", "italic");
  doc.setFontSize(10);
  doc.text(
    "Versione PDF compilata automaticamente in base ai dati dell'iscrizione",
    marginX,
    y,
  );
  y += 7;

  doc.setDrawColor(180);
  doc.line(marginX, y, marginX + contentWidth, y);
  y += 6;

  // Section: Dati attivita
  writeWrapped("Dati dell'attivita", "bold", 12);
  writeWrapped(`Titolo: ${event.title}`);
  writeWrapped(`Date: ${formatDateRange(event.startDate, event.endDate)}`);
  writeWrapped(`Luogo: ${event.location || "-"}`);
  if (event.program) {
    writeWrapped(`Programma: ${event.program}`);
  }

  y += 3;

  // Section: Partecipante
  writeWrapped("Partecipante", "bold", 12);
  writeWrapped(`Nome e cognome: ${registration.fullName}`);
  if (registration.birthDate) {
    writeWrapped(`Data di nascita: ${formatDateOnly(registration.birthDate)}`);
  }
  if (registration.unitNameSnapshot) {
    writeWrapped(`Unita: ${registration.unitNameSnapshot}`);
  }
  if (registration.email) {
    writeWrapped(`Email: ${registration.email}`);
  }
  if (registration.phone) {
    writeWrapped(`Telefono: ${registration.phone}`);
  }

  y += 3;

  // Genitore (only for parental kind)
  if (kind === "parental") {
    const signerName =
      typeof registration.answers.parentalConsentSignerName === "string"
        ? registration.answers.parentalConsentSignerName.trim()
        : "";
    const acceptedAt =
      typeof registration.answers.parentalConsentAcceptedAt === "string"
        ? registration.answers.parentalConsentAcceptedAt
        : "";

    writeWrapped("Genitore o tutore", "bold", 12);
    writeWrapped(`Nome: ${signerName || "(da compilare)"}`);
    writeWrapped(
      `Consenso accettato: ${
        registration.answers.parentalConsentAccepted === true ? "Si" : "No"
      }${acceptedAt ? ` - ${formatDateOnly(acceptedAt)}` : ""}`,
    );
    y += 3;
  } else {
    const signerName =
      typeof registration.answers.photoReleaseSignerName === "string"
        ? registration.answers.photoReleaseSignerName.trim()
        : "";
    const acceptedAt =
      typeof registration.answers.photoReleaseAcceptedAt === "string"
        ? registration.answers.photoReleaseAcceptedAt
        : "";

    writeWrapped("Concedente / firmatario", "bold", 12);
    writeWrapped(`Nome: ${signerName || "(da compilare)"}`);
    writeWrapped(
      `Liberatoria accettata: ${
        registration.answers.photoReleaseAccepted === true ? "Si" : "No"
      }${acceptedAt ? ` - ${formatDateOnly(acceptedAt)}` : ""}`,
    );
    y += 3;
  }

  // Body text
  writeWrapped("Testo del consenso", "bold", 12);
  const body = kind === "parental" ? PARENTAL_BODY : PHOTO_BODY;
  for (const paragraph of body) {
    writeWrapped(paragraph, "normal", 10);
    y += 1;
  }

  // Signature
  ensureSpace(46);
  y += 4;
  writeWrapped("Firma del genitore o tutore", "bold", 12);

  if (signatureDataUrl) {
    try {
      const sigWidth = 70;
      const sigHeight = 28;
      ensureSpace(sigHeight + 8);
      doc.addImage(signatureDataUrl, "PNG", marginX, y, sigWidth, sigHeight);
      y += sigHeight + 4;
    } catch {
      writeWrapped("(firma non disponibile)", "italic", 10);
    }
  } else {
    doc.setDrawColor(120);
    doc.line(marginX, y + 14, marginX + 90, y + 14);
    y += 18;
    writeWrapped("(firma da apporre)", "italic", 10);
  }

  writeWrapped(`Data: ${formatDateOnly(new Date().toISOString())}`, "normal", 10);

  doc.save(`${kind === "parental" ? "consenso-genitore" : "liberatoria-immagini"}-${registration.id}.pdf`);
}
