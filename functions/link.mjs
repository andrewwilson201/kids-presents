// A link to a product in a shop -> its name, price, shop and picture, for
// "I bought exactly this". First the page itself is fetched and its product
// details read (most shops publish them for search engines). Shops that turn
// robots away are read by Claude's web fetch instead. With CLAUDE_FAKE=1 (the
// tests) a made-up answer comes back.
import Anthropic from '@anthropic-ai/sdk';

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
export const shopName = url => {
  const host = new URL(url).hostname.replace(/^(www|m|uk|smile)\./, '');
  const known = { 'amazon.co.uk': 'Amazon', 'amzn.eu': 'Amazon', 'amzn.to': 'Amazon', 'argos.co.uk': 'Argos', 'smythstoys.com': 'Smyths', 'johnlewis.com': 'John Lewis', 'thetoyshop.com': 'The Entertainer', 'waterstones.com': 'Waterstones', 'tesco.com': 'Tesco', 'sainsburys.co.uk': 'Sainsbury\'s', 'hobbycraft.co.uk': 'Hobbycraft', 'whsmith.co.uk': 'WHSmith', 'lego.com': 'LEGO', 'very.co.uk': 'Very', 'boots.com': 'Boots', 'next.co.uk': 'Next', 'marksandspencer.com': 'M&S', 'ebay.co.uk': 'eBay', 'etsy.com': 'Etsy' };
  return known[host] || host.split('.')[0].replace(/^./, c => c.toUpperCase());
};

async function fetchPage(url) {
  let u = url;
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(u, {
      redirect: 'manual', signal: AbortSignal.timeout(8000),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; PartyPresents/1.0; link preview)', accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-GB,en;q=0.9' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      u = publicUrl(new URL(res.headers.get('location'), u));
      if (!u) return null;
      continue;
    }
    if (!res.ok || !/html/.test(res.headers.get('content-type') || '')) return null;
    return { url: String(u), html: (await res.text()).slice(0, 1_500_000) };
  }
  return null;
}

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

async function viaClaude(url) {
  const client = new Anthropic();
  const messages = [{ role: 'user', content: `Fetch this UK shop's product page and tell me what the product is: ${url}\nReply with only a JSON object, no other words: {"title":"the product's name, under 80 characters, without the shop's name","price":9.99}\nUse null for the price if the page doesn't show one. If the page can't be read or isn't a product, reply {"title":"","price":null}. Don't guess from the web address.` }];
  let response;
  for (let turn = 0; turn < 4; turn++) {
    response = await client.messages.create({ model: MODEL, max_tokens: 4000, output_config: { effort: 'low' }, tools: [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 2 }], messages });
    if (response.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: response.content });
  }
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  try { const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); return j.title ? { title: decode(j.title), price: price(j.price), image: '' } : null; } catch { return null; }
}

// -> { title, price, shop, url, image } or throws with words for the person.
export async function readProductLink(raw) {
  const u = publicUrl(raw);
  if (!u) throw new Error('that doesn\'t look like a link to a shop');
  if (process.env.CLAUDE_FAKE === '1') return { title: 'LEGO City Police Car 60312', price: 8.99, shop: shopName(u), url: String(u), image: 'https://media.example-shop.co.uk/police-car.jpg' };
  let page = null, found = null;
  try { page = await fetchPage(u); found = page ? fromHtml(page.html) : null; } catch (e) { console.log(`Fetching ${u.hostname} failed: ${e.message}`); }
  if (!found) { try { found = await viaClaude(String(u)); } catch (e) { console.log(`Claude couldn't read ${u.hostname}: ${e.message}`); } }
  if (!found?.title) throw new Error('the shop wouldn\'t show its page');
  const final = page?.url || String(u);
  const image = publicUrl(found.image) ? String(publicUrl(found.image)).slice(0, 600) : '';
  return { title: found.title.slice(0, 120), price: found.price, shop: shopName(final), url: String(u).slice(0, 600), image };
}
