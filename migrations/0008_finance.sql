-- BGSL board finance dashboard (additive migration)
-- All monetary values are integer cents. Fiscal years run October 1 through September 30.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS finance_fiscal_years (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  starts_on TEXT NOT NULL UNIQUE,
  ends_on TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS finance_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'bank' CHECK (account_type IN ('bank', 'cash')),
  last_four TEXT CHECK (last_four IS NULL OR length(last_four) = 4),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS finance_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('income', 'expense', 'transfer')),
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (name, classification)
);

CREATE TABLE IF NOT EXISTS finance_category_mappings (
  id TEXT PRIMARY KEY,
  classification TEXT NOT NULL CHECK (classification IN ('income', 'expense', 'transfer')),
  source_category TEXT NOT NULL DEFAULT '',
  description_contains TEXT NOT NULL DEFAULT '',
  category_id TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES finance_categories(id)
);

CREATE TABLE IF NOT EXISTS finance_import_batches (
  id TEXT PRIMARY KEY,
  fiscal_year_id TEXT NOT NULL,
  statement_month TEXT NOT NULL,
  account_id TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  source_sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'preview' CHECK (status IN ('preview', 'imported', 'rolled_back', 'failed')),
  preview_json TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  rolled_back_at TEXT,
  FOREIGN KEY (fiscal_year_id) REFERENCES finance_fiscal_years(id),
  FOREIGN KEY (account_id) REFERENCES finance_accounts(id)
);

CREATE TABLE IF NOT EXISTS finance_transactions (
  id TEXT PRIMARY KEY,
  transaction_date TEXT NOT NULL,
  posted_date TEXT,
  amount_cents INTEGER NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('income', 'expense', 'transfer')),
  category_id TEXT,
  source_category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  normalized_description TEXT NOT NULL,
  account_id TEXT NOT NULL,
  fiscal_year_id TEXT NOT NULL,
  statement_month TEXT NOT NULL,
  source_filename TEXT,
  source_row INTEGER,
  import_batch_id TEXT,
  fingerprint TEXT NOT NULL,
  is_one_time INTEGER NOT NULL DEFAULT 0 CHECK (is_one_time IN (0, 1)),
  is_capital INTEGER NOT NULL DEFAULT 0 CHECK (is_capital IN (0, 1)),
  is_internal_transfer INTEGER NOT NULL DEFAULT 0 CHECK (is_internal_transfer IN (0, 1)),
  matching_transfer_id TEXT,
  is_restricted INTEGER NOT NULL DEFAULT 0 CHECK (is_restricted IN (0, 1)),
  reconciliation_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (reconciliation_status IN ('unreviewed', 'cleared', 'outstanding', 'void')),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (category_id) REFERENCES finance_categories(id),
  FOREIGN KEY (account_id) REFERENCES finance_accounts(id),
  FOREIGN KEY (fiscal_year_id) REFERENCES finance_fiscal_years(id),
  FOREIGN KEY (import_batch_id) REFERENCES finance_import_batches(id),
  FOREIGN KEY (matching_transfer_id) REFERENCES finance_transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_finance_transactions_period
  ON finance_transactions(fiscal_year_id, statement_month, deleted_at);
CREATE INDEX IF NOT EXISTS idx_finance_transactions_account_date
  ON finance_transactions(account_id, transaction_date, deleted_at);
CREATE INDEX IF NOT EXISTS idx_finance_transactions_fingerprint
  ON finance_transactions(fingerprint, deleted_at);
CREATE INDEX IF NOT EXISTS idx_finance_transactions_category
  ON finance_transactions(category_id, deleted_at);

CREATE TABLE IF NOT EXISTS finance_reconciliations (
  id TEXT PRIMARY KEY,
  fiscal_year_id TEXT NOT NULL,
  statement_month TEXT NOT NULL,
  account_id TEXT NOT NULL,
  opening_balance_cents INTEGER NOT NULL,
  statement_ending_balance_cents INTEGER NOT NULL,
  expected_ending_balance_cents INTEGER NOT NULL,
  difference_cents INTEGER NOT NULL,
  deposits_cents INTEGER NOT NULL DEFAULT 0,
  withdrawals_cents INTEGER NOT NULL DEFAULT 0,
  transfers_cents INTEGER NOT NULL DEFAULT 0,
  outstanding_items_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unreconciled' CHECK (status IN ('unreconciled', 'reconciled')),
  document_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  reconciled_by TEXT,
  reconciled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (fiscal_year_id) REFERENCES finance_fiscal_years(id),
  FOREIGN KEY (account_id) REFERENCES finance_accounts(id),
  UNIQUE (statement_month, account_id)
);

