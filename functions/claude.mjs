// Claude's three jobs: reading a party invite (a picture or a message),
// suggesting kinds of present, and finding real products in UK shops (web search).
// Needs ANTHROPIC_API_KEY. With CLAUDE_FAKE=1 (the tests), made-up answers come
// back instead, so nothing is spent and no key is needed.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const fake = () => process.env.CLAUDE_FAKE === '1';

async function ask({ system, content, schema, effort = 'low' }) {
  const response = await new Anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default', // if a safety check declines, the API retries on a suitable model
    output_config: { effort, format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') throw new Error(`Claude stopped: ${response.stop_reason}`);
  return JSON.parse(response.content.filter(b => b.type === 'text').map(b => b.text).join(''));
}

// ---------- invites ----------
const S = (description) => ({ type: 'string', description });
export const INVITE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_invite', 'birthday_child', 'other_birthday_children', 'turning_age', 'birthday_child_gender', 'invited_child', 'date', 'start_time', 'end_time', 'venue', 'address', 'rsvp_by', 'rsvp_contact', 'theme', 'other_details', 'problem'],
  properties: {
    is_invite: { type: 'boolean', description: 'true if this is an invitation to a party or event' },
    birthday_child: S('First name (and surname if shown) of the child whose party it is, or ""'),
    turning_age: { type: 'integer', description: 'The age they are turning, or 0 if not stated' },
    other_birthday_children: {
      type: 'array',
      description: 'For a joint party (twins, friends sharing a party): every birthday child after the first. Empty for an ordinary party.',
      items: { type: 'object', additionalProperties: false, required: ['name', 'turning_age', 'gender'], properties: { name: S('Their name'), turning_age: { type: 'integer', description: 'The age they are turning, or 0 if not stated' }, gender: { type: 'string', enum: ['boy', 'girl', ''] } } },
    },
    birthday_child_gender: { type: 'string', enum: ['boy', 'girl', ''], description: 'Only if clear from the invite (pronouns, "his", a name that is clearly one or the other); otherwise ""' },
    invited_child: S('The name written on the invite as the guest (e.g. "Dear Charlie"), or ""'),
    date: S('YYYY-MM-DD, or "" if no date'),
    start_time: S('24-hour HH:MM, or ""'),
    end_time: S('24-hour HH:MM, or ""'),
    venue: S('Name of the place, e.g. "Jump Zone" or "our house", or ""'),
    address: S('Address or postcode as written, or ""'),
    rsvp_by: S('YYYY-MM-DD reply-by date, or ""'),
    rsvp_contact: S('Who to reply to and how (name, phone number), as written, or ""'),
    theme: S('Party theme if stated, or ""'),
    other_details: S('Anything else a parent needs to know in one short sentence (bring a swimsuit, socks for soft play, drop-off party), or ""'),
    problem: S('If something important could not be read (blurry, cut off), say what in a few words; otherwise ""'),
  },
};
const INVITE_SYSTEM = `You read children's birthday party invitations for a UK family and return the details as JSON.
The invitation is a picture or the words of a message. Read every part of it, including handwriting. Dates are UK style (day before month). If the invite gives a day and month without a year, use the next time that date comes after today's date. Times like "2-4pm" mean start 14:00, end 16:00.
Some parties are joint, for two or more birthday children ("Olivia and Max are turning 7"): put the first in birthday_child and each of the others in other_birthday_children, with their own age if the invite gives one. The guest the invite is addressed to is never a birthday child.
Don't guess: leave a field empty when the invite doesn't say. Don't include anything that isn't on the invite.`;

