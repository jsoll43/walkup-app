import {
  normalizeParentRecordingMaxSeconds,
} from "../../lib/teamSettings.js";
import { ensureSeasonSchema } from "../../lib/seasons.js";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getTeamSlug(req) {
  return (req.headers.get("x-team-slug") || "").trim().toLowerCase();
}

function getParentKey(req) {
  const bearer = (req.headers.get("authorization") || "").trim();
  if (bearer.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  return (req.headers.get("x-parent-key") || "").trim();
}

export const onRequestGet = async ({ request, env }) => {
  try {
    const teamSlug = getTeamSlug(request);
    if (!teamSlug) return json({ ok: false, error: "Missing team" }, 400);

    const parentKey = getParentKey(request);
    if (!parentKey) return json({ ok: false, error: "Missing parent key" }, 401);

    await ensureSeasonSchema(env);

    const team = await env.DB.prepare(
      `SELECT t.id, t.slug, t.parent_key, t.parent_recording_max_seconds,
              t.status, s.status AS season_status
       FROM teams t
       JOIN seasons s ON s.id = t.season_id
       WHERE t.slug = ?`
    )
      .bind(teamSlug)
      .first();

    if (!team || team.status !== "active" || team.season_status !== "current") {
      return json({ ok: false, error: "Unknown team" }, 404);
    }

    if (team.parent_key !== parentKey) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    return json({
      ok: true,
      settings: {
        recordingMaxSeconds: normalizeParentRecordingMaxSeconds(
          team.parent_recording_max_seconds
        ),
      },
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, Number(e?.statusCode || 500));
  }
};

export const onRequestOptions = async () =>
  new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "authorization,x-parent-key,x-team-slug,content-type",
    },
  });
