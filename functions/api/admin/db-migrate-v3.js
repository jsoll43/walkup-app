function isAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  return auth === "Bearer " + env.ADMIN_KEY;
}

// Optional GET sanity check
export async function onRequestGet({ request, env }) {
  if (!isAdmin(request, env)) return new Response("Unauthorized", { status: 401 });
  return Response.json({ ok: true, note: "Use POST to run migrations." });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!isAdmin(request, env)) return new Response("Unauthorized", { status: 401 });

    // 1) parent_submissions
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS parent_submissions (
        id TEXT PRIMARY KEY,
        player_name TEXT,
        song_request TEXT,
        r2_key TEXT,
        content_type TEXT,
        size_bytes INTEGER,
        status TEXT,
        created_at TEXT,
        deleted_at TEXT
      );
    `).run();

    // 2) coach_state (includes version)
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS coach_state (
        id INTEGER PRIMARY KEY,
        lineup_ids TEXT,
        current_index INTEGER,
        updated_at TEXT,
        version INTEGER
      );
    `).run();

    // 3) If an older coach_state exists without 'version', try to add it (ignore if already there)
    try {
      await env.DB.prepare(`ALTER TABLE coach_state ADD COLUMN version INTEGER;`).run();
    } catch (_) {
      // Ignore errors like "duplicate column name"
    }

    // 4) Ensure row id=1 exists
    await env.DB.prepare(`
      INSERT OR IGNORE INTO coach_state (id, lineup_ids, current_index, updated_at, version)
      VALUES (1, '[]', 0, '', 0)
    `).run();

    return Response.json({ ok: true });
  } catch (e) {
    const msg = e?.stack || e?.message || String(e);
    return new Response("db-migrate-v3 exception: " + msg, { status: 500 });
  }
}
