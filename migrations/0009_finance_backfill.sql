-- Historical finance backfill workflow.
-- Keeps transaction ingestion separate from statement-balance reconciliation.

PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO finance_accounts
  (id, name, account_type, last_four, is_active, created_at, updated_at)
VALUES
  ('finance_account_historical', 'Consolidated historical source', 'bank', NULL, 1, datetime('now'), datetime('now'));

CREATE TABLE IF NOT EXISTS finance_pending_statement_balances (
  statement_month TEXT NOT NULL,
  account_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'statement_not_supplied',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (statement_month, account_id),
  FOREIGN KEY (account_id) REFERENCES finance_accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_finance_pending_statement_balances_account
  ON finance_pending_statement_balances(account_id, statement_month);
