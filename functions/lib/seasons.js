import { ensureTeamsRecordingLimitColumn } from "./teamSettings.js";

export const SPRING_2026_ID = "spring-2026";
export const FALL_2026_ID = "fall-2026";

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function ensureColumn(env, table, column, typeSql) {
  const columns = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
  const exists = (columns?.results || []).some((item) => item?.name === column);
  if (!exists) {
    try {
      await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeSql}`).run();
    } catch (error) {
      if (!/duplicate column|already exists/i.test(String(error?.message || error))) {
        throw error;
      }
    }
  }
}

export async function uniqueTeamSlug(env, base) {
  const normalized = slugify(base) || `team-${crypto.randomUUID().slice(0, 8)}`;
  let candidate = normalized;
  let counter = 2;
  while (await env.DB.prepare(`SELECT id FROM teams WHERE slug = ?`).bind(candidate).first()) {
    candidate = `${normalized}-${counter}`;
    counter += 1;
  }
  return candidate;
}

export async function ensureSeasonSchema(env) {
  await ensureTeamsRecordingLimitColumn(env);

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS seasons (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      year INTEGER NOT NULL,
      term TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      archived_at TEXT
    )`
  ).run();

  await ensureColumn(env, "teams", "season_id", "TEXT");
  await ensureColumn(env, "teams", "copied_from_team_id", "TEXT");
  await ensureColumn(env, "roster_players", "copied_from_player_id", "TEXT");
  await ensureColumn(env, "roster_players", "copied_from_team_id", "TEXT");

  const countRow = await env.DB.prepare(`SELECT COUNT(*) AS count FROM seasons`).first();
  const now = new Date().toISOString();

  if (Number(countRow?.count || 0) === 0) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO seasons (id, label, year, term, status, created_at, archived_at)
         VALUES (?, 'Spring 2026', 2026, 'spring', 'archived', ?, ?)`
      ).bind(SPRING_2026_ID, now, now),
      env.DB.prepare(
        `INSERT INTO seasons (id, label, year, term, status, created_at, archived_at)
         VALUES (?, 'Fall 2026', 2026, 'fall', 'current', ?, NULL)`
      ).bind(FALL_2026_ID, now),
    ]);
  }

  const currentSeason = await env.DB.prepare(
    `SELECT id FROM seasons WHERE status = 'current' ORDER BY created_at DESC LIMIT 1`
  ).first();
  if (!currentSeason) {
    await env.DB.prepare(
      `UPDATE seasons SET status = 'current', archived_at = NULL WHERE id = ?`
    ).bind(FALL_2026_ID).run();
  }

  await env.DB.prepare(
    `UPDATE teams SET season_id = ? WHERE season_id IS NULL OR season_id = ''`
  ).bind(SPRING_2026_ID).run();

}

export async function getCurrentSeason(env) {
  await ensureSeasonSchema(env);
  return env.DB.prepare(
    `SELECT id, label, year, term, status, created_at
     FROM seasons
     WHERE status = 'current'
     ORDER BY created_at DESC
     LIMIT 1`
  ).first();
}

export async function createSeason(env, { label, year, term, copyTeams = false }) {
  await ensureSeasonSchema(env);

  const normalizedYear = Number(year);
  const normalizedTerm = slugify(term);
  const normalizedLabel = String(label || "").trim();
  const id = slugify(normalizedLabel || `${normalizedTerm}-${normalizedYear}`);
  if (!id || !normalizedLabel || !Number.isInteger(normalizedYear) || !normalizedTerm) {
    throw new Error("A valid season label, year, and term are required.");
  }

  const duplicate = await env.DB.prepare(`SELECT id FROM seasons WHERE id = ?`).bind(id).first();
  if (duplicate) throw new Error("That season already exists.");

  const previousSeason = await env.DB.prepare(
    `SELECT id FROM seasons WHERE status = 'current' ORDER BY created_at DESC LIMIT 1`
  ).first();
  const previousTeams = copyTeams && previousSeason
    ? await env.DB.prepare(
        `SELECT id, name, slug, parent_key, coach_key, parent_recording_max_seconds
         FROM teams WHERE season_id = ? AND status = 'active' ORDER BY created_at ASC`
      ).bind(previousSeason.id).all()
    : { results: [] };

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE seasons SET status = 'archived', archived_at = ?
     WHERE status = 'current'`
  ).bind(now).run();
  await env.DB.prepare(
    `INSERT INTO seasons (id, label, year, term, status, created_at, archived_at)
     VALUES (?, ?, ?, ?, 'current', ?, NULL)`
  ).bind(id, normalizedLabel, normalizedYear, normalizedTerm, now).run();

  for (const source of previousTeams?.results || []) {
    const slug = await uniqueTeamSlug(env, `${slugify(source.name)}-${id}`);
    const teamId = `team_${id.replace(/-/g, "_")}_${crypto.randomUUID().slice(0, 8)}`;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO teams
           (id, name, slug, parent_key, coach_key, parent_recording_max_seconds,
            status, created_at, deleted_at, season_id, copied_from_team_id)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, NULL, ?, ?)`
      ).bind(
        teamId,
        source.name,
        slug,
        source.parent_key,
        source.coach_key,
        Number(source.parent_recording_max_seconds || 5),
        now,
        id,
        source.id
      ),
      env.DB.prepare(
        `INSERT INTO coach_state_by_team
           (team_id, lineup_ids, current_index, updated_at, version)
         VALUES (?, '[]', 0, ?, 1)`
      ).bind(teamId, now),
    ]);
  }

  return { id, label: normalizedLabel, year: normalizedYear, term: normalizedTerm };
}
