export async function onRequestGet({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  if (auth !== `Bearer ${env.ADMIN_KEY}`) return new Response("Unauthorized", { status: 401 });

  const rows = await env.DB.prepare(`
    SELECT player_id, r2_key, uploaded_at
    FROM player_final
  `).all();

  return Response.json({ ok: true, rows: rows.results || [] });
}
