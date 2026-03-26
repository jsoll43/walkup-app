// functions/api/admin/db-migrate-v6.js
// Adds auth_logs table for tracking authorization errors

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

export const onRequestPost = async ({ request, env }) => {
  try {
    const key = getAdminKey(request);
    if (!key || key !== env.ADMIN_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

    // Check if auth_logs table already exists
    const tableCheck = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='auth_logs'`
    ).first();

    if (!tableCheck) {
      // Create auth_logs table
      await env.DB.prepare(
        `CREATE TABLE auth_logs (
          id TEXT PRIMARY KEY,
          team_id TEXT,
          team_slug TEXT NOT NULL,
          error_type TEXT NOT NULL,
          error_message TEXT,
          timestamp TEXT NOT NULL,
          FOREIGN KEY (team_id) REFERENCES teams(id)
        )`
      ).run();

      // Create index for faster queries
      await env.DB.prepare(
        `CREATE INDEX idx_auth_logs_team_slug_timestamp 
         ON auth_logs(team_slug, timestamp DESC)`
      ).run();

      return json({ ok: true, message: "auth_logs table created" });
    }

    return json({ ok: true, message: "auth_logs table already exists" });
  } catch (e) {
    console.error("db-migrate-v6 error:", e);
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};
