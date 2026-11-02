import { json, loadSchedulingState, roleLabel, requesterKeyHash, ownedRequestIds, verifySchedulingAuth } from "../../../lib/baseballScheduling.js";

export const onRequestGet = async ({ request, env }) => {
  try {
    const auth = await verifySchedulingAuth(request, env, ["requester", "admin"]);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const state = await loadSchedulingState(env);
    const owned = await ownedRequestIds(env, await requesterKeyHash(request));
    state.requests = state.requests.map(item => ({...item, canCancel: owned.has(item.id)}));
    state.pendingRequests = state.pendingRequests.map(item => ({...item, canCancel: owned.has(item.id)}));
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
