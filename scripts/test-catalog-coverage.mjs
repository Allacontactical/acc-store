import fs from "node:fs";
import vm from "node:vm";

const products = JSON.parse(fs.readFileSync("test-site/products.json", "utf8"));
if (!Array.isArray(products) || products.length === 0) throw new Error("products.json must be a non-empty array");

const ids = products.map(p => String(p.id));
if (ids.some(id => !/^\\d{1,20}$/.test(id))) throw new Error("Every product must have a numeric ID");
if (new Set(ids).size !== ids.length) throw new Error("Duplicate product IDs found");

const pages = [
  "hunting-clothing.html",
  "hunting-footwear.html",
  "hunting-headwear.html",
  "hunting-accessories.html",
  "tactical-gear.html",
  "fishing-gear.html"
];

const groups = [];
for (const file of pages) {
  const html = fs.readFileSync(`test-site/${file}`, "utf8");
  const allowedMatch = html.match(/var allowedCategories\\s*=\\s*(\\[[^;]+\\]);/);
  const mapperMatch = html.match(/function mappedCategory\\(p\\)\\{[^\\n]*\\}/);
  if (!allowedMatch || !mapperMatch) throw new Error(`${file}: category configuration or mapper missing`);
  if (!html.includes('fetch("./products.json")')) throw new Error(`${file}: products.json fetch missing`);
  const allowed = JSON.parse(allowedMatch[1]);
  const mapper = vm.runInNewContext("(" + mapperMatch[0] + ")");
  const matched = products.filter(p => allowed.includes(mapper(p)));
  groups.push({ file, allowed, mapper, matched });
}

const missing = products.filter(p => !groups.some(g => g.allowed.includes(g.mapper(p))));
if (missing.length) {
  throw new Error("Products not assigned to any visible group: " + missing.map(p => `${p.id} ${p.title} [${p.category}]`).join("; "));
}

const account = fs.readFileSync("test-site/account.html", "utf8");
const home = fs.readFileSync("test-site/index.html", "utf8");
const requiredAccountChecks = [
  ["/auth/start", "Telegram login start endpoint"],
  ["/auth/status", "Telegram login confirmation polling"],
  ["/account/me", "authenticated account profile"],
  ["/account/cart", "server-side cart API"],
  ["method:\"PUT\"", "cart persistence request"],
  ["Додати до кошика", "cabinet add-to-cart control"],
  ["writeCabinetCart(next)", "cabinet cart state update"],
  ["localStorage.setItem(KEY, result.session_token)", "session persistence"]
];
for (const [needle, label] of requiredAccountChecks) {
  if (!account.includes(needle)) throw new Error("Account flow missing: " + label);
}
for (const [needle, label] of [
  ["data-cart-id", "homepage product add-to-cart control"],
  ['fetch("/account/cart"', "homepage cart sync with account"],
  ['fetch("/account/cart"', "homepage account cart read"]
]) {
  if (!home.includes(needle)) throw new Error("Homepage cart flow missing: " + label);
}

console.log(`Catalog data valid: ${products.length} products; ${new Set(ids).size} unique IDs`);
for (const group of groups) console.log(`${group.file}: ${group.matched.length} products mapped`);
console.log("Coverage: every product appears in at least one category group");
console.log("Account checks: Telegram auth, profile, add-to-cart and server persistence code present");
console.log("Homepage checks: add-to-cart and account cart synchronization code present");
