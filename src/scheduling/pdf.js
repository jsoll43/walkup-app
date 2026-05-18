import { STATUS_META, formatDateInput, formatTimeLabel } from "./utils.js";

const PAGE_WIDTH = 792;
const PAGE_HEIGHT = 612;
const MARGIN_X = 24;
const MARGIN_TOP = 24;
const MARGIN_BOTTOM = 24;
const HEADER_HEIGHT = 52;
const WEEKDAY_HEIGHT = 22;
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const COLORS = {
  page: [1, 1, 1],
  gridBorder: [0.78, 0.82, 0.88],
  headerFill: [0.95, 0.97, 0.99],
  currentMonthFill: [1, 1, 1],
  outsideMonthFill: [0.97, 0.98, 0.99],
  title: [0.04, 0.12, 0.22],
  bodyText: [0.12, 0.18, 0.27],
  mutedText: [0.49, 0.56, 0.64],
};

const STATUS_COLORS = {
  approved: {
    fill: [0.88, 0.97, 0.91],
    border: [0.58, 0.84, 0.66],
    text: [0.08, 0.32, 0.19],
  },
  pending: {
    fill: [0.99, 0.94, 0.79],
    border: [0.95, 0.82, 0.42],
    text: [0.47, 0.24, 0.05],
  },
  conflict: {
    fill: [0.99, 0.89, 0.89],
    border: [0.95, 0.65, 0.65],
    text: [0.63, 0.11, 0.11],
  },
  maintenance: {
    fill: [0.9, 0.92, 0.95],
    border: [0.63, 0.69, 0.76],
    text: [0.16, 0.2, 0.28],
  },
  removal_requested: {
    fill: [0.99, 0.91, 0.93],
    border: [0.95, 0.64, 0.71],
    text: [0.58, 0.11, 0.23],
  },
  denied: {
    fill: [0.92, 0.94, 0.96],
    border: [0.79, 0.84, 0.88],
    text: [0.29, 0.35, 0.42],
  },
};

function escapePdfText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r/g, "")
    .replace(/\n/g, " ");
}

function formatNumber(value) {
  return Number(value).toFixed(3).replace(/\.?0+$/, "");
}

function formatEtStamp(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function parseMonth(monthText) {
  if (!/^\d{4}-\d{2}$/.test(String(monthText || ""))) return null;
  const [yearText, monthOnlyText] = String(monthText).split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthOnlyText) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) return null;
  return { year, monthIndex };
}

function formatMonthTitle({ year, monthIndex }) {
  return new Date(year, monthIndex, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function getCalendarGridDates({ year, monthIndex }) {
  const firstOfMonth = new Date(year, monthIndex, 1);
  const start = new Date(firstOfMonth);
  start.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const next = new Date(start);
    next.setDate(start.getDate() + index);
    return next;
  });
}

function estimateTextWidth(text, size) {
  return String(text || "").length * size * 0.52;
}

function truncateText(text, maxWidth, size) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  if (estimateTextWidth(raw, size) <= maxWidth) return raw;

  let output = raw;
  while (output.length > 1 && estimateTextWidth(`${output}...`, size) > maxWidth) {
    output = output.slice(0, -1);
  }
  return `${output.trimEnd()}...`;
}

function getStatusKey(item) {
  if (item?.kind === "request") {
    if (item?.status === "approved" || item?.status === "denied") return item.status;
    return item?.displayStatus || (item?.hasConflict ? "conflict" : "pending");
  }
  return item?.displayStatus || "approved";
}

function getStatusSuffix(status) {
  const label = STATUS_META[status]?.label || "Approved";
  if (label === "Approved") return "";
  if (label === "Pending Approval") return "Pending";
  if (label === "Maintenance / Blocked") return "Blocked";
  if (label === "Removal Requested") return "Removal";
  return label;
}

function getFieldShortLabel(fieldValue) {
  return fieldValue === "major" ? "Major" : "Minor";
}

function getItemLabel(item) {
  return String(item?.title || "").trim() || String(item?.team || "").trim() || "Reservation";
}

