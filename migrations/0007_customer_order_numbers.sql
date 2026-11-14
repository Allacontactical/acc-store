CREATE TABLE customer_order_numbers (
  number INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL UNIQUE REFERENCES customer_orders(id)
);
