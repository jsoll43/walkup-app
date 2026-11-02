// One-time, clearly labeled demonstration schedule requested for Nov 2-Dec 1, 2026.
// Everything is confined to baseball tables. No passwords, alerts, or BGSL rows change.
export const BASEBALL_SAMPLE_VERSION = "bll-sample-20261102-30days-v1";
export const BASEBALL_SAMPLE_START = "2026-11-02";
export const BASEBALL_SAMPLE_TEAMS = [6, 8, 10, 12, 14].map(age => ({
  id: `bll_sample_team_${age}u`, name: `Barrington ${age}U`, slug: `barrington-${age}u`,
}));

const TOWNS = ["Haddon Heights", "Audubon", "Bellmawr", "Runnemede", "Haddon Township", "Magnolia"];
const ROTATION = {
  6: { field: "tee-ball", practices: [1, 3], start: "16:00", gameDay: 6, gameStart: "10:00" },
  8: { field: "minor", practices: [2, 4], start: "17:00", gameDay: 6, gameStart: "10:00" },
  10: { field: "minor", practices: [1, 3], start: "17:00", gameDay: 6, gameStart: "12:00" },
  12: { field: "major", practices: [1, 4], start: "17:00", gameDay: 0, gameStart: "10:00" },
  14: { field: "major", practices: [2, 3], start: "19:00", gameDay: 0, gameStart: "12:00" },
};

export function buildBaseballSampleReservations() {
  const output = [];
  for (let day = 0; day < 30; day++) {
    const date = new Date(`${BASEBALL_SAMPLE_START}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + day);
    const dateText = date.toISOString().slice(0, 10);
    for (const [ageText, rule] of Object.entries(ROTATION)) {
      const age = Number(ageText);
      const game = date.getUTCDay() === rule.gameDay;
      if (!game && !rule.practices.includes(date.getUTCDay())) continue;
      const startTime = game ? rule.gameStart : rule.start;
      const [hour, minute] = startTime.split(":");
      const opponent = TOWNS[(Math.floor(day / 7) + age / 2) % TOWNS.length];
      output.push({
        id: `bll_sample_20261102_${dateText}_${age}u`,
        team: `Barrington ${age}U`,
        title: game ? `[SAMPLE] ${age}U vs ${opponent}` : `[SAMPLE] ${age}U Practice`,
        field: rule.field,
        date: dateText,
        startTime,
        endTime: `${String(Number(hour) + 2).padStart(2, "0")}:${minute}`,
        reservationType: game ? "game" : "practice",
      });
    }
  }
  return output;
}

export async function ensureBaseballSampleData(env) {
  if (env.BASEBALL_SAMPLE_DATA === "off") return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS baseball_sample_seed_versions (
    id TEXT PRIMARY KEY, completed_at TEXT NOT NULL
  )`).run();
  const completed = await env.DB.prepare("SELECT id FROM baseball_sample_seed_versions WHERE id = ?")
    .bind(BASEBALL_SAMPLE_VERSION).first();
  if (completed) return;

  const now = new Date().toISOString();
  // Bulk JSON inserts keep initialization to three statements, even on the free D1 plan.
  const statements = [
    env.DB.prepare(`INSERT OR IGNORE INTO baseball_scheduling_teams
      (id, name, slug, created_at, updated_at)
      SELECT json_extract(sample.value, '$.id'), json_extract(sample.value, '$.name'),
        json_extract(sample.value, '$.slug'), ?, ? FROM json_each(?) AS sample
      WHERE NOT EXISTS (SELECT 1 FROM baseball_sample_seed_versions WHERE id = ?)
        AND NOT EXISTS (SELECT 1 FROM baseball_scheduling_teams
          WHERE lower(name) = lower(json_extract(sample.value, '$.name')) OR slug = json_extract(sample.value, '$.slug'))`)
      .bind(now, now, JSON.stringify(BASEBALL_SAMPLE_TEAMS), BASEBALL_SAMPLE_VERSION),
    // Existing reservations take priority. Demo events never replace or overlap them.
    env.DB.prepare(`INSERT OR IGNORE INTO baseball_field_reservations
      (id, field, team, title, reservation_type, date, start_time, end_time, status, notes, created_by_role, created_at, updated_at)
      SELECT json_extract(sample.value, '$.id'), json_extract(sample.value, '$.field'),
        json_extract(sample.value, '$.team'), json_extract(sample.value, '$.title'),
        json_extract(sample.value, '$.reservationType'), json_extract(sample.value, '$.date'),
        json_extract(sample.value, '$.startTime'), json_extract(sample.value, '$.endTime'),
        'approved', 'Fictional sample event for demonstration only; not an actual scheduled game or practice.',
        'sample_data', ?, ? FROM json_each(?) AS sample
      WHERE NOT EXISTS (SELECT 1 FROM baseball_sample_seed_versions WHERE id = ?)
        AND NOT EXISTS (SELECT 1 FROM baseball_field_reservations
          WHERE field = json_extract(sample.value, '$.field') AND date = json_extract(sample.value, '$.date')
            AND start_time < json_extract(sample.value, '$.endTime')
            AND end_time > json_extract(sample.value, '$.startTime'))`)
      .bind(now, now, JSON.stringify(buildBaseballSampleReservations()), BASEBALL_SAMPLE_VERSION),
    env.DB.prepare("INSERT OR IGNORE INTO baseball_sample_seed_versions (id, completed_at) VALUES (?, ?)")
      .bind(BASEBALL_SAMPLE_VERSION, now),
  ];
  // D1 batches are transactional: concurrent page loads cannot partially seed or duplicate data.
  await env.DB.batch(statements);
}
