-- Preserve the quantity exported by Prom.ua for every reviewed import item.
ALTER TABLE import_items ADD COLUMN quantity TEXT NOT NULL DEFAULT '';
