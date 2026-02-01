// functions/api/admin/final-status.js
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

function playerIdFromKey(key, teamSlug) {
  // key like "final/<teamSlug>/<playerId>" or "final/<teamSlug>/<playerId>.wav"
  const prefix = `final/${teamSlug}/`;
  const rest = key.startsWith(prefix) ? key.slice(prefix.length) : key;
  return rest.split(".")[0];
}

async function requireTeam(env, slug) {
  const team = await env.DB.prepare(
    `SELECT id, name, slug, status FROM teams WHERE slug = ?`
  ).bind(slug).first();
  if (!team || team.status !== "active") return null;
  return team;
}

async function handle(request, env) {
  const key = getAuthKey(request);
  if (!key || key !== env.ADMIN_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

  const teamSlug = getTeamSlug(request);
  const team = await requireTeam(env, teamSlug);
  if (!team) return json({ ok: false, error: `Unknown team: ${teamSlug}` }, 404);

  const bucket = env.WALKUP_VOICE;
  if (!bucket) return json({ ok: false, error: "R2 binding WALKUP_VOICE not configured" }, 500);

  const status = {};
  let cursor = undefined;

  const prefix = `final/${team.slug}/`;

  do {
    const listed = await bucket.list({ prefix, cursor });
    for (const obj of listed.objects) {
      const pid = playerIdFromKey(obj.key, team.slug);
      if (pid) status[pid] = true;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return json({
    ok: true,
    team: { slug: team.slug, name: team.name },
    status,
    counted: Object.keys(status).length,
  });
}

export const onRequestGet = async (context) => {
  try {
    return await handle(context.request, context.env);
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};

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
      "access-control-allow-headers": "authorization,x-admin-key,x-team-slug,content-type",
      "access-control-max-age": "86400",
    },
  });
};
