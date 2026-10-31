(() => {
  "use strict";
  let token = "";
  let products = [];
  let currentImages = [];
  let selectedFiles = [];
  let previewUrls = [];
  const MAX_IMAGES = 10;
  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  const $ = id => document.getElementById(id);
  const loginPanel = $("loginPanel"), appPanel = $("appPanel"), notice = $("notice");
  const setNotice = (message, bad=false) => { notice.textContent=message; notice.style.color=bad?"#ff9e91":"#e3b27e"; };
  async function api(path, options={}) {
    const headers = new Headers(options.headers || {});
    if (token) headers.set("Authorization", "Bearer "+token);
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type","application/json");
    const response = await fetch(path,{...options,headers});
    const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) throw new Error(data?.error || data || "Ошибка запроса");
    return data;
  }
  function inferAvailability(product) {
    if (product.availability_status) return product.availability_status;
    const raw = String(product.availability || "").toLowerCase();
    if (/немає в наявності|нет в наличии|відсутн|отсутств/.test(raw)) return "out_of_stock";
    if (/очікується|ожидается/.test(raw)) return "expected";
    if (/під замовлення|под заказ/.test(raw)) return "preorder";
    if (/в наявності|в наличии/.test(raw)) return "in_stock";
    return "unknown";
  }
  function releasePreviewUrls() {
    previewUrls.forEach(url => URL.revokeObjectURL(url));
    previewUrls = [];
  }
  $("loginForm").addEventListener("submit",async event=>{
    event.preventDefault(); $("loginError").textContent="";
    try {
      const result=await api("/api/login",{method:"POST",body:JSON.stringify({password:$("password").value})});
      token=result.token; $("password").value=""; loginPanel.hidden=true; appPanel.hidden=false; await loadProducts();
    } catch(error){$("loginError").textContent=error.message;}
  });
  $("logoutBtn").addEventListener("click",()=>{token="";products=[];appPanel.hidden=true;loginPanel.hidden=false;});
  async function loadProducts(){
    setNotice("Загружаю каталог…");
    try {
      products=await api("/api/products");
      if(products.length===0){
        const imported=await api("/api/bootstrap",{method:"POST"});
        products=await api("/api/products");
        if(imported.imported) setNotice("Импортировано товаров: "+imported.imported);
      }
      $("productCount").textContent=products.length+" товаров";
      const categories=Array.from(new Set(products.map(p=>p.category).filter(Boolean)));
      $("categories").replaceChildren(...categories.map(name=>{const option=document.createElement("option");option.value=name;return option;}));
      renderList(); setNotice("Каталог загружен: "+products.length+" товаров.");
    } catch(error){setNotice(error.message,true);}
  }
  function renderList(){
    const q=$("search").value.trim().toLowerCase();
    const list=$("productList"); list.replaceChildren();
    products.filter(p=>(p.title||"").toLowerCase().includes(q)||String(p.id||"").includes(q)).forEach(p=>{
      const b=document.createElement("button"); b.className="product-item"+(String(p.id)===$("productId").value?" active":""); b.type="button";
      const strong=document.createElement("strong");strong.textContent=p.title||"Без названия";
      const small=document.createElement("small");small.textContent=(p.price??"—")+" грн · "+(p.category||"Без категории");
      b.append(strong,small);b.addEventListener("click",()=>editProduct(p));list.append(b);
    });
  }
  $("search").addEventListener("input",renderList);
  $("newProductBtn").addEventListener("click",()=>resetForm());
  function resetForm(){
    releasePreviewUrls();
    $("productForm").reset();$("productId").value="";$("editorTitle").textContent="Новый товар";$("editState").textContent="Черновик";$("archiveBtn").hidden=true;
    currentImages=[];selectedFiles=[];$("published").checked=false;renderPhotos();renderList();
  }
  function editProduct(p){
    releasePreviewUrls();
    $("productId").value=p.id||"";$("title").value=p.title||"";$("price").value=p.price??"";
    $("category").value=p.category||"";$("availability").value=inferAvailability(p);
    $("arrival").value=p.expected_arrival||"";$("variants").value=p.variants||p.sizes||"";$("productUrl").value=p.url||"";
    $("description").value=p.description||"";$("descriptionRu").value=p.description_ru||"";
    $("seoTitle").value=p.seo_title||"";$("seoDescription").value=p.seo_description||"";$("seoKeywords").value=Array.isArray(p.seo_keywords)?p.seo_keywords.join(", "):(p.seo_keywords||"");
    $("published").checked=p.published===true;$("editorTitle").textContent="Редактирование товара";$("editState").textContent="ID "+p.id;
    $("archiveBtn").hidden=false;
    currentImages=Array.isArray(p.images)?p.images.slice():(p.image?[p.image]:[]);
    selectedFiles=[];$("photos").value="";renderPhotos();renderList();
  }
  $("photos").addEventListener("change",()=>{
    const files=Array.from($("photos").files||[]);
    const allowed=["image/jpeg","image/png","image/webp"];
    if(files.some(file=>!allowed.includes(file.type))){setNotice("Поддерживаются только JPG, PNG и WebP.",true);$("photos").value="";return;}
    if(currentImages.length+files.length>MAX_IMAGES){setNotice("Всего в карточке может быть не более 10 фото. Сейчас сохранено: "+currentImages.length+".",true);$("photos").value="";return;}
    releasePreviewUrls();selectedFiles=files;renderPhotos();
  });
  function renderPhotos(){
    releasePreviewUrls();
    const grid=$("photoPreview");grid.replaceChildren();
    currentImages.forEach((src,index)=>addPhoto(src,()=>{currentImages.splice(index,1);renderPhotos();}));
    selectedFiles.forEach((file,index)=>{const url=URL.createObjectURL(file);previewUrls.push(url);addPhoto(url,()=>{selectedFiles.splice(index,1);$("photos").value="";renderPhotos();});});
    $("photoCount").textContent=(currentImages.length+selectedFiles.length)+" / 10 фото";
  }
  function addPhoto(src,remove){
    const box=document.createElement("div");box.className="photo";const img=document.createElement("img");img.src=src;img.alt="Фото товара";
    const btn=document.createElement("button");btn.type="button";btn.textContent="×";btn.title="Убрать фото";btn.addEventListener("click",remove);box.append(img,btn);$("photoPreview").append(box);
  }
  async function convertToWebP(file){
    let bitmap;
    try { bitmap=await createImageBitmap(file); }
    catch { throw new Error("Не удалось прочитать изображение: "+file.name); }
    const canvas=document.createElement("canvas");
    canvas.width=bitmap.width;canvas.height=bitmap.height;
    const context=canvas.getContext("2d");
    if(!context){bitmap.close?.();throw new Error("Браузер не поддерживает обработку фотографий.");}
    context.drawImage(bitmap,0,0);bitmap.close?.();
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",0.86));
    if(!blob||blob.type!=="image/webp")throw new Error("Браузер не смог преобразовать фото в WebP. Попробуй открыть панель в актуальном Chrome или Supermium.");
    if(blob.size<=0||blob.size>MAX_FILE_BYTES)throw new Error("После преобразования фото должно быть не больше 8 МБ: "+file.name);
    const base=file.name.replace(/\.[^.]+$/,"")||"photo";
    return new File([blob],base+".webp",{type:"image/webp",lastModified:Date.now()});
  }
  async function uploadSelected(){
    const urls=[];
    for(let i=0;i<selectedFiles.length;i++){
      setNotice("Преобразую фото в WebP и загружаю: "+(i+1)+" из "+selectedFiles.length+"…");
      const webp=await convertToWebP(selectedFiles[i]);
      const form=new FormData();form.append("file",webp,webp.name);
      const result=await api("/api/upload",{method:"POST",body:form});urls.push(result.url);
    }
    return urls;
  }
  $("productForm").addEventListener("submit",async event=>{
    event.preventDefault();const save=$("productForm").querySelector('button[type="submit"]');save.disabled=true;
    try{
      if(currentImages.length+selectedFiles.length>MAX_IMAGES)throw new Error("В карточке может быть не более 10 фото.");
      setNotice("Загружаю фотографии…");const uploaded=await uploadSelected();
      const id=$("productId").value||crypto.randomUUID();
      const availabilityStatus=$("availability").value;
      const availabilityLabels={unknown:"Уточнюйте актуальну наявність перед замовленням",in_stock:"В наявності",expected:"Очікується",out_of_stock:"Немає в наявності",preorder:"Під замовлення"};
      const existing=products.find(p=>String(p.id)===String(id));
      const images=[...currentImages,...uploaded];
      const product={
        ...(existing||{}),
        id,title:$("title").value.trim(),price:Number($("price").value),currency:existing?.currency||"UAH",category:$("category").value.trim(),
        availability_status:availabilityStatus,expected_arrival:$("arrival").value||"",
        variants:$("variants").value.trim(),url:$("productUrl").value.trim(),description:$("description").value,description_ru:$("descriptionRu").value,
        seo_title:$("seoTitle").value.trim(),seo_description:$("seoDescription").value.trim(),
        seo_keywords:$("seoKeywords").value.split(",").map(x=>x.trim()).filter(Boolean),
        images,image:images[0]||"",
        availability:availabilityStatus==="unknown"&&existing?.availability?existing.availability:(availabilityLabels[availabilityStatus]||"Уточнюйте актуальну наявність перед замовленням"),
        published:$("published").checked
      };
      setNotice("Сохраняю карточку…");await api("/api/products",{method:"POST",body:JSON.stringify(product)});
      selectedFiles=[];$("photos").value="";
      setNotice("Товар сохранён. Обновляю каталог…");await loadProducts();
      const saved=products.find(p=>String(p.id)===String(id));if(saved)editProduct(saved);
    }catch(error){setNotice(error.message,true);}finally{save.disabled=false;}
  });
  $("archiveBtn").addEventListener("click",async()=>{
    const id=$("productId").value;if(!id)return;
    if(!confirm("Снять товар с публикации? Карточка останется в админ-панели."))return;
    try{await api("/api/products/"+encodeURIComponent(id),{method:"DELETE"});setNotice("Товар снят с публикации.");await loadProducts();resetForm();}
    catch(error){setNotice(error.message,true);}
  });
  resetForm();
})();