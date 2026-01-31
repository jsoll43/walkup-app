export async function onRequestPost({ request, env }) {
  try {
    const auth = request.headers.get("Authorization") || "";
    if (auth !== "Bearer " + env.ADMIN_KEY) return new Response("Unauthorized", { status: 401 });

    const body = await request.json().catch(() => ({}));
    const id = body.id;
    if (!id) return new Response("Missing id", { status: 400 });

    const row = await env.DB.prepare(
      `SELECT r2_key FROM parent_submissions WHERE id = ?`
    ).bind(id).first();

    if (!row) return new Response("Not found", { status: 404 });

    // Delete the object
    await env.WALKUP_VOICE.delete(row.r2_key);

    // Mark as deleted (keeps audit trail)
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    await env.DB.prepare(
      `UPDATE parent_submissions SET status='deleted', deleted_at=? WHERE id=?`
    ).bind(now, id).run();

    return Response.json({ ok: true });
  } catch (e) {
    const msg = e?.stack || e?.message || String(e);
    return new Response("admin/parent-delete exception: " + msg, { status: 500 });
  }
}
