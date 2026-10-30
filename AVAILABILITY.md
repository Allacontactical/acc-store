# ACC product availability fields

The storefront reads these optional fields from each product record in `products.json`:

- `availability_status`: one of `in_stock`, `expected`, `out_of_stock`, `preorder`.
- `expected_arrival`: optional confirmed arrival date/text. Use only when the date is verified; omit otherwise.

Customer-facing labels:
- `in_stock` — В наличии
- `expected` — Ожидается
- `out_of_stock` — Нет в наличии
- `preorder` — Под заказ

Only set `expected` when a replenishment order is confirmed and the goods are in transit. Do not infer availability from the old free-text `availability` field. The public catalog does not display internal incoming quantity or internal notes.

The full catalog includes a filter for `expected` products. The shared `availability.js` module enhances product cards after asynchronous catalog rendering, while `availability.css` supplies the ACC olive/orange styling.

No product has been assigned a new status as part of this implementation; the existing 281 records remain unchanged.
