import { json, saveBubbleScheduling, verifySchedulingAuth } from "../../lib/scheduling.js";

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await verifySchedulingAuth(request, env, ["board"]);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const body = await request.json().catch(() => ({}));
    const bubbleScheduling = await saveBubbleScheduling(env, body);

    return json({ ok: true, bubbleScheduling });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};

export const onRequestOptions = async () =>
  new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "authorization,x-scheduling-key,x-scheduling-role,content-type",
    },
  });
