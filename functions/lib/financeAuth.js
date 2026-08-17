import { getSchedulingSettings, verifySchedulingPassword } from "./scheduling.js";
import { sha256Hex } from "../../shared/financeCore.js";

const COOKIE_NAME = "bgsl_finance_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

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

export function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (origin !== new URL(request.url).origin) {
    const error = new Error("Cross-origin finance mutation rejected.");
    error.status = 403;
    throw error;
  }
}

export async function createFinanceSession(request, env, { role, password }) {
  if (!env?.DB) return json({ ok: false, error: "D1 binding DB is missing." }, 500);
  const requestedRole = String(role || "viewer").trim().toLowerCase();
  if (requestedRole !== "viewer" && requestedRole !== "editor") {
    return json({ ok: false, error: "Choose Board viewer or Finance editor." }, 400);
  }

  let valid = false;
  if (requestedRole === "viewer") {
    const settings = await getSchedulingSettings(env);
    valid = Boolean(settings.boardPasswordHash) && await verifySchedulingPassword(String(password || ""), settings.boardPasswordHash);
  } else {
    valid = await safeSecretEqual(String(password || ""), String(env.FINANCE_EDITOR_KEY || ""));
    if (!valid) valid = await safeSecretEqual(String(password || ""), String(env.ADMIN_KEY || ""));
  }
  if (!valid) return json({ ok: false, error: "Unauthorized" }, 401);

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
  const actor = accessEmail(request) || (requestedRole === "editor" ? "Finance editor" : "Board member");
  await env.DB.prepare(
    `INSERT INTO finance_sessions (token_hash, role, actor, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(tokenHash, requestedRole, actor, createdAt, expiresAt, createdAt).run();
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
    `SELECT role, actor, expires_at FROM finance_sessions WHERE token_hash = ? AND expires_at > ?`,
  ).bind(tokenHash, now).first();
  if (!row) return { ok: false, status: 401, error: "Finance session expired." };
  await env.DB.prepare(`UPDATE finance_sessions SET last_seen_at = ? WHERE token_hash = ?`).bind(now, tokenHash).run();
  return { ok: true, role: row.role, actor: row.actor, expiresAt: row.expires_at };
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
