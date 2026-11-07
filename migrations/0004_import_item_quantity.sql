ALTER TABLE import_items ADD COLUMN quantity TEXT NOT NULL DEFAULT '';

-- Restore the original Prom quantity for items already imported before this migration.
UPDATE import_items
SET quantity = COALESCE(json_extract(raw_json, '$."Кількість"'), '')
WHERE quantity = '';
