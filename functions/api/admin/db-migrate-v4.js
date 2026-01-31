// functions/api/admin/db-migrate-v4.js
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

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.DB) return json({ ok: false, error: "Missing D1 binding env.DB" }, 500);
    if (!env?.ADMIN_KEY) return json({ ok: false, error: "Missing env.ADMIN_KEY" }, 500);

    const provided = getAdminKey(request);
    if (!provided || provided !== env.ADMIN_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

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
      `CREATE INDEX IF NOT EXISTS idx_roster_number ON roster_players(number);`.trim(),
      `CREATE INDEX IF NOT EXISTS idx_roster_name ON roster_players(last, first);`.trim(),
    ];

    for (const s of stmts) {
      await env.DB.prepare(s).run();
    }

    return json({ ok: true, migrated: "v4", tables: ["roster_players"] });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e), stack: e?.stack || null }, 500);
  }
}
