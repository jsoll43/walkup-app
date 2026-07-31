import { json } from "../../lib/api.js";
import { authorizeArchiveCoach, getArchivedTeam } from "../../lib/archiveAccess.js";
import { findFinalSong } from "../../lib/finalSongs.js";
import { ensureSeasonSchema } from "../../lib/seasons.js";

export const onRequestGet = async ({ request, env }) => {
  try {
    await ensureSeasonSchema(env);
    const url = new URL(request.url);
    const teamId = String(url.searchParams.get("teamId") || "").trim();
    const playerId = String(url.searchParams.get("playerId") || "").trim();
    if (!teamId || !playerId) return json({ ok: false, error: "Missing team or player." }, 400);

    const team = await getArchivedTeam(env, teamId);
    if (!team) return json({ ok: false, error: "Archived team not found." }, 404);
    if (!await authorizeArchiveCoach(request, env, team)) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    if (!env.WALKUP_VOICE) return json({ ok: false, error: "Audio storage is unavailable." }, 500);

    const found = await findFinalSong(
      env.WALKUP_VOICE,
      team,
      playerId,
      { prefixFallback: true }
    );
    if (!found?.object) return json({ ok: false, error: "Song not found." }, 404);
    return new Response(found.object.body, {
      headers: {
        "content-type": found.object.httpMetadata?.contentType || "application/octet-stream",
        "cache-control": "no-store",
        "content-disposition": `inline; filename="${playerId}-final"`,
      },
    });
  } catch (error) {
    return json({ ok: false, error: error?.message || String(error) }, 500);
  }
};
