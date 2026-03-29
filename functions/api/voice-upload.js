// functions/api/voice-upload.js
import {
  getParentInboxNotificationSettings,
  sendParentInboxEmail,
} from "../lib/parentInboxNotifications.js";

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

function uuid() {
  return crypto.randomUUID();
}

async function logAuthError(env, teamSlug, teamId, error) {
  try {
    await env.DB.prepare(
      `INSERT INTO auth_logs
       (id, team_id, team_slug, error_type, error_message, timestamp)
       VALUES (?, ?, ?, 'parent_unauthorized', ?, ?)`
    )
      .bind(uuid(), teamId || null, teamSlug, error, new Date().toISOString())
      .run();
  } catch (e) {
    console.error("Failed to log auth error:", e);
  }
}

export const onRequestPost = async ({ request, env }) => {
  try {
    const teamSlug = getTeamSlug(request);
    if (!teamSlug) return json({ ok: false, error: "Missing team (x-team-slug)" }, 400);

    const parentKey = getParentKey(request);
    if (!parentKey) return json({ ok: false, error: "Missing parent key" }, 401);

    const team = await env.DB.prepare(
      `SELECT id, name, slug, parent_key, status
       FROM teams
       WHERE slug = ?`
    )
      .bind(teamSlug)
      .first();

    if (!team || team.status !== "active") return json({ ok: false, error: "Unknown team" }, 404);
    
    if (team.parent_key !== parentKey) {
      await logAuthError(env, teamSlug, team.id, `Invalid parent key provided (expected: ${team.parent_key.substring(0, 3)}..., got: ${parentKey.substring(0, 3)}...)`);
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const ct = request.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("multipart/form-data")) {
      return json({ ok: false, error: "Expected multipart/form-data" }, 400);
    }

    const form = await request.formData();
    const playerName = String(form.get("playerName") || "").trim();
    const songRequest = String(form.get("songRequest") || "").trim();
    const file = form.get("file");

    if (!playerName) return json({ ok: false, error: "Player Name is required" }, 400);
    if (!file || typeof file === "string") return json({ ok: false, error: "Recording file is required" }, 400);

    const id = uuid();
    const ext = "webm";
    const r2Key = `parent-inbox/${team.slug}/${id}.${ext}`;

    const buf = await file.arrayBuffer();
    const contentType = file.type || "audio/webm";

    await env.WALKUP_VOICE.put(r2Key, buf, {
      httpMetadata: { contentType, cacheControl: "no-store" },
      customMetadata: { teamSlug: team.slug, teamName: team.name, createdAt: new Date().toISOString() },
    });

    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO parent_submissions
       (id, team_id, player_name, song_request, r2_key, content_type, size_bytes, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    )
      .bind(id, team.id, playerName, songRequest, r2Key, contentType, buf.byteLength, now)
      .run();

    try {
      const notificationSettings = await getParentInboxNotificationSettings(env);
      if (notificationSettings.enabled && notificationSettings.email) {
        const pendingRow = await env.DB.prepare(
          `SELECT COUNT(*) AS cnt
           FROM parent_submissions
           WHERE status = 'pending'`
        ).first();

        await sendParentInboxEmail(env, {
          email: notificationSettings.email,
          newSubmissions: 1,
          currentPending: Number(pendingRow?.cnt || 0),
          latestSubmission: {
            playerName,
            teamName: team.name,
            songRequest,
            createdAt: now,
          },
        });
      }
    } catch (notificationError) {
      console.error("Parent inbox notification failed:", notificationError);
    }

    return json({ ok: true, id, team: { slug: team.slug, name: team.name }, createdAt: now });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};

export const onRequestOptions = async () =>
  new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "authorization,x-parent-key,x-team-slug,content-type",
    },
  });
