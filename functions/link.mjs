// A link to a product in a shop -> its name, price, shop and picture, for
// "I bought exactly this". First the page itself is fetched and its product
// details read (most shops publish them for search engines). Shops that turn
// robots away are read by Claude's web fetch instead. With CLAUDE_FAKE=1 (the
// tests) a made-up answer comes back.
//
// Amazon turns away robots on its product pages, but its short links (amzn.eu/d/…)
// still redirect to the full address, and that usually has the product's name
// in it (amazon.co.uk/Harry-Potter-Potions-Classroom/dp/B0…). When it doesn't,
// Claude looks the product up by its Amazon number (ASIN) with web search.
// Either way, as Amazon won't show its price to us, Claude then looks for the
// price on the web (a best effort: price checkers and shopping results often
// carry it). The name is passed on first (onName) so the card fills in while
// the price is still being looked for.
import Anthropic from '@anthropic-ai/sdk';
import { shopName } from './shared/gifts.js';
export { shopName };

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

// Only ordinary public https web addresses: this runs inside Google Cloud, so
// it must never be talked into fetching an internal address.
export function publicUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || /^[\d.]+$/.test(host) || /(^|\.)(internal|local|localhost|lan|home|corp|test|invalid|example)$/.test(host)) return null;
  return u;
}
// Follows redirects by hand (so each hop is checked), and returns where it ended
// up even when that page itself is refused: { url, html } (html '' if refused).
async function fetchPage(url) {
  let u = url;
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(u, {
      redirect: 'manual', signal: AbortSignal.timeout(8000),
      headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36', accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-GB,en;q=0.9' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = publicUrl(new URL(res.headers.get('location'), u));
      if (!next) return { url: String(u), html: '' };
      u = next;
      continue;
    }
    const html = res.ok && /html/.test(res.headers.get('content-type') || '') ? (await res.text()).slice(0, 1_500_000) : '';
    return { url: String(u), html };
  }
  return { url: String(u), html: '' };
}

// Amazon: the product's number, and its name from the address if it's there.
const isAmazon = url => shopName(url) === 'Amazon';
export function fromAmazonUrl(url) {
  let u; try { u = new URL(url); } catch { return null; }
  const asin = u.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d|d)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1]?.toUpperCase() || '';
  const slug = u.pathname.match(/^\/([^/]+)\/(?:dp|gp\/product)\//)?.[1] || '';
  let title = '';
  try { title = decodeURIComponent(slug); } catch { title = slug; }
  title = title.replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (title.length < 4 || /^(dp|gp|ref|s|stores)$/i.test(title)) title = '';
  return asin || title ? { asin, title: title.slice(0, 120) } : null;
}
// The everyday Amazon address for a product, without tracking bits.
const amazonLink = (url, asin) => { try { return asin ? `https://${new URL(url).hostname.replace(/^(?!www\.)/, 'www.')}/dp/${asin}` : url; } catch { return url; } };

const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&#x27;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&pound;|&#163;/g, '£').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const meta = (html, name) => {
  const tag = html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${name}["'][^>]*>`, 'i'))?.[0];
  return decode(tag?.match(/content=["']([^"']*)["']/i)?.[1]);
};
// The Product in a page's structured data (JSON-LD), wherever it's nested.
function findProduct(node) {
  if (Array.isArray(node)) { for (const n of node) { const p = findProduct(n); if (p) return p; } return null; }
  if (!node || typeof node !== 'object') return null;
  if ([].concat(node['@type'] || []).includes('Product') && node.name) return node;
  return findProduct(node['@graph']) || findProduct(node.mainEntity);
}
const first = v => (Array.isArray(v) ? v[0] : v);
const price = v => { const n = Number(String(v ?? '').replace(/[^0-9.]/g, '')); return n > 0 && n < 10000 ? Math.round(n * 100) / 100 : null; };

// What a product page says about itself. Null if it isn't one (or it's a "prove you're human" page).
export function fromHtml(html) {
  let title = '', cost = null, image = '';
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let p; try { p = findProduct(JSON.parse(m[1])); } catch { continue; }
    if (!p) continue;
    const offer = first(p.offers) || {};
    title = decode(p.name); image = String(first(p.image)?.url || first(p.image) || '');
    cost = price(offer.price ?? offer.lowPrice ?? first(offer.offers)?.price ?? offer.priceSpecification?.price);
    break;
  }
  title ||= (meta(html, 'og:title') || decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1])).split(/\s[|–—]\s| - (?=[^-]*$)/)[0];
  cost ??= price(meta(html, 'product:price:amount') || meta(html, 'og:price:amount') || meta(html, 'price'));
  image ||= meta(html, 'og:image');
  if (!title || /robot check|access denied|just a moment|are you (a )?human|captcha|attention required|page not found|403 forbidden/i.test(title)) return null;
  return { title, price: cost, image };
}

