// A separate, additive set of examples for November 1–7. Its IDs deliberately
// differ from the original samples so the seven-day move cannot affect them.
const VERSION = "bll-extra-november-1-7-2026-v1";

export async function ensureNovemberWeekSamples(env, fieldSamples, bubbleSamples) {
  if (env.BASEBALL_EXTRA_WEEK === "off") return;
  if (await env.DB.prepare("SELECT id FROM baseball_sample_seed_versions WHERE id = ?").bind(VERSION).first()) return;
  const examples = [
    ...fieldSamples.filter(item => item.date >= "2026-11-02" && item.date <= "2026-11-07"),
    ...bubbleSamples.filter(item => item.date >= "2026-11-01" && item.date <= "2026-11-07"),
    {date:"2026-11-01",field:"major",team:"Barrington 12U",title:"[SAMPLE] 12U vs Bellmawr",startTime:"10:00",endTime:"12:00",reservationType:"game"},
    {date:"2026-11-01",field:"major",team:"Barrington 14U",title:"[SAMPLE] 14U vs Haddon Heights",startTime:"12:00",endTime:"14:00",reservationType:"game"},
  ].map(item => ({...item,id:`bll_extra_20261101_${item.date}_${item.field}_${item.team.replace(/\W/g, "").toLowerCase()}`}));
  const now = new Date().toISOString();
  const candidates = [8,10,12,14,16,18,20].map(hour=>({start:`${String(hour).padStart(2,"0")}:00`,end:`${String(hour+2).padStart(2,"0")}:00`}));
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO baseball_field_reservations
      (id,field,team,title,reservation_type,date,start_time,end_time,status,notes,created_by_role,created_at,updated_at)
      SELECT json_extract(sample.value,'$.id'), json_extract(sample.value,'$.field'),
        json_extract(sample.value,'$.team'), json_extract(sample.value,'$.title'),
        json_extract(sample.value,'$.reservationType'), json_extract(sample.value,'$.date'),
        json_extract(sample.value,'$.startTime'), json_extract(sample.value,'$.endTime'),
        'approved','Fictional sample event for November 1–7; not an actual booking.','sample_data',?,?
      FROM json_each(?) sample
      WHERE NOT EXISTS (SELECT 1 FROM baseball_sample_seed_versions WHERE id=?)
        AND NOT EXISTS (SELECT 1 FROM baseball_field_reservations existing
          WHERE existing.field=json_extract(sample.value,'$.field') AND existing.date=json_extract(sample.value,'$.date')
            AND existing.start_time<json_extract(sample.value,'$.endTime') AND existing.end_time>json_extract(sample.value,'$.startTime'))`)
      .bind(now,now,JSON.stringify(examples),VERSION),
    // The conflict belongs to a newly inserted example, never a real booking.
    env.DB.prepare(`INSERT OR IGNORE INTO baseball_field_requests
      (id,request_type,field,team,title,reservation_type,date,start_time,end_time,notes,status,has_conflict,conflict_details,requested_by,requested_at)
      SELECT 'bll_extra_request_20261101_conflict','add',field,CASE team WHEN 'Barrington 12U' THEN 'Barrington 14U' WHEN 'Barrington 14U' THEN 'Barrington 12U' WHEN 'Barrington 10U' THEN 'Barrington 8U' WHEN 'Barrington 8U' THEN 'Barrington 10U' ELSE 'Barrington 8U' END,
        '[SAMPLE] ' || CASE team WHEN 'Barrington 12U' THEN '14U' WHEN 'Barrington 14U' THEN '12U' WHEN 'Barrington 10U' THEN '8U' WHEN 'Barrington 8U' THEN '10U' ELSE '8U' END || ' Practice Request','practice',date,start_time,end_time,
        'Fictional sample request intentionally overlapping a November 1–7 sample reservation.',
        'pending',0,'[]','Sample requester',?
      FROM baseball_field_reservations
      WHERE id LIKE 'bll_extra_20261101_%' AND created_by_role='sample_data' AND field<>'bubble' AND date='2026-11-02'
        AND NOT EXISTS (SELECT 1 FROM baseball_sample_seed_versions WHERE id=?)
      ORDER BY field LIMIT 1`).bind(now,VERSION),
    // The ordinary pending example is on Tuesday, separate from Monday's conflict.
    env.DB.prepare(`INSERT OR IGNORE INTO baseball_field_requests
      (id,request_type,field,team,title,reservation_type,date,start_time,end_time,notes,status,has_conflict,conflict_details,requested_by,requested_at)
      SELECT 'bll_extra_request_20261101_pending','add','minor','Barrington 10U','[SAMPLE] 10U Practice Request','practice',
        '2026-11-03',json_extract(slot.value,'$.start'),json_extract(slot.value,'$.end'),
        'Fictional sample request awaiting admin approval; not a confirmed booking.','pending',0,'[]','Sample requester',?
      FROM json_each(?) slot
      WHERE NOT EXISTS (SELECT 1 FROM baseball_sample_seed_versions WHERE id=?)
        AND NOT EXISTS (SELECT 1 FROM baseball_field_reservations existing
          WHERE existing.field='minor' AND existing.date='2026-11-03'
            AND existing.start_time<json_extract(slot.value,'$.end') AND existing.end_time>json_extract(slot.value,'$.start'))
        AND NOT EXISTS (SELECT 1 FROM baseball_field_requests existing
          WHERE existing.field='minor' AND existing.date='2026-11-03' AND existing.status='pending' AND existing.request_type='add'
            AND existing.start_time<json_extract(slot.value,'$.end') AND existing.end_time>json_extract(slot.value,'$.start'))
      ORDER BY json_extract(slot.value,'$.start') LIMIT 1`).bind(now,JSON.stringify(candidates),VERSION),
    env.DB.prepare("INSERT OR IGNORE INTO baseball_sample_seed_versions (id, completed_at) VALUES (?, ?)").bind(VERSION,now),
  ]);
}
