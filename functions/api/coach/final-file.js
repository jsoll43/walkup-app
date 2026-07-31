// functions/api/coach/final-file.js
import { getRequestKey, getTeamSlug, json } from "../../lib/api.js";
import { findFinalSong } from "../../lib/finalSongs.js";
import { ensureSeasonSchema } from "../../lib/seasons.js";

export async function onRequest(context) {
  const { request, env } = context;

  try {
    await ensureSeasonSchema(env);
    const key = getRequestKey(request);
    if (!key) return json({ ok: false, error: "Missing coach key" }, 401);

    if (request.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);

    const url = new URL(request.url);
    const playerId = (url.searchParams.get("playerId") || "").trim();
    if (!playerId) return json({ ok: false, error: "Missing playerId" }, 400);

    const teamSlug = getTeamSlug(request);
    if (!teamSlug) return json({ ok: false, error: "Missing team (x-team-slug)" }, 400);

    const team = await env.DB.prepare(
      `SELECT t.id, t.name, t.slug, t.coach_key, t.status, s.status AS season_status
       FROM teams t JOIN seasons s ON s.id = t.season_id
       WHERE t.slug = ?`
    )
      .bind(teamSlug)
      .first();

    if (!team || team.status !== "active" || team.season_status !== "current") {
      return json({ ok: false, error: "Unknown current-season team" }, 404);
    }
    if (team.coach_key !== key && key !== env.COACH_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

    const bucket = env.WALKUP_VOICE;
    if (!bucket) return json({ ok: false, error: "R2 binding WALKUP_VOICE not configured" }, 500);

    const found = await findFinalSong(bucket, team, playerId, {
      prefixFallback: true,
      // Some pre-season data used final/<playerId> for teams other than "default".
      includeGlobalLegacy: true,
    });
    if (!found?.object) return json({ ok: false, error: "Not found" }, 404);
    const obj = found.object;

    const ct = obj.httpMetadata?.contentType || "application/octet-stream";

    return new Response(obj.body, {
      status: 200,
      headers: {
        "content-type": ct,
        "cache-control": "no-store",
        "content-disposition": `inline; filename="${playerId}-final"`,
      },
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
}
