import { verifySchedulingPassword } from "./scheduling.js";
import { sha256Hex } from "../../shared/financeCore.js";

const COOKIE_NAME = "bgsl_finance_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...headers,
    },
  });
}

function getCookie(request, name) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return "";
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function safeSecretEqual(left, right) {
  if (!left || !right) return false;
  const [leftHash, rightHash] = await Promise.all([sha256Hex(left), sha256Hex(right)]);
  let difference = leftHash.length ^ rightHash.length;
  for (let index = 0; index < Math.max(leftHash.length, rightHash.length); index += 1) {
    difference |= (leftHash.charCodeAt(index) || 0) ^ (rightHash.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function cookieHeader(request, token, maxAge = SESSION_TTL_SECONDS) {
  const host = new URL(request.url).hostname;
  const secure = host !== "localhost" && host !== "127.0.0.1" ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/api/board/finance; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function accessEmail(request) {
  return String(request.headers.get("Cf-Access-Authenticated-User-Email") || "").trim().toLowerCase();
}

function isLocalBypass(request, env) {
  if (String(env?.FINANCE_LOCAL_AUTH_BYPASS || "").toLowerCase() !== "true") return false;
  const host = new URL(request.url).hostname;
  return host === "localhost" || host === "127.0.0.1";
}

async function loginAttemptKey(request) {
  const address = String(request.headers.get("CF-Connecting-IP") || "unknown").trim();
  return sha256Hex(`finance-login:${address}`);
}

async function getLoginBlock(request, env) {
  const key = await loginAttemptKey(request);
  const now = new Date();
  const row = await env.DB.prepare(
    `SELECT failed_count, window_started_at, blocked_until FROM finance_auth_attempts WHERE attempt_key = ?`,
  ).bind(key).first();
  if (!row?.blocked_until || new Date(row.blocked_until) <= now) return { key, blocked: false };
  return { key, blocked: true, retryAfter: Math.max(1, Math.ceil((new Date(row.blocked_until).getTime() - now.getTime()) / 1000)) };
}

async function recordFailedLogin(env, key) {
  const now = new Date();
  const nowIso = now.toISOString();
  const row = await env.DB.prepare(
    `SELECT failed_count, window_started_at FROM finance_auth_attempts WHERE attempt_key = ?`,
  ).bind(key).first();
  const inWindow = row?.window_started_at && now.getTime() - new Date(row.window_started_at).getTime() < LOGIN_WINDOW_MS;
  const failedCount = inWindow ? Number(row.failed_count || 0) + 1 : 1;
  const windowStartedAt = inWindow ? row.window_started_at : nowIso;
  const blockedUntil = failedCount >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOGIN_WINDOW_MS).toISOString() : null;
  await env.DB.prepare(
    `INSERT INTO finance_auth_attempts (attempt_key, failed_count, window_started_at, blocked_until, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(attempt_key) DO UPDATE SET failed_count = excluded.failed_count, window_started_at = excluded.window_started_at,
       blocked_until = excluded.blocked_until, updated_at = excluded.updated_at`,
  ).bind(key, failedCount, windowStartedAt, blockedUntil, nowIso).run();
}

async function clearFailedLogins(env, key) {
  await env.DB.prepare(`DELETE FROM finance_auth_attempts WHERE attempt_key = ?`).bind(key).run();
}

async function findBoardMemberByPin(env, pin) {
  if (!/^\d{6}$/.test(String(pin || ""))) return null;
  const result = await env.DB.prepare(
    `SELECT id, name, pin_hash FROM finance_board_members WHERE is_active = 1 ORDER BY name`,
  ).all();
  for (const member of result?.results || []) {
    if (await verifySchedulingPassword(pin, member.pin_hash)) return member;
  }
  return null;
}

export function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (origin !== new URL(request.url).origin) {
    const error = new Error("Cross-origin finance mutation rejected.");
    error.status = 403;
    throw error;
  }
}

export async function createFinanceSession(request, env, { role, password, pin }) {
  if (!env?.DB) return json({ ok: false, error: "D1 binding DB is missing." }, 500);
  const requestedRole = String(role || "viewer").trim().toLowerCase();
  if (requestedRole !== "viewer" && requestedRole !== "editor") {
    return json({ ok: false, error: "Choose Board viewer or Finance editor." }, 400);
  }

  const loginBlock = await getLoginBlock(request, env);
  if (loginBlock.blocked) {
    return json({ ok: false, error: "Too many unsuccessful sign-in attempts. Try again in 15 minutes." }, 429, { "retry-after": String(loginBlock.retryAfter) });
  }

  let valid = false;
  let actor = "";
  let boardMemberId = null;
  if (requestedRole === "viewer") {
    const member = await findBoardMemberByPin(env, String(pin || password || ""));
    valid = Boolean(member);
    actor = member?.name || "";
    boardMemberId = member?.id || null;
  } else {
    valid = await safeSecretEqual(String(password || ""), String(env.FINANCE_EDITOR_KEY || ""));
    if (!valid) valid = await safeSecretEqual(String(password || ""), String(env.ADMIN_KEY || ""));
    actor = accessEmail(request) || "Finance editor";
  }
  if (!valid) {
    await recordFailedLogin(env, loginBlock.key);
    return json({ ok: false, error: "Unauthorized" }, 401);
  }
  await clearFailedLogins(env, loginBlock.key);

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO finance_sessions (token_hash, role, actor, board_member_id, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(tokenHash, requestedRole, actor, boardMemberId, createdAt, expiresAt, createdAt).run();
  if (boardMemberId) {
    await env.DB.prepare(`UPDATE finance_board_members SET last_login_at = ?, updated_at = ? WHERE id = ?`).bind(createdAt, createdAt, boardMemberId).run();
  }
  const auditId = `finance_audit_${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT INTO finance_audit_events (id, actor, actor_role, action, entity_type, entity_id, details_json, created_at)
     VALUES (?, ?, ?, 'session_created', 'finance_session', ?, ?, ?)`,
  ).bind(auditId, actor, requestedRole, boardMemberId || "finance_editor", JSON.stringify({ boardMemberId }), createdAt).run();
  await env.DB.prepare(`DELETE FROM finance_sessions WHERE expires_at <= ?`).bind(createdAt).run();

  return json(
    { ok: true, session: { role: requestedRole, actor, expiresAt } },
    200,
    { "set-cookie": cookieHeader(request, token) },
  );
}

export async function getFinanceSession(request, env) {
  if (isLocalBypass(request, env)) {
    const role = String(env.FINANCE_LOCAL_AUTH_ROLE || "editor").toLowerCase() === "viewer" ? "viewer" : "editor";
    return { ok: true, role, actor: "Local development bypass", localBypass: true };
  }
  const token = getCookie(request, COOKIE_NAME);
  if (!token || !env?.DB) return { ok: false, status: 401, error: "Finance sign-in required." };
  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT s.role, s.actor, s.board_member_id, s.expires_at
     FROM finance_sessions s
     LEFT JOIN finance_board_members m ON m.id = s.board_member_id
     WHERE s.token_hash = ? AND s.expires_at > ?
       AND (s.role = 'editor' OR (s.role = 'viewer' AND m.is_active = 1))`,
  ).bind(tokenHash, now).first();
  if (!row) return { ok: false, status: 401, error: "Finance session expired." };
  await env.DB.prepare(`UPDATE finance_sessions SET last_seen_at = ? WHERE token_hash = ?`).bind(now, tokenHash).run();
  return { ok: true, role: row.role, actor: row.actor, boardMemberId: row.board_member_id || "", expiresAt: row.expires_at };
}

export async function requireFinanceAuth(request, env, { editor = false } = {}) {
  const session = await getFinanceSession(request, env);
  if (!session.ok) return session;
  if (editor && session.role !== "editor") {
    return { ok: false, status: 403, error: "Finance editor access is required." };
  }
  return session;
}

export async function destroyFinanceSession(request, env) {
  assertSameOrigin(request);
  const token = getCookie(request, COOKIE_NAME);
  if (token && env?.DB) {
    await env.DB.prepare(`DELETE FROM finance_sessions WHERE token_hash = ?`).bind(await sha256Hex(token)).run();
  }
  return json({ ok: true }, 200, { "set-cookie": cookieHeader(request, "", 0) });
}

export function financeAuthJson(value, status = 200, headers = {}) {
  return json(value, status, headers);
}
