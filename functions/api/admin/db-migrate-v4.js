// functions/api/admin/db-migrate-v4.js
function getAdminKey(req) {
  const h = req.headers;
  const bearer = (h.get("authorization") || "").trim();
  if (bearer.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  return (h.get("x-admin-key") || "").trim();
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function run(env, sql, binds = []) {
  const stmt = env.DB.prepare(sql);
  const res = binds.length ? await stmt.bind(...binds).run() : await stmt.run();
  return res;
}

async function first(env, sql, binds = []) {
  const stmt = env.DB.prepare(sql);
  return binds.length ? await stmt.bind(...binds).first() : await stmt.first();
}

export const onRequestPost = async ({ request, env }) => {
  try {
    const key = getAdminKey(request);
    if (!key || key !== env.ADMIN_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

    // 1) Create teams table (soft delete via status)
    await run(
      env,
      `CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        parent_key TEXT NOT NULL,
        coach_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        deleted_at TEXT
      )`
    );

    // 2) Ensure roster_players exists (some installs may not have it yet)
    await run(
      env,
      `CREATE TABLE IF NOT EXISTS roster_players (
        id TEXT PRIMARY KEY,
        number TEXT,
        first TEXT,
        last TEXT,
        active INTEGER DEFAULT 1
      )`
    );

    // 3) Ensure parent_submissions exists (from v3)
    await run(
      env,
      `CREATE TABLE IF NOT EXISTS parent_submissions (
        id TEXT PRIMARY KEY,
        player_name TEXT NOT NULL,
        song_request TEXT,
        r2_key TEXT NOT NULL,
        content_type TEXT,
        size_bytes INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        deleted_at TEXT
      )`
    );

    // 4) Ensure coach_state exists (from v3)
    await run(
      env,
      `CREATE TABLE IF NOT EXISTS coach_state (
        id INTEGER PRIMARY KEY,
        lineup_ids TEXT NOT NULL,
        current_index INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL
      )`
    );

    // 5) Add team_id columns where needed (ignore if already exists)
    // SQLite in D1 doesn't support IF NOT EXISTS for columns, so we probe PRAGMA.
    async function ensureColumn(table, col, typeSql) {
      const cols = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
      const exists = (cols?.results || []).some((c) => c?.name === col);
      if (!exists) {
        await run(env, `ALTER TABLE ${table} ADD COLUMN ${col} ${typeSql}`);
      }
      return { table, col, existed: exists };
    }

    const colChanges = [];
    colChanges.push(await ensureColumn("roster_players", "team_id", "TEXT"));
    colChanges.push(await ensureColumn("parent_submissions", "team_id", "TEXT"));
    // We'll keep old coach_state table, but create a new per-team table for state:
    await run(
      env,
      `CREATE TABLE IF NOT EXISTS coach_state_by_team (
        team_id TEXT PRIMARY KEY,
        lineup_ids TEXT NOT NULL,
        current_index INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL
      )`
    );

    // 6) Seed default team if none exists
    const now = new Date().toISOString();
    const defaultTeam = await first(env, `SELECT * FROM teams WHERE slug = ?`, ["default"]);

    if (!defaultTeam) {
      const defaultId = "team_default";
      const parentKey = env.PARENT_UPLOAD_KEY || "CHANGE_ME_PARENT";
      const coachKey = env.COACH_KEY || "CHANGE_ME_COACH";

      await run(
        env,
        `INSERT INTO teams (id, name, slug, parent_key, coach_key, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?)`,
        [defaultId, "Barrington Girls Softball", "default", parentKey, coachKey, now]
      );

      // Backfill existing rows to default team
      await run(env, `UPDATE roster_players SET team_id = ? WHERE team_id IS NULL`, [defaultId]);
      await run(env, `UPDATE parent_submissions SET team_id = ? WHERE team_id IS NULL`, [defaultId]);

      // Move legacy coach_state row (id=1) to coach_state_by_team if exists
      const legacy = await first(env, `SELECT lineup_ids, current_index, updated_at, version FROM coach_state WHERE id = 1`);
      if (legacy) {
        await run(
          env,
          `INSERT OR REPLACE INTO coach_state_by_team (team_id, lineup_ids, current_index, updated_at, version)
           VALUES (?, ?, ?, ?, ?)`,
          [defaultId, legacy.lineup_ids, legacy.current_index, legacy.updated_at, legacy.version]
        );
      } else {
        await run(
          env,
          `INSERT OR REPLACE INTO coach_state_by_team (team_id, lineup_ids, current_index, updated_at, version)
           VALUES (?, '[]', 0, ?, 1)`,
          [defaultId, now]
        );
      }
    } else {
      // If default team exists, still backfill null team_id for safety
      await run(env, `UPDATE roster_players SET team_id = ? WHERE team_id IS NULL`, [defaultTeam.id]);
      await run(env, `UPDATE parent_submissions SET team_id = ? WHERE team_id IS NULL`, [defaultTeam.id]);

      // Ensure coach_state_by_team has a row for default
      const hasDefaultState = await first(env, `SELECT team_id FROM coach_state_by_team WHERE team_id = ?`, [defaultTeam.id]);
      if (!hasDefaultState) {
        const legacy = await first(env, `SELECT lineup_ids, current_index, updated_at, version FROM coach_state WHERE id = 1`);
        if (legacy) {
          await run(
            env,
            `INSERT INTO coach_state_by_team (team_id, lineup_ids, current_index, updated_at, version)
             VALUES (?, ?, ?, ?, ?)`,
            [defaultTeam.id, legacy.lineup_ids, legacy.current_index, legacy.updated_at, legacy.version]
          );
        } else {
          await run(
            env,
            `INSERT INTO coach_state_by_team (team_id, lineup_ids, current_index, updated_at, version)
             VALUES (?, '[]', 0, ?, 1)`,
            [defaultTeam.id, now]
          );
        }
      }
    }

    return json({
      ok: true,
      message: "Migration v4 complete: teams + per-team roster/submissions/state enabled.",
      colChanges,
      defaultTeamSlug: "default",
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};

export const onRequestOptions = async () =>
  new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "authorization,x-admin-key,content-type",
    },
  });