// `source` is { image: a data URL } or { text: the words of a message }.
export async function readInvite(source, { today, children = [] }) {
  if (fake()) {
    return { is_invite: !/not an invite/i.test(source.text || ''), birthday_child: 'Olivia', other_birthday_children: [], turning_age: 7, birthday_child_gender: 'girl', invited_child: children[0]?.name || '', date: addDaysIso(today, 12), start_time: '14:00', end_time: '16:00', venue: 'Jump Zone', address: 'Mill Lane, AB1 2CD', rsvp_by: addDaysIso(today, 5), rsvp_contact: 'Sarah 07700 900123', theme: 'Unicorns', other_details: 'Socks needed for the trampolines.', problem: '' };
  }
  const about = `Today is ${today}. Our children are ${children.map(c => `${c.name} (${c.gender})`).join(' and ') || 'not listed'}.`;
  if (source.text) {
    return ask({ system: INVITE_SYSTEM, schema: INVITE_SCHEMA, effort: 'medium', content: `${about} This invitation arrived as a message. Read it.\n\n<message>\n${String(source.text).slice(0, 4000)}\n</message>` });
  }
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(source.image || '');
  if (!m) throw new Error('The picture didn\'t arrive properly. Try again.');
  return ask({
    system: INVITE_SYSTEM,
    schema: INVITE_SCHEMA,
    effort: 'medium',
    content: [
      { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
      { type: 'text', text: `${about} Read this invitation.` },
    ],
  });
}
const addDaysIso = (day, n) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ---------- present ideas ----------
export const IDEAS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ideas'],
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['existing_id', 'name', 'why', 'description', 'price', 'age_min', 'age_max', 'for', 'category', 'interests', 'search'],
        properties: {
          existing_id: S('id of an idea from the saved list, or "" for a new idea'),
          name: S('Short product-type name, e.g. "LEGO Friends small set" (not one exact listing that may sell out)'),
          why: S('One short sentence on why it suits this child'),
          description: S('One short sentence describing it, for new ideas; "" for saved ones'),
          price: { type: 'number', description: 'Typical UK price in pounds' },
          age_min: { type: 'integer' },
          age_max: { type: 'integer' },
          for: { type: 'string', enum: ['any', 'boy', 'girl'], description: '"any" unless it really only suits one' },
          category: S('e.g. Building, Arts & crafts, Books, Games, Science, Sport, Toys, Soft toys, Collecting, Outdoors'),
          interests: { type: 'array', items: { type: 'string' }, description: '2 to 5 lower-case interest keywords' },
          search: S('Words to search a UK shop for it'),
        },
      },
    },
  },
};
const IDEAS_SYSTEM = `You suggest birthday party presents for UK primary-school children. The family buys a present for each party their children are invited to, usually from Amazon UK, Argos, Smyths or John Lewis.
Good party presents: easy to buy this week, fit the budget (typical UK price including any offers, never over it), suit the age, and are things children of that age are into right now. Prefer things that don't need much from the parents (no huge messy kits, no pets, nothing needing a grown-up's app). Avoid anything unsafe for the age (small parts under 3s, sharp tools).
Mix ideas from the family's saved list (existing_id set; they like these) with new ones (existing_id ""). Don't repeat anything already given to this child. Give exactly 8 ideas, the best first, each different in kind.`;

export async function suggestIdeas({ budget, gender, age, interests, friend }, saved = [], givenBefore = []) {
  if (fake()) {
    const pick = saved.slice(0, 3).map(i => ({ existing_id: i.id, name: i.name, why: 'A favourite that fits the budget.', description: '', price: i.price || 10, age_min: i.ageMin ?? 4, age_max: i.ageMax ?? 10, for: i.for || 'any', category: i.category || 'Toys', interests: i.interests || [], search: i.search || i.name }));
    return [...pick, { existing_id: '', name: 'Fake new idea from Claude', why: `Great for someone into ${interests || 'everything'}.`, description: 'Made up by the test.', price: Math.min(Number(budget) || 10, 10), age_min: 5, age_max: 9, for: 'any', category: 'Toys', interests: ['test'], search: 'fake idea' }];
  }
  const list = saved.filter(i => !i.hidden).map(i => `${i.id} | ${i.name} | £${i.price ?? '?'} | ages ${i.ageMin ?? '?'}-${i.ageMax ?? '?'} | ${i.for || 'any'}${i.liked ? ' | liked' : ''}${i.given ? ` | given ${i.given}x` : ''}`).join('\n');
  const out = await ask({
    system: IDEAS_SYSTEM,
    schema: IDEAS_SCHEMA,
    effort: 'medium',
    content: [
      `Present for: ${friend || 'a child'}${age ? `, turning ${age}` : ''}${gender ? `, a ${gender}` : ''}`,
      `Budget: up to £${budget || 15}`,
      interests ? `They're into: ${interests}` : 'Interests: not known, so go for things most children that age enjoy.',
      givenBefore.length ? `Already given to them before: ${givenBefore.join(', ')}` : '',
      `Month: ${new Date().toLocaleDateString('en-GB', { month: 'long', timeZone: 'Europe/London' })}`,
      `Saved ideas (id | name | typical price | ages | for):\n${list}`,
    ].filter(Boolean).join('\n\n'),
  });
  return out.ideas || [];
}

