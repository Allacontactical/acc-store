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

    let reply =
      "Вітаємо в AllaconTactical! Напишіть, що шукаєте, і ми допоможемо з вибором.";

    if (text === "/start") {
      reply =
        "Вітаємо в AllaconTactical! 🎯\n\nДопоможемо підібрати екіпірування для полювання та outdoor.\n\nКоманди:\n/catalog — каталог\n/help — допомога з вибором\n/contact — зв’язатися з нами";
    } else if (text === "/catalog") {
      reply =
        "Каталог AllaconTactical:\nhttps://allacontactical.prom.ua/\n\nНапишіть назву товару — допоможемо знайти потрібний варіант.";
    } else if (text === "/help") {
      reply =
        "Щоб підібрати екіпірування, напишіть:\n1. Для чого потрібне — полювання, outdoor чи тактика.\n2. Сезон і погодні умови.\n3. Ваш розмір і бюджет.";
    } else if (text === "/contact") {
      reply =
        "Напишіть у цей чат, який товар вас цікавить. Допоможемо уточнити наявність, розмір і термін відправлення.";
    }

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: reply })
      }
    );

    if (!telegramResponse.ok) {
      return new Response("Telegram API error", { status: 502 });
    }

    return new Response("OK");
  }
};
