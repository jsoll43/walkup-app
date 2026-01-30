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

    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS player_final (" +
        "player_id TEXT PRIMARY KEY," +
        "r2_key TEXT NOT NULL," +
        "uploaded_at TEXT NOT NULL" +
      ");"
    );

    return new Response('{"ok":true}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e && (e.stack || e.message) ? (e.stack || e.message) : String(e);
    return new Response("db-migrate-final exception: " + msg, { status: 500 });
  }
}
