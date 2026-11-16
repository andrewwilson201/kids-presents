// Claude's two jobs: reading a party invite picture, and suggesting presents.
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
    is_invite: { type: 'boolean', description: 'true if the picture is an invitation to a party or event' },
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
Read every part of the picture, including handwriting. Dates are UK style (day before month). If the invite gives a day and month without a year, use the next time that date comes after today's date. Times like "2-4pm" mean start 14:00, end 16:00.
Some parties are joint, for two or more birthday children ("Olivia and Max are turning 7"): put the first in birthday_child and each of the others in other_birthday_children, with their own age if the invite gives one. The guest the invite is addressed to is never a birthday child.
Don't guess: leave a field empty when the invite doesn't say. Don't include anything that isn't on the invite.`;

export async function readInvite(dataUrl, { today, children = [] }) {
  if (fake()) return { is_invite: true, birthday_child: 'Olivia', other_birthday_children: [], turning_age: 7, birthday_child_gender: 'girl', invited_child: children[0]?.name || '', date: addDaysIso(today, 12), start_time: '14:00', end_time: '16:00', venue: 'Jump Zone', address: 'Mill Lane, AB1 2CD', rsvp_by: addDaysIso(today, 5), rsvp_contact: 'Sarah 07700 900123', theme: 'Unicorns', other_details: 'Socks needed for the trampolines.', problem: '' };
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('The picture didn\'t arrive properly. Try again.');
  return ask({
    system: INVITE_SYSTEM,
    schema: INVITE_SCHEMA,
    effort: 'medium',
    content: [
      { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
      { type: 'text', text: `Today is ${today}. Our children are ${children.map(c => `${c.name} (${c.gender})`).join(' and ') || 'not listed'}. Read this invitation.` },
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
