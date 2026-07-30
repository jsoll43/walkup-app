// functions/api/admin/teams.js
import {
  DEFAULT_PARENT_RECORDING_MAX_SECONDS,
  MAX_PARENT_RECORDING_MAX_SECONDS,
  MIN_PARENT_RECORDING_MAX_SECONDS,
  normalizeParentRecordingMaxSeconds,
} from "../../lib/teamSettings.js";
import { ensureSeasonSchema, getCurrentSeason } from "../../lib/seasons.js";

function getAdminKey(req) {
  const h = req.headers;
  const bearer = (h.get("authorization") || "").trim();
  if (bearer.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  return (h.get("x-admin-key") || "").trim();
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function makeIdFromSlug(slug) {
  return `team_${slug.replace(/[^a-z0-9_-]/gi, "").toLowerCase()}`;
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const onRequestGet = async ({ request, env }) => {
  try {
    const key = getAdminKey(request);
    if (!key || key !== env.ADMIN_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

    await ensureSeasonSchema(env);

    const res = await env.DB.prepare(
      `SELECT t.id, t.name, t.slug, t.parent_key, t.coach_key,
              t.parent_recording_max_seconds, t.status, t.created_at, t.deleted_at,
              t.season_id, s.label AS season_label, s.status AS season_status,
              t.copied_from_team_id
       FROM teams t
       LEFT JOIN seasons s ON s.id = t.season_id
       WHERE t.status = 'active'
       ORDER BY CASE s.status WHEN 'current' THEN 0 ELSE 1 END,
                s.year DESC,
                CASE s.term WHEN 'fall' THEN 2 WHEN 'summer' THEN 1 WHEN 'spring' THEN 0 ELSE -1 END DESC,
                t.name ASC`
    ).all();

    return json({
      ok: true,
      currentSeason: await getCurrentSeason(env),
      teams: res.results || [],
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    const key = getAdminKey(request);
    if (!key || key !== env.ADMIN_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    let slug = String(body.slug || "").trim().toLowerCase();
    const parentKey = String(body.parentKey || "").trim();
    const coachKey = String(body.coachKey || "").trim();
    const recordingMaxSeconds = normalizeParentRecordingMaxSeconds(
      body?.recordingMaxSeconds ?? DEFAULT_PARENT_RECORDING_MAX_SECONDS
    );

    if (!name) return json({ ok: false, error: "Missing name" }, 400);
    if (!slug) slug = slugify(name);
    if (!slug || !/^[a-z0-9][a-z0-9-_]{1,60}$/.test(slug)) {
      return json({ ok: false, error: "Invalid team name; cannot create slug." }, 400);
    }
    if (!parentKey || parentKey.length < 4) return json({ ok: false, error: "Parent key is required (min 4 chars)" }, 400);
    if (!coachKey || coachKey.length < 4) return json({ ok: false, error: "Coach key is required (min 4 chars)" }, 400);
    if (
      String(body?.recordingMaxSeconds ?? "").trim() !== "" &&
      Number(body?.recordingMaxSeconds) !== recordingMaxSeconds
    ) {
      return json(
        {
          ok: false,
          error: `Recording limit must be between ${MIN_PARENT_RECORDING_MAX_SECONDS} and ${MAX_PARENT_RECORDING_MAX_SECONDS} seconds.`,
        },
        400
      );
    }

    await ensureSeasonSchema(env);
    const currentSeason = await getCurrentSeason(env);
    if (!currentSeason) return json({ ok: false, error: "No current season is configured." }, 409);

    slug = `${slug}-${currentSeason.id}`;

    const now = new Date().toISOString();
    let id = makeIdFromSlug(slug);

    // Prevent overwriting an existing active team (allow re-using deleted team slugs)
    const existing = await env.DB.prepare(`SELECT id FROM teams WHERE slug = ? AND status = 'active'`).bind(slug).first();
    if (existing) return json({ ok: false, error: "That team slug already exists." }, 409);

    // Check if this ID already exists (even in deleted teams), and generate a unique one if needed
    let idExists = await env.DB.prepare(`SELECT id FROM teams WHERE id = ?`).bind(id).first();
    let counter = 1;
    while (idExists) {
      id = `${makeIdFromSlug(slug)}_${counter}`;
      idExists = await env.DB.prepare(`SELECT id FROM teams WHERE id = ?`).bind(id).first();
      counter++;
    }

    await env.DB.prepare(
      `INSERT INTO teams
         (id, name, slug, parent_key, coach_key, parent_recording_max_seconds,
          status, created_at, season_id)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    )
      .bind(id, name, slug, parentKey, coachKey, recordingMaxSeconds, now, currentSeason.id)
      .run();

    // Initialize coach state row
    await env.DB.prepare(
      `INSERT OR REPLACE INTO coach_state_by_team (team_id, lineup_ids, current_index, updated_at, version)
       VALUES (?, '[]', 0, ?, 1)`
    )
      .bind(id, now)
      .run();

    return json({ ok: true, team: { id, name, slug, parent_recording_max_seconds: recordingMaxSeconds, created_at: now } });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};

// Allow updating team keys/name by slug
export const onRequestPut = async ({ request, env }) => {
  try {
    const key = getAdminKey(request);
    if (!key || key !== env.ADMIN_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await request.json().catch(() => ({}));
    const slug = String(body.slug || "").trim().toLowerCase();
    const name = body.name ? String(body.name).trim() : null;
    const parentKey = body.parentKey ? String(body.parentKey).trim() : null;
    const coachKey = body.coachKey ? String(body.coachKey).trim() : null;
    const hasRecordingMaxSeconds = Object.prototype.hasOwnProperty.call(body, "recordingMaxSeconds");
    const recordingMaxSeconds = normalizeParentRecordingMaxSeconds(body?.recordingMaxSeconds);

    if (!slug) return json({ ok: false, error: "Missing slug" }, 400);
    if (
      hasRecordingMaxSeconds &&
      String(body?.recordingMaxSeconds ?? "").trim() !== "" &&
      Number(body?.recordingMaxSeconds) !== recordingMaxSeconds
    ) {
      return json(
        {
          ok: false,
          error: `Recording limit must be between ${MIN_PARENT_RECORDING_MAX_SECONDS} and ${MAX_PARENT_RECORDING_MAX_SECONDS} seconds.`,
        },
        400
      );
    }

    await ensureSeasonSchema(env);

    const existing = await env.DB.prepare(
      `SELECT t.id FROM teams t
       JOIN seasons s ON s.id = t.season_id
       WHERE t.slug = ? AND t.status = 'active' AND s.status = 'current'`
    ).bind(slug).first();
    if (!existing) return json({ ok: false, error: "Unknown team" }, 404);

    const parts = [];
    const binds = [];
    if (name !== null) {
      parts.push(`name = ?`);
      binds.push(name);
    }
    if (parentKey !== null) {
      parts.push(`parent_key = ?`);
      binds.push(parentKey);
    }
    if (coachKey !== null) {
      parts.push(`coach_key = ?`);
      binds.push(coachKey);
    }
    if (hasRecordingMaxSeconds) {
      parts.push(`parent_recording_max_seconds = ?`);
      binds.push(recordingMaxSeconds);
    }
    if (parts.length === 0) return json({ ok: false, error: "Nothing to update" }, 400);

    binds.push(slug);
    const sql = `UPDATE teams SET ${parts.join(", ")} WHERE slug = ? AND status = 'active'`;
    const res = await env.DB.prepare(sql).bind(...binds).run();

    return json({ ok: true, updated: res?.meta?.changes || 0 });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};

export const onRequestDelete = async ({ request, env }) => {
  try {
    const key = getAdminKey(request);
    if (!key || key !== env.ADMIN_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await request.json().catch(() => ({}));
    const slug = String(body.slug || "").trim().toLowerCase();
    if (!slug) return json({ ok: false, error: "Missing slug" }, 400);
    if (slug === "default") return json({ ok: false, error: "Cannot delete the default team." }, 400);

    await ensureSeasonSchema(env);
    const team = await env.DB.prepare(
      `SELECT t.id FROM teams t
       JOIN seasons s ON s.id = t.season_id
       WHERE t.slug = ? AND t.status = 'active' AND s.status = 'current'`
    ).bind(slug).first();
    if (!team) return json({ ok: false, error: "Current-season team not found." }, 404);

    const now = new Date().toISOString();

    // Soft delete team
    const res = await env.DB.prepare(
      `UPDATE teams SET status='deleted', deleted_at=? WHERE id=? AND status='active'`
    )
      .bind(now, team.id)
      .run();

    return json({ ok: true, updated: res?.meta?.changes || 0 });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};

export const onRequestOptions = async () =>
  new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
      "access-control-allow-headers": "authorization,x-admin-key,content-type",
    },
  });
