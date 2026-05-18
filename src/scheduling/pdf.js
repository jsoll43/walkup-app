import { FIELD_OPTIONS, STATUS_META, formatDateInput, formatLongDate, formatTimeLabel } from "./utils.js";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 48;
const MARGIN_TOP = 54;
const MARGIN_BOTTOM = 48;

function escapePdfText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r/g, "")
    .replace(/\n/g, " ");
}

function formatMonthTitle(monthText) {
  const [yearText, monthOnlyText] = String(monthText || "").split("-");
  const year = Number(yearText);
  const month = Number(monthOnlyText);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return monthText;
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function formatEtStamp(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function getMonthDates(monthText) {
  if (!/^\d{4}-\d{2}$/.test(String(monthText || ""))) return [];
  const [yearText, monthOnlyText] = monthText.split("-");
  const year = Number(yearText);
  const month = Number(monthOnlyText);
  const current = new Date(year, month - 1, 1);
  const dates = [];

  while (current.getFullYear() === year && current.getMonth() === month - 1) {
    dates.push(formatDateInput(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

function getStatusLabel(item) {
  const status =
    item?.kind === "request"
      ? item?.status === "approved" || item?.status === "denied"
        ? item.status
        : item?.displayStatus || (item?.hasConflict ? "conflict" : "pending")
      : item?.displayStatus || "approved";

  return STATUS_META[status]?.label || "Approved";
}

function getFieldLabel(fieldValue) {
  return FIELD_OPTIONS.find((option) => option.value === fieldValue)?.label || String(fieldValue || "Field");
}

function sortItems(items) {
  return [...items].sort((a, b) => {
    const dateCompare = String(a.date || "").localeCompare(String(b.date || ""));
    if (dateCompare !== 0) return dateCompare;

    const fieldCompare = String(a.field || "").localeCompare(String(b.field || ""));
    if (fieldCompare !== 0) return fieldCompare;

    const startCompare = String(a.startTime || "").localeCompare(String(b.startTime || ""));
    if (startCompare !== 0) return startCompare;

    return String(a.title || a.team || "").localeCompare(String(b.title || b.team || ""));
  });
}

function wrapText(text, maxChars) {
  const cleanText = String(text || "").trim();
  if (!cleanText) return [""];
  if (cleanText.length <= maxChars) return [cleanText];

  const words = cleanText.split(/\s+/);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
      current = word;
      continue;
    }

    lines.push(word.slice(0, maxChars));
    current = word.slice(maxChars);
  }

  if (current) lines.push(current);
  return lines;
}

function buildMonthLines(monthText, items, generatedAt) {
  const monthDates = getMonthDates(monthText);
  const filteredItems = sortItems(
    (items || []).filter((item) => String(item?.date || "").startsWith(`${monthText}-`))
  );

  const lines = [
    { text: `BGSL Field Scheduling - ${formatMonthTitle(monthText)}`, size: 18, bold: true, indent: 0 },
    { text: `Up to date as of ${generatedAt}`, size: 11, bold: false, indent: 0 },
    { text: "", size: 10, bold: false, indent: 0 },
  ];

  for (const date of monthDates) {
    lines.push({ text: formatLongDate(date), size: 13, bold: true, indent: 0 });

    for (const field of FIELD_OPTIONS) {
      lines.push({ text: getFieldLabel(field.value), size: 11, bold: true, indent: 1 });

      const fieldItems = filteredItems.filter((item) => item.date === date && item.field === field.value);
      if (fieldItems.length === 0) {
        lines.push({ text: "No reservations", size: 10, bold: false, indent: 2 });
        continue;
      }

      for (const item of fieldItems) {
        const label = String(item?.title || "").trim() || String(item?.team || "").trim() || "Reservation";
        const status = getStatusLabel(item);
        lines.push({
          text: `${formatTimeLabel(item.startTime)}  ${label}  [${status}]`,
          size: 10,
          bold: false,
          indent: 2,
        });
      }
    }

    lines.push({ text: "", size: 8, bold: false, indent: 0 });
  }

  return lines;
}

function paginateLines(lines) {
  const pages = [];
  let currentPage = [];
  let currentY = PAGE_HEIGHT - MARGIN_TOP;

  function startNewPage() {
    if (currentPage.length > 0) pages.push(currentPage);
    currentPage = [];
    currentY = PAGE_HEIGHT - MARGIN_TOP;
  }

  for (const line of lines) {
    const fontSize = line.size || 11;
    const lineHeight = fontSize + 4;
    const x = MARGIN_X + (line.indent || 0) * 18;
    const maxChars = Math.max(20, Math.floor((PAGE_WIDTH - MARGIN_X - x) / (fontSize * 0.52)));
    const wrapped = wrapText(line.text, maxChars);
    const requiredHeight = wrapped.length * lineHeight + (line.text ? 0 : 4);

    if (currentY - requiredHeight < MARGIN_BOTTOM) {
      startNewPage();
    }

    if (!line.text) {
      currentY -= 8;
      continue;
    }

    for (const wrappedLine of wrapped) {
      currentPage.push({
        text: wrappedLine,
        size: fontSize,
        bold: !!line.bold,
        x,
        y: currentY,
      });
      currentY -= lineHeight;
    }
  }

  if (currentPage.length > 0) pages.push(currentPage);
  return pages;
}

function buildPdfBlobFromPages(pages) {
  const encoder = new TextEncoder();
  const objects = [];

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  const pageObjectIds = [];
  let nextObjectId = 5;

  for (const page of pages) {
    const pageId = nextObjectId;
    const contentId = nextObjectId + 1;
    nextObjectId += 2;

    const stream = page
      .map((line) => {
        const fontRef = line.bold ? "F2" : "F1";
        return `BT /${fontRef} ${line.size} Tf 1 0 0 1 ${line.x} ${line.y} Tm (${escapePdfText(line.text)}) Tj ET`;
      })
      .join("\n");

    const streamBytes = encoder.encode(stream);
    objects[contentId] = `<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    pageObjectIds.push(pageId);
  }

  objects[2] = `<< /Type /Pages /Count ${pageObjectIds.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] >>`;

  const objectIds = Object.keys(objects)
    .map(Number)
    .sort((a, b) => a - b);

  let pdf = "%PDF-1.4\n";
  const offsets = [];

  for (const id of objectIds) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objectIds.length + 1}\n`;
  pdf += "0000000000 65535 f \n";

  for (const id of objectIds) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objectIds.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

export function downloadSchedulingMonthPdf({ month, items, now = new Date() }) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ""))) {
    throw new Error("Choose a valid month for the PDF export.");
  }

  const lines = buildMonthLines(month, items, formatEtStamp(now));
  const pages = paginateLines(lines);
  const blob = buildPdfBlobFromPages(pages);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `field-schedule-${month}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
