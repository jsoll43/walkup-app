// functions/api/admin/parent-inbox-notify.js
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

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function encodeForm(fields) {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v || ""))}`)
    .join("&");
}

export const onRequestPost = async ({ request, env }) => {
  // DEBUG mode: confirm the function executes and routing is correct
  return json({ ok: true, debug: "parent-inbox-notify reached" }, 200);

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

    const email = (body.email || "").trim();
    const newSubmissions = Number(body.newSubmissions || 0);
    const currentPending = Number(body.currentPending || 0);

    if (!email || !isValidEmail(email)) {
      return json({
        ok: false,
        error: `Invalid email address or email is missing (received email=${JSON.stringify(email)})`,
        body,
        textBody,
      },
      400);
    }
    if (!newSubmissions || newSubmissions <= 0) {
      return json({ ok: false, error: "No new submissions to notify." }, 400);
    }

    const mgKey = env.MAILGUN_API_KEY;
    const mgDomain = env.MAILGUN_DOMAIN;
    const mgFrom = env.MAILGUN_FROM;
    if (!mgKey || !mgDomain || !mgFrom) {
      return json({
        ok: false,
        error: "Mailgun is not configured (MAILGUN_API_KEY/MAILGUN_DOMAIN/MAILGUN_FROM).",
      }, 500);
    }

    const subject = `New Parent Inbox submissions: ${newSubmissions} new`;
    const text = `There are ${currentPending} pending submission(s) in the Parent Inbox. ${newSubmissions} new since last check.`;
    const html = `<p>${text}</p><p>Visit your admin panel to review.</p>`;

    const mgRes = await fetch(`https://api.mailgun.net/v3/${encodeURIComponent(mgDomain)}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${btoa(`api:${mgKey}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: encodeForm({
        from: mgFrom,
        to: email,
        subject,
        text,
        html,
      }),
    });

    if (!mgRes.ok) {
      const msg = await mgRes.text();
      return json({
        ok: false,
        error: `Mailgun failed: ${mgRes.status} ${mgRes.statusText} ${msg}`,
      }, 502);
    }

    return json({ ok: true, sentTo: email });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};
