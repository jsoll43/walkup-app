import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { onRequestDelete } from "../functions/api/scheduling/request.js";
import {
  createFieldRequest,
  getFieldRequestById,
  loadSchedulingState,
  setSchedulingPassword,
  updateFieldRequestStatus,
} from "../functions/lib/scheduling.js";

function createD1() {
  const database = new DatabaseSync(":memory:");
  return {
    DB: {
      prepare(sql) {
        let values = [];
        return {
          bind(...nextValues) {
            values = nextValues;
            return this;
          },
          all() {
            return { results: database.prepare(sql).all(...values) };
          },
          first() {
            return database.prepare(sql).get(...values) || null;
          },
          run() {
            return database.prepare(sql).run(...values);
          },
        };
      },
    },
  };
}

function cancelRequest(requestId, password = "coach-password") {
  return new Request("https://example.test/api/scheduling/request", {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      "x-scheduling-role": "coach",
      "x-scheduling-key": password,
    },
    body: JSON.stringify({ requestId }),
  });
}

async function createPendingRequest(env, id = "sched_req_cancel_test") {
  return createFieldRequest(env, {
    id,
    requestType: "add",
    field: "major",
    team: "12U Blue",
    title: "Practice",
    reservationType: "practice",
    date: "2026-08-25",
    startTime: "17:00",
    endTime: "18:30",
    status: "pending",
    requestedBy: "Coach shared login",
  });
}

test("a coach can cancel a pending field request without deleting its audit history", async () => {
  const env = createD1();
  await setSchedulingPassword(env, "coach", "coach-password");
  const requestId = await createPendingRequest(env);

  const response = await onRequestDelete({ request: cancelRequest(requestId), env });
  const body = await response.json();
  const state = await loadSchedulingState(env);

  assert.equal(response.status, 200);
  assert.equal(body.request.status, "canceled");
  assert.equal(body.request.reviewedBy, "Coach shared login");
  assert.equal(state.pendingRequests.length, 0);
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].status, "canceled");
});

test("a coach cannot cancel a request after Board review", async () => {
  const env = createD1();
  await setSchedulingPassword(env, "coach", "coach-password");
  const requestId = await createPendingRequest(env);
  await updateFieldRequestStatus(env, requestId, "approved", "Board member shared login", new Date().toISOString());

  const response = await onRequestDelete({ request: cancelRequest(requestId), env });
  const body = await response.json();
  const storedRequest = await getFieldRequestById(env, requestId);

  assert.equal(response.status, 409);
  assert.match(body.error, /only pending requests/i);
  assert.equal(storedRequest.status, "approved");
});

test("the cancellation endpoint rejects non-coach roles", async () => {
  const env = createD1();
  const request = new Request("https://example.test/api/scheduling/request", {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      "x-scheduling-role": "board",
      "x-scheduling-key": "board-password",
    },
    body: JSON.stringify({ requestId: "sched_req_cancel_test" }),
  });

  const response = await onRequestDelete({ request, env });

  assert.equal(response.status, 403);
});
