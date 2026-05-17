const ROLE_LABELS = {
  coach: "Coach",
  board: "Board Member",
};

const FIELD_LABELS = {
  major: "Major Field",
  minor: "Minor Field",
};

const RESERVATION_TYPE_LABELS = {
  practice: "Practice",
  game: "Game",
  tournament: "Tournament",
  clinic: "Clinic",
  maintenance: "Maintenance / Field Closed",
  other: "Other",
};

const textEncoder = new TextEncoder();

function nowIso() {
  return new Date().toISOString();
}

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function getAdminKey(req) {
  const h = req.headers;
  const bearer = (h.get("authorization") || "").trim();
  if (bearer.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  return (h.get("x-admin-key") || "").trim();
}

export function getSchedulingRole(req) {
  return normalizeRole(req.headers.get("x-scheduling-role") || req.headers.get("x-role") || "");
}

export function getSchedulingSecret(req) {
  const h = req.headers;
  const bearer = (h.get("authorization") || "").trim();
  if (bearer.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  return (h.get("x-scheduling-key") || "").trim();
}

export function normalizeRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return role === "coach" || role === "board" ? role : "";
}

export function roleLabel(role) {
  return ROLE_LABELS[normalizeRole(role)] || "Scheduling User";
}

export function normalizeField(value) {
  const field = String(value || "").trim().toLowerCase();
  return field === "major" || field === "minor" ? field : "";
}

export function fieldLabel(field) {
  return FIELD_LABELS[normalizeField(field)] || "Field";
}

export function normalizeRequestType(value) {
  const requestType = String(value || "").trim().toLowerCase();
  return requestType === "add" || requestType === "remove" ? requestType : "";
}

export function normalizeReservationType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "practice";
  if (raw === "maintenance / field closed" || raw === "field closed") return "maintenance";
  if (RESERVATION_TYPE_LABELS[raw]) return raw;
  return "other";
}

export function reservationTypeLabel(type) {
  return RESERVATION_TYPE_LABELS[normalizeReservationType(type)] || "Other";
}

export function normalizeDateInput(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";

  const [yearText, monthText, dayText] = raw.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(candidate.getTime()) ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return "";
  }

  return raw;
}

export function normalizeTimeInput(value) {
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
  const normalized = normalizeTimeInput(value);
  if (!normalized) return Number.NaN;
  const [hourText, minuteText] = normalized.split(":");
  return Number(hourText) * 60 + Number(minuteText);
}

export function intervalsOverlap(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

export function scheduleEntriesOverlap(a, b) {
  if (!a || !b) return false;
  if (a.date !== b.date || a.field !== b.field) return false;

  const startA = timeToMinutes(a.startTime);
  const endA = timeToMinutes(a.endTime);
  const startB = timeToMinutes(b.startTime);
  const endB = timeToMinutes(b.endTime);

  if (![startA, endA, startB, endB].every(Number.isFinite)) return false;
  return intervalsOverlap(startA, endA, startB, endB);
}

function makeTitle(team, reservationType, title) {
  const cleanTitle = String(title || "").trim();
  if (cleanTitle) return cleanTitle;

  const cleanTeam = String(team || "").trim();
  const typeLabel = reservationTypeLabel(reservationType);
  if (cleanTeam && typeLabel) return `${cleanTeam} ${typeLabel}`;
  if (cleanTeam) return cleanTeam;
  return typeLabel || "Field Reservation";
}

export function normalizeScheduleDraft(body, options = {}) {
  const teamRequired = options.teamRequired !== false;
  const fallbackTeam = String(options.fallbackTeam || "League").trim() || "League";

  const field = normalizeField(body?.field);
  const reservationType = normalizeReservationType(body?.reservationType || body?.reservation_type);
  const date = normalizeDateInput(body?.date);
  const startTime = normalizeTimeInput(body?.startTime || body?.start_time);
  const endTime = normalizeTimeInput(body?.endTime || body?.end_time);
  const teamRaw = String(body?.team || "").trim();
  const team = teamRaw || fallbackTeam;
  const title = makeTitle(team, reservationType, body?.title);
  const notes = String(body?.notes || "").trim();

  if (!field) return { error: "Choose a valid field." };
  if (teamRequired && !teamRaw) return { error: "Team is required." };
  if (!date) return { error: "Choose a valid date." };
  if (!startTime) return { error: "Choose a valid start time." };
  if (!endTime) return { error: "Choose a valid end time." };

  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || endMinutes <= startMinutes) {
    return { error: "End time must be after start time." };
  }

  return {
    value: {
      field,
      team,
      title,
      reservationType,
      date,
      startTime,
      endTime,
      notes,
    },
  };
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64Value) {
  const binary = atob(String(base64Value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function derivePasswordBytes(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(String(password || "")),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations,
    },
    key,
    256
  );

  return new Uint8Array(bits);
}

export async function hashSchedulingPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 120000;
  const digest = await derivePasswordBytes(String(password || ""), salt, iterations);
  return `pbkdf2$sha256$${iterations}$${bytesToBase64(salt)}$${bytesToBase64(digest)}`;
}

