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
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
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
  if (!env.TELEGRAM_BOT_USERNAME) return json({ error: "Telegram bot username is not configured" }, 503);
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


function buildPublishedProduct(item) {
  let raw = {}; let images = [];
  try { raw = JSON.parse(item.raw_json || "{}"); } catch { raw = {}; }
  try { images = JSON.parse(item.image_urls_json || "[]"); } catch { images = []; }
  const priceText = String(item.price || "").trim().replace(/\s/g, "").replace(",", ".");
  const parsedPrice = priceText ? Number(priceText) : NaN;
  const availability = String(item.raw_availability || "").trim();
  const availabilityLower = availability.toLocaleLowerCase("uk-UA");
  const category = raw["Назва_групи"] || raw["Назва_групи_укр"] || raw["Група_товару"] || raw["Категорія"] || raw["Група"] || "";
  const publicId = item.public_product_id || item.product_id || String(9000000000000000n + BigInt(item.id));
  const product = {
    id: publicId, title: item.title || "",
    currency: item.currency || "UAH"
  };
  if (Number.isFinite(parsedPrice)) product.price = parsedPrice;
  if (category) product.category = category;
  if (images.length) { product.image = images[0]; product.images = images; }
  if (item.prom_url) product.url = item.prom_url;
  if (availability) product.availability = availability;
  // Prom exports use Опис_укр for Ukrainian text and Опис for Russian text.
  // Keep legacy aliases for older/manual imports without overwriting source values.
  const description = raw["Опис_укр"] || raw["Опис_позиції_укр"] || raw["Опис"] || "";
  const descriptionRu = raw["Опис"] || raw["Опис_позиції"] || raw["Опис_позиції_рос"] || "";
  if (description) product.description = description;
  if (descriptionRu) product.description_ru = descriptionRu;
  const brand = raw["Виробник"] || raw["Бренд"] || "";
  if (brand) product.brand = brand;
  // Quantity is retained as supplied; blank stays blank and is not converted to zero.
  if (item.quantity !== "" && item.quantity != null) product.quantity = String(item.quantity);
  product.availability_status = /очіку|ожида|expected/.test(availabilityLower) ? "expected" : "";
  return product;
}
async function dispatchCatalogPublish(env, item, product) {
  const token = env.ACC_CONTENTS_TOKEN;
  if (!token) throw new Error("Не настроен секрет ACC_CONTENTS_TOKEN для публикации в каталог.");
  const response = await fetch("https://api.github.com/repos/Allacontactical/acc-store/actions/workflows/publish-acc-product.yml/dispatches", {
    method: "POST",
    headers: { "Accept": "application/vnd.github+json", "Authorization": "Bearer " + token,
      "User-Agent": "AllaconTactical-ACC-Catalog-Publisher",
      "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main", inputs: { diagnostic: "false", item_id: String(item.id), product_json: JSON.stringify(product) } })
  });
  if (response.status !== 204) {
    const responseText = await response.text().catch(() => "");
    let detail = {};
    try { detail = responseText ? JSON.parse(responseText) : {}; } catch {}
    const message = String(detail.message || responseText || "empty response").replace(/\s+/g, " ").slice(0, 400);
    const requestId = response.headers.get("x-github-request-id");
    const acceptedPermissions = response.headers.get("x-accepted-github-permissions");
    const diagnostics = [message, requestId ? "request_id=" + requestId : "", acceptedPermissions ? "required_permissions=" + acceptedPermissions : ""].filter(Boolean).join("; ");
    throw new Error("GitHub workflow dispatch " + response.status + ": " + diagnostics);
  }
}

function isSafe281ImportBatch(batch, itemCount) {
  return Boolean(batch &&
    batch.source_name === "ACC_281_products_no_optics_admin_import.xlsx" &&
    Number(batch.total_items) === 281 &&
    Number(batch.imported_items) === 281 &&
    Number(itemCount) === 281 &&
    batch.status === "ready");
}

