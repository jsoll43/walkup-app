import {
  approvePendingRemovalRequestsForReservation,
  createReservation,
  deleteReservation,
  getReservationById,
  json,
  normalizeScheduleDraft,
  recalculateSchedulingRequestConflicts,
  verifySchedulingAuth,
} from "../../lib/scheduling.js";

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await verifySchedulingAuth(request, env, ["board"]);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const body = await request.json().catch(() => ({}));
    const draft = normalizeScheduleDraft(body, { teamRequired: false, fallbackTeam: "League" });
    if (draft.error) return json({ ok: false, error: draft.error }, 400);

    const reservation = await createReservation(env, {
      ...draft.value,
      status: "approved",
      createdByRole: auth.role,
    });

    await recalculateSchedulingRequestConflicts(env);
    return json({ ok: true, reservation });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};

export const onRequestDelete = async ({ request, env }) => {
  try {
    const auth = await verifySchedulingAuth(request, env, ["board"]);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const body = await request.json().catch(() => ({}));
    const reservationId = String(body.id || body.reservationId || "").trim();
    if (!reservationId) return json({ ok: false, error: "Reservation id is required." }, 400);

    const reservation = await getReservationById(env, reservationId);
    if (!reservation) return json({ ok: false, error: "That reservation no longer exists." }, 404);

    await deleteReservation(env, reservationId);
    await approvePendingRemovalRequestsForReservation(env, reservationId, auth.requestedBy);
    await recalculateSchedulingRequestConflicts(env);

    return json({ ok: true, removedId: reservationId });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};

export const onRequestOptions = async () =>
  new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,DELETE,OPTIONS",
      "access-control-allow-headers": "authorization,x-scheduling-key,x-scheduling-role,content-type",
    },
  });
