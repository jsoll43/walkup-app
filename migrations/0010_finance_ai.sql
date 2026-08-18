-- Aggregate-only Workers AI summaries for the Board finance dashboard.
-- No transaction rows, account balances, or reconciliation data are stored here.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS finance_ai_insights (
  cache_key TEXT PRIMARY KEY,
  fiscal_year_id TEXT NOT NULL,
  report_type TEXT NOT NULL CHECK (report_type IN ('explain_month', 'year_over_year', 'expense_increases', 'treasurer_report')),
  statement_month TEXT,
  facts_hash TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (fiscal_year_id) REFERENCES finance_fiscal_years(id)
);

CREATE INDEX IF NOT EXISTS idx_finance_ai_insights_period
  ON finance_ai_insights(fiscal_year_id, report_type, statement_month, created_at);

CREATE TABLE IF NOT EXISTS finance_ai_daily_usage (
  usage_date TEXT PRIMARY KEY,
  inference_count INTEGER NOT NULL DEFAULT 0 CHECK (inference_count >= 0),
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  estimated_neurons_milli INTEGER NOT NULL DEFAULT 0 CHECK (estimated_neurons_milli >= 0),
  updated_at TEXT NOT NULL
);
