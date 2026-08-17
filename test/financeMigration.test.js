import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

test("finance migration is additive, valid SQLite, and seeds controls without transactions", async () => {
  const sql = await readFile(new URL("../migrations/0008_finance.sql", import.meta.url), "utf8");
  const database = new DatabaseSync(":memory:");
  database.exec(sql);
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'finance_%'").all().map((row) => row.name);
  for (const required of [
    "finance_accounts", "finance_fiscal_years", "finance_categories", "finance_transactions",
    "finance_reconciliations", "finance_import_batches", "finance_restricted_funds", "finance_commitments",
    "finance_documents", "finance_audit_events", "finance_sessions",
  ]) assert.ok(tables.includes(required), `${required} should exist`);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM finance_transactions").get().count, 0);
  assert.ok(database.prepare("SELECT COUNT(*) AS count FROM finance_validation_controls").get().count > 0);
  database.close();
});

