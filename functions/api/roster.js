// functions/api/roster.js
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getAuthKey(request) {
  const url = new URL(request.url);
  const headerKey =
    request.headers.get("x-admin-key") ||
    request.headers.get("x-coach-key") ||
    request.headers.get("x-api-key") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  const queryKey = url.searchParams.get("key") || "";
  return (headerKey || queryKey || "").trim();
}

function isAllowed(key, env) {
  const a = (env.ADMIN_KEY || "").trim();
  const c = (env.COACH_KEY || "").trim();
  return !!key && (key === a || key === c);
}

function isNoSuchTable(err, tableName) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("no such table") && msg.includes(tableName.toLowerCase());
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
    `CREATE INDEX IF NOT EXISTS idx_roster_number ON roster_players(number);`.trim(),
    `CREATE INDEX IF NOT EXISTS idx_roster_name ON roster_players(last, first);`.trim(),
  ];

  for (const s of stmts) {
    await db.prepare(s).run();
  }
}

async function fetchRoster(db) {
  const q = `
    SELECT id, number, first, last, created_at, updated_at
    FROM roster_players
    WHERE status = 'active'
    ORDER BY
      CASE
        WHEN number GLOB '[0-9]*' AND number <> '' THEN CAST(number AS INTEGER)
        ELSE 9999
      END,
      number,
      last,
      first;
  `.trim();

  const res = await db.prepare(q).all();
  const roster = (res?.results || []).map((r) => ({
    id: r.id,
    number: r.number ?? "",
    first: r.first ?? "",
    last: r.last ?? "",
    created_at: r.created_at ?? "",
    updated_at: r.updated_at ?? "",
  }));

  return roster;
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env?.DB) return json({ ok: false, error: "Missing D1 binding env.DB" }, 500);

    const key = getAuthKey(request);
    if (!isAllowed(key, env)) return json({ ok: false, error: "Unauthorized" }, 401);

    try {
      const roster = await fetchRoster(env.DB);
      return json({ ok: true, roster });
    } catch (e) {
      if (isNoSuchTable(e, "roster_players")) {
        await ensureRosterTable(env.DB);
        const roster = await fetchRoster(env.DB);
        return json({ ok: true, roster, note: "Roster table was auto-created." });
      }
      throw e;
    }
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e), stack: e?.stack || null }, 500);
  }
}
