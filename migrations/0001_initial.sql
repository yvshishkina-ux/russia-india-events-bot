CREATE TABLE IF NOT EXISTS event_state (
  event_id TEXT PRIMARY KEY,
  significant_fingerprint TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_at TEXT
);

CREATE TABLE IF NOT EXISTS published_versions (
  publication_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  significant_fingerprint TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('new', 'updated')),
  status TEXT NOT NULL CHECK (status IN ('processing', 'sent', 'failed')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_published_event
  ON published_versions (event_id, created_at);

CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id INTEGER PRIMARY KEY,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL CHECK (mode IN ('bootstrap', 'monitor', 'scheduled')),
  event_count INTEGER NOT NULL,
  new_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  published_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
