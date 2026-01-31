// functions/api/admin/final-upload.js
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getAdminKey(request) {
  const url = new URL(request.url);
  const headerKey =
    request.headers.get("x-admin-key") ||
    request.headers.get("x-api-key") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  const queryKey = url.searchParams.get("key") || "";
  return (headerKey || queryKey || "").trim();
}

function extFromFile(file) {
  const name = (file?.name || "").toLowerCase();
  const m = name.match(/\.([a-z0-9]{1,5})$/);
  if (m) return m[1];

  // fallback based on mime type
  const t = (file?.type || "").toLowerCase();
  if (t.includes("mpeg") || t.includes("mp3")) return "mp3";
  if (t.includes("mp4") || t.includes("m4a")) return "m4a";
  if (t.includes("wav")) return "wav";
  if (t.includes("aac")) return "aac";
  if (t.includes("ogg")) return "ogg";
  if (t.includes("webm")) return "webm";
  return "audio";
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.WALKUP_VOICE) return json({ ok: false, error: "Missing R2 binding env.WALKUP_VOICE" }, 500);
    if (!env?.ADMIN_KEY) return json({ ok: false, error: "Missing env.ADMIN_KEY" }, 500);

    const provided = getAdminKey(request);
    if (!provided || provided !== env.ADMIN_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

    const url = new URL(request.url);

    // playerId can be in query OR in form data
    let playerId = (url.searchParams.get("playerId") || "").trim();

    const ct = (request.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("multipart/form-data")) {
      return json(
        { ok: false, error: "Expected multipart/form-data upload", got: request.headers.get("content-type") || "" },
        400
      );
    }

    const form = await request.formData();

    if (!playerId) {
      playerId = (form.get("playerId") || form.get("id") || "").toString().trim();
    }
    if (!playerId) {
      return json(
        {
          ok: false,
          error: "playerId is required",
          hint: "Send as query ?playerId=... or include form field playerId",
        },
        400
      );
    }

    // File field can be named file OR audio OR finalFile
    const file =
      form.get("file") ||
      form.get("audio") ||
      form.get("finalFile");

    if (!file || typeof file.arrayBuffer !== "function") {
      return json(
        {
          ok: false,
          error: "Missing audio file",
          hint: "Send as form field named 'file' (preferred) or 'audio' or 'finalFile'",
          receivedFields: Array.from(form.keys()),
        },
        400
      );
    }

    const sizeBytes = Number(file.size || 0);
    const maxBytes = 50 * 1024 * 1024; // 50MB
    if (sizeBytes > maxBytes) {
      return json({ ok: false, error: "File too large (max 50MB)", sizeBytes, maxBytes }, 413);
    }

    const contentType = (file.type || "audio/mpeg").toString();
    const buf = await file.arrayBuffer();

    // Store in a predictable key that your coach endpoints typically use
    const baseKey = `final/${playerId}`;
    // Also store an extension variant for convenience / compatibility
    const ext = extFromFile(file);
    const extKey = ext && ext !== "audio" ? `final/${playerId}.${ext}` : "";

    await env.WALKUP_VOICE.put(baseKey, buf, { httpMetadata: { contentType } });
    if (extKey && extKey !== baseKey) {
      await env.WALKUP_VOICE.put(extKey, buf, { httpMetadata: { contentType } });
    }

    // Optional cleanup: keep only baseKey + extKey for this player
    try {
      const keep = new Set([baseKey, extKey].filter(Boolean));
      const listed = await env.WALKUP_VOICE.list({ prefix: `final/${playerId}` });
      for (const obj of listed.objects || []) {
        if (!keep.has(obj.key)) await env.WALKUP_VOICE.delete(obj.key);
      }
    } catch {
      // ignore cleanup failures
    }

    return json({
      ok: true,
      playerId,
      key: baseKey,
      altKey: extKey || null,
      contentType,
      sizeBytes,
      uploadedAt: new Date().toISOString(),
    });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e), stack: e?.stack || null }, 500);
  }
}
