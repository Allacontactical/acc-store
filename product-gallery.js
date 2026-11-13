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
