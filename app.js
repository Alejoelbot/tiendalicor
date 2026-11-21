const STORAGE_KEY = "licores-store-products";
const initialProducts = [
  { id: "p1", name: "Whisky Reserva 12 años", category: "Whisky", price: 64.9, stock: 12, size: "750 ml" },
  { id: "p2", name: "Malbec Gran Selección", category: "Vino", price: 28.5, stock: 24, size: "750 ml" },
  { id: "p3", name: "Ron Añejo Especial", category: "Ron", price: 39.9, stock: 8, size: "750 ml" },
  { id: "p4", name: "Tequila Reposado", category: "Tequila", price: 48, stock: 15, size: "700 ml" },
  { id: "p5", name: "Gin Botánico Premium", category: "Gin", price: 42.75, stock: 6, size: "700 ml" },
  { id: "p6", name: "Espumante Brut Reserva", category: "Vino", price: 32, stock: 0, size: "750 ml" }
];
const palette = { Whisky: "", Vino: "wine", Ron: "", Tequila: "clear", Gin: "dark", Vodka: "clear", Otros: "" };
const cocktailDBIngredients = {
  Whisky: "whiskey",
  Vino: "wine",
  Ron: "rum",
  Tequila: "tequila",
  Gin: "gin",
  Vodka: "vodka"
};
const brandImageHints = [
  { aliases: ["clase azul"], ingredient: "tequila" },
  { aliases: ["buchanans master", "buchanans"], ingredient: "whiskey" },
  { aliases: ["don julio 70", "don julio"], ingredient: "tequila" }
];
const grid = document.getElementById("product-grid");
const filters = document.getElementById("category-filters");
const searchInput = document.getElementById("search");
const form = document.getElementById("product-form");
const inventoryTableBody = document.getElementById("inventory-table-body");
let activeCategory = "Todos";
let toastTimer;

// CRUD — LEER: recupera el catálogo de localStorage o inicializa los productos de ejemplo.
function loadProducts() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initialProducts));
      return initialProducts.slice();
    }
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) throw new Error("El formato guardado no es válido.");
    return parsed;
  } catch (error) {
    console.error("No se pudo cargar el catálogo guardado:", error);
    document.getElementById("form-message").textContent = "No se pudo leer el almacenamiento local. Revisa la configuración del navegador.";
    document.getElementById("form-message").className = "mt-4 min-h-4 text-xs text-red-300";
    return initialProducts.slice();
  }
}

let products = loadProducts();

// Guarda el catálogo actual en localStorage e informa si el navegador no permite guardarlo.
function persistProducts() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
    return true;
  } catch (error) {
    console.error("No se pudo guardar el catálogo:", error);
    showToast("No se pudo guardar. Revisa el almacenamiento del navegador.", true);
    return false;
  }
}

// Normaliza texto para comparar marcas sin distinguir mayúsculas, tildes ni puntuación.
function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Calcula la distancia de edición entre dos textos para tolerar errores de escritura.
function getEditDistance(first, second) {
  const row = Array.from({ length: second.length + 1 }, function (_, index) { return index; });
  for (let firstIndex = 1; firstIndex <= first.length; firstIndex += 1) {
    let previousDiagonal = row[0];
    row[0] = firstIndex;
    for (let secondIndex = 1; secondIndex <= second.length; secondIndex += 1) {
      const previousRowValue = row[secondIndex];
      const substitutionCost = first[firstIndex - 1] === second[secondIndex - 1] ? 0 : 1;
      row[secondIndex] = Math.min(
        row[secondIndex] + 1,
        row[secondIndex - 1] + 1,
        previousDiagonal + substitutionCost
      );
      previousDiagonal = previousRowValue;
    }
  }
  return row[second.length];
}

