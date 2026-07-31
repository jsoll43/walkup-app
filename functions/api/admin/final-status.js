// functions/api/admin/final-status.js
import { getRequestKey, getTeamSlug, json } from "../../lib/api.js";
import { getFinalSongStatus } from "../../lib/finalSongs.js";
import { ensureSeasonSchema } from "../../lib/seasons.js";

async function requireTeam(env, slug) {
  const team = await env.DB.prepare(
    `SELECT id, name, slug, status FROM teams WHERE slug = ?`
  ).bind(slug).first();
  if (!team || team.status !== "active") return null;
  return team;
}

async function handle(request, env) {
  const key = getRequestKey(request, "x-admin-key");
  if (!key || key !== env.ADMIN_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

  const teamSlug = getTeamSlug(request, "default");
  const team = await requireTeam(env, teamSlug);
  if (!team) return json({ ok: false, error: `Unknown team: ${teamSlug}` }, 404);

  const bucket = env.WALKUP_VOICE;
  if (!bucket) return json({ ok: false, error: "R2 binding WALKUP_VOICE not configured" }, 500);

  let roster = [];
  if (team.slug === "default") {
    const result = await env.DB.prepare(
      `SELECT id FROM roster_players WHERE team_id = ? AND status = 'active'`
    ).bind(team.id).all();
    roster = result.results || [];
  }
  const status = await getFinalSongStatus(bucket, team, roster);

  return json({
    ok: true,
    team: { slug: team.slug, name: team.name },
    status,
    counted: Object.keys(status).length,
  });
}

export const onRequestGet = async (context) => {
  try {
    await ensureSeasonSchema(context.env);
    return await handle(context.request, context.env);
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};

export const onRequestPost = async (context) => {
  try {
    await ensureSeasonSchema(context.env);
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