async function viaClaude(url, asin = '', name = '') {
  const client = new Anthropic();
  const ask = name
    ? `What does this cost in the UK today: "${name}"${asin ? ` (Amazon ASIN ${asin})` : ''}? Its Amazon page is ${url}. Try fetching that page first. Amazon usually hides its price from robots, so if you can't see it, search the web for "${name}" and use the current price for this exact product at a big UK shop (Argos, Smyths, John Lewis, Very, Tesco, Hamleys, the brand's own UK shop and the like; not marketplaces, second-hand or price-history sites). Only use a price in pounds you actually saw for this exact product; never guess.`
    : asin
    ? `What is the Amazon UK product with ASIN ${asin}? Its page is ${url}. Fetch the page, or if Amazon won't show it, search the web for "${asin}". Use only what you find, never guess.`
    : `Fetch this UK shop's product page and tell me what the product is: ${url}. If the page can't be fetched, search the web for it. Use only what you find; don't guess from the web address.`;
  const messages = [{ role: 'user', content: `${ask}\nReply with only a JSON object, no other words: {"title":"the product's name, under 80 characters, without the shop's name","price":9.99,"shop":"the shop whose price that is"}\nUse null for the price unless you saw a current price in pounds. If you can't find the product, reply {"title":"","price":null}.` }];
  let response;
  for (let turn = 0; turn < 4; turn++) {
    response = await client.messages.create({ model: MODEL, max_tokens: 4000, output_config: { effort: 'low' },
      tools: [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 2 }, { type: 'web_search_20260209', name: 'web_search', max_uses: 3 }], messages });
    if (response.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: response.content });
  }
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  try { const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); return j.title ? { title: decode(j.title), price: price(j.price), priceAt: decode(j.shop).slice(0, 40), image: '' } : null; } catch { return null; }
}

// -> { title, price, shop, url, image } or throws with words for the person.
// onName({ title, shop, url, image }) hears the name early when the price will take longer.
export async function readProductLink(raw, onName = null) {
  const u = publicUrl(raw);
  if (!u) throw new Error('that doesn\'t look like a link to a shop');
  if (process.env.CLAUDE_FAKE === '1') {
    if (isAmazon(String(u))) {
      const a = fromAmazonUrl(String(u));
      const found = { title: a?.title || 'Fake Amazon product', price: null, shop: 'Amazon', url: amazonLink(String(u), a?.asin), image: '' };
      if (onName) await onName({ ...found });
      return { ...found, price: 24.99, ...(/B0ARGOS/.test(String(u)) ? { priceAt: 'Argos' } : {}) };
    }
    return { title: 'LEGO City Police Car 60312', price: 8.99, shop: shopName(String(u)), url: String(u), image: 'https://media.example-shop.co.uk/police-car.jpg' };
  }
  let page = { url: String(u), html: '' }, found = null;
  try { page = await fetchPage(u); found = page.html ? fromHtml(page.html) : null; } catch (e) { console.log(`Fetching ${u.hostname} failed: ${e.message}`); }
  const amazon = isAmazon(page.url) ? fromAmazonUrl(page.url) : null;
  // Amazon's page refused us: its name from the address is good enough (no price: check it on Amazon).
  if (!found && amazon?.title) found = { title: amazon.title, price: null, image: '' };
  if (!found) { try { found = await viaClaude(page.url, amazon?.asin); } catch (e) { console.log(`Claude couldn't read ${u.hostname}: ${e.message}`); } }
  if (!found?.title) throw new Error(isAmazon(page.url) ? 'Amazon wouldn\'t say what it is' : 'the shop wouldn\'t show its page');
  const image = publicUrl(found.image) ? String(publicUrl(found.image)).slice(0, 600) : '';
  const link = isAmazon(page.url) ? amazonLink(page.url, amazon?.asin) : String(u);
  const product = { title: found.title.slice(0, 120), price: found.price, shop: shopName(page.url), url: link.slice(0, 600), image };
  // No price (Amazon hides it from us): show the name now, then look for the price.
  if (product.price == null && isAmazon(page.url)) {
    if (onName) { try { await onName({ ...product }); } catch (e) { console.log(`Couldn't pass the name on early: ${e.message}`); } }
    try {
      const p = await viaClaude(link, amazon?.asin, product.title);
      product.price = p?.price ?? null;
      // A price from another shop is an estimate: the card says where it's from.
      if (product.price && p.priceAt && !/amazon/i.test(p.priceAt)) product.priceAt = p.priceAt;
    } catch (e) { console.log(`Claude couldn't find a price for ${amazon?.asin || link}: ${e.message}`); }
  }
  return product;
}
