import {
  cancelPendingFieldRequest,
  createFieldRequest,
  getFieldRequestById,
  getPendingRemovalRequestForReservation,
  getReservationById,
  json,
  normalizeRequestType,
  normalizeScheduleDraft,
  recalculateSchedulingRequestConflicts,
  sendSchedulingRequestNotification,
  verifySchedulingAuth,
} from "../../lib/scheduling.js";

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await verifySchedulingAuth(request, env, ["coach"]);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const body = await request.json().catch(() => ({}));
    const requestType = normalizeRequestType(body.requestType);
    if (!requestType) return json({ ok: false, error: "Choose a valid request type." }, 400);

    let requestId = "";

    if (requestType === "add") {
      const draft = normalizeScheduleDraft(body, { teamRequired: true });
      if (draft.error) return json({ ok: false, error: draft.error }, 400);

      requestId = await createFieldRequest(env, {
        requestType: "add",
        ...draft.value,
        status: "pending",
        requestedBy: auth.requestedBy,
      });
    } else {
      const reservationId = String(body.reservationId || "").trim();
      if (!reservationId) return json({ ok: false, error: "Reservation is required for a removal request." }, 400);

      const reservation = await getReservationById(env, reservationId);
      if (!reservation) return json({ ok: false, error: "That reservation no longer exists." }, 404);

      const existingPendingRemoval = await getPendingRemovalRequestForReservation(env, reservationId);
      if (existingPendingRemoval) {
        return json({ ok: false, error: "A removal request is already pending for that reservation." }, 409);
      }

      requestId = await createFieldRequest(env, {
        requestType: "remove",
        reservationId,
        field: reservation.field,
        team: reservation.team,
        title: reservation.title,
        date: reservation.date,
        startTime: reservation.startTime,
        endTime: reservation.endTime,
        reservationType: "other",
        notes: "",
        status: "pending",
        requestedBy: auth.requestedBy,
      });
    }

    await recalculateSchedulingRequestConflicts(env);
    const createdRequest = await getFieldRequestById(env, requestId);
    const notification = createdRequest
      ? await sendSchedulingRequestNotification(env, createdRequest).catch((error) => ({
          ok: false,
          skipped: false,
          error: error?.message || String(error),
        }))
      : null;

    return json({ ok: true, request: createdRequest, notification });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
};

export const onRequestDelete = async ({ request, env }) => {
  try {
    const auth = await verifySchedulingAuth(request, env, ["coach"]);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const body = await request.json().catch(() => ({}));
    const requestId = String(body.requestId || body.id || "").trim();
    if (!requestId) return json({ ok: false, error: "Request id is required." }, 400);

    const pendingRequest = await getFieldRequestById(env, requestId);
    if (!pendingRequest) return json({ ok: false, error: "That request no longer exists." }, 404);
    if (pendingRequest.status !== "pending") {
      return json({ ok: false, error: "Only pending requests can be canceled." }, 409);
    }
    if (pendingRequest.requestedBy !== auth.requestedBy) {
      return json({ ok: false, error: "You cannot cancel another coach's request." }, 403);
    }

    const canceledAt = new Date().toISOString();
    await cancelPendingFieldRequest(env, requestId, auth.requestedBy, canceledAt);
    await recalculateSchedulingRequestConflicts(env);

    const canceledRequest = await getFieldRequestById(env, requestId);
    if (canceledRequest?.status !== "canceled") {
      return json({ ok: false, error: "That request has already been reviewed." }, 409);
    }

    return json({
      ok: true,
      request: canceledRequest,
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
      "access-control-allow-methods": "POST,DELETE,OPTIONS",
      "access-control-allow-headers": "authorization,x-scheduling-key,x-scheduling-role,content-type",
    },
  });
