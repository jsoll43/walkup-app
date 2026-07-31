import { getRequestKey, json } from "../../lib/api.js";
import { ensureSeasonSchema, getCurrentSeason, uniqueTeamSlug } from "../../lib/seasons.js";

export const onRequestPost = async ({ request, env }) => {
  try {
    if (getRequestKey(request, "x-admin-key") !== env.ADMIN_KEY) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }
    await ensureSeasonSchema(env);
    const body = await request.json().catch(() => ({}));
    const sourceTeamId = String(body.sourceTeamId || "").trim();
    if (!sourceTeamId) return json({ ok: false, error: "Source team is required." }, 400);

    const source = await env.DB.prepare(
      `SELECT t.id, t.name, t.slug, t.parent_key, t.coach_key,
              t.parent_recording_max_seconds
       FROM teams t
       JOIN seasons s ON s.id = t.season_id
       WHERE t.id = ? AND t.status = 'active' AND s.status = 'archived'`
    ).bind(sourceTeamId).first();
    if (!source) return json({ ok: false, error: "Archived team not found." }, 404);

    const currentSeason = await getCurrentSeason(env);
    const existing = await env.DB.prepare(
      `SELECT id FROM teams
       WHERE copied_from_team_id = ? AND season_id = ? AND status = 'active'`
    ).bind(source.id, currentSeason.id).first();
    if (existing) return json({ ok: false, error: "That team has already been copied forward." }, 409);

    const slug = await uniqueTeamSlug(env, `${source.name}-${currentSeason.id}`);
    const teamId = `team_${currentSeason.id.replace(/-/g, "_")}_${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO teams
           (id, name, slug, parent_key, coach_key, parent_recording_max_seconds,
            status, created_at, deleted_at, season_id, copied_from_team_id)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, NULL, ?, ?)`
      ).bind(
        teamId,
        source.name,
        slug,
        source.parent_key,
        source.coach_key,
        Number(source.parent_recording_max_seconds || 5),
        now,
        currentSeason.id,
        source.id
      ),
      env.DB.prepare(
        `INSERT INTO coach_state_by_team
           (team_id, lineup_ids, current_index, updated_at, version)
         VALUES (?, '[]', 0, ?, 1)`
      ).bind(teamId, now),
    ]);

    return json({
      ok: true,
      team: { id: teamId, name: source.name, slug, season_id: currentSeason.id },
    });
  } catch (error) {
    return json({ ok: false, error: error?.message || String(error) }, 500);
  }
};
