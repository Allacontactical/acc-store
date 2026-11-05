(function(){
"use strict";
var KEY="accCart",products=[],header=document.querySelector("header .nav, header .wrap, header");
if(!header)return;
function read(){try{var v=JSON.parse(localStorage.getItem(KEY)||"[]");return Array.isArray(v)?v.map(String):[];}catch(e){return [];}}
function write(ids){localStorage.setItem(KEY,JSON.stringify(ids));update();}
function update(){var n=read().length;var b=document.getElementById("accSharedCartButton");if(b)b.textContent="Кошик ("+n+")";}
var button=document.createElement("button");button.type="button";button.id="accSharedCartButton";button.className="header-tool";button.style.cssText="border:1px solid #69715f;background:transparent;color:inherit;padding:8px 12px;border-radius:4px;cursor:pointer;font:inherit";button.addEventListener("click",openCart);header.appendChild(button);
var modal=document.createElement("div");modal.id="accSharedCartModal";modal.style.cssText="display:none;position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.78);padding:18px;align-items:center;justify-content:center";
modal.innerHTML='<section role="dialog" aria-modal="true" aria-labelledby="accSharedCartTitle" style="width:min(560px,100%);max-height:90vh;overflow:auto;background:#23291f;color:#f4f2eb;border:1px solid #69715f;border-radius:8px;padding:20px"><button type="button" id="accSharedCartClose" style="float:right">Закрити</button><h2 id="accSharedCartTitle">Ваш кошик</h2><div id="accSharedCartItems"></div><p id="accSharedCartTotal"></p><a id="accSharedCartSend" href="#" target="_blank" rel="noopener" style="display:inline-block;padding:11px 15px;background:#f28c28;color:#171b16;font-weight:bold;border-radius:4px">Надіслати список у Telegram</a></section>';
document.body.appendChild(modal);
function close(){modal.style.display="none";}
function openCart(){renderCart();modal.style.display="flex";}
document.getElementById("accSharedCartClose").addEventListener("click",close);modal.addEventListener("click",function(e){if(e.target===modal)close();});
function renderCart(){var box=document.getElementById("accSharedCartItems"),total=0,lines=[];box.textContent="";var ids=read();if(!ids.length){box.textContent="Кошик поки порожній.";document.getElementById("accSharedCartTotal").textContent="";document.getElementById("accSharedCartSend").style.display="none";return;}
ids.forEach(function(id){var p=products.find(function(x){return String(x.id)===id;});if(!p)return;var row=document.createElement("div");row.style.cssText="padding:10px 0;border-bottom:1px solid #46503d";var title=document.createElement("strong");title.textContent=p.title||("Товар "+id);row.appendChild(title);var price=Number(p.price);var detail=document.createElement("p");detail.textContent=Number.isFinite(price)?new Intl.NumberFormat("uk-UA").format(price)+" грн":"Ціну уточнюйте";row.appendChild(detail);var remove=document.createElement("button");remove.type="button";remove.textContent="Видалити";remove.addEventListener("click",function(){write(read().filter(function(x){return x!==id;}));renderCart();});row.appendChild(remove);box.appendChild(row);lines.push((p.title||id)+" — "+(Number.isFinite(price)?price+" грн":"ціну уточнити"));if(Number.isFinite(price))total+=price;});
document.getElementById("accSharedCartTotal").textContent=total?("Разом: "+new Intl.NumberFormat("uk-UA").format(total)+" грн"):"Підсумкову вартість підтвердить фахівець";
var msg="Вітаю! Хочу уточнити наявність товарів:\n"+lines.join("\n");document.getElementById("accSharedCartSend").href="https://t.me/Allacontactical_bot?text="+encodeURIComponent(msg);document.getElementById("accSharedCartSend").style.display="inline-block";}
document.addEventListener("click",function(e){var add=e.target.closest("[data-cart-id]");if(!add)return;var id=String(add.getAttribute("data-cart-id"));var ids=read();if(ids.indexOf(id)===-1)ids.push(id);write(ids);var old=add.textContent;add.textContent="Додано";setTimeout(function(){add.textContent=old;},1200);});
window.addEventListener("storage",update);
fetch("./products.json").then(function(r){if(!r.ok)throw new Error("products unavailable");return r.json();}).then(function(data){products=Array.isArray(data)?data:[];update();}).catch(update);
update();
})();