export async function verifySchedulingPassword(password, storedHash) {
  const cleanHash = String(storedHash || "").trim();
  if (!cleanHash) return false;

  const [scheme, hashName, iterationsText, saltBase64, digestBase64] = cleanHash.split("$");
  if (scheme !== "pbkdf2" || hashName !== "sha256" || !iterationsText || !saltBase64 || !digestBase64) {
    return false;
  }

  const iterations = Number(iterationsText);
  if (!Number.isInteger(iterations) || iterations < 1000) return false;

  const salt = base64ToBytes(saltBase64);
  const expected = base64ToBytes(digestBase64);
  const actual = await derivePasswordBytes(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

async function run(env, sql, binds = []) {
  const stmt = env.DB.prepare(sql);
  return binds.length ? stmt.bind(...binds).run() : stmt.run();
}

async function all(env, sql, binds = []) {
  const stmt = env.DB.prepare(sql);
  const res = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
  return res?.results || [];
}

async function first(env, sql, binds = []) {
  const stmt = env.DB.prepare(sql);
  return binds.length ? stmt.bind(...binds).first() : stmt.first();
}

function parseConflictDetails(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
  } catch {
    return String(value || "").trim() ? [String(value).trim()] : [];
  }
}

function rowToReservation(row) {
  return {
    id: row.id,
    field: row.field,
    team: row.team,
    title: row.title,
    reservationType: row.reservation_type,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    notes: row.notes || "",
    createdByRole: row.created_by_role || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

function rowToRequest(row) {
  return {
    id: row.id,
    requestType: row.request_type,
    reservationId: row.reservation_id || "",
    field: row.field,
    team: row.team,
    title: row.title,
    reservationType: row.reservation_type,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    notes: row.notes || "",
    status: row.status,
    hasConflict: !!row.has_conflict,
    conflictDetails: parseConflictDetails(row.conflict_details),
    requestedBy: row.requested_by || "",
    requestedAt: row.requested_at || "",
    reviewedBy: row.reviewed_by || "",
    reviewedAt: row.reviewed_at || "",
  };
}

function describeScheduleItem(entry, kind) {
  const label = String(entry?.title || "").trim() || String(entry?.team || "").trim() || reservationTypeLabel(entry?.reservationType);
  const statusLabel =
    kind === "request"
      ? "pending request"
      : entry?.status === "maintenance"
      ? "blocked time"
      : "approved reservation";

  return `${label} on ${fieldLabel(entry?.field)} from ${entry?.startTime} to ${entry?.endTime} (${statusLabel})`;
}

function sortReservations(list) {
  return [...list].sort((a, b) => {
    const dateCompare = String(a.date || "").localeCompare(String(b.date || ""));
    if (dateCompare !== 0) return dateCompare;

    const fieldCompare = String(a.field || "").localeCompare(String(b.field || ""));
    if (fieldCompare !== 0) return fieldCompare;

    const startCompare = String(a.startTime || "").localeCompare(String(b.startTime || ""));
    if (startCompare !== 0) return startCompare;

    return String(a.team || "").localeCompare(String(b.team || ""));
  });
}

function sortRequests(list) {
  return [...list].sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")));
}

function buildSchedulingStateFromRows(rawReservations, rawRequests, teams) {
  const reservations = rawReservations.map(rowToReservation);
  const requests = rawRequests.map(rowToRequest);
  const pendingAddRequests = requests.filter((item) => item.status === "pending" && item.requestType === "add");
  const pendingRemovalByReservation = new Map();

  for (const request of requests) {
    if (request.status === "pending" && request.requestType === "remove" && request.reservationId) {
      pendingRemovalByReservation.set(request.reservationId, request);
    }
  }

  const conflictMap = new Map();
  const itemsForConflicts = [
    ...reservations.map((item) => ({ ...item, _kind: "reservation", _conflictKey: `reservation:${item.id}` })),
    ...pendingAddRequests.map((item) => ({ ...item, _kind: "request", _conflictKey: `request:${item.id}` })),
  ];

  for (let i = 0; i < itemsForConflicts.length; i += 1) {
    for (let j = i + 1; j < itemsForConflicts.length; j += 1) {
      const current = itemsForConflicts[i];
      const other = itemsForConflicts[j];
      if (!scheduleEntriesOverlap(current, other)) continue;

      const currentList = conflictMap.get(current._conflictKey) || [];
      currentList.push(`Conflicts with ${describeScheduleItem(other, other._kind)}`);
      conflictMap.set(current._conflictKey, currentList);

      const otherList = conflictMap.get(other._conflictKey) || [];
      otherList.push(`Conflicts with ${describeScheduleItem(current, current._kind)}`);
      conflictMap.set(other._conflictKey, otherList);
    }
  }

  const enrichedReservations = sortReservations(
    reservations.map((reservation) => {
      const conflictDetails = conflictMap.get(`reservation:${reservation.id}`) || [];
      const pendingRemoval = pendingRemovalByReservation.get(reservation.id) || null;
      const normalizedStatus = reservation.status === "maintenance" ? "maintenance" : "approved";
      let displayStatus = normalizedStatus;

      if (pendingRemoval) {
        displayStatus = "removal_requested";
      } else if (normalizedStatus === "maintenance") {
        displayStatus = "maintenance";
      } else if (conflictDetails.length > 0) {
        displayStatus = "conflict";
      }

      return {
        ...reservation,
        hasConflict: conflictDetails.length > 0,
        conflictDetails,
        hasPendingRemoval: !!pendingRemoval,
        pendingRemovalRequestId: pendingRemoval?.id || "",
        pendingRemovalRequestedAt: pendingRemoval?.requestedAt || "",
        displayStatus,
      };
    })
  );

  const enrichedRequests = sortRequests(
    requests.map((request) => {
      const liveConflictDetails =
        request.status === "pending" && request.requestType === "add"
          ? conflictMap.get(`request:${request.id}`) || []
          : request.conflictDetails;
      const hasConflict = request.status === "pending" && request.requestType === "add"
        ? liveConflictDetails.length > 0
        : !!request.hasConflict;

      return {
        ...request,
        hasConflict,
        conflictDetails: liveConflictDetails,
        displayStatus:
          request.status === "pending"
            ? hasConflict && request.requestType === "add"
              ? "conflict"
              : "pending"
            : request.status,
      };
    })
  );

  const pendingRequests = enrichedRequests.filter((request) => request.status === "pending");
  const summary = {
    approvedReservations: enrichedReservations.length,
    pendingAddRequests: pendingRequests.filter((request) => request.requestType === "add").length,
    pendingRemovalRequests: pendingRequests.filter((request) => request.requestType === "remove").length,
    conflicts:
      enrichedReservations.filter((item) => item.hasConflict).length +
      enrichedRequests.filter((item) => item.status === "pending" && item.hasConflict).length,
  };

  return {
    teams: [...teams].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))),
    reservations: enrichedReservations,
    requests: enrichedRequests,
    pendingRequests,
    summary,
  };
}

