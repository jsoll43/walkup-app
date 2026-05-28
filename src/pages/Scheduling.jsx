import { useEffect, useMemo, useState } from "react";

import {
  FIELD_OPTIONS,
  RESERVATION_DURATION_MINUTES,
  STATUS_META,
  addDays,
  buildCalendarItems,
  formatDayHeader,
  formatLongDate,
  formatTimeLabel,
  formatTimeRange,
  getConflictsForDraft,
  getTodayInEt,
  getWeekDates,
} from "../scheduling/utils.js";
import { downloadSchedulingMonthPdf } from "../scheduling/pdf.js";

const SCHEDULING_KEY_STORAGE = "SCHEDULING_KEY";
const SCHEDULING_ROLE_STORAGE = "SCHEDULING_ROLE";
const WEEKDAY_OPTIONS = [
  { value: 1, label: "Mondays", shortLabel: "Mon" },
  { value: 2, label: "Tuesdays", shortLabel: "Tue" },
  { value: 3, label: "Wednesdays", shortLabel: "Wed" },
  { value: 4, label: "Thursdays", shortLabel: "Thu" },
  { value: 5, label: "Fridays", shortLabel: "Fri" },
  { value: 6, label: "Saturdays", shortLabel: "Sat" },
  { value: 7, label: "Sundays", shortLabel: "Sun" },
];

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

