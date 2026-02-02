// functions/api/admin/roster-upsert.js
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

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function shortId() {
  // 6 chars from uuid
  return crypto.randomUUID().split("-")[0];
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.DB) return json({ ok: false, error: "Missing D1 binding env.DB" }, 500);
    if (!env?.ADMIN_KEY) return json({ ok: false, error: "Missing env.ADMIN_KEY" }, 500);

    const provided = getAdminKey(request);
    if (!provided || provided !== env.ADMIN_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await request.json().catch(() => null);
    if (!body) return json({ ok: false, error: "Invalid JSON body" }, 400);

    const number = (body.number ?? "").toString().trim();
    const first = (body.first ?? "").toString().trim();
    const last = (body.last ?? "").toString().trim();
    let id = (body.id ?? "").toString().trim();

    if (!first || !last) return json({ ok: false, error: "first and last are required" }, 400);

    if (!id) {
      const base = slugify(`${first}-${last}`) || "player";
      id = `${base}-${shortId()}`;
    } else {
      id = slugify(id) || id;
    }

    const now = new Date().toISOString();

    // Determine team_id from body.teamId or body.teamSlug
    let teamId = body.teamId ? String(body.teamId).trim() : "";
    const teamSlug = body.teamSlug ? String(body.teamSlug).trim().toLowerCase() : "";
    if (!teamId && teamSlug) {
      const t = await env.DB.prepare(`SELECT id FROM teams WHERE slug = ? AND status = 'active'`).bind(teamSlug).first();
      if (t && t.id) teamId = t.id;
    }

    const q = `
      INSERT INTO roster_players
        (id, number, first, last, status, created_at, updated_at, deleted_at, team_id)
      VALUES
        (?,  ?,      ?,     ?,    'active', ?,        ?,        NULL,   ?)
      ON CONFLICT(id) DO UPDATE SET
        number = excluded.number,
        first = excluded.first,
        last = excluded.last,
        status = 'active',
        updated_at = excluded.updated_at,
        deleted_at = NULL,
        team_id = COALESCE(excluded.team_id, roster_players.team_id);
    `.trim();

    await env.DB.prepare(q).bind(id, number, first, last, now, now, teamId || null).run();

    return json({ ok: true, player: { id, number, first, last } });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e), stack: e?.stack || null }, 500);
  }
}
