// functions/api/roster.js
import { ensureSeasonSchema } from "../lib/seasons.js";
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getTeamSlug(req) {
  return (req.headers.get("x-team-slug") || "").trim().toLowerCase();
}

function getCoachKey(req) {
  const bearer = (req.headers.get("authorization") || "").trim();
  if (bearer.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  return (req.headers.get("x-coach-key") || "").trim();
}

function getAdminKey(req) {
  const bearer = (req.headers.get("authorization") || "").trim();
  if (bearer.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  return (req.headers.get("x-admin-key") || "").trim();
}

export const onRequestGet = async ({ request, env }) => {
  try {
    await ensureSeasonSchema(env);
    const teamSlug = getTeamSlug(request);
    if (!teamSlug) return json({ ok: false, error: "Missing team (x-team-slug)" }, 400);

    const team = await env.DB.prepare(
      `SELECT t.id, t.name, t.slug, t.coach_key, t.status,
              s.label AS season_label, s.status AS season_status
       FROM teams t
       JOIN seasons s ON s.id = t.season_id
       WHERE t.slug = ?`
    )
      .bind(teamSlug)
      .first();
    if (!team || team.status !== "active") return json({ ok: false, error: "Unknown team" }, 404);

    // allow coach OR admin
    const coachKey = getCoachKey(request);
    const adminKey = getAdminKey(request);
    const isAdmin = adminKey && adminKey === env.ADMIN_KEY;
    const isCoach = coachKey && coachKey === team.coach_key;

    if (!isAdmin && !isCoach) return json({ ok: false, error: "Unauthorized" }, 401);

    const res = await env.DB.prepare(
      `SELECT id, number, first, last, status
       FROM roster_players
       WHERE team_id = ? AND status = 'active'
       ORDER BY CAST(number AS INTEGER) ASC, last ASC, first ASC`
    )
      .bind(team.id)
      .all();

    return json({
      ok: true,
      team: {
        slug: team.slug,
        name: team.name,
        seasonLabel: team.season_label,
        seasonStatus: team.season_status,
      },
      roster: res.results || [],
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};
