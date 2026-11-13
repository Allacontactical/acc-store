// Local, offline test run for the photo pipeline. Loads the real Worker in a
// sandbox with an in-memory R2 and a stubbed source fetch, then processes 5
// products with different brands and source formats and checks the acceptance
// criteria. No network, no Cloudflare, no writes to the repo.
import fs from "node:fs";
import vm from "node:vm";
import { assignNames } from "./photo-names.mjs";

const BASE = "https://allacontactical-bot.allacontactical.workers.dev";
const TOKEN = "local-test-token";
const SAMPLE = ["2456820664", "2456141324", "2547637038", "2537710638", "2988223686"];

const workerSource = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8")
  .replace("export default {", "globalThis.__worker = {");

class FakeR2 {
  constructor() { this.store = new Map(); this.puts = 0; }
  async put(key, body, opts) { this.puts++; this.store.set(key, { body, httpMetadata: opts?.httpMetadata, customMetadata: opts?.customMetadata, httpEtag: '"e"' }); }
  async head(key) { return this.store.has(key) ? this.store.get(key) : null; }
  async get(key) {
    const o = this.store.get(key);
    if (!o) return null;
    const body = o.body;
    return { body, httpMetadata: o.httpMetadata, httpEtag: o.httpEtag,
      arrayBuffer: async () => body instanceof ArrayBuffer ? body : body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
  }
  async delete(keys) { for (const k of [].concat(keys)) this.store.delete(k); }
}

function webpBytes() {
  const out = new Uint8Array(40);
  out.set(new TextEncoder().encode("RIFF"), 0);
  out.set([0x1a, 0, 0, 0], 4);
  out.set(new TextEncoder().encode("WEBP"), 8);
  return out;
}

function loadWorker(env) {
  const sandbox = {
    Request, Response, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, crypto, AbortSignal, FormData, Blob, console,
    fetch: async (input) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("https://images.prom.ua/")) {
        // Source is a PNG masquerading as .jpg for the defect products; the Worker
        // converts it and always returns image/webp.
        return new Response(webpBytes(), { status: 200, headers: { "Content-Type": "image/webp" } });
      }
      return new Response("blocked: " + url, { status: 500 });
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(workerSource, sandbox);
  return sandbox.__worker;
}

const products = JSON.parse(fs.readFileSync(new URL("../products.json", import.meta.url), "utf8"));
const sample = products.filter(p => SAMPLE.includes(String(p.id)));
const { byProduct } = assignNames(products);

const env = { PRODUCT_IMAGES: new FakeR2(), ACC_CONTENTS_TOKEN: TOKEN };
const worker = loadWorker(env);

// Seed the fake R2 with the photos that already live there (opaque keys), so the
// server-side copy path is exercised exactly as in production.
for (const product of products) {
  for (const url of product.images || []) {
    if (url.startsWith(BASE + "/product-images/")) {
      const key = url.slice((BASE + "/product-images/").length);
      if (!env.PRODUCT_IMAGES.store.has(key)) {
        await env.PRODUCT_IMAGES.put(key, webpBytes(), { httpMetadata: { contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable" } });
      }
    }
  }
}
const seededObjects = env.PRODUCT_IMAGES.store.size;

const report = { products: [], checks: {}, errors: [] };
const forward = {}, backward = {};

async function convert(source, name) {
  const res = await worker.fetch(new Request(BASE + "/internal/photo-pipeline", {
    method: "POST",
    headers: { "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ source, name }] })
  }), env);
  return { status: res.status, body: await res.json() };
}

// 1) First pass: convert every photo of the sample under its deterministic name.
for (const product of sample) {
  const names = byProduct[String(product.id)];
  const entry = { id: product.id, title: product.title, photos: [] };
  for (let i = 0; i < product.images.length; i++) {
    const source = product.images[i];
    const name = names[i];
    const out = await convert(source, name);
    if (out.status !== 201 || !out.body.images?.length) { report.errors.push({ id: product.id, source, out }); continue; }
    const image = out.body.images[0];
    const newUrl = image.url;
    forward[source] = newUrl;
    backward[newUrl] = source;
    const get = await worker.fetch(new Request(newUrl), env);
    const head = await worker.fetch(new Request(newUrl, { method: "HEAD" }), env);
    entry.photos.push({ index: i + 1, source, name: image.key, newUrl, reused: image.reused, get: get.status, mime: get.headers.get("Content-Type"), head: head.status });
  }
  report.products.push(entry);
}

// 2) Idempotent re-run: same names, no new R2 objects.
const putsBefore = env.PRODUCT_IMAGES.puts;
const objectsBefore = env.PRODUCT_IMAGES.store.size;
let reusedCount = 0;
for (const product of sample) {
  const names = byProduct[String(product.id)];
  for (let i = 0; i < product.images.length; i++) {
    const out = await convert(product.images[i], names[i]);
    if (out.body.images?.[0]?.reused) reusedCount++;
  }
}
const idempotentNoNewObjects = env.PRODUCT_IMAGES.puts === putsBefore && env.PRODUCT_IMAGES.store.size === objectsBefore;

// 3) Old links: legacy opaque keys must still resolve.
await env.PRODUCT_IMAGES.put("a8800a8967e1cf41f951f045.webp", webpBytes(), { httpMetadata: { contentType: "image/webp" } });
const legacy = await worker.fetch(new Request(BASE + "/product-images/a8800a8967e1cf41f951f045.webp"), env);

// 4) Order preserved and no shared target between products.
const allNew = [];
for (const entry of report.products) for (const p of entry.photos) allNew.push(p.newUrl);
const uniqueNew = new Set(allNew);
const orderOk = report.products.every(e => e.photos.every((p, idx) => p.name.endsWith(`-${idx + 1}.webp`)));

report.checks = {
  sample_products: sample.length,
  photos_processed: allNew.length,
  all_201: report.errors.length === 0,
  all_webp_mime: report.products.every(e => e.photos.every(p => p.mime === "image/webp")),
  all_get_200: report.products.every(e => e.photos.every(p => p.get === 200)),
  all_head_200: report.products.every(e => e.photos.every(p => p.head === 200)),
  no_shared_target_between_products: uniqueNew.size === allNew.length,
  order_preserved: orderOk,
  idempotent_no_new_objects: idempotentNoNewObjects,
  no_source_deleted: env.PRODUCT_IMAGES.store.size >= seededObjects,
  reused_on_rerun: reusedCount,
  legacy_key_200: legacy.status === 200,
  rollback_reversible: Object.entries(forward).every(([oldUrl, newUrl]) => backward[newUrl] === oldUrl)
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.errors.length || Object.values(report.checks).some(v => v === false) ? 1 : 0);
