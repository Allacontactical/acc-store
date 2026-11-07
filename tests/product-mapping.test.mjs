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
