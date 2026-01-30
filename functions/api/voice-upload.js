export async function onRequestPost({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  if (auth !== `Bearer ${env.PARENT_UPLOAD_KEY}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const form = await request.formData();
  const playerId = form.get("playerId");
  const file = form.get("file");

  if (!playerId || !file) {
    return new Response("Missing playerId or file", { status: 400 });
  }

  const safeName = (file.name || "voice").replace(/[^\w.\-]+/g, "_");
  const key = `${playerId}/${Date.now()}_${safeName}`;

  await env.WALKUP_VOICE.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });

  return Response.json({ ok: true, key });
}
