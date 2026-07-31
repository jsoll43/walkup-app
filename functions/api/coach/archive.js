import { ensureSeasonSchema } from "../../lib/seasons.js";

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getCoachKey(request) {
  const bearer = (request.headers.get("authorization") || "").trim();
  if (bearer.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  return (request.headers.get("x-coach-key") || "").trim();
}

async function authorizeArchiveCoach(request, env, archivedTeam) {
  const key = getCoachKey(request);
  if (!key) return false;
  if (key === env.COACH_KEY || key === archivedTeam.coach_key) return true;

  const teamSlug = (request.headers.get("x-team-slug") || "").trim().toLowerCase();
  if (!teamSlug) return false;
  const currentTeam = await env.DB.prepare(
    `SELECT t.id
     FROM teams t
     JOIN seasons s ON s.id = t.season_id
     WHERE t.slug = ? AND t.status = 'active' AND s.status = 'current'
       AND t.coach_key = ?`
  ).bind(teamSlug, key).first();
  return Boolean(currentTeam);
}

async function songStatus(bucket, team, players) {
  if (!bucket) return {};
  const status = {};
  const prefixes = [`final/${team.id}/`, `final/${team.slug}/`];
  for (const prefix of prefixes) {
    let cursor;
    do {
      const result = await bucket.list({ prefix, cursor });
      for (const object of result.objects || []) {
        const playerId = object.key.slice(prefix.length).split(".")[0];
        if (playerId) status[playerId] = true;
      }
      cursor = result.truncated ? result.cursor : undefined;
    } while (cursor);
  }
  if (team.slug === "default") {
    for (const player of players) {
      if (!status[player.id] && await bucket.head(`final/${player.id}`)) status[player.id] = true;
    }
  }
  return status;
}

export const onRequestGet = async ({ request, env }) => {
  try {
    await ensureSeasonSchema(env);

    const url = new URL(request.url);
    const teamId = String(url.searchParams.get("teamId") || "").trim();
    if (!teamId) {
      const result = await env.DB.prepare(
        `SELECT s.id AS season_id, s.label AS season_label, s.year, s.term,
                t.id AS team_id, t.name AS team_name, t.slug AS team_slug
         FROM seasons s
         JOIN teams t ON t.season_id = s.id AND t.status = 'active'
         WHERE s.status = 'archived'
         ORDER BY s.year DESC,
                  CASE s.term WHEN 'fall' THEN 2 WHEN 'summer' THEN 1 WHEN 'spring' THEN 0 ELSE -1 END DESC,
                  t.name ASC`
      ).all();
      return json({ ok: true, archive: result.results || [] });
    }

    const team = await env.DB.prepare(
      `SELECT t.id, t.name, t.slug, t.coach_key,
              s.id AS season_id, s.label AS season_label
       FROM teams t
       JOIN seasons s ON s.id = t.season_id
       WHERE t.id = ? AND t.status = 'active' AND s.status = 'archived'`
    ).bind(teamId).first();
    if (!team) return json({ ok: false, error: "Archived team not found." }, 404);
    if (!await authorizeArchiveCoach(request, env, team)) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const rosterResult = await env.DB.prepare(
      `SELECT id, number, first, last
       FROM roster_players
       WHERE team_id = ? AND status = 'active'
       ORDER BY CAST(number AS INTEGER), last, first`
    ).bind(team.id).all();
    const roster = rosterResult.results || [];
    return json({
      ok: true,
      team: {
        id: team.id,
        name: team.name,
        slug: team.slug,
        season_id: team.season_id,
        season_label: team.season_label,
      },
      roster,
      songStatus: await songStatus(env.WALKUP_VOICE, team, roster),
    });
  } catch (error) {
    return json({ ok: false, error: error?.message || String(error) }, 500);
  }
};
