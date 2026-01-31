// functions/api/coach/state.js
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getCoachKey(request) {
  const headerKey =
    request.headers.get("x-coach-key") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  return (headerKey || "").trim();
}

function isNoSuchTable(err, tableName) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("no such table") && msg.includes(tableName.toLowerCase());
}

async function ensureCoachStateTable(db) {
  const stmts = [
    `
    CREATE TABLE IF NOT EXISTS coach_state (
      id INTEGER PRIMARY KEY,
      lineup_ids TEXT,
      current_index INTEGER,
      updated_at TEXT,
      version INTEGER
    );
    `.trim(),
  ];
  for (const s of stmts) await db.prepare(s).run();

  // ensure row id=1 exists
  const row = await db.prepare(`SELECT id FROM coach_state WHERE id=1;`).first();
  if (!row) {
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO coach_state (id, lineup_ids, current_index, updated_at, version) VALUES (1, ?, 0, ?, 0);`
      )
      .bind("[]", now)
      .run();
  }
}

async function ensureRosterTable(db) {
  const stmts = [
    `
    CREATE TABLE IF NOT EXISTS roster_players (
      id TEXT PRIMARY KEY,
      number TEXT,
      first TEXT,
      last TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    `.trim(),
    `CREATE INDEX IF NOT EXISTS idx_roster_status ON roster_players(status);`.trim(),
  ];
  for (const s of stmts) await db.prepare(s).run();
}

function clampIndex(idx, length) {
  if (length <= 0) return 0;
  const n = Number.isFinite(idx) ? idx : 0;
  return Math.max(0, Math.min(n, length - 1));
}

async function getActiveRosterIdSet(db) {
  // If roster table doesn't exist yet, create it so deletes/filtering are stable.
  try {
    const res = await db.prepare(`SELECT id FROM roster_players WHERE status='active';`).all();
    return new Set((res?.results || []).map((r) => r.id));
  } catch (e) {
    if (isNoSuchTable(e, "roster_players")) {
      await ensureRosterTable(db);
      const res2 = await db.prepare(`SELECT id FROM roster_players WHERE status='active';`).all();
      return new Set((res2?.results || []).map((r) => r.id));
    }
    throw e;
  }
}

async function readState(db) {
  const row = await db
    .prepare(`SELECT lineup_ids, current_index, updated_at, version FROM coach_state WHERE id=1;`)
    .first();

  const lineupIds = (() => {
    try {
      const parsed = JSON.parse(row?.lineup_ids || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  return {
    lineupIds,
    currentIndex: Number(row?.current_index || 0),
    updatedAt: row?.updated_at || "",
    version: Number(row?.version || 0),
  };
}

async function writeState(db, { lineupIds, currentIndex, version }) {
  const now = new Date().toISOString();
  await db
    .prepare(`UPDATE coach_state SET lineup_ids=?, current_index=?, updated_at=?, version=? WHERE id=1;`)
    .bind(JSON.stringify(lineupIds || []), Number(currentIndex || 0), now, Number(version || 0))
    .run();
  return { updatedAt: now };
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env?.DB) return json({ ok: false, error: "Missing D1 binding env.DB" }, 500);

    const key = getCoachKey(request);
    const expected = String(env.COACH_KEY || "").trim();
    if (!expected) return json({ ok: false, error: "Missing env.COACH_KEY" }, 500);
    if (!key || key !== expected) return json({ ok: false, error: "Unauthorized" }, 401);

    if (isNoSuchTable({ message: "" }, "coach_state")) {
      // noop (just keeps structure parallel)
    }

    // Ensure base table exists (so state GET always works)
    await ensureCoachStateTable(env.DB);

    // Read current server state
    const state = await readState(env.DB);

    // Auto-remove deleted players by filtering against active roster
    const activeIds = await getActiveRosterIdSet(env.DB);
    const filtered = state.lineupIds.filter((id) => activeIds.has(id));

    if (filtered.length !== state.lineupIds.length) {
      const nextIndex = clampIndex(state.currentIndex, filtered.length);
      const nextVersion = state.version + 1;

      const w = await writeState(env.DB, {
        lineupIds: filtered,
        currentIndex: nextIndex,
        version: nextVersion,
      });

      return json({
        ok: true,
        lineupIds: filtered,
        currentIndex: nextIndex,
        updatedAt: w.updatedAt,
        version: nextVersion,
        note: "Lineup auto-pruned because roster changed (deleted player).",
      });
    }

    return json({ ok: true, ...state });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e), stack: e?.stack || null }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.DB) return json({ ok: false, error: "Missing D1 binding env.DB" }, 500);

    const key = getCoachKey(request);
    const expected = String(env.COACH_KEY || "").trim();
    if (!expected) return json({ ok: false, error: "Missing env.COACH_KEY" }, 500);
    if (!key || key !== expected) return json({ ok: false, error: "Unauthorized" }, 401);

    await ensureCoachStateTable(env.DB);

    const body = await request.json().catch(() => null);
    if (!body) return json({ ok: false, error: "Invalid JSON" }, 400);

    const clientVersion = Number(body.clientVersion || 0);
    const incomingIds = Array.isArray(body.lineupIds) ? body.lineupIds : [];
    const incomingIndex = Number(body.currentIndex || 0);

    const server = await readState(env.DB);
    if (clientVersion !== server.version) {
      return json(
        {
          ok: false,
          message: "Conflict: another coach updated the lineup.",
          server,
        },
        409
      );
    }

    const activeIds = await getActiveRosterIdSet(env.DB);
    const filteredIds = incomingIds.filter((id) => activeIds.has(id));
    const nextIndex = clampIndex(incomingIndex, filteredIds.length);

    const nextVersion = server.version + 1;
    const w = await writeState(env.DB, {
      lineupIds: filteredIds,
      currentIndex: nextIndex,
      version: nextVersion,
    });

    return json({
      ok: true,
      lineupIds: filteredIds,
      currentIndex: nextIndex,
      updatedAt: w.updatedAt,
      version: nextVersion,
    });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e), stack: e?.stack || null }, 500);
  }
}
