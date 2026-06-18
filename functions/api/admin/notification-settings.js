import {
  getParentInboxNotificationSettings,
  isValidEmail,
  setParentInboxNotificationSettings,
} from "../../lib/parentInboxNotifications.js";

function getAdminKey(req) {
  const h = req.headers;
  const bearer = (h.get("authorization") || "").trim();
  if (bearer.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  return (h.get("x-admin-key") || "").trim();
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isAuthorized(request, env) {
  const key = getAdminKey(request);
  return !!key && key === env.ADMIN_KEY;
}

export const onRequestGet = async ({ request, env }) => {
  try {
    if (!isAuthorized(request, env)) return json({ ok: false, error: "Unauthorized" }, 401);

    const settings = await getParentInboxNotificationSettings(env);
    return json({ ok: true, settings });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, Number(e?.statusCode || 500));
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    if (!isAuthorized(request, env)) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await request.json().catch(() => ({}));
    const enabled = !!body?.enabled;
    const email = String(body?.email || "").trim();

    if (enabled && !isValidEmail(email)) {
      return json({ ok: false, error: "Enter a valid email to enable notifications." }, 400);
    }

    const settings = await setParentInboxNotificationSettings(env, { enabled, email });
    return json({ ok: true, settings });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, Number(e?.statusCode || 500));
  }
};
