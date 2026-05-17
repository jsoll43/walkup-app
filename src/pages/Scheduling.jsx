import { useEffect, useMemo, useState } from "react";

import {
  FIELD_OPTIONS,
  RESERVATION_TYPE_OPTIONS,
  STATUS_META,
  addDays,
  buildCalendarItems,
  buildHourMarks,
  formatDayHeader,
  formatLongDate,
  formatTimeLabel,
  formatTimeRange,
  getConflictsForDraft,
  getTodayInEt,
  getVisibleRange,
  getWeekDates,
  layoutColumnItems,
} from "../scheduling/utils.js";

const PIXELS_PER_MINUTE = 1;
const SCHEDULING_KEY_STORAGE = "SCHEDULING_KEY";
const SCHEDULING_ROLE_STORAGE = "SCHEDULING_ROLE";

function getSavedSchedulingKey() {
  return sessionStorage.getItem(SCHEDULING_KEY_STORAGE) || "";
}

function getSavedSchedulingRole() {
  return sessionStorage.getItem(SCHEDULING_ROLE_STORAGE) || "coach";
}

function saveSchedulingSession(role, key) {
  sessionStorage.setItem(SCHEDULING_ROLE_STORAGE, role);
  sessionStorage.setItem(SCHEDULING_KEY_STORAGE, key);
}

function clearSchedulingSession() {
  sessionStorage.removeItem(SCHEDULING_ROLE_STORAGE);
  sessionStorage.removeItem(SCHEDULING_KEY_STORAGE);
}

