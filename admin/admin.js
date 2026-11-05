(function(){
"use strict";
const API=(window.ACC_ADMIN_API_URL||window.location.origin).replace(/\/$/,"");
const $=id=>document.getElementById(id);
let products=[],editingId=null;
const labels={active:"В наявності",expected:"Очікується",out_of_stock:"Немає в наявності",review:"На перевірці",archived:"Архів"};
function message(text,isError=false){$("message").textContent=text;$("message").style.color=isError?"#ff9b8f":"#f28c28";}
async function api(path,options={}){
 if(!API)throw new Error("Не задано адресу Admin API. Панель ще не підключена до захищеного Worker.");
 const headers=new Headers(options.headers||{});
 if(options.body && !(options.body instanceof FormData))headers.set("Content-Type","application/json");
 const response=await fetch(API+path,{...options,headers,credentials:"include",cache:"no-store"});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||("Помилка API: "+response.status));
 return data;
}
function esc(s){return String(s??"");}
function render(){
 const q=$("search").value.trim().toLocaleLowerCase("uk-UA"),status=$("filter").value;
 const rows=products.filter(p=>(!status||p.status===status)&&(!q||[p.title,p.category,p.source_product_id].join(" ").toLocaleLowerCase("uk-UA").includes(q)));
 const root=$("products");root.textContent="";
 if(!rows.length){const p=document.createElement("p");p.className="muted";p.textContent="Товарів за цими умовами не знайдено.";root.append(p);return;}
 rows.forEach(p=>{
  const card=document.createElement("article");card.className="item";
  const info=document.createElement("div"),h=document.createElement("h3"),meta=document.createElement("p");
  h.textContent=p.title;meta.textContent=(p.category||"Без категорії")+" · "+(p.price==null?"Ціна не вказана":Number(p.price).toLocaleString("uk-UA")+" грн")+" · "+(labels[p.status]||p.status)+" · фото: "+((p.legacy_images||[]).length+(p.images||[]).length);
  info.append(h,meta);const actions=document.createElement("div");actions.className="actions";
  const edit=document.createElement("button");edit.className="btn";edit.textContent="Редагувати";edit.onclick=()=>openEditor(p);
  actions.append(edit);
  if(p.status==="archived"){const restore=document.createElement("button");restore.className="btn secondary";restore.textContent="Відновити";restore.onclick=()=>restoreProduct(p.id);actions.append(restore);}
  else{const archive=document.createElement("button");archive.className="btn danger";archive.textContent="В архів";archive.onclick=()=>archiveProduct(p.id);actions.append(archive);}
  card.append(info,actions);root.append(card);
 });
}
async function load(){
 try{message("Оновлюю список товарів…");const data=await api("/admin/products");products=data.products||[];render();message("Завантажено товарів: "+products.length);}
 catch(e){message(e.message,true);$("products").textContent="";const p=document.createElement("p");p.className="muted";p.textContent="Список недоступний. Перевірте налаштування захищеного API."; $("products").append(p);}
}
function resetEditor(){editingId=null;$("productForm").reset();$("editor").classList.add("hidden");$("photoSection").classList.add("hidden");$("photos").textContent="";$("photoFiles").value="";}
function openEditor(p){
 editingId=p?.id||null;$("editorTitle").textContent=p?"Редагування товару":"Новий товар";
 $("title").value=p?.title||"";$("price").value=p?.price??"";$("status").value=p?.status||"review";
 $("category").value=p?.category||"";$("description").value=p?.description||"";$("descriptionRu").value=p?.description_ru||"";
 $("editor").classList.remove("hidden");$("photoSection").classList.toggle("hidden",!editingId);
 $("photos").textContent="";
 (p?.legacy_images||[]).forEach(url=>{const wrap=document.createElement("div");const el=document.createElement("img");el.alt="Імпортоване фото з поточного каталогу";el.src=url;wrap.append(el);const note=document.createElement("small");note.className="muted";note.textContent="Поточне фото";wrap.append(note);$("photos").append(wrap);});
 (p?.images||[]).forEach((img,index)=>{
  const wrap=document.createElement("div");wrap.style.display="grid";wrap.style.gap="4px";
  const el=document.createElement("img");el.alt="Фото товару";el.src=API+img.url;wrap.append(el);
  const controls=document.createElement("div");controls.className="actions";
  const left=document.createElement("button");left.type="button";left.className="btn secondary";left.textContent="←";left.disabled=index===0;
  left.onclick=()=>moveImage(p.id,index,-1);
  const right=document.createElement("button");right.type="button";right.className="btn secondary";right.textContent="→";right.disabled=index===(p.images.length-1);
  right.onclick=()=>moveImage(p.id,index,1);
  const del=document.createElement("button");del.type="button";del.className="btn danger";del.textContent="×";del.title="Видалити фото";
  del.onclick=()=>deleteImage(p.id,img.id);
  controls.append(left,right,del);wrap.append(controls);$("photos").append(wrap);
 });
 $("editor").scrollIntoView({behavior:"smooth",block:"start"});
}
async function save(e){
 e.preventDefault();const payload={title:$("title").value.trim(),price:$("price").value===""?null:Number($("price").value),status:$("status").value,category:$("category").value,description:$("description").value,description_ru:$("descriptionRu").value};
 try{
  if(editingId)await api("/admin/products/"+editingId,{method:"PATCH",body:JSON.stringify(payload)});
  else await api("/admin/products",{method:"POST",body:JSON.stringify(payload)});
  message("Товар збережено.");resetEditor();await load();
 }catch(err){message(err.message,true);}
}
async function moveImage(productId,index,delta){
 try{const p=products.find(x=>x.id===productId);const order=(p.images||[]).map(x=>x.id);const target=index+delta;[order[index],order[target]]=[order[target],order[index]];
 await api("/admin/products/"+productId+"/images",{method:"PATCH",body:JSON.stringify({order})});await load();openEditor(products.find(x=>x.id===productId));}
 catch(e){message(e.message,true);}
}
async function deleteImage(productId,imageId){
 if(!confirm("Видалити це фото?"))return;
 try{await api("/admin/products/"+productId+"/images/"+imageId,{method:"DELETE"});await load();openEditor(products.find(x=>x.id===productId));}
 catch(e){message(e.message,true);}
}
async function archiveProduct(id){if(!confirm("Перемістити товар в архів? Його можна буде відновити."))return;try{await api("/admin/products/"+id,{method:"DELETE"});message("Товар переміщено в архів.");await load();}catch(e){message(e.message,true);}}
async function restoreProduct(id){try{await api("/admin/products/"+id+"/restore",{method:"POST"});message("Товар відновлено зі статусом «На перевірці».");await load();}catch(e){message(e.message,true);}}
async function toWebP(file){
 const bitmap=await createImageBitmap(file);
 const max=2000,scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
 const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
 const ctx=canvas.getContext("2d");ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",0.86));
 if(!blob)throw new Error("Не вдалося обробити фото.");
 if(blob.size>8*1024*1024)throw new Error("Фото після конвертації перевищує 8 МБ.");
 return blob;
}
async function uploadPhotos(files){
 if(!editingId)return;
 try{
  const product=products.find(p=>p.id===editingId);let count=(product?.legacy_images?.length||0)+(product?.images?.length||0);
  for(const file of files){
   if(count>=10)throw new Error("Максимум 10 фотографій на товар.");
   if(!/^image\/(jpeg|png|webp)$/.test(file.type))throw new Error("Підтримуються JPG, PNG і WebP.");
   const blob=await toWebP(file),form=new FormData();form.append("file",blob,file.name.replace(/\.[^.]+$/,"")+".webp");
   await api("/admin/products/"+editingId+"/images",{method:"POST",body:form});count++;
  }
  message("Фотографії завантажено та конвертовано у WebP.");await load();
  const p=products.find(x=>x.id===editingId);openEditor(p);
 }catch(e){message(e.message,true);}
}
function parsePromCSV(text){
 const rows=[];let row=[],field="",quoted=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}else if(ch==='"')quoted=false;else field+=ch;continue;}
  if(ch==='"'){quoted=true;continue;}
  if(ch===","){row.push(field);field="";continue;}
  if(ch==="\r"||ch==="\n"){if(ch==="\r"&&text[i+1]==="\n")i++;row.push(field);field="";if(row.some(x=>x!==""))rows.push(row);row=[];continue;}
  field+=ch;
 }
 if(field!==""||row.length){row.push(field);rows.push(row);}
 return rows;
}
function promPlainText(value){
 return String(value||"").replace(/<br\s*\/?\s*>/gi,"\n").replace(/<\/p\s*>/gi,"\n\n").replace(/<[^>]*>/g,"").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&ndash;/gi,"–").replace(/&mdash;/gi,"—").trim();
}
function promRowsFromCSV(text){
 const rows=parsePromCSV(text);if(rows.length<2)throw new Error("CSV не містить рядків товарів.");
 const headers=rows[0].map(x=>String(x||"").replace(/^\uFEFF/,"").trim());
 const idx=name=>headers.indexOf(name);
 const get=(row,name)=>{const n=idx(name);return n<0?"":String(row[n]??"").trim();};
 const items=[];let skipped=0;
 for(const row of rows.slice(1)){
  const url=get(row,"Продукт_на_сайті");
  const idValue=get(row,"Ідентифікатор_товару")||get(row,"Унікальний_ідентифікатор")||get(row,"Код_товару");
  const fromUrl=(url.match(/\/p(\d{5,20})[-./]/i)||[])[1]||"";
  const sourceId=(idValue.match(/\d{1,20}/)||[])[0]||fromUrl;
  const title=get(row,"Назва_позиції_укр")||get(row,"Назва_позиції");
  if(!sourceId||!title){skipped++;continue;}
  const rawPrice=get(row,"Ціна").replace(/\s/g,"").replace(",",".");
  const price=rawPrice&&Number.isFinite(Number(rawPrice))?Number(rawPrice):null;
  const imageCell=get(row,"Посилання_зображення");
  const images=(imageCell.match(/https?:\/\/[^\s;,|]+/gi)||[]).slice(0,10);
  items.push({
   source_product_id:sourceId,title:title.slice(0,250),price,currency:get(row,"Валюта")||"UAH",
   category:get(row,"Назва_групи"),description:promPlainText(get(row,"Опис_укр")||get(row,"Опис")),
   description_ru:promPlainText(get(row,"Опис")),images,url,
   availability:get(row,"Наявність")
  });
 }
 return {items,total:rows.length-1,skipped};
}
async function stagePromCSV(){
 const file=$("promFile").files?.[0];if(!file){$("promImportStatus").textContent="Спочатку виберіть CSV-файл Prom.ua.";return;}
 if(file.size>15*1024*1024){$("promImportStatus").textContent="Файл завеликий. Максимум 15 МБ.";return;}
 const button=$("stagePromImport");button.disabled=true;
 try{
  $("promImportStatus").textContent="Читаю CSV та перевіряю рядки…";
  const buffer=await file.arrayBuffer();let decoded=new TextDecoder("utf-8").decode(buffer);
  if(decoded.includes("�"))decoded=new TextDecoder("windows-1251").decode(buffer);
  const parsed=promRowsFromCSV(decoded);
  if(!parsed.items.length)throw new Error("Не знайдено товарів із числовим ID та назвою. Перевірте формат експорту.");
  $("promImportStatus").textContent="Передаю "+parsed.items.length+" товарів у чергу перевірки…";
  const result=await api("/admin/imports/prom",{method:"POST",body:JSON.stringify({filename:file.name,items:parsed.items})});
  $("promImportStatus").textContent="Готово: у чергу додано "+result.staged+" товарів; уже є в ACC: "+result.matched_existing+"; нових: "+result.new_products+"; пропущено рядків CSV: "+parsed.skipped+". Нічого не опубліковано автоматично.";
  await loadReviewQueue();await load();
 }catch(e){$("promImportStatus").textContent=e.message;}
 finally{button.disabled=false;}
}
async function loadReviewQueue(){
 const root=$("promReviewItems");if(!root)return;
 try{
  const data=await api("/admin/imports/pending");root.textContent="";
  const items=data.items||[];
  if(!items.length){const p=document.createElement("p");p.className="muted";p.textContent="Черга перевірки порожня.";root.append(p);return;}
  items.forEach(item=>{
   const card=document.createElement("article");card.className="item";
   const info=document.createElement("div"),h=document.createElement("h3"),meta=document.createElement("p");
   h.textContent=item.title;meta.textContent="Prom ID: "+item.source_product_id+" · "+(item.existing_product_id?"Товар уже є в ACC":"Новий товар")+" · "+(item.payload?.price==null?"Ціна не вказана":item.payload.price+" "+(item.payload.currency||"UAH"))+" · "+(item.payload?.images?.length||0)+" фото";
   info.append(h,meta);const actions=document.createElement("div");actions.className="actions";
   const approve=document.createElement("button");approve.className="btn";approve.textContent="Підтвердити";
   approve.onclick=()=>reviewPromItem(item.id,"approve");
   const reject=document.createElement("button");reject.className="btn danger";reject.textContent="Відхилити";
   reject.onclick=()=>reviewPromItem(item.id,"reject");
   actions.append(approve,reject);card.append(info,actions);root.append(card);
  });
 }catch(e){root.textContent="";const p=document.createElement("p");p.className="muted";p.textContent="Не вдалося завантажити чергу: "+e.message;root.append(p);}
}
async function reviewPromItem(id,decision){
 try{await api("/admin/imports/items/"+id+"/"+decision,{method:"POST"});message(decision==="approve"?"Імпортований товар підтверджено. Нові товари залишаються зі статусом «На перевірці».":"Рядок імпорту відхилено.");await loadReviewQueue();await load();}
 catch(e){message(e.message,true);}
}
$("newProduct").addEventListener("click",()=>openEditor(null));
$("closeEditor").addEventListener("click",resetEditor);$("cancelEdit").addEventListener("click",resetEditor);
$("productForm").addEventListener("submit",save);$("search").addEventListener("input",render);$("filter").addEventListener("change",render);
$("photoFiles").addEventListener("change",e=>uploadPhotos(Array.from(e.target.files||[])));
$("stagePromImport").addEventListener("click",stagePromCSV);
load();loadReviewQueue();
})();