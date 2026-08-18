-- Named Board-member PIN access for the private finance dashboard.
-- PINs are stored only as salted PBKDF2 hashes.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS finance_board_members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  last_login_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_board_members_name
  ON finance_board_members(lower(name));
CREATE INDEX IF NOT EXISTS idx_finance_board_members_active
  ON finance_board_members(is_active, name);

ALTER TABLE finance_sessions
  ADD COLUMN board_member_id TEXT REFERENCES finance_board_members(id);

CREATE INDEX IF NOT EXISTS idx_finance_sessions_board_member
  ON finance_sessions(board_member_id, expires_at);

CREATE TABLE IF NOT EXISTS finance_auth_attempts (
  attempt_key TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  window_started_at TEXT NOT NULL,
  blocked_until TEXT,
  updated_at TEXT NOT NULL
);
