export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET") {
      return new Response("AllaconTactical bot is ready.");
    }

    if (request.method !== "POST" || url.pathname !== "/webhook") {
      return new Response("Not found", { status: 404 });
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const message = update.message;
    if (!message?.chat?.id || !message?.text) {
      return new Response("OK");
    }

    const chatId = message.chat.id;
    const text = message.text.trim().split("@")[0];

    const catalogKeyboard = {
      inline_keyboard: [
        [
          {
            text: "🧥 Костюми, куртки та жилети",
            url: "https://allacontactical.prom.ua/ua/g138419515-mislivski-kostyumi-kurtki"
          }
        ],
        [
          {
            text: "👖 Штани та нагрудники",
            url: "https://allacontactical.prom.ua/ua/g138421493-mislivski-shtani-nagrudniki"
          }
        ],
        [
          {
            text: "🥾 Худі, пуловери та футболки",
            url: "https://allacontactical.prom.ua/ua/g138424028-mislivski-hudi-puloveri"
          }
        ],
        [
          {
            text: "🧢 Шапки та кепки",
            url: "https://allacontactical.prom.ua/ua/g138423958-mislivski-shapki-kepki"
          }
        ]
      ]
    };

    let reply =
      "Вітаємо в AllaconTactical! 🎯\n\nНапишіть, що шукаєте, і ми допоможемо з вибором.";

    let replyMarkup;

    if (text === "/start") {
      reply =
        "Вітаємо в AllaconTactical! 🎯\n\n" +
        "Допоможемо підібрати екіпірування для полювання.\n\n" +
        "Оберіть категорію товарів:";

      replyMarkup = catalogKeyboard;
    } else if (text === "/catalog") {
      reply =
        "Каталог AllaconTactical 🦌\n\n" +
        "Оберіть потрібну категорію:";

      replyMarkup = catalogKeyboard;
    } else if (text === "/help") {
      reply =
        "Допоможемо підібрати екіпірування! 🎯\n\n" +
        "Напишіть нам:\n" +
        "1. Для якого сезону потрібен одяг.\n" +
        "2. Ваш розмір.\n" +
        "3. Бажаний бюджет.\n\n" +
        "Підкажемо, на що звернути увагу під час вибору.";
    } else if (text === "/contact") {
      reply =
        "Напишіть у цей чат, який товар вас цікавить. 📩\n\n" +
        "Допоможемо уточнити наявність, розмір і термін відправлення.";
    }

    const payload = {
      chat_id: chatId,
      text: reply
    };

    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    if (!telegramResponse.ok) {
      return new Response("Telegram API error", { status: 502 });
    }

    return new Response("OK");
  }
};