function formatET(ts) {
  if (!ts) return "";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return String(ts);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(date);
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

function itemPrimaryLabel(item) {
  return String(item?.team || "").trim() || String(item?.title || "").trim() || "Reservation";
}

function itemSecondaryLabel(item) {
  if (!item) return "";
  const optionalTitle = String(item?.title || "").trim();
  if (optionalTitle) return optionalTitle;
  if (item.kind === "request") return "Pending approval";
  if (item.displayStatus === "maintenance") return "Blocked time";
  if (item.displayStatus === "removal_requested") return "Removal requested";
  return "";
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

function getCellKey(date, field) {
  return `${date}:${field}`;
}

function ScheduleEventCard({ item, isSelected, onSelect }) {
  const status = getCalendarStatus(item);
  const secondaryLabel = itemSecondaryLabel(item);
  return (
    <button
      type="button"
      className={[
        "schedule-block",
        item.kind === "request" ? "is-request" : "is-reservation",
        status ? `is-${status}` : "",
        isSelected ? "is-selected" : "",
      ].join(" ")}
      onClick={() => onSelect(item)}
    >
      <div className="schedule-block-topline">
        <div className="schedule-block-time">{formatTimeLabel(item.startTime)}</div>
        <StatusPill status={status} />
      </div>
      <div className="schedule-block-title">{itemPrimaryLabel(item)}</div>
      {secondaryLabel ? <div className="schedule-block-eyebrow">{secondaryLabel}</div> : null}
    </button>
  );
}

function CompactFieldCell({ cellKey, items, selectedItemKey, onSelect, expanded, onToggleExpand, blankLabel }) {
  const visibleItems = expanded ? items : items.slice(0, 3);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);
  return (
    <div className={`schedule-field-cell ${items.length === 0 ? "is-empty" : ""}`}>
      {items.length === 0 ? <div className="schedule-empty-cell">{blankLabel}</div> : null}

      {visibleItems.map((item) => (
        <ScheduleEventCard
          key={item.uniqueKey}
          item={item}
          isSelected={selectedItemKey === item.uniqueKey}
          onSelect={onSelect}
        />
      ))}

      {hiddenCount > 0 ? (
        <button type="button" className="schedule-more-button" onClick={() => onToggleExpand(cellKey)}>
          +{hiddenCount} more
        </button>
      ) : null}

      {expanded && items.length > 3 ? (
        <button type="button" className="schedule-more-button is-secondary" onClick={() => onToggleExpand(cellKey)}>
          Show less
        </button>
      ) : null}
    </div>
  );
}

function DesktopScheduleView({ weekDates, calendarItems, selectedItemKey, onSelect, expandedCells, onToggleExpand }) {
  return (
    <div className="schedule-desktop-view schedule-list-view">
      <div className="schedule-list-header">
        <div className="schedule-list-date-header">Date</div>
        <div className="schedule-list-field-header">Major Field</div>
        <div className="schedule-list-field-header">Minor Field</div>
      </div>

      <div className="schedule-list-body">
        {weekDates.map((date) => (
          <div key={`row-${date}`} className="schedule-list-row">
            <div className="schedule-list-date">{formatDayHeader(date)}</div>

            {FIELD_OPTIONS.map((field) => (
              <CompactFieldCell
                key={`${date}-${field.value}`}
                cellKey={getCellKey(date, field.value)}
                items={calendarItems.filter((item) => item.date === date && item.field === field.value)}
                selectedItemKey={selectedItemKey}
                onSelect={onSelect}
                expanded={!!expandedCells[getCellKey(date, field.value)]}
                onToggleExpand={onToggleExpand}
                blankLabel=""
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileScheduleView({ weekDates, calendarItems, selectedItemKey, onSelect, expandedCells, onToggleExpand }) {
  return (
    <div className="schedule-mobile-view schedule-mobile-week-view">
      <div className="schedule-mobile-week-list">
        {weekDates.map((date) => {
          const dayItems = calendarItems.filter((item) => item.date === date);
          const isEmptyDay = dayItems.length === 0;
          return (
            <div key={`mobile-${date}`} className={`schedule-mobile-day-card ${isEmptyDay ? "is-empty-day" : ""}`}>
              <div className="schedule-mobile-header">
                <div className="schedule-mobile-title">{formatDayHeader(date)}</div>
                {isEmptyDay ? null : (
                  <div className="schedule-field-header-row is-mobile">
                    <div className="schedule-field-header">Major Field</div>
                    <div className="schedule-field-header">Minor Field</div>
                  </div>
                )}
              </div>

              {isEmptyDay ? (
                <div className="schedule-mobile-empty-day">No events on either field.</div>
              ) : (
                <div className="schedule-mobile-columns">
                  <div className="schedule-day-body-group is-mobile">
                    {FIELD_OPTIONS.map((field) => (
                      <CompactFieldCell
                        key={`${date}-${field.value}`}
                        cellKey={getCellKey(date, field.value)}
                        items={dayItems.filter((item) => item.field === field.value)}
                        selectedItemKey={selectedItemKey}
                        onSelect={onSelect}
                        expanded={!!expandedCells[getCellKey(date, field.value)]}
                        onToggleExpand={onToggleExpand}
                        blankLabel="No events"
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
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
  hideTitle = false,
}) {
  const sortedTeams = [...teams].sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
  return (
    <div className="card scheduling-panel-card">
      {!hideTitle ? <h2 style={{ marginTop: 0 }}>{title}</h2> : null}
      <div style={{ opacity: 0.8 }}>{description}</div>

      <div className="scheduling-form-grid" style={{ marginTop: 14 }}>
        <div>
          <label className="label">Team</label>
          <select className="input" value={form.team} onChange={(e) => onChange("team", e.target.value)}>
            <option value="">Select Team</option>
            {sortedTeams.map((team) => (
              <option key={team.slug} value={team.name}>
                {team.name}
              </option>
            ))}
            {includeLeagueOption ? <option value="League / Board">League / Board</option> : null}
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
      </div>

      <div style={{ marginTop: 10, fontSize: 13, opacity: 0.75 }}>
        Every reservation automatically blocks a {RESERVATION_DURATION_MINUTES}-minute window from the selected start time.
      </div>

      <div style={{ marginTop: 12 }}>
        <label className="label">Title (optional)</label>
        <input className="input" value={form.title} onChange={(e) => onChange("title", e.target.value)} placeholder="Optional custom title" />
      </div>

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
                  <strong>Requested by:</strong> {request.requestedBy || "Coach shared login"}
                </div>
                {request.reviewedBy ? (
                  <div>
                    <strong>Reviewed by:</strong> {request.reviewedBy}
                  </div>
                ) : null}
              </div>

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

function BoardNotificationCard({
  email,
  onEmailChange,
  onSave,
  saving,
  loading,
  updatedAt,
  mailgunConfigured,
  statusMessage,
  errorMessage,
  hideTitle = false,
}) {
  return (
    <div className="card scheduling-panel-card">
      {!hideTitle ? <h2 style={{ marginTop: 0 }}>Board Email Alerts</h2> : null}
      <div style={{ opacity: 0.8 }}>
        Save an email address here to notify the board whenever a coach submits a new scheduling request.
      </div>

      <div style={{ marginTop: 14 }}>
        <label className="label">Notification Email</label>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          placeholder="board-notify@example.com"
        />
      </div>

      <div style={{ marginTop: 10, fontSize: 13, opacity: 0.75 }}>
        Leave the field blank and save if you want to stop board request emails.
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn" onClick={onSave} disabled={saving || loading}>
          {saving ? "Saving..." : loading ? "Loading..." : "Save Email"}
        </button>
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          {updatedAt ? `Last updated (ET): ${formatET(updatedAt)}` : "No notification email saved yet."}
        </div>
      </div>

      {!mailgunConfigured ? (
        <div className="scheduling-warning-card">
          Mail delivery is not configured on the server yet, so requests cannot be emailed even if an address is saved.
        </div>
      ) : null}

      {statusMessage ? (
        <div style={{ marginTop: 10, color: "#065f46", fontWeight: 700 }}>{statusMessage}</div>
      ) : null}

      {errorMessage ? (
        <div style={{ marginTop: 10, color: "crimson", fontWeight: 700 }}>{errorMessage}</div>
      ) : null}
    </div>
  );
}

function BubbleSchedulingSection({
  role,
  bubbleScheduling,
  draftEntries,
  draftComments,
  entryForm,
  commentText,
  onEntryFormChange,
  onAddEntry,
  onRemoveEntry,
  onCommentTextChange,
  onAddComment,
  onRemoveComment,
  onSave,
  saving,
}) {
  const isBoard = role === "board";
  const entries = isBoard ? draftEntries : bubbleScheduling.entries || [];
  const comments = isBoard ? draftComments : bubbleScheduling.comments || [];

  return (
    <div className="card scheduling-calendar-card bubble-scheduling-card">
      <div className="scheduling-toolbar">
        <div className="scheduling-toolbar-copy">
          <h2 style={{ margin: 0 }}>Bubble Scheduling</h2>
          <div className="scheduling-toolbar-subtitle" style={{ marginTop: 6, opacity: 0.78 }}>
            Static weekly bubble calendar. Coaches can view it, and board members can update it when the standing schedule changes.
          </div>
        </div>
        {isBoard ? (
          <button className="btn" onClick={onSave} disabled={saving}>
            {saving ? "Saving..." : "Save Bubble Schedule"}
          </button>
        ) : null}
      </div>

      {isBoard ? (
        <div className="bubble-editor">
          <div className="bubble-entry-form">
            <div>
              <label className="label">Day</label>
              <select className="input" value={entryForm.dayOfWeek} onChange={(e) => onEntryFormChange("dayOfWeek", Number(e.target.value))}>
                {WEEKDAY_OPTIONS.map((day) => (
                  <option key={day.value} value={day.value}>
                    {day.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Start</label>
              <input className="input" type="time" value={entryForm.startTime} onChange={(e) => onEntryFormChange("startTime", e.target.value)} />
            </div>
            <div>
              <label className="label">End</label>
              <input className="input" type="time" value={entryForm.endTime} onChange={(e) => onEntryFormChange("endTime", e.target.value)} />
            </div>
            <div>
              <label className="label">Title</label>
              <input className="input" value={entryForm.title} onChange={(e) => onEntryFormChange("title", e.target.value)} placeholder="12U practice" />
            </div>
            <div className="bubble-entry-notes">
              <label className="label">Notes</label>
              <input className="input" value={entryForm.notes} onChange={(e) => onEntryFormChange("notes", e.target.value)} placeholder="Optional" />
            </div>
            <div className="bubble-entry-submit">
              <button className="btn-secondary" type="button" onClick={onAddEntry}>
                Add Slot
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="bubble-week-grid">
        {WEEKDAY_OPTIONS.map((day) => {
          const dayEntries = entries.filter((entry) => Number(entry.dayOfWeek) === day.value);
          return (
            <div key={day.value} className={`bubble-day-column ${dayEntries.length === 0 ? "is-empty" : ""}`}>
              <div className="bubble-day-heading">
                <span className="bubble-day-full">{day.label}</span>
                <span className="bubble-day-short">{day.shortLabel}</span>
              </div>
              {dayEntries.length === 0 ? (
                <div className="bubble-empty">No standing bubble time.</div>
              ) : (
                dayEntries.map((entry) => (
                  <div key={entry.id} className="bubble-schedule-block">
                    <div className="bubble-schedule-time">{formatTimeRange(entry.startTime, entry.endTime)}</div>
                    <div className="bubble-schedule-title">{entry.title}</div>
                    {entry.notes ? <div className="bubble-schedule-notes">{entry.notes}</div> : null}
                    {isBoard ? (
                      <button className="bubble-remove-button" type="button" onClick={() => onRemoveEntry(entry.id)}>
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>

      <div className="bubble-comments">
        <div className="bubble-comments-heading">
          <h3 style={{ margin: 0 }}>Bubble Comments</h3>
          <div style={{ fontSize: 13, opacity: 0.72 }}>One-off township use, maintenance, or special bubble notes.</div>
        </div>

        {isBoard ? (
          <div className="bubble-comment-form">
            <textarea
              className="input bubble-comment-textarea"
              value={commentText}
              onChange={(e) => onCommentTextChange(e.target.value)}
              placeholder="bubble used for Barrington fun day on 5/2-5/3"
            />
            <button className="btn-secondary" type="button" onClick={onAddComment}>
              Add Comment
            </button>
          </div>
        ) : null}

        {comments.length === 0 ? (
          <div className="bubble-empty-comment">No bubble comments have been posted.</div>
        ) : (
          <div className="bubble-comment-list">
            {comments.map((comment) => (
              <div key={comment.id} className="bubble-comment-item">
                <div>{comment.text}</div>
                <div className="bubble-comment-meta">
                  {comment.createdAt ? `Added ${formatET(comment.createdAt)}` : "Bubble note"}
                  {isBoard ? (
                    <button type="button" onClick={() => onRemoveComment(comment.id)}>
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BoardActionQueueCard({ pendingRequests, actionKey, onReviewRequest, hideTitle = false }) {
  return (
    <div className="card scheduling-panel-card">
      {!hideTitle ? <h2 style={{ marginTop: 0 }}>Board Action Queue ({pendingRequests.length})</h2> : null}
      {pendingRequests.length === 0 ? (
        <div style={{ opacity: 0.75 }}>There are currently no pending requests.</div>
      ) : (
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
                <button className="btn" onClick={() => onReviewRequest(request, "approve")} disabled={actionKey === `review:${request.id}:approve`}>
                  {actionKey === `review:${request.id}:approve` ? "Approving..." : "Approve"}
                </button>
                <button className="btn-danger" onClick={() => onReviewRequest(request, "deny")} disabled={actionKey === `review:${request.id}:deny`}>
                  {actionKey === `review:${request.id}:deny` ? "Denying..." : "Deny"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MobileAccordionCard({ title, children }) {
  return (
    <details className="card scheduling-mobile-accordion">
      <summary className="scheduling-mobile-accordion-summary">
        <span className="scheduling-mobile-accordion-title">{title}</span>
        <span className="scheduling-mobile-accordion-icon" aria-hidden="true" />
      </summary>
      <div className="scheduling-mobile-accordion-body">{children}</div>
    </details>
  );
}

function SelectedScheduleItemCard({
  item,
  role,
  onRequestRemoval,
  onDeleteReservation,
  onReviewRequest,
  actionKey,
}) {
  if (!item) return null;

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
          <div className="scheduling-detail-label">Source</div>
          <div>{isReservation ? "Reservation" : "Pending Request"}</div>
        </div>
      </div>

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
          <button className="btn-danger" onClick={() => onRequestRemoval(item)} disabled={actionKey === removalKey}>
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
  const [expandedCells, setExpandedCells] = useState({});
  const [pdfMonth, setPdfMonth] = useState(today.slice(0, 7));
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [conflictModal, setConflictModal] = useState(null);
  const [boardNotificationEmail, setBoardNotificationEmail] = useState("");
  const [boardNotificationLoading, setBoardNotificationLoading] = useState(false);
  const [boardNotificationSaving, setBoardNotificationSaving] = useState(false);
  const [boardNotificationUpdatedAt, setBoardNotificationUpdatedAt] = useState("");
  const [boardNotificationMailgunConfigured, setBoardNotificationMailgunConfigured] = useState(true);
  const [boardNotificationStatus, setBoardNotificationStatus] = useState("");
  const [boardNotificationError, setBoardNotificationError] = useState("");
  const [scheduleData, setScheduleData] = useState({
    teams: [],
    reservations: [],
    requests: [],
    pendingRequests: [],
    bubbleScheduling: {
      entries: [],
      comments: [],
      updatedAt: "",
    },
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
    field: "major",
    date: today,
    startTime: "17:00",
  });
  const [boardForm, setBoardForm] = useState({
    team: "",
    title: "",
    field: "major",
    date: today,
    startTime: "17:00",
  });
  const [bubbleEntriesDraft, setBubbleEntriesDraft] = useState([]);
  const [bubbleCommentsDraft, setBubbleCommentsDraft] = useState([]);
  const [bubbleEntryForm, setBubbleEntryForm] = useState({
    dayOfWeek: 1,
    title: "",
    startTime: "17:00",
    endTime: "18:00",
    notes: "",
  });
  const [bubbleCommentText, setBubbleCommentText] = useState("");
  const [showBubbleSchedule, setShowBubbleSchedule] = useState(false);

  const { teams, reservations, requests, pendingRequests, summary, bubbleScheduling } = scheduleData;
  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);
  const calendarItems = useMemo(() => buildCalendarItems(reservations, requests), [reservations, requests]);
  const weekItems = useMemo(
    () => calendarItems.filter((item) => weekDates.includes(item.date)),
    [calendarItems, weekDates]
  );
  const selectedItem = useMemo(
    () => calendarItems.find((item) => item.uniqueKey === selectedItemKey) || null,
    [calendarItems, selectedItemKey]
  );
  const coachConflictPreview = useMemo(() => getConflictsForDraft(coachForm, calendarItems), [coachForm, calendarItems]);
  const boardConflictPreview = useMemo(() => getConflictsForDraft(boardForm, calendarItems), [boardForm, calendarItems]);

  useEffect(() => {
    if (selectedItemKey && !calendarItems.some((item) => item.uniqueKey === selectedItemKey)) {
      setSelectedItemKey("");
    }
  }, [calendarItems, selectedItemKey]);

  useEffect(() => {
    setBubbleEntriesDraft(Array.isArray(bubbleScheduling?.entries) ? bubbleScheduling.entries : []);
    setBubbleCommentsDraft(Array.isArray(bubbleScheduling?.comments) ? bubbleScheduling.comments : []);
  }, [bubbleScheduling]);

  useEffect(() => {
    setPdfMonth(String(selectedDate || "").slice(0, 7));
  }, [selectedDate]);

  useEffect(() => {
    if (!isAuthed || authRole !== "board" || !authKey) return;
    let active = true;

    async function loadBoardNotificationSettings() {
      setBoardNotificationLoading(true);
      setBoardNotificationError("");
      try {
        const res = await fetch("/api/scheduling/notification-settings", {
          headers: schedulingHeaders(authRole, authKey),
        });
        const data = await safeJsonOrText(res);
        if (!res.ok || data?.ok === false) {
          throw new Error(data?.error || data?.raw || "Failed to load board notification settings.");
        }
        if (!active) return;
        setBoardNotificationEmail(String(data?.settings?.email || ""));
        setBoardNotificationUpdatedAt(String(data?.settings?.updatedAt || ""));
        setBoardNotificationMailgunConfigured(Boolean(data?.settings?.mailgunConfigured));
      } catch (e) {
        if (!active) return;
        setBoardNotificationError(e?.message || String(e));
      } finally {
        if (active) setBoardNotificationLoading(false);
      }
    }

    loadBoardNotificationSettings().catch(() => {});
    return () => {
      active = false;
    };
  }, [isAuthed, authRole, authKey]);

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
        bubbleScheduling: {
          entries: Array.isArray(data?.bubbleScheduling?.entries) ? data.bubbleScheduling.entries : [],
          comments: Array.isArray(data?.bubbleScheduling?.comments) ? data.bubbleScheduling.comments : [],
          updatedAt: String(data?.bubbleScheduling?.updatedAt || ""),
        },
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
    setExpandedCells({});
    setError("");
    setSuccess("");
    setBoardNotificationEmail("");
    setBoardNotificationUpdatedAt("");
    setBoardNotificationStatus("");
    setBoardNotificationError("");
  }

  function toggleExpandCell(cellKey) {
    setExpandedCells((current) => ({
      ...current,
      [cellKey]: !current[cellKey],
    }));
  }

  function openPdfExportModal() {
    setPdfMonth(String(selectedDate || today).slice(0, 7));
    setShowPdfModal(true);
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

  function updateBubbleEntryForm(field, value) {
    setBubbleEntryForm((current) => ({ ...current, [field]: value }));
  }

  function sortBubbleEntries(entries) {
    return [...entries].sort((a, b) => {
      if (Number(a.dayOfWeek) !== Number(b.dayOfWeek)) return Number(a.dayOfWeek) - Number(b.dayOfWeek);
      const startCompare = String(a.startTime || "").localeCompare(String(b.startTime || ""));
      if (startCompare !== 0) return startCompare;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
  }

  function addBubbleEntry() {
    const title = bubbleEntryForm.title.trim();
    if (!title) {
      setError("Enter a title for the bubble schedule slot.");
      return;
    }
    if (!bubbleEntryForm.startTime || !bubbleEntryForm.endTime || bubbleEntryForm.endTime <= bubbleEntryForm.startTime) {
      setError("Choose a valid bubble start and end time.");
      return;
    }

    setError("");
    const id = `bubble_${crypto?.randomUUID ? crypto.randomUUID() : Date.now()}`;
    setBubbleEntriesDraft((current) =>
      sortBubbleEntries([
        ...current,
        {
          id,
          dayOfWeek: Number(bubbleEntryForm.dayOfWeek),
          title,
          startTime: bubbleEntryForm.startTime,
          endTime: bubbleEntryForm.endTime,
          notes: bubbleEntryForm.notes.trim(),
        },
      ])
    );
    setBubbleEntryForm((current) => ({ ...current, title: "", notes: "" }));
  }

  function removeBubbleEntry(entryId) {
    setBubbleEntriesDraft((current) => current.filter((entry) => entry.id !== entryId));
  }

  function addBubbleComment() {
    const text = bubbleCommentText.trim();
    if (!text) {
      setError("Enter a bubble comment before adding it.");
      return;
    }

    setError("");
    const id = `bubble_comment_${crypto?.randomUUID ? crypto.randomUUID() : Date.now()}`;
    setBubbleCommentsDraft((current) => [{ id, text, createdAt: new Date().toISOString() }, ...current]);
    setBubbleCommentText("");
  }

  function removeBubbleComment(commentId) {
    setBubbleCommentsDraft((current) => current.filter((comment) => comment.id !== commentId));
  }

  async function saveBubbleSchedule() {
    setActionKey("bubble-save");
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/scheduling/bubble", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...schedulingHeaders(authRole, authKey),
        },
        body: JSON.stringify({
          entries: bubbleEntriesDraft,
          comments: bubbleCommentsDraft,
        }),
      });
      const data = await safeJsonOrText(res);
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.raw || "Failed to save the bubble schedule.");
      }

      const nextBubbleScheduling = {
        entries: Array.isArray(data?.bubbleScheduling?.entries) ? data.bubbleScheduling.entries : [],
        comments: Array.isArray(data?.bubbleScheduling?.comments) ? data.bubbleScheduling.comments : [],
        updatedAt: String(data?.bubbleScheduling?.updatedAt || ""),
      };
      setScheduleData((current) => ({
        ...current,
        bubbleScheduling: nextBubbleScheduling,
      }));
      setSuccess("Bubble schedule saved.");
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setActionKey("");
    }
  }

  function toggleSelectedItem(item) {
    setSelectedItemKey((current) => (current === item.uniqueKey ? "" : item.uniqueKey));
  }

  function openConflictModal({ submitType, conflicts, title }) {
    setConflictModal({
      submitType,
      conflicts,
      title,
    });
  }

  async function performCoachAddRequest() {
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
      setCoachForm((current) => ({ ...current, team: "", title: "" }));
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setActionKey("");
    }
  }

  async function performBoardReservation() {
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
      setBoardForm((current) => ({ ...current, team: "", title: "" }));
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setActionKey("");
    }
  }

  async function submitCoachAddRequest() {
    if (coachConflictPreview.length > 0) {
      openConflictModal({
        submitType: "coach-add",
        conflicts: coachConflictPreview,
        title: coachForm.title || coachForm.team || "Coach request",
      });
      return;
    }
    await performCoachAddRequest();
  }

  async function submitBoardReservation() {
    if (boardConflictPreview.length > 0) {
      openConflictModal({
        submitType: "board-add",
        conflicts: boardConflictPreview,
        title: boardForm.title || boardForm.team || "Board reservation",
      });
      return;
    }
    await performBoardReservation();
  }

  async function confirmConflictSubmission() {
    const submitType = conflictModal?.submitType;
    setConflictModal(null);
    if (submitType === "coach-add") {
      await performCoachAddRequest();
      return;
    }
    if (submitType === "board-add") {
      await performBoardReservation();
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
        }),
      });
      const data = await safeJsonOrText(res);
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.raw || "Failed to submit the removal request.");
      }
      setSuccess("Removal request submitted for board review.");
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

  async function saveBoardNotificationEmail() {
    setBoardNotificationSaving(true);
    setBoardNotificationError("");
    setBoardNotificationStatus("");
    try {
      const res = await fetch("/api/scheduling/notification-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...schedulingHeaders(authRole, authKey),
        },
        body: JSON.stringify({
          email: boardNotificationEmail,
        }),
      });
      const data = await safeJsonOrText(res);
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || data?.raw || "Failed to save the board notification email.");
      }

      setBoardNotificationEmail(String(data?.settings?.email || ""));
      setBoardNotificationUpdatedAt(String(data?.settings?.updatedAt || ""));
      setBoardNotificationMailgunConfigured(Boolean(data?.settings?.mailgunConfigured));
      setBoardNotificationStatus(data?.message || "Board notification email saved.");
    } catch (e) {
      setBoardNotificationError(e?.message || String(e));
    } finally {
      setBoardNotificationSaving(false);
    }
  }

  function handleDownloadMonthPdf() {
    setError("");
    setSuccess("");
    setPdfExporting(true);
    try {
      downloadSchedulingMonthPdf({
        month: pdfMonth,
        items: calendarItems,
      });
      setShowPdfModal(false);
      setSuccess("Calendar view PDF downloaded.");
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setPdfExporting(false);
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
            Weekly field reservations on desktop, day timeline on mobile, and a shared approval queue for coach requests. Each reservation holds a fixed 90-minute block.
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
          <div className="scheduling-toolbar-copy">
            <h2 style={{ margin: 0 }}>Schedule</h2>
          </div>

          <div className="scheduling-export-controls">
            <button className="btn" onClick={openPdfExportModal} disabled={pdfExporting}>
              {pdfExporting ? (
                "Preparing PDF..."
              ) : (
                <>
                  <span className="scheduling-export-label-desktop">Download Calendar View PDF</span>
                  <span className="scheduling-export-label-mobile">Calendar View PDF</span>
                </>
              )}
            </button>
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
          <input
            className="input scheduling-week-picker"
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            aria-label="Choose a date to jump to that week"
          />
        </div>

        <div className="scheduling-legend">
          <div className="scheduling-legend-label">Sample Statuses:</div>
          <StatusPill status="approved" />
          <StatusPill status="pending" />
          <StatusPill status="conflict" />
          <StatusPill status="maintenance" />
          <StatusPill status="removal_requested" />
        </div>

        <DesktopScheduleView
          weekDates={weekDates}
          calendarItems={weekItems}
          selectedItemKey={selectedItemKey}
          onSelect={toggleSelectedItem}
          expandedCells={expandedCells}
          onToggleExpand={toggleExpandCell}
        />

        <MobileScheduleView
          weekDates={weekDates}
          calendarItems={calendarItems}
          selectedItemKey={selectedItemKey}
          onSelect={toggleSelectedItem}
          expandedCells={expandedCells}
          onToggleExpand={toggleExpandCell}
        />
      </div>

      {selectedItem ? (
        <div className="scheduling-selected-mobile">
          <SelectedScheduleItemCard
            item={selectedItem}
            role={authRole}
            onRequestRemoval={requestRemoval}
            onDeleteReservation={removeReservation}
            onReviewRequest={reviewRequest}
            actionKey={actionKey}
          />
        </div>
      ) : null}

      {authRole === "board" ? (
        <div className="scheduling-board-mobile-stack">
          <MobileAccordionCard title={`Board Action Queue (${pendingRequests.length})`}>
            <BoardActionQueueCard pendingRequests={pendingRequests} actionKey={actionKey} onReviewRequest={reviewRequest} hideTitle />
          </MobileAccordionCard>

          <MobileAccordionCard title="Add Approved Reservation (Board Only)">
            <ReservationFormCard
              title="Add Approved Reservation (Board Only)"
              description="Place 90-minute reservations directly on the schedule without approval."
              form={boardForm}
              onChange={updateBoardForm}
              onSubmit={submitBoardReservation}
              submitLabel="Add Reservation"
              submitting={actionKey === "board-add"}
              teams={teams}
              includeLeagueOption
              hideTitle
            />
          </MobileAccordionCard>

          <MobileAccordionCard title="Board Email Alerts">
            <BoardNotificationCard
              email={boardNotificationEmail}
              onEmailChange={setBoardNotificationEmail}
              onSave={saveBoardNotificationEmail}
              saving={boardNotificationSaving}
              loading={boardNotificationLoading}
              updatedAt={boardNotificationUpdatedAt}
              mailgunConfigured={boardNotificationMailgunConfigured}
              statusMessage={boardNotificationStatus}
              errorMessage={boardNotificationError}
              hideTitle
            />
          </MobileAccordionCard>
        </div>
      ) : null}

      <div className={`scheduling-panels ${authRole === "board" ? "is-board" : ""}`}>
        <div className="scheduling-panel-stack">
          {authRole === "coach" ? (
            <>
              <ReservationFormCard
                title="Request Field Time"
                description="Coaches can submit a 90-minute field reservation request for board approval. Conflicts are warned, but still allowed."
                form={coachForm}
                onChange={updateCoachForm}
                onSubmit={submitCoachAddRequest}
                submitLabel="Submit Coach Request"
                submitting={actionKey === "coach-add"}
                teams={teams}
                includeLeagueOption={false}
              />

              <RequestHistoryCard
                heading="Coach Requests"
                emptyText="No coach scheduling requests have been submitted yet."
                requests={requests}
              />
            </>
          ) : (
            <div className="scheduling-board-desktop-only">
              <ReservationFormCard
                title="Add Approved Reservation (Board Only)"
                description="Place 90-minute reservations directly on the schedule without approval."
                form={boardForm}
                onChange={updateBoardForm}
                onSubmit={submitBoardReservation}
                submitLabel="Add Reservation"
                submitting={actionKey === "board-add"}
                teams={teams}
                includeLeagueOption
              />

              <BoardNotificationCard
                email={boardNotificationEmail}
                onEmailChange={setBoardNotificationEmail}
                onSave={saveBoardNotificationEmail}
                saving={boardNotificationSaving}
                loading={boardNotificationLoading}
                updatedAt={boardNotificationUpdatedAt}
                mailgunConfigured={boardNotificationMailgunConfigured}
                statusMessage={boardNotificationStatus}
                errorMessage={boardNotificationError}
              />
            </div>
          )}
        </div>

        <div className="scheduling-panel-stack">
          {selectedItem ? (
            <div className="scheduling-selected-desktop">
              <SelectedScheduleItemCard
                item={selectedItem}
                role={authRole}
                onRequestRemoval={requestRemoval}
                onDeleteReservation={removeReservation}
                onReviewRequest={reviewRequest}
                actionKey={actionKey}
              />
            </div>
          ) : null}

          {authRole === "board" ? (
            <div className="scheduling-board-desktop-only">
              <BoardActionQueueCard pendingRequests={pendingRequests} actionKey={actionKey} onReviewRequest={reviewRequest} />
            </div>
          ) : null}
        </div>
      </div>

      <div className="card bubble-schedule-toggle-card">
        <div>
          <h2 style={{ margin: 0 }}>Bubble Schedule</h2>
          <div style={{ marginTop: 6, opacity: 0.78 }}>
            Standing bubble times and bubble notes are kept below the main field scheduling tools.
          </div>
        </div>
        <button className="btn" type="button" onClick={() => setShowBubbleSchedule((value) => !value)}>
          {showBubbleSchedule ? "Hide Bubble Schedule" : "Show Bubble Schedule"}
        </button>
      </div>

      {showBubbleSchedule ? (
        <BubbleSchedulingSection
          role={authRole}
          bubbleScheduling={bubbleScheduling}
          draftEntries={bubbleEntriesDraft}
          draftComments={bubbleCommentsDraft}
          entryForm={bubbleEntryForm}
          commentText={bubbleCommentText}
          onEntryFormChange={updateBubbleEntryForm}
          onAddEntry={addBubbleEntry}
          onRemoveEntry={removeBubbleEntry}
          onCommentTextChange={setBubbleCommentText}
          onAddComment={addBubbleComment}
          onRemoveComment={removeBubbleComment}
          onSave={saveBubbleSchedule}
          saving={actionKey === "bubble-save"}
        />
      ) : null}

      {showPdfModal ? (
        <div className="scheduling-modal-overlay" onClick={() => (pdfExporting ? null : setShowPdfModal(false))}>
          <div
            className="card scheduling-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="scheduling-pdf-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="scheduling-pdf-modal-title" style={{ marginTop: 0, marginBottom: 8 }}>
              Download Calendar View PDF
            </h3>
            <div style={{ opacity: 0.78, marginBottom: 14 }}>
              Choose the month to export as a single-page calendar snapshot of the schedule.
            </div>

            <div>
              <label className="label">Month</label>
              <input
                className="input scheduling-month-picker"
                type="month"
                value={pdfMonth}
                onChange={(e) => setPdfMonth(e.target.value)}
                aria-label="Choose the month to export as a calendar PDF"
              />
            </div>

            <div className="scheduling-modal-actions">
              <button className="btn-secondary" onClick={() => setShowPdfModal(false)} disabled={pdfExporting}>
                Cancel
              </button>
              <button className="btn" onClick={handleDownloadMonthPdf} disabled={pdfExporting}>
                {pdfExporting ? "Preparing PDF..." : "Download Calendar View PDF"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {conflictModal ? (
        <div className="scheduling-modal-overlay" onClick={() => (actionKey ? null : setConflictModal(null))}>
          <div
            className="card scheduling-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="scheduling-conflict-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="scheduling-conflict-modal-title" style={{ marginTop: 0, marginBottom: 8 }}>
              Are you sure? There is a conflict.
            </h3>
            <div style={{ opacity: 0.78 }}>
              {conflictModal.title
                ? `${conflictModal.title} overlaps existing field use or another pending request on the same field.`
                : "This selection overlaps existing field use or another pending request on the same field."}
            </div>

            {conflictModal.conflicts?.length ? (
              <div className="scheduling-warning-card" style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 1000, marginBottom: 6 }}>Conflict details</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {conflictModal.conflicts.map((detail) => (
                    <div key={detail}>{detail}</div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="scheduling-modal-actions">
              <button className="btn-secondary" onClick={() => setConflictModal(null)} disabled={!!actionKey}>
                Cancel
              </button>
              <button className="btn" onClick={confirmConflictSubmission} disabled={!!actionKey}>
                {actionKey === "coach-add" || actionKey === "board-add" ? "Saving..." : "Yes, Submit Anyway"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
