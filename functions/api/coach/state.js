// functions/api/coach/state.js
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getCoachKey(req) {
  const bearer = (req.headers.get("authorization") || "").trim();
  if (bearer.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  return (req.headers.get("x-coach-key") || "").trim();
}

function getTeamSlug(req) {
  return (req.headers.get("x-team-slug") || "").trim().toLowerCase();
}

function clampIndex(idx, length) {
  if (length <= 0) return 0;
  const n = Number.isFinite(idx) ? idx : 0;
  return Math.max(0, Math.min(n, length - 1));
}

export const onRequestGet = async ({ request, env }) => {
  try {
    const teamSlug = getTeamSlug(request);
    if (!teamSlug) return json({ ok: false, error: "Missing team (x-team-slug)" }, 400);

    const coachKey = getCoachKey(request);
    if (!coachKey) return json({ ok: false, error: "Missing coach key" }, 401);

    const team = await env.DB.prepare(
      `SELECT id, name, slug, coach_key, status FROM teams WHERE slug = ?`
    )
      .bind(teamSlug)
      .first();

    if (!team || team.status !== "active") return json({ ok: false, error: "Unknown team" }, 404);
    if (team.coach_key !== coachKey) return json({ ok: false, error: "Unauthorized" }, 401);

    const row = await env.DB.prepare(
      `SELECT lineup_ids, current_index, updated_at, version
       FROM coach_state_by_team
       WHERE team_id = ?`
    )
      .bind(team.id)
      .first();

    const lineupIds = row?.lineup_ids ? JSON.parse(row.lineup_ids) : [];
    const currentIndex = clampIndex(Number(row?.current_index || 0), lineupIds.length);

    return json({
      ok: true,
      team: { slug: team.slug, name: team.name },
      lineupIds,
      currentIndex,
      updatedAt: row?.updated_at || "",
      version: Number(row?.version || 1),
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    const teamSlug = getTeamSlug(request);
    if (!teamSlug) return json({ ok: false, error: "Missing team (x-team-slug)" }, 400);

    const coachKey = getCoachKey(request);
    if (!coachKey) return json({ ok: false, error: "Missing coach key" }, 401);

    const team = await env.DB.prepare(
      `SELECT id, name, slug, coach_key, status FROM teams WHERE slug = ?`
    )
      .bind(teamSlug)
      .first();

    if (!team || team.status !== "active") return json({ ok: false, error: "Unknown team" }, 404);
    if (team.coach_key !== coachKey) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await request.json().catch(() => ({}));
    const nextLineupIds = Array.isArray(body.lineupIds) ? body.lineupIds.map(String) : [];
    const nextCurrentIndex = Number.isFinite(body.currentIndex) ? body.currentIndex : 0;
    const clientVersion = Number(body.clientVersion || 0);

    const row = await env.DB.prepare(
      `SELECT lineup_ids, current_index, updated_at, version
       FROM coach_state_by_team
       WHERE team_id = ?`
    )
      .bind(team.id)
      .first();

    const serverVersion = Number(row?.version || 1);

    // optimistic lock
    if (clientVersion && clientVersion !== serverVersion) {
      const serverLineup = row?.lineup_ids ? JSON.parse(row.lineup_ids) : [];
      return json(
        {
          ok: false,
          message: "Conflict: another coach updated the lineup.",
          server: {
            lineupIds: serverLineup,
            currentIndex: Number(row?.current_index || 0),
            updatedAt: row?.updated_at || "",
            version: serverVersion,
          },
        },
        409
      );
    }

    const now = new Date().toISOString();
    const newVersion = serverVersion + 1;
    const clamped = clampIndex(nextCurrentIndex, nextLineupIds.length);

    await env.DB.prepare(
      `INSERT OR REPLACE INTO coach_state_by_team (team_id, lineup_ids, current_index, updated_at, version)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(team.id, JSON.stringify(nextLineupIds), clamped, now, newVersion)
      .run();

    return json({
      ok: true,
      team: { slug: team.slug, name: team.name },
      lineupIds: nextLineupIds,
      currentIndex: clamped,
      updatedAt: now,
      version: newVersion,
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};

export const onRequestOptions = async () =>
  new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "authorization,x-coach-key,x-team-slug,content-type",
    },
  });
