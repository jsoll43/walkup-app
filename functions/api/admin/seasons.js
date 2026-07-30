import { createSeason, ensureSeasonSchema } from "../../lib/seasons.js";

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getAdminKey(request) {
  const bearer = (request.headers.get("authorization") || "").trim();
  if (bearer.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  return (request.headers.get("x-admin-key") || "").trim();
}

async function listSeasons(env) {
  const result = await env.DB.prepare(
    `SELECT s.id, s.label, s.year, s.term, s.status, s.created_at, s.archived_at,
            COUNT(t.id) AS team_count
     FROM seasons s
     LEFT JOIN teams t ON t.season_id = s.id AND t.status = 'active'
     GROUP BY s.id
     ORDER BY s.year DESC,
              CASE s.term WHEN 'fall' THEN 2 WHEN 'summer' THEN 1 WHEN 'spring' THEN 0 ELSE -1 END DESC`
  ).all();
  return result.results || [];
}

export const onRequestGet = async ({ request, env }) => {
  try {
    if (getAdminKey(request) !== env.ADMIN_KEY) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }
    await ensureSeasonSchema(env);
    return json({ ok: true, seasons: await listSeasons(env) });
  } catch (error) {
    return json({ ok: false, error: error?.message || String(error) }, 500);
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    if (getAdminKey(request) !== env.ADMIN_KEY) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }
    const body = await request.json().catch(() => ({}));
    const season = await createSeason(env, body);
    return json({ ok: true, season, seasons: await listSeasons(env) });
  } catch (error) {
    const message = error?.message || String(error);
    return json({ ok: false, error: message }, /already exists|required/.test(message) ? 400 : 500);
  }
};

