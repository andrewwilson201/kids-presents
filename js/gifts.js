// The app's rules, kept free of the browser and of Firebase so the Firebase
// functions (functions/, a copy made at deploy time) and the tests use the
// same code: dates, ages, which reminders are due, matching present ideas to
// a party, and shop links.

// ---------- dates (all as 'YYYY-MM-DD' in UK time) ----------
export const iso = d => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
export const addDays = (day, n) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 864e5);
export const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(`${s}T12:00:00Z`));
export const isTime = s => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

// A child's age on a day, from their birthday ('YYYY-MM-DD'), or from an age
// recorded on a day (ageOn: { age, on }) when the birthday isn't known.
export function ageOn(child, day) {
  if (!child) return null;
  if (isDay(child.birthday)) {
    const [by, bm, bd] = child.birthday.split('-').map(Number);
    const [y, m, d] = day.split('-').map(Number);
    return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
  }
  if (child.age != null && isDay(child.ageOn)) return Number(child.age) + Math.floor(daysBetween(child.ageOn, day) / 365.25);
  return child.age != null ? Number(child.age) : null;
}

// The children an event is for: 'charlie', 'both' etc. -> the children list entries.
export function childrenFor(event, children = []) {
  if (!event?.child) return [];
  if (event.child === 'both' || event.child === 'all') return children;
  return children.filter(c => c.id === event.child);
}

// ---------- presents ----------
// A present is sorted once someone has it in hand (bought, or taken from the cupboard).
export const SORTED = ['bought', 'wrapped'];
export const presentSorted = e => SORTED.includes(e?.present?.state);
// Somebody has said they'll get it, so the other person shouldn't.
export const presentClaimed = e => ['chosen', ...SORTED].includes(e?.present?.state);
// Parties we're not going to don't need anything.
export const needsPresent = e => !e?.cancelled && e?.rsvp !== 'no' && e?.noPresent !== true;

export const DEFAULT_REMINDERS = { first: 10, second: 3, dayOf: true };

// Which reminders are due for an event today. Each one is sent once (event.reminded
// holds what's been sent). Returns [{ kind, title, body }].
//   first:  `first` days before, if no present is bought yet
//   second: `second` days before, if still nothing bought
//   rsvp:   2 days before the reply-by date, if we haven't replied
//   dayOf:  the morning of the party: take the present (and card)
export function dueReminders(e, today, settings = {}, children = []) {
  const s = { ...DEFAULT_REMINDERS, ...settings };
  if (!isDay(e?.date) || e.cancelled) return [];
  const sent = e.reminded || {};
  const days = daysBetween(today, e.date);
  if (days < 0) return [];
  const kids = childrenFor(e, children).map(c => c.name).join(' and ') || 'the children';
  const who = e.friend || 'a friend';
  const what = e.kind === 'birthday' ? `${who}'s birthday` : `${who}'s party`;
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `on ${new Date(`${e.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}`;
  const out = [];
  const wanted = needsPresent(e);
  const claimed = e.present?.state === 'chosen' && e.present?.by?.name ? ` ${e.present.by.name} said they'd get it.` : '';
  if (wanted && !presentSorted(e) && days > 0) {
    if (s.second && days <= s.second && !sent.second) out.push({ kind: 'second', title: `Still need a present for ${what}`, body: `It's ${when} and nothing is bought yet.${claimed} Tap for ideas.` });
    else if (s.first && days <= s.first && !sent.first && !sent.second) out.push({ kind: 'first', title: `Present needed: ${what}`, body: `${kids} ${childrenFor(e, children).length > 1 ? 'are' : 'is'} invited ${when}.${claimed || ' Tap to pick something.'}` });
  }
  if (isDay(e.rsvpBy) && !e.rsvp && !sent.rsvp) {
    const left = daysBetween(today, e.rsvpBy);
    if (left >= 0 && left <= 2) out.push({ kind: 'rsvp', title: `Reply to ${who}'s invite`, body: `They'd like an answer by ${left === 0 ? 'today' : left === 1 ? 'tomorrow' : new Date(`${e.rsvpBy}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })}.${e.contact ? ` ${e.contact}` : ''}` });
  }
  if (s.dayOf && days === 0 && !sent.dayOf && e.rsvp !== 'no') {
    const p = e.present?.name ? `Take ${e.present.name}${e.card ? '' : ' (and a card)'}.` : 'There\'s no present marked as bought yet.';
    out.push({ kind: 'dayOf', title: `${what[0].toUpperCase()}${what.slice(1)} is today${e.start ? ` at ${fmt12(e.start)}` : ''}`, body: `${p}${e.venue ? ` ${e.venue}.` : ''}` });
  }
  return out;
}
export const fmt12 = t => { if (!isTime(t)) return t || ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`; };

