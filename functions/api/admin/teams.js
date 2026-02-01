// functions/api/admin/teams.js
function getAdminKey(req) {
  const h = req.headers;
  const bearer = (h.get("authorization") || "").trim();
  if (bearer.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  return (h.get("x-admin-key") || "").trim();
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function makeIdFromSlug(slug) {
  return `team_${slug.replace(/[^a-z0-9_-]/gi, "").toLowerCase()}`;
}

export const onRequestGet = async ({ request, env }) => {
  try {
    const key = getAdminKey(request);
    if (!key || key !== env.ADMIN_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

    const res = await env.DB.prepare(
      `SELECT id, name, slug, status, created_at, deleted_at
       FROM teams
       ORDER BY created_at DESC`
    ).all();

    return json({ ok: true, teams: res.results || [] });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    const key = getAdminKey(request);
    if (!key || key !== env.ADMIN_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const slug = String(body.slug || "").trim().toLowerCase();
    const parentKey = String(body.parentKey || "").trim();
    const coachKey = String(body.coachKey || "").trim();

    if (!name) return json({ ok: false, error: "Missing name" }, 400);
    if (!slug || !/^[a-z0-9][a-z0-9-_]{1,30}$/.test(slug)) {
      return json({ ok: false, error: "Slug must be 2-31 chars: a-z, 0-9, dash, underscore" }, 400);
    }
    if (!parentKey || parentKey.length < 4) return json({ ok: false, error: "Parent key is required (min 4 chars)" }, 400);
    if (!coachKey || coachKey.length < 4) return json({ ok: false, error: "Coach key is required (min 4 chars)" }, 400);

    const now = new Date().toISOString();
    const id = makeIdFromSlug(slug);

    // Prevent overwriting an existing team
    const existing = await env.DB.prepare(`SELECT id FROM teams WHERE slug = ?`).bind(slug).first();
    if (existing) return json({ ok: false, error: "That slug already exists." }, 409);

    await env.DB.prepare(
      `INSERT INTO teams (id, name, slug, parent_key, coach_key, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`
    )
      .bind(id, name, slug, parentKey, coachKey, now)
      .run();

    // Initialize coach state row
    await env.DB.prepare(
      `INSERT OR REPLACE INTO coach_state_by_team (team_id, lineup_ids, current_index, updated_at, version)
       VALUES (?, '[]', 0, ?, 1)`
    )
      .bind(id, now)
      .run();

    return json({ ok: true, team: { id, name, slug, created_at: now } });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};

export const onRequestDelete = async ({ request, env }) => {
  try {
    const key = getAdminKey(request);
    if (!key || key !== env.ADMIN_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await request.json().catch(() => ({}));
    const slug = String(body.slug || "").trim().toLowerCase();
    if (!slug) return json({ ok: false, error: "Missing slug" }, 400);
    if (slug === "default") return json({ ok: false, error: "Cannot delete the default team." }, 400);

    const now = new Date().toISOString();

    // Soft delete team
    const res = await env.DB.prepare(
      `UPDATE teams SET status='deleted', deleted_at=? WHERE slug=? AND status='active'`
    )
      .bind(now, slug)
      .run();

    return json({ ok: true, updated: res?.meta?.changes || 0 });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};

export const onRequestOptions = async () =>
  new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
      "access-control-allow-headers": "authorization,x-admin-key,content-type",
    },
  });
