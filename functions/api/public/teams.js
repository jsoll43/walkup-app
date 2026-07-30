// functions/api/public/teams.js
import { ensureSeasonSchema, getCurrentSeason } from "../../lib/seasons.js";
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const onRequestGet = async ({ env }) => {
  try {
    await ensureSeasonSchema(env);
    const currentSeason = await getCurrentSeason(env);
    const res = await env.DB.prepare(
      `SELECT t.id, t.name, t.slug
       FROM teams t
       JOIN seasons s ON s.id = t.season_id
       WHERE t.status = 'active' AND s.status = 'current'
       ORDER BY t.name ASC`
    ).all();

    return json({ ok: true, currentSeason, teams: res.results || [] });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};
