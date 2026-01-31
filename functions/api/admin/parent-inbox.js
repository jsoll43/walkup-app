export async function onRequestGet({ request, env }) {
  try {
    const auth = request.headers.get("Authorization") || "";
    if (auth !== "Bearer " + env.ADMIN_KEY) return new Response("Unauthorized", { status: 401 });

    const rows = await env.DB.prepare(
      `SELECT id, player_name, song_request, created_at, size_bytes, content_type, status
       FROM parent_submissions
       WHERE status = 'pending'
       ORDER BY created_at DESC`
    ).all();

    return Response.json({ ok: true, items: rows.results || [] });
  } catch (e) {
    const msg = e?.stack || e?.message || String(e);
    return new Response("admin/parent-inbox exception: " + msg, { status: 500 });
  }
}
