-- ACC admin tables are deliberately prefixed and isolated from buyer-account tables.
CREATE TABLE IF NOT EXISTS acc_admin_products (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  price REAL,
  currency TEXT NOT NULL DEFAULT 'UAH',
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  description_ru TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'review'
    CHECK (status IN ('active','expected','out_of_stock','review','archived')),
  source TEXT NOT NULL DEFAULT 'manual',
  source_product_id TEXT,
  source_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_acc_admin_products_status ON acc_admin_products(status);
CREATE INDEX IF NOT EXISTS idx_acc_admin_products_source ON acc_admin_products(source, source_product_id);

CREATE TABLE IF NOT EXISTS acc_admin_product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES acc_admin_products(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL DEFAULT 'image/webp',
  byte_size INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_acc_admin_images_product ON acc_admin_product_images(product_id, sort_order);

CREATE TABLE IF NOT EXISTS acc_admin_imports (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'prom',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed')),
  filename TEXT,
  total_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS acc_admin_audit (
  id TEXT PRIMARY KEY,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  product_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
