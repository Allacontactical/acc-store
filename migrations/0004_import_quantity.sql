-- Quantity is included in migration 0003 for fresh databases.
-- This no-op migration keeps databases that already have the quantity column in sync
-- with the migration history without attempting to add the column twice.
SELECT 1;
