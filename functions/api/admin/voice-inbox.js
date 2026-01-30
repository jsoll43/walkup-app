export async function onRequestGet({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  if (auth !== `Bearer ${env.ADMIN_KEY}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const listed = await env.WALKUP_VOICE.list({ limit: 1000 });

  return Response.json({
    ok: true,
    objects: listed.objects
      .sort((a, b) => (a.uploaded < b.uploaded ? 1 : -1))
      .map((o) => ({
        key: o.key,
        size: o.size,
        uploaded: o.uploaded,
      })),
  });
}