CREATE TABLE IF NOT EXISTS finance_periods (
  statement_month TEXT PRIMARY KEY,
  fiscal_year_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_by TEXT,
  published_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (fiscal_year_id) REFERENCES finance_fiscal_years(id)
);

CREATE TABLE IF NOT EXISTS finance_restricted_funds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  fiscal_year_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (fiscal_year_id) REFERENCES finance_fiscal_years(id)
);

CREATE TABLE IF NOT EXISTS finance_commitments (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  payee TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL,
  due_date TEXT,
  account_id TEXT,
  fiscal_year_id TEXT,
  commitment_type TEXT NOT NULL DEFAULT 'commitment' CHECK (commitment_type IN ('commitment', 'outstanding_check')),
  status TEXT NOT NULL DEFAULT 'outstanding' CHECK (status IN ('outstanding', 'paid', 'cancelled')),
  check_last_four TEXT CHECK (check_last_four IS NULL OR length(check_last_four) <= 4),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES finance_accounts(id),
  FOREIGN KEY (fiscal_year_id) REFERENCES finance_fiscal_years(id)
);

CREATE TABLE IF NOT EXISTS finance_settings (
  fiscal_year_id TEXT PRIMARY KEY,
  reserve_cents INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (fiscal_year_id) REFERENCES finance_fiscal_years(id)
);

CREATE TABLE IF NOT EXISTS finance_forecasts (
  id TEXT PRIMARY KEY,
  fiscal_year_id TEXT NOT NULL,
  statement_month TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('income', 'expense')),
  category_id TEXT,
  amount_cents INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (fiscal_year_id) REFERENCES finance_fiscal_years(id),
  FOREIGN KEY (category_id) REFERENCES finance_categories(id)
);

CREATE TABLE IF NOT EXISTS finance_documents (
  id TEXT PRIMARY KEY,
  fiscal_year_id TEXT,
  statement_month TEXT,
  account_id TEXT,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (fiscal_year_id) REFERENCES finance_fiscal_years(id),
  FOREIGN KEY (account_id) REFERENCES finance_accounts(id)
);

CREATE TABLE IF NOT EXISTS finance_audit_events (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_finance_audit_created_at
  ON finance_audit_events(created_at DESC);

CREATE TABLE IF NOT EXISTS finance_sessions (
  token_hash TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_finance_sessions_expires_at
  ON finance_sessions(expires_at);

CREATE TABLE IF NOT EXISTS finance_validation_controls (
  id TEXT PRIMARY KEY,
  fiscal_year_id TEXT NOT NULL,
  statement_month TEXT,
  metric TEXT NOT NULL,
  expected_cents INTEGER NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'statement_control',
  notes TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (fiscal_year_id) REFERENCES finance_fiscal_years(id)
);

CREATE TABLE IF NOT EXISTS finance_data_issues (
  id TEXT PRIMARY KEY,
  fiscal_year_id TEXT,
  statement_month TEXT,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'error')),
  issue_type TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (fiscal_year_id) REFERENCES finance_fiscal_years(id)
);

INSERT OR IGNORE INTO finance_fiscal_years
  (id, label, starts_on, ends_on, status, created_at, updated_at)
