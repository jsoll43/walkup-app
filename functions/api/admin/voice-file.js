// functions/api/admin/voice-file.js
function getAuthKey(req) {
  const h = req.headers;
  const bearer = h.get("authorization") || "";
  if (bearer.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  return (h.get("x-admin-key") || "").trim();
}

function getTeamSlug(req) {
  const u = new URL(req.url);
  return (
    (req.headers.get("x-team-slug") || "").trim().toLowerCase() ||
    (u.searchParams.get("teamSlug") || "").trim().toLowerCase() ||
    "default"
  );
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function extFromType(type) {
  const t = (type || "").toLowerCase();
  if (t.includes("mpeg") || t.includes("mp3")) return "mp3";
  if (t.includes("wav")) return "wav";
  if (t.includes("webm")) return "webm";
  if (t.includes("ogg")) return "ogg";
  if (t.includes("mp4") || t.includes("m4a")) return "m4a";
  return "audio";
}

async function requireTeam(env, slug) {
  const team = await env.DB.prepare(
    `SELECT id, name, slug, status FROM teams WHERE slug = ?`
  ).bind(slug).first();
  if (!team || team.status !== "active") return null;
  return team;
}

export async function onRequest(context) {
  const { request, env } = context;

  try {
    const key = getAuthKey(request);
    if (!key || key !== env.ADMIN_KEY) return json({ ok: false, error: "Unauthorized" }, 401);
    if (request.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);

    const url = new URL(request.url);
    const playerId = String(url.searchParams.get("playerId") || "").trim();
    if (!playerId) return json({ ok: false, error: "Missing playerId" }, 400);

    const teamSlug = getTeamSlug(request);
    const team = await requireTeam(env, teamSlug);
    if (!team) return json({ ok: false, error: `Unknown team: ${teamSlug}` }, 404);

    const bucket = env.WALKUP_VOICE;
    if (!bucket) return json({ ok: false, error: "R2 binding WALKUP_VOICE not configured" }, 500);

    // Team-aware key
    const primaryKey = `final/${team.slug}/${playerId}`;

    // Backward compat: old installs stored finals at final/<playerId> (no team)
    const legacyKey = `final/${playerId}`;

    let obj = await bucket.get(primaryKey);
    let usedKey = primaryKey;

    if (!obj && team.slug === "default") {
      obj = await bucket.get(legacyKey);
      usedKey = legacyKey;
    }

    if (!obj) return json({ ok: false, error: "Not found" }, 404);

    const contentType = obj.httpMetadata?.contentType || "application/octet-stream";
    const ext = extFromType(contentType);

    // Prefer original filename if present
    const originalName = obj.customMetadata?.originalName || "";
    const filename = originalName && originalName.includes(".")
      ? originalName
      : `${playerId}.${ext}`;

    return new Response(obj.body, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="${filename}"`,
        "x-r2-key": usedKey,
      },
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
}

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "authorization,x-admin-key,x-team-slug,content-type",
      "access-control-max-age": "86400",
    },
  });
};
