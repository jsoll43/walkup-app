import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  createReservation,
  deleteReservation,
  ensureSchedulingTables,
  loadSchedulingState,
  recordBoardReservationDeletion,
} from "../functions/lib/scheduling.js";

function createD1() {
  const database = new DatabaseSync(":memory:");

  return {
    database,
    env: {
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
    },
  };
}

function reservation(overrides = {}) {
  return {
    id: "sched_res_board_test",
    field: "major",
    team: "12U Blue",
    title: "Board practice",
    reservationType: "practice",
    date: "2026-08-24",
    startTime: "17:00",
    endTime: "18:30",
    status: "approved",
    createdByRole: "board",
    ...overrides,
  };
}

test("direct Board reservations are added to the scheduling audit trail", async () => {
  const { env } = createD1();

  await createReservation(env, reservation());
  const state = await loadSchedulingState(env);

  assert.equal(state.requests.length, 1);
  assert.deepEqual(
    {
      requestType: state.requests[0].requestType,
      requestedBy: state.requests[0].requestedBy,
      reviewedBy: state.requests[0].reviewedBy,
      reservationId: state.requests[0].reservationId,
      team: state.requests[0].team,
      status: state.requests[0].status,
    },
    {
      requestType: "add",
      requestedBy: "Board member shared login",
      reviewedBy: "Auto-approved",
      reservationId: "sched_res_board_test",
      team: "12U Blue",
      status: "approved",
    }
  );
});

test("active Board reservations created before audit recording are backfilled once", async () => {
  const { database, env } = createD1();
  await ensureSchedulingTables(env);

  database.prepare(
    `INSERT INTO field_reservations
      (id, field, team, title, reservation_type, date, start_time, end_time, status, notes, created_by_role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "sched_res_existing_board",
    "minor",
    "10U Gold",
    "Existing reservation",
    "practice",
    "2026-08-25",
    "18:30",
    "20:00",
    "approved",
    "",
    "board",
    "2026-08-20T12:00:00.000Z",
    "2026-08-20T12:00:00.000Z"
  );

  const firstState = await loadSchedulingState(env);
  const secondState = await loadSchedulingState(env);

  assert.equal(firstState.requests.length, 1);
  assert.equal(secondState.requests.length, 1);
  assert.equal(secondState.requests[0].reservationId, "sched_res_existing_board");
  assert.equal(secondState.requests[0].requestedAt, "2026-08-20T12:00:00.000Z");
});

test("non-Board reservations are not duplicated as direct Board audit activity", async () => {
  const { env } = createD1();

  await createReservation(
    env,
    reservation({
      id: "sched_res_coach_approved",
      createdByRole: "coach_request_approved",
    })
  );
  const state = await loadSchedulingState(env);

  assert.deepEqual(state.requests, []);
});

test("deleting a Board reservation keeps its snapshot in the audit trail", async () => {
  const { env } = createD1();
  const created = await createReservation(env, reservation());

  await deleteReservation(env, created.id);
  await recordBoardReservationDeletion(env, created, "Board member shared login");
  const state = await loadSchedulingState(env);
  const deletion = state.requests.find((request) => request.requestType === "delete");

  assert.equal(state.reservations.length, 0);
  assert.equal(state.requests.length, 2);
  assert.deepEqual(
    {
      reservationId: deletion.reservationId,
      field: deletion.field,
      team: deletion.team,
      date: deletion.date,
      startTime: deletion.startTime,
      reviewedBy: deletion.reviewedBy,
      requestedBy: deletion.requestedBy,
    },
    {
      reservationId: "sched_res_board_test",
      field: "major",
      team: "12U Blue",
      date: "2026-08-24",
      startTime: "17:00",
      reviewedBy: "Deleted",
      requestedBy: "Board member shared login",
    }
  );
});
