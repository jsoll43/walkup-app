export async function onRequestPost(context) {
  try {
    const request = context.request;
    const env = context.env;

    const auth = request.headers.get("Authorization") || "";
    if (auth !== "Bearer " + env.ADMIN_KEY) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (!env.DB) {
      return new Response("D1 binding DB is missing (env.DB is undefined)", { status: 500 });
    }

    // Create table
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS team_state (" +
        "id TEXT PRIMARY KEY," +
        "lineup_json TEXT NOT NULL," +
        "current_index INTEGER NOT NULL," +
        "updated_at TEXT NOT NULL" +
      ");"
    );

    // Seed if missing
    const existing = await env.DB.prepare("SELECT id FROM team_state WHERE id = 'team'").first();
    if (!existing) {
      await env.DB.prepare(
        "INSERT INTO team_state (id, lineup_json, current_index, updated_at) " +
        "VALUES ('team', '[]', 0, datetime('now'))"
      ).run();
    }

    return new Response('{"ok":true}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e && (e.stack || e.message) ? (e.stack || e.message) : String(e);
    return new Response("db-init exception: " + msg, { status: 500 });
  }
}
