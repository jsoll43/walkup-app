// functions/api/voice-upload.js
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getParentKey(request) {
  const url = new URL(request.url);
  const headerKey =
    request.headers.get("x-parent-upload-key") ||
    request.headers.get("x-parent-key") ||
    request.headers.get("x-api-key") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  const queryKey = url.searchParams.get("key") || "";
  return (headerKey || queryKey || "").trim();
}

function extFromFile(file) {
  const name = (file?.name || "").toLowerCase();
  const m = name.match(/\.([a-z0-9]{1,6})$/);
  if (m) return m[1];

  const t = (file?.type || "").toLowerCase();
  if (t.includes("wav")) return "wav";
  if (t.includes("mpeg") || t.includes("mp3")) return "mp3";
  if (t.includes("m4a") || t.includes("mp4")) return "m4a";
  if (t.includes("ogg")) return "ogg";
  if (t.includes("webm")) return "webm";
  return "bin";
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.WALKUP_VOICE) return json({ ok: false, error: "Missing R2 binding env.WALKUP_VOICE" }, 500);
    if (!env?.DB) return json({ ok: false, error: "Missing D1 binding env.DB" }, 500);

    const expectedKey = (env.PARENT_UPLOAD_KEY || "").trim();
    if (!expectedKey) return json({ ok: false, error: "Missing env.PARENT_UPLOAD_KEY" }, 500);

    const providedKey = getParentKey(request);
    if (!providedKey || providedKey !== expectedKey) return json({ ok: false, error: "Unauthorized" }, 401);

    const ct = (request.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("multipart/form-data")) return json({ ok: false, error: "Expected multipart/form-data" }, 400);

    const form = await request.formData();
    const playerName = (form.get("playerName") || "").toString().trim();
    const songRequest = (form.get("songRequest") || "").toString().trim();

    const file = form.get("file");
    if (!playerName) return json({ ok: false, error: "playerName is required" }, 400);
    if (!file || typeof file.arrayBuffer !== "function") return json({ ok: false, error: "file is required" }, 400);

    const sizeBytes = Number(file.size || 0);
    const maxBytes = 50 * 1024 * 1024;
    if (sizeBytes > maxBytes) return json({ ok: false, error: "File too large (max 50MB)" }, 413);

    const id = crypto.randomUUID();
    const contentType = (file.type || "application/octet-stream").toString();
    const ext = extFromFile(file);
    const r2Key = `parent-inbox/${id}.${ext}`;
    const createdAt = new Date().toISOString();

    const buf = await file.arrayBuffer();
    await env.WALKUP_VOICE.put(r2Key, buf, {
      httpMetadata: { contentType },
    });

    // D1 insert (prepare().run() only)
    try {
      await env.DB.prepare(
        `
        INSERT INTO parent_submissions
          (id, player_name, song_request, r2_key, content_type, size_bytes, status, created_at, deleted_at)
        VALUES
          (?,  ?,          ?,           ?,      ?,           ?,          'pending', ?,        NULL);
        `.trim()
      )
        .bind(id, playerName, songRequest, r2Key, contentType, sizeBytes, createdAt)
        .run();
    } catch (dbErr) {
      try {
        await env.WALKUP_VOICE.delete(r2Key);
      } catch {}
      throw dbErr;
    }

    return json({
      ok: true,
      id,
      playerName,
      songRequest,
      r2Key,
      contentType,
      sizeBytes,
      createdAt,
    });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e), stack: e?.stack || null }, 500);
  }
}
