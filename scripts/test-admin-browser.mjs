import { chromium } from "playwright";
import XLSX from "xlsx";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../admin");
const fixtureRows = [
  ["Ідентифікатор_товару","Назва_позиції_укр","Ціна","Валюта","Назва_групи","Опис_укр","Опис","Посилання_зображення","Продукт_на_сайті","Кількість","Наявність"],
  ["1234567890","Тестовий товар ACC 1","1250","UAH","Одяг","Опис українською","Описание","https://images.example/1.webp;https://images.example/2.webp","https://prom.ua/p1234567890-test.html","3","+"],
  ["1234567891","Тестовий товар ACC 2","2200","UAH","Взуття","Другий опис","Второе описание","https://images.example/3.webp","https://prom.ua/p1234567891-test.html","","14"]
];
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(fixtureRows), "Products");
const xlsxBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

let pending = [];
let stagedPayload = null;
let approved = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname.startsWith("/admin/")) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/admin/products") {
      res.end(JSON.stringify({ products: [{ id: 1, title: "Тестовий товар у каталозі", status: "active", price: 500, legacy_images: [], images: [] }] }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/admin/imports/pending") {
      res.end(JSON.stringify({ items: pending }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/admin/imports/prom") {
      let body = "";
      for await (const chunk of req) body += chunk;
      stagedPayload = JSON.parse(body);
      pending = stagedPayload.items.map((item, i) => ({
        id: "review-" + i,
        title: item.title,
        source_product_id: item.source_product_id,
        existing_product_id: null,
        payload: item
      }));
      res.end(JSON.stringify({ staged: pending.length, matched_existing: 0, new_products: pending.length }));
      return;
    }
    const reviewMatch = url.pathname.match(/^\/admin\/imports\/items\/([^/]+)\/(approve|reject)$/);
    if (req.method === "POST" && reviewMatch) {
      const [_, id, decision] = reviewMatch;
      if (decision === "approve") approved.push(id);
      pending = pending.filter(item => item.id !== id);
      res.end(JSON.stringify({ success: true }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Mock endpoint not found: " + url.pathname }));
    return;
  }

  if (url.pathname === "/xlsx.full.min.js") {
    const xlsxPath = path.join(path.dirname(path.dirname(import.meta.dirname || path.dirname(fileURLToPath(import.meta.url)))), "node_modules/xlsx/dist/xlsx.full.min.js");
    const fallback = path.resolve("node_modules/xlsx/dist/xlsx.full.min.js");
    res.setHeader("Content-Type", "text/javascript");
    res.end(fs.readFileSync(fs.existsSync(xlsxPath) ? xlsxPath : fallback));
    return;
  }

  const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const filePath = path.resolve(root, relative);
  if (!filePath.startsWith(root + path.sep) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.statusCode = 404; res.end("Not found"); return;
  }
  const ext = path.extname(filePath);
  res.setHeader("Content-Type", ({".html":"text/html",".js":"text/javascript",".css":"text/css"}[ext] || "application/octet-stream"));
  fs.createReadStream(filePath).pipe(res);
});
await new Promise(resolve => server.listen(4173, "127.0.0.1", resolve));

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js", route => route.fulfill({ path: path.resolve("node_modules/xlsx/dist/xlsx.full.min.js"), contentType: "text/javascript" }));
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
  await page.locator("#promFile").setInputFiles({ name: "acc-test.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: xlsxBuffer });
  await page.locator("#stagePromImport").click();
  await page.getByText("Готово: у чергу додано 2 товарів", { exact: false }).waitFor({ timeout: 10000 });
  if (stagedPayload?.items?.length !== 2) throw new Error("Очікували 2 товари у запиті імпорту.");
  const first = stagedPayload.items[0], second = stagedPayload.items[1];
  if (first.quantity !== 3 || first.availability !== "+" || first.images.length !== 2) throw new Error("Перший товар: неправильно розібрані кількість/наявність/фото.");
  if (second.quantity !== null || second.delivery_days !== 14) throw new Error("Другий товар: неправильно розібрані порожня кількість або строк постачання.");
  await page.getByText("Тестовий товар ACC 1").waitFor();
  await page.getByText("Кількість: 3", { exact: false }).waitFor();
  await page.getByText("Кількість не вказана", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Підтвердити" }).first().click();
  await page.getByText("Імпортований товар підтверджено.", { exact: false }).waitFor();
  if (approved.length !== 1 || pending.length !== 1) throw new Error("Дія підтвердження не оброблена тестовим API.");
  console.log("PASS: XLSX upload, 2 product rows, photos, quantity, delivery days, review queue and approve action.");
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
