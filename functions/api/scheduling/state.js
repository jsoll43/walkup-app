import { json, loadSchedulingState, roleLabel, verifySchedulingAuth } from "../../lib/scheduling.js";

export const onRequestGet = async ({ request, env }) => {
  try {
    const auth = await verifySchedulingAuth(request, env, ["coach", "board"]);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const state = await loadSchedulingState(env);
    return json({
      ok: true,
      role: auth.role,
      roleLabel: roleLabel(auth.role),
      ...state,
    });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};

export const onRequestOptions = async () =>
  new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "authorization,x-scheduling-key,x-scheduling-role,content-type",
    },
  });
