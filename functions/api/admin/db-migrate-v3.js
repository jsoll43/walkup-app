// functions/api/admin/db-migrate-v3.js
export async function onRequestPost({ request, env }) {
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj, null, 2), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });

  try {
    if (!env?.DB) return json({ ok: false, error: "Missing D1 binding env.DB" }, 500);

    // --- Admin key gate (supports a few common header patterns) ---
    const expected = env.ADMIN_KEY;
    if (!expected) return json({ ok: false, error: "Missing env.ADMIN_KEY" }, 500);

    const url = new URL(request.url);
    const headerKey =
      request.headers.get("x-admin-key") ||
      request.headers.get("x-api-key") ||
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
      "";
    const queryKey = url.searchParams.get("key") || "";
    const provided = (headerKey || queryKey || "").trim();

    if (!provided || provided !== expected) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const db = env.DB;
    const now = new Date().toISOString();
    const applied = [];

    const run = async (sql, params = []) => {
      const res = await db.prepare(sql).bind(...params).run();
      applied.push({ sql, params, meta: res?.meta || null });
      return res;
    };

    const all = async (sql, params = []) => {
      const res = await db.prepare(sql).bind(...params).all();
      return res?.results || [];
    };

    const getColumns = async (tableName) => {
      // PRAGMA can't be parameter-bound for identifiers; tableName is internal constant here.
      const rows = await all(`PRAGMA table_info("${tableName}");`);
      return new Set(rows.map((r) => r.name));
    };

    const ensureColumn = async (tableName, columnName, columnDefSql) => {
      // columnDefSql should be like: `"version" INTEGER NOT NULL DEFAULT 1`
      const cols = await getColumns(tableName);
      if (cols.has(columnName)) return false;
      await run(`ALTER TABLE "${tableName}" ADD COLUMN ${columnDefSql};`);
      return true;
    };

    // --- 1) Create tables (safe if already exist) ---
    await run(`
      CREATE TABLE IF NOT EXISTS parent_submissions (
        id TEXT PRIMARY KEY,
        player_name TEXT NOT NULL,
        song_request TEXT,
        r2_key TEXT NOT NULL,
        content_type TEXT,
        size_bytes INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );
    `.trim());

    await run(`
      CREATE TABLE IF NOT EXISTS coach_state (
        id INTEGER PRIMARY KEY,
        lineup_ids TEXT NOT NULL,
        current_index INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      );
    `.trim());

    // --- 2) If older tables exist, add any missing columns (no exec()) ---
    // parent_submissions
    await ensureColumn("parent_submissions", "player_name", `"player_name" TEXT NOT NULL DEFAULT ''`);
    await ensureColumn("parent_submissions", "song_request", `"song_request" TEXT`);
    await ensureColumn("parent_submissions", "r2_key", `"r2_key" TEXT NOT NULL DEFAULT ''`);
    await ensureColumn("parent_submissions", "content_type", `"content_type" TEXT`);
    await ensureColumn("parent_submissions", "size_bytes", `"size_bytes" INTEGER`);
    await ensureColumn("parent_submissions", "status", `"status" TEXT NOT NULL DEFAULT 'pending'`);
    await ensureColumn("parent_submissions", "created_at", `"created_at" TEXT NOT NULL DEFAULT ''`);
    await ensureColumn("parent_submissions", "deleted_at", `"deleted_at" TEXT`);

    // coach_state
    await ensureColumn("coach_state", "lineup_ids", `"lineup_ids" TEXT NOT NULL DEFAULT '[]'`);
    await ensureColumn("coach_state", "current_index", `"current_index" INTEGER NOT NULL DEFAULT 0`);
    await ensureColumn("coach_state", "updated_at", `"updated_at" TEXT NOT NULL DEFAULT ''`);
    await ensureColumn("coach_state", "version", `"version" INTEGER NOT NULL DEFAULT 1`);

    // --- 3) Indexes (after columns exist) ---
    await run(`
      CREATE INDEX IF NOT EXISTS idx_parent_submissions_status_created
      ON parent_submissions (status, created_at);
    `.trim());

    // --- 4) Seed coach_state row id=1 if missing ---
    await run(
      `
      INSERT INTO coach_state (id, lineup_ids, current_index, updated_at, version)
      VALUES (1, ?, 0, ?, 1)
      ON CONFLICT(id) DO NOTHING;
    `.trim(),
      ["[]", now]
    );

    // --- 5) Return some verification info ---
    const coachState = await all(
      `SELECT id, lineup_ids, current_index, updated_at, version FROM coach_state WHERE id = 1;`
    );
    const pendingCount = await all(
      `SELECT COUNT(*) AS cnt FROM parent_submissions WHERE status = 'pending';`
    );

    return json({
      ok: true,
      message: "db-migrate-v3 completed (prepare().run only; no exec())",
      appliedStatements: applied.length,
      coachState: coachState[0] || null,
      pendingSubmissions: pendingCount?.[0]?.cnt ?? 0,
      now,
    });
  } catch (e) {
    return new Response(
      JSON.stringify(
        {
          ok: false,
          error: String(e?.message || e),
          stack: e?.stack || null,
        },
        null,
        2
      ),
      { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }
}
