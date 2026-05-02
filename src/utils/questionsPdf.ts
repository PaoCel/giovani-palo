import { jsPDF } from "jspdf";

import type { Event, Question } from "@/types";
import { formatDateRange, formatDateTime } from "@/utils/formatters";

interface QuestionsPdfArgs {
  event: Event;
  questions: Question[];
}

export function downloadQuestionsPdf({ event, questions }: QuestionsPdfArgs) {
  const visible = questions.filter((question) => question.status === "active");
  const doc = new jsPDF();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 16;
  const contentWidth = 178;
  let y = 20;

  function ensureSpace(neededLines: number) {
    if (y + neededLines * 6 > pageHeight - 18) {
      doc.addPage();
      y = 20;
    }
  }

  function writeWrapped(text: string, fontStyle: "normal" | "bold" | "italic" = "normal") {
    doc.setFont("helvetica", fontStyle);
    const lines = doc.splitTextToSize(text || "-", contentWidth);
    ensureSpace(lines.length);
    doc.text(lines, marginX, y);
    y += lines.length * 6;
  }

  doc.setFont("times", "bold");
  doc.setFontSize(20);
  doc.text("Domande per il caminetto", marginX, y);
  y += 9;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  writeWrapped(event.title, "bold");
  writeWrapped(`${formatDateRange(event.startDate, event.endDate)} - ${event.location || "-"}`);
  y += 4;

  doc.setFont("helvetica", "italic");
  doc.setFontSize(10);
  writeWrapped(
    `Domande inviate: ${visible.length}. Le domande contrassegnate "Anonima" non riportano l'autore.`,
    "italic",
  );
  y += 4;

  if (visible.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    writeWrapped("Nessuna domanda da mostrare.");
  } else {
    doc.setFontSize(11);

    visible.forEach((question, index) => {
      const number = `${index + 1}.`;
      const author = question.isAnonymous
        ? "Anonima"
        : question.authorName?.trim() || "Senza nome";
      const meta = `${number} ${author} - ${formatDateTime(question.createdAt)}`;

      ensureSpace(2);
      doc.setFont("helvetica", "bold");
      const metaLines = doc.splitTextToSize(meta, contentWidth);
      doc.text(metaLines, marginX, y);
      y += metaLines.length * 6;

      doc.setFont("helvetica", "normal");
      const bodyLines = doc.splitTextToSize(question.text || "-", contentWidth);
      ensureSpace(bodyLines.length);
      doc.text(bodyLines, marginX, y);
      y += bodyLines.length * 6 + 4;
    });
  }

  doc.save(`domande-${event.slug || event.id}.pdf`);
}
