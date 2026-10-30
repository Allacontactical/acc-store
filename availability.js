(function () {
  "use strict";
  var labels = {
    in_stock: "В наличии",
    expected: "Ожидается",
    out_of_stock: "Нет в наличии",
    preorder: "Под заказ"
  };
  var messages = {
    expected: "Новая партия уже в пути. Уточните дату поступления у консультанта ACC.",
    out_of_stock: "Сейчас товара нет в наличии. Уточните возможность повторного поступления.",
    preorder: "Эту модель можно запросить под заказ. Уточните условия у консультанта ACC.",
    in_stock: "Товар в наличии. Перед заказом уточните доступный размер и актуальные детали."
  };
  var contactUrl = "https://t.me/Allacontactical_bot";

  function enhanceCard(card) {
    var status = card.getAttribute("data-availability-status");
    if (!status || !labels[status] || card.querySelector(".availability-badge")) return;
    var body = card.querySelector(".card-body") || card;
    var badge = document.createElement("span");
    badge.className = "availability-badge";
    badge.textContent = labels[status];
    var price = body.querySelector(".price, p > strong");
    if (price && price.parentNode) price.parentNode.insertBefore(badge, price);
    else body.insertBefore(badge, body.firstChild);

    var message = document.createElement("p");
    message.className = "availability-message";
    var date = card.getAttribute("data-expected-arrival");
    message.textContent = status === "expected" && date
      ? "Новая партия ожидается: " + date + ". Уточните поступление у консультанта ACC."
      : messages[status];
    if (badge.nextSibling) badge.parentNode.insertBefore(message, badge.nextSibling);
    else body.appendChild(message);

    if (status === "expected" || status === "out_of_stock" || status === "preorder") {
      var action = document.createElement("a");
      action.className = "availability-action";
      action.href = contactUrl;
      action.target = "_blank";
      action.rel = "noopener";
      action.textContent = status === "expected" ? "Уточнить поступление" : "Уточнить у специалиста ACC";
      body.appendChild(action);
    }
  }

  function run() {
    var cards = document.querySelectorAll(".card[data-availability-status]");
    Array.prototype.forEach.call(cards, enhanceCard);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
}());