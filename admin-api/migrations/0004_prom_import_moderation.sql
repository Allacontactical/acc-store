CREATE TABLE IF NOT EXISTS acc_admin_import_items (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL REFERENCES acc_admin_imports(id) ON DELETE CASCADE,
  source_product_id TEXT NOT NULL,
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  existing_product_id TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reviewed_at TEXT,
  UNIQUE(import_id, source_product_id)
);
CREATE INDEX IF NOT EXISTS idx_acc_admin_import_items_review
ON acc_admin_import_items(review_status, created_at);
