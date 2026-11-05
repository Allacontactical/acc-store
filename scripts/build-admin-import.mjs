import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const root = process.cwd();
const input = path.resolve(root, process.argv[2] || "products.json");
const output = path.resolve(root, process.argv[3] || "admin-api/import-current-catalog.sql");
const products = JSON.parse(fs.readFileSync(input, "utf8"));
if (!Array.isArray(products)) throw new Error("products.json must contain an array");

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return "'" + String(value).replace(/'/g, "''") + "'";
}
function safeText(value, max) {
  return String(value ?? "").slice(0, max);
}

const statements = [];
const seen = new Set();
for (const p of products) {
  const sourceId = safeText(p.id, 100).trim();
  const title = safeText(p.title, 250).trim();
  if (!sourceId || !title || seen.has(sourceId)) continue;
  seen.add(sourceId);
  const price = p.price === null || p.price === "" || !Number.isFinite(Number(p.price)) ? null : Number(p.price);
  const legacy = JSON.stringify(p);
  const fields = [
    randomUUID(), title, price, safeText(p.currency || "UAH", 8),
    safeText(p.category, 180), safeText(p.description, 12000),
    safeText(p.description_ru, 12000), "active", "static",
    sourceId, safeText(p.url, 1000), legacy
  ];
  statements.push(
    "INSERT INTO acc_admin_products " +
    "(id,title,price,currency,category,description,description_ru,status,source,source_product_id,source_url,legacy_json) VALUES (" +
    fields.map(sql).join(",") +
    ") ON CONFLICT(source_product_id) DO UPDATE SET " +
    "title=excluded.title,price=excluded.price,currency=excluded.currency,category=excluded.category," +
    "description=excluded.description,description_ru=excluded.description_ru,status='active'," +
    "source='static',source_url=excluded.source_url,legacy_json=excluded.legacy_json," +
    "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');"
  );
}
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, statements.join("\n") + "\n", "utf8");
console.log("Prepared " + statements.length + " product upserts.");
console.log("SQL file: " + output);
console.log("No database was changed. Review the SQL before applying it with Wrangler.");
