export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
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
      updated_at TEXT NOT NULL
    )`
  ).run();
}

export async function getParentInboxNotificationSettings(env) {
  await ensureParentInboxNotificationSettingsTable(env);

  const row = await env.DB.prepare(
    `SELECT parent_inbox_enabled, parent_inbox_email, updated_at
     FROM admin_notification_settings
     WHERE id = 'singleton'`
  ).first();

  return {
    enabled: !!row?.parent_inbox_enabled,
    email: String(row?.parent_inbox_email || "").trim(),
    updatedAt: row?.updated_at || "",
  };
}

export async function setParentInboxNotificationSettings(env, settings) {
  await ensureParentInboxNotificationSettingsTable(env);

  const enabled = !!settings?.enabled;
  const email = String(settings?.email || "").trim();
  const updatedAt = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO admin_notification_settings
       (id, parent_inbox_enabled, parent_inbox_email, updated_at)
     VALUES ('singleton', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       parent_inbox_enabled = excluded.parent_inbox_enabled,
       parent_inbox_email = excluded.parent_inbox_email,
       updated_at = excluded.updated_at`
  )
    .bind(enabled ? 1 : 0, email, updatedAt)
    .run();

  return { enabled, email, updatedAt };
}

export function getMailgunEnvStatus(env) {
  return {
    MAILGUN_API_KEY: !!env?.MAILGUN_API_KEY,
    MAILGUN_DOMAIN: !!env?.MAILGUN_DOMAIN,
    MAILGUN_FROM: !!env?.MAILGUN_FROM,
    ADMIN_KEY: !!env?.ADMIN_KEY,
  };
}

export async function sendParentInboxEmail(env, payload) {
  const email = String(payload?.email || "").trim();
  const newSubmissions = Number(payload?.newSubmissions || 0);
  const currentPending = Number(payload?.currentPending || 0);

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
  const text = `There are ${currentPending} pending submission(s) in the Parent Inbox. ${newSubmissions} new since last check.`;
  const html = `<p>${text}</p><p>Visit your admin panel to review.</p>`;

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
