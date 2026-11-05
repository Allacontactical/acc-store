(() => {
  "use strict";
  const KEY = "accCart";
  const API_PRODUCTS = "./products.json";
  let products = [];
  const readCart = () => {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(value) ? value.map(String) : [];
    } catch (_) { return []; }
  };
  const saveCart = cart => {
    try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch (_) {}
    updateCount();
    render();
  };
  const updateCount = () => {
    const count = document.getElementById("accSharedCartCount");
    if (count) count.textContent = String(readCart().length);
  };
  const money = value => {
    const n = Number(value);
    return Number.isFinite(n) ? new Intl.NumberFormat("uk-UA", {maximumFractionDigits:0}).format(n) + " грн" : "Ціну уточнюйте";
  };
  let modal, list, total, checkout;
  function ensureUi() {
    const header = document.querySelector("header");
    if (header && !document.getElementById("accSharedCartButton")) {
      const button = document.createElement("button");
      button.id = "accSharedCartButton";
      button.type = "button";
      button.textContent = "Кошик · ";
      button.style.cssText = "margin:10px;padding:10px 14px;border:1px solid #c9955b;background:#23291f;color:#f4f2eb;border-radius:4px;font-weight:700;cursor:pointer";
      const count = document.createElement("b");
      count.id = "accSharedCartCount";
      count.textContent = String(readCart().length);
      button.appendChild(count);
      button.addEventListener("click", () => { render(); modal.hidden = false; modal.setAttribute("aria-hidden","false"); });
      const nav = header.querySelector(".nav");
      (nav || header).appendChild(button);
    }
    modal = document.createElement("div");
    modal.id = "accSharedCartModal";
    modal.setAttribute("aria-hidden","true");
    modal.hidden = true;
    modal.style.cssText = "position:fixed;inset:0;z-index:2000;background:#000b;display:flex;align-items:center;justify-content:center;padding:16px";
    const panel = document.createElement("section");
    panel.setAttribute("role","dialog");
    panel.setAttribute("aria-modal","true");
    panel.setAttribute("aria-labelledby","accSharedCartTitle");
    panel.style.cssText = "width:min(560px,100%);max-height:85vh;overflow:auto;background:#20251d;color:#f4f2eb;border:1px solid #6b735d;border-radius:6px;padding:22px";
    const close = document.createElement("button");
    close.type = "button"; close.textContent = "Закрити ×";
    close.style.cssText = "float:right;padding:8px 12px;background:transparent;color:#f4f2eb;border:1px solid #69715f;cursor:pointer";
    close.addEventListener("click", closeModal);
    const heading = document.createElement("h2"); heading.id = "accSharedCartTitle"; heading.textContent = "Ваш кошик";
    list = document.createElement("div");
    total = document.createElement("p");
    checkout = document.createElement("a"); checkout.textContent = "Узгодити замовлення в Telegram";
    checkout.target = "_blank"; checkout.rel = "noopener";
    checkout.style.cssText = "display:inline-block;margin-top:14px;padding:12px 16px;background:#c17d3f;color:#171b16;text-decoration:none;font-weight:700";
    panel.append(close, heading, list, total, checkout);
    modal.appendChild(panel);
    modal.addEventListener("click", event => { if (event.target === modal) closeModal(); });
    document.addEventListener("keydown", event => { if (event.key === "Escape") closeModal(); });
    document.body.appendChild(modal);
    render();
  }
  function closeModal() { if (!modal) return; modal.hidden = true; modal.setAttribute("aria-hidden","true"); }
  function render() {
    if (!list) return;
    const cart = readCart();
    list.textContent = "";
    if (!cart.length) {
      const empty = document.createElement("p"); empty.textContent = "Кошик поки порожній."; list.appendChild(empty);
      total.textContent = "";
      checkout.href = "https://t.me/Allacontactical_bot";
      return;
    }
    const counts = new Map();
    cart.forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
    let sum = 0, hasAllPrices = true;
    counts.forEach((qty,id) => {
      const product = products.find(item => String(item.id) === id);
      const line = document.createElement("div");
      line.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 0;border-bottom:1px solid #3b4434";
      const info = document.createElement("span");
      info.textContent = (product ? product.title : "Товар") + " · " + qty + " шт.";
      const controls = document.createElement("span");
      const minus = document.createElement("button"); minus.type="button"; minus.textContent="−";
      const plus = document.createElement("button"); plus.type="button"; plus.textContent="+";
      const remove = document.createElement("button"); remove.type="button"; remove.textContent="×";
      [minus,plus,remove].forEach(b => { b.style.cssText="margin-left:5px;padding:5px 9px;cursor:pointer"; });
      minus.addEventListener("click", () => { const next=readCart(); const i=next.indexOf(id); if(i>=0)next.splice(i,1); saveCart(next); });
      plus.addEventListener("click", () => saveCart(readCart().concat(id)));
      remove.addEventListener("click", () => saveCart(readCart().filter(x => x !== id)));
      controls.append(minus,plus,remove);
      if (product && Number.isFinite(Number(product.price))) sum += Number(product.price) * qty; else hasAllPrices = false;
      line.append(info,controls); list.appendChild(line);
    });
    total.textContent = hasAllPrices ? "Разом: " + money(sum) : "Підсумкову вартість підтвердить фахівець.";
    const message = "Вітаю! Хочу уточнити наявність і замовити:\n" + Array.from(counts.entries()).map(([id,qty]) => {
      const p = products.find(item => String(item.id) === id);
      return (p ? p.title : "Товар") + " — " + qty + " шт.";
    }).join("\n");
    checkout.href = "https://t.me/Allacontactical_bot?text=" + encodeURIComponent(message);
  }
  document.addEventListener("click", event => {
    const button = event.target.closest("[data-cart-id]");
    if (!button) return;
    const id = button.getAttribute("data-cart-id");
    if (!id || id === "undefined" || id === "null") return;
    saveCart(readCart().concat(id));
    const old = button.textContent;
    button.textContent = "✓ Додано";
    button.disabled = true;
    setTimeout(() => { button.textContent = old; button.disabled = false; }, 900);
  });
  window.addEventListener("storage", event => { if (event.key === KEY) { updateCount(); render(); } });
  fetch(API_PRODUCTS, {cache:"no-store"}).then(response => {
    if (!response.ok) throw new Error("products unavailable");
    return response.json();
  }).then(data => { products = Array.isArray(data) ? data : []; render(); }).catch(() => { products = []; });
  ensureUi();
})();