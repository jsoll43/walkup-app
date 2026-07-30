import { ensureSeasonSchema } from "../../lib/seasons.js";

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const onRequestPost = async ({ request, env }) => {
  const bearer = (request.headers.get("authorization") || "").trim();
  const key = bearer.toLowerCase().startsWith("bearer ")
    ? bearer.slice(7).trim()
    : (request.headers.get("x-admin-key") || "").trim();
  if (key !== env.ADMIN_KEY) return json({ ok: false, error: "Unauthorized" }, 401);
  try {
    await ensureSeasonSchema(env);
    return json({ ok: true, message: "Season archive migration complete." });
  } catch (error) {
    return json({ ok: false, error: error?.message || String(error) }, 500);
  }
};
