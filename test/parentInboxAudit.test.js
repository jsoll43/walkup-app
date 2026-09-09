import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { onRequestGet } from "../functions/api/admin/parent-inbox.js";
import { onRequestPost } from "../functions/api/admin/parent-delete.js";

function setup(t) {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  database.exec(`
    CREATE TABLE teams (id TEXT PRIMARY KEY, slug TEXT, name TEXT);
    CREATE TABLE parent_submissions (
      id TEXT PRIMARY KEY, team_id TEXT, player_name TEXT, song_request TEXT,
      r2_key TEXT, content_type TEXT, size_bytes INTEGER, status TEXT,
      created_at TEXT, deleted_at TEXT
    );
    INSERT INTO teams VALUES ('team-1', 'gold', '8U Gold');
    INSERT INTO parent_submissions VALUES
      ('pending', 'team-1', 'Alex', 'Favorite song', 'audio-key', 'audio/webm', 123,
       'pending', '2026-09-01 12:00:00', NULL),
      ('old', 'team-1', 'Sam', 'Earlier request', 'old-audio-key', 'audio/webm', 456,
       'deleted', '2026-08-01 12:00:00', '2026-08-02 13:00:00'),
      ('orphan', 'removed-team', 'Taylor', NULL, 'other-key', 'audio/webm', 789,
       'deleted', '2026-07-01 12:00:00', '2026-07-02 13:00:00');
  `);
  const removedObjects = [];
  const env = {
    ADMIN_KEY: "test-key",
    WALKUP_VOICE: { async delete(key) { removedObjects.push(key); } },
    DB: {
      prepare(sql) {
        let values = [];
        return {
          bind(...args) { values = args; return this; },
          async all() { return { results: database.prepare(sql).all(...values) }; },
          async first() { return database.prepare(sql).get(...values) || null; },
          async run() { return database.prepare(sql).run(...values); },
        };
      },
    },
  };
  return { database, env, removedObjects };
}

function request(path = "parent-inbox", body, authorized = true) {
  return new Request(`https://example.test/api/admin/${path}`, {
    method: body ? "POST" : "GET",
    headers: authorized ? { Authorization: "Bearer test-key", "Content-Type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("deletion removes audio, leaves the pending inbox, and persists readable audit details", async (t) => {
  const { env, removedObjects } = setup(t);
  const response = await onRequestPost({ env, request: request("parent-delete", { id: "pending" }) });
  assert.equal(response.status, 200);
  assert.deepEqual(removedObjects, ["audio-key"]);
  const inbox = await (await onRequestGet({ env, request: request() })).json();
  assert.deepEqual(inbox.submissions, []);
  const historyResponse = await onRequestGet({ env, request: request("parent-inbox?view=deleted") });
  assert.equal(historyResponse.headers.get("cache-control"), "no-store");
  const history = await historyResponse.json();
  const entry = history.submissions[0];
  assert.equal(entry.id, "pending");
  assert.equal(entry.player_name, "Alex");
  assert.equal(entry.song_request, "Favorite song");
  assert.equal(entry.team_name, "8U Gold");
  assert.equal(entry.created_at, "2026-09-01 12:00:00");
  assert.ok(entry.deleted_at);
  assert.equal(entry.r2_key, undefined);
  assert.equal(history.nextOffset, null);
});

test("existing deletions remain visible, including submissions with a missing team", async (t) => {
  const { env } = setup(t);
  const history = await (await onRequestGet({ env, request: request("parent-inbox?view=deleted") })).json();
  assert.deepEqual(history.submissions.map((row) => row.id), ["old", "orphan"]);
  const filtered = await (await onRequestGet({ env, request: request("parent-inbox?view=deleted&team=gold") })).json();
  assert.deepEqual(filtered.submissions.map((row) => row.id), ["old"]);
});

test("repeated deletion preserves the original timestamp and does not delete audio again", async (t) => {
  const { env, database, removedObjects } = setup(t);
  const response = await onRequestPost({ env, request: request("parent-delete", { id: "old" }) });
  assert.equal(response.status, 200);
  assert.deepEqual(removedObjects, []);
  assert.equal(database.prepare("SELECT deleted_at FROM parent_submissions WHERE id='old'").get().deleted_at, "2026-08-02 13:00:00");
});

test("failed audio deletion leaves the submission pending without a false audit event", async (t) => {
  const { env, database } = setup(t);
  env.WALKUP_VOICE.delete = async () => { throw new Error("Storage unavailable"); };
  const response = await onRequestPost({ env, request: request("parent-delete", { id: "pending" }) });
  assert.equal(response.status, 500);
  const row = database.prepare("SELECT status, deleted_at FROM parent_submissions WHERE id='pending'").get();
  assert.equal(row.status, "pending");
  assert.equal(row.deleted_at, null);
});

test("audit pages are stable and filter teams before pagination", async (t) => {
  const { env, database } = setup(t);
  const insert = database.prepare(`INSERT INTO parent_submissions
    (id, team_id, status, deleted_at) VALUES (?, 'team-1', 'deleted', '2026-09-01 12:00:00')`);
  for (let i = 0; i < 55; i++) insert.run(`page-${String(i).padStart(2, "0")}`);
  const page1 = await (await onRequestGet({ env, request: request("parent-inbox?view=deleted&team=gold") })).json();
  const page2 = await (await onRequestGet({ env, request: request(`parent-inbox?view=deleted&team=gold&offset=${page1.nextOffset}`) })).json();
  assert.equal(page1.submissions.length, 50);
  assert.equal(page1.nextOffset, 50);
  assert.equal(page2.submissions.length, 6);
  assert.equal(page2.nextOffset, null);
  const ids = [...page1.submissions, ...page2.submissions].map((row) => row.id);
  assert.equal(new Set(ids).size, 56);
  assert.equal(ids.includes("orphan"), false);
  assert.equal(ids.includes("pending"), false);
});

test("audit and delete require admin access, and invalid pagination is rejected", async (t) => {
  const { env, removedObjects } = setup(t);
  assert.equal((await onRequestGet({ env, request: request("parent-inbox?view=deleted", undefined, false) })).status, 401);
  assert.equal((await onRequestPost({ env, request: request("parent-delete", { id: "pending" }, false) })).status, 401);
  assert.deepEqual(removedObjects, []);
  for (const offset of ["-1", "1.5", "abc"]) {
    assert.equal((await onRequestGet({ env, request: request(`parent-inbox?view=deleted&offset=${offset}`) })).status, 400);
  }
});
