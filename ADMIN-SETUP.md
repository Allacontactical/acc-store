# ACC catalog administration — deployment notes

This is a separate Cloudflare Worker project. It does not replace or modify the existing Telegram bot Worker (`allacontactical-bot`).

## Included
- Responsive ACC-style admin interface at `/admin`.
- Password login; password and signing key are Cloudflare Worker secrets, never stored in Git.
- D1 product records and R2 photo storage.
- Up to 10 images per product, JPG/PNG/WebP, maximum 8 MB per image.
- Draft/published state, edit existing records, and unpublish without deleting.
- One-time import of the current public `products.json` into D1.
- Public read-only endpoint `/api/catalog`.

## Required Cloudflare setup
1. Create a D1 database named `acc-catalog`.
2. Create an R2 bucket named `acc-product-media`.
3. Put the actual D1 database ID into `admin-api/wrangler.jsonc`.
4. From the `admin-api` folder, apply `schema.sql` to the D1 database.
5. Set Worker secrets `ADMIN_PASSWORD` and `SESSION_SECRET` (use a long random value for the latter).
6. Deploy this Worker as `allacontactical-admin`.
7. Open `https://allacontactical-admin.<your-workers-subdomain>.workers.dev/admin`, sign in, then invoke the one-time import endpoint from an authenticated admin session before enabling the storefront API.

## Important deployment boundary
The existing public storefront still reads its current static `products.json`. It must not be switched to `/api/catalog` until the Worker is deployed, the D1 import is verified, and the public catalog endpoint returns all existing products. The existing Telegram bot Worker and its configuration must remain untouched.

## Follow-up required before production
- Configure Cloudflare account resources and secrets.
- Run the initial import and compare the D1 product count and sample records against the current 281-product catalog.
- Add the deployed Worker API URL to the storefront configuration and update the catalog loaders only after the import is verified.
- Test login, expiry, product create/edit/unpublish, multiple image upload, mobile layout, and public image delivery.
- Add login rate limiting and operational monitoring before broad production use.
