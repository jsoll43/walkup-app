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
  return rest.split(".")[0];
}

async function handle(request, env) {
  const key = getAuthKey(request);
  if (!key || key !== env.ADMIN_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

  const bucket = env.WALKUP_VOICE;
  if (!bucket) return json({ ok: false, error: "R2 binding WALKUP_VOICE not configured" }, 500);

  const status = {};
  let cursor = undefined;

  do {
    const listed = await bucket.list({ prefix: "final/", cursor });
    for (const obj of listed.objects) {
      const pid = playerIdFromKey(obj.key);
      status[pid] = true;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return json({ ok: true, status, counted: Object.keys(status).length });
}

export const onRequestGet = async (context) => {
  try {
    return await handle(context.request, context.env);
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};

// (Optional) allow POST too, just in case some older UI calls POST.
export const onRequestPost = async (context) => {
  try {
    return await handle(context.request, context.env);
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "authorization,x-admin-key,content-type",
      "access-control-max-age": "86400",
    },
  });
};
