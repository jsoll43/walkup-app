import { getAdminKey, json, getSchedulingSettingsSummary, setSchedulingPassword } from "../../lib/scheduling.js";

export const onRequestGet = async ({ request, env }) => {
  try {
    const key = getAdminKey(request);
    if (!key || key !== env.ADMIN_KEY) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const settings = await getSchedulingSettingsSummary(env);
    return json({ ok: true, settings });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    const key = getAdminKey(request);
    if (!key || key !== env.ADMIN_KEY) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const body = await request.json().catch(() => ({}));
    const role = String(body.role || "").trim().toLowerCase();
    const password = String(body.password || "");

    const settings = await setSchedulingPassword(env, role, password);
    return json({
      ok: true,
      settings,
      message: `${role === "coach" ? "Coach" : "Board member"} scheduling password updated.`,
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
      "access-control-allow-headers": "authorization,x-admin-key,content-type",
    },
  });
