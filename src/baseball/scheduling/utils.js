export const FIELD_OPTIONS = [
  { value: "major", label: "Majors Field", shortLabel: "Majors" },
  { value: "minor", label: "Minors Field", shortLabel: "Minors" },
  { value: "tee-ball", label: "Tee Ball Field", shortLabel: "Tee Ball" },
];
export const BUBBLE_FIELD_OPTIONS = [{ value: "bubble", label: "Bubble", shortLabel: "Bubble" }];
export const ALL_FIELD_OPTIONS = [...FIELD_OPTIONS, ...BUBBLE_FIELD_OPTIONS];

export function getSchedulingFields(mode) {
  return mode === "bubble" ? BUBBLE_FIELD_OPTIONS : FIELD_OPTIONS;
}

export function scopeSchedulingData(data, mode) {
  const fields = new Set(getSchedulingFields(mode).map((field) => field.value));
  const reservations = (data.reservations || []).filter((item) => fields.has(item.field));
  const requests = (data.requests || []).filter((item) => fields.has(item.field));
  const pendingRequests = requests.filter((item) => item.status === "pending");
  return {
    ...data, reservations, requests, pendingRequests,
    summary: {
      approvedReservations: reservations.length,
      pendingAddRequests: pendingRequests.filter((item) => item.requestType === "add").length,
      pendingRemovalRequests: pendingRequests.filter((item) => item.requestType === "remove").length,
      conflicts: reservations.filter((item) => item.hasConflict).length + pendingRequests.filter((item) => item.hasConflict).length,
    },
  };
}

export function compactEventTitle(item) {
  const clean = (value) => String(value || "").replace(/\[SAMPLE\]\s*/gi, "").replace(/^Barrington\s+/i, "").trim();
  const team = clean(item?.team);
  const title = clean(item?.title);
  if (!title) return team || "Reservation";
  if (!team || title.toLowerCase().includes(team.toLowerCase())) return title;
  return `${team} · ${title}`;
}

export function compactTimeLabel(value) {
  return formatTimeLabel(value).replace(":00", "");
}

export const RESERVATION_DURATION_MINUTES = 120;

export const STATUS_META = {
  approved: { label: "Approved", tone: "approved" },
  pending: { label: "Pending Approval", tone: "pending" },
  conflict: { label: "Conflict", tone: "conflict" },
  maintenance: { label: "Maintenance / Blocked", tone: "maintenance" },
  removal_requested: { label: "Removal Requested", tone: "removal" },
  denied: { label: "Denied", tone: "denied" },
  canceled: { label: "Canceled", tone: "denied" },
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
  const delta = -day;
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
  if (value === "24:00") return "12:00 AM";
  const normalized = normalizeTimeValue(value);
  if (!normalized) return value || "";
  const [hourText, minuteText] = normalized.split(":");
  const hour = Number(hourText);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minuteText} ${suffix}`;
}

export function deriveReservationEndTime(startTime) {
  const startMinutes = timeToMinutes(startTime);
  if (!Number.isFinite(startMinutes)) return "";

  const endMinutes = Math.max(0, Math.min(startMinutes + RESERVATION_DURATION_MINUTES, 24 * 60));
  const hour = Math.floor(endMinutes / 60);
  const minute = endMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function formatTimeRange(startTime, endTime) {
  const resolvedEndTime = endTime || deriveReservationEndTime(startTime);
  return `${formatTimeLabel(startTime)} - ${formatTimeLabel(resolvedEndTime)}`;
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

export function getConflictsForDraft(draft, calendarItems) {
  const date = String(draft?.date || "").trim();
  const field = String(draft?.field || "").trim();
  const startMinutes = timeToMinutes(draft?.startTime);
  const endMinutes = startMinutes + RESERVATION_DURATION_MINUTES;

  if (!date || !field || !Number.isFinite(startMinutes) || endMinutes > 24 * 60) {
    return [];
  }

  return (calendarItems || [])
    .filter((item) => item.date === date && item.field === field)
    .filter((item) => {
      const otherStart = timeToMinutes(item.startTime);
      const otherEnd = otherStart + RESERVATION_DURATION_MINUTES;
      return Number.isFinite(otherStart) && Number.isFinite(otherEnd) && startMinutes < otherEnd && endMinutes > otherStart;
    })
    .map((item) => {
      const statusLabel =
        item.kind === "request"
          ? "pending request"
          : item.displayStatus === "maintenance"
          ? "blocked time"
          : "approved reservation";

      return `${item.title || item.team} on ${ALL_FIELD_OPTIONS.find((field) => field.value === item.field)?.label || "Field"} from ${formatTimeLabel(item.startTime)} to ${formatTimeLabel(item.endTime)} (${statusLabel})`;
    });
}