// ---------- real products, from the shops ----------
// Claude searches the web for things that can be bought today and returns
// [{ title, price, shop, url, why }]. Slower and dearer than the ideas above
// (a few pence and a minute or so), so it only runs when asked for.
const PRODUCTS_SYSTEM = `You find birthday party presents that a UK family can buy today, by searching UK shops' websites.
Search well-known UK retailers (Amazon UK, Argos, Smyths Toys, John Lewis, The Entertainer, Waterstones, WHSmith, Hobbycraft, Tesco, Sainsbury's, B&M and the like). Each product must be a specific item on a UK retailer's own product page, priced in pounds at or under the budget, suitable for the age, and not marked out of stock on the page you found.
Only give a URL that appeared in your search results: never make one up or guess one, and never give a search or category page. Give the price you saw. If you can't confirm a price, leave the product out.
Aim for 6 products, different in kind and from more than one shop, the best first. Don't include anything already given to this child.
When you have finished searching, reply with only a JSON object, with no other words:
{"products":[{"title":"the product's name as the shop gives it, shortened to under 70 characters","price":9.99,"shop":"Argos","url":"https://...","why":"one short sentence on why it suits this child"}]}`;

// Every web address in the search results Claude saw.
function resultUrls(node, out = new Set()) {
  if (Array.isArray(node)) node.forEach(n => resultUrls(n, out));
  else if (node && typeof node === 'object') {
    if (typeof node.url === 'string') out.add(tidyUrl(node.url));
    Object.values(node).forEach(v => resultUrls(v, out));
  }
  return out;
}
const tidyUrl = u => String(u).split('#')[0].split('?')[0].replace(/\/$/, '').toLowerCase();
const shopOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

export async function findProducts({ budget, gender, age, interests, friend, theme, hint }, givenBefore = []) {
  const max = Number(budget) || 15;
  if (fake()) {
    return [
      { title: `Fake ${hint || 'craft set'} from the shops`, price: Math.min(max, 9.99), shop: 'Argos', url: 'https://www.argos.co.uk/product/1234567', why: `Suits someone into ${interests || 'most things'}.` },
      { title: 'Fake story book', price: Math.min(max, 6.5), shop: 'Waterstones', url: 'https://www.waterstones.com/book/fake/123', why: 'A good read for the age.' },
      { title: 'Made-up link, dropped', price: 5, shop: 'Nowhere', url: 'http://example.com/not-https', why: '' },
    ].map(cleanProduct).filter(Boolean);
  }
  const client = new Anthropic();
  const messages = [{
    role: 'user',
    content: [
      `Present for: ${friend || 'a child'}${age ? `, turning ${age}` : ''}${gender ? `, a ${gender}` : ''}`,
      `Budget: up to £${max}`,
      hint ? `We'd like this kind of thing: ${hint}. Find real examples of it.` : interests ? `They're into: ${interests}` : 'Interests: not known, so go for things most children that age enjoy.',
      !hint && theme ? `Their party theme is ${theme}, which may be a clue.` : '',
      givenBefore.length ? `Already given to them before: ${givenBefore.join(', ')}` : '',
      `Today: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' })}`,
    ].filter(Boolean).join('\n'),
  }];
  const seen = new Set();
  let response;
  // A long search can pause part-way (stop_reason pause_turn): send it back to carry on.
  for (let turn = 0; turn < 6; turn++) {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: PRODUCTS_SYSTEM,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8, user_location: { type: 'approximate', country: 'GB', timezone: 'Europe/London' } }],
      messages,
    });
    resultUrls(response.content.filter(b => b.type !== 'text'), seen);
    if (response.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: response.content });
  }
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to search for that');
  if (response.stop_reason === 'pause_turn') throw new Error('The search took too long');
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  let found;
  try { found = JSON.parse(json).products; } catch { throw new Error('Claude\'s answer couldn\'t be read'); }
  let products = (Array.isArray(found) ? found : []).map(cleanProduct).filter(p => p && (!p.price || p.price <= max * 1.05));
  // Keep to pages that really came up in the search, when we can tell which did.
  const real = products.filter(p => seen.has(tidyUrl(p.url)));
  if (seen.size && real.length >= 2) products = real;
  return products.slice(0, 8);
}
function cleanProduct(p) {
  const url = typeof p?.url === 'string' && /^https:\/\/[^\s"<>]+$/.test(p.url) ? p.url.slice(0, 600) : '';
  const title = String(p?.title || '').trim().slice(0, 120);
  if (!url || !title) return null;
  return { title, price: Number(p.price) > 0 ? Math.round(Number(p.price) * 100) / 100 : null, shop: String(p.shop || shopOf(url)).trim().slice(0, 40), url, why: String(p.why || '').trim().slice(0, 200) };
}
