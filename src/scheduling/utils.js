export const FIELD_OPTIONS = [
  { value: "major", label: "Major Field" },
  { value: "minor", label: "Minor Field" },
];

export const RESERVATION_TYPE_OPTIONS = [
  { value: "practice", label: "Practice" },
  { value: "game", label: "Game" },
  { value: "tournament", label: "Tournament" },
  { value: "clinic", label: "Clinic" },
  { value: "maintenance", label: "Maintenance / Field Closed" },
  { value: "other", label: "Other" },
];

export const STATUS_META = {
  approved: { label: "Approved", tone: "approved" },
  pending: { label: "Pending Approval", tone: "pending" },
  conflict: { label: "Conflict", tone: "conflict" },
  maintenance: { label: "Maintenance / Blocked", tone: "maintenance" },
  removal_requested: { label: "Removal Requested", tone: "removal" },
  denied: { label: "Denied", tone: "denied" },
};

function makeDateFromText(dateText) {
  const [yearText, monthText, dayText] = String(dateText || "").split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  return new Date(year, month - 1, day);
}

export function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getTodayInEt() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(new Date());
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return `${map.get("year")}-${map.get("month")}-${map.get("day")}`;
}

export function addDays(dateText, delta) {
  const next = makeDateFromText(dateText);
  next.setDate(next.getDate() + delta);
  return formatDateInput(next);
}

export function getWeekStart(dateText) {
  const date = makeDateFromText(dateText);
  const day = date.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + delta);
  return formatDateInput(date);
}

export function getWeekDates(anchorDate) {
  const start = makeDateFromText(getWeekStart(anchorDate));
  return Array.from({ length: 7 }, (_, index) => {
    const next = new Date(start);
    next.setDate(start.getDate() + index);
    return formatDateInput(next);
  });
}

