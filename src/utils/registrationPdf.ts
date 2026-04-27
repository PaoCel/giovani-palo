import { jsPDF } from "jspdf";

import type { Event, EventFormConfig, Registration } from "@/types";
import { formatDateRange } from "@/utils/formatters";
import { getRegistrationAnswerEntries } from "@/utils/registrations";

interface RegistrationPdfArgs {
  event: Event;
  registration: Registration;
  formConfig: EventFormConfig;
}

export function downloadRegistrationPdf({
  event,
  registration,
  formConfig,
}: RegistrationPdfArgs) {
  const doc = new jsPDF();
  const answerEntries = getRegistrationAnswerEntries(formConfig, registration);
  let y = 18;

  function writeLine(label: string, value: string) {
    doc.setFont("helvetica", "bold");
    doc.text(label, 16, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(value || "-", 178);
    doc.text(lines, 16, y);
    y += lines.length * 6 + 2;
  }

  doc.setFont("times", "bold");
  doc.setFontSize(20);
  doc.text("Riepilogo iscrizione", 16, y);
  y += 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  writeLine("Attivita", event.title);
  writeLine("Date", formatDateRange(event.startDate, event.endDate));
  writeLine("Luogo", event.location);
  writeLine("Nome completo", registration.fullName);
  writeLine("Email", registration.email);
  writeLine("Telefono", registration.phone || "-");
  writeLine("Codice iscrizione", registration.accessCode || "-");

  for (const entry of answerEntries) {
    if (y > 265) {
      doc.addPage();
      y = 18;
    }

    writeLine(entry.label, entry.value);
  }

  doc.save(`iscrizione-${event.slug || event.id}.pdf`);
}
