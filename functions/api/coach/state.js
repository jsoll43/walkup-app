export async function onRequestGet({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  if (auth !== `Bearer ${env.COACH_KEY}`) return new Response("Unauthorized", { status: 401 });

  const row = await env.DB.prepare(`
    SELECT lineup_json, current_index, updated_at
    FROM team_state
    WHERE id = 'team'
  `).first();

  return Response.json({
    ok: true,
    lineupIds: row ? JSON.parse(row.lineup_json) : [],
    currentIndex: row ? row.current_index : 0,
    updatedAt: row ? row.updated_at : null,
  });
}

export async function onRequestPost({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  if (auth !== `Bearer ${env.COACH_KEY}`) return new Response("Unauthorized", { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { lineupIds, currentIndex } = body;

  if (!Array.isArray(lineupIds)) return new Response("lineupIds must be an array", { status: 400 });
  if (!Number.isInteger(currentIndex) || currentIndex < 0) return new Response("currentIndex invalid", { status: 400 });

  await env.DB.prepare(`
    UPDATE team_state
    SET lineup_json = ?, current_index = ?, updated_at = datetime('now')
    WHERE id = 'team'
  `).bind(JSON.stringify(lineupIds), currentIndex).run();

  return Response.json({ ok: true });
}