export function formatDayHeader(dateText) {
  return makeDateFromText(dateText).toLocaleDateString("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });
}

export function formatLongDate(dateText) {
  return makeDateFromText(dateText).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function normalizeTimeValue(value) {
  const raw = String(value || "").trim();
  if (!/^\d{1,2}:\d{2}$/.test(raw)) return "";
  const [hourText, minuteText] = raw.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return "";
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function timeToMinutes(value) {
  const normalized = normalizeTimeValue(value);
  if (!normalized) return Number.NaN;
  const [hourText, minuteText] = normalized.split(":");
  return Number(hourText) * 60 + Number(minuteText);
}

export function formatTimeLabel(value) {
  const normalized = normalizeTimeValue(value);
  if (!normalized) return value || "";
  const [hourText, minuteText] = normalized.split(":");
  const hour = Number(hourText);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minuteText} ${suffix}`;
}

export function formatTimeRange(startTime, endTime) {
  return `${formatTimeLabel(startTime)} - ${formatTimeLabel(endTime)}`;
}

export function buildCalendarItems(reservations, requests) {
  const pendingAdds = (requests || []).filter((request) => request.status === "pending" && request.requestType === "add");
  const items = [
    ...(reservations || []).map((reservation) => ({
      ...reservation,
      kind: "reservation",
      uniqueKey: `reservation:${reservation.id}`,
    })),
    ...pendingAdds.map((request) => ({
      ...request,
      kind: "request",
      uniqueKey: `request:${request.id}`,
    })),
  ];

  return items.sort((a, b) => {
    const dateCompare = String(a.date || "").localeCompare(String(b.date || ""));
    if (dateCompare !== 0) return dateCompare;

    const fieldCompare = String(a.field || "").localeCompare(String(b.field || ""));
    if (fieldCompare !== 0) return fieldCompare;

    const startCompare = String(a.startTime || "").localeCompare(String(b.startTime || ""));
    if (startCompare !== 0) return startCompare;

    return String(a.team || "").localeCompare(String(b.team || ""));
  });
}

export function buildHourMarks(startMinutes, endMinutes, interval = 60) {
  const marks = [];
  for (let minute = startMinutes; minute <= endMinutes; minute += interval) {
    marks.push(minute);
  }
  return marks;
}

export function getVisibleRange(items) {
  const fallbackStart = 8 * 60;
  const fallbackEnd = 20 * 60;
  if (!Array.isArray(items) || items.length === 0) {
    return { start: fallbackStart, end: fallbackEnd };
  }

  const starts = items.map((item) => timeToMinutes(item.startTime)).filter(Number.isFinite);
  const ends = items.map((item) => timeToMinutes(item.endTime)).filter(Number.isFinite);
  const rawStart = Math.min(...starts, fallbackStart);
  const rawEnd = Math.max(...ends, fallbackEnd);

  const start = Math.max(6 * 60, Math.floor((rawStart - 30) / 60) * 60);
  const end = Math.min(23 * 60, Math.ceil((rawEnd + 30) / 60) * 60);

  if (end <= start) return { start: fallbackStart, end: fallbackEnd };
  return { start, end };
}

export function layoutColumnItems(items) {
  const prepared = (items || [])
    .map((item) => ({
      ...item,
      startMinutes: timeToMinutes(item.startTime),
      endMinutes: timeToMinutes(item.endTime),
    }))
    .filter((item) => Number.isFinite(item.startMinutes) && Number.isFinite(item.endMinutes))
    .sort((a, b) => {
      if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
      if (a.endMinutes !== b.endMinutes) return a.endMinutes - b.endMinutes;
      return String(a.uniqueKey || "").localeCompare(String(b.uniqueKey || ""));
    });

  const clusters = [];
  let currentCluster = [];
  let currentClusterEnd = -1;

  for (const item of prepared) {
    if (currentCluster.length === 0) {
      currentCluster = [item];
      currentClusterEnd = item.endMinutes;
      continue;
    }

    if (item.startMinutes < currentClusterEnd) {
      currentCluster.push(item);
      currentClusterEnd = Math.max(currentClusterEnd, item.endMinutes);
    } else {
      clusters.push(currentCluster);
      currentCluster = [item];
      currentClusterEnd = item.endMinutes;
    }
  }

  if (currentCluster.length > 0) clusters.push(currentCluster);

  const laidOut = [];
  for (const cluster of clusters) {
    const laneEnds = [];
    for (const item of cluster) {
      let lane = laneEnds.findIndex((laneEnd) => laneEnd <= item.startMinutes);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = item.endMinutes;
      laidOut.push({
        ...item,
        lane,
        laneCount: 0,
      });
    }

    const laneCount = laneEnds.length || 1;
    for (let i = laidOut.length - cluster.length; i < laidOut.length; i += 1) {
      laidOut[i].laneCount = laneCount;
    }
  }

  return laidOut;
}

export function getConflictsForDraft(draft, calendarItems) {
  const date = String(draft?.date || "").trim();
  const field = String(draft?.field || "").trim();
  const startMinutes = timeToMinutes(draft?.startTime);
  const endMinutes = timeToMinutes(draft?.endTime);

  if (!date || !field || !Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || endMinutes <= startMinutes) {
    return [];
  }

  return (calendarItems || [])
    .filter((item) => item.date === date && item.field === field)
    .filter((item) => {
      const otherStart = timeToMinutes(item.startTime);
      const otherEnd = timeToMinutes(item.endTime);
      return Number.isFinite(otherStart) && Number.isFinite(otherEnd) && startMinutes < otherEnd && endMinutes > otherStart;
    })
    .map((item) => {
      const statusLabel =
        item.kind === "request"
          ? "pending request"
          : item.displayStatus === "maintenance"
          ? "blocked time"
          : "approved reservation";

      return `${item.title || item.team} on ${item.field === "major" ? "Major Field" : "Minor Field"} from ${formatTimeLabel(item.startTime)} to ${formatTimeLabel(item.endTime)} (${statusLabel})`;
    });
}
