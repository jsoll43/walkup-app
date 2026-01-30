export async function onRequestPost({ request, env }) {
  // protect with admin key
  const auth = request.headers.get("Authorization") || "";
  if (auth !== `Bearer ${env.ADMIN_KEY}`) return new Response("Unauthorized", { status: 401 });

  // Create a simple table for shared state
  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS team_state (
      id TEXT PRIMARY KEY,
      lineup_json TEXT NOT NULL,
      current_index INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Seed default if missing
  const existing = await env.DB.prepare(`SELECT id FROM team_state WHERE id = 'team'`).first();
  if (!existing) {
    await env.DB.prepare(`
      INSERT INTO team_state (id, lineup_json, current_index, updated_at)
      VALUES ('team', '[]', 0, datetime('now'))
    `).run();
  }

  return Response.json({ ok: true });
}
