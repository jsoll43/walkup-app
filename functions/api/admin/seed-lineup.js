export async function onRequestPost({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  if (auth !== `Bearer ${env.ADMIN_KEY}`) return new Response("Unauthorized", { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { lineupIds } = body;

  if (!Array.isArray(lineupIds)) return new Response("lineupIds must be an array", { status: 400 });

  await env.DB.prepare(`
    UPDATE team_state
    SET lineup_json = ?, current_index = 0, updated_at = datetime('now')
    WHERE id = 'team'
  `).bind(JSON.stringify(lineupIds)).run();

  return Response.json({ ok: true });
}