export async function ensureSchedulingTables(env) {
  if (!env?.DB) {
    throw new Error("D1 binding DB is missing (env.DB is undefined)");
  }

  const statements = [
    `CREATE TABLE IF NOT EXISTS scheduling_settings (
      id TEXT PRIMARY KEY,
      coach_password_hash TEXT NOT NULL DEFAULT '',
      board_password_hash TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS field_reservations (
      id TEXT PRIMARY KEY,
      field TEXT NOT NULL,
      team TEXT NOT NULL,
      title TEXT NOT NULL,
      reservation_type TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL,
      notes TEXT,
      created_by_role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_field_reservations_schedule
      ON field_reservations(date, field, start_time, end_time)`,
    `CREATE TABLE IF NOT EXISTS field_requests (
      id TEXT PRIMARY KEY,
      request_type TEXT NOT NULL,
      reservation_id TEXT,
      field TEXT NOT NULL,
      team TEXT NOT NULL,
      title TEXT NOT NULL,
      reservation_type TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL,
      has_conflict INTEGER NOT NULL DEFAULT 0,
      conflict_details TEXT NOT NULL DEFAULT '[]',
      requested_by TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      reviewed_by TEXT,
      reviewed_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_field_requests_status
      ON field_requests(status, requested_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_field_requests_schedule
      ON field_requests(date, field, start_time, end_time)`,
  ];

  for (const sql of statements) {
    await env.DB.prepare(sql).run();
  }
}

