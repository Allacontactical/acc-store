// Shared product-photo rendering: unique ALT/TITLE per photo, all photos from
// images[], intrinsic sizes to reduce CLS, and a mobile-friendly thumbnail strip.
(function () {
  "use strict";

  function imagesOf(product) {
    var list = Array.isArray(product && product.images) ? product.images.filter(Boolean) : [];
    if (!list.length && product && product.image) list = [product.image];
    return list;
  }

  function altFor(product, index, total) {
    var title = (product && product.title) || "Товар AllaconTactical";
    var suffix = total > 1 ? " — фото " + (index + 1) + " з " + total : "";
    return title + suffix + " | AllaconTactical";
  }

  function titleFor(product, index, total) {
    var title = (product && product.title) || "Товар AllaconTactical";
    return total > 1 ? title + " — фото " + (index + 1) : title;
  }

  function openViewer(images, product, startIndex) {
    var old = document.getElementById("acc-photo-viewer");
    if (old) old.remove();
    var index = startIndex || 0;
    var overlay = document.createElement("div");
    overlay.id = "acc-photo-viewer";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Перегляд фотографій товару");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.94);display:flex;align-items:center;justify-content:center;padding:52px 48px;box-sizing:border-box";
    var picture = document.createElement("img");
    picture.style.cssText = "max-width:100%;max-height:100%;object-fit:contain";
    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Закрити фото");
    close.style.cssText = "position:absolute;right:12px;top:8px;color:white;background:transparent;border:0;font-size:40px;cursor:pointer;padding:4px 12px";
    var prev = document.createElement("button");
    prev.type = "button";
    prev.textContent = "‹";
    prev.setAttribute("aria-label", "Попереднє фото");
    var next = document.createElement("button");
    next.type = "button";
    next.textContent = "›";
    next.setAttribute("aria-label", "Наступне фото");
    [prev,next].forEach(function(btn){btn.style.cssText="position:absolute;top:45%;color:white;background:rgba(0,0,0,.45);border:0;font-size:46px;cursor:pointer;padding:10px";});
    prev.style.left = "0";
    next.style.right = "0";
    function show() {
      picture.src = images[index];
      picture.alt = altFor(product,index,images.length);
      picture.title = titleFor(product,index,images.length);
    }
    function step(delta) { index = (index + delta + images.length) % images.length; show(); }
    function dismiss() { document.removeEventListener("keydown",keys); overlay.remove(); }
    function keys(e) {
      if (e.key === "Escape") dismiss();
      if (e.key === "ArrowLeft" && images.length > 1) step(-1);
      if (e.key === "ArrowRight" && images.length > 1) step(1);
    }
    close.addEventListener("click",dismiss);
    overlay.addEventListener("click",function(e){if(e.target===overlay)dismiss();});
    prev.addEventListener("click",function(){step(-1);});
    next.addEventListener("click",function(){step(1);});
    overlay.appendChild(picture);
    overlay.appendChild(close);
    if(images.length>1){overlay.appendChild(prev);overlay.appendChild(next);}
    document.body.appendChild(overlay);
    document.addEventListener("keydown",keys);
    show();
    close.focus();
  }

  function renderInto(wrap, product) {
    if (!wrap) return;
    var images = imagesOf(product);
    wrap.textContent = "";
    if (!images.length) { wrap.style.display = "none"; return; }
    var total = images.length;

    var main = document.createElement("img");
    main.className = "product-photo-main";
    main.src = images[0];
    main.alt = altFor(product, 0, total);
    main.title = titleFor(product, 0, total);
    main.loading = "lazy";
    main.decoding = "async";
    // Most catalog photos are square; explicit sizes give the browser an aspect
    // hint before load and cut layout shift. CSS keeps object-fit:contain.
    main.width = 600;
    main.height = 600;
    main.onerror = function () { wrap.style.display = "none"; };
    wrap.appendChild(main);
    main.style.cursor = "zoom-in";
    main.setAttribute("role", "button");
    main.setAttribute("tabindex", "0");
    main.setAttribute("aria-label", "Збільшити фото товару");
    main.addEventListener("click",function(){openViewer(images,product,images.indexOf(main.src) >= 0 ? images.indexOf(main.src) : 0);});
    main.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();main.click();}});

    if (total < 2) return;

    var thumbs = document.createElement("div");
    thumbs.className = "product-photo-thumbs";
    images.forEach(function (src, index) {
      var thumb = document.createElement("img");
      thumb.src = src;
      thumb.alt = altFor(product, index, total);
      thumb.title = titleFor(product, index, total);
      thumb.loading = "lazy";
      thumb.decoding = "async";
      thumb.width = 64;
      thumb.height = 64;
      thumb.setAttribute("role", "button");
      thumb.setAttribute("tabindex", "0");
      if (index === 0) thumb.className = "active";
      function select() {
        main.src = src;
        main.alt = altFor(product, index, total);
        main.title = titleFor(product, index, total);
        Array.prototype.forEach.call(thumbs.children, function (node) { node.classList.remove("active"); });
        thumb.classList.add("active");
      }
      thumb.addEventListener("click", select);
      thumb.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); }
      });
      thumbs.appendChild(thumb);
    });
    wrap.appendChild(thumbs);
  }

  window.ACCProductImages = { renderInto: renderInto, altFor: altFor, titleFor: titleFor };
})();
