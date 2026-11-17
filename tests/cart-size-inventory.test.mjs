import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const worker=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
const catalog=readFileSync(new URL("../catalog.html",import.meta.url),"utf8");
const account=readFileSync(new URL("../account.html",import.meta.url),"utf8");

test("cart accepts sized product keys and quantity validation",()=>{
 assert.match(worker,/A-Za-z0-9\._-/);
 assert.match(worker,/Cart contains too many products/);
 assert.match(worker,/Invalid cart item/);
});
test("cart writes do not mutate inventory",()=>{
 const start=worker.indexOf('if (url.pathname === "/account/cart" && request.method === "PUT")');
 const end=worker.indexOf('if (url.pathname === "/auth/logout"',start);
 assert.ok(start>0&&end>start,"account cart handler must be found");
 const handler=worker.slice(start,end);
 assert.doesNotMatch(handler,/UPDATE\s+(?:products|inventory|catalog)|INSERT\s+INTO\s+(?:reservations|stock_movements)/i);
});
test("order intake persists a request without stock deduction",()=>{
 const start=worker.indexOf("async function handleCustomerOrder(");
 const end=worker.indexOf("\nexport default",start);
 assert.ok(start>0&&end>start);
 const handler=worker.slice(start,end);
 assert.match(handler,/INSERT INTO customer_orders/);
 assert.doesNotMatch(handler,/UPDATE\s+(?:products|inventory|catalog)|INSERT\s+INTO\s+(?:reservations|stock_movements)/i);
});
test("size is preserved in catalog, guest cart and account checkout",()=>{
 assert.match(catalog,/var cartKey=String\(id\)/);
 assert.match(catalog,/var key=cartKey/);
 assert.match(catalog,/sizeField\.value=select\.value/);
 assert.match(account,/id\.split\("~"\)\[0\]/);
 assert.match(account,/розмір/);
 assert.match(account,/guest\.forEach/);
});
