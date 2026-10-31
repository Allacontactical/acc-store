# ACC catalog administration — deployment notes

The administration panel is a separate Cloudflare Worker. It does not replace or modify the existing Telegram bot Worker (`allacontactical-bot`) or the live static storefront.

## Included
- Password-protected admin interface at `/admin`.
- D1 product records and R2 photo storage.
- Up to 10 images per product, JPG/PNG/WebP, maximum 8 MB per image; server checks the file signature.
- Draft/published state, edit existing records, and unpublish without deleting.
- One-time import of the current public `products.json`.
- Public read-only `/api/catalog` endpoint with allowlisted CORS.
- Login throttling stored in D1.

## Required Cloudflare setup
1. Create a D1 database named `acc-catalog`.
2. Create an R2 bucket named `acc-product-media`.
3. Put the real D1 database ID into `admin-api/wrangler.jsonc`.
4. From `admin-api`, apply `schema.sql` to D1.
5. Set Worker secrets `ADMIN_PASSWORD` and `SESSION_SECRET` (use a long random value for the latter).
6. Deploy this Worker as `allacontactical-admin`.
7. Open the Worker `/admin` page, sign in, and import the catalog. The first import is only allowed when the D1 products table is empty.

## Data compatibility and safety
- Existing product fields such as `availability`, `image`, `images`, `url`, `description`, and `description_ru` are retained.
- Legacy availability text is not silently converted to “in stock”. The editor maps only clearly recognizable text; otherwise it displays “Уточнить наличие”.
- Saving an existing product retains its original `availability` text and stores the selected structured status separately as `availability_status`.
- Existing storefront continues to read its current static `products.json`. Do not connect it to `/api/catalog` until the Worker is deployed, all imported records are compared, and CRUD/photo tests pass.
- Never change or redeploy the Telegram bot Worker as part of this setup.

## Verification before production
- Confirm imported row count matches the source catalog (currently 281 products).
- Compare a sample of existing products, including their IDs, prices, Prom links, availability text and image arrays.
- Test admin login, expiry, failed-login throttling, create/edit/unpublish, ten-photo limit, file type/size checks and mobile layout.
- Test public catalog CORS and R2 media delivery.
- Connect storefront only after successful verification and explicit approval.