// ---------- matching ideas ----------
export const words = s => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
const stem = w => w.replace(/(ies)$/, 'y').replace(/(es|s)$/, '');

// Score how well an idea fits { budget, gender: 'boy'|'girl'|'', age, interests: 'dinosaurs, lego' }.
// Ideas over budget, outside the age range or marked for the other gender are left out.
export function scoreIdea(idea, q = {}, given = new Set()) {
  if (idea.hidden) return -1;
  const price = Number(idea.price) || 0;
  if (q.budget && price > Number(q.budget) * 1.1) return -1;
  if (q.age != null && q.age !== '' && ((idea.ageMin != null && q.age < idea.ageMin) || (idea.ageMax != null && q.age > idea.ageMax))) return -1;
  if (q.gender && idea.for && idea.for !== 'any' && idea.for !== q.gender) return -1;
  let score = 1;
  const want = new Set(words(q.interests).map(stem));
  if (want.size) {
    const have = new Set([...(idea.interests || []).flatMap(words), ...words(idea.name), ...words(idea.category)].map(stem));
    const hits = [...want].filter(w => have.has(w)).length;
    if (!hits && q.strict) return -1;
    score += hits * 5;
  }
  if (q.budget && price) score += 1 - Math.abs(Number(q.budget) * 0.8 - price) / Number(q.budget); // close to the budget is better
  if (idea.liked) score += 1.5;
  if (idea.given) score += Math.min(idea.given, 3) * 0.3; // worked before
  if (given.has(idea.id)) score -= 4; // already given to this friend
  return score;
}
export function matchIdeas(ideas, q = {}, { limit = 12, given = new Set() } = {}) {
  return ideas.map(i => ({ i, s: scoreIdea(i, q, given) })).filter(x => x.s >= 0)
    .sort((a, b) => b.s - a.s || (a.i.name || '').localeCompare(b.i.name || '')).slice(0, limit).map(x => x.i);
}

// The search words for an idea, for the shop links.
export const searchFor = idea => idea.search || idea.name;
export const SHOPS = [
  ['Amazon', q => `https://www.amazon.co.uk/s?k=${encodeURIComponent(q)}`],
  ['Argos', q => `https://www.argos.co.uk/search/${encodeURIComponent(q).replace(/%20/g, '-')}/`],
  ['Smyths', q => `https://www.smythstoys.com/uk/en-gb/search/?text=${encodeURIComponent(q)}`],
  ['John Lewis', q => `https://www.johnlewis.com/search?search-term=${encodeURIComponent(q)}`],
];
export const shopLinks = (q, shops = SHOPS) => shops.map(([name, url]) => ({ name, url: url(q) }));

// What we've given a friend before (by name), newest first, for "Last time" and
// to avoid giving the same thing twice.
export const sameFriend = (a, b) => String(a || '').trim().toLowerCase().replace(/\s+/g, ' ') === String(b || '').trim().toLowerCase().replace(/\s+/g, ' ');
export function pastPresents(events, friend, exceptId = null, beforeDay = null) {
  if (!friend) return [];
  return events.filter(e => e.id !== exceptId && sameFriend(e.friend, friend) && e.present?.name && presentSorted(e) && (!beforeDay || (e.date || '') < beforeDay))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .map(e => ({ date: e.date, name: e.present.name, ideaId: e.present.ideaId || null }));
}

// ---------- invites read by Claude ----------
// Tidy what Claude read from an invite picture into an event, guessing which
// of our children it's for from the name on the invite.
export function eventFromInvite(r, children = [], today = '') {
  const clean = s => (typeof s === 'string' ? s.trim().slice(0, 300) : '');
  let date = isDay(r.date) ? r.date : '';
  // An invite with no year: Claude may give last year's date. Use the next one.
  if (date && today && daysBetween(today, date) < -60) date = `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`;
  const named = clean(r.invited_child).toLowerCase();
  const matches = children.filter(c => named && named.split(/[^a-z]+/).includes(c.name.toLowerCase()));
  const age = Number.isFinite(Number(r.turning_age)) && Number(r.turning_age) > 0 ? Number(r.turning_age) : null;
  return {
    kind: 'party',
    friend: clean(r.birthday_child),
    friendAge: age,
    friendGender: ['boy', 'girl'].includes(r.birthday_child_gender) ? r.birthday_child_gender : '',
    date,
    start: isTime(r.start_time) ? r.start_time : '',
    end: isTime(r.end_time) ? r.end_time : '',
    venue: clean(r.venue),
    address: clean(r.address),
    rsvpBy: isDay(r.rsvp_by) ? r.rsvp_by : '',
    contact: clean(r.rsvp_contact),
    theme: clean(r.theme),
    notes: clean(r.other_details),
    child: matches.length === 1 ? matches[0].id : matches.length > 1 ? 'both' : '',
  };
}
