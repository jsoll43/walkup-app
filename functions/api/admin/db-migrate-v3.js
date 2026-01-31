export async function onRequestPost({ request, env }) {
  try {
    const auth = request.headers.get("Authorization") || "";
    if (auth !== "Bearer " + env.ADMIN_KEY) return new Response("Unauthorized", { status: 401 });

    // parent_submissions table
    await env.DB.exec(`
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
    `);

    // coach_state table if not exists
    await env.DB.exec(`
      CREATE TABLE IF NOT EXISTS coach_state (
        id INTEGER PRIMARY KEY,
        lineup_ids TEXT,
        current_index INTEGER,
        updated_at TEXT,
        version INTEGER
      );
    `);

    // Ensure version column exists (safe attempt)
    // If it already exists, D1 may throw; we ignore.
    try {
      await env.DB.exec(`ALTER TABLE coach_state ADD COLUMN version INTEGER;`);
    } catch (_) {}

    // Ensure row id=1 exists
    await env.DB.prepare(
      `INSERT OR IGNORE INTO coach_state (id, lineup_ids, current_index, updated_at, version)
       VALUES (1, '[]', 0, '', 0)`
    ).run();

    return Response.json({ ok: true });
  } catch (e) {
    const msg = e?.stack || e?.message || String(e);
    return new Response("db-migrate-v3 exception: " + msg, { status: 500 });
  }
}
