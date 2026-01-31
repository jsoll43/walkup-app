// functions/api/admin/final-status.js
function getAuthKey(req) {
  const h = req.headers;
  const bearer = h.get("authorization") || "";
  if (bearer.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  return (h.get("x-admin-key") || "").trim();
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function playerIdFromKey(key) {
  // key like "final/<playerId>" or "final/<playerId>.wav"
  const rest = key.startsWith("final/") ? key.slice("final/".length) : key;
  // collapse extensions for backwards compatibility
  return rest.split(".")[0];
}

export async function onRequest(context) {
  const { request, env } = context;

  try {
    const key = getAuthKey(request);
    if (!key || key !== env.ADMIN_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

    if (request.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);

    const bucket = env.WALKUP_VOICE;
    if (!bucket) return json({ ok: false, error: "R2 binding WALKUP_VOICE not configured" }, 500);

    const status = {};
    let cursor = undefined;

    // list may paginate
    do {
      const listed = await bucket.list({ prefix: "final/", cursor });
      for (const obj of listed.objects) {
        const pid = playerIdFromKey(obj.key);
        status[pid] = true;
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);

    return json({ ok: true, status, counted: Object.keys(status).length });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
}
