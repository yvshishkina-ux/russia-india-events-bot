CREATE TABLE IF NOT EXISTS subscribers (
  chat_id TEXT PRIMARY KEY,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  subscribed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unsubscribed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_subscribers_active
  ON subscribers (active, subscribed_at);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  publication_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (publication_id, chat_id),
  FOREIGN KEY (publication_id) REFERENCES published_versions(publication_id),
  FOREIGN KEY (chat_id) REFERENCES subscribers(chat_id)
);
