import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  onRequestDelete,
  onRequestPut,
} from "../functions/api/admin/teams.js";

function createD1() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE seasons (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      year INTEGER NOT NULL,
      term TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE TABLE teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      parent_key TEXT,
      coach_key TEXT,
      parent_recording_max_seconds INTEGER,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      deleted_at TEXT,
      season_id TEXT,
      copied_from_team_id TEXT
    );
    CREATE TABLE roster_players (
      id TEXT PRIMARY KEY,
      copied_from_player_id TEXT,
      copied_from_team_id TEXT
    );
    INSERT INTO seasons VALUES
      ('spring-2026', 'Spring 2026', 2026, 'spring', 'archived', '2026-01-01', '2026-08-01'),
      ('fall-2026', 'Fall 2026', 2026, 'fall', 'current', '2026-08-01', NULL);
    INSERT INTO teams VALUES
      ('team_archived', '8U Gold', '8u-gold-spring-2026', 'parent', 'coach', 5, 'active', '2026-01-01', NULL, 'spring-2026', NULL);
  `);

  const DB = {
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
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };

  return { database, env: { DB, ADMIN_KEY: "admin-secret" } };
}

function adminRequest(method, body) {
  return new Request("https://example.test/api/admin/teams", {
    method,
    headers: {
      "content-type": "application/json",
      "x-admin-key": "admin-secret",
    },
    body: JSON.stringify(body),
  });
}

test("admin can rename an archived team", async () => {
  const { database, env } = createD1();
  const response = await onRequestPut({
    request: adminRequest("PUT", {
      slug: "8u-gold-spring-2026",
      name: "8U Legacy Gold",
    }),
    env,
  });

  assert.equal(response.status, 200);
  assert.equal(
    database.prepare("SELECT name FROM teams WHERE id = 'team_archived'").get().name,
    "8U Legacy Gold"
  );
});

test("admin can remove an archived team from the archive", async () => {
  const { database, env } = createD1();
  const response = await onRequestDelete({
    request: adminRequest("DELETE", { slug: "8u-gold-spring-2026" }),
    env,
  });

  assert.equal(response.status, 200);
  const team = database.prepare(
    "SELECT status, deleted_at FROM teams WHERE id = 'team_archived'"
  ).get();
  assert.equal(team.status, "deleted");
  assert.ok(team.deleted_at);
});