export async function getSchedulingSettings(env) {
  await ensureSchedulingTables(env);

  const row = await first(
    env,
    `SELECT coach_password_hash, board_password_hash, updated_at
     FROM scheduling_settings
     WHERE id = 'singleton'`
  );

  return {
    coachPasswordHash: row?.coach_password_hash || "",
    boardPasswordHash: row?.board_password_hash || "",
    updatedAt: row?.updated_at || "",
  };
}

export async function getSchedulingSettingsSummary(env) {
  const settings = await getSchedulingSettings(env);
  return {
    coachPasswordConfigured: !!settings.coachPasswordHash,
    boardPasswordConfigured: !!settings.boardPasswordHash,
    updatedAt: settings.updatedAt,
  };
}

export async function setSchedulingPassword(env, role, password) {
  const normalizedRole = normalizeRole(role);
  const cleanPassword = String(password || "").trim();

  if (!normalizedRole) throw new Error("Invalid scheduling role.");
  if (cleanPassword.length < 4) throw new Error("Password must be at least 4 characters.");

  await ensureSchedulingTables(env);

  const hash = await hashSchedulingPassword(cleanPassword);
  const updatedAt = nowIso();
  const column = normalizedRole === "coach" ? "coach_password_hash" : "board_password_hash";

  await run(
    env,
    `INSERT INTO scheduling_settings (id, ${column}, updated_at)
     VALUES ('singleton', ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       ${column} = excluded.${column},
       updated_at = excluded.updated_at`,
    [hash, updatedAt]
  );

  return getSchedulingSettingsSummary(env);
}

export async function verifySchedulingAuth(request, env, allowedRoles = []) {
  await ensureSchedulingTables(env);

  const role = getSchedulingRole(request);
  const secret = getSchedulingSecret(request);
  if (!role) {
    return { ok: false, status: 401, error: "Missing scheduling role." };
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(role)) {
    return { ok: false, status: 403, error: "You do not have access to that scheduling action." };
  }

  if (!secret) {
    return { ok: false, status: 401, error: `${roleLabel(role)} scheduling password is required.` };
  }

  const settings = await getSchedulingSettings(env);
  const storedHash = role === "coach" ? settings.coachPasswordHash : settings.boardPasswordHash;
  if (!storedHash) {
    return {
      ok: false,
      status: 401,
      error: `${roleLabel(role)} scheduling password is not configured yet. Ask an admin.`,
    };
  }

  const valid = await verifySchedulingPassword(secret, storedHash);
  if (!valid) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return {
    ok: true,
    role,
    requestedBy: role === "coach" ? "Coach shared login" : "Board member shared login",
  };
}

export async function getReservationById(env, reservationId) {
  await ensureSchedulingTables(env);

  const row = await first(
    env,
    `SELECT id, field, team, title, reservation_type, date, start_time, end_time, status, notes, created_by_role, created_at, updated_at
     FROM field_reservations
     WHERE id = ?`,
    [String(reservationId || "").trim()]
  );

  return row ? rowToReservation(row) : null;
}

export async function createReservation(env, payload) {
  await ensureSchedulingTables(env);

  const now = nowIso();
  const id = payload?.id || `sched_res_${crypto.randomUUID()}`;
  const status = payload?.status === "maintenance" ? "maintenance" : "approved";

  await run(
    env,
    `INSERT INTO field_reservations
       (id, field, team, title, reservation_type, date, start_time, end_time, status, notes, created_by_role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      payload.field,
      payload.team,
      payload.title,
      payload.reservationType,
      payload.date,
      payload.startTime,
      payload.endTime,
      status,
      payload.notes || "",
      payload.createdByRole || "",
      now,
      now,
    ]
  );

  return getReservationById(env, id);
}

export async function deleteReservation(env, reservationId) {
  await ensureSchedulingTables(env);
  return run(env, `DELETE FROM field_reservations WHERE id = ?`, [String(reservationId || "").trim()]);
}

export async function createFieldRequest(env, payload) {
  await ensureSchedulingTables(env);

  const now = nowIso();
  const id = payload?.id || `sched_req_${crypto.randomUUID()}`;

  await run(
    env,
    `INSERT INTO field_requests
      (id, request_type, reservation_id, field, team, title, reservation_type, date, start_time, end_time, notes, status, has_conflict, conflict_details, requested_by, requested_at, reviewed_by, reviewed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      payload.requestType,
      payload.reservationId || null,
      payload.field,
      payload.team,
      payload.title,
      payload.reservationType,
      payload.date,
      payload.startTime,
      payload.endTime,
      payload.notes || "",
      payload.status || "pending",
      payload.hasConflict ? 1 : 0,
      JSON.stringify(payload.conflictDetails || []),
      payload.requestedBy || "",
      payload.requestedAt || now,
      payload.reviewedBy || null,
      payload.reviewedAt || null,
    ]
  );

  return id;
}

