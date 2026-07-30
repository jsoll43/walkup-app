import { ensureSeasonSchema } from "../../lib/seasons.js";

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getCoachKey(request) {
  const bearer = (request.headers.get("authorization") || "").trim();
  return bearer.toLowerCase().startsWith("bearer ")
    ? bearer.slice(7).trim()
    : (request.headers.get("x-coach-key") || "").trim();
}

async function findSong(bucket, team, playerId) {
  const keys = [
    `final/${team.id}/${playerId}`,
    `final/${team.slug}/${playerId}`,
    ...(team.slug === "default" ? [`final/${playerId}`] : []),
  ];
  for (const key of keys) {
    const object = await bucket.get(key);
    if (object) return object;
  }
  return null;
}

export const onRequestGet = async ({ request, env }) => {
  try {
    await ensureSeasonSchema(env);
    const currentTeamSlug = (request.headers.get("x-team-slug") || "").trim().toLowerCase();
    const key = getCoachKey(request);
    const authorized = await env.DB.prepare(
      `SELECT t.id FROM teams t
       JOIN seasons s ON s.id = t.season_id
       WHERE t.slug = ? AND t.status = 'active' AND s.status = 'current'
         AND (t.coach_key = ? OR ? = ?)`
    ).bind(currentTeamSlug, key, key, env.COACH_KEY || "").first();
    if (!authorized) return json({ ok: false, error: "Unauthorized" }, 401);

    const url = new URL(request.url);
    const teamId = String(url.searchParams.get("teamId") || "").trim();
    const playerId = String(url.searchParams.get("playerId") || "").trim();
    if (!teamId || !playerId) return json({ ok: false, error: "Missing team or player." }, 400);

    const team = await env.DB.prepare(
      `SELECT t.id, t.slug FROM teams t
       JOIN seasons s ON s.id = t.season_id
       WHERE t.id = ? AND t.status = 'active' AND s.status = 'archived'`
    ).bind(teamId).first();
    if (!team) return json({ ok: false, error: "Archived team not found." }, 404);
    if (!env.WALKUP_VOICE) return json({ ok: false, error: "Audio storage is unavailable." }, 500);

    const object = await findSong(env.WALKUP_VOICE, team, playerId);
    if (!object) return json({ ok: false, error: "Song not found." }, 404);
    return new Response(object.body, {
      headers: {
        "content-type": object.httpMetadata?.contentType || "application/octet-stream",
        "cache-control": "no-store",
        "content-disposition": `inline; filename="${playerId}-final"`,
      },
    });
  } catch (error) {
    return json({ ok: false, error: error?.message || String(error) }, 500);
  }
};

