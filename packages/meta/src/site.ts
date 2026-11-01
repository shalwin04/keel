import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { saveMedia } from "./media.ts";
import { withPage } from "./render.ts";

/** One product the site sells, with its photos saved to the media store. */
export interface SiteProduct {
  name: string;
  url: string;
  price?: string;
  currency?: string;
  description?: string;
  imageRefs: string[];
}

/** What Keel read from a website: enough for the agent to build a brand profile and a brief. */
export interface SiteCrawl {
  url: string;
  origin: string;
  title: string;
  description: string;
  siteName: string;
  lang?: string;
  themeColor?: string;
  colors: string[];
  fonts: string[];
  headings: string[];
  text: string;
  nav: string[];
  socials: string[];
  logoRef?: string;
  shareImageRef?: string;
  screenshotRef: string;
  products: SiteProduct[];
  platform?: string;
  pagesRead: number;
}

const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^::1$/, /^f[cd]/i, /^fe80/i, /^::ffff:(127|10|192\.168)\./];

/** Keel only crawls public websites (no localhost or private networks) unless KEEL_ALLOW_LOCAL_SITES=1 (tests). */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { throw new Error("That doesn't look like a website address."); }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http and https addresses can be read.");
  if (process.env.KEEL_ALLOW_LOCAL_SITES === "1") return u;
  if (u.hostname === "localhost" || u.hostname.endsWith(".local") || u.hostname.endsWith(".internal")) throw new Error("Keel can only read public websites.");
  const addrs = isIP(u.hostname) ? [u.hostname] : (await lookup(u.hostname, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new Error(`Couldn't find ${u.hostname}. Check the address.`);
  if (addrs.some((a) => PRIVATE.some((r) => r.test(a)))) throw new Error("Keel can only read public websites.");
  return u;
}

type Raw = {
  title: string; description: string; siteName: string; lang: string; themeColor: string; ogImage: string; logo: string; icon: string;
  colors: string[]; fonts: string[]; headings: string[]; text: string; nav: string[]; socials: string[]; links: string[]; prices: string[];
  ld: unknown[]; platform: string;
};

/** Runs inside the page: everything visible that says who the brand is and what it sells. */
const EXTRACT = `(() => {
  const q = (s) => document.querySelector(s);
  const meta = (n) => (q('meta[property="' + n + '"]') || q('meta[name="' + n + '"]'))?.getAttribute('content') || '';
  const abs = (u) => { try { return new URL(u, location.href).href } catch { return '' } };
  const rgbToHex = (c) => { const m = c.match(/\\d+(\\.\\d+)?/g); if (!m || m.length < 3) return ''; if (m.length > 3 && Number(m[3]) < 0.5) return ''; return '#' + m.slice(0, 3).map((x) => Math.round(Number(x)).toString(16).padStart(2, '0')).join(''); };
  const tally = new Map();
  const add = (c, w) => { const h = rgbToHex(c); if (h) tally.set(h, (tally.get(h) || 0) + w); };
  add(getComputedStyle(document.body).backgroundColor, 50);
  add(getComputedStyle(document.body).color, 20);
  for (const el of Array.from(document.querySelectorAll('header, nav, footer, section, button, a.button, .btn, [class*="button"], h1, h2')).slice(0, 300)) {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); const area = Math.min(40, (r.width * r.height) / 20000);
    add(cs.backgroundColor, el.tagName === 'BUTTON' || /btn|button/i.test(el.className) ? 6 : area); if (/^H[12]$/.test(el.tagName)) add(cs.color, 4);
  }
  const fonts = [...new Set([q('h1'), q('h2'), document.body].filter(Boolean).map((e) => getComputedStyle(e).fontFamily.split(',')[0].replace(/["']/g, '').trim()))];
  const logoEl = q('header img[alt*="logo" i], header img[src*="logo" i], img[class*="logo" i], img[id*="logo" i], a[class*="logo" i] img, [class*="logo" i] img, img[alt*="logo" i]');
  const svgLogo = !logoEl && (q('header svg[class*="logo" i], [class*="logo" i] svg, header a svg'));
  const icon = q('link[rel="apple-touch-icon"]')?.href || q('link[rel~="icon"][sizes]')?.href || q('link[rel~="icon"]')?.href || '';
  const ld = []; for (const s of document.querySelectorAll('script[type="application/ld+json"]')) { try { ld.push(JSON.parse(s.textContent || '')) } catch {} }
  const links = [...new Set(Array.from(document.querySelectorAll('a[href]')).map((a) => abs(a.getAttribute('href'))).filter((h) => h.startsWith(location.origin)))];
  const socials = [...new Set(Array.from(document.querySelectorAll('a[href]')).map((a) => a.href).filter((h) => /(instagram|facebook|tiktok|youtube|x|twitter|linkedin)\\.com\\//i.test(h)))].slice(0, 8);
  const nav = [...new Set(Array.from(document.querySelectorAll('header a, nav a')).map((a) => (a.textContent || '').trim()).filter((t) => t && t.length < 40))].slice(0, 20);
  const headings = Array.from(document.querySelectorAll('h1, h2, h3')).map((h) => (h.textContent || '').replace(/\\s+/g, ' ').trim()).filter((t) => t && t.length < 160).slice(0, 24);
  const text = (document.body.innerText || '').replace(/\\n{2,}/g, '\\n').slice(0, 6000);
  const prices = [...new Set((text.match(/(?:₹|Rs\\.?|INR|\\$|€|£|USD|EUR)\\s?\\d[\\d,]*(?:\\.\\d{2})?/g) || []))].slice(0, 12);
  const platform = window.Shopify ? 'shopify' : document.querySelector('meta[name="generator"][content*="WooCommerce" i]') || document.body.className.includes('woocommerce') ? 'woocommerce' : (meta('generator') || '');
  return {
    title: document.title || '', description: meta('og:description') || meta('description'), siteName: meta('og:site_name') || meta('application-name') || '',
    lang: document.documentElement.lang || '', themeColor: meta('theme-color'), ogImage: abs(meta('og:image') || meta('twitter:image')),
    logo: logoEl ? abs(logoEl.currentSrc || logoEl.getAttribute('src') || '') : (svgLogo ? 'data:image/svg+xml;utf8,' + encodeURIComponent(new XMLSerializer().serializeToString(svgLogo)) : ''), icon,
    colors: [...tally.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]).slice(0, 8), fonts, headings, text, nav, socials, links, prices, ld, platform,
  };
})()`;

/** A product page's own facts (JSON-LD Product, Open Graph, the biggest image). */
const EXTRACT_PRODUCT = `(() => {
  const q = (s) => document.querySelector(s);
  const meta = (n) => (q('meta[property="' + n + '"]') || q('meta[name="' + n + '"]'))?.getAttribute('content') || '';
  const abs = (u) => { try { return new URL(u, location.href).href } catch { return '' } };
  const ld = []; for (const s of document.querySelectorAll('script[type="application/ld+json"]')) { try { ld.push(JSON.parse(s.textContent || '')) } catch {} }
  const imgs = Array.from(document.images).filter((i) => i.naturalWidth >= 300 && i.naturalHeight >= 300).sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight).map((i) => abs(i.currentSrc || i.src)).slice(0, 4);
  const text = (document.body.innerText || '');
  const price = meta('product:price:amount') || meta('og:price:amount') || ((text.match(/(?:₹|Rs\\.?|INR|\\$|€|£)\\s?\\d[\\d,]*(?:\\.\\d{2})?/) || [])[0] || '');
  return { ld, title: meta('og:title') || (q('h1')?.textContent || '').trim() || document.title, description: meta('og:description') || meta('description'), ogImage: abs(meta('og:image')), price, currency: meta('product:price:currency') || meta('og:price:currency'), imgs };
})()`;

type LdProduct = { name?: string; description?: string; image?: unknown; url?: string; offers?: unknown };

/** JSON-LD comes as objects, arrays and @graph blocks; this finds every Product in it. */
function ldProducts(ld: unknown[]): LdProduct[] {
  const out: LdProduct[] = [];
  const walk = (x: unknown) => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) return x.forEach(walk);
    const o = x as Record<string, unknown>;
    const t = o["@type"];
    if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) out.push(o as LdProduct);
    if (o["@graph"]) walk(o["@graph"]);
    if (o.itemListElement) walk((o.itemListElement as unknown[]).map((e) => (e as { item?: unknown }).item ?? e));
  };
  walk(ld);
  return out;
}
const firstImage = (img: unknown): string[] => (typeof img === "string" ? [img] : Array.isArray(img) ? img.flatMap(firstImage) : img && typeof img === "object" && "url" in img ? [String((img as { url: unknown }).url)] : []);
function offerOf(offers: unknown): { price?: string; currency?: string } {
  const o = (Array.isArray(offers) ? offers[0] : offers) as Record<string, unknown> | undefined;
  if (!o) return {};
  const price = o.price ?? o.lowPrice;
  return { price: price === undefined ? undefined : String(price), currency: o.priceCurrency ? String(o.priceCurrency) : undefined };
}

