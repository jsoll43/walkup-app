export async function onRequestGet({ request, env }) {
  try {
    const auth = request.headers.get("Authorization") || "";
    if (auth !== "Bearer " + env.ADMIN_KEY) return new Response("Unauthorized", { status: 401 });

    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) return new Response("Missing id", { status: 400 });

    const row = await env.DB.prepare(
      `SELECT r2_key, content_type FROM parent_submissions WHERE id = ?`
    ).bind(id).first();

    if (!row) return new Response("Not found", { status: 404 });

    const obj = await env.WALKUP_VOICE.get(row.r2_key);
    if (!obj) return new Response("Missing object in storage", { status: 404 });

    return new Response(obj.body, {
      status: 200,
      headers: {
        "Content-Type": row.content_type || "audio/webm",
        "Cache-Control": "no-store"
      }
    });
  } catch (e) {
    const msg = e?.stack || e?.message || String(e);
    return new Response("admin/parent-audio exception: " + msg, { status: 500 });
  }
}
