export async function onRequestPost({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  if (auth !== `Bearer ${env.ADMIN_KEY}`) return new Response("Unauthorized", { status: 401 });

  const form = await request.formData();
  const playerId = form.get("playerId");
  const file = form.get("file");

  if (!playerId || !file) return new Response("Missing playerId or file", { status: 400 });

  const safeName = (file.name || "final").replace(/[^\w.\-]+/g, "_");
  const key = `final/${playerId}/${Date.now()}_${safeName}`;

  // Using your existing R2 binding (WALKUP_VOICE). Totally fine.
  await env.WALKUP_VOICE.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });

  await env.DB.prepare(`
    INSERT INTO player_final (player_id, r2_key, uploaded_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(player_id) DO UPDATE SET
      r2_key=excluded.r2_key,
      uploaded_at=excluded.uploaded_at
  `).bind(playerId, key).run();

  return Response.json({ ok: true, key });
}
