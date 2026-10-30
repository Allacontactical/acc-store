(() => {
  "use strict";
  let token = "";
  let products = [];
  let currentImages = [];
  let selectedFiles = [];
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
      $("productCount").textContent=products.length+" товаров";
      renderList(); setNotice("Каталог загружен.");
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
    $("productForm").reset();$("productId").value="";$("editorTitle").textContent="Новый товар";$("editState").textContent="Новый";$("archiveBtn").hidden=true;
    currentImages=[];selectedFiles=[];renderPhotos();renderList();
  }
  function editProduct(p){
    $("productId").value=p.id||"";$("title").value=p.title||"";$("price").value=p.price??"";
    $("category").value=p.category||"";$("availability").value=p.availability_status||"in_stock";
    $("arrival").value=p.expected_arrival||"";$("variants").value=p.variants||p.sizes||"";
    $("description").value=p.description||"";$("descriptionRu").value=p.description_ru||"";
    $("seoTitle").value=p.seo_title||"";$("seoDescription").value=p.seo_description||"";$("seoKeywords").value=Array.isArray(p.seo_keywords)?p.seo_keywords.join(", "):(p.seo_keywords||"");
    $("published").checked=p.published!==false;$("editorTitle").textContent="Редактирование товара";$("editState").textContent="ID "+p.id;
    $("archiveBtn").hidden=false;currentImages=Array.isArray(p.images)?p.images.slice():(p.image?[p.image]:[]);selectedFiles=[];$("photos").value="";renderPhotos();renderList();
  }
  $("photos").addEventListener("change",()=>{
    const files=Array.from($("photos").files||[]);
    if(files.length>10){setNotice("Можно загрузить не более 10 фото за один раз.",true);$("photos").value="";return;}
    selectedFiles=files;renderPhotos();
  });
  function renderPhotos(){
    const grid=$("photoPreview");grid.replaceChildren();
    currentImages.forEach((src,index)=>addPhoto(src,()=>{currentImages.splice(index,1);renderPhotos();}));
    selectedFiles.forEach((file,index)=>{const url=URL.createObjectURL(file);addPhoto(url,()=>{selectedFiles.splice(index,1);renderPhotos();},true);});
  }
  function addPhoto(src,remove,isNew=false){
    const box=document.createElement("div");box.className="photo";const img=document.createElement("img");img.src=src;img.alt="Фото товара";
    const btn=document.createElement("button");btn.type="button";btn.textContent="×";btn.title="Убрать фото";btn.addEventListener("click",remove);box.append(img,btn);$("photoPreview").append(box);
  }
  async function uploadSelected(){
    const urls=[];
    for(const file of selectedFiles){
      const form=new FormData();form.append("file",file,file.name);
      const result=await api("/api/upload",{method:"POST",body:form});urls.push(result.url);
    }
    return urls;
  }
  $("productForm").addEventListener("submit",async event=>{
    event.preventDefault();const save=$("productForm").querySelector('button[type="submit"]');save.disabled=true;
    try{
      setNotice("Загружаю фотографии…");const uploaded=await uploadSelected();
      const id=$("productId").value||crypto.randomUUID();
      const product={
        id,title:$("title").value.trim(),price:Number($("price").value),currency:"UAH",category:$("category").value.trim(),
        availability_status:$("availability").value,expected_arrival:$("arrival").value||"",
        variants:$("variants").value.trim(),description:$("description").value,description_ru:$("descriptionRu").value,
        seo_title:$("seoTitle").value.trim(),seo_description:$("seoDescription").value.trim(),
        seo_keywords:$("seoKeywords").value.split(",").map(x=>x.trim()).filter(Boolean),
        images:[...currentImages,...uploaded],image:[...currentImages,...uploaded][0]||"",
        published:$("published").checked
      };
      setNotice("Сохраняю карточку…");await api("/api/products",{method:"POST",body:JSON.stringify(product)});
      setNotice("Товар сохранён.");await loadProducts();const saved=products.find(p=>String(p.id)===String(id));if(saved)editProduct(saved);
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