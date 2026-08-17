import assert from "node:assert/strict";
import test from "node:test";

import { onRequest } from "../functions/api/board/finance/[[path]].js";

test("finance API rejects unauthenticated reads", async () => {
  const response = await onRequest({
    request: new Request("https://bgslwalkup.com/api/board/finance/bootstrap"),
    env: { DB: {} },
    params: { path: ["bootstrap"] },
  });

  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /sign-in required/i);
});

test("finance API rejects viewer mutations", async () => {
  const response = await onRequest({
    request: new Request("http://127.0.0.1/api/board/finance/transactions/example", {
      method: "PUT",
      headers: { origin: "http://127.0.0.1", "content-type": "application/json" },
      body: "{}",
    }),
    env: {
      DB: {},
      FINANCE_LOCAL_AUTH_BYPASS: "true",
      FINANCE_LOCAL_AUTH_ROLE: "viewer",
    },
    params: { path: ["transactions", "example"] },
  });

  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /editor access is required/i);
});
