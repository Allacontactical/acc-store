# ACC catalog administration — deployment notes

The administration panel is a separate Cloudflare Worker named `acc-catalog-api`. It must not replace, modify, or reuse the existing Telegram bot Worker (`allacontactical-bot`) or publish changes to the live static storefront.

## Cloudflare resources already prepared
- D1 database: `acc-catalog-db`
- D1 database ID: `506eb009-1462-4ff6-a781-1404e9aecf59`
- R2 bucket: `acc-product-images`
- Worker name in `admin-api/wrangler.jsonc`: `acc-catalog-api`

The Wrangler configuration is in `admin-api/wrangler.jsonc`. Deploy using that exact configuration file; do not deploy from the repository root with default settings, and never select `allacontactical-bot`.

## Included
- Password-protected admin interface at `/admin`.
- D1 product records and R2 photo storage.
- Up to 10 images per product. Admin accepts JPG/PNG/WebP and converts every upload to WebP (quality 0.86, original dimensions preserved); converted files are limited to 8 MB. The Worker accepts and stores WebP only and checks the file signature.
- Draft/published state, edit existing records, and unpublish without deleting.
- One-time import of the current public `products.json`.
- Public read-only `/api/catalog` endpoint with allowlisted CORS.
- Login throttling stored in D1.

## Before the first test deployment
1. Confirm the Cloudflare account still contains the D1 database and R2 bucket listed above.
2. Apply `admin-api/schema.sql` to the remote D1 database using the Wrangler configuration at `admin-api/wrangler.jsonc`.
3. Set Worker secrets `ADMIN_PASSWORD` and `SESSION_SECRET`. Use a unique, strong admin password and a long random session secret. Never put either value in GitHub or send it in chat.
4. Deploy only with `admin-api/wrangler.jsonc`, creating the separate Worker `acc-catalog-api`.
5. Do not connect the storefront to the new API and do not change its production files during this test phase.

## Data compatibility and safety
- Existing product fields such as `availability`, `image`, `images`, `url`, `description`, and `description_ru` are retained.
- Legacy availability text is not silently converted to “in stock”. The editor maps only clearly recognizable text; otherwise it displays “Уточнить наличие”.
- Saving an existing product retains its original `availability` text and stores the selected structured status separately as `availability_status`.
- Existing storefront continues to read its current static `products.json`. Do not connect it to `/api/catalog` until the Worker is deployed, all imported records are compared, and CRUD/photo tests pass.
- The first catalog import is intended only for an empty D1 products table. Confirm the source catalog and destination table state before invoking it.
- Never change or redeploy the Telegram bot Worker as part of this setup.

## Verification before any production integration
- Confirm the imported row count matches the source catalog at the time of import; do not rely on a hard-coded historical count.
- Compare a sample of existing products, including IDs, prices, Prom links, availability text, descriptions, and image arrays.
- Test admin login, token expiry, failed-login throttling, create/edit/unpublish, ten-photo limit, JPG/PNG/WebP-to-WebP conversion, rejection of non-WebP direct uploads, post-conversion size checks, and mobile layout.
- Test public catalog CORS and R2 media delivery.
- Connect the storefront only after successful verification and explicit approval.
