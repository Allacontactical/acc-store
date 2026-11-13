import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const start = source.indexOf("function buildPublishedProduct(item) {");
const end = source.indexOf("\nasync function dispatchCatalogPublish", start);
assert.ok(start >= 0 && end > start, "buildPublishedProduct must exist in src/index.js");
const sandbox = {};
vm.runInNewContext(source.slice(start, end) + "\nglobalThis.buildPublishedProduct = buildPublishedProduct;", sandbox);
const buildPublishedProduct = sandbox.buildPublishedProduct;
const plain = value => JSON.parse(JSON.stringify(value));

test("maps current Prom export fields without changing raw availability", () => {
  const product = plain(buildPublishedProduct({
    id: 12, product_id: "2456137209", public_product_id: "",
    title: "Штани Chevalier", price: "4300", currency: "UAH",
    quantity: "2", raw_availability: "+",
    image_urls_json: '["https://images.example/item.webp"]',
    raw_json: JSON.stringify({
      "Назва_групи": "Мисливські штани",
      "Опис_укр": "Український опис",
      "Опис": "Русское описание",
      "Виробник": "Chevalier"
    })
  }));
  assert.equal(product.id, "2456137209");
  assert.equal(product.category, "Мисливські штани");
  assert.equal(product.description, "Український опис");
  assert.equal(product.description_ru, "Русское описание");
  assert.equal(product.brand, "Chevalier");
  assert.equal(product.quantity, "2");
  assert.equal(product.availability, "+");
  assert.equal(product.availability_status, "");
  assert.equal(product.image, "https://images.example/item.webp");
});

test("keeps empty quantity empty and supports legacy brand and description headers", () => {
  const product = plain(buildPublishedProduct({
    id: 13, product_id: "123", public_product_id: "",
    title: "Legacy item", price: "10", currency: "UAH",
    quantity: "", raw_availability: "Очікується",
    image_urls_json: "[]",
    raw_json: JSON.stringify({
      "Опис_позиції_укр": "Legacy Ukrainian",
      "Опис_позиції": "Legacy Russian",
      "Бренд": "Legacy brand"
    })
  }));
  assert.equal(product.description, "Legacy Ukrainian");
  assert.equal(product.description_ru, "Legacy Russian");
  assert.equal(product.brand, "Legacy brand");
  assert.equal(Object.hasOwn(product, "quantity"), false);
  assert.equal(product.availability, "Очікується");
  assert.equal(product.availability_status, "expected");
});


test("bulk approval is restricted to the exact complete 281-item ACC batch", () => {
  const isSafe = (() => {
    const start = source.indexOf("function isSafe281ImportBatch(batch, itemCount) {");
    const end = source.indexOf("\n}\n", start) + 2;
    const sandbox = {};
    vm.runInNewContext(source.slice(start, end) + "\nglobalThis.check = isSafe281ImportBatch;", sandbox);
    return sandbox.check;
  })();
  const batch = {
    source_name: "ACC_281_products_no_optics_admin_import.xlsx",
    total_items: 281, imported_items: 281, status: "ready"
  };
  assert.equal(isSafe(batch, 281), true);
  assert.equal(isSafe(batch, 280), false);
  assert.equal(isSafe({ ...batch, source_name: "Ручное добавление" }, 281), false);
  assert.equal(isSafe({ ...batch, total_items: 1, imported_items: 1 }, 1), false);
  assert.equal(isSafe({ ...batch, status: "processing" }, 281), false);
});


test("creates readable product image slugs and accepts legacy and descriptive R2 keys", () => {
  const start = source.indexOf("function imageSlug(value) {");
  const end = source.indexOf("\nasync function sha256", start);
  assert.ok(start >= 0 && end > start, "image naming helpers must exist in src/index.js");
  const sandbox = {};
  vm.runInNewContext(source.slice(start, end) + "\nglobalThis.imageSlug = imageSlug; globalThis.isProductImageKey = isProductImageKey;", sandbox);
  assert.equal(sandbox.imageSlug("Куртка Drake Refuge 3.0"), "kurtka-drake-refuge-3-0");
  assert.equal(sandbox.imageSlug("Штани Chevalier"), "shtany-chevalier");
  assert.equal(sandbox.isProductImageKey("a".repeat(24) + ".webp"), true);
  assert.equal(sandbox.isProductImageKey("drake-refuge-3-2452617-1.webp"), true);
  assert.equal(sandbox.isProductImageKey("../drake-refuge.webp"), false);
  assert.equal(sandbox.isProductImageKey("Drake Refuge.webp"), false);
});

test("photo pipeline sends deterministic product-based file names", () => {
  const workflow = fs.readFileSync(new URL("../.github/workflows/acc-photo-pipeline.yml", import.meta.url), "utf8");
  const admin = fs.readFileSync(new URL("../admin-site/admin.html", import.meta.url), "utf8");
  const catalog = fs.readFileSync(new URL("../catalog.html", import.meta.url), "utf8");
  const homepage = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(workflow, /file_names: chunk\.map\(source => fileNames\.get\(source\)\)/);
  assert.match(workflow, /imageSlug\(item\.title\)/);
  assert.match(admin, /form\.append\("product_title",\$\("manualTitle"\)\.value\)/);
  assert.match(catalog, /img\.alt=\(p\.title\|\|"Товар AllaconTactical"\)\+" — фото 1"/);
  assert.match(homepage, /img\.alt = \(product\.title \|\| "Товар AllaconTactical"\) \+ " — фото 1"/);
});
