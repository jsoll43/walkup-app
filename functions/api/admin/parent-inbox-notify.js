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

export const onRequestPost = async ({ request, env }) => {
  try {
    const key = getAdminKey(request);
    if (!key || key !== env.ADMIN_KEY) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const body = await request.json().catch(() => ({}));
    const email = (body.email || "").trim();
    const newSubmissions = Number(body.newSubmissions || 0);
    const currentPending = Number(body.currentPending || 0);

    if (!email || !isValidEmail(email)) {
      return json({ ok: false, error: "Invalid email address." }, 400);
    }
    if (!newSubmissions || newSubmissions <= 0) {
      return json({ ok: false, error: "No new submissions to notify." }, 400);
    }

    const sendgridKey = env.SENDGRID_API_KEY;
    const sendgridFrom = env.SENDGRID_FROM || env.EMAIL_FROM;
    if (!sendgridKey || !sendgridFrom) {
      return json({ ok: false, error: "SendGrid is not configured (SENDGRID_API_KEY/SENDGRID_FROM)." }, 500);
    }

    const subject = `New Parent Inbox submissions: ${newSubmissions} new`; 
    const text = `There are ${currentPending} pending submission(s) in the Parent Inbox. ${newSubmissions} new since last check.`;
    const html = `<p>${text}</p><p>Visit your admin panel to review.</p>`;

    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sendgridKey}`,
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }], subject }],
        from: { email: sendgridFrom },
        content: [
          { type: "text/plain", value: text },
          { type: "text/html", value: html },
        ],
      }),
    });

    if (!res.ok) {
      const responseText = await res.text();
      return json({ ok: false, error: `Notify email failed: ${res.status} ${responseText}` }, 502);
    }

    return json({ ok: true, sentTo: email });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};
