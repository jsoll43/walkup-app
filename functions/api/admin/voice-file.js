export async function onRequestGet({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  if (auth !== `Bearer ${env.ADMIN_KEY}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!key) return new Response("Missing key", { status: 400 });

  const obj = await env.WALKUP_VOICE.get(key);
  if (!obj) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Cache-Control", "no-store");

  // Force download-friendly filename
  const filename = key.split("/").pop() || "voice";
  headers.set("Content-Disposition", `inline; filename="${filename}"`);

  return new Response(obj.body, { headers });
}
