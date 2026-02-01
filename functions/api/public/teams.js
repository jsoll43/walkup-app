// functions/api/public/teams.js
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const onRequestGet = async ({ env }) => {
  try {
    const res = await env.DB.prepare(
      `SELECT name, slug
       FROM teams
       WHERE status = 'active'
       ORDER BY created_at DESC`
    ).all();

    return json({ ok: true, teams: res.results || [] });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};
