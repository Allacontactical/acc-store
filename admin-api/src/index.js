const encoder = new TextEncoder();
const json = (data, status=200, extra={}) => new Response(JSON.stringify(data), {status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...extra}});
const cors = request => {
  const origin=request.headers.get("Origin")||"";
  const allowed=["https://allacontactical.com.ua","https://www.allacontactical.com.ua","https://allacontactical.github.io"];
  return allowed.includes(origin)?{"Access-Control-Allow-Origin":origin,"Vary":"Origin"}:{};
};
const bytesToB64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const b64ToBytes = value => Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((value.length+3)%4)),c=>c.charCodeAt(0));
async function hmac(secret, value){
  const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC",key,encoder.encode(value)));
}
function equal(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
async function makeToken(env){
  const payload=String(Date.now()+8*60*60*1000)+"."+crypto.randomUUID();
  return bytesToB64(encoder.encode(payload))+"."+bytesToB64(await hmac(env.SESSION_SECRET,payload));
}
async function authorized(request,env){
  const header=request.headers.get("Authorization")||"";
  if(!header.startsWith("Bearer "))return false;
  const parts=header.slice(7).split(".");if(parts.length!==2)return false;
  try{
    const payload=new TextDecoder().decode(b64ToBytes(parts[0]));
    const [expiry]=payload.split(".");
    if(Number(expiry)<Date.now())return false;
    const expected=await hmac(env.SESSION_SECRET,payload);
    const supplied=b64ToBytes(parts[1]);
    if(expected.length!==supplied.length)return false;
    return crypto.subtle.verify("HMAC",await crypto.subtle.importKey("raw",encoder.encode(env.SESSION_SECRET),{name:"HMAC",hash:"SHA-256"},false,["verify"]),supplied,encoder.encode(payload));
  }catch{return false;}
}
async function requireAdmin(request,env){return authorized(request,env);}
function cleanProduct(p){
  const id=String(p.id||crypto.randomUUID());
  const title=String(p.title||"").trim();
  const price=Number(p.price);
  const category=String(p.category||"").trim();
  if(!title||!category||!Number.isFinite(price)||price<0)throw new Error("Проверь название, категорию и цену.");
  const images=Array.isArray(p.images)?p.images.filter(x=>typeof x==="string").slice(0,10):[];
  return {...p,id,title,price,category,images,image:images[0]||String(p.image||""),currency:"UAH",updated_at:new Date().toISOString()};
}
async function bootstrap(env){
  const existing=await env.DB.prepare("SELECT COUNT(*) AS n FROM products").first();
  if(Number(existing?.n||0)>0)return {imported:0,already_initialized:true};
  const response=await fetch(env.CATALOG_SOURCE_URL);
  if(!response.ok)throw new Error("Не удалось получить исходный каталог.");
  const products=await response.json();if(!Array.isArray(products))throw new Error("Исходный каталог имеет неверный формат.");
  const statements=products.map(p=>env.DB.prepare("INSERT OR IGNORE INTO products (id,data,published,updated_at) VALUES (?,?,?,?)").bind(String(p.id),JSON.stringify(p),1,new Date().toISOString()));
  for(let i=0;i<statements.length;i+=50)await env.DB.batch(statements.slice(i,i+50));
  return {imported:products.length};
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);const path=url.pathname;
  if(path==="/admin"||path==="/admin/")return env.ASSETS.fetch(new Request(new URL("/index.html",url),request));
  if(path==="/api/catalog"&&request.method==="GET"){
   const rows=await env.DB.prepare("SELECT data FROM products WHERE published=1 ORDER BY updated_at DESC").all();
   return json((rows.results||[]).map(r=>JSON.parse(r.data)),200,cors(request));
  }
  if(path.startsWith("/api/")){
   if(request.method==="POST"&&path==="/api/login"){
    let body;try{body=await request.json();}catch{return json({error:"Некорректный запрос."},400);}
    if(!env.ADMIN_PASSWORD||!env.SESSION_SECRET)return json({error:"Панель ещё не настроена."},503);
    const ip=request.headers.get("CF-Connecting-IP")||"unknown";
    const attempt=await env.DB.prepare("SELECT attempts,first_attempt FROM login_attempts WHERE ip=?").bind(ip).first();
    const now=Date.now();
    if(attempt&&now-Number(attempt.first_attempt)<900000&&Number(attempt.attempts)>=5)return json({error:"Слишком много попыток. Подождите 15 минут."},429);
    if(!equal(String(body.password||""),env.ADMIN_PASSWORD)){
      if(attempt&&now-Number(attempt.first_attempt)<900000){
        await env.DB.prepare("UPDATE login_attempts SET attempts=attempts+1 WHERE ip=?").bind(ip).run();
      }else{
        await env.DB.prepare("INSERT INTO login_attempts (ip,attempts,first_attempt) VALUES (?,1,?) ON CONFLICT(ip) DO UPDATE SET attempts=1,first_attempt=excluded.first_attempt").bind(ip,now).run();
      }
      return json({error:"Неверный пароль."},401);
    }
    await env.DB.prepare("DELETE FROM login_attempts WHERE ip=?").bind(ip).run();
    return json({token:await makeToken(env)});
   }
   if(!await requireAdmin(request,env))return json({error:"Требуется вход в панель."},401);
   try{
    if(path==="/api/bootstrap"&&request.method==="POST")return json(await bootstrap(env));
    if(path==="/api/products"&&request.method==="GET"){
      const rows=await env.DB.prepare("SELECT data,published FROM products ORDER BY updated_at DESC").all();
      return json((rows.results||[]).map(r=>({...JSON.parse(r.data),published:!!r.published})));
    }
    if(path==="/api/products"&&request.method==="POST"){
      const p=cleanProduct(await request.json());
      await env.DB.prepare("INSERT INTO products (id,data,published,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,published=excluded.published,updated_at=excluded.updated_at")
       .bind(p.id,JSON.stringify(p),p.published===false?0:1,p.updated_at).run();
      return json({ok:true,id:p.id});
    }
    const match=path.match(/^\/api\/products\/([^/]+)$/);
    if(match&&request.method==="DELETE"){
      await env.DB.prepare("UPDATE products SET published=0,updated_at=? WHERE id=?").bind(new Date().toISOString(),decodeURIComponent(match[1])).run();
      return json({ok:true});
    }
    if(path==="/api/upload"&&request.method==="POST"){
      const form=await request.formData();const file=form.get("file");
      if(!file||typeof file==="string")return json({error:"Файл не найден."},400);
      if(!["image/jpeg","image/png","image/webp"].includes(file.type))return json({error:"Поддерживаются JPG, PNG и WebP."},415);
      if(file.size>8*1024*1024)return json({error:"Размер одного фото не должен превышать 8 МБ."},413);
      const ext=file.type==="image/png"?"png":file.type==="image/webp"?"webp":"jpg";
      const key=crypto.randomUUID()+"."+ext;
      await env.MEDIA.put(key,file.stream(),{httpMetadata:{contentType:file.type,cacheControl:"public, max-age=31536000, immutable"}});
      return json({url:new URL("/media/"+key,request.url).toString()});
    }
   }catch(error){return json({error:error.message||"Внутренняя ошибка."},400);}
   return json({error:"Маршрут не найден."},404);
  }
  if(path.startsWith("/media/")){
   const key=decodeURIComponent(path.slice(7));const object=await env.MEDIA.get(key);
   if(!object)return new Response("Not found",{status:404});
   const headers=new Headers();object.writeHttpMetadata(headers);headers.set("etag",object.httpEtag);
   return new Response(object.body,{headers});
  }
  return env.ASSETS.fetch(request);
 }
};