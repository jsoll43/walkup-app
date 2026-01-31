export async function onRequestGet({ request, env }) {
  try {
    const auth = request.headers.get("Authorization") || "";
    if (auth !== "Bearer " + env.COACH_KEY) return new Response("Unauthorized", { status: 401 });

    const row = await env.DB.prepare(
      "SELECT lineup_ids, current_index, updated_at, version FROM coach_state WHERE id = 1"
    ).first();

    if (!row) {
      // default empty state
      return Response.json({
        ok: true,
        lineupIds: [],
        currentIndex: 0,
        updatedAt: "",
        version: 0
      });
    }

    const lineupIds = row.lineup_ids ? JSON.parse(row.lineup_ids) : [];
    return Response.json({
      ok: true,
      lineupIds,
      currentIndex: Number(row.current_index || 0),
      updatedAt: row.updated_at || "",
      version: Number(row.version || 0)
    });
  } catch (e) {
    const msg = e?.stack || e?.message || String(e);
    return new Response("coach/state GET exception: " + msg, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = request.headers.get("Authorization") || "";
    if (auth !== "Bearer " + env.COACH_KEY) return new Response("Unauthorized", { status: 401 });

    const body = await request.json().catch(() => ({}));
    const lineupIds = Array.isArray(body.lineupIds) ? body.lineupIds : [];
    const currentIndex = Number.isFinite(body.currentIndex) ? body.currentIndex : 0;
    const clientVersion = Number.isFinite(body.clientVersion) ? body.clientVersion : null;

    // Fetch current version/state
    const current = await env.DB.prepare(
      "SELECT lineup_ids, current_index, updated_at, version FROM coach_state WHERE id = 1"
    ).first();

    const serverVersion = current ? Number(current.version || 0) : 0;

    // If clientVersion is provided and doesn't match, reject with 409 + current state
    if (clientVersion !== null && clientVersion !== serverVersion) {
      const serverLineup = current?.lineup_ids ? JSON.parse(current.lineup_ids) : [];
      return new Response(JSON.stringify({
        ok: false,
        conflict: true,
        message: "Lineup was updated by another coach. Refresh to avoid overwriting.",
        server: {
          lineupIds: serverLineup,
          currentIndex: Number(current?.current_index || 0),
          updatedAt: current?.updated_at || "",
          version: serverVersion
        }
      }), { status: 409, headers: { "Content-Type": "application/json" }});
    }

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const nextVersion = serverVersion + 1;

    // Upsert row id=1
    await env.DB.prepare(
      `INSERT INTO coach_state (id, lineup_ids, current_index, updated_at, version)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         lineup_ids = excluded.lineup_ids,
         current_index = excluded.current_index,
         updated_at = excluded.updated_at,
         version = excluded.version`
    ).bind(JSON.stringify(lineupIds), currentIndex, now, nextVersion).run();

    return Response.json({ ok: true, updatedAt: now, version: nextVersion });
  } catch (e) {
    const msg = e?.stack || e?.message || String(e);
    return new Response("coach/state POST exception: " + msg, { status: 500 });
  }
}
