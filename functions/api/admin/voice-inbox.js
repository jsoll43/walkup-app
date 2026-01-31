export async function onRequestGet(context) {
  try {
    const request = context.request;
    const env = context.env;

    const auth = request.headers.get("Authorization") || "";
    if (auth !== "Bearer " + env.ADMIN_KEY) {
      return new Response("Unauthorized", { status: 401 });
    }

    const listed = await env.WALKUP_VOICE.list({ limit: 1000 });

    // Only show parent uploads (exclude finals)
    const objects = (listed.objects || [])
      .filter((o) => o && o.key && !o.key.startsWith("final/"))
      .map((o) => ({
        key: o.key,
        size: o.size,
        uploaded: o.uploaded ? o.uploaded.toISOString() : null,
      }))
      .sort((a, b) => (a.uploaded < b.uploaded ? 1 : -1));

    return new Response(JSON.stringify({ ok: true, objects }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e && (e.stack || e.message) ? (e.stack || e.message) : String(e);
    return new Response("voice-inbox exception: " + msg, { status: 500 });
  }
}
