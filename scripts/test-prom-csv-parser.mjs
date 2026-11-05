import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source=fs.readFileSync("admin/admin.js","utf8");
const start=source.indexOf("function parsePromCSV(text){");
const end=source.indexOf("async function stagePromCSV(){",start);
assert.ok(start>=0&&end>start,"Prom CSV parser functions must exist");
const sandbox=vm.createContext({});
vm.runInContext(source.slice(start,end)+"\nglobalThis.promRowsFromCSV=promRowsFromCSV;",sandbox);

const csv=[
  '"Код_товару","Назва_позиції","Назва_позиції_укр","Опис","Опис_укр","Ціна","Валюта","Посилання_зображення","Наявність","Назва_групи","Продукт_на_сайті","Ідентифікатор_товару"',
  '"","Test pants","Тестові штани","<p>Russian description</p>","<p>Український опис</p>\n<p>Другий рядок</p>","4 300","UAH","https://images.prom.ua/one.jpg;https://images.prom.ua/two.jpg","В наличии","Мисливські штани","https://allacontactical.prom.ua/p1234567890-test.html","1234567890"'
].join("\n");
const result=sandbox.promRowsFromCSV(csv);
assert.equal(result.items.length,1);
assert.equal(result.skipped,0);
assert.equal(result.items[0].source_product_id,"1234567890");
assert.equal(result.items[0].title,"Тестові штани");
assert.equal(result.items[0].price,4300);
assert.equal(result.items[0].images.length,2);
assert.equal(result.items[0].description,"Український опис\n\nДругий рядок");
assert.equal(result.items[0].description_ru,"Russian description");
console.log("Prom CSV parser smoke test passed.");
