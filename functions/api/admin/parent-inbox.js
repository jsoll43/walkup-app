// functions/api/admin/parent-inbox.js
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

export const onRequestGet = async ({ request, env }) => {
  try {
    const key = getAdminKey(request);
    if (!key || key !== env.ADMIN_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

    const res = await env.DB.prepare(
      `SELECT
         ps.id,
         ps.player_name,
         ps.song_request,
         ps.content_type,
         ps.size_bytes,
         ps.status,
         ps.created_at,
         t.slug AS team_slug,
         t.name AS team_name
       FROM parent_submissions ps
       LEFT JOIN teams t ON t.id = ps.team_id
       WHERE ps.status = 'pending'
       ORDER BY ps.created_at DESC
       LIMIT 200`
    ).all();

    return json({ ok: true, submissions: res.results || [] });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};
