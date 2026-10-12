import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

test("finance migration is additive, valid SQLite, and seeds controls without transactions", async () => {
  const [financeSql, backfillSql, aiSql, boardMemberSql, viewablePinSql, workbookBalanceSql] = await Promise.all([
    readFile(new URL("../migrations/0008_finance.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/0009_finance_backfill.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/0010_finance_ai.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/0011_finance_board_members.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/0012_finance_viewable_pins.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/0013_finance_workbook_balances.sql", import.meta.url), "utf8"),
  ]);
  const database = new DatabaseSync(":memory:");
  database.exec(financeSql);
  database.exec(backfillSql);
  database.exec(backfillSql);
  database.exec(aiSql);
  database.exec(aiSql);
  database.exec(boardMemberSql);
  database.exec(viewablePinSql);
  database.exec(workbookBalanceSql);
  database.exec(workbookBalanceSql);
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'finance_%'").all().map((row) => row.name);
  for (const required of [
    "finance_accounts", "finance_fiscal_years", "finance_categories", "finance_transactions",
    "finance_reconciliations", "finance_import_batches", "finance_restricted_funds", "finance_commitments",
    "finance_documents", "finance_audit_events", "finance_sessions",
    "finance_pending_statement_balances",
    "finance_ai_insights", "finance_ai_daily_usage",
    "finance_board_members", "finance_auth_attempts",
    "finance_workbook_balance_observations",
  ]) assert.ok(tables.includes(required), `${required} should exist`);
  assert.ok(database.prepare("PRAGMA table_info(finance_sessions)").all().some((column) => column.name === "board_member_id"));
  assert.ok(database.prepare("PRAGMA table_info(finance_board_members)").all().some((column) => column.name === "pin_ciphertext"));
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM finance_transactions").get().count, 0);
  assert.equal(database.prepare("SELECT name FROM finance_accounts WHERE id = 'finance_account_historical'").get().name, "Consolidated historical source");
  assert.ok(database.prepare("SELECT COUNT(*) AS count FROM finance_validation_controls").get().count > 0);
  database.close();
});
