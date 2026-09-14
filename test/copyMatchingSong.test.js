import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { onRequestPost } from "../functions/api/admin/copy-matching-song.js";

function createD1() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE seasons (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, year INTEGER NOT NULL,
      term TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE TABLE teams (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL,
      parent_key TEXT, coach_key TEXT, parent_recording_max_seconds INTEGER,
      status TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT,
      season_id TEXT, copied_from_team_id TEXT
    );
    CREATE TABLE roster_players (
      id TEXT PRIMARY KEY, number TEXT, first TEXT, last TEXT,
      status TEXT NOT NULL, created_at TEXT, updated_at TEXT, deleted_at TEXT,
      team_id TEXT, copied_from_player_id TEXT, copied_from_team_id TEXT
    );
    INSERT INTO seasons VALUES
      ('spring-2026', 'Spring 2026', 2026, 'spring', 'archived', '2026-01-01', '2026-06-01'),
      ('fall-2026', 'Fall 2026', 2026, 'fall', 'current', '2026-07-01', NULL);
    INSERT INTO teams VALUES
      ('old-gold', '8U Gold', '8u-gold-spring', '', '', 5, 'active', '2026-01-01', NULL, 'spring-2026', NULL),
      ('old-blue', '8U Blue', '8u-blue-spring', '', '', 5, 'active', '2026-01-01', NULL, 'spring-2026', NULL),
      ('new-gold', '10U Gold', '10u-gold-fall', '', '', 5, 'active', '2026-07-01', NULL, 'fall-2026', NULL);
    INSERT INTO roster_players VALUES
      ('old-alex-1', '1', 'Alex', 'Smith', 'active', '', '', NULL, 'old-gold', NULL, NULL),
      ('old-alex-2', '2', 'alex', 'SMITH', 'active', '', '', NULL, 'old-blue', NULL, NULL),
      ('new-alex', '3', 'Alex', 'Smith', 'active', '', '', NULL, 'new-gold', NULL, NULL);
  `);

  const DB = {
    prepare(sql) {
      let values = [];
      return {
        bind(...nextValues) { values = nextValues; return this; },
        all() { return { results: database.prepare(sql).all(...values) }; },
        first() { return database.prepare(sql).get(...values) || null; },
        run() { return database.prepare(sql).run(...values); },
      };
    },
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
  return { DB };
}

function createBucket(entries) {
  const objects = new Map(Object.entries(entries));
  return {
    async head(key) {
      const value = objects.get(key);
      return value ? { ...value, body: undefined } : null;
    },
    async get(key) {
      const value = objects.get(key);
      return value ? { ...value } : null;
    },
    async list({ prefix }) {
      return {
        objects: [...objects.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => ({ key, uploaded: value.uploaded })),
        truncated: false,
      };
    },
    async put(key, body, options) {
      objects.set(key, {
        body,
        uploaded: new Date("2026-09-14T12:00:00.000Z"),
        httpMetadata: options.httpMetadata,
        customMetadata: options.customMetadata,
      });
    },
    objects,
  };
}

function request(playerId = "new-alex") {
  return new Request("https://example.test/api/admin/copy-matching-song", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-key": "secret" },
    body: JSON.stringify({ destinationPlayerId: playerId }),
  });
}

test("copies the most recently uploaded song from exact name matches", async () => {
  const { DB } = createD1();
  const bucket = createBucket({
    "final/old-gold/old-alex-1": {
      body: "older audio",
      uploaded: new Date("2026-03-01T12:00:00.000Z"),
      httpMetadata: { contentType: "audio/mpeg" },
      customMetadata: { uploadedAt: "2026-03-01T12:00:00.000Z" },
    },
    "final/old-blue/old-alex-2": {
      body: "newer audio",
      uploaded: new Date("2026-05-01T12:00:00.000Z"),
      httpMetadata: { contentType: "audio/wav" },
      customMetadata: { uploadedAt: "2026-05-01T12:00:00.000Z" },
    },
  });

  const response = await onRequestPost({
    request: request(),
    env: { DB, ADMIN_KEY: "secret", WALKUP_VOICE: bucket },
  });
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.source.playerId, "old-alex-2");
  assert.equal(data.source.teamName, "8U Blue");
  const copied = bucket.objects.get("final/new-gold/new-alex");
  assert.equal(copied.body, "newer audio");
  assert.equal(copied.customMetadata.uploadedAt, "2026-05-01T12:00:00.000Z");
  assert.equal(copied.customMetadata.copiedFromPlayerId, "old-alex-2");
});

test("does not overwrite an existing destination song", async () => {
  const { DB } = createD1();
  const bucket = createBucket({
    "final/new-gold/new-alex": {
      body: "current audio",
      uploaded: new Date("2026-09-01T12:00:00.000Z"),
      customMetadata: { uploadedAt: "2026-09-01T12:00:00.000Z" },
    },
  });

  const response = await onRequestPost({
    request: request(),
    env: { DB, ADMIN_KEY: "secret", WALKUP_VOICE: bucket },
  });

  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /already has/i);
});

test("explains when matching players have no songs", async () => {
  const { DB } = createD1();
  const response = await onRequestPost({
    request: request(),
    env: { DB, ADMIN_KEY: "secret", WALKUP_VOICE: createBucket({}) },
  });

  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /none has a final song/i);
});