// Detecta marcas conocidas con coincidencia aproximada y devuelve su imagen de ingrediente.
function detectarImagenLicor(nombre, categoria) {
  const normalizedName = normalizeText(nombre);
  const matchedBrand = brandImageHints.find(function (brand) {
    return brand.aliases.some(function (alias) {
      const normalizedAlias = normalizeText(alias);
      if (normalizedName.includes(normalizedAlias)) return true;
      const nameWords = normalizedName.split(" ");
      const aliasWords = normalizedAlias.split(" ");
      for (let start = 0; start <= nameWords.length - aliasWords.length; start += 1) {
        const candidate = nameWords.slice(start, start + aliasWords.length).join(" ");
        const maxDistance = Math.max(1, Math.floor(normalizedAlias.length * 0.12));
        if (getEditDistance(candidate, normalizedAlias) <= maxDistance) return true;
      }
      return false;
    });
  });
  const ingredient = matchedBrand ? matchedBrand.ingredient : (cocktailDBIngredients[categoria] || "whiskey");
  return "https://www.thecocktaildb.com/images/ingredients/" + ingredient + "-medium.png";
}

// Acepta URLs de imagen seguras y actualiza HTTP a HTTPS cuando sea posible.
function normalizeImageURL(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol === "https:") return url.href;
    if (url.protocol === "http:") {
      url.protocol = "https:";
      return url.href;
    }
  } catch (error) {
    return "";
  }
  return "";
}

// Obtiene una imagen de producto solo si el resultado de Open Food Facts es una bebida alcohólica.
async function findOpenFoodFactsImage(name, category) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(function () { controller.abort(); }, 3500);
  const params = new URLSearchParams({
    search_terms: name + " " + category,
    search_simple: "1",
    action: "process",
    json: "1",
    page_size: "5",
    fields: "product_name,image_front_url,image_url,categories_tags",
    tagtype_0: "categories",
    tag_contains_0: "contains",
    tag_0: "alcoholic-beverages"
  });
  try {
    const response = await fetch("https://world.openfoodfacts.org/cgi/search.pl?" + params.toString(), {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error("Open Food Facts respondió con HTTP " + response.status);
    const data = await response.json();
    const allowedAlcoholTags = ["en:alcoholic-beverages", "en:spirits", "en:wines", "en:beers"];
    const match = (Array.isArray(data.products) ? data.products : []).find(function (product) {
      const tags = Array.isArray(product.categories_tags) ? product.categories_tags : [];
      const isAlcoholic = tags.some(function (tag) { return allowedAlcoholTags.includes(tag); });
      return isAlcoholic && (normalizeImageURL(product.image_front_url) || normalizeImageURL(product.image_url));
    });
    if (!match) return "";
    return normalizeImageURL(match.image_front_url) || normalizeImageURL(match.image_url);
  } catch (error) {
    console.warn("Open Food Facts no devolvió una imagen válida; se usará TheCocktailDB.", error);
    return "";
  } finally {
    window.clearTimeout(timeoutId);
  }
}

// Busca primero una foto de licor en Open Food Facts y siempre devuelve un respaldo de TheCocktailDB.
async function resolveBottleImage(name, category) {
  const openFoodFactsImage = await findOpenFoodFactsImage(name, category);
  return openFoodFactsImage || detectarImagenLicor(name, category);
}

// Devuelve la imagen guardada o la imagen genérica correspondiente al licor.
function getProductImage(product) {
  return normalizeImageURL(product.image) || detectarImagenLicor(product.name, product.category);
}

// Renderiza una imagen con respaldo visual de botella si la URL no carga.
function renderProductImage(product, containerClass, imageClass) {
  const fallbackImage = detectarImagenLicor(product.name, product.category);
  return '<div class="' + containerClass + '">' +
    '<img src="' + escapeHTML(getProductImage(product)) + '" data-fallback-src="' + escapeHTML(fallbackImage) + '" data-product-image alt="Imagen de ' + escapeHTML(product.name) + '" loading="lazy" class="' + imageClass + '">' +
    '<div class="bottle ' + (palette[product.category] || "") + ' hidden absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 scale-[.4]"><span class="bottle-label">' + escapeHTML(product.category).toUpperCase() + '</span></div>' +
    "</div>";
}

// Convierte caracteres especiales en entidades HTML para mostrar texto de forma segura.
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, /* Convierte cada carácter especial en su entidad HTML. */ function (char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}

// Da formato de moneda al precio del producto.
function formatPrice(price) {
  return new Intl.NumberFormat("es", { style: "currency", currency: "USD" }).format(price);
}

// Muestra una notificación temporal de éxito o error.
function showToast(message, isError) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  toast.classList.toggle("bg-red-800", Boolean(isError));
  toast.classList.toggle("bg-ink", !isError);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(/* Oculta el mensaje cuando termina su tiempo visible. */ function () {
    toast.classList.add("hidden");
  }, 3000);
}

