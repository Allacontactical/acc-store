PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  total_items INTEGER NOT NULL,
  imported_items INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('processing', 'ready', 'failed')),
  imported_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS import_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  product_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  prom_url TEXT NOT NULL DEFAULT '',
  price TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT '',
  quantity TEXT NOT NULL DEFAULT '',
  raw_availability TEXT NOT NULL DEFAULT '',
  image_urls_json TEXT NOT NULL DEFAULT '[]',
  raw_json TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'rejected')),
  review_note TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_import_items_batch ON import_items(batch_id, id);
CREATE INDEX IF NOT EXISTS idx_import_items_review ON import_items(review_status, batch_id);