async function safeJsonOrText(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function schedulingHeaders(role, key) {
  return {
    Authorization: `Bearer ${key}`,
    "x-scheduling-role": role,
    "x-scheduling-key": key,
  };
}

function fieldLabel(field) {
  return FIELD_OPTIONS.find((option) => option.value === field)?.label || "Field";
}

function reservationTypeLabel(type) {
  return RESERVATION_TYPE_OPTIONS.find((option) => option.value === type)?.label || "Other";
}

function getStatusMeta(status) {
  return STATUS_META[status] || STATUS_META.approved;
}

function normalizeRequestStatus(request) {
  if (!request) return "pending";
  if (request.status === "approved" || request.status === "denied") return request.status;
  return request.displayStatus || (request.hasConflict ? "conflict" : "pending");
}

function getCalendarStatus(item) {
  if (!item) return "approved";
  if (item.kind === "request") return normalizeRequestStatus(item);
  return item.displayStatus || "approved";
}

function minutesToTimeText(totalMinutes) {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function itemPrimaryLabel(item) {
  return String(item?.team || "").trim() || String(item?.title || "").trim() || "Reservation";
}

function itemSecondaryLabel(item) {
  if (!item) return "";
  if (item.kind === "request") return "Pending approval";
  if (item.displayStatus === "maintenance") return "Blocked time";
  if (item.displayStatus === "removal_requested") return "Removal requested";
  return reservationTypeLabel(item.reservationType);
}

function StatusPill({ status }) {
  const meta = getStatusMeta(status);
  return <span className={`scheduling-pill scheduling-pill-${meta.tone}`}>{meta.label}</span>;
}

function StatCard({ label, value, accent }) {
  return (
    <div className="scheduling-stat-card">
      <div className="scheduling-stat-label">{label}</div>
      <div className={`scheduling-stat-value ${accent ? `is-${accent}` : ""}`}>{value}</div>
    </div>
  );
}

function TimeAxis({ range, totalHeight }) {
  const hourMarks = buildHourMarks(range.start, range.end, 60);
  return (
    <div className="schedule-time-axis" style={{ height: totalHeight }}>
      {hourMarks.map((minute) => (
        <div
          key={minute}
          className="schedule-time-label"
          style={{ top: (minute - range.start) * PIXELS_PER_MINUTE }}
        >
          {formatTimeLabel(minutesToTimeText(minute))}
        </div>
      ))}
    </div>
  );
}

function ScheduleBlock({ item, style, isSelected, onSelect }) {
  const status = getCalendarStatus(item);
  return (
    <button
      type="button"
      className={[
        "schedule-block",
        item.kind === "request" ? "is-request" : "is-reservation",
        status ? `is-${status}` : "",
        isSelected ? "is-selected" : "",
      ].join(" ")}
      style={style}
      onClick={() => onSelect(item)}
    >
      <div className="schedule-block-eyebrow">{itemSecondaryLabel(item)}</div>
      <div className="schedule-block-title">{itemPrimaryLabel(item)}</div>
      <div className="schedule-block-time">{formatTimeRange(item.startTime, item.endTime)}</div>
    </button>
  );
}

function FieldColumn({ items, range, selectedItemKey, onSelect }) {
  const laidOutItems = layoutColumnItems(items);
  const totalHeight = Math.max((range.end - range.start) * PIXELS_PER_MINUTE, 480);
  const hourMarks = buildHourMarks(range.start, range.end, 60);
  const halfHourMarks = buildHourMarks(range.start + 30, range.end, 60);

  return (
    <div className="schedule-field-column">
      <div className="schedule-field-surface" style={{ height: totalHeight }}>
        {hourMarks.map((minute) => (
          <div
            key={`hour-${minute}`}
            className="schedule-line is-hour"
            style={{ top: (minute - range.start) * PIXELS_PER_MINUTE }}
          />
        ))}

        {halfHourMarks.map((minute) => (
          <div
            key={`half-${minute}`}
            className="schedule-line is-half"
            style={{ top: (minute - range.start) * PIXELS_PER_MINUTE }}
          />
        ))}

        {laidOutItems.map((item) => {
          const top = (item.startMinutes - range.start) * PIXELS_PER_MINUTE;
          const height = Math.max((item.endMinutes - item.startMinutes) * PIXELS_PER_MINUTE, 36);
          const widthPercent = 100 / (item.laneCount || 1);
          const leftPercent = item.lane * widthPercent;

          return (
            <ScheduleBlock
              key={item.uniqueKey}
              item={item}
              isSelected={selectedItemKey === item.uniqueKey}
              onSelect={onSelect}
              style={{
                top,
                height,
                left: `calc(${leftPercent}% + 3px)`,
                width: `calc(${widthPercent}% - 6px)`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function DesktopScheduleView({ weekDates, calendarItems, range, selectedItemKey, onSelect }) {
  const totalHeight = Math.max((range.end - range.start) * PIXELS_PER_MINUTE, 480);

  return (
    <div className="schedule-desktop-view">
      <div className="schedule-week-scroll">
        <div className="schedule-week-header">
          <div className="schedule-time-spacer" />
          {weekDates.map((date) => (
            <div key={date} className="schedule-day-header-group">
              <div className="schedule-day-label">{formatDayHeader(date)}</div>
              <div className="schedule-field-header-row">
                <div className="schedule-field-header">Major Field</div>
                <div className="schedule-field-header">Minor Field</div>
              </div>
            </div>
          ))}
        </div>

        <div className="schedule-week-body">
          <TimeAxis range={range} totalHeight={totalHeight} />

          {weekDates.map((date) => (
            <div key={`body-${date}`} className="schedule-day-body-group">
              {FIELD_OPTIONS.map((field) => (
                <FieldColumn
                  key={`${date}-${field.value}`}
                  items={calendarItems.filter((item) => item.date === date && item.field === field.value)}
                  range={range}
                  selectedItemKey={selectedItemKey}
                  onSelect={onSelect}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MobileScheduleView({ date, calendarItems, range, selectedItemKey, onSelect }) {
  const totalHeight = Math.max((range.end - range.start) * PIXELS_PER_MINUTE, 480);
  const dayItems = calendarItems.filter((item) => item.date === date);

  return (
    <div className="schedule-mobile-view">
      <div className="schedule-mobile-header">
        <div className="schedule-mobile-title">{formatLongDate(date)}</div>
        <div className="schedule-field-header-row is-mobile">
          <div className="schedule-field-header">Major Field</div>
          <div className="schedule-field-header">Minor Field</div>
        </div>
      </div>

      <div className="schedule-week-body is-mobile">
        <TimeAxis range={range} totalHeight={totalHeight} />
        <div className="schedule-day-body-group is-mobile">
          {FIELD_OPTIONS.map((field) => (
            <FieldColumn
              key={`${date}-${field.value}`}
              items={dayItems.filter((item) => item.field === field.value)}
              range={range}
              selectedItemKey={selectedItemKey}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ReservationFormCard({
  title,
  description,
  form,
  onChange,
  onSubmit,
  submitLabel,
  submitting,
  teams,
  includeLeagueOption,
  conflicts,
}) {
  return (
    <div className="card scheduling-panel-card">
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <div style={{ opacity: 0.8 }}>{description}</div>

      <div className="scheduling-form-grid" style={{ marginTop: 14 }}>
        <div>
          <label className="label">Team</label>
          <select className="input" value={form.team} onChange={(e) => onChange("team", e.target.value)}>
            <option value="">Select team</option>
            {includeLeagueOption ? <option value="League / Board">League / Board</option> : null}
            {teams.map((team) => (
              <option key={team.slug} value={team.name}>
                {team.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Reservation Type</label>
          <select className="input" value={form.reservationType} onChange={(e) => onChange("reservationType", e.target.value)}>
            {RESERVATION_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Field</label>
          <select className="input" value={form.field} onChange={(e) => onChange("field", e.target.value)}>
            {FIELD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Date</label>
          <input className="input" type="date" value={form.date} onChange={(e) => onChange("date", e.target.value)} />
        </div>

        <div>
          <label className="label">Start Time</label>
          <input className="input" type="time" value={form.startTime} onChange={(e) => onChange("startTime", e.target.value)} />
        </div>

        <div>
          <label className="label">End Time</label>
          <input className="input" type="time" value={form.endTime} onChange={(e) => onChange("endTime", e.target.value)} />
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <label className="label">Title (optional)</label>
        <input className="input" value={form.title} onChange={(e) => onChange("title", e.target.value)} placeholder="Optional custom title" />
      </div>

      <div style={{ marginTop: 12 }}>
        <label className="label">Notes (optional)</label>
        <textarea
          className="input"
          value={form.notes}
          onChange={(e) => onChange("notes", e.target.value)}
          placeholder="Add extra scheduling context"
          rows={3}
          style={{ resize: "vertical" }}
        />
      </div>

      {conflicts.length > 0 ? (
        <div className="scheduling-warning-card">
          <div style={{ fontWeight: 1000 }}>Conflict warning</div>
          <div style={{ marginTop: 6 }}>
            This time overlaps existing field use or another pending request. You can still submit it, but it will be flagged.
          </div>
          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
            {conflicts.map((detail) => (
              <div key={detail}>{detail}</div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 14 }}>
        <button className="btn" onClick={onSubmit} disabled={submitting}>
          {submitting ? "Saving..." : submitLabel}
        </button>
      </div>
    </div>
  );
}

function RequestHistoryCard({ requests, heading, emptyText, children }) {
  return (
    <div className="card scheduling-panel-card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>{heading}</h2>
        {children}
      </div>

      {requests.length === 0 ? (
        <div style={{ marginTop: 14, opacity: 0.75 }}>{emptyText}</div>
      ) : (
        <div className="scheduling-request-list" style={{ marginTop: 14 }}>
          {requests.map((request) => (
            <div key={request.id} className="scheduling-request-card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 1000, fontSize: 16 }}>
                    {request.requestType === "remove" ? "Remove Reservation Request" : request.title || request.team}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 13, opacity: 0.8 }}>
                    {request.team} - {fieldLabel(request.field)} - {formatLongDate(request.date)}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 13, opacity: 0.8 }}>
                    {formatTimeRange(request.startTime, request.endTime)}
                  </div>
                </div>
                <StatusPill status={normalizeRequestStatus(request)} />
              </div>

              <div style={{ marginTop: 10, display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
                <div>
                  <strong>Type:</strong> {request.requestType === "add" ? reservationTypeLabel(request.reservationType) : "Removal"}
                </div>
                <div>
                  <strong>Requested by:</strong> {request.requestedBy || "Coach shared login"}
                </div>
                {request.reviewedBy ? (
                  <div>
                    <strong>Reviewed by:</strong> {request.reviewedBy}
                  </div>
                ) : null}
              </div>

              {request.notes ? (
                <div style={{ marginTop: 10, fontSize: 13 }}>
                  <strong>Notes:</strong> {request.notes}
                </div>
              ) : null}

              {request.hasConflict && request.conflictDetails?.length ? (
                <div className="scheduling-warning-card" style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 1000 }}>Conflict details</div>
                  <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
                    {request.conflictDetails.map((detail) => (
                      <div key={detail}>{detail}</div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SelectedScheduleItemCard({
  item,
  role,
  removalNotes,
  setRemovalNotes,
  onRequestRemoval,
  onDeleteReservation,
  onReviewRequest,
  actionKey,
}) {
  if (!item) {
    return (
      <div className="card scheduling-panel-card">
        <h2 style={{ marginTop: 0 }}>Selected Schedule Item</h2>
        <div style={{ opacity: 0.75 }}>
          Select any reservation or pending request from the calendar to inspect its details here.
        </div>
      </div>
    );
  }

  const status = item.kind === "request" ? normalizeRequestStatus(item) : getCalendarStatus(item);
  const isBoard = role === "board";
  const isReservation = item.kind === "reservation";
  const reviewApproveKey = `review:${item.id}:approve`;
  const reviewDenyKey = `review:${item.id}:deny`;
  const removalKey = `remove-request:${item.id}`;
  const deleteKey = `delete-reservation:${item.id}`;

  return (
    <div className="card scheduling-panel-card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0 }}>{item.title || item.team}</h2>
          <div style={{ marginTop: 6, opacity: 0.8 }}>
            {item.team} - {fieldLabel(item.field)} - {formatLongDate(item.date)}
          </div>
        </div>
        <StatusPill status={status} />
      </div>

      <div className="scheduling-detail-grid" style={{ marginTop: 14 }}>
        <div>
          <div className="scheduling-detail-label">Time</div>
          <div>{formatTimeRange(item.startTime, item.endTime)}</div>
        </div>
        <div>
          <div className="scheduling-detail-label">Type</div>
          <div>{item.requestType === "remove" ? "Removal Request" : reservationTypeLabel(item.reservationType)}</div>
        </div>
        <div>
          <div className="scheduling-detail-label">Source</div>
          <div>{isReservation ? "Reservation" : "Pending Request"}</div>
        </div>
      </div>

      {item.notes ? (
        <div style={{ marginTop: 12 }}>
          <div className="scheduling-detail-label">Notes</div>
          <div>{item.notes}</div>
        </div>
      ) : null}

      {item.hasConflict && item.conflictDetails?.length ? (
        <div className="scheduling-warning-card" style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 1000 }}>Conflict details</div>
          <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
            {item.conflictDetails.map((detail) => (
              <div key={detail}>{detail}</div>
            ))}
          </div>
        </div>
      ) : null}

      {isReservation && item.hasPendingRemoval ? (
        <div className="scheduling-warning-card" style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 1000 }}>Removal request pending</div>
          <div style={{ marginTop: 6 }}>
            A coach has already requested this reservation to be removed and it is waiting for board review.
          </div>
        </div>
      ) : null}

      {isReservation && role === "coach" && !item.hasPendingRemoval ? (
        <div style={{ marginTop: 14 }}>
          <label className="label">Removal request notes (optional)</label>
          <textarea
            className="input"
            rows={3}
            value={removalNotes}
            onChange={(e) => setRemovalNotes(e.target.value)}
            placeholder="Why should this reservation be removed?"
            style={{ resize: "vertical" }}
          />
          <button className="btn-danger" style={{ marginTop: 12 }} onClick={() => onRequestRemoval(item)} disabled={actionKey === removalKey}>
            {actionKey === removalKey ? "Submitting..." : "Request Removal"}
          </button>
        </div>
      ) : null}

      {isReservation && isBoard ? (
        <div style={{ marginTop: 14 }}>
          <button className="btn-danger" onClick={() => onDeleteReservation(item)} disabled={actionKey === deleteKey}>
            {actionKey === deleteKey ? "Removing..." : "Remove Reservation"}
          </button>
        </div>
      ) : null}

      {!isReservation && isBoard && item.status === "pending" ? (
        <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => onReviewRequest(item, "approve")} disabled={actionKey === reviewApproveKey}>
            {actionKey === reviewApproveKey ? "Approving..." : "Approve"}
          </button>
          <button className="btn-danger" onClick={() => onReviewRequest(item, "deny")} disabled={actionKey === reviewDenyKey}>
            {actionKey === reviewDenyKey ? "Denying..." : "Deny"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function Scheduling() {
  const today = useMemo(() => getTodayInEt(), []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [loginRole, setLoginRole] = useState(getSavedSchedulingRole());
  const [loginPassword, setLoginPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [authRole, setAuthRole] = useState(getSavedSchedulingRole());
  const [authKey, setAuthKey] = useState(getSavedSchedulingKey());
  const [isAuthed, setIsAuthed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [actionKey, setActionKey] = useState("");
  const [selectedItemKey, setSelectedItemKey] = useState("");
  const [removalNotes, setRemovalNotes] = useState("");
  const [scheduleData, setScheduleData] = useState({
    teams: [],
    reservations: [],
    requests: [],
    pendingRequests: [],
    summary: {
      approvedReservations: 0,
      pendingAddRequests: 0,
      pendingRemovalRequests: 0,
      conflicts: 0,
    },
  });
  const [coachForm, setCoachForm] = useState({
    team: "",
    title: "",
    reservationType: "practice",
    field: "major",
    date: today,
    startTime: "17:00",
    endTime: "18:30",
    notes: "",
  });
  const [boardForm, setBoardForm] = useState({
    team: "League / Board",
    title: "",
    reservationType: "practice",
    field: "major",
    date: today,
    startTime: "17:00",
    endTime: "18:30",
    notes: "",
  });

  const { teams, reservations, requests, pendingRequests, summary } = scheduleData;
  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);
  const calendarItems = useMemo(() => buildCalendarItems(reservations, requests), [reservations, requests]);
  const weekItems = useMemo(
    () => calendarItems.filter((item) => weekDates.includes(item.date)),
    [calendarItems, weekDates]
  );
  const dayItems = useMemo(() => calendarItems.filter((item) => item.date === selectedDate), [calendarItems, selectedDate]);
  const weekRange = useMemo(() => getVisibleRange(weekItems), [weekItems]);
  const dayRange = useMemo(() => getVisibleRange(dayItems), [dayItems]);
  const selectedItem = useMemo(
    () => calendarItems.find((item) => item.uniqueKey === selectedItemKey) || null,
    [calendarItems, selectedItemKey]
  );
  const coachConflictPreview = useMemo(() => getConflictsForDraft(coachForm, calendarItems), [coachForm, calendarItems]);
  const boardConflictPreview = useMemo(() => getConflictsForDraft(boardForm, calendarItems), [boardForm, calendarItems]);

  useEffect(() => {
    if (teams.length > 0 && !coachForm.team) {
      setCoachForm((current) => ({ ...current, team: teams[0].name }));
    }
  }, [teams, coachForm.team]);

  useEffect(() => {
    if (selectedItemKey && !calendarItems.some((item) => item.uniqueKey === selectedItemKey)) {
      setSelectedItemKey("");
      setRemovalNotes("");
    }
  }, [calendarItems, selectedItemKey]);

  async function refreshState(role = authRole, key = authKey, options = {}) {
    const { persist = false, silent = false } = options;
    if (!role || !key) return;

    if (!silent) setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/scheduling/state", {
        headers: schedulingHeaders(role, key),
      });
      const data = await safeJsonOrText(res);
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.raw || "Failed to load field scheduling.");
      }

      setIsAuthed(true);
      setAuthRole(role);
      setAuthKey(key);
      setScheduleData({
        teams: Array.isArray(data.teams) ? data.teams : [],
        reservations: Array.isArray(data.reservations) ? data.reservations : [],
        requests: Array.isArray(data.requests) ? data.requests : [],
        pendingRequests: Array.isArray(data.pendingRequests) ? data.pendingRequests : [],
        summary: data.summary || {
          approvedReservations: 0,
          pendingAddRequests: 0,
          pendingRemovalRequests: 0,
          conflicts: 0,
        },
      });

      if (persist) {
        saveSchedulingSession(role, key);
      }
    } catch (e) {
      setError(e?.message || String(e));
      setIsAuthed(false);
      setAuthKey("");
      clearSchedulingSession();
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    const savedRole = getSavedSchedulingRole();
    const savedKey = getSavedSchedulingKey();
    if (!savedKey) return;
    refreshState(savedRole, savedKey, { persist: false, silent: false }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function logout() {
    clearSchedulingSession();
    setIsAuthed(false);
    setAuthKey("");
    setLoginPassword("");
    setSelectedItemKey("");
    setRemovalNotes("");
    setError("");
    setSuccess("");
  }

  async function handleLogin() {
    if (!loginPassword.trim()) {
      setError("Enter the scheduling password for the role you selected.");
      return;
    }
    await refreshState(loginRole, loginPassword.trim(), { persist: true, silent: false });
    setLoginPassword("");
  }

  function updateCoachForm(field, value) {
    setCoachForm((current) => ({ ...current, [field]: value }));
  }

  function updateBoardForm(field, value) {
    setBoardForm((current) => ({ ...current, [field]: value }));
  }

  async function submitCoachAddRequest() {
    setActionKey("coach-add");
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/scheduling/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...schedulingHeaders(authRole, authKey),
        },
        body: JSON.stringify({
          requestType: "add",
          ...coachForm,
        }),
      });
      const data = await safeJsonOrText(res);
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.raw || "Failed to submit the request.");
      }
      setSuccess("Coach request submitted for board review.");
      await refreshState(authRole, authKey, { silent: true });
      setCoachForm((current) => ({ ...current, title: "", notes: "" }));
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setActionKey("");
    }
  }

  async function submitBoardReservation() {
    setActionKey("board-add");
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/scheduling/reservation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...schedulingHeaders(authRole, authKey),
        },
        body: JSON.stringify(boardForm),
      });
      const data = await safeJsonOrText(res);
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.raw || "Failed to add the reservation.");
      }
      setSuccess("Board reservation added to the schedule.");
      await refreshState(authRole, authKey, { silent: true });
      setBoardForm((current) => ({ ...current, title: "", notes: "" }));
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setActionKey("");
    }
  }

  async function requestRemoval(item) {
    setActionKey(`remove-request:${item.id}`);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/scheduling/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...schedulingHeaders(authRole, authKey),
        },
        body: JSON.stringify({
          requestType: "remove",
          reservationId: item.id,
          notes: removalNotes,
        }),
      });
      const data = await safeJsonOrText(res);
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.raw || "Failed to submit the removal request.");
      }
      setSuccess("Removal request submitted for board review.");
      setRemovalNotes("");
      await refreshState(authRole, authKey, { silent: true });
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setActionKey("");
    }
  }

  async function removeReservation(item) {
    setActionKey(`delete-reservation:${item.id}`);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/scheduling/reservation", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...schedulingHeaders(authRole, authKey),
        },
        body: JSON.stringify({ id: item.id }),
      });
      const data = await safeJsonOrText(res);
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.raw || "Failed to remove the reservation.");
      }
      setSuccess("Reservation removed from the schedule.");
      setSelectedItemKey("");
      await refreshState(authRole, authKey, { silent: true });
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setActionKey("");
    }
  }

  async function reviewRequest(item, reviewAction) {
    setActionKey(`review:${item.id}:${reviewAction}`);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/scheduling/review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...schedulingHeaders(authRole, authKey),
        },
        body: JSON.stringify({
          requestId: item.id,
          action: reviewAction,
        }),
      });
      const data = await safeJsonOrText(res);
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.raw || "Failed to review the request.");
      }
      setSuccess(reviewAction === "approve" ? "Request approved." : "Request denied.");
      await refreshState(authRole, authKey, { silent: true });
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setActionKey("");
    }
  }

  if (!isAuthed) {
    return (
      <div className="page">
        <div className="card">
          <div className="cardTitle">League Scheduling</div>
          <h1 style={{ marginTop: 10, marginBottom: 8 }}>Field Scheduling Access</h1>
          <div style={{ opacity: 0.8 }}>
            Sign in with the shared coach or board scheduling password to view the field calendar and manage requests.
          </div>

          <div className="scheduling-role-toggle" style={{ marginTop: 18 }}>
            <button
              type="button"
              className={`scheduling-role-button ${loginRole === "coach" ? "is-active" : ""}`}
              onClick={() => setLoginRole("coach")}
            >
              Coach
            </button>
            <button
              type="button"
              className={`scheduling-role-button ${loginRole === "board" ? "is-active" : ""}`}
              onClick={() => setLoginRole("board")}
            >
              Board Member
            </button>
          </div>

          <div style={{ marginTop: 16 }}>
            <label className="label">{loginRole === "coach" ? "Coach Scheduling Password" : "Board Scheduling Password"}</label>
            <input
              className="input"
              type={showPassword ? "text" : "password"}
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              onKeyDown={(e) => (e.key === "Enter" ? handleLogin() : null)}
              placeholder="Enter scheduling password"
            />
            <label style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, opacity: 0.85 }}>
              <input type="checkbox" checked={showPassword} onChange={() => setShowPassword((value) => !value)} />
              Show password
            </label>
          </div>

          <button className="btn" style={{ width: "100%", marginTop: 14 }} onClick={handleLogin} disabled={loading}>
            {loading ? "Logging in..." : `Log in as ${loginRole === "coach" ? "Coach" : "Board Member"}`}
          </button>

          {error ? (
            <div style={{ marginTop: 12, color: "crimson" }}>
              <strong>Error:</strong> {error}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="scheduling-shell">
      <div className="scheduling-header-row">
        <div>
          <div className="cardTitle" style={{ color: "rgba(255,255,255,0.75)" }}>League Operations</div>
          <h1 className="scheduling-page-title">Field Scheduling</h1>
          <div className="scheduling-page-subtitle">
            Weekly field reservations on desktop, day timeline on mobile, and a shared approval queue for coach requests.
          </div>
        </div>

        <div className="scheduling-header-actions">
          <span className={`scheduling-pill ${authRole === "board" ? "scheduling-pill-approved" : "scheduling-pill-pending"}`}>
            {authRole === "board" ? "Board Member" : "Coach"}
          </span>
          <button className="btn-secondary scheduling-header-button" onClick={() => refreshState(authRole, authKey, { silent: false })} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button className="btn-secondary scheduling-header-button" onClick={logout}>
            Log out
          </button>
        </div>
      </div>

      {error ? (
        <div className="card" style={{ borderColor: "rgba(220,38,38,0.35)", marginBottom: 12 }}>
          <div style={{ color: "crimson" }}>
            <strong>Error:</strong> {error}
          </div>
        </div>
      ) : null}

      {success ? (
        <div className="card" style={{ borderColor: "rgba(5,150,105,0.35)", marginBottom: 12 }}>
          <div style={{ color: "#065f46" }}>
            <strong>Saved:</strong> {success}
          </div>
        </div>
      ) : null}

      <div className="scheduling-summary-grid">
        <StatCard label="Signed In As" value={authRole === "board" ? "Board Member" : "Coach"} accent="gold" />
        <StatCard label="Approved Reservations" value={summary.approvedReservations} />
        <StatCard label="Pending Add Requests" value={summary.pendingAddRequests} accent="pending" />
        <StatCard label="Pending Removal Requests" value={summary.pendingRemovalRequests} accent="removal" />
        <StatCard label="Conflicts Flagged" value={summary.conflicts} accent="conflict" />
      </div>

      <div className="card scheduling-calendar-card">
        <div className="scheduling-toolbar">
          <div>
            <h2 style={{ margin: 0 }}>Schedule</h2>
            <div style={{ marginTop: 4, opacity: 0.75 }}>
              Desktop shows the full week. Mobile keeps both fields visible on a single selected day.
            </div>
          </div>

          <div className="scheduling-toolbar-actions">
            <button className="btn-secondary" onClick={() => setSelectedDate(addDays(selectedDate, -7))}>
              Previous Week
            </button>
            <button className="btn-secondary" onClick={() => setSelectedDate(today)}>
              This Week
            </button>
            <button className="btn-secondary" onClick={() => setSelectedDate(addDays(selectedDate, 7))}>
              Next Week
            </button>
          </div>
        </div>

        <div className="scheduling-mobile-date-picker">
          <label className="label">Mobile day view</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn-secondary" onClick={() => setSelectedDate(addDays(selectedDate, -1))}>
              Previous Day
            </button>
            <input className="input" type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} style={{ maxWidth: 180 }} />
            <button className="btn-secondary" onClick={() => setSelectedDate(addDays(selectedDate, 1))}>
              Next Day
            </button>
          </div>
        </div>

        <div className="scheduling-legend">
          <StatusPill status="approved" />
          <StatusPill status="pending" />
          <StatusPill status="conflict" />
          <StatusPill status="maintenance" />
          <StatusPill status="removal_requested" />
        </div>

        <DesktopScheduleView
          weekDates={weekDates}
          calendarItems={weekItems}
          range={weekRange}
          selectedItemKey={selectedItemKey}
          onSelect={(item) => setSelectedItemKey(item.uniqueKey)}
        />

        <MobileScheduleView
          date={selectedDate}
          calendarItems={calendarItems}
          range={dayRange}
          selectedItemKey={selectedItemKey}
          onSelect={(item) => setSelectedItemKey(item.uniqueKey)}
        />
      </div>

      <div className="scheduling-panels">
        <div className="scheduling-panel-stack">
          {authRole === "coach" ? (
            <>
              <ReservationFormCard
                title="Request Field Time"
                description="Coaches can submit a reservation request for board approval. Conflicts are warned, but still allowed."
                form={coachForm}
                onChange={updateCoachForm}
                onSubmit={submitCoachAddRequest}
                submitLabel="Submit Coach Request"
                submitting={actionKey === "coach-add"}
                teams={teams}
                includeLeagueOption={false}
                conflicts={coachConflictPreview}
              />

              <RequestHistoryCard
                heading="Coach Requests"
                emptyText="No coach scheduling requests have been submitted yet."
                requests={requests}
              />
            </>
          ) : (
            <>
              <ReservationFormCard
                title="Add Approved Reservation"
                description="Board members can place reservations directly on the schedule and can also block off fields for maintenance."
                form={boardForm}
                onChange={updateBoardForm}
                onSubmit={submitBoardReservation}
                submitLabel="Add Reservation"
                submitting={actionKey === "board-add"}
                teams={teams}
                includeLeagueOption
                conflicts={boardConflictPreview}
              />

              <RequestHistoryCard
                heading="Recent Scheduling Requests"
                emptyText="No scheduling requests have been submitted yet."
                requests={requests}
              >
                <div style={{ fontSize: 13, opacity: 0.75 }}>
                  The actionable board queue is listed alongside the selected item details.
                </div>
              </RequestHistoryCard>
            </>
          )}
        </div>

        <div className="scheduling-panel-stack">
          <SelectedScheduleItemCard
            item={selectedItem}
            role={authRole}
            removalNotes={removalNotes}
            setRemovalNotes={setRemovalNotes}
            onRequestRemoval={requestRemoval}
            onDeleteReservation={removeReservation}
            onReviewRequest={reviewRequest}
            actionKey={actionKey}
          />

          {authRole === "board" && pendingRequests.length > 0 ? (
            <div className="card scheduling-panel-card">
              <h2 style={{ marginTop: 0 }}>Board Action Queue</h2>
              <div className="scheduling-request-list">
                {pendingRequests.map((request) => (
                  <div key={request.id} className="scheduling-request-card">
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontWeight: 1000, fontSize: 16 }}>
                          {request.requestType === "remove" ? "Removal Request" : request.title || request.team}
                        </div>
                        <div style={{ marginTop: 4, fontSize: 13, opacity: 0.8 }}>
                          {request.team} - {fieldLabel(request.field)} - {formatLongDate(request.date)}
                        </div>
                        <div style={{ marginTop: 4, fontSize: 13, opacity: 0.8 }}>
                          {formatTimeRange(request.startTime, request.endTime)}
                        </div>
                      </div>
                      <StatusPill status={normalizeRequestStatus(request)} />
                    </div>

                    <div style={{ marginTop: 10, fontSize: 13 }}>
                      <strong>Requested by:</strong> {request.requestedBy || "Coach shared login"}
                    </div>

                    {request.notes ? (
                      <div style={{ marginTop: 8, fontSize: 13 }}>
                        <strong>Notes:</strong> {request.notes}
                      </div>
                    ) : null}

                    {request.hasConflict && request.conflictDetails?.length ? (
                      <div className="scheduling-warning-card" style={{ marginTop: 10 }}>
                        <div style={{ fontWeight: 1000 }}>Conflict details</div>
                        <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
                          {request.conflictDetails.map((detail) => (
                            <div key={detail}>{detail}</div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button className="btn" onClick={() => reviewRequest(request, "approve")} disabled={actionKey === `review:${request.id}:approve`}>
                        {actionKey === `review:${request.id}:approve` ? "Approving..." : "Approve"}
                      </button>
                      <button className="btn-danger" onClick={() => reviewRequest(request, "deny")} disabled={actionKey === `review:${request.id}:deny`}>
                        {actionKey === `review:${request.id}:deny` ? "Denying..." : "Deny"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
