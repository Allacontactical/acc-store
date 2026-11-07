import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const adminSource=fs.readFileSync("admin/admin.js","utf8");
const parserStart=adminSource.indexOf("function parsePromCSV(text){");
const parserEnd=adminSource.indexOf("async function stagePromCSV(){",parserStart);
assert.ok(parserStart>=0&&parserEnd>parserStart,"Prom CSV parser functions must exist");
const parserSandbox=vm.createContext({});
vm.runInContext(adminSource.slice(parserStart,parserEnd)+"\nglobalThis.parsePromCSV=parsePromCSV;globalThis.promRowsFromCSV=promRowsFromCSV;",parserSandbox);

const csv=[
  '"Код_товару","Назва_позиції","Назва_позиції_укр","Опис","Опис_укр","Ціна","Валюта","Посилання_зображення","Наявність","Назва_групи","Продукт_на_сайті","Ідентифікатор_товару"',
  '"","Test pants","Тестові штани","<p>Russian description</p>","<p>Український опис</p>\n<p>Другий рядок</p>","4 300","UAH","https://images.prom.ua/one.jpg;https://images.prom.ua/two.jpg","В наличии","Мисливські штани","https://allacontactical.prom.ua/p1234567890-test.html","1234567890"'
].join("\n");
const result=parserSandbox.promRowsFromCSV(csv);
assert.equal(result.items.length,1);
assert.equal(result.skipped,0);
assert.equal(result.items[0].source_product_id,"1234567890");
assert.equal(result.items[0].title,"Тестові штани");
assert.equal(result.items[0].price,4300);
assert.equal(result.items[0].images.length,2);
assert.equal(result.items[0].description,"Український опис\n\nДругий рядок");
assert.equal(result.items[0].description_ru,"Russian description");

const semicolon='Назва_позиції_укр;Ідентифікатор_товару;Ціна\n"Штани; утеплені";1234567890;4300';
const semicolonRows=parserSandbox.parsePromCSV(semicolon);
assert.equal(semicolonRows[1][0],"Штани; утеплені");
assert.equal(semicolonRows[1][1],"1234567890");

const escaped='"Назва","Опис"\n"Куртка","Модель ""зима""\nдруга лінія"';
const escapedRows=parserSandbox.parsePromCSV(escaped);
assert.equal(escapedRows[1][1],'Модель "зима"\nдруга лінія');
assert.throws(()=>parserSandbox.parsePromCSV('"A","B"\n"1","незакрито'),/незакриті лапки/);
assert.throws(()=>parserSandbox.parsePromCSV('"A","B"\n"1"x,"2"'),/зайві символи|Некоректні лапки/);

const apiSource=fs.readFileSync("admin-api/src/index.js","utf8");
const helperStart=apiSource.indexOf("function isValidPromSourceId(value) {");
const helperEnd=apiSource.indexOf("\n}",helperStart)+2;
assert.ok(helperStart>=0&&helperEnd>helperStart,"Server Prom ID validator must exist");
const apiSandbox=vm.createContext({});
vm.runInContext(apiSource.slice(helperStart,helperEnd)+"\nglobalThis.isValidPromSourceId=isValidPromSourceId;",apiSandbox);
assert.equal(apiSandbox.isValidPromSourceId("1234567890"),true);
assert.equal(apiSandbox.isValidPromSourceId("1"),true);
assert.equal(apiSandbox.isValidPromSourceId("abc123"),false);
assert.equal(apiSandbox.isValidPromSourceId("123456789012345678901"),false);

console.log("Prom CSV/XLSX-import parser and server ID validation tests passed.");
