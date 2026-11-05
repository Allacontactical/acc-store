# ACC Admin — deployment checklist

This is an isolated admin application. It does not replace or modify the buyer account / Telegram Worker.

## Resources
- Worker name: `acc-admin-api`
- D1 binding: `DB` → `acc-catalog-db`
- R2 binding: `PRODUCT_IMAGES` → `acc-product-images`
- Migration: `migrations/0001_admin_schema.sql`

## Required security configuration before deployment
1. Create a Cloudflare Access self-hosted application for the chosen admin API hostname.
2. Add an allow policy for the single owner email only.
3. Configure Worker variables (not source code): `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, and `ADMIN_EMAIL`.
4. Set a custom hostname for the Worker and configure its DNS record only after the owner approves the exact hostname.
5. Set `window.ACC_ADMIN_API_URL` in `admin/config.js` to that protected HTTPS hostname.
6. Keep the R2 bucket private. Do not enable public bucket access.

The API intentionally returns 401 when Access variables are missing or the JWT cannot be verified.

## Apply the D1 migration
From this directory, after reviewing the target account and database:
```sh
npx wrangler d1 migrations apply acc-catalog-db --remote
```

## Deploy
```sh
npx wrangler deploy --config wrangler.jsonc
```

Do not deploy this Worker or expose the admin page until the Access application, owner-only policy, custom hostname, and environment variables have been independently verified.

## Current scope
- Separate product records and audit log in D1.
- Add/edit products and statuses: active, expected, out of stock, review.
- Archive and restore products.
- Upload up to 10 photos per product; browser converts images to WebP and the API checks the WebP signature and size before storing in private R2.
- Delete and reorder uploaded photos.
- Product photo previews in the protected admin interface.

## Not yet complete
- Initial import of the current `products.json` catalog and the fresh Prom export.
- Public catalog read integration so approved D1 edits appear on the customer-facing website.
- Prom API/export synchronization and a proper moderation importer.
- End-to-end tests against a staging Worker and D1/R2 instance.
- Deployment and DNS/Access configuration.

These remaining items must be completed and tested before this admin panel can be considered ready for production.
