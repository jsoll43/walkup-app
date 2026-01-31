export async function onRequestGet({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  if (auth !== `Bearer ${env.COACH_KEY}`) return new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  const playerId = url.searchParams.get("playerId");
  if (!playerId) return new Response("Missing playerId", { status: 400 });

  const row = await env.DB.prepare(`
    SELECT r2_key
    FROM player_final
    WHERE player_id = ?
  `).bind(playerId).first();

  if (!row?.r2_key) return new Response("No final clip", { status: 404 });

  const obj = await env.WALKUP_VOICE.get(row.r2_key);
  if (!obj) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Cache-Control", "no-store");

  return new Response(obj.body, { headers });
}
