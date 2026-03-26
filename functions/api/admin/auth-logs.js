function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getAdminKey(req) {
  const bearer = (req.headers.get("authorization") || "").trim();
  if (bearer.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  return (req.headers.get("x-admin-key") || "").trim();
}

export const onRequestPost = async ({ request, env }) => {
  try {
    const adminKey = getAdminKey(request);
    if (!adminKey) return json({ ok: false, error: "Missing admin key" }, 401);

    // Verify admin access
    if (adminKey !== env.ADMIN_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

    // Parse request body for filters
    const body = await request.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit) || 100, 1000);
    const offset = Math.max(Number(body.offset) || 0, 0);
    const teamSlug = (body.teamSlug || "").trim().toLowerCase() || null;

    let query = `SELECT id, team_id, team_slug, error_type, error_message, timestamp
                FROM auth_logs
                WHERE error_type = 'parent_unauthorized'`;
    const params = [];

    if (teamSlug) {
      query += ` AND team_slug = ?`;
      params.push(teamSlug);
    }

    query += ` ORDER BY timestamp DESC
               LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const logs = await env.DB.prepare(query)
      .bind(...params)
      .all();

    // Get total count for pagination
    let countQuery = `SELECT COUNT(*) as count FROM auth_logs WHERE error_type = 'parent_unauthorized'`;
    if (teamSlug) {
      countQuery += ` AND team_slug = ?`;
    }

    const countResult = await env.DB.prepare(countQuery)
      .bind(...(teamSlug ? [teamSlug] : []))
      .first();

    return json({
      ok: true,
      logs: logs.results || [],
      total: countResult?.count || 0,
      limit,
      offset,
    });
  } catch (e) {
    console.error("Error fetching auth logs:", e);
    return json({ ok: false, error: e?.message || "Server error" }, 500);
  }
};
