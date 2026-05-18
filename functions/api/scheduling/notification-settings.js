import {
  getSchedulingNotificationSettings,
  json,
  setSchedulingNotificationSettings,
  verifySchedulingAuth,
} from "../../lib/scheduling.js";

export const onRequestGet = async ({ request, env }) => {
  try {
    const auth = await verifySchedulingAuth(request, env, ["board"]);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const settings = await getSchedulingNotificationSettings(env);
    return json({ ok: true, settings });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await verifySchedulingAuth(request, env, ["board"]);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const body = await request.json().catch(() => ({}));
    const settings = await setSchedulingNotificationSettings(env, {
      email: String(body?.email || "").trim(),
    });

    return json({
      ok: true,
      settings,
      message: settings.email
        ? "Board request notification email saved."
        : "Board request notification email cleared.",
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 400);
  }
};

export const onRequestOptions = async () =>
  new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "authorization,x-scheduling-key,x-scheduling-role,content-type",
    },
  });
