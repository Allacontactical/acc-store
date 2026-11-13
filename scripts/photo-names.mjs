// Canonical photo-name rules shared by the photo pipeline and the test suite.
// Name format: <brand>-<model>-<n>.webp (lowercase, ASCII, hyphen-separated).

const BRANDS = [
  "King's Camo", "Kings Camo", "Arctic Shield", "Hunters Element", "Pure Hunt",
  "UF PRO", "Hot Shot", "5.11", "Cabela's", "Verney-Carron", "RedHead",
  "Drake", "Banded", "KUIU", "Sitka", "Seeland", "Deerhunter", "Blaser",
  "Huntworth", "Salomon", "Carinthia", "Swedteam", "Chevalier", "Chevalite",
  "Pointer", "Harkila", "Finnhunt", "Taigan", "Beretta", "Percussion",
  "Remington", "Browning", "Solognac", "Rocky", "Magpul", "Oakley", "Highlander",
  "Gateway1", "ITW", "WFS", "Nomad", "Formax", "SKRE", "Blauer", "CRKT",
  "Oleader", "Graff", "Pinewood", "Predator", "HISEA", "Rouchette", "Somlys",
  "Devon", "Heybo", "Tenzing", "Badlands", "Thermasilk"
];

const CYR = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y',
  і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's',
  т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia',
  ы: 'y', э: 'e', ё: 'e', ъ: ''
};

export function translit(value) {
  return String(value || "").toLowerCase().split("").map(ch => (ch in CYR ? CYR[ch] : ch)).join("");
}

export function slugify(value) {
  return translit(value)
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function brandOf(title) {
  const ordered = [...BRANDS].sort((a, b) => b.length - a.length);
  for (const brand of ordered) {
    const re = new RegExp("\\b" + brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
    if (re.test(title)) return brand;
  }
  return "";
}

export function brandModelSlug(title) {
  const brand = brandOf(title);
  let rest = String(title || "");
  if (brand) rest = rest.replace(new RegExp(brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), " ");
  rest = rest.replace(/[|—–/®™•].*$/, " ");
  const promo = /^(мисливськ|купити|продаж|розпродаж|зимов|літн|демізонн|демісезонн|чоловіч|жіноч|універсальн)/i;
  const words = (rest.match(/[A-Za-zА-Яа-я0-9-]+/g) || [])
    .filter(w => w.length > 1 && !promo.test(w))
    .slice(0, 4);
  const slug = slugify((brand ? brand + " " : "") + words.join(" ")).replace(/-\d+$/, "").slice(0, 60).replace(/-$/, "");
  return slug;
}

// Assign a unique <slug>-<n>.webp name to every photo of every product.
// Collisions between different products are resolved by appending the product id.
export function assignNames(products) {
  const slugProducts = new Map();
  for (const product of products) {
    const slug = brandModelSlug(product.title) || ("product-" + product.id);
    if (!slugProducts.has(slug)) slugProducts.set(slug, new Set());
    slugProducts.get(slug).add(String(product.id));
  }
  const byProduct = {};
  const bySource = {};
  for (const product of products) {
    const base = brandModelSlug(product.title) || ("product-" + product.id);
    const slug = slugProducts.get(base).size > 1 ? `${base}-${product.id}` : base;
    const images = product.images || [];
    byProduct[String(product.id)] = images.map((source, i) => {
      const name = `${slug}-${i + 1}.webp`;
      if (!(source in bySource)) bySource[source] = name;
      return name;
    });
  }
  return { byProduct, bySource };
}
