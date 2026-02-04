// functions/api/coach/final-file.js
function getBearer(req) {
  const auth = req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return "";
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getTeamSlug(req) {
  const u = new URL(req.url);
  return (
    (req.headers.get("x-team-slug") || "").trim().toLowerCase() ||
    (u.searchParams.get("teamSlug") || "").trim().toLowerCase() ||
    ""
  );
}

export async function onRequest(context) {
  const { request, env } = context;

  try {
    const key = getBearer(request);
    if (!key || key !== env.COACH_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

    if (request.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);

    const url = new URL(request.url);
    const playerId = (url.searchParams.get("playerId") || "").trim();
    if (!playerId) return json({ ok: false, error: "Missing playerId" }, 400);

    const bucket = env.WALKUP_VOICE;
    if (!bucket) return json({ ok: false, error: "R2 binding WALKUP_VOICE not configured" }, 500);

    const teamSlug = getTeamSlug(request) || "";

    // Prefer team-scoped key (new layout): final/<teamSlug>/<playerId>
    let obj = null;
    if (teamSlug) {
      const teamKey = `final/${teamSlug}/${playerId}`;
      obj = await bucket.get(teamKey);
      if (!obj) {
        const listed = await bucket.list({ prefix: `final/${teamSlug}/${playerId}` });
        const first = listed.objects?.[0];
        if (first?.key) obj = await bucket.get(first.key);
      }
    }

    // Fallback to legacy layout: final/<playerId>
    if (!obj) {
      const canonicalKey = `final/${playerId}`;
      obj = await bucket.get(canonicalKey);
      if (!obj) {
        const listed = await bucket.list({ prefix: `final/${playerId}` });
        const first = listed.objects?.[0];
        if (first?.key) obj = await bucket.get(first.key);
      }
    }

    if (!obj) return json({ ok: false, error: "Not found" }, 404);

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
