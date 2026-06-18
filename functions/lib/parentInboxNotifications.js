export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

export const DEFAULT_PARENT_RECORDING_MAX_SECONDS = 5;
export const MIN_PARENT_RECORDING_MAX_SECONDS = 1;
export const MAX_PARENT_RECORDING_MAX_SECONDS = 60;

export function normalizeParentRecordingMaxSeconds(value) {
  const seconds = Math.round(Number(value));
  if (!Number.isFinite(seconds)) return DEFAULT_PARENT_RECORDING_MAX_SECONDS;
  return Math.max(
    MIN_PARENT_RECORDING_MAX_SECONDS,
    Math.min(MAX_PARENT_RECORDING_MAX_SECONDS, seconds)
  );
}

function encodeForm(fields) {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v || ""))}`)
    .join("&");
}

function makeError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export async function ensureParentInboxNotificationSettingsTable(env) {
  if (!env?.DB) {
    throw makeError("D1 binding DB is missing (env.DB is undefined)", 500);
  }

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS admin_notification_settings (
      id TEXT PRIMARY KEY,
      parent_inbox_enabled INTEGER NOT NULL DEFAULT 0,
      parent_inbox_email TEXT NOT NULL DEFAULT '',
      parent_recording_max_seconds INTEGER NOT NULL DEFAULT 5,
      updated_at TEXT NOT NULL
    )`
  ).run();

  try {
    await env.DB.prepare(
      `SELECT parent_recording_max_seconds
       FROM admin_notification_settings
       LIMIT 1`
    ).first();
  } catch {
    try {
      await env.DB.prepare(
        `ALTER TABLE admin_notification_settings
         ADD COLUMN parent_recording_max_seconds INTEGER NOT NULL DEFAULT 5`
      ).run();
    } catch (alterError) {
      if (!/duplicate column|already exists/i.test(String(alterError?.message || alterError))) {
        throw alterError;
      }
    }
  }
}

export async function getParentInboxNotificationSettings(env) {
  await ensureParentInboxNotificationSettingsTable(env);

  const row = await env.DB.prepare(
    `SELECT parent_inbox_enabled, parent_inbox_email, parent_recording_max_seconds, updated_at
     FROM admin_notification_settings
     WHERE id = 'singleton'`
  ).first();

  return {
    enabled: !!row?.parent_inbox_enabled,
    email: String(row?.parent_inbox_email || "").trim(),
    recordingMaxSeconds: normalizeParentRecordingMaxSeconds(
      row?.parent_recording_max_seconds ?? DEFAULT_PARENT_RECORDING_MAX_SECONDS
    ),
    updatedAt: row?.updated_at || "",
  };
}

export async function setParentInboxNotificationSettings(env, settings) {
  await ensureParentInboxNotificationSettingsTable(env);

  const current = await getParentInboxNotificationSettings(env);
  const enabled = !!settings?.enabled;
  const email = String(settings?.email || "").trim();
  const recordingMaxSeconds =
    settings && Object.prototype.hasOwnProperty.call(settings, "recordingMaxSeconds")
      ? normalizeParentRecordingMaxSeconds(settings.recordingMaxSeconds)
      : current.recordingMaxSeconds;
  const updatedAt = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO admin_notification_settings
       (id, parent_inbox_enabled, parent_inbox_email, parent_recording_max_seconds, updated_at)
     VALUES ('singleton', ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       parent_inbox_enabled = excluded.parent_inbox_enabled,
       parent_inbox_email = excluded.parent_inbox_email,
       parent_recording_max_seconds = excluded.parent_recording_max_seconds,
       updated_at = excluded.updated_at`
  )
    .bind(enabled ? 1 : 0, email, recordingMaxSeconds, updatedAt)
    .run();

  return { enabled, email, recordingMaxSeconds, updatedAt };
}

export function getMailgunEnvStatus(env) {
  return {
    MAILGUN_API_KEY: !!env?.MAILGUN_API_KEY,
    MAILGUN_DOMAIN: !!env?.MAILGUN_DOMAIN,
    MAILGUN_FROM: !!env?.MAILGUN_FROM,
    ADMIN_KEY: !!env?.ADMIN_KEY,
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function describeLatestSubmission(latestSubmission) {
  if (!latestSubmission || typeof latestSubmission !== "object") {
    return "";
  }

  const playerName = String(latestSubmission.playerName || "").trim();
  const teamName = String(latestSubmission.teamName || "").trim();
  const songRequest = String(latestSubmission.songRequest || "").trim();
  const createdAt = String(latestSubmission.createdAt || "").trim();

  const details = [];
  if (playerName) details.push(`Player: ${playerName}`);
  if (teamName) details.push(`Team: ${teamName}`);
  if (songRequest) details.push(`Song request: ${songRequest}`);
  if (createdAt) details.push(`Submitted at: ${createdAt}`);

  return details.join("\n");
}

export async function sendParentInboxEmail(env, payload) {
  const email = String(payload?.email || "").trim();
  const newSubmissions = Number(payload?.newSubmissions || 0);
  const currentPending = Number(payload?.currentPending || 0);
  const latestSubmissionText = describeLatestSubmission(payload?.latestSubmission);

  if (!email || !isValidEmail(email)) {
    throw makeError(
      `Invalid email address or email is missing (received email=${JSON.stringify(email)})`,
      400
    );
  }

  if (!newSubmissions || newSubmissions <= 0) {
    throw makeError("No new submissions to notify.", 400);
  }

  const mgKey = env?.MAILGUN_API_KEY;
  const mgDomain = env?.MAILGUN_DOMAIN;
  const mgFrom = env?.MAILGUN_FROM;

  if (!mgKey || !mgDomain || !mgFrom) {
    throw makeError(
      "Mailgun is not configured (MAILGUN_API_KEY/MAILGUN_DOMAIN/MAILGUN_FROM).",
      500
    );
  }

  const subject = `New Parent Inbox submissions: ${newSubmissions} new`;
  const lines = [
    `There are ${currentPending} pending submission(s) in the Parent Inbox.`,
    `${newSubmissions} new since last check.`,
  ];
  if (latestSubmissionText) {
    lines.push("", "Most recent submission:", latestSubmissionText);
  }
  lines.push("", "Visit your admin panel to review.");

  const text = lines.join("\n");
  const htmlParts = [
    `<p>There are ${currentPending} pending submission(s) in the Parent Inbox.</p>`,
    `<p>${newSubmissions} new since last check.</p>`,
  ];
  if (latestSubmissionText) {
    htmlParts.push(
      `<p><strong>Most recent submission</strong><br />${escapeHtml(latestSubmissionText).replace(/\n/g, "<br />")}</p>`
    );
  }
  htmlParts.push(`<p>Visit your admin panel to review.</p>`);
  const html = htmlParts.join("");

  const mgRes = await fetch(`https://api.mailgun.net/v3/${encodeURIComponent(mgDomain)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`api:${mgKey}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: encodeForm({
      from: mgFrom,
      to: email,
      subject,
      text,
      html,
    }),
  });

  if (!mgRes.ok) {
    const msg = await mgRes.text();
    throw makeError(`Mailgun failed: ${mgRes.status} ${mgRes.statusText} ${msg}`, 502);
  }

  return { ok: true, sentTo: email };
}