export async function getFieldRequestById(env, requestId) {
  await ensureSchedulingTables(env);

  const row = await first(
    env,
    `SELECT id, request_type, reservation_id, field, team, title, reservation_type, date, start_time, end_time, notes, status, has_conflict, conflict_details, requested_by, requested_at, reviewed_by, reviewed_at
     FROM field_requests
     WHERE id = ?`,
    [String(requestId || "").trim()]
  );

  return row ? rowToRequest(row) : null;
}

export async function updateFieldRequestStatus(env, requestId, status, reviewedBy = "", reviewedAt = "") {
  await ensureSchedulingTables(env);

  return run(
    env,
    `UPDATE field_requests
     SET status = ?, reviewed_by = ?, reviewed_at = ?
     WHERE id = ?`,
    [status, reviewedBy || null, reviewedAt || null, String(requestId || "").trim()]
  );
}

export async function approvePendingRemovalRequestsForReservation(env, reservationId, reviewedBy) {
  await ensureSchedulingTables(env);

  const reviewedAt = nowIso();
  return run(
    env,
    `UPDATE field_requests
     SET status = 'approved', reviewed_by = ?, reviewed_at = ?
     WHERE reservation_id = ?
       AND request_type = 'remove'
       AND status = 'pending'`,
    [reviewedBy || "", reviewedAt, String(reservationId || "").trim()]
  );
}

export async function getPendingRemovalRequestForReservation(env, reservationId) {
  await ensureSchedulingTables(env);

  const row = await first(
    env,
    `SELECT id, request_type, reservation_id, field, team, title, reservation_type, date, start_time, end_time, notes, status, has_conflict, conflict_details, requested_by, requested_at, reviewed_by, reviewed_at
     FROM field_requests
     WHERE reservation_id = ?
       AND request_type = 'remove'
       AND status = 'pending'
     ORDER BY requested_at DESC
     LIMIT 1`,
    [String(reservationId || "").trim()]
  );

  return row ? rowToRequest(row) : null;
}

async function getRawSchedulingRows(env) {
  await ensureSchedulingTables(env);

  const [rawReservations, rawRequests, teams] = await Promise.all([
    all(
      env,
      `SELECT id, field, team, title, reservation_type, date, start_time, end_time, status, notes, created_by_role, created_at, updated_at
       FROM field_reservations`
    ),
    all(
      env,
      `SELECT id, request_type, reservation_id, field, team, title, reservation_type, date, start_time, end_time, notes, status, has_conflict, conflict_details, requested_by, requested_at, reviewed_by, reviewed_at
       FROM field_requests`
    ),
    all(
      env,
      `SELECT name, slug
       FROM teams
       WHERE status = 'active'
       ORDER BY name ASC`
    ),
  ]);

  return { rawReservations, rawRequests, teams };
}

export async function loadSchedulingState(env) {
  const rows = await getRawSchedulingRows(env);
  return buildSchedulingStateFromRows(rows.rawReservations, rows.rawRequests, rows.teams);
}

export async function recalculateSchedulingRequestConflicts(env) {
  const rows = await getRawSchedulingRows(env);
  const state = buildSchedulingStateFromRows(rows.rawReservations, rows.rawRequests, rows.teams);

  for (const request of state.requests) {
    if (request.requestType !== "add" || request.status !== "pending") continue;
    await run(
      env,
      `UPDATE field_requests
       SET has_conflict = ?, conflict_details = ?
       WHERE id = ?`,
      [request.hasConflict ? 1 : 0, JSON.stringify(request.conflictDetails || []), request.id]
    );
  }

  return state;
}