// Crea los botones de filtro usando las categorías presentes en el catálogo.
function renderFilters() {
  const categories = ["Todos"].concat(Array.from(new Set(products.map(/* Obtiene la categoría de cada producto. */ function (product) {
    return product.category;
  }))).sort());
  filters.innerHTML = categories.map(/* Genera un botón por categoría. */ function (category) {
    const selected = category === activeCategory;
    return '<button type="button" data-category="' + escapeHTML(category) + '" aria-pressed="' + selected + '" class="rounded-full border px-4 py-2 text-[10px] font-medium transition ' +
      (selected ? "border-ink bg-ink text-white" : "border-black/10 text-black/55 hover:border-gold hover:text-gold") + '">' + escapeHTML(category) + "</button>";
  }).join("");
}

// CRUD — LEER: filtra y dibuja los productos guardados en el catálogo.
function renderProducts() {
  renderFilters();
  const term = searchInput.value.trim().toLocaleLowerCase();
  const visible = products.filter(/* Conserva los productos que coinciden con los filtros activos. */ function (product) {
    const matchesCategory = activeCategory === "Todos" || product.category === activeCategory;
    const matchesSearch = (product.name + " " + product.category).toLocaleLowerCase().includes(term);
    return matchesCategory && matchesSearch;
  });
  document.getElementById("catalog-count").textContent = visible.length + (visible.length === 1 ? " producto disponible" : " productos disponibles") + " en el catálogo";
  if (visible.length === 0) {
    grid.innerHTML = '<div class="rounded-xl border border-dashed border-black/15 py-14 text-center text-sm text-black/45 sm:col-span-2 lg:col-span-3">No encontramos productos con esos filtros.</div>';
  } else {
    grid.innerHTML = visible.map(/* Construye la tarjeta visual de cada producto. */ function (product) {
      const outOfStock = Number(product.stock) === 0;
      const lowStock = Number(product.stock) > 0 && Number(product.stock) < 5;
      return '<article class="group overflow-hidden rounded-xl border border-black/[.07] bg-white transition duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/[.06]">' +
        '<div class="relative flex h-52 items-center justify-center overflow-hidden bg-[#f0eee8]">' +
          '<div class="absolute h-36 w-36 rounded-full bg-white/70 transition duration-500 group-hover:scale-110"></div>' +
          renderProductImage(product, "relative z-10 flex h-44 w-44 items-center justify-center transition duration-500 group-hover:-translate-y-1", "h-full w-full object-contain") +
          '<span class="absolute left-4 top-4 rounded-full bg-white/80 px-3 py-1.5 text-[9px] uppercase tracking-wider text-black/55">' + escapeHTML(product.category) + '</span>' +
          '<span class="absolute right-4 top-4 rounded-full px-3 py-1.5 text-[9px] ' + (outOfStock ? "bg-red-100 text-red-700" : lowStock ? "bg-amber-100 text-amber-800" : "bg-white/80 text-black/55") + '">' + (outOfStock ? "Agotado" : lowStock ? "Últimas unidades" : "En stock") + '</span>' +
        '</div>' +
        '<div class="p-5">' +
          '<div class="flex items-start justify-between gap-3"><div><h3 class="font-display text-xl leading-snug">' + escapeHTML(product.name) + '</h3><p class="mt-1 text-[10px] text-black/40">' + escapeHTML(product.size || "Presentación especial") + '</p></div><span class="whitespace-nowrap pt-1 text-sm font-semibold">' + formatPrice(Number(product.price)) + '</span></div>' +
          '<div class="mt-5 flex items-center justify-between border-t border-black/[.07] pt-4"><span class="text-[10px] text-black/45">Stock: <strong class="' + (outOfStock ? "text-red-600" : "text-ink") + '">' + Number(product.stock) + ' unidades</strong></span>' +
          '<div class="flex gap-3"><button type="button" data-edit="' + escapeHTML(product.id) + '" class="text-[9px] font-semibold uppercase tracking-wider text-gold hover:text-ink">Editar</button><button type="button" data-delete="' + escapeHTML(product.id) + '" class="text-[9px] font-semibold uppercase tracking-wider text-black/35 hover:text-red-600">Eliminar</button></div></div>' +
        '</div></article>';
    }).join("");
  }
  renderInventoryTable();
  renderInventorySummary();
}

