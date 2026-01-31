// functions/api/voice-upload.js
export async function onRequestPost({ request, env }) {
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj, null, 2), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });

  try {
    if (!env?.WALKUP_VOICE) {
      return json({ ok: false, error: "Missing R2 binding env.WALKUP_VOICE" }, 500);
    }
    if (!env?.DB) {
      return json({ ok: false, error: "Missing D1 binding env.DB" }, 500);
    }

    const expectedKey = (env.PARENT_UPLOAD_KEY || "").trim();
    if (!expectedKey) {
      return json({ ok: false, error: "Missing env.PARENT_UPLOAD_KEY" }, 500);
    }

    // Accept key in several common places to avoid client/server mismatch
    const url = new URL(request.url);
    const headerKey =
      request.headers.get("x-parent-upload-key") ||
      request.headers.get("x-parent-key") ||
      request.headers.get("x-api-key") ||
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
      "";

    const queryKey = url.searchParams.get("key") || "";
    const providedKey = (headerKey || queryKey || "").trim();

    if (!providedKey || providedKey !== expectedKey) {
      return json(
        {
          ok: false,
          error: "Unauthorized",
          howTo:
            "Provide parent key via Authorization: Bearer <key> OR x-parent-upload-key header.",
        },
        401
      );
    }

    const ct = request.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("multipart/form-data")) {
      return json({ ok: false, error: "Expected multipart/form-data" }, 400);
    }

    const form = await request.formData();
    const playerName = (form.get("playerName") || "").toString().trim();
    const songRequest = (form.get("songRequest") || "").toString().trim();

    const file = form.get("file");
    if (!playerName) return json({ ok: false, error: "playerName is required" }, 400);
    if (!file || typeof file.arrayBuffer !== "function") {
      return json({ ok: false, error: "file is required" }, 400);
    }

    // Basic size guard (optional but helpful)
    const sizeBytes = Number(file.size || 0);
    const maxBytes = 25 * 1024 * 1024; // 25MB
    if (sizeBytes > maxBytes) {
      return json({ ok: false, error: "File too large (max 25MB)" }, 413);
    }

    const id = crypto.randomUUID();
    const contentType = (file.type || "audio/webm").toString();
    const r2Key = `parent-inbox/${id}.webm`;
    const createdAt = new Date().toISOString();

    // Upload to R2
    const buf = await file.arrayBuffer();
    await env.WALKUP_VOICE.put(r2Key, buf, {
      httpMetadata: { contentType },
    });

    // Write metadata to D1 (no exec())
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
      // Avoid orphaned R2 objects if D1 insert fails
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
    return json(
      {
        ok: false,
        error: String(e?.message || e),
        stack: e?.stack || null,
      },
      500
    );
  }
}
