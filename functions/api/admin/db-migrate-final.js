export async function onRequestPost({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  if (auth !== `Bearer ${env.ADMIN_KEY}`) return new Response("Unauthorized", { status: 401 });

  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS player_final (
      player_id TEXT PRIMARY KEY,
      r2_key TEXT NOT NULL,
      uploaded_at TEXT NOT NULL
    );
  `);

  return Response.json({ ok: true });
}
