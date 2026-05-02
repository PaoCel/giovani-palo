import { jsPDF } from "jspdf";

import type { Event, Question } from "@/types";
import { formatDateRange } from "@/utils/formatters";

interface QuestionsPdfArgs {
  event: Event;
  questions: Question[];
}

export function downloadQuestionsPdf({ event, questions }: QuestionsPdfArgs) {
  const visible = questions.filter((question) => question.status === "active");
  const doc = new jsPDF();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 20;
  const contentWidth = doc.internal.pageSize.getWidth() - marginX * 2;
  const lineHeight = 7;
  const questionGap = 6;
  let y = 24;

  function ensureSpace(neededHeight: number) {
    if (y + neededHeight > pageHeight - 20) {
      doc.addPage();
      y = 24;
    }
  }

  doc.setFont("times", "bold");
  doc.setFontSize(22);
  doc.text("Domande per il caminetto", marginX, y);
  y += 11;

  doc.setFont("times", "italic");
  doc.setFontSize(13);
  const subtitle = `${event.title} - ${formatDateRange(event.startDate, event.endDate)}${event.location ? ` - ${event.location}` : ""}`;
  const subtitleLines = doc.splitTextToSize(subtitle, contentWidth);
  doc.text(subtitleLines, marginX, y);
  y += subtitleLines.length * 7 + 6;

  doc.setDrawColor(180);
  doc.line(marginX, y, marginX + contentWidth, y);
  y += 8;

  if (visible.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.text("Nessuna domanda da mostrare.", marginX, y);
    doc.save(`domande-${event.slug || event.id}.pdf`);
    return;
  }

  doc.setFontSize(12);

  visible.forEach((question, index) => {
    const number = `${index + 1}.`;
    const numberWidth = doc.getTextWidth(`${number} `);
    const textIndent = marginX + numberWidth;
    const textWidth = contentWidth - numberWidth;
    const namedAuthor =
      !question.isAnonymous && question.authorName?.trim() ? question.authorName.trim() : null;

    const bodyLines = doc.splitTextToSize(question.text || "-", textWidth);
    const namedHeight = namedAuthor ? lineHeight : 0;
    const blockHeight = namedHeight + bodyLines.length * lineHeight + questionGap;
    ensureSpace(blockHeight);

    doc.setFont("helvetica", "bold");
    doc.text(number, marginX, y);

    if (namedAuthor) {
      doc.setFont("helvetica", "italic");
      doc.text(namedAuthor, textIndent, y);
      y += lineHeight;
    }

    doc.setFont("helvetica", "normal");
    doc.text(bodyLines, textIndent, y);
    y += bodyLines.length * lineHeight + questionGap;
  });

  doc.save(`domande-${event.slug || event.id}.pdf`);
}
