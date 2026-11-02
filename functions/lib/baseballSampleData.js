// One-time, clearly labeled demonstration schedule requested for Nov 2-Dec 1, 2026.
// Everything is confined to baseball tables. No passwords, alerts, or BGSL rows change.
export const BASEBALL_SAMPLE_VERSION = "bll-sample-20261102-refined-v2";
export const BUBBLE_SAMPLE_VERSION = "bll-bubble-20261102-30days-v3";
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

export function buildLegacyBaseballSampleReservations() {
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

export function buildBaseballSampleReservations() {
  const legacy = buildLegacyBaseballSampleReservations();
  const output = [];
  for (const age of [6, 8, 10, 12, 14]) {
    const team = `Barrington ${age}U`;
    const practices = legacy.filter(item => item.team === team && item.reservationType === "practice");
    // Remove two practices per team, distributed across the month: 65 -> 55 field events.
    const removed = new Set([practices[2].id, practices[6].id]);
    const remainingPractices = practices.filter(item => !removed.has(item.id));
    // Nine remaining practices become games: 29 games and 26 practices in total.
    const converted = new Set((age === 14 ? [remainingPractices[3]] : [remainingPractices[1], remainingPractices[4]]).map(item => item.id));
    for (const event of legacy.filter(item => item.team === team && !removed.has(item.id))) {
      if (!converted.has(event.id)) { output.push(event); continue; }
      const opponent = TOWNS[(age / 2 + Number(event.date.slice(-2))) % TOWNS.length];
      output.push({...event, title:`[SAMPLE] ${age}U vs ${opponent}`, reservationType:"game"});
    }
  }
  return output.sort((a,b) => `${a.date} ${a.startTime} ${a.field}`.localeCompare(`${b.date} ${b.startTime} ${b.field}`));
}

export function buildBubbleSampleReservations() {
  return [
    ["2026-11-02", "17:00", 10, "Indoor Practice", "practice"],
    ["2026-11-04", "19:00", 14, "Batting Practice", "practice"],
    ["2026-11-07", "10:00", 6, "Skills Clinic", "clinic"],
    ["2026-11-09", "17:00", 8, "Indoor Practice", "practice"],
    ["2026-11-13", "19:00", 12, "Hitting Session", "practice"],
    ["2026-11-14", "12:00", 10, "Indoor Practice", "practice"],
    ["2026-11-06", "17:00", 12, "Hitting Session", "practice"],
    ["2026-11-11", "17:00", 6, "Skills Clinic", "clinic"],
    ["2026-11-16", "17:00", 8, "Indoor Practice", "practice"],
    ["2026-11-18", "19:00", 14, "Batting Practice", "practice"],
    ["2026-11-20", "17:00", 10, "Hitting Session", "practice"],
    ["2026-11-21", "10:00", 6, "Skills Clinic", "clinic"],
    ["2026-11-23", "17:00", 12, "Indoor Practice", "practice"],
    ["2026-11-25", "19:00", 14, "Batting Practice", "practice"],
    ["2026-11-27", "17:00", 8, "Hitting Session", "practice"],
    ["2026-11-28", "10:00", 6, "Skills Clinic", "clinic"],
    ["2026-11-30", "17:00", 10, "Indoor Practice", "practice"],
  ].map(([date,startTime,age,title,reservationType]) => ({
    id:`bll_sample_20261102_bubble_${date}_${age}u`, field:"bubble", team:`Barrington ${age}U`,
    title:`[SAMPLE] ${age}U ${title}`, reservationType, date, startTime,
    endTime:`${String(Number(startTime.slice(0,2))+2).padStart(2,"0")}:${startTime.slice(3)}`,
  })).sort((a, b) => a.date.localeCompare(b.date));
}

export async function ensureBaseballSampleData(env) {
  if (env.BASEBALL_SAMPLE_DATA === "off") return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS baseball_sample_seed_versions (
    id TEXT PRIMARY KEY, completed_at TEXT NOT NULL
  )`).run();
  // Separate versions prevent Bubble-only revisions from restoring field samples
  // that an admin has already removed.
  await seedSampleVersion(env, BASEBALL_SAMPLE_VERSION, buildBaseballSampleReservations(), "field <> 'bubble'");
  await seedSampleVersion(env, BUBBLE_SAMPLE_VERSION, buildBubbleSampleReservations(), "field = 'bubble'");
}

async function seedSampleVersion(env, version, events, scope) {
  const completed = await env.DB.prepare("SELECT id FROM baseball_sample_seed_versions WHERE id = ?")
    .bind(version).first();
  if (completed) return;
  const now = new Date().toISOString();
  const eventsJson = JSON.stringify(events);
  // Every mutation is gated by this version and limited to our sample rows.
  const statements = [
    env.DB.prepare(`INSERT OR IGNORE INTO baseball_scheduling_teams
      (id, name, slug, created_at, updated_at)
      SELECT json_extract(sample.value, '$.id'), json_extract(sample.value, '$.name'),
        json_extract(sample.value, '$.slug'), ?, ? FROM json_each(?) AS sample
      WHERE NOT EXISTS (SELECT 1 FROM baseball_sample_seed_versions WHERE id = ?)
        AND NOT EXISTS (SELECT 1 FROM baseball_scheduling_teams
          WHERE lower(name) = lower(json_extract(sample.value, '$.name')) OR slug = json_extract(sample.value, '$.slug'))`)
      .bind(now, now, JSON.stringify(BASEBALL_SAMPLE_TEAMS), version),
    env.DB.prepare(`DELETE FROM baseball_field_reservations
      WHERE created_by_role = 'sample_data' AND id LIKE 'bll_sample_20261102_%' AND (${scope})
        AND id NOT IN (SELECT json_extract(value, '$.id') FROM json_each(?))
        AND NOT EXISTS (SELECT 1 FROM baseball_sample_seed_versions WHERE id = ?)
        AND NOT EXISTS (SELECT 1 FROM baseball_field_requests
          WHERE reservation_id = baseball_field_reservations.id AND status = 'pending')`)
      .bind(eventsJson, version),
    env.DB.prepare(`UPDATE baseball_field_reservations SET
      title = (SELECT json_extract(sample.value, '$.title') FROM json_each(?) AS sample
        WHERE json_extract(sample.value, '$.id') = baseball_field_reservations.id),
      reservation_type = (SELECT json_extract(sample.value, '$.reservationType') FROM json_each(?) AS sample
        WHERE json_extract(sample.value, '$.id') = baseball_field_reservations.id),
      updated_at = ?
      WHERE created_by_role = 'sample_data' AND id LIKE 'bll_sample_20261102_%' AND (${scope})
        AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?))
        AND NOT EXISTS (SELECT 1 FROM baseball_sample_seed_versions WHERE id = ?)`)
      .bind(eventsJson, eventsJson, now, eventsJson, version),
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
      .bind(now, now, eventsJson, version),
    env.DB.prepare("INSERT OR IGNORE INTO baseball_sample_seed_versions (id, completed_at) VALUES (?, ?)")
      .bind(version, now),
  ];
  // D1 batches are transactional: concurrent page loads cannot partially seed or duplicate data.
  await env.DB.batch(statements);
}
