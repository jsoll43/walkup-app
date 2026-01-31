function mustBeAuthedParent(request, env) {
  const auth = request.headers.get("Authorization") || "";
  return auth === "Bearer " + env.PARENT_UPLOAD_KEY;
}

function safeText(s, max = 200) {
  const t = (s || "").toString().trim();
  return t.length > max ? t.slice(0, max) : t;
}

export async function onRequestPost({ request, env }) {
  try {
    if (!mustBeAuthedParent(request, env)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const form = await request.formData();
    const playerName = safeText(form.get("playerName"), 80);
    const songRequest = safeText(form.get("songRequest"), 140);
    const file = form.get("file");

    if (!playerName) return new Response("Missing playerName", { status: 400 });
    if (!file) return new Response("Missing file", { status: 400 });

    const id = crypto.randomUUID();
    const ext = "webm";
    const r2Key = `parent-inbox/${id}.${ext}`;

    // Put in R2
    const arrayBuf = await file.arrayBuffer();
    const contentType = file.type || "audio/webm";
    await env.WALKUP_VOICE.put(r2Key, arrayBuf, {
      httpMetadata: { contentType }
    });

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    await env.DB.prepare(
      `INSERT INTO parent_submissions
       (id, player_name, song_request, r2_key, content_type, size_bytes, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
    )
      .bind(id, playerName, songRequest, r2Key, contentType, arrayBuf.byteLength, now)
      .run();

    return Response.json({ ok: true, id });
  } catch (e) {
    const msg = e?.stack || e?.message || String(e);
    return new Response("voice-upload exception: " + msg, { status: 500 });
  }
}
