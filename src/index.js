const SITE_ORIGINS = new Set([
  "https://allacontactical.com.ua",
  "https://www.allacontactical.com.ua",
  "https://allacontactical.github.io"
]);
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
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
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
async function telegramSend(env, chatId, text, replyMarkup) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) })
  });
  return response.ok;
}
async function handleAuthStart(request, env) {
  if (!env.DB) return json({ error: "D1 binding DB is not configured" }, 503);
  if (!env.TELEGRAM_BOT_USERNAME) return json({ error: "Test Telegram bot username is not configured" }, 503);
  const raw = randomToken(28); // 56 hex chars; login_ prefix keeps Telegram start payload within its 64-char limit.
  const tokenHash = await sha256(raw);
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO login_challenges (token_hash, status, expires_at) VALUES (?, 'pending', ?)"
  ).bind(tokenHash, expiresAt).run();
  return json({
    token: raw,
    expires_in: CHALLENGE_TTL_SECONDS,
    telegram_url: `https://t.me/${env.TELEGRAM_BOT_USERNAME.replace(/^@/, "")}?start=login_${raw}`
  }, 201);
}
async function handleAuthStatus(request, env) {
  if (!env.DB) return json({ error: "D1 binding DB is not configured" }, 503);
  let payload;
  try { payload = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const raw = typeof payload.token === "string" ? payload.token : "";
  if (!/^[a-f0-9]{56}$/.test(raw)) return json({ error: "Invalid login token" }, 400);
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
  if (url.pathname === "/account/cart" && request.method === "GET") {
    const row = await env.DB.prepare("SELECT items_json, updated_at FROM user_carts WHERE user_id = ?").bind(user.id).first();
    let cart = {};
    try { cart = row?.items_json ? JSON.parse(row.items_json) : {}; } catch { cart = {}; }
    return json({ cart, updated_at: row?.updated_at || null });
  }
  if (url.pathname === "/account/cart" && request.method === "PUT") {
    let payload;
    try { payload = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    const input = payload?.cart;
    if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "Cart must be an object" }, 400);
    const entries = Object.entries(input);
    if (entries.length > 100) return json({ error: "Cart contains too many products" }, 400);
    const cart = {};
    for (const [productId, quantity] of entries) {
      if (!/^\d{1,20}$/.test(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        return json({ error: "Invalid cart item" }, 400);
      }
      cart[productId] = quantity;
    }
    const serialized = JSON.stringify(cart);
    if (serialized.length > 12000) return json({ error: "Cart is too large" }, 413);
    await env.DB.prepare(
      `INSERT INTO user_carts (user_id, items_json, updated_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(user_id) DO UPDATE SET
         items_json = excluded.items_json,
         updated_at = excluded.updated_at`
    ).bind(user.id, serialized).run();
    return json({ ok: true, cart });
  }
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

async function adminUser(request, env) {
  if (!env.DB || !env.ADMIN_TELEGRAM_ID) return null;
  const user = await authenticatedUser(request, env);
  if (!user || String(user.telegram_user_id) !== String(env.ADMIN_TELEGRAM_ID)) return null;
  return user;
}
async function handleAdminImport(request, env, user) {
  let payload;
  try { payload = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const rows = payload?.rows;
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 400) return json({ error: "Expected 1–400 CSV rows" }, 400);
  const batchId = randomToken(12);
  const sourceName = String(payload.source_name || "Prom CSV").slice(0, 180);
  await env.DB.prepare("INSERT INTO import_batches (id, source_name, total_items, imported_by, status) VALUES (?, ?, ?, ?, 'processing')")
    .bind(batchId, sourceName, rows.length, user.id).run();
  let inserted = 0;
  try {
    for (let offset = 0; offset < rows.length; offset += 40) {
      const statements = rows.slice(offset, offset + 40).map((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Invalid CSV row");
        const raw = JSON.stringify(row);
        if (raw.length > 180000) throw new Error("A CSV row is too large");
        const title = String(row["Назва_позиції_укр"] || row["Назва_позиції"] || "").slice(0, 500);
        const productId = String(row["Ідентифікатор_товару"] || row["Унікальний_ідентифікатор"] || "").slice(0, 80);
        const promUrl = String(row["Продукт_на_сайті"] || "").slice(0, 2000);
        const price = String(row["Ціна"] || "").slice(0, 40);
        const currency = String(row["Валюта"] || "").slice(0, 12);
        const quantity = row["Кількість"] == null ? "" : String(row["Кількість"]).slice(0, 40);
        const availability = String(row["Наявність"] || "").slice(0, 40);
        const imageText = String(row["Посилання_зображення"] || "");
        const images = imageText.split(/\s*,\s*/).map(x => x.trim()).filter(x => /^https?:\/\//i.test(x)).slice(0, 30);
        return env.DB.prepare("INSERT INTO import_items (batch_id, product_id, title, prom_url, price, currency, quantity, raw_availability, image_urls_json, raw_json, review_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')")
          .bind(batchId, productId, title, promUrl, price, currency, quantity, availability, JSON.stringify(images), raw);
      });
      // D1 batch is transactional for this chunk; count only after it succeeds.
      await env.DB.batch(statements);
      inserted += statements.length;
    }
    await env.DB.prepare("UPDATE import_batches SET status = 'ready', imported_items = ? WHERE id = ? AND status = 'processing'")
      .bind(inserted, batchId).run();
    return json({ ok: true, batch_id: batchId, imported_items: inserted, review_status: "pending" }, 201);
  } catch (error) {
    // Never leave a partially imported batch available for review.
    // Mark it failed and remove its rows together in one D1 transaction.
    try {
      await env.DB.batch([
        env.DB.prepare("UPDATE import_batches SET status = 'failed', imported_items = 0 WHERE id = ?").bind(batchId),
        env.DB.prepare("DELETE FROM import_items WHERE batch_id = ?").bind(batchId)
      ]);
    } catch (cleanupError) {
      return json({
        error: "Import failed and cleanup could not be confirmed",
        batch_id: batchId,
        detail: String(error.message || error),
        cleanup_detail: String(cleanupError.message || cleanupError)
      }, 500);
    }
    return json({
      error: "Import failed; partial rows were removed and the batch was marked failed",
      batch_id: batchId,
      detail: String(error.message || error)
    }, 400);
  }
}
async function handleAdmin(request, env, url) {
  const user = await adminUser(request, env);
  if (!user) return json({ error: "Forbidden" }, 403);
  if (url.pathname === "/admin/me" && request.method === "GET") return json({ admin: true, telegram_user_id: user.telegram_user_id });
  if (url.pathname === "/admin/import" && request.method === "POST") {
    try { return await handleAdminImport(request, env, user); }
    catch (error) { return json({ error: "Import failed", detail: String(error.message || error) }, 400); }
  }
  if (url.pathname === "/admin/import/batches" && request.method === "GET") {
    const result = await env.DB.prepare("SELECT id, source_name, total_items, imported_items, status, created_at FROM import_batches ORDER BY created_at DESC LIMIT 30").all();
    return json({ batches: result.results || [] });
  }
  if (url.pathname === "/admin/import/items" && request.method === "GET") {
    const batchId = url.searchParams.get("batch_id") || "";
    if (!/^[a-f0-9]{24}$/.test(batchId)) return json({ error: "Invalid batch_id" }, 400);
    const result = await env.DB.prepare("SELECT id, product_id, title, prom_url, price, currency, quantity, raw_availability, image_urls_json, review_status, review_note, created_at FROM import_items WHERE batch_id = ? ORDER BY id LIMIT 400").bind(batchId).all();
    return json({ items: result.results || [] });
  }
  if (url.pathname === "/admin/import/item" && request.method === "PATCH") {
    let payload;
    try { payload = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    const id = Number(payload?.id), status = String(payload?.review_status || ""), note = String(payload?.review_note || "").slice(0, 1000);
    if (!Number.isInteger(id) || id < 1 || !["pending", "approved", "rejected"].includes(status)) return json({ error: "Invalid item or review status" }, 400);
    const result = await env.DB.prepare("UPDATE import_items SET review_status = ?, review_note = ?, reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), reviewed_by = ? WHERE id = ?").bind(status, note, user.id, id).run();
    if (!result.meta?.changes) return json({ error: "Item not found" }, 404);
    return json({ ok: true, id, review_status: status });
  }
  return json({ error: "Not found" }, 404);
}

async function handleWebhook(request, env) {
  // Fail closed: never accept public webhook updates without Telegram's secret header.
  if (!env.TELEGRAM_WEBHOOK_SECRET) return new Response("Webhook secret is not configured", { status: 503 });
  const supplied = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (supplied !== env.TELEGRAM_WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });
  let update;
  try { update = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
  const message = update.message;
  if (!message?.chat?.id || !message?.text) return new Response("OK");
  const chatId = message.chat.id;
  const fullText = message.text.trim();
  const command = fullText.split(/\s+/, 1)[0].split("@")[0];

  const catalogKeyboard = {
    inline_keyboard: [
      [{ text: "🧥 Костюми, куртки та жилети", url: "https://allacontactical.prom.ua/ua/g138419515-mislivski-kostyumi-kurtki" }],
      [{ text: "👖 Штани та нагрудники", url: "https://allacontactical.prom.ua/ua/g138421493-mislivski-shtani-nagrudniki" }],
      [{ text: "🥾 Худі, пуловери та футболки", url: "https://allacontactical.prom.ua/ua/g138424028-mislivski-hudi-puloveri" }],
      [{ text: "🧢 Шапки та кепки", url: "https://allacontactical.prom.ua/ua/g138423958-mislivski-shapki-kepki" }]
    ]
  };

  if (command === "/start") {
    const payload = fullText.split(/\s+/)[1] || "";
    const match = payload.match(/^login_([a-f0-9]{56})$/);
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
        "Вітаємо в AllaconTactical! 🎯\n\n" +
        "Допоможемо підібрати екіпірування для полювання.\n\n" +
        "Оберіть категорію товарів:", catalogKeyboard);
    }
    return new Response("OK");
  }

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
    if (request.method === "GET" && url.pathname === "/" && env.ASSETS) {
      const assetUrl = new URL("/index.html", request.url);
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }
    if (request.method === "POST" && url.pathname === "/auth/start") return withCors(await handleAuthStart(request, env), request);
    if (request.method === "POST" && url.pathname === "/auth/status") return withCors(await handleAuthStatus(request, env), request);
    if (url.pathname.startsWith("/admin/")) return withCors(await handleAdmin(request, env, url), request);
    if ((request.method === "GET" && (url.pathname === "/account/me" || url.pathname === "/account/cart")) ||
        (request.method === "PUT" && url.pathname === "/account/cart") ||
        (request.method === "POST" && url.pathname === "/auth/logout")) {
      return withCors(await handleAccount(request, env, url), request);
    }
    if (request.method === "GET" && url.pathname === "/preview" && env.ASSETS) {
      const previewUrl = new URL("/index.html", request.url);
      return env.ASSETS.fetch(new Request(previewUrl, request));
    }
    if (request.method === "GET" && (url.pathname === "/account.html" || url.pathname === "/account") && env.ASSETS) {
      const assetUrl = new URL("/account.html", request.url);
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }
    if (request.method === "GET" && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return withCors(new Response("Not found", { status: 404 }), request);
  }
};
