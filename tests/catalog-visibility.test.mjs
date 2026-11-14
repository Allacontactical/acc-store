import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const { default: worker } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
const route = "https://allacontactical-bot.allacontactical.workers.dev/admin/catalog/visibility";
const session = "a".repeat(64);

test("admins can hide and restore a catalog card without losing its data or concurrent updates", async (t) => {
  const product = { id: "9000000000000287", title: "Мисливська куртка", images: ["original.webp"] };
  let products = [product, { id: "2700", title: "Інший товар" }];
  let conflict = true;
  let writes = 0;
  const snapshots = new Map();
  const snapshot = () => {
    const body = JSON.stringify(products);
    const sha = createHash("sha1").update(body).digest("hex");
    snapshots.set(sha, body);
    return sha;
  };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer github-test");
    if (url.endsWith("?ref=main")) return Response.json({ sha: snapshot() });
    if (url.includes("/git/blobs/")) {
      assert.equal(options.headers.Accept, "application/vnd.github.raw+json");
      return new Response(snapshots.get(url.split("/").pop()));
    }
    assert.match(url, /\/contents\/products\.json$/);
    assert.equal(options.method, "PUT");
    writes++;
    const body = JSON.parse(options.body);
    assert.equal(body.branch, "main");
    assert.equal(body.sha, snapshot());
    if (conflict) {
      conflict = false;
      products[1].title = "Паралельне оновлення";
      return new Response(null, { status: 409 });
    }
    products = JSON.parse(Buffer.from(body.content, "base64").toString("utf8"));
    return Response.json({});
  });

  const env = {
    ADMIN_TELEGRAM_ID: "100",
    ACC_CONTENTS_TOKEN: "github-test",
    DB: { prepare: () => ({ bind: () => ({ first: async () => ({ id: 1, telegram_user_id: "100" }) }) }) }
  };
  const headers = { Authorization: "Bearer " + session, "Content-Type": "application/json" };
  const setHidden = (id, hidden) =>
    worker.fetch(new Request(route, { method: "PUT", headers, body: JSON.stringify({ id, hidden }) }), env);

  assert.equal((await worker.fetch(new Request(route), env)).status, 403);
  assert.equal((await setHidden("2700", "true")).status, 400);
  assert.equal((await setHidden("123", true)).status, 404);
  assert.equal(writes, 0);
  assert.deepEqual(await (await setHidden(product.id, true)).json(), { id: product.id, hidden: true });
  assert.deepEqual(products[0], { ...product, hidden: true });
  assert.equal(products[1].title, "Паралельне оновлення");
  await setHidden(product.id, true);
  assert.equal(writes, 2);

  const listing = await worker.fetch(new Request(route, { headers }), env);
  assert.deepEqual((await listing.json()).products[0], { id: product.id, title: product.title, hidden: true });
  assert.deepEqual(await (await setHidden(product.id, false)).json(), { id: product.id, hidden: false });
  assert.deepEqual(products[0], product);
  assert.equal(products.length, 2);
});
