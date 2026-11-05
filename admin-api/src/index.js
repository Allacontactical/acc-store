const ALLOWED_ORIGINS = new Set([
  "https://allacontactical.com.ua",
  "https://www.allacontactical.com.ua",
  "https://allacontactical.github.io"
]);
let jwksCache = null;
let jwksFetchedAt = 0;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });
}
function cors(request) {
  const origin = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://allacontactical.com.ua",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,CF-Access-JWT-Assertion",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
function withCors(response, request) {
  const headers = new Headers(response.headers);
  for (const [k,v] of Object.entries(cors(request))) headers.set(k,v);
  return new Response(response.body, {status:response.status,headers});
}
function b64url(value) {
  const normalized = value.replace(/-/g,"+").replace(/_/g,"/");
  const padded = normalized + "=".repeat((4-normalized.length%4)%4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}
async function verifyAdmin(request, env) {
  // Fail closed until Cloudflare Access is configured for the admin API hostname.
  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD || !env.ADMIN_EMAIL) return false;
  const token = request.headers.get("CF-Access-JWT-Assertion");
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  let header, claims;
  try {
    header = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
  } catch { return false; }
  const issuer = "https://" + env.CF_ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//,"").replace(/\/$/,"");
  if (claims.iss !== issuer || !Array.isArray(claims.aud) || !claims.aud.includes(env.CF_ACCESS_AUD)) return false;
  if (!claims.exp || claims.exp <= Math.floor(Date.now()/1000)) return false;
  if (String(claims.email || "").toLowerCase() !== String(env.ADMIN_EMAIL).toLowerCase()) return false;
  if (header.alg !== "RS256" || !header.kid) return false;
  try {
    if (!jwksCache || Date.now()-jwksFetchedAt > 3600000) {
      const response = await fetch(issuer + "/cdn-cgi/access/certs", {cf:{cacheTtl:3600}});
      if (!response.ok) return false;
      jwksCache = await response.json();
      jwksFetchedAt = Date.now();
    }
    const jwk = jwksCache.keys.find(k => k.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
    const signed = new TextEncoder().encode(parts[0]+"."+parts[1]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,b64url(parts[2]),signed);
  } catch { return false; }
}
function uid() { return crypto.randomUUID(); }
async function audit(env,email,action,productId,details={}) {
  await env.DB.prepare(
    "INSERT INTO acc_admin_audit (id,admin_email,action,product_id,details_json) VALUES (?,?,?,?,?)"
  ).bind(uid(),email,action,productId||null,JSON.stringify(details)).run();
}
async function listProducts(env,url) {
  const status = url.searchParams.get("status");
  const q = (url.searchParams.get("q")||"").trim().slice(0,120);
  let sql = "SELECT * FROM acc_admin_products WHERE 1=1";
  const binds = [];
  if (status) { sql += " AND status = ?"; binds.push(status); }
  if (q) { sql += " AND (title LIKE ? OR category LIKE ? OR source_product_id LIKE ?)"; binds.push("%"+q+"%","%"+q+"%","%"+q+"%"); }
  sql += " ORDER BY updated_at DESC LIMIT 500";
  const rows = await env.DB.prepare(sql).bind(...binds).all();
  const products = [];
  for (const p of rows.results||[]) {
    const imgs = await env.DB.prepare("SELECT id,sort_order FROM acc_admin_product_images WHERE product_id=? ORDER BY sort_order,id").bind(p.id).all();
    let legacy={}; try { legacy=JSON.parse(p.legacy_json||"{}"); } catch {}
    products.push({...p,legacy_images:Array.isArray(legacy.images)?legacy.images.filter(x=>typeof x==="string"&&/^https:\/\//i.test(x)):[],images:(imgs.results||[]).map(x=>({id:x.id,url:"/admin/media/"+x.id,sort_order:x.sort_order}))});
  }
  return products;
}
async function publicProducts(env) {
  const rows=await env.DB.prepare("SELECT * FROM acc_admin_products WHERE status IN ('active','expected','out_of_stock') ORDER BY sort_order ASC,updated_at DESC LIMIT 1000").all();
  const output=[];
  for (const p of rows.results||[]) {
    let legacy={}; try { legacy=JSON.parse(p.legacy_json||"{}"); } catch {}
    const uploaded=await env.DB.prepare("SELECT id,sort_order FROM acc_admin_product_images WHERE product_id=? ORDER BY sort_order,id").bind(p.id).all();
    const oldImages=Array.isArray(legacy.images)?legacy.images.filter(x=>typeof x==="string"&&/^https:\/\//i.test(x)):[];\n    if (!oldImages.length && typeof legacy.image==="string" && /^https:\/\//i.test(legacy.image)) oldImages.push(legacy.image);
    const newImages=(uploaded.results||[]).map(x=>"https://admin.allacontactical.com.ua/media/"+x.id);
    const images=[...oldImages,...newImages];
    output.push({
      id:(p.source_product_id||p.id),admin_id:p.id,title:p.title,price:p.price,currency:p.currency||"UAH",category:p.category||"",
      image:images[0]||"",images,url:legacy.url||"https://allacontactical.com.ua/catalog.html",
      availability:p.status==="expected"?"Очікується":p.status==="out_of_stock"?"Немає в наявності":(legacy.availability||"В наявності"),
      availability_status:p.status==="expected"?"expected":p.status,
      description:p.description||"",description_ru:p.description_ru||""
    });
  }
  return output;
}
async function handleAdmin(request,env,url,email) {
  if (!env.DB || !env.PRODUCT_IMAGES) return json({error:"Admin storage is not configured"},503);
  const path = url.pathname.replace(/^\/admin\/?/,"");
  if (request.method==="GET" && (path==="" || path==="products")) {
    return json({products:await listProducts(env,url)});
  }
  if (request.method==="POST" && (path==="" || path==="products")) {
    let p; try { p=await request.json(); } catch { return json({error:"Invalid JSON"},400); }
    const title=String(p.title||"").trim();
    const price=p.price===null||p.price===""?null:Number(p.price);
    if (!title || title.length>250 || (price!==null&&(!Number.isFinite(price)||price<0)) || !["active","expected","out_of_stock","review"].includes(p.status||"review")) return json({error:"Invalid product fields"},400);
    const id=uid();
    await env.DB.prepare("INSERT INTO acc_admin_products (id,title,price,currency,category,description,description_ru,status,source,source_product_id,source_url) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id,title,price,String(p.currency||"UAH").slice(0,8),String(p.category||"").slice(0,180),String(p.description||"").slice(0,12000),String(p.description_ru||"").slice(0,12000),p.status||"review","manual",null,null).run();
    await audit(env,email,"product_create",id);
    return json({id},201);
  }
  const imageDelete=path.match(/^products\/([0-9a-f-]{36})\/images\/([0-9a-f-]{36})$/i);
  if (imageDelete && request.method==="DELETE") {
    const productId=imageDelete[1], imageId=imageDelete[2];
    const image=await env.DB.prepare("SELECT object_key FROM acc_admin_product_images WHERE id=? AND product_id=?").bind(imageId,productId).first();
    if (!image) return json({error:"Image not found"},404);
    await env.DB.prepare("DELETE FROM acc_admin_product_images WHERE id=? AND product_id=?").bind(imageId,productId).run();
    await env.PRODUCT_IMAGES.delete(image.object_key);
    await audit(env,email,"image_delete",productId,{imageId});
    return json({ok:true});
  }
  const imageOrder=path.match(/^products\/([0-9a-f-]{36})\/images$/i);
  if (imageOrder && request.method==="PATCH") {
    const productId=imageOrder[1]; let body;
    try { body=await request.json(); } catch { return json({error:"Invalid JSON"},400); }
    if (!Array.isArray(body.order) || body.order.length>10 || new Set(body.order).size!==body.order.length || body.order.some(x=>typeof x!=="string")) return json({error:"Invalid image order"},400);
    const existing=await env.DB.prepare("SELECT id FROM acc_admin_product_images WHERE product_id=?").bind(productId).all();
    const ids=(existing.results||[]).map(x=>x.id);
    if (ids.length!==body.order.length || ids.some(x=>!body.order.includes(x))) return json({error:"Image order must include every current photo exactly once"},400);
    for (let n=0;n<body.order.length;n++) await env.DB.prepare("UPDATE acc_admin_product_images SET sort_order=? WHERE id=? AND product_id=?").bind(n,body.order[n],productId).run();
    await audit(env,email,"image_reorder",productId,{order:body.order});
    return json({ok:true});
  }
  const match=path.match(/^products\/([0-9a-f-]{36})(?:\/(images|restore))?$/i);
  if (match) {
    const id=match[1], action=match[2]||"";
    const existing=await env.DB.prepare("SELECT id FROM acc_admin_products WHERE id=?").bind(id).first();
    if (!existing) return json({error:"Product not found"},404);
    if (request.method==="PATCH" && !action) {
      let p; try {p=await request.json();} catch {return json({error:"Invalid JSON"},400);}
      const allowed=["title","price","currency","category","description","description_ru","status","sort_order"];
      const fields=allowed.filter(k=>Object.hasOwn(p,k));
      if (!fields.length) return json({error:"No editable fields"},400);
      if (Object.hasOwn(p,"title") && (!String(p.title).trim()||String(p.title).length>250)) return json({error:"Invalid title"},400);
      if (Object.hasOwn(p,"price") && p.price!==null && (!Number.isFinite(Number(p.price))||Number(p.price)<0)) return json({error:"Invalid price"},400);
      if (Object.hasOwn(p,"status") && !["active","expected","out_of_stock","review","archived"].includes(p.status)) return json({error:"Invalid status"},400);
      const sets=fields.map(k=>k+"=?");
      const vals=fields.map(k=>p[k]);
      sets.push("updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')");
      await env.DB.prepare("UPDATE acc_admin_products SET "+sets.join(",")+" WHERE id=?").bind(...vals,id).run();
      await audit(env,email,"product_update",id,{fields});
      return json({ok:true});
    }
    if (request.method==="DELETE" && !action) {
      await env.DB.prepare("UPDATE acc_admin_products SET status='archived',archived_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(id).run();
      await audit(env,email,"product_archive",id);
      return json({ok:true});
    }
    if (request.method==="POST" && action==="restore") {
      await env.DB.prepare("UPDATE acc_admin_products SET status='review',archived_at=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='archived'").bind(id).run();
      await audit(env,email,"product_restore",id);
      return json({ok:true});
    }
    if (request.method==="POST" && action==="images") {
      const form=await request.formData();
      const file=form.get("file");
      if (!file || typeof file.arrayBuffer!=="function" || file.type!=="image/webp" || file.size<1 || file.size>8*1024*1024) return json({error:"Upload only normalized WebP images up to 8 MB"},400);
      const bytes=await file.arrayBuffer();
      const sig=new Uint8Array(bytes.slice(0,12));
      if (String.fromCharCode(...sig.slice(0,4))!=="RIFF" || String.fromCharCode(...sig.slice(8,12))!=="WEBP") return json({error:"Invalid WebP file"},400);
      const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM acc_admin_product_images WHERE product_id=?").bind(id).first();
      const current=await env.DB.prepare("SELECT legacy_json FROM acc_admin_products WHERE id=?").bind(id).first();
      let legacyCount=0; try { legacyCount=JSON.parse(current?.legacy_json||"{}").images?.filter(x=>typeof x==="string").length||0; } catch {}
      if ((count?.n||0)+legacyCount>=10) return json({error:"Maximum 10 photos per product, including imported photos"},400);
      const imageId=uid(), key="products/"+id+"/"+imageId+".webp";
      await env.PRODUCT_IMAGES.put(key,bytes,{httpMetadata:{contentType:"image/webp",cacheControl:"public, max-age=31536000, immutable"}});
      try {
        await env.DB.prepare("INSERT INTO acc_admin_product_images (id,product_id,object_key,content_type,byte_size,sort_order) VALUES (?,?,?,?,?,?)")
          .bind(imageId,id,key,"image/webp",file.size,(count?.n||0)+legacyCount).run();
      } catch(e) { await env.PRODUCT_IMAGES.delete(key); throw e; }
      await audit(env,email,"image_upload",id,{imageId,bytes:file.size});
      return json({id:imageId},201);
    }
  }
  return json({error:"Not found"},404);
}
async function handleMedia(request,env,id) {
  const row=await env.DB.prepare("SELECT i.object_key,i.content_type FROM acc_admin_product_images i JOIN acc_admin_products p ON p.id=i.product_id WHERE i.id=? AND p.status IN ('active','expected','out_of_stock')").bind(id).first();
  if (!row) return new Response("Not found",{status:404});
  const obj=await env.PRODUCT_IMAGES.get(row.object_key);
  if (!obj) return new Response("Not found",{status:404});
  return new Response(obj.body,{headers:{"Content-Type":row.content_type,"Cache-Control":"public, max-age=86400","X-Content-Type-Options":"nosniff"}});
}

async function handleAdminMedia(env,id) {
  const row=await env.DB.prepare("SELECT i.object_key,i.content_type FROM acc_admin_product_images i WHERE i.id=?").bind(id).first();
  if (!row) return new Response("Not found",{status:404});
  const obj=await env.PRODUCT_IMAGES.get(row.object_key);
  if (!obj) return new Response("Not found",{status:404});
  return new Response(obj.body,{headers:{"Content-Type":row.content_type,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}

export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if (url.pathname==="/panel" || url.pathname==="/panel/" || url.pathname.startsWith("/panel/")) {
      const assetUrl=new URL(request.url);
      assetUrl.pathname=(url.pathname==="/panel" || url.pathname==="/panel/")?"/index.html":url.pathname.slice("/panel".length);
      return env.ASSETS.fetch(new Request(assetUrl,request));
    }
    if (request.method==="OPTIONS") return new Response(null,{status:204,headers:cors(request)});
    if (url.pathname==="/public/products" && request.method==="GET") { try { return withCors(json({products:await publicProducts(env)}),request); } catch { return withCors(json({error:"Catalog temporarily unavailable"},503),request); } }
    if (url.pathname.startsWith("/media/") && request.method==="GET") return handleMedia(request,env,url.pathname.split("/").pop());
    if (!url.pathname.startsWith("/admin")) return withCors(json({error:"Not found"},404),request);
    if (!await verifyAdmin(request,env)) return withCors(json({error:"Unauthorized"},401),request);
    try {
      const email=String(env.ADMIN_EMAIL).toLowerCase();
      if (url.pathname.startsWith("/admin/media/") && request.method==="GET") return withCors(await handleAdminMedia(env,url.pathname.split("/").pop()),request);
      return withCors(await handleAdmin(request,env,url,email),request);
    } catch(e) {
      return withCors(json({error:"Internal server error"},500),request);
    }
  }
};