VALUES
  ('fy_2024_2025', 'FY 2024–25', '2024-10-01', '2025-09-30', 'closed', datetime('now'), datetime('now')),
  ('fy_2025_2026', 'FY 2025–26', '2025-10-01', '2026-09-30', 'open', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO finance_accounts
  (id, name, account_type, last_four, is_active, created_at, updated_at)
VALUES
  ('finance_account_operating', 'Operating Account', 'bank', NULL, 1, datetime('now'), datetime('now')),
  ('finance_account_fundraising', 'Fundraising Account', 'bank', NULL, 1, datetime('now'), datetime('now')),
  ('finance_account_cash', 'Cash on hand', 'cash', NULL, 1, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO finance_categories
  (id, name, classification, display_order, is_active, created_at, updated_at)
VALUES
  ('finance_income_registration', 'Registration', 'income', 10, 1, datetime('now'), datetime('now')),
  ('finance_income_sponsorship', 'Sponsorship', 'income', 20, 1, datetime('now'), datetime('now')),
  ('finance_income_snack_stand', 'Snack stand', 'income', 30, 1, datetime('now'), datetime('now')),
  ('finance_income_fundraising', 'Fundraising', 'income', 40, 1, datetime('now'), datetime('now')),
  ('finance_income_donations', 'Donations', 'income', 50, 1, datetime('now'), datetime('now')),
  ('finance_income_other', 'Other income', 'income', 60, 1, datetime('now'), datetime('now')),
  ('finance_expense_field_improvements', 'Field improvements', 'expense', 110, 1, datetime('now'), datetime('now')),
  ('finance_expense_field_maintenance', 'Field maintenance', 'expense', 120, 1, datetime('now'), datetime('now')),
  ('finance_expense_equipment', 'Equipment', 'expense', 130, 1, datetime('now'), datetime('now')),
  ('finance_expense_uniforms', 'Uniforms', 'expense', 140, 1, datetime('now'), datetime('now')),
  ('finance_expense_insurance', 'Insurance', 'expense', 150, 1, datetime('now'), datetime('now')),
  ('finance_expense_league_fees', 'League/team fees', 'expense', 160, 1, datetime('now'), datetime('now')),
  ('finance_expense_umpires', 'Umpires', 'expense', 170, 1, datetime('now'), datetime('now')),
  ('finance_expense_training', 'Training/workouts', 'expense', 180, 1, datetime('now'), datetime('now')),
  ('finance_expense_snack_inventory', 'Snack-stand inventory', 'expense', 190, 1, datetime('now'), datetime('now')),
  ('finance_expense_utilities', 'Utilities/water', 'expense', 200, 1, datetime('now'), datetime('now')),
  ('finance_expense_printing', 'Printing/signage', 'expense', 210, 1, datetime('now'), datetime('now')),
  ('finance_expense_admin', 'Administrative/postage', 'expense', 220, 1, datetime('now'), datetime('now')),
  ('finance_expense_refunds', 'Refunds', 'expense', 230, 1, datetime('now'), datetime('now')),
  ('finance_expense_other', 'Other expense', 'expense', 240, 1, datetime('now'), datetime('now')),
  ('finance_transfer_internal', 'Internal transfer', 'transfer', 300, 1, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO finance_category_mappings
  (id, classification, source_category, description_contains, category_id, priority, created_at, updated_at)
VALUES
  ('map_income_sponsorship', 'income', '', 'sponsor', 'finance_income_sponsorship', 100, datetime('now'), datetime('now')),
  ('map_income_snack', 'income', '', 'snack stand', 'finance_income_snack_stand', 100, datetime('now'), datetime('now')),
  ('map_income_square', 'income', '', 'square', 'finance_income_snack_stand', 90, datetime('now'), datetime('now')),
  ('map_income_registration', 'income', '', 'sports connect', 'finance_income_registration', 90, datetime('now'), datetime('now')),
  ('map_income_fundraising', 'income', '', 'sign up genius', 'finance_income_fundraising', 90, datetime('now'), datetime('now')),
  ('map_expense_snackstand', 'expense', 'snackstand', '', 'finance_expense_snack_inventory', 80, datetime('now'), datetime('now')),
  ('map_expense_utilities', 'expense', 'utilities', '', 'finance_expense_utilities', 80, datetime('now'), datetime('now')),
  ('map_expense_umpires', 'expense', '', 'umpire', 'finance_expense_umpires', 90, datetime('now'), datetime('now')),
  ('map_transfer_internal', 'transfer', '', 'transfer', 'finance_transfer_internal', 100, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO finance_settings
  (fiscal_year_id, reserve_cents, updated_by, updated_at)
VALUES
  ('fy_2024_2025', 0, 'migration', datetime('now')),
  ('fy_2025_2026', 0, 'migration', datetime('now'));

-- User-provided statement/annual controls. These validate imports; they are never transactions.
INSERT OR IGNORE INTO finance_validation_controls
  (id, fiscal_year_id, statement_month, metric, expected_cents, source_kind, notes)
VALUES
  ('control_2425_income', 'fy_2024_2025', NULL, 'external_income', 3497370, 'user_supplied_control', 'Full fiscal year'),
  ('control_2425_expenses', 'fy_2024_2025', NULL, 'expenses', 4511786, 'user_supplied_control', 'Full fiscal year'),
  ('control_2425_one_time', 'fy_2024_2025', NULL, 'one_time_expenses', 1497500, 'user_supplied_control', 'Landscape project'),
  ('control_2425_normalized_expenses', 'fy_2024_2025', NULL, 'normalized_expenses', 3014286, 'user_supplied_control', 'Excludes landscape project'),
  ('control_2425_beginning_cash', 'fy_2024_2025', '2024-10', 'beginning_cash', 1830612, 'user_supplied_control', 'Known accounts'),
  ('control_2425_ending_cash', 'fy_2024_2025', '2025-09', 'ending_cash', 811097, 'user_supplied_control', ''),
  ('control_2526_income', 'fy_2025_2026', '2026-06', 'external_income_ytd', 3257319, 'user_supplied_control', 'October 2025 through June 2026'),
  ('control_2526_expenses', 'fy_2025_2026', '2026-06', 'expenses_ytd', 2655244, 'user_supplied_control', 'October 2025 through June 2026'),
  ('control_2526_net', 'fy_2025_2026', '2026-06', 'net_ytd', 602075, 'user_supplied_control', 'October 2025 through June 2026'),
  ('control_2026_02_ending', 'fy_2025_2026', '2026-02', 'ending_cash', 2133702, 'user_supplied_control', ''),
  ('control_2026_02_deposits', 'fy_2025_2026', '2026-02', 'income', 1168355, 'user_supplied_control', ''),
  ('control_2026_02_withdrawals', 'fy_2025_2026', '2026-02', 'expenses', 164842, 'user_supplied_control', ''),
  ('control_2026_03_income', 'fy_2025_2026', '2026-03', 'income', 857023, 'user_supplied_control', ''),
  ('control_2026_03_expenses', 'fy_2025_2026', '2026-03', 'expenses', 762720, 'user_supplied_control', ''),
  ('control_2026_03_ending', 'fy_2025_2026', '2026-03', 'ending_cash', 2228005, 'user_supplied_control', ''),
  ('control_2026_04_income', 'fy_2025_2026', '2026-04', 'income', 164154, 'user_supplied_control', ''),
  ('control_2026_04_expenses', 'fy_2025_2026', '2026-04', 'expenses', 443381, 'user_supplied_control', ''),
  ('control_2026_04_ending', 'fy_2025_2026', '2026-04', 'ending_cash', 1948778, 'user_supplied_control', ''),
  ('control_2026_05_income', 'fy_2025_2026', '2026-05', 'income', 113426, 'user_supplied_control', ''),
  ('control_2026_05_expenses', 'fy_2025_2026', '2026-05', 'expenses', 461690, 'user_supplied_control', ''),
  ('control_2026_05_ending', 'fy_2025_2026', '2026-05', 'ending_cash', 1600514, 'user_supplied_control', ''),
  ('control_2026_06_income', 'fy_2025_2026', '2026-06', 'income', 105844, 'user_supplied_control', ''),
  ('control_2026_06_expenses', 'fy_2025_2026', '2026-06', 'expenses', 293186, 'user_supplied_control', ''),
  ('control_2026_06_ending', 'fy_2025_2026', '2026-06', 'ending_cash', 1413172, 'user_supplied_control', '');

INSERT OR IGNORE INTO finance_data_issues
  (id, fiscal_year_id, statement_month, severity, issue_type, description, amount_cents, status, created_at, updated_at)
VALUES
  ('issue_2425_snack_cash', 'fy_2024_2025', NULL, 'warning', 'unreconciled_snack_cash', 'Prior-year snack-stand cash lacks a clear deposit trail.', 331800, 'open', datetime('now'), datetime('now')),
  ('issue_2026_02_duplicate', 'fy_2025_2026', '2026-02', 'warning', 'known_duplicate', 'February source includes a duplicated $275 sponsorship deposit; review the flagged rows.', 27500, 'open', datetime('now'), datetime('now')),
  ('issue_2026_02_amount', 'fy_2025_2026', '2026-02', 'warning', 'source_amount_error', 'February source records a Sports Connect deposit as $120.00; statement control is $120.65.', 65, 'open', datetime('now'), datetime('now')),
  ('issue_2026_05_missing_withdrawals', 'fy_2025_2026', '2026-05', 'error', 'missing_statement_transactions', 'May workbook omits seven statement withdrawals. Import statement rows rather than a balancing entry.', 59519, 'open', datetime('now'), datetime('now'));