async function handleAdmin(request, env, url) {
  const user = await adminUser(request, env);
  if (!user) return json({ error: "Forbidden" }, 403);

  // Safe workflow_dispatch probe. Diagnostic mode is explicitly excluded from product publishing.
  if (url.pathname === "/admin/github-dispatch-check" && request.method === "POST") {
    const token = env.ACC_CONTENTS_TOKEN;
    if (!token) return json({ configured: false, error: "ACC_CONTENTS_TOKEN is missing" }, 503);
    const response = await fetch("https://api.github.com/repos/Allacontactical/acc-store/actions/workflows/publish-acc-product.yml/dispatches", {
      method: "POST",
      headers: { "Accept": "application/vnd.github+json", "Authorization": "Bearer " + token, "User-Agent": "AllaconTactical-ACC-Catalog-Publisher", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main", inputs: { diagnostic: "true", item_id: "", product_json: "{}" } })
    });
    const responseText = await response.text().catch(() => "");
    let detail = {};
    try { detail = responseText ? JSON.parse(responseText) : {}; } catch {}
    return json({ configured: true, github_status: response.status, accepted_permissions: response.headers.get("x-accepted-github-permissions"), request_id: response.headers.get("x-github-request-id"), message: response.status === 204 ? "GitHub принял безопасный запуск диагностического режима; товар не публиковался." : String(detail.message || responseText || "empty response").replace(/\s+/g, " ").slice(0, 400), event_type: "workflow_dispatch diagnostic", product_workflow_triggered: false }, response.status === 204 ? 200 : 502);
  }

  // Read-only diagnostics for the exact GitHub token used by catalog publishing.
  // This endpoint never returns the token and never triggers a repository dispatch.
  if (url.pathname === "/admin/github-token-check" && request.method === "GET") {
    const token = env.ACC_CONTENTS_TOKEN;
    if (!token) return json({ configured: false, error: "ACC_CONTENTS_TOKEN is missing" }, 503);
    const headers = {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + token,
      "User-Agent": "AllaconTactical-ACC-Catalog-Publisher",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    const [userResponse, repoResponse] = await Promise.all([
      fetch("https://api.github.com/user", { headers }),
      fetch("https://api.github.com/repos/Allacontactical/acc-store", { headers })
    ]);
    const userData = await userResponse.json().catch(() => ({}));
    const repoData = await repoResponse.json().catch(() => ({}));
    return json({
      configured: true,
      github_user_status: userResponse.status,
      github_login: userResponse.ok ? (userData.login || null) : null,
      repository_status: repoResponse.status,
      repository_full_name: repoResponse.ok ? (repoData.full_name || null) : null,
      repository_permissions: repoResponse.ok ? (repoData.permissions || null) : null,
      github_user_error: userResponse.ok ? null : String(userData.message || "GitHub user check failed").slice(0, 180),
      repository_error: repoResponse.ok ? null : String(repoData.message || "GitHub repository check failed").slice(0, 180)
    });
  }
  if (url.pathname === "/admin/me" && request.method === "GET") return json({ admin: true, telegram_user_id: user.telegram_user_id });


  if (url.pathname === "/admin/import/batch/approve" && request.method === "POST") {
    let payload;
    try { payload = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    const batchId = String(payload?.batch_id || "");
    if (!/^[a-f0-9]{24}$/.test(batchId)) return json({ error: "Invalid batch_id" }, 400);
    const batch = await env.DB.prepare("SELECT id, source_name, total_items, imported_items, status FROM import_batches WHERE id = ?").bind(batchId).first();
    const counts = await env.DB.prepare(
      "SELECT COUNT(*) AS total, COUNT(DISTINCT product_id) AS unique_ids, SUM(CASE WHEN review_status = 'rejected' THEN 1 ELSE 0 END) AS rejected, SUM(CASE WHEN product_id IS NULL OR TRIM(product_id) = '' THEN 1 ELSE 0 END) AS missing_ids FROM import_items WHERE batch_id = ?"
    ).bind(batchId).first();
    if (!isSafe281ImportBatch(batch, counts?.total)) return json({ error: "Массовая операция разрешена только для полного пакета ACC из 281 товара." }, 409);
    if (Number(counts.unique_ids) !== 281 || Number(counts.rejected || 0) > 0 || Number(counts.missing_ids || 0) > 0) {
      return json({ error: "Проверка пакета не пройдена: найдены отклонённые товары или проблемы с ID." }, 409);
    }
    await env.DB.prepare(
      "UPDATE import_items SET review_status = 'approved', review_note = NULL, reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), reviewed_by = ? WHERE batch_id = ? AND review_status = 'pending'"
    ).bind(user.id, batchId).run();
    const approved = await env.DB.prepare("SELECT COUNT(*) AS total FROM import_items WHERE batch_id = ? AND review_status = 'approved'").bind(batchId).first();
    if (Number(approved?.total) !== 281) return json({ error: "Не удалось подтвердить все 281 позиции", approved: Number(approved?.total || 0) }, 409);
    return json({ ok: true, batch_id: batchId, approved: 281 });
  }

  if (url.pathname === "/admin/import/batch/reconcile" && request.method === "POST") {
    let payload;
    try { payload = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    const batchId = String(payload?.batch_id || "");
    if (!/^[a-f0-9]{24}$/.test(batchId)) return json({ error: "Invalid batch_id" }, 400);
    const batch = await env.DB.prepare("SELECT id, source_name, total_items, imported_items, status FROM import_batches WHERE id = ?").bind(batchId).first();
    const counts = await env.DB.prepare("SELECT COUNT(*) AS total FROM import_items WHERE batch_id = ?").bind(batchId).first();
    if (!isSafe281ImportBatch(batch, counts?.total)) return json({ error: "Сверка разрешена только для полного пакета ACC из 281 товара." }, 409);
    const token = env.ACC_CONTENTS_TOKEN;
    if (!token) return json({ error: "ACC_CONTENTS_TOKEN is missing" }, 503);
    const response = await fetch("https://api.github.com/repos/Allacontactical/acc-store/actions/workflows/publish-acc-product.yml/runs?per_page=100", {
      headers: { "Accept": "application/vnd.github+json", "Authorization": "Bearer " + token, "User-Agent": "AllaconTactical-ACC-Catalog-Publisher", "X-GitHub-Api-Version": "2022-11-28" }
    });
    if (!response.ok) return json({ error: "Не удалось проверить активные запуски GitHub", status: response.status }, 502);
    const data = await response.json();
    const active = (data.workflow_runs || []).filter(run => ["queued", "in_progress", "waiting", "requested", "pending"].includes(run.status));
    if (active.length) return json({ ok: false, active_runs: active.length, message: "Есть активные запуски публикации. Сверка отложена, чтобы не затронуть выполняющиеся товары." }, 409);
    const reset = await env.DB.prepare("UPDATE import_items SET publish_status = 'failed' WHERE batch_id = ? AND review_status = 'approved' AND publish_status = 'queued' AND is_published = 0").bind(batchId).run();
    return json({ ok: true, reset: Number(reset.meta?.changes || 0), message: "Зависшие статусы восстановлены; опубликованные товары не затронуты." });
  }

  if (url.pathname === "/admin/import/publish" && request.method === "POST") {
    let payload;
    try { payload = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    const id = Number(payload?.id);
    if (!Number.isInteger(id) || id < 1) return json({ error: "Invalid item id" }, 400);
    const item = await env.DB.prepare("SELECT id, product_id, public_product_id, title, prom_url, price, currency, quantity, raw_availability, image_urls_json, raw_json, review_status, is_published, publish_status FROM import_items WHERE id = ?").bind(id).first();
    if (!item) return json({ error: "Item not found" }, 404);
    if (item.review_status !== "approved") return json({ error: "Сначала одобрите товар" }, 409);
    if (item.publish_status === "queued") return json({ error: "Публикация этой позиции уже выполняется" }, 409);
    const publicId = item.public_product_id || item.product_id || String(9000000000000000n + BigInt(item.id));
    const duplicate = await env.DB.prepare("SELECT id FROM import_items WHERE id <> ? AND COALESCE(NULLIF(public_product_id, ''), product_id) = ? LIMIT 1").bind(id, publicId).first();
    if (duplicate) return json({ error: "Этот ID уже закреплён за позицией №" + duplicate.id }, 409);
    const product = buildPublishedProduct({ ...item, public_product_id: publicId });
    // Claim the item atomically so two simultaneous publish requests cannot dispatch it twice.
    const claimed = await env.DB.prepare("UPDATE import_items SET public_product_id = ?, publish_status = 'queued' WHERE id = ? AND review_status = 'approved' AND COALESCE(publish_status, '') <> 'queued'").bind(publicId, id).run();
    if (!claimed.meta?.changes) return json({ error: "Публикация уже запущена или товар больше не одобрен" }, 409);
    try {
      await dispatchCatalogPublish(env, item, product);
      return json({ ok: true, id, public_product_id: publicId, publish_status: "queued" }, 202);
    } catch (error) {
      await env.DB.prepare("UPDATE import_items SET publish_status = 'failed' WHERE id = ?").bind(id).run();
      return json({ error: "Не удалось запустить публикацию", detail: String(error.message || error).slice(0, 400) }, 502);
    }
  }

  if (url.pathname === "/admin/images" && request.method === "POST") {
    if (!env.PRODUCT_IMAGES) return json({ error: "Image storage binding is not configured" }, 503);
    let form;
    try { form = await request.formData(); } catch { return json({ error: "Invalid multipart upload" }, 400); }
    const files = form.getAll("files").filter(x => x && typeof x === "object" && typeof x.stream === "function");
    if (!files.length || files.length > 10) return json({ error: "Загрузите от 1 до 10 фотографий" }, 400);
    if (files.some(file => file.type !== "image/webp" || file.size < 1 || file.size > 8 * 1024 * 1024)) {
      return json({ error: "Допускаются только WebP-фото размером до 8 МБ каждое" }, 400);
    }
    const keys = [];
    try {
      for (const file of files) {
        const key = randomToken(12) + ".webp";
        await env.PRODUCT_IMAGES.put(key, file.stream(), {
          httpMetadata: { contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable" }
        });
        keys.push(key);
      }
      return json({ ok: true, images: keys.map(key => new URL("/product-images/" + key, request.url).toString()) }, 201);
    } catch (error) {
      if (keys.length) await env.PRODUCT_IMAGES.delete(keys).catch(() => {});
      return json({ error: "Не удалось сохранить фотографии", detail: String(error.message || error) }, 500);
    }
  }
  if (url.pathname === "/admin/images" && request.method === "DELETE") {
    if (!env.PRODUCT_IMAGES) return json({ error: "Image storage binding is not configured" }, 503);
    let payload;
    try { payload = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    const keys = Array.isArray(payload?.keys) ? payload.keys : [];
    if (!keys.length || keys.length > 10 || keys.some(key => typeof key !== "string" || !/^[a-f0-9]{24}\.webp$/.test(key))) return json({ error: "Invalid image keys" }, 400);
    await env.PRODUCT_IMAGES.delete(keys);
    return json({ ok: true });
  }
  if (url.pathname === "/admin/manual-product" && request.method === "POST") {
    let payload;
    try { payload = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    const title = String(payload?.title || "").trim().slice(0, 500);
    const brand = String(payload?.brand || "").trim().slice(0, 120);
    const category = String(payload?.category || "").trim().slice(0, 160);
    const description = String(payload?.description || "").trim().slice(0, 12000);
    const price = String(payload?.price ?? "").trim().slice(0, 40);
    const currency = String(payload?.currency || "UAH").trim().slice(0, 12);
    const quantity = String(payload?.quantity ?? "").trim().slice(0, 40);
    const availability = String(payload?.availability || "Під замовлення").trim().slice(0, 40);
    const images = payload?.images;
    if (!title || !price) return json({ error: "Укажите название и цену товара" }, 400);
    if (!Array.isArray(images) || images.length > 10 || images.some(x => typeof x !== "string" || !x.startsWith(new URL("/product-images/", request.url).toString()) || !/\/product-images\/[a-f0-9]{24}\.webp$/.test(x))) {
      return json({ error: "Некорректный список фотографий" }, 400);
    }
    const batchId = randomToken(12);
    const raw = {
      "Назва_позиції": title, "Назва_позиції_укр": title, "Бренд": brand,
      "Категорія": category, "Опис": description, "Опис_позиції_укр": description,
      "Ціна": price, "Валюта": currency, "Кількість": quantity,
      "Наявність": availability, "Посилання_зображення": images.join(",")
    };
    try {
      await env.DB.prepare("INSERT INTO import_batches (id, source_name, total_items, imported_items, status, imported_by) VALUES (?, 'Ручное добавление', 1, 1, 'ready', ?)").bind(batchId, user.id).run();
      await env.DB.prepare("INSERT INTO import_items (batch_id, product_id, title, prom_url, price, currency, quantity, raw_availability, image_urls_json, raw_json, review_status) VALUES (?, NULL, ?, '', ?, ?, ?, ?, ?, ?, 'pending')")
        .bind(batchId, title, price, currency, quantity, availability, JSON.stringify(images), JSON.stringify(raw)).run();
      return json({ ok: true, batch_id: batchId, created: true, review_status: "pending" }, 201);
    } catch (error) {
      await env.DB.prepare("DELETE FROM import_batches WHERE id = ?").bind(batchId).run().catch(() => {});
      return json({ error: "Не удалось добавить товар в очередь", detail: String(error.message || error) }, 500);
    }
  }
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
    const result = await env.DB.prepare("SELECT id, product_id, title, prom_url, price, currency, quantity, raw_availability, image_urls_json, raw_json, review_status, review_note, created_at, is_published, public_product_id, publish_status, publish_commit_sha FROM import_items WHERE batch_id = ? ORDER BY id LIMIT 400").bind(batchId).all();
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
  if (url.pathname === "/admin/import/item" && request.method === "PUT") {
    let payload;
    try { payload = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    const id = Number(payload?.id);
    const title = String(payload?.title || "").trim().slice(0, 500);
    const brand = String(payload?.brand || "").trim().slice(0, 120);
    const category = String(payload?.category || "").trim().slice(0, 160);
    const description = String(payload?.description || "").trim().slice(0, 12000);
    const price = String(payload?.price ?? "").trim().slice(0, 40);
    const currency = String(payload?.currency || "").trim().slice(0, 12);
    const quantity = String(payload?.quantity ?? "").trim().slice(0, 40);
    const availability = String(payload?.raw_availability || "").trim().slice(0, 40);
    const promUrl = String(payload?.prom_url || "").trim().slice(0, 2000);
    const images = payload?.images;
    if (!Number.isInteger(id) || id < 1 || !title) return json({ error: "Укажите корректный товар и название" }, 400);
    if (!Array.isArray(images) || images.length > 30 || images.some(x => typeof x !== "string" || x.length > 2000 || !/^https?:\/\//i.test(x))) {
      return json({ error: "Проверьте ссылки на фотографии (до 30 ссылок http/https)" }, 400);
    }
    if (promUrl && !/^https?:\/\//i.test(promUrl)) return json({ error: "Некорректная ссылка Prom" }, 400);
    const existing = await env.DB.prepare("SELECT raw_json FROM import_items WHERE id = ?").bind(id).first();
    if (!existing) return json({ error: "Item not found" }, 404);
    let raw = {};
    try { raw = JSON.parse(existing.raw_json || "{}"); } catch { raw = {}; }
    raw["Назва_позиції"] = title;
    raw["Назва_позиції_укр"] = title;
    raw["Бренд"] = brand;
    raw["Виробник"] = brand;
    raw["Категорія"] = category;
    if (category) {
      raw["Назва_групи"] = category;
      raw["Назва_групи_укр"] = category;
    }
    // The editor changes the Ukrainian description only; preserve the Russian source text.
    raw["Опис_укр"] = description;
    raw["Опис_позиції_укр"] = description;
    raw["Ціна"] = price;
    raw["Валюта"] = currency;
    raw["Кількість"] = quantity;
    raw["Наявність"] = availability;
    raw["Продукт_на_сайті"] = promUrl;
    raw["Посилання_зображення"] = images.join(",");
    await env.DB.prepare(
      "UPDATE import_items SET title = ?, price = ?, currency = ?, quantity = ?, raw_availability = ?, prom_url = ?, image_urls_json = ?, raw_json = ?, review_status = 'pending', review_note = NULL, reviewed_by = NULL, reviewed_at = NULL WHERE id = ?"
    ).bind(title, price, currency, quantity, availability, promUrl, JSON.stringify(images), JSON.stringify(raw), id).run();
    return json({ ok: true, id, review_status: "pending" });
  }
  if (url.pathname === "/admin/import/item" && request.method === "DELETE") {
    let payload;
    try { payload = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    const id = Number(payload?.id);
    if (!Number.isInteger(id) || id < 1) return json({ error: "Invalid item id" }, 400);
    const result = await env.DB.prepare("DELETE FROM import_items WHERE id = ?").bind(id).run();
    if (!result.meta?.changes) return json({ error: "Item not found" }, 404);
    return json({ ok: true, id, deleted: true });
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
      [{ text: "Відкрити каталог AllaconTactical", url: "https://allacontactical.com.ua/catalog.html" }],
      [{ text: "Одяг для полювання", url: "https://allacontactical.com.ua/hunting-clothing.html" }],
      [{ text: "Взуття для полювання", url: "https://allacontactical.com.ua/hunting-footwear.html" }],
      [{ text: "Шапки та кепки", url: "https://allacontactical.com.ua/hunting-headwear.html" }],
      [{ text: "Аксесуари", url: "https://allacontactical.com.ua/hunting-accessories.html" }],
      [{ text: "Тактичне спорядження", url: "https://allacontactical.com.ua/tactical-gear.html" }],
      [{ text: "Товари для риболовлі", url: "https://allacontactical.com.ua/fishing-gear.html" }]
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
        if (env.ADMIN_TELEGRAM_ID && String(message.from.id) === String(env.ADMIN_TELEGRAM_ID)) {
          await telegramSend(env, chatId, "Вхід адміністратора підтверджено. Відкрийте панель керування ACC:", { inline_keyboard: [[{ text: "Відкрити адмін-панель ACC", url: "https://allacontactical-bot.allacontactical.workers.dev/admin.html" }]] });
        } else {
          await telegramSend(env, chatId, "Вхід підтверджено. Поверніться до особистого кабінету AllaconTactical за посиланням:\nhttps://allacontactical.com.ua/account.html", { inline_keyboard: [[{ text: "Відкрити особистий кабінет", url: "https://allacontactical.com.ua/account.html" }]] });
        }
      } else {
        await telegramSend(env, chatId, "Посилання для входу вже використано або його термін дії минув. Поверніться на сайт і створіть новий запит на вхід.");
      }
    } else if (env.ADMIN_TELEGRAM_ID && String(message.from.id) === String(env.ADMIN_TELEGRAM_ID)) {
      await telegramSend(env, chatId, "Вітаю, адміністраторе ACC. Для керування товарами та імпортом відкрийте адміністративну панель:", { inline_keyboard: [[{ text: "Відкрити адмін-панель ACC", url: "https://allacontactical-bot.allacontactical.workers.dev/admin.html" }]] });
    } else {
      await telegramSend(env, chatId,
        "Вітаємо в AllaconTactical!\n\n" +
        "Допоможемо підібрати екіпірування для полювання.\n\n" +
        "Оберіть категорію товарів або відкрийте особистий кабінет:", { inline_keyboard: [...catalogKeyboard.inline_keyboard, [{ text: "Особистий кабінет", url: "https://allacontactical.com.ua/account.html" }]] });
    }
    return new Response("OK");
  }

  let reply = "Вітаємо в AllaconTactical!\n\nНапишіть, що шукаєте, і ми допоможемо з вибором.";
  let replyMarkup;
  const textCommand = fullText.toLocaleLowerCase("uk-UA").replace(/\s+/g, " ").trim();
  if (command === "/catalog" || ["каталог", "каталог товарів", "відкрити каталог", "товари"].includes(textCommand)) {
    reply = "Каталог AllaconTactical\n\nОберіть потрібну категорію:";
    replyMarkup = catalogKeyboard;
  } else if (command === "/account" || ["особистий кабінет", "кабінет"].includes(textCommand)) {
    if (env.ADMIN_TELEGRAM_ID && String(message.from.id) === String(env.ADMIN_TELEGRAM_ID)) {
      reply = "Для адміністратора ACC доступна адміністративна панель:";
      replyMarkup = { inline_keyboard: [[{ text: "Відкрити адмін-панель ACC", url: "https://allacontactical-bot.allacontactical.workers.dev/admin.html" }]] };
    } else {
      reply = "Особистий кабінет AllaconTactical:";
      replyMarkup = { inline_keyboard: [[{ text: "Відкрити особистий кабінет", url: "https://allacontactical.com.ua/account.html" }]] };
    }
  } else if (command === "/help") {
    reply = "Допоможемо підібрати екіпірування!\n\nНапишіть сезон, розмір і бажаний бюджет — підкажемо з вибором.";
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
    if (request.method === "GET" && url.pathname === "/admin.html" && env.ASSETS) {
      const assetUrl = new URL("/admin.html", request.url);
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/product-images/") && env.PRODUCT_IMAGES) {
      const key = url.pathname.slice("/product-images/".length);
      if (!/^[a-f0-9]{24}\\.webp$/.test(key)) return new Response("Not found", { status: 404 });
      const object = request.method === "HEAD"
        ? await env.PRODUCT_IMAGES.head(key)
        : await env.PRODUCT_IMAGES.get(key);
      if (!object) return new Response("Not found", { status: 404 });
      return new Response(request.method === "HEAD" ? null : object.body, { headers: {
        "Content-Type": object.httpMetadata?.contentType || "image/webp",
        "Cache-Control": object.httpMetadata?.cacheControl || "public, max-age=31536000, immutable",
        "ETag": object.httpEtag
      }});
    }
    if (request.method === "POST" && url.pathname === "/auth/start") return withCors(await handleAuthStart(request, env), request);
    if (request.method === "POST" && url.pathname === "/auth/status") return withCors(await handleAuthStatus(request, env), request);

    // Read-only inventory endpoints let the photo workflow use the approved 281-item import batch as its source of truth.
    if (url.pathname === "/internal/photo-pipeline/batches" && request.method === "GET") {
      const supplied = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      if (!env.ACC_CONTENTS_TOKEN || supplied !== env.ACC_CONTENTS_TOKEN) return json({ error: "Forbidden" }, 403);
      const result = await env.DB.prepare("SELECT id, source_name, total_items, imported_items, status, created_at FROM import_batches ORDER BY created_at DESC LIMIT 30").all();
      return json({ batches: result.results || [] });
    }
    if (url.pathname === "/internal/photo-pipeline/items" && request.method === "GET") {
      const supplied = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      if (!env.ACC_CONTENTS_TOKEN || supplied !== env.ACC_CONTENTS_TOKEN) return json({ error: "Forbidden" }, 403);
      const batchId = url.searchParams.get("batch_id") || "";
      if (!/^[a-f0-9]{24}$/.test(batchId)) return json({ error: "Invalid batch_id" }, 400);
      const result = await env.DB.prepare("SELECT id, product_id, title, quantity, image_urls_json, public_product_id, is_published, publish_status FROM import_items WHERE batch_id = ? ORDER BY id LIMIT 400").bind(batchId).all();
      return json({ items: result.results || [] });
    }

    if (url.pathname === "/internal/photo-pipeline/save" && request.method === "POST") {
      const supplied = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      if (!env.ACC_CONTENTS_TOKEN || supplied !== env.ACC_CONTENTS_TOKEN) return json({ error: "Forbidden" }, 403);
      let payload;
      try { payload = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const batchId = String(payload?.batch_id || "");
      const updates = payload?.updates;
      if (!/^[a-f0-9]{24}$/.test(batchId) || !Array.isArray(updates) || updates.length < 1 || updates.length > 400) {
        return json({ error: "Invalid batch or photo updates" }, 400);
      }
      const ids = new Set();
      for (const item of updates) {
        if (!Number.isInteger(item?.id) || item.id < 1 || ids.has(item.id) || !Array.isArray(item.images) || item.images.length > 30) {
          return json({ error: "Invalid item photo update" }, 400);
        }
        ids.add(item.id);
        for (const image of item.images) {
          if (typeof image !== "string" || image.length > 2000) return json({ error: "Invalid image URL" }, 400);
          let parsed;
          try { parsed = new URL(image); } catch { return json({ error: "Invalid image URL" }, 400); }
          const ownImage = parsed.origin === url.origin && /^\/product-images\/[a-f0-9]{24}\.webp$/.test(parsed.pathname);
          const sourceImage = parsed.protocol === "https:" && parsed.hostname === "images.prom.ua";
          if (!ownImage && !sourceImage) return json({ error: "Image URL is outside the allowed sources" }, 400);
        }
      }
      const statements = updates.map(item => env.DB.prepare(
        "UPDATE import_items SET image_urls_json = ? WHERE id = ? AND batch_id = ?"
      ).bind(JSON.stringify(item.images), item.id, batchId));
      let updated = 0;
      try {
        for (let offset = 0; offset < statements.length; offset += 40) {
          const result = await env.DB.batch(statements.slice(offset, offset + 40));
          updated += result.reduce((sum, row) => sum + (row.meta?.changes || 0), 0);
        }
      } catch (error) {
        return json({ error: "Photo references were only partially saved; retry is safe", updated, detail: String(error.message || error).slice(0, 300) }, 500);
      }
      if (updated !== updates.length) return json({ error: "Some import items were not found in the selected batch", updated, expected: updates.length }, 409);
      return json({ ok: true, batch_id: batchId, updated });
    }

    // Internal photo pipeline: fetch trusted Prom images, convert to WebP at the edge, and store in R2.
    if (url.pathname === "/internal/photo-pipeline" && request.method === "POST") {
      const supplied = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      if (!env.ACC_CONTENTS_TOKEN || supplied !== env.ACC_CONTENTS_TOKEN) return json({ error: "Forbidden" }, 403);
      if (!env.PRODUCT_IMAGES) return json({ error: "Image storage binding is not configured" }, 503);
      let payload;
      try { payload = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const sources = payload?.sources;
      if (!Array.isArray(sources) || sources.length < 1 || sources.length > 10 ||
          sources.some(source => typeof source !== "string" || source.length > 2000)) {
        return json({ error: "Expected 1–10 image source URLs" }, 400);
      }
      const outcomes = await Promise.all(sources.map(async source => {
        try {
          const parsed = new URL(source);
          if (parsed.protocol !== "https:" || parsed.hostname !== "images.prom.ua") {
            throw new Error("Only HTTPS images.prom.ua sources are allowed");
          }
          const response = await fetch(parsed.toString(), {
            cf: { image: { format: "webp", quality: 86, width: 2200, fit: "scale-down" } },
            signal: AbortSignal.timeout(25000)
          });
          if (!response.ok) throw new Error("Source image returned HTTP " + response.status);
          const type = (response.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
          if (type !== "image/webp") throw new Error("WebP conversion unavailable; received " + (type || "unknown content type"));
          const bytes = await response.arrayBuffer();
          if (!bytes.byteLength || bytes.byteLength > 8 * 1024 * 1024) throw new Error("Converted image size is invalid or exceeds 8 MB");
          const view = new Uint8Array(bytes);
          if (view.length < 12 || String.fromCharCode(...view.slice(0, 4)) !== "RIFF" ||
              String.fromCharCode(...view.slice(8, 12)) !== "WEBP") throw new Error("Converted file is not a valid WebP image");
          const key = randomToken(12) + ".webp";
          await env.PRODUCT_IMAGES.put(key, bytes, {
            httpMetadata: { contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable" }
          });
          return { source, url: new URL("/product-images/" + key, request.url).toString(), key, bytes: bytes.byteLength };
        } catch (error) {
          return { source, error: String(error.message || error).slice(0, 220) };
        }
      }));
      const results = outcomes.filter(item => item.url);
      const failures = outcomes.filter(item => !item.url);
      return json({ ok: true, images: results, failures }, 201);
    }

    // Keep this Worker callback deployment in sync with the ACC_CONTENTS_TOKEN repository secret.
    if (url.pathname === "/internal/publish-callback" && request.method === "POST") {
      const supplied = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
      if (!env.ACC_CONTENTS_TOKEN || supplied !== env.ACC_CONTENTS_TOKEN) return json({ error: "Forbidden" }, 403);
      let payload;
      try { payload = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const id = Number(payload?.id);
      if (!Number.isInteger(id) || id < 1 || typeof payload.success !== "boolean") return json({ error: "Invalid callback payload" }, 400);
      const status = payload.success ? "published" : "failed";
      const result = await env.DB.prepare("UPDATE import_items SET is_published = CASE WHEN ? = 1 THEN 1 ELSE is_published END, publish_status = ?, publish_commit_sha = ? WHERE id = ?")
        .bind(payload.success ? 1 : 0, status, String(payload.commit_sha || "").slice(0, 80), id).run();
      if (!result.meta?.changes) return json({ error: "Item not found" }, 404);
      return json({ ok: true, id, publish_status: status });
    }

    if (url.pathname.startsWith("/admin/")) return withCors(await handleAdmin(request, env, url), request);
    if ((request.method === "GET" && (url.pathname === "/account/me" || url.pathname === "/account/cart")) ||
        (request.method === "PUT" && url.pathname === "/account/cart") ||
        (request.method === "POST" && url.pathname === "/auth/logout")) {
      return withCors(await handleAccount(request, env, url), request);
    }
    if (request.method === "GET" && (url.pathname === "/account.html" || url.pathname === "/account")) {
      return Response.redirect("https://allacontactical.com.ua/account.html", 302);
    }
    return withCors(new Response("Not found", { status: 404 }), request);
  }
};
