import { getRequestKey, json } from "../../lib/api.js";
import { findFinalSongMetadata } from "../../lib/finalSongs.js";
import { ensureSeasonSchema } from "../../lib/seasons.js";

function uploadedAtValue(object) {
  const values = [object?.customMetadata?.uploadedAt, object?.uploaded];
  for (const value of values) {
    const timestamp = value instanceof Date ? value.getTime() : Date.parse(String(value || ""));
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

function uploadedAtLabel(object) {
  const timestamp = uploadedAtValue(object);
  return timestamp ? new Date(timestamp).toISOString() : null;
}

export const onRequestPost = async ({ request, env }) => {
  try {
    if (getRequestKey(request, "x-admin-key") !== env.ADMIN_KEY) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }
    await ensureSeasonSchema(env);

    const body = await request.json().catch(() => ({}));
    const destinationPlayerId = String(body.destinationPlayerId || "").trim();
    if (!destinationPlayerId) {
      return json({ ok: false, error: "Destination player is required." }, 400);
    }

    const destination = await env.DB.prepare(
      `SELECT rp.id, rp.first, rp.last, rp.team_id,
              t.name AS team_name, t.slug AS team_slug
       FROM roster_players rp
       JOIN teams t ON t.id = rp.team_id
       JOIN seasons s ON s.id = t.season_id
       WHERE rp.id = ? AND rp.status = 'active'
         AND t.status = 'active' AND s.status = 'current'`
    ).bind(destinationPlayerId).first();
    if (!destination) {
      return json({ ok: false, error: "Destination must be a current-season player." }, 404);
    }

    const bucket = env.WALKUP_VOICE;
    if (!bucket) {
      return json({ ok: false, error: "R2 binding WALKUP_VOICE not configured" }, 500);
    }

    const destinationTeam = {
      id: destination.team_id,
      slug: destination.team_slug,
      name: destination.team_name,
    };
    const existing = await findFinalSongMetadata(
      bucket,
      destinationTeam,
      destination.id,
      { prefixFallback: true }
    );
    if (existing) {
      return json({ ok: false, error: "This player already has a final song." }, 409);
    }

    const result = await env.DB.prepare(
      `SELECT rp.id, rp.team_id, t.name AS team_name, t.slug AS team_slug,
              s.id AS season_id, s.label AS season_label
       FROM roster_players rp
       JOIN teams t ON t.id = rp.team_id
       JOIN seasons s ON s.id = t.season_id
       WHERE rp.id <> ? AND rp.team_id <> ?
         AND rp.status = 'active' AND t.status = 'active'
         AND LOWER(TRIM(rp.first)) = LOWER(TRIM(?))
         AND LOWER(TRIM(rp.last)) = LOWER(TRIM(?))`
    ).bind(
      destination.id,
      destination.team_id,
      destination.first,
      destination.last
    ).all();
    const matches = result?.results || [];
    if (!matches.length) {
      return json({ ok: false, error: "No player with the same name was found on another team or season." }, 404);
    }

    const songs = await Promise.all(matches.map(async (player) => {
      const found = await findFinalSongMetadata(
        bucket,
        { id: player.team_id, slug: player.team_slug, name: player.team_name },
        player.id,
        { prefixFallback: true }
      );
      return found ? { player, ...found } : null;
    }));
    const newest = songs
      .filter(Boolean)
      .sort((a, b) => uploadedAtValue(b.object) - uploadedAtValue(a.object))[0];
    if (!newest) {
      return json({ ok: false, error: "Matching players were found, but none has a final song to copy." }, 404);
    }

    const sourceObject = await bucket.get(newest.key);
    if (!sourceObject) {
      return json({ ok: false, error: "The matching song is no longer available." }, 404);
    }

    const now = new Date().toISOString();
    const sourceUploadedAt = uploadedAtLabel(newest.object);
    const destinationKey = `final/${destination.team_id}/${destination.id}`;
    await bucket.put(destinationKey, sourceObject.body, {
      httpMetadata: sourceObject.httpMetadata,
      customMetadata: {
        ...(sourceObject.customMetadata || {}),
        ...(sourceUploadedAt ? { uploadedAt: sourceUploadedAt } : {}),
        copiedAt: now,
        copiedFromKey: newest.key,
        copiedFromPlayerId: newest.player.id,
        copiedFromTeamId: newest.player.team_id,
        teamSlug: destination.team_slug,
        teamName: destination.team_name,
      },
    });

    return json({
      ok: true,
      playerId: destination.id,
      destinationKey,
      source: {
        playerId: newest.player.id,
        teamId: newest.player.team_id,
        teamName: newest.player.team_name,
        seasonId: newest.player.season_id,
        seasonLabel: newest.player.season_label,
        uploadedAt: sourceUploadedAt,
      },
    });
  } catch (error) {
    return json({ ok: false, error: error?.message || String(error) }, 500);
  }
};
