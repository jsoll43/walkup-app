// functions/api/admin/roster-delete.js
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getAdminKey(request) {
  const url = new URL(request.url);
  const headerKey =
    request.headers.get("x-admin-key") ||
    request.headers.get("x-api-key") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  const queryKey = url.searchParams.get("key") || "";
  return (headerKey || queryKey || "").trim();
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.DB) return json({ ok: false, error: "Missing D1 binding env.DB" }, 500);
    if (!env?.ADMIN_KEY) return json({ ok: false, error: "Missing env.ADMIN_KEY" }, 500);

    const provided = getAdminKey(request);
    if (!provided || provided !== env.ADMIN_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await request.json().catch(() => null);
    const id = (body?.id || "").toString().trim();
    if (!id) return json({ ok: false, error: "id is required" }, 400);

    const now = new Date().toISOString();
    const q = `
      UPDATE roster_players
      SET status='deleted', updated_at=?, deleted_at=?
      WHERE id=?;
    `.trim();

    await env.DB.prepare(q).bind(now, now, id).run();

    return json({ ok: true, deleted: id });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e), stack: e?.stack || null }, 500);
  }
}