function buildDayEntries(items, cellWidth, cellHeight) {
  const sortedItems = [...(items || [])].sort((a, b) => {
    const timeCompare = String(a.startTime || "").localeCompare(String(b.startTime || ""));
    if (timeCompare !== 0) return timeCompare;
    const fieldCompare = String(a.field || "").localeCompare(String(b.field || ""));
    if (fieldCompare !== 0) return fieldCompare;
    return getItemLabel(a).localeCompare(getItemLabel(b));
  });

  const entryFontSize = 6.4;
  const maxTextWidth = Math.max(42, cellWidth - 12);
  const availableHeight = Math.max(24, cellHeight - 22);
  const maxRows = Math.max(2, Math.min(5, Math.floor(availableHeight / 12)));

  if (sortedItems.length <= maxRows) {
    return sortedItems.map((item) => ({
      kind: "item",
      text: truncateText(buildEntryText(item), maxTextWidth, entryFontSize),
      status: getStatusKey(item),
    }));
  }

  const visibleCount = Math.max(1, maxRows - 1);
  return [
    ...sortedItems.slice(0, visibleCount).map((item) => ({
      kind: "item",
      text: truncateText(buildEntryText(item), maxTextWidth, entryFontSize),
      status: getStatusKey(item),
    })),
    {
      kind: "more",
      text: `+${sortedItems.length - visibleCount} more`,
      status: "denied",
    },
  ];
}

function buildEntryText(item) {
  const status = getStatusKey(item);
  const statusSuffix = getStatusSuffix(status);
  const parts = [formatTimeLabel(item.startTime), getFieldShortLabel(item.field), getItemLabel(item)];
  if (statusSuffix) parts.push(`[${statusSuffix}]`);
  return parts.join(" ");
}

function drawRect(operations, { x, y, width, height, fillColor, strokeColor, lineWidth = 1 }) {
  const rectY = PAGE_HEIGHT - y - height;
  const colorBits = [];
  if (fillColor) colorBits.push(`${fillColor.map(formatNumber).join(" ")} rg`);
  if (strokeColor) colorBits.push(`${strokeColor.map(formatNumber).join(" ")} RG`);
  colorBits.push(`${formatNumber(lineWidth)} w`);
  colorBits.push(
    `${formatNumber(x)} ${formatNumber(rectY)} ${formatNumber(width)} ${formatNumber(height)} re ${
      fillColor && strokeColor ? "B" : fillColor ? "f" : "S"
    }`
  );
  operations.push(colorBits.join(" "));
}

function drawText(operations, { x, y, text, size, color, bold = false }) {
  const textY = PAGE_HEIGHT - y - size;
  operations.push(
    `BT /${bold ? "F2" : "F1"} ${formatNumber(size)} Tf ${color.map(formatNumber).join(" ")} rg 1 0 0 1 ${formatNumber(
      x
    )} ${formatNumber(textY)} Tm (${escapePdfText(text)}) Tj ET`
  );
}

