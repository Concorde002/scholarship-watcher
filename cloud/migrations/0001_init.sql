CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS watchlist (
  user_id TEXT NOT NULL,
  opportunity_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, opportunity_id)
);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT,
  apply_url TEXT,
  source_name TEXT,
  source_type TEXT,
  deadline TEXT,
  event_date TEXT,
  location TEXT,
  category TEXT,
  reason TEXT,
  verified_by TEXT,
  first_seen TEXT,
  imported_at TEXT
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_opportunities_deadline ON opportunities(deadline);
CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id);
