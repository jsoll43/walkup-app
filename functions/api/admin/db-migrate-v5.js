// functions/api/admin/db-migrate-v5.js
// Fixes the UNIQUE constraint on teams.slug to allow slug reuse for deleted teams

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

export const onRequestPost = async ({ request, env }) => {
  try {
    const key = getAdminKey(request);
    if (!key || key !== env.ADMIN_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

    // Check if the partial index already exists
    const indexCheck = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_teams_slug_active'`
    ).first();

    if (!indexCheck) {
      // The table currently has UNIQUE constraint on slug.
      // We need to recreate it without the UNIQUE constraint, then add a partial index.
      
      // 1) Rename old table
      await run(env, `ALTER TABLE teams RENAME TO teams_old`);

      // 2) Create new table without UNIQUE constraint on slug
      await run(
        env,
        `CREATE TABLE teams (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL,
          parent_key TEXT NOT NULL,
          coach_key TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          deleted_at TEXT
        )`
      );

      // 3) Copy data from old table
      await run(
        env,
        `INSERT INTO teams (id, name, slug, parent_key, coach_key, status, created_at, deleted_at)
         SELECT id, name, slug, parent_key, coach_key, status, created_at, deleted_at FROM teams_old`
      );

      // 4) Drop old table
      await run(env, `DROP TABLE teams_old`);

      // 5) Create partial unique index (only on active teams)
      await run(
        env,
        `CREATE UNIQUE INDEX idx_teams_slug_active ON teams(slug) WHERE status = 'active'`
      );

      return json({
        ok: true,
        message: "Migration v5 complete: Removed UNIQUE constraint on slug and added partial index for active teams only. Slug can now be reused for deleted teams.",
      });
    } else {
      return json({
        ok: true,
        message: "Migration v5: Partial index idx_teams_slug_active already exists. No changes needed.",
      });
    }
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
