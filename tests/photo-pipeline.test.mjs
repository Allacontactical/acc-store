import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { assignNames } from "../scripts/photo-names.mjs";

// ---- Load the Worker as an ES module inside a vm sandbox (no package.json needed) ----
const source = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8")
  .replace("export default {", "globalThis.__worker = {");

function loadWorker(fetchImpl) {
  const sandbox = {
    Request, Response, Headers, URL, URLSearchParams, TextEncoder, TextDecoder,
    crypto, AbortSignal, FormData, Blob, console, fetch: fetchImpl
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.__worker;
}

class FakeR2 {
  constructor() { this.store = new Map(); this.puts = 0; this.deletes = 0; }
  async put(key, body, opts) { this.puts++; this.store.set(key, { body, httpMetadata: opts?.httpMetadata, customMetadata: opts?.customMetadata, httpEtag: '"e"' }); }
  async head(key) { return this.store.has(key) ? this.store.get(key) : null; }
  async get(key) {
    const o = this.store.get(key);
    if (!o) return null;
    const body = o.body;
    return { body, httpMetadata: o.httpMetadata, httpEtag: o.httpEtag,
      arrayBuffer: async () => body instanceof ArrayBuffer ? body : body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
  }
  async delete(keys) { this.deletes++; for (const k of [].concat(keys)) this.store.delete(k); }
}

// Minimal valid-looking WebP bytes: RIFF....WEBP
function webpBytes() {
  const head = new TextEncoder().encode("RIFF");
  const size = new Uint8Array([0x1a, 0, 0, 0]);
  const webp = new TextEncoder().encode("WEBP");
  const tail = new Uint8Array(24);
  const out = new Uint8Array(head.length + 4 + webp.length + tail.length);
  out.set(head, 0); out.set(size, 4); out.set(webp, 8); out.set(tail, 12);
  return out;
}

const TOKEN = "test-token";
const env = () => ({ PRODUCT_IMAGES: new FakeR2(), ACC_CONTENTS_TOKEN: TOKEN });
const BASE = "https://allacontactical-bot.allacontactical.workers.dev";

function stubFetch() {
  return async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://images.prom.ua/")) {
      return new Response(webpBytes(), { status: 200, headers: { "Content-Type": "image/webp" } });
    }
    return new Response("unexpected fetch: " + url, { status: 500 });
  };
}

test("conversion stores a descriptive name and serves it with image/webp", async () => {
  const worker = loadWorker(stubFetch());
  const e = env();
  const res = await worker.fetch(new Request(BASE + "/internal/photo-pipeline", {
    method: "POST",
    headers: { "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ source: "https://images.prom.ua/1_a.jpg", name: "kuiu-attack-pant-1" }] })
  }), e);
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.images.length, 1);
  assert.equal(data.images[0].key, "kuiu-attack-pant-1.webp");
  assert.equal(data.images[0].reused, false);

  const get = await worker.fetch(new Request(BASE + "/product-images/kuiu-attack-pant-1.webp"), e);
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("Content-Type"), "image/webp");

  const head = await worker.fetch(new Request(BASE + "/product-images/kuiu-attack-pant-1.webp", { method: "HEAD" }), e);
  assert.equal(head.status, 200);
});

test("re-running the conversion is idempotent (no duplicate R2 objects)", async () => {
  const worker = loadWorker(stubFetch());
  const e = env();
  const call = () => worker.fetch(new Request(BASE + "/internal/photo-pipeline", {
    method: "POST",
    headers: { "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ source: "https://images.prom.ua/1_a.jpg", name: "drake-refuge-3-0-1" }] })
  }), e);
  const first = await (await call()).json();
  const putsAfterFirst = e.PRODUCT_IMAGES.puts;
  const second = await (await call()).json();
  assert.equal(second.images[0].key, first.images[0].key);
  assert.equal(second.images[0].reused, true);
  assert.equal(e.PRODUCT_IMAGES.puts, putsAfterFirst, "second run must not write a new object");
  assert.equal(e.PRODUCT_IMAGES.store.size, 1, "exactly one object in R2");
});

test("legacy 24-hex keys still resolve (old links keep working)", async () => {
  const worker = loadWorker(stubFetch());
  const e = env();
  await e.PRODUCT_IMAGES.put("a8800a8967e1cf41f951f045.webp", webpBytes(), { httpMetadata: { contentType: "image/webp" } });
  const res = await worker.fetch(new Request(BASE + "/product-images/a8800a8967e1cf41f951f045.webp"), e);
  assert.equal(res.status, 200);
});

test("unsafe or unknown keys return 404", async () => {
  const worker = loadWorker(stubFetch());
  const e = env();
  for (const key of ["../secret.webp", "UPPER.webp", "missing.webp"]) {
    const res = await worker.fetch(new Request(BASE + "/product-images/" + key), e);
    assert.equal(res.status, 404, key);
  }
});

test("photo already in R2 is copied to its new name without deleting the original", async () => {
  const worker = loadWorker(stubFetch());
  const e = env();
  await e.PRODUCT_IMAGES.put("a8800a8967e1cf41f951f045.webp", webpBytes(), { httpMetadata: { contentType: "image/webp" } });
  const res = await worker.fetch(new Request(BASE + "/internal/photo-pipeline", {
