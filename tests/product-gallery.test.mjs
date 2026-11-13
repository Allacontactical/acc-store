import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Minimal DOM shim: enough for product-gallery.js (createElement, appendChild,
// textContent, classList, addEventListener, setAttribute, style).
class FakeClassList {
  constructor() { this.set = new Set(); }
  add(c) { this.set.add(c); }
  remove(c) { this.set.delete(c); }
  contains(c) { return this.set.has(c); }
}
class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.childNodes = [];
    this.children = this.childNodes;
    this.style = {};
    this.classList = new FakeClassList();
    this.attributes = {};
    this.listeners = {};
    this._text = "";
  }
  set textContent(value) { this._text = String(value); if (value === "") this.childNodes.length = 0; }
  get textContent() { return this._text; }
  appendChild(node) { node.parentNode = this; this.childNodes.push(node); return node; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
}
const doc = { createElement: tag => new FakeElement(tag) };

const source = fs.readFileSync(new URL("../product-gallery.js", import.meta.url), "utf8");
const sandbox = { document: doc, window: {} };
vm.runInNewContext(source, sandbox);
const G = sandbox.window.ACCProductImages;

function walk(node, tag, out = []) {
  if (node.tagName === tag) out.push(node);
  for (const child of node.childNodes) walk(child, tag, out);
  return out;
}

const product = {
  title: "Мисливські штани KUIU Kutana Storm Shell",
  image: "https://x/a.webp",
  images: ["https://x/a.webp", "https://x/b.webp", "https://x/c.webp"]
};

test("renders every photo from images[], not only the first", () => {
  const wrap = doc.createElement("div");
  G.renderInto(wrap, product);
  const imgs = walk(wrap, "img");
  assert.equal(imgs.length, 4, "1 main + 3 thumbnails");
  assert.equal(imgs[0].src, "https://x/a.webp");
});

test("every photo gets a unique ALT and TITLE with brand + product + number", () => {
  const wrap = doc.createElement("div");
  G.renderInto(wrap, product);
  const imgs = walk(wrap, "img");
  // Main image and its own thumbnail represent the same photo, so they share ALT.
  const thumbs = imgs.slice(1);
  const thumbAlts = thumbs.map(i => i.alt);
  assert.equal(new Set(thumbAlts).size, thumbAlts.length, "ALT must be unique per distinct photo");
  assert.equal(imgs[0].alt, thumbs[0].alt, "main and its thumbnail describe the same photo");
  assert.match(imgs[0].alt, /KUIU Kutana Storm Shell/);
  assert.match(imgs[0].alt, /фото 1 з 3/);
  assert.match(thumbs[2].alt, /фото 3 з 3/);
  assert.ok(imgs.every(i => i.title && i.title.length > 0), "TITLE present on every photo");
});

test("main image carries explicit width/height (CLS hint)", () => {
  const wrap = doc.createElement("div");
  G.renderInto(wrap, product);
  const main = walk(wrap, "img")[0];
  assert.equal(main.width, 600);
  assert.equal(main.height, 600);
  assert.equal(main.loading, "lazy");
  assert.equal(main.decoding, "async");
});

test("single-photo product renders one image and no thumbnail strip", () => {
  const wrap = doc.createElement("div");
  G.renderInto(wrap, { title: "Товар", image: "https://x/only.webp", images: ["https://x/only.webp"] });
  assert.equal(walk(wrap, "img").length, 1);
  assert.equal(wrap.childNodes.length, 1, "no thumbnail container added");
  assert.equal(wrap.childNodes[0].tagName, "img");
});

test("photo with no images hides the wrapper (graceful)", () => {
  const wrap = doc.createElement("div");
  G.renderInto(wrap, { title: "Товар", images: [] });
  assert.equal(wrap.style.display, "none");
});

test("altFor keeps the AllaconTactical brand suffix", () => {
  assert.match(G.altFor(product, 0, 3), /\| AllaconTactical$/);
});