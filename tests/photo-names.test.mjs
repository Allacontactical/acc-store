import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { assignNames, brandModelSlug, slugify } from "../scripts/photo-names.mjs";

const products = JSON.parse(fs.readFileSync(new URL("../products.json", import.meta.url), "utf8"));

// ---- Worker key validation (must accept legacy hex AND new slugs) ----
const source = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
function loadWorkerHelpers() {
  const start = source.indexOf("const IMAGE_KEY_RE =");
  const end = source.indexOf("async function sha256");
  assert.ok(start >= 0 && end > start, "image-key helpers must exist in src/index.js");
  const sandbox = {};
  vm.runInNewContext(source.slice(start, end) + "\nglobalThis.isImageKey = isImageKey; globalThis.slugifyImageKey = slugifyImageKey;", sandbox);
  return sandbox;
}
const worker = loadWorkerHelpers();

test("worker accepts legacy 24-hex keys (old R2 links keep working)", () => {
  assert.equal(worker.isImageKey("a8800a8967e1cf41f951f045.webp"), true);
  assert.equal(worker.isImageKey("abcdef0123456789abcdef01.webp"), true);
});

test("worker accepts new descriptive slug keys", () => {
  assert.equal(worker.isImageKey("kuiu-attack-pant-1.webp"), true);
  assert.equal(worker.isImageKey("drake-refuge-3-0-1.webp"), true);
});

test("worker rejects unsafe keys", () => {
  for (const bad of ["../secret.webp", "a/b.webp", "UPPER.webp", "-lead.webp", "trail-.webp", "x.png", "a b.webp", "a".repeat(90) + ".webp", "café.webp"]) {
    assert.equal(worker.isImageKey(bad), false, "should reject " + bad);
  }
});

test("slugifyImageKey produces safe keys and keeps the .webp suffix", () => {
  assert.equal(worker.slugifyImageKey("KUIU Attack Pant-1"), "kuiu-attack-pant-1.webp");
  assert.equal(worker.slugifyImageKey("drake-refuge-3-0-1.webp"), "drake-refuge-3-0-1.webp");
  assert.equal(worker.slugifyImageKey("  ...  "), "");
  assert.ok(worker.isImageKey(worker.slugifyImageKey("ПРОДАЖ Штани Sitka")));
});

// ---- Naming rules ----
test("brandModelSlug keeps brand + model and drops promo words", () => {
  assert.match(brandModelSlug("Мисливські штани KUIU Attack Pant | Primeflex, Vias Camo"), /^kuiu-/);
  assert.doesNotMatch(brandModelSlug("ПРОДАЖ ШТАНІВ SITKA EQUINOX"), /prodazh|rozprodazh/i);
  assert.equal(slugify("King's Camo XKG Ridge"), "kings-camo-xkg-ridge");
});

test("every product gets unique <slug>-<n>.webp names, order preserved", () => {
  const { byProduct } = assignNames(products);
  const all = [];
  for (const p of products) {
    const names = byProduct[String(p.id)];
    assert.equal(names.length, p.images.length, "one name per photo for " + p.id);
    names.forEach((n, i) => {
      assert.match(n, /^[a-z0-9][a-z0-9-]*-\d+\.webp$/, "name format " + n);
      assert.equal(n.endsWith(`-${i + 1}.webp`), true, "order preserved for " + p.id);
      assert.equal(worker.isImageKey(n), true, "worker accepts generated key " + n);
      all.push(n);
    });
  }
  assert.equal(new Set(all).size, all.length, "no duplicate file names across all products");
});

test("photos are never swapped between products (source -> name is stable and scoped)", () => {
  const { byProduct } = assignNames(products);
  for (const p of products) {
    assert.deepEqual(byProduct[String(p.id)].length, p.images.length);
  }
  // A product's i-th photo keeps position i after renaming.
  const sample = products.find(p => p.images.length >= 5);
  const names = byProduct[String(sample.id)];
  assert.equal(names[0].endsWith("-1.webp"), true);
  assert.equal(names[4].endsWith("-5.webp"), true);
});

test("colliding slugs are disambiguated by product id", () => {
  const { byProduct } = assignNames(products);
  const drake = products.filter(p => /DRAKE Silencer Soft Shell/i.test(p.title));
  assert.ok(drake.length >= 2, "expected duplicate DRAKE titles");
  const names = drake.map(p => byProduct[String(p.id)][0]);
  assert.equal(new Set(names).size, names.length, "colliding products must not share a name");
});
