# ACC Admin — deployment checklist

This is an isolated admin application. It does not replace or modify the buyer account / Telegram Worker.

## Resources
- Worker name: `acc-admin-api`
- D1 binding: `DB` → `acc-catalog-db`
- R2 binding: `PRODUCT_IMAGES` → `acc-product-images`
- Migration: `migrations/0001_admin_schema.sql`

## Required security configuration before deployment
1. The Worker custom domain is configured as `admin.allacontactical.com.ua` in Wrangler. Do not publish it until the owner approves DNS/custom-domain setup.
2. In Cloudflare Zero Trust, create two self-hosted Access applications on that hostname:
   - Path `/panel*` — protects the admin interface and its static assets.
   - Path `/admin*` — protects all management API routes and private admin photo previews.
3. For both applications, create an Allow policy for the owner's exact email only. Do not add public or broad email-domain access.
4. Do not protect `/public/products` or `/media/*`: these are read-only public catalog routes. All write routes remain under `/admin/*`.
5. Configure Worker variables (not source code): `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, and `ADMIN_EMAIL`.
6. Keep the R2 bucket private. Do not enable public bucket access.
7. The admin page is served at `https://admin.allacontactical.com.ua/panel/`. The public catalog endpoint is `https://admin.allacontactical.com.ua/public/products`.

The API intentionally returns 401 when Access variables are missing or the JWT cannot be verified. The admin UI is served by the same Worker, but Access must protect the `/panel*` path separately from the public read-only routes.

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
- Delete and reorder uploaded photos.\n- Prom CSV upload parses the standard Prom.ua columns and stages rows in a review queue. Existing products keep their current publication status until each imported row is approved; new products remain in `review` until an owner chooses a publication status.
- Product photo previews in the protected admin interface.

## Not yet complete
- Initial import of the current `products.json` catalog and the fresh Prom export. A repeatable SQL builder is provided at `scripts/build-admin-import.mjs`; it only generates SQL and does not apply it.
- Optional public catalog feed is implemented; `catalog.html` and `account.html` use it only when `catalog-api-config.js` is configured, and retain `products.json` as fallback.
- Test the CSV parser against the next fresh Prom export. Automatic background synchronization from Prom is not available until an official API/webhook or reliable export process is configured.
- End-to-end tests against a staging Worker and D1/R2 instance.
- Deployment and DNS/Access configuration.

These remaining items must be completed and tested before this admin panel can be considered ready for production.
