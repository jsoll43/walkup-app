// functions/api/admin/final-upload.js
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

async function requireTeam(env, slug) {
  const team = await env.DB.prepare(
    `SELECT id, name, slug, status FROM teams WHERE slug = ?`
  ).bind(slug).first();
  if (!team || team.status !== "active") return null;
  return team;
}

export const onRequestPost = async ({ request, env }) => {
  try {
    const key = getAuthKey(request);
    if (!key || key !== env.ADMIN_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

    const teamSlug = getTeamSlug(request);
    const team = await requireTeam(env, teamSlug);
    if (!team) return json({ ok: false, error: `Unknown team: ${teamSlug}` }, 404);

    const ct = request.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("multipart/form-data")) {
      return json({ ok: false, error: "Expected multipart/form-data" }, 400);
    }

    const form = await request.formData();
    const playerId = String(form.get("playerId") || "").trim();
    const file = form.get("file");

    if (!playerId) return json({ ok: false, error: "Missing playerId" }, 400);
    if (!file || typeof file === "string") return json({ ok: false, error: "Missing file" }, 400);

    const bucket = env.WALKUP_VOICE;
    if (!bucket) return json({ ok: false, error: "R2 binding WALKUP_VOICE not configured" }, 500);

    // Team-aware final key (no extension for backwards compatibility with your UI/status map)
    const r2Key = `final/${team.slug}/${playerId}`;

    const buf = await file.arrayBuffer();
    const contentType = file.type || "application/octet-stream";
    const now = new Date().toISOString();

    await bucket.put(r2Key, buf, {
      httpMetadata: {
        contentType,
        cacheControl: "no-store",
      },
      customMetadata: {
        originalName: file.name || "",
        uploadedAt: now,
        teamSlug: team.slug,
        teamName: team.name,
      },
    });

    return json({
      ok: true,
      team: { slug: team.slug, name: team.name },
      playerId,
      r2Key,
      contentType,
      sizeBytes: buf.byteLength,
      updatedAt: now,
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "authorization,x-admin-key,x-team-slug,content-type",
      "access-control-max-age": "86400",
    },
  });
};

export const onRequestGet = async () => json({ ok: false, error: "Method not allowed" }, 405);