function buildCalendarOperations({ month, items, now }) {
  const parsedMonth = parseMonth(month);
  if (!parsedMonth) throw new Error("Choose a valid month for the PDF export.");

  const { year, monthIndex } = parsedMonth;
  const title = `BGSL Field Scheduling - ${formatMonthTitle(parsedMonth)}`;
  const generatedAt = `Up to date as of ${formatEtStamp(now)}`;
  const gridDates = getCalendarGridDates(parsedMonth);
  const monthPrefix = `${year}-${String(monthIndex + 1).padStart(2, "0")}-`;
  const itemsByDate = new Map();

  for (const item of items || []) {
    const dateKey = String(item?.date || "");
    if (!dateKey.startsWith(monthPrefix)) continue;
    const existing = itemsByDate.get(dateKey) || [];
    existing.push(item);
    itemsByDate.set(dateKey, existing);
  }

  const gridTop = MARGIN_TOP + HEADER_HEIGHT + 12;
  const gridHeight = PAGE_HEIGHT - MARGIN_BOTTOM - gridTop;
  const cellWidth = (PAGE_WIDTH - MARGIN_X * 2) / 7;
  const cellHeight = (gridHeight - WEEKDAY_HEIGHT) / 6;
  const operations = [];

  drawRect(operations, {
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    fillColor: COLORS.page,
  });

  const titleX = (PAGE_WIDTH - estimateTextWidth(title, 20)) / 2;
  const stampX = (PAGE_WIDTH - estimateTextWidth(generatedAt, 9.5)) / 2;
  drawText(operations, {
    x: Math.max(MARGIN_X, titleX),
    y: MARGIN_TOP,
    text: title,
    size: 20,
    bold: true,
    color: COLORS.title,
  });
  drawText(operations, {
    x: Math.max(MARGIN_X, stampX),
    y: MARGIN_TOP + 24,
    text: generatedAt,
    size: 9.5,
    color: COLORS.bodyText,
  });

  for (let columnIndex = 0; columnIndex < 7; columnIndex += 1) {
    const x = MARGIN_X + columnIndex * cellWidth;
    drawRect(operations, {
      x,
      y: gridTop,
      width: cellWidth,
      height: WEEKDAY_HEIGHT,
      fillColor: COLORS.headerFill,
      strokeColor: COLORS.gridBorder,
    });

    const label = WEEKDAY_LABELS[columnIndex];
    const labelX = x + (cellWidth - estimateTextWidth(label, 9.2)) / 2;
    drawText(operations, {
      x: labelX,
      y: gridTop + 5,
      text: label,
      size: 9.2,
      bold: true,
      color: COLORS.bodyText,
    });
  }

  gridDates.forEach((date, index) => {
    const columnIndex = index % 7;
    const rowIndex = Math.floor(index / 7);
    const x = MARGIN_X + columnIndex * cellWidth;
    const y = gridTop + WEEKDAY_HEIGHT + rowIndex * cellHeight;
    const isCurrentMonth = date.getMonth() === monthIndex;
    const dateKey = formatDateInput(date);
    const dayEntries = isCurrentMonth ? buildDayEntries(itemsByDate.get(dateKey) || [], cellWidth, cellHeight) : [];

    drawRect(operations, {
      x,
      y,
      width: cellWidth,
      height: cellHeight,
      fillColor: isCurrentMonth ? COLORS.currentMonthFill : COLORS.outsideMonthFill,
      strokeColor: COLORS.gridBorder,
    });

    drawText(operations, {
      x: x + 6,
      y: y + 5,
      text: String(date.getDate()),
      size: 9.5,
      bold: true,
      color: isCurrentMonth ? COLORS.bodyText : COLORS.mutedText,
    });

    let cursorY = y + 18;
    for (const entry of dayEntries) {
      const statusColors = STATUS_COLORS[entry.status] || STATUS_COLORS.approved;
      if (entry.kind === "item") {
        drawRect(operations, {
          x: x + 4,
          y: cursorY,
          width: cellWidth - 8,
          height: 10,
          fillColor: statusColors.fill,
          strokeColor: statusColors.border,
          lineWidth: 0.8,
        });
        drawText(operations, {
          x: x + 7,
          y: cursorY + 2,
          text: entry.text,
          size: 6.4,
          color: statusColors.text,
          bold: true,
        });
      } else {
        drawText(operations, {
          x: x + 6,
          y: cursorY + 1,
          text: entry.text,
          size: 6.8,
          color: COLORS.mutedText,
          bold: true,
        });
      }
      cursorY += 12;
    }
  });

  return operations;
}

function buildPdfBlobFromOperations(operations) {
  const encoder = new TextEncoder();
  const stream = operations.join("\n");
  const streamBytes = encoder.encode(stream);
  const objects = [
    null,
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${streamBytes.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new Blob([pdf], { type: "application/pdf" });
}

export function downloadSchedulingMonthPdf({ month, items, now = new Date() }) {
  const operations = buildCalendarOperations({ month, items, now });
  const blob = buildPdfBlobFromOperations(operations);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `field-calendar-${month}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
