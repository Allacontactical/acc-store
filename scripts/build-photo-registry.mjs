// Read-only: builds the old->new photo URL registry and the manual-review list.
// Usage: node scripts/build-photo-registry.mjs > photo-registry.csv
import fs from "node:fs";
import { assignNames } from "./photo-names.mjs";

const R2_BASE = "https://allacontactical-bot.allacontactical.workers.dev";
const products = JSON.parse(fs.readFileSync(new URL("../products.json", import.meta.url), "utf8"));
const { byProduct } = assignNames(products);

// Known defect sets from the audit (read-only constants).
const PNG_AS_JPG = new Set([
  "3958181171_ohotnichi-sapogi-gateway1.jpg", "7654816844_itw-web-dom.jpg", "7654816844_itw-web-dominator.jpg",
  "6545934813_tolstovka-z-kapyushonom.jpg", "6546014404_mislivski-shtani-swedteam.jpg",
  "7010456298_prodazh-shtanov-sitka.jpg", "7010456384_prodazh-shtanov-sitka.jpg", "7010456397_prodazh-shtanov-sitka.jpg",
  "7232127141_kostyum-pirscher-gear.jpg", "7232127143_kostyum-pirscher-gear.jpg", "7232127147_kostyum-pirscher-gear.jpg",
  "7786118104_ohotnichi-zhilety-amerikanskogo.jpg"
]);

const urlOwners = new Map();
for (const product of products) {
  for (const url of product.images || []) {
    if (!urlOwners.has(url)) urlOwners.set(url, []);
    urlOwners.get(url).push(String(product.id));
  }
}

const rows = [["product_id", "photo_index", "old_url", "new_url", "new_name", "flags"]];
let sharedCount = 0, pngCount = 0;
for (const product of products) {
  const names = byProduct[String(product.id)];
  (product.images || []).forEach((url, i) => {
    const flags = [];
    if ((urlOwners.get(url) || []).length > 1) { flags.push("shared_across_products"); sharedCount++; }
    const base = url.split("/").pop();
    if (PNG_AS_JPG.has(base)) { flags.push("png_as_jpg"); pngCount++; }
    if (/^[a-f0-9]{24}\.webp$/.test(base)) flags.push("opaque_worker_key");
    rows.push([product.id, i + 1, url, `${R2_BASE}/product-images/${names[i]}`, names[i], flags.join("|")]);
  });
}

const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
process.stdout.write(csv + "\n");
process.stderr.write(JSON.stringify({ products: products.length, rows: rows.length - 1, shared_refs: sharedCount, png_as_jpg: pngCount }) + "\n");
