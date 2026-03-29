// functions/api/admin/parent-inbox-notify.js
import {
  getMailgunEnvStatus,
  sendParentInboxEmail,
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

export const onRequestPost = async ({ request, env }) => {
  // Shortcut to confirm env values in deployment without hitting Mailgun.
  if (env.SKIP_MAILGUN === "1") {
    const bodyText = await request.text().catch(() => "");
    let body = {};
    try {
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      // ignored
    }

    return json(
      {
        ok: true,
        debug: "SKIP_MAILGUN",
        env: getMailgunEnvStatus(env),
        requestBody: body,
      },
      200
    );
  }

  try {
    const key = getAdminKey(request);
    if (!key || key !== env.ADMIN_KEY) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const textBody = await request.text().catch(() => "");
    let body;
    try {
      body = textBody ? JSON.parse(textBody) : {};
    } catch {
      return json({ ok: false, error: `Invalid JSON body: ${textBody}`, textBody }, 400);
    }

    await sendParentInboxEmail(env, {
      email: body.email,
      newSubmissions: body.newSubmissions,
      currentPending: body.currentPending,
    });

    return json({ ok: true, sentTo: String(body.email || "").trim() });
  } catch (e) {
    return json(
      { ok: false, error: e?.message || String(e) },
      Number(e?.statusCode || 500)
    );
  }
};
