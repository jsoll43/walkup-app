// Shared by the baseball client and API. Calendar dates use UTC noon to avoid
// timezone and daylight-saving shifts when evaluating a local date string.
export const BUBBLE_SOFTBALL_NOTICE = "The Bubble is reserved for softball all day every Tuesday and Thursday. Baseball bookings are not allowed on those days.";

export function bubbleBookingError(field, date) {
  if (field !== "bubble" || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return "";
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return "";
  return [2, 4].includes(parsed.getUTCDay()) ? BUBBLE_SOFTBALL_NOTICE : "";
}

export function buildBubbleSoftballBlocks(dates) {
  return [...new Set(dates)].filter(date => bubbleBookingError("bubble", date)).map(date => ({
    id: `bubble-softball-${date}`, uniqueKey: `closure:bubble-softball-${date}`,
    kind: "closure", field: "bubble", date, startTime: "00:00", endTime: "24:00",
    allDay: true, title: "Reserved for softball", team: "Softball",
    displayStatus: "maintenance", notes: BUBBLE_SOFTBALL_NOTICE,
  }));
}
