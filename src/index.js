const SITE_ORIGINS = new Set([
  "https://allacontactical.com.ua",
  "https://www.allacontactical.com.ua",
  "https://allacontactical.github.io"
]);
const BOT_USERNAME = "Allacontactical_bot";
const CHALLENGE_TTL_SECONDS = 5 * 60;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });
}
function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  const allowed = origin && (SITE_ORIGINS.has(origin));
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://allacontactical.com.ua",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
function withCors(response, request) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request))) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}
function randomToken(bytes = 32) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(data, b => b.toString(16).padStart(2, "0")).join("");
}
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
async function telegramSend(env, chatId, text) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
  return response.ok;
}
async function handleAuthStart(request, env) {
  if (!env.DB) return json({ error: "D1 binding DB is not configured" }, 503);
  const raw = randomToken();
  const tokenHash = await sha256(raw);
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO login_challenges (token_hash, status, expires_at) VALUES (?, 'pending', ?)"
  ).bind(tokenHash, expiresAt).run();
  return json({
    token: raw,
    expires_in: CHALLENGE_TTL_SECONDS,
    telegram_url: `https://t.me/${BOT_USERNAME}?start=login_${raw}`
  }, 201);
}
async function handleAuthStatus(url, env) {
  if (!env.DB) return json({ error: "D1 binding DB is not configured" }, 503);
  const raw = url.searchParams.get("token") || "";
  if (!/^[a-f0-9]{64}$/.test(raw)) return json({ error: "Invalid login token" }, 400);
  const tokenHash = await sha256(raw);
  const challenge = await env.DB.prepare(
    "SELECT status, expires_at FROM login_challenges WHERE token_hash = ?"
  ).bind(tokenHash).first();
  if (!challenge) return json({ status: "not_found" }, 404);
  if (Date.parse(challenge.expires_at) <= Date.now()) {
    await env.DB.prepare("UPDATE login_challenges SET status = 'expired' WHERE token_hash = ? AND status = 'pending'")
      .bind(tokenHash).run();
    return json({ status: "expired" });
  }
  if (challenge.status !== "approved") return json({ status: challenge.status });

  const claimed = await env.DB.prepare(
    "UPDATE login_challenges SET status = 'consumed' WHERE token_hash = ? AND status = 'approved' RETURNING telegram_user_id"
  ).bind(tokenHash).first();
  if (!claimed?.telegram_user_id) return json({ status: "consumed" }, 409);

  const user = await env.DB.prepare(
    `INSERT INTO users (telegram_user_id)
     VALUES (?)
     ON CONFLICT(telegram_user_id) DO UPDATE SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     RETURNING id`
  ).bind(String(claimed.telegram_user_id)).first();
  const sessionToken = randomToken();
  const sessionHash = await sha256(sessionToken);
  const sessionExpires = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)"
  ).bind(user.id, sessionHash, sessionExpires).run();
  return json({ status: "authenticated", session_token: sessionToken, expires_at: sessionExpires });
}
async function authenticatedUser(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const hash = await sha256(token);
  return env.DB.prepare(
    `SELECT u.id, u.telegram_user_id, u.telegram_username, u.first_name, u.last_name, u.created_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`
  ).bind(hash, new Date().toISOString()).first();
}
async function handleAccount(request, env, url) {
  if (!env.DB) return json({ error: "D1 binding DB is not configured" }, 503);
  const user = await authenticatedUser(request, env);
  if (!user) return json({ error: "Unauthorized" }, 401);
  if (url.pathname === "/account/me" && request.method === "GET") {
    return json({ user: {
      id: user.id,
      telegram_username: user.telegram_username,
      first_name: user.first_name,
      last_name: user.last_name,
      created_at: user.created_at
    }});
  }
  if (url.pathname === "/auth/logout" && request.method === "POST") {
    const token = (request.headers.get("Authorization") || "").slice(7);
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
    return json({ ok: true });
  }
  return json({ error: "Not found" }, 404);
}
async function handleWebhook(request, env) {
  if (env.TELEGRAM_WEBHOOK_SECRET) {
    const supplied = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (supplied !== env.TELEGRAM_WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });
  }
  let update;
  try { update = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
  const message = update.message;
  if (!message?.chat?.id || !message?.text) return new Response("OK");
  const chatId = message.chat.id;
  const fullText = message.text.trim();
  const command = fullText.split(/\s+/, 1)[0].split("@")[0];

  if (command === "/start") {
    const payload = fullText.split(/\s+/)[1] || "";
    const match = payload.match(/^login_([a-f0-9]{64})$/);
    if (match && env.DB) {
      const hash = await sha256(match[1]);
      const result = await env.DB.prepare(
        `UPDATE login_challenges
         SET status = 'approved', telegram_user_id = ?
         WHERE token_hash = ? AND status = 'pending' AND expires_at > ?`
      ).bind(String(message.from.id), hash, new Date().toISOString()).run();
      if (result.meta?.changes) {
        await env.DB.prepare(
          `INSERT INTO users (telegram_user_id, telegram_username, first_name, last_name)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(telegram_user_id) DO UPDATE SET
             telegram_username = excluded.telegram_username,
             first_name = excluded.first_name,
             last_name = excluded.last_name,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
        ).bind(String(message.from.id), message.from.username || null, message.from.first_name || null, message.from.last_name || null).run();
        await telegramSend(env, chatId, "Вхід підтверджено. Поверніться на сайт AllaconTactical — кабінет відкриється автоматично.");
      } else {
        await telegramSend(env, chatId, "Посилання для входу вже використано або його термін дії минув. Поверніться на сайт і створіть новий запит на вхід.");
      }
    } else {
      await telegramSend(env, chatId,
        "Вітаємо в AllaconTactical! 🎯\n\nДопоможемо підібрати екіпірування для полювання.\n\nКаталог: https://allacontactical.com.ua/catalog.html");
    }
    return new Response("OK");
  }

  const catalogKeyboard = {
    inline_keyboard: [
      [{ text: "🧥 Костюми, куртки та жилети", url: "https://allacontactical.prom.ua/ua/g138419515-mislivski-kostyumi-kurtki" }],
      [{ text: "👖 Штани та нагрудники", url: "https://allacontactical.prom.ua/ua/g138421493-mislivski-shtani-nagrudniki" }],
      [{ text: "🥾 Худі, пуловери та футболки", url: "https://allacontactical.prom.ua/ua/g138424028-mislivski-hudi-puloveri" }],
      [{ text: "🧢 Шапки та кепки", url: "https://allacontactical.prom.ua/ua/g138423958-mislivski-shapki-kepki" }]
    ]
  };
  let reply = "Вітаємо в AllaconTactical! 🎯\n\nНапишіть, що шукаєте, і ми допоможемо з вибором.";
  let replyMarkup;
  if (command === "/catalog") {
    reply = "Каталог AllaconTactical 🦌\n\nОберіть потрібну категорію:";
    replyMarkup = catalogKeyboard;
  } else if (command === "/help") {
    reply = "Допоможемо підібрати екіпірування! 🎯\n\nНапишіть сезон, розмір і бажаний бюджет — підкажемо з вибором.";
  } else if (command === "/contact") {
    reply = "Напишіть у цей чат, який товар вас цікавить. Допоможемо уточнити наявність, розмір і термін відправлення.";
  }
  const telegramResponse = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: reply, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) })
  });
  if (!telegramResponse.ok) return new Response("Telegram API error", { status: 502 });
  return new Response("OK");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/webhook" && request.method === "POST") return handleWebhook(request, env);

    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method === "GET" && url.pathname === "/") return withCors(new Response("AllaconTactical bot is ready."), request);
    if (request.method === "POST" && url.pathname === "/auth/start") return withCors(await handleAuthStart(request, env), request);
    if (request.method === "GET" && url.pathname === "/auth/status") return withCors(await handleAuthStatus(url, env), request);
    if ((request.method === "GET" && url.pathname === "/account/me") ||
        (request.method === "POST" && url.pathname === "/auth/logout")) {
      return withCors(await handleAccount(request, env, url), request);
    }
    return withCors(new Response("Not found", { status: 404 }), request);
  }
};
