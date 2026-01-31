export async function onRequestGet(context) {
  try {
    const { request, env } = context;

    // Coach auth
    const auth = request.headers.get("Authorization") || "";
    if (auth !== "Bearer " + env.COACH_KEY) {
      return new Response("Unauthorized", { status: 401 });
    }

    const url = new URL(request.url);
    const playerId = url.searchParams.get("playerId");
    if (!playerId) return new Response("Missing playerId", { status: 400 });

    // Look up the most recent final clip key for this player
    // Assumes table: final_clips(player_id, r2_key, uploaded_at)
    const row = await env.DB
      .prepare(
        "SELECT r2_key FROM final_clips WHERE player_id = ? ORDER BY uploaded_at DESC LIMIT 1"
      )
      .bind(playerId)
      .first();

    if (!row || !row.r2_key) {
      return new Response("Final clip not found", { status: 404 });
    }

    const obj = await env.WALKUP_VOICE.get(row.r2_key);
    if (!obj) return new Response("Final clip missing in storage", { status: 404 });

    const headers = new Headers();
    headers.set("Content-Type", obj.httpMetadata?.contentType || "audio/mpeg");
    headers.set("Cache-Control", "no-store");

    return new Response(obj.body, { status: 200, headers });
  } catch (e) {
    const msg = e && (e.stack || e.message) ? (e.stack || e.message) : String(e);
    return new Response("coach/final-file exception: " + msg, { status: 500 });
  }
}
