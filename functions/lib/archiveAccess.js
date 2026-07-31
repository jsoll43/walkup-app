import { getRequestKey } from "./api.js";

export async function getArchivedTeam(env, teamId) {
  return env.DB.prepare(
    `SELECT t.id, t.name, t.slug, t.coach_key,
            s.id AS season_id, s.label AS season_label
     FROM teams t
     JOIN seasons s ON s.id = t.season_id
     WHERE t.id = ? AND t.status = 'active' AND s.status = 'archived'`
  ).bind(teamId).first();
}

export async function authorizeArchiveCoach(request, env, archivedTeam) {
  const key = getRequestKey(request, "x-coach-key");
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

export function publicArchivedTeam(team) {
  return {
    id: team.id,
    name: team.name,
    slug: team.slug,
    season_id: team.season_id,
    season_label: team.season_label,
  };
}

