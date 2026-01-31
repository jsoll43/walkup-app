// functions/api/admin/roster-delete.js
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getAdminKey(request) {
  const url = new URL(request.url);
  const headerKey =
    request.headers.get("x-admin-key") ||
    request.headers.get("x-api-key") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  const queryKey = url.searchParams.get("key") || "";
  return (headerKey || queryKey || "").trim();
}

function isNoSuchTable(err, tableName) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("no such table") && msg.includes(tableName.toLowerCase());
}

async function ensureRosterTable(db) {
  const stmts = [
    `
    CREATE TABLE IF NOT EXISTS roster_players (
      id TEXT PRIMARY KEY,
      number TEXT,
      first TEXT,
      last TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    `.trim(),
    `CREATE INDEX IF NOT EXISTS idx_roster_status ON roster_players(status);`.trim(),
  ];

  for (const s of stmts) {
    await db.prepare(s).run();
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.DB) return json({ ok: false, error: "Missing D1 binding env.DB" }, 500);
    if (!env?.ADMIN_KEY) return json({ ok: false, error: "Missing env.ADMIN_KEY" }, 500);

    const provided = getAdminKey(request);
    if (!provided || provided !== String(env.ADMIN_KEY).trim()) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await request.json().catch(() => null);
    const id = (body?.id || "").toString().trim();
    if (!id) return json({ ok: false, error: "id is required" }, 400);

    const now = new Date().toISOString();
    const q = `
      UPDATE roster_players
      SET status='deleted', updated_at=?, deleted_at=?
      WHERE id=?;
    `.trim();

    try {
      await env.DB.prepare(q).bind(now, now, id).run();
    } catch (e) {
      if (isNoSuchTable(e, "roster_players")) {
        await ensureRosterTable(env.DB);
        await env.DB.prepare(q).bind(now, now, id).run();
      } else {
        throw e;
      }
    }

    return json({ ok: true, deleted: id });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e), stack: e?.stack || null }, 500);
  }
}
