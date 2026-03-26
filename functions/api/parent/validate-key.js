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
  return (req.headers.get("x-parent-key") || "").trim();
}

export const onRequestPost = async ({ request, env }) => {
  try {
    const teamSlug = getTeamSlug(request);
    if (!teamSlug) return json({ ok: false, error: "Missing team" }, 400);

    const parentKey = getParentKey(request);
    if (!parentKey) return json({ ok: false, error: "Missing parent key" }, 400);

    const team = await env.DB.prepare(
      `SELECT id, name, slug, parent_key, status
       FROM teams
       WHERE slug = ?`
    )
      .bind(teamSlug)
      .first();

    if (!team || team.status !== "active") {
      return json({ ok: false, error: "Unknown team" }, 404);
    }

    if (team.parent_key !== parentKey) {
      return json({ ok: false, error: "Invalid parent key" }, 401);
    }

    return json({ ok: true, message: "Valid parent key" }, 200);
  } catch (e) {
    console.error("Error validating parent key:", e);
    return json({ ok: false, error: "Server error" }, 500);
  }
};
