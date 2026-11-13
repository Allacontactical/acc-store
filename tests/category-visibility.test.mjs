import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const products = JSON.parse(fs.readFileSync(new URL("../products.json", import.meta.url), "utf8"));
const pageNames = [
  "hunting-headwear.html",
  "tactical-gear.html",
  "hunting-clothing.html",
  "hunting-accessories.html",
  "hunting-footwear.html",
  "fishing-gear.html"
];
const pages = pageNames.map(name => {
  const html = fs.readFileSync(new URL("../" + name, import.meta.url), "utf8");
  const match = html.match(/var allowedCategories=(\[[^\n]+\]);/);
  assert.ok(match, name + " must declare allowedCategories");
  return { name, html, categories: JSON.parse(match[1]) };
});
const allPageCategories = new Set(pages.flatMap(page => page.categories));

test("all catalog products belong to at least one navigable category", () => {
  assert.equal(products.length, 282);
  assert.equal(new Set(products.map(product => product.id)).size, products.length);
  const invisible = products.filter(product => !allPageCategories.has(product.category));
  assert.deepEqual(invisible.map(product => ({ id: product.id, category: product.category })), []);
  assert.equal(products.some(product => product.category === "Розпродаж!!!"), false);
});

test("six previously invisible products use exact page category labels", () => {
  const expected = {
    "2456220146": "Мисливські шапки, кепки, бафи.",
    "2456230447": "Мисливські шапки, кепки, бафи.",
    "2456259276": "Мисливські шапки, кепки, бафи.",
    "2555154784": "Мисливські шапки, кепки, бафи.",
    "2534652617": "Тактичний одяг",
    "2457811325": "Мисливські худі, пуловери, футболкі"
  };
  for (const [id, category] of Object.entries(expected)) {
    const product = products.find(item => item.id === id);
    assert.ok(product, "missing product " + id);
    assert.equal(product.category, category, "wrong category for " + id);
  }
});

test("four former sale items have permanent destination categories", () => {
  const expected = {
    "3024507052": "Тактичний одяг",
    "3024524537": "Тактичне спорядження та аксесуари",
    "3024609676": "Аксесуари для полювання",
    "3024616283": "Тактичне спорядження та аксесуары"
  };
  for (const [id, category] of Object.entries(expected)) {
    const product = products.find(item => item.id === id);
    assert.ok(product, "missing product " + id);
    assert.equal(product.category, category, "wrong category for " + id);
  }
});

test("category pages filter directly by product.category without duplicate remapping", () => {
  for (const page of pages) {
    assert.equal(page.html.includes("mappedCategory"), false, page.name + " still contains mappedCategory");
  }
});
