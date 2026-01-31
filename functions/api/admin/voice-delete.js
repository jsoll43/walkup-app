export async function onRequestPost(context) {
  try {
    const request = context.request;
    const env = context.env;

    const auth = request.headers.get("Authorization") || "";
    if (auth !== "Bearer " + env.ADMIN_KEY) {
      return new Response("Unauthorized", { status: 401 });
    }

    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    if (!key) return new Response("Missing key", { status: 400 });

    // Safety: don't allow deleting final clips from this endpoint
    if (key.startsWith("final/")) {
      return new Response("Refusing to delete final clips from voice-delete endpoint", { status: 400 });
    }

    await env.WALKUP_VOICE.delete(key);
    return new Response(JSON.stringify({ ok: true, deleted: key }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e && (e.stack || e.message) ? (e.stack || e.message) : String(e);
    return new Response("voice-delete exception: " + msg, { status: 500 });
  }
}
