import { getRequestKey, json } from "../../lib/api.js";
import { findFinalSong } from "../../lib/finalSongs.js";
import { ensureSeasonSchema } from "../../lib/seasons.js";

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const onRequestPost = async ({ request, env }) => {
  try {
    if (getRequestKey(request, "x-admin-key") !== env.ADMIN_KEY) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }
    await ensureSeasonSchema(env);

    const body = await request.json().catch(() => ({}));
    const sourcePlayerId = String(body.sourcePlayerId || "").trim();
    const destinationTeamId = String(body.destinationTeamId || "").trim();
    const copySong = body.copySong !== false;
    if (!sourcePlayerId || !destinationTeamId) {
      return json({ ok: false, error: "Source player and destination team are required." }, 400);
    }

    const source = await env.DB.prepare(
      `SELECT rp.id, rp.number, rp.first, rp.last, rp.team_id,
              t.name AS team_name, t.slug AS team_slug
       FROM roster_players rp
       JOIN teams t ON t.id = rp.team_id
       WHERE rp.id = ? AND rp.status = 'active'`
    ).bind(sourcePlayerId).first();
    if (!source) return json({ ok: false, error: "Source player not found." }, 404);

    const destination = await env.DB.prepare(
      `SELECT t.id, t.name, t.slug
       FROM teams t
       JOIN seasons s ON s.id = t.season_id
       WHERE t.id = ? AND t.status = 'active' AND s.status = 'current'`
    ).bind(destinationTeamId).first();
    if (!destination) {
      return json({ ok: false, error: "Destination must be a current-season team." }, 400);
    }

    const alreadyCopied = await env.DB.prepare(
      `SELECT id FROM roster_players
       WHERE team_id = ? AND copied_from_player_id = ? AND status = 'active'`
    ).bind(destination.id, source.id).first();
    if (alreadyCopied) {
      return json({ ok: false, error: "This player has already been copied to that team." }, 409);
    }

    const playerId = `${slugify(`${source.first}-${source.last}`) || "player"}-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO roster_players
         (id, number, first, last, status, created_at, updated_at, deleted_at,
          team_id, copied_from_player_id, copied_from_team_id)
       VALUES (?, ?, ?, ?, 'active', ?, ?, NULL, ?, ?, ?)`
    ).bind(
      playerId,
      source.number || "",
      source.first || "",
      source.last || "",
      now,
      now,
      destination.id,
      source.id,
      source.team_id
    ).run();

    let songCopied = false;
    if (copySong && env.WALKUP_VOICE) {
      const sourceTeam = {
        id: source.team_id,
        slug: source.team_slug,
        name: source.team_name,
      };
      const found = await findFinalSong(env.WALKUP_VOICE, sourceTeam, source.id);
      if (found) {
        await env.WALKUP_VOICE.put(`final/${destination.id}/${playerId}`, found.object.body, {
          httpMetadata: found.object.httpMetadata,
          customMetadata: {
            ...(found.object.customMetadata || {}),
            copiedAt: now,
            copiedFromKey: found.key,
            copiedFromPlayerId: source.id,
            copiedFromTeamId: source.team_id,
            teamSlug: destination.slug,
            teamName: destination.name,
          },
        });
        songCopied = true;
      }
    }

    return json({
      ok: true,
      player: { id: playerId, number: source.number, first: source.first, last: source.last },
      destinationTeam: destination,
      songCopied,
    });
  } catch (error) {
    return json({ ok: false, error: error?.message || String(error) }, 500);
  }
};
