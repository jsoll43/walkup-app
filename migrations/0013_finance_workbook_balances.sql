-- Workbook-reported month-end balances are display-only observations.
-- They do not satisfy statement-balance, reconciliation, or publication requirements.

CREATE TABLE IF NOT EXISTS finance_workbook_balance_observations (
  statement_month TEXT PRIMARY KEY,
  balance_cents INTEGER NOT NULL,
  source_filename TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  source_cell TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
