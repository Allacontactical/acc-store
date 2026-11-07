ALTER TABLE import_items ADD COLUMN is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0, 1));
ALTER TABLE import_items ADD COLUMN public_product_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_import_items_public_product_id
  ON import_items(public_product_id) WHERE public_product_id IS NOT NULL;
