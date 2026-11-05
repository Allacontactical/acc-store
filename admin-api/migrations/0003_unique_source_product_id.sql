CREATE UNIQUE INDEX IF NOT EXISTS uq_acc_admin_source_product_id
ON acc_admin_products(source_product_id)
WHERE source_product_id IS NOT NULL AND source_product_id <> '';