const PRODUCT_LINK = /\/(products?|p|item|shop|store|collections\/[^/]+\/products)\/[^/?#]+/i;

/**
 * Reads a website the way a strategist would on day one: the homepage (screenshot, colours, fonts, copy, logo),
 * then the product catalogue (Shopify's products.json when available, else JSON-LD on the page and a few product
 * pages). Product photos and the logo are saved so Studio can use them. Images are re-rendered by the browser to PNG,
 * so AVIF/SVG sources work with Muse Image.
 */
export async function crawlSite(rawUrl: string, o: { maxProducts?: number; log?: (t: string) => void } = {}): Promise<SiteCrawl> {
  const target = await assertPublicUrl(rawUrl);
  const maxProducts = o.maxProducts ?? 6;
  return withPage({ width: 1280, height: 900 }, async (page) => {
    try {
      await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch (err) {
      throw new Error(`Couldn't open ${target.host}: ${(err as Error).message.split("\n")[0]}`);
    }
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
    // Cookie banners hide the page; a polite "accept"/"close" click is enough for a screenshot.
    for (const label of ["Accept all", "Accept", "I agree", "Got it", "Close"]) {
      const btn = page.getByRole("button", { name: label, exact: false }).first();
      if (await btn.isVisible({ timeout: 300 }).catch(() => false)) { await btn.click({ timeout: 1000 }).catch(() => undefined); break; }
    }
    await page.waitForTimeout(400);
    const screenshotRef = await saveMedia(await page.screenshot({ type: "png" }), ".png", "sites");
    const raw = (await page.evaluate(EXTRACT)) as Raw;
    const url = page.url() as string;
    const origin = new URL(url).origin;
    o.log?.(`Opened ${new URL(url).host}${raw.platform ? ` (${raw.platform})` : ""}`);

    /** Any image URL → PNG bytes via the browser (handles AVIF, SVG, WebP, lazy CDNs). */
    const snapImage = async (src: string, maxSide = 1400): Promise<string | undefined> => {
      if (!src) return undefined;
      try {
        return await withPage({ width: 10, height: 10 }, async (p) => {
          await p.setContent(`<!doctype html><html><body style="margin:0;background:transparent"><img id="i" src="${src.replace(/"/g, "&quot;")}" style="display:block"></body></html>`, { waitUntil: "load", timeout: 15_000 });
          const size = (await p.evaluate(`(() => { const i = document.getElementById('i'); return i.complete && i.naturalWidth ? [i.naturalWidth, i.naturalHeight] : null })()`)) as [number, number] | null;
          if (!size) return undefined;
          const k = Math.min(1, maxSide / Math.max(size[0], size[1]));
          const w = Math.max(1, Math.round(size[0] * k)), h = Math.max(1, Math.round(size[1] * k));
          await p.setViewportSize({ width: w, height: h });
          await p.evaluate(`(() => { const i = document.getElementById('i'); i.style.width='${w}px'; i.style.height='${h}px' })()`);
          return saveMedia(await p.screenshot({ type: "png", omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } }), ".png", "sites");
        });
      } catch { return undefined; }
    };

    const products: SiteProduct[] = [];
    const seen = new Set<string>();
    const push = async (p: { name?: string; url: string; price?: string; currency?: string; description?: string; images: string[] }) => {
      if (!p.name || seen.has(p.url) || products.length >= maxProducts) return;
      seen.add(p.url);
      const imageRefs = (await Promise.all(p.images.filter(Boolean).slice(0, 2).map((s) => snapImage(s)))).filter((x): x is string => !!x);
      if (!imageRefs.length) return;
      products.push({ name: p.name.trim().slice(0, 120), url: p.url, price: p.price, currency: p.currency, description: p.description?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400), imageRefs });
    };

    // 1. Shopify stores publish their catalogue.
    if (raw.platform === "shopify" || /shopify/i.test(raw.text.slice(0, 50))) {
      try {
        const res = await page.request.get(`${origin}/products.json?limit=${maxProducts * 2}`, { timeout: 10_000 });
        if (res.ok()) {
          const j = (await res.json()) as { products?: { title: string; handle: string; body_html?: string; variants?: { price?: string }[]; images?: { src: string }[] }[] };
          for (const p of j.products ?? []) await push({ name: p.title, url: `${origin}/products/${p.handle}`, price: p.variants?.[0]?.price, description: p.body_html, images: (p.images ?? []).map((i) => i.src) });
          if (products.length) o.log?.(`Read ${products.length} products from the store catalogue`);
        }
      } catch { /* not every Shopify store exposes it */ }
    }
    // 2. JSON-LD on the homepage.
    for (const p of ldProducts(raw.ld)) {
      const off = offerOf(p.offers);
      await push({ name: p.name, url: p.url ? new URL(p.url, origin).href : `${url}#${encodeURIComponent(p.name ?? "")}`, ...off, description: p.description, images: firstImage(p.image).map((s) => new URL(s, origin).href) });
    }
    // 3. A few product pages.
    let pagesRead = 1;
    const candidates = raw.links.filter((l) => PRODUCT_LINK.test(new URL(l).pathname)).slice(0, maxProducts + 2);
    for (const link of candidates) {
      if (products.length >= maxProducts || seen.has(link)) continue;
      try {
        await page.goto(link, { waitUntil: "domcontentloaded", timeout: 20_000 });
        await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
        pagesRead++;
        const pr = (await page.evaluate(EXTRACT_PRODUCT)) as { ld: unknown[]; title: string; description: string; ogImage: string; price: string; currency: string; imgs: string[] };
        const ldp = ldProducts(pr.ld)[0];
        const off = ldp ? offerOf(ldp.offers) : {};
        await push({ name: ldp?.name ?? pr.title, url: link, price: off.price ?? pr.price, currency: off.currency ?? pr.currency, description: ldp?.description ?? pr.description, images: [...(ldp ? firstImage(ldp.image) : []), pr.ogImage, ...pr.imgs].map((s) => (s ? new URL(s, link).href : "")) });
      } catch { /* skip pages that fail */ }
    }
    if (products.length) o.log?.(`Found ${products.length} product${products.length > 1 ? "s" : ""}${pagesRead > 1 ? ` across ${pagesRead} pages` : ""}`);

    const logoRef = (await snapImage(raw.logo, 600)) ?? (await snapImage(raw.icon, 300));
    const shareImageRef = await snapImage(raw.ogImage);
    return {
      url, origin, title: raw.title, description: raw.description, siteName: raw.siteName || raw.title.split(/[|–—-]/)[0]!.trim(), lang: raw.lang || undefined,
      themeColor: raw.themeColor || undefined, colors: raw.colors, fonts: raw.fonts, headings: raw.headings, text: raw.text, nav: raw.nav, socials: raw.socials,
      logoRef, shareImageRef, screenshotRef, products, platform: raw.platform || undefined, pagesRead,
    };
  });
}