// Dibuja todos los productos y el valor de sus existencias en la vista independiente del inventario.
function renderInventoryTable() {
  document.getElementById("inventory-count").textContent = products.length + (products.length === 1 ? " producto" : " productos");
  if (products.length === 0) {
    inventoryTableBody.innerHTML = '<tr><td colspan="6" class="px-5 py-10 text-center text-white/45">Todavía no hay productos en el inventario.</td></tr>';
    return;
  }
  inventoryTableBody.innerHTML = products.map(/* Crea una fila con imagen, precio, existencias y acciones de cada producto. */ function (product) {
    const stock = Math.max(0, Number(product.stock) || 0);
    const unitPrice = Math.max(0, Number(product.price) || 0);
    return '<tr class="text-white/80">' +
      '<td class="px-5 py-3"><div class="flex items-center gap-3">' +
        renderProductImage(product, "relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/10", "h-full w-full object-contain") +
        '<div><p class="font-medium text-white">' + escapeHTML(product.name) + '</p><p class="mt-1 text-[10px] text-white/40">' + escapeHTML(product.size || "Presentación especial") + '</p></div>' +
      '</div></td>' +
      '<td class="px-4 py-3">' + escapeHTML(product.category) + '</td>' +
      '<td class="whitespace-nowrap px-4 py-3">' + formatPrice(unitPrice) + '</td>' +
      '<td class="px-4 py-3">' + stock + '</td>' +
      '<td class="whitespace-nowrap px-4 py-3 font-medium text-[#d9bd8f]">' + formatPrice(stock * unitPrice) + '</td>' +
      '<td class="px-5 py-3 text-right"><div class="flex justify-end gap-3">' +
        '<button type="button" data-edit="' + escapeHTML(product.id) + '" class="text-[9px] font-semibold uppercase tracking-wider text-[#d9bd8f] hover:text-white">Editar</button>' +
        '<button type="button" data-delete="' + escapeHTML(product.id) + '" class="text-[9px] font-semibold uppercase tracking-wider text-white/40 hover:text-red-300">Eliminar</button>' +
      '</div></td>' +
    '</tr>';
  }).join("");
}

// ANALIZAR INVENTARIO: suma las botellas y calcula su valor con unidades × precio unitario.
function renderInventorySummary() {
  const totalUnits = products.reduce(/* Suma las unidades disponibles de todos los productos. */ function (total, product) {
    return total + Math.max(0, Number(product.stock) || 0);
  }, 0);
  const inventoryValue = products.reduce(/* Valora cada producto multiplicando sus unidades por su precio. */ function (total, product) {
    const units = Math.max(0, Number(product.stock) || 0);
    const price = Math.max(0, Number(product.price) || 0);
    return total + units * price;
  }, 0);
  const lowStockCount = products.filter(/* Cuenta productos con menos de cinco unidades. */ function (product) {
    return Number(product.stock) < 5;
  }).length;
  document.getElementById("metric-products").textContent = products.length;
  document.getElementById("metric-stock").textContent = totalUnits;
  document.getElementById("metric-low").textContent = lowStockCount;
  document.getElementById("metric-value").textContent = formatPrice(inventoryValue);
}

