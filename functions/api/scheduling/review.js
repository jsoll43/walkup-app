import {
  approvePendingRemovalRequestsForReservation,
  createReservation,
  deleteReservation,
  getFieldRequestById,
  getReservationById,
  json,
  recalculateSchedulingRequestConflicts,
  updateFieldRequestStatus,
  verifySchedulingAuth,
} from "../../lib/scheduling.js";

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await verifySchedulingAuth(request, env, ["board"]);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const body = await request.json().catch(() => ({}));
    const requestId = String(body.requestId || "").trim();
    const action = String(body.action || "").trim().toLowerCase();

    if (!requestId) return json({ ok: false, error: "Request id is required." }, 400);
    if (action !== "approve" && action !== "deny") {
      return json({ ok: false, error: "Choose approve or deny." }, 400);
    }

    const pendingRequest = await getFieldRequestById(env, requestId);
    if (!pendingRequest) return json({ ok: false, error: "That request no longer exists." }, 404);
    if (pendingRequest.status !== "pending") {
      return json({ ok: false, error: "That request has already been reviewed." }, 409);
    }

    const reviewedAt = new Date().toISOString();
    let createdReservation = null;

    if (action === "approve") {
      if (pendingRequest.requestType === "add") {
        createdReservation = await createReservation(env, {
          field: pendingRequest.field,
          team: pendingRequest.team,
          title: pendingRequest.title,
          reservationType: pendingRequest.reservationType,
          date: pendingRequest.date,
          startTime: pendingRequest.startTime,
          endTime: pendingRequest.endTime,
          notes: pendingRequest.notes,
          status: pendingRequest.reservationType === "maintenance" ? "maintenance" : "approved",
          createdByRole: "coach_request_approved",
        });
        await updateFieldRequestStatus(env, requestId, "approved", auth.requestedBy, reviewedAt);
      } else {
        const reservation = pendingRequest.reservationId
          ? await getReservationById(env, pendingRequest.reservationId)
          : null;

        if (reservation) {
          await deleteReservation(env, reservation.id);
        }

        await approvePendingRemovalRequestsForReservation(env, pendingRequest.reservationId, auth.requestedBy);
        await updateFieldRequestStatus(env, requestId, "approved", auth.requestedBy, reviewedAt);
      }
    } else {
      await updateFieldRequestStatus(env, requestId, "denied", auth.requestedBy, reviewedAt);
    }

    await recalculateSchedulingRequestConflicts(env);
    const updatedRequest = await getFieldRequestById(env, requestId);

    return json({
      ok: true,
      request: updatedRequest,
      reservation: createdReservation,
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
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "authorization,x-scheduling-key,x-scheduling-role,content-type",
    },
  });
