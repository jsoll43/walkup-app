import { json } from "../../lib/api.js";
import {
  authorizeArchiveCoach,
  getArchivedTeam,
  publicArchivedTeam,
} from "../../lib/archiveAccess.js";
import { getFinalSongStatus } from "../../lib/finalSongs.js";
import { ensureSeasonSchema } from "../../lib/seasons.js";

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

    const team = await getArchivedTeam(env, teamId);
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
      team: publicArchivedTeam(team),
      roster,
      songStatus: await getFinalSongStatus(env.WALKUP_VOICE, team, roster),
    });
  } catch (error) {
    return json({ ok: false, error: error?.message || String(error) }, 500);
  }
};