// Restablece el formulario y sale del modo de edición.
function resetForm() {
  form.reset();
  document.getElementById("product-id").value = "";
  document.getElementById("form-title").textContent = "Agregar producto";
  document.getElementById("submit-button").innerHTML = 'Guardar producto <span aria-hidden="true">↗</span>';
  document.getElementById("cancel-edit").classList.add("hidden");
}

// Cambia entre las vistas independientes del catálogo y del inventario.
function setActiveView(view, scrollToTop) {
  const activeView = view === "inventario" ? "inventario" : "catalogo";
  document.querySelectorAll("[data-page-view]").forEach(function (section) {
    section.hidden = section.dataset.pageView !== activeView;
  });
  document.querySelectorAll("[data-view-link]").forEach(function (link) {
    if (link.dataset.viewLink === activeView) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
  if (window.location.hash !== "#" + activeView) {
    window.history.replaceState(null, "", "#" + activeView);
  }
  if (scrollToTop) window.scrollTo({ top: 0, behavior: "smooth" });
}

// Cambia de vista al elegir Catálogo o Inventario en la navegación.
document.querySelectorAll("[data-view-link]").forEach(function (link) {
  link.addEventListener("click", function (event) {
    event.preventDefault();
    setActiveView(link.dataset.viewLink, true);
  });
});

// Atiende la selección de una categoría y actualiza el catálogo mostrado.
filters.addEventListener("click", function (event) {
  const button = event.target.closest("button[data-category]");
  if (!button) return;
  activeCategory = button.dataset.category;
  renderProducts();
});

// Vuelve a dibujar el catálogo cuando cambia el texto de búsqueda.
searchInput.addEventListener("input", renderProducts);

// Atiende las acciones de actualizar y eliminar desde el catálogo o la tabla de inventario.
function handleProductAction(event) {
  const editButton = event.target.closest("button[data-edit]");
  const deleteButton = event.target.closest("button[data-delete]");
  if (editButton) {
    const product = products.find(/* Busca el producto seleccionado para editarlo. */ function (item) { return item.id === editButton.dataset.edit; });
    if (!product) return;
    document.getElementById("product-id").value = product.id;
    document.getElementById("product-name").value = product.name;
    document.getElementById("product-category").value = product.category;
    document.getElementById("product-price").value = product.price;
    document.getElementById("product-stock").value = product.stock;
    document.getElementById("product-size").value = product.size || "";
    document.getElementById("form-title").textContent = "Editar producto";
    document.getElementById("submit-button").innerHTML = 'Guardar cambios <span aria-hidden="true">↗</span>';
    document.getElementById("cancel-edit").classList.remove("hidden");
    setActiveView("inventario", false);
    document.getElementById("inventario").scrollIntoView({ behavior: "smooth" });
    document.getElementById("product-name").focus({ preventScroll: true });
  }
  if (deleteButton) {
    // CRUD — ELIMINAR: quita el producto seleccionado y persiste el catálogo actualizado.
    const product = products.find(/* Busca el producto seleccionado para eliminarlo. */ function (item) { return item.id === deleteButton.dataset.delete; });
    if (!product || !window.confirm('¿Eliminar "' + product.name + '" del catálogo?')) return;
    const previousProducts = products;
    products = products.filter(/* Mantiene todos los productos excepto el eliminado. */ function (item) { return item.id !== product.id; });
    if (!persistProducts()) { products = previousProducts; return; }
    if (document.getElementById("product-id").value === product.id) resetForm();
    renderProducts();
    showToast("Producto eliminado del catálogo.");
  }
}

grid.addEventListener("click", handleProductAction);
inventoryTableBody.addEventListener("click", handleProductAction);

// CRUD — CREAR / ACTUALIZAR: valida, resuelve la imagen y guarda el producto.
form.addEventListener("submit", async function (event) {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const id = document.getElementById("product-id").value;
  const product = {
    id: id || (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : String(Date.now())),
    name: document.getElementById("product-name").value.trim(),
    category: document.getElementById("product-category").value,
    price: Number(document.getElementById("product-price").value),
    stock: Number(document.getElementById("product-stock").value),
    size: document.getElementById("product-size").value.trim()
  };
  if (!product.name || !Number.isFinite(product.price) || product.price <= 0 || !Number.isInteger(product.stock) || product.stock < 0) {
    document.getElementById("form-message").textContent = "Revisa el nombre, precio y stock ingresados.";
    document.getElementById("form-message").className = "mt-4 min-h-4 text-xs text-red-300";
    return;
  }
  const submitButton = document.getElementById("submit-button");
  const cancelButton = document.getElementById("cancel-edit");
  submitButton.disabled = true;
  cancelButton.disabled = true;
  submitButton.textContent = "Buscando imagen...";
  document.getElementById("form-message").textContent = "Consultando imágenes y guardando el producto.";
  document.getElementById("form-message").className = "mt-4 min-h-4 text-xs text-white/55";
  try {
    product.image = await resolveBottleImage(product.name, product.category);
    const previousProducts = products;
    if (id) {
      // CRUD — ACTUALIZAR: reemplaza el producto editado y conserva los demás.
      products = products.map(/* Sustituye el producto editado y conserva los demás. */ function (item) { return item.id === id ? product : item; });
    } else {
      // CRUD — CREAR: agrega el nuevo producto al inicio del catálogo.
      products = [product].concat(products);
    }
    if (!persistProducts()) {
      products = previousProducts;
      return;
    }
    activeCategory = "Todos";
    searchInput.value = "";
    renderProducts();
    resetForm();
    document.getElementById("form-message").textContent = "";
    showToast(id ? "Producto actualizado correctamente." : "Producto agregado al inventario.");
  } catch (error) {
    console.error("No se pudo guardar el producto:", error);
    document.getElementById("form-message").textContent = "No se pudo guardar el producto. Inténtalo de nuevo.";
    document.getElementById("form-message").className = "mt-4 min-h-4 text-xs text-red-300";
    showToast("No se pudo guardar el producto.", true);
  } finally {
    submitButton.disabled = false;
    cancelButton.disabled = false;
    submitButton.innerHTML = document.getElementById("product-id").value
      ? 'Guardar cambios <span aria-hidden="true">↗</span>'
      : 'Guardar producto <span aria-hidden="true">↗</span>';
  }
});

// Intenta la imagen genérica de TheCocktailDB y luego muestra una botella estilizada si falla.
document.addEventListener("error", function (event) {
  const image = event.target;
  if (!image.matches("img[data-product-image]")) return;
  if (!image.dataset.fallbackAttempted && image.dataset.fallbackSrc && image.src !== image.dataset.fallbackSrc) {
    image.dataset.fallbackAttempted = "true";
    image.src = image.dataset.fallbackSrc;
    return;
  }
  image.classList.add("hidden");
  if (image.nextElementSibling) image.nextElementSibling.classList.remove("hidden");
}, true);

// Cancela la edición activa y deja el formulario listo para crear otro producto.
document.getElementById("cancel-edit").addEventListener("click", resetForm);

// Abre la vista correspondiente al hash de la URL al cargar o actualizar la página.
setActiveView(window.location.hash === "#inventario" ? "inventario" : "catalogo", false);

// Actualiza automáticamente el año del pie de página.
document.getElementById("year").textContent = new Date().getFullYear();

// Pinta el catálogo inicial al cargar el archivo JavaScript.
renderProducts();
