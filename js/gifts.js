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
    const p = e.present?.name ? `Take ${e.present.name}${e.present.state === 'wrapped' ? '' : ' (and a card)'}.` : 'There\'s no present marked as bought yet.';
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
// The best matches first. Ideas that score about the same are mixed up by kind
// (not listed A to Z), so the first few aren't all craft kits.
const mix = id => { let h = 7; for (const c of String(id || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return (h % 1000) / 1000; };
export function matchIdeas(ideas, q = {}, { limit = 12, given = new Set() } = {}) {
  const pool = ideas.map(i => ({ i, s: scoreIdea(i, q, given) })).filter(x => x.s >= 0).map(x => ({ i: x.i, s: x.s + mix(x.i.id || x.i.name) * 0.4 }));
  const out = []; const seen = {};
  while (pool.length && out.length < limit) {
    let best = 0;
    for (let k = 1; k < pool.length; k++) if (pool[k].s - (seen[pool[k].i.category] || 0) * 0.7 > pool[best].s - (seen[pool[best].i.category] || 0) * 0.7) best = k;
    const [x] = pool.splice(best, 1);
    seen[x.i.category] = (seen[x.i.category] || 0) + 1;
    out.push(x.i);
  }
  return out;
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

// ---------- friends ----------
// A friend is known by their name and which of our children they're a friend
// of, so Charlie's friend Jack and Sophie's friend Jack are kept apart.
export const nameKey = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
export const sameFriend = (a, b) => nameKey(a) === nameKey(b);
export const shareChild = (a, b) => !a || !b || a === 'both' || b === 'both' || a === b;
export const samePerson = (a, b) => !!nameKey(a?.friend) && sameFriend(a.friend, b?.friend) && shareChild(a.child, b?.child);

// What we've given a friend before, newest first, for "Given before" and to
// avoid giving the same thing twice. `child` is which of ours they're a friend of.
export function pastPresents(events, friend, exceptId = null, beforeDay = null, child = '') {
  if (!friend) return [];
  return events.filter(e => e.id !== exceptId && samePerson(e, { friend, child }) && e.present?.name && presentSorted(e) && (!beforeDay || (e.date || '') < beforeDay))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .map(e => ({ date: e.date, name: e.present.name, ideaId: e.present.ideaId || null }));
}

// The party already in the calendar that this one would repeat: the same
// birthday child on the same day (when the same invite is shared twice, or you
// both add it).
export function findDuplicate(events, cand) {
  if (!isDay(cand?.date) || !nameKey(cand.friend)) return null;
  return events.find(e => e.id !== cand.id && e.date === cand.date && samePerson(e, cand)) || null;
}

const slug = s => nameKey(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// A date's anniversary in a year (29 Feb becomes 28 Feb).
const inYear = (day, year) => { const d = `${year}${day.slice(4)}`; return isDay(d) && new Date(`${d}T12:00:00Z`).getUTCDate() === Number(d.slice(8)) ? d : `${year}-02-28`; };

// Everyone whose party or birthday has been in the calendar, worked out from
// the events: [{ key, name, child, gender, interests, events (newest first),
// last, upcoming, turned { age, on }, presents [{ date, name }] }].
export function friendsFrom(events, today) {
  const out = [];
  for (const e of [...events].sort((a, b) => (a.date || '').localeCompare(b.date || ''))) {
    if (!nameKey(e.friend)) continue;
    let f = out.find(x => samePerson({ friend: x.name, child: x.child }, e));
    if (!f) { f = { name: e.friend.trim(), child: '', gender: '', interests: '', events: [], last: null, upcoming: null, turned: null, presents: [] }; out.push(f); }
    f.events.unshift(e);
    f.name = e.friend.trim();
    if (e.child) f.child = e.child;
    if (e.friendGender) f.gender = e.friendGender;
    if (e.interests) f.interests = e.interests;
    if (isDay(e.date)) {
      if (e.friendAge) f.turned = { age: Number(e.friendAge), on: e.date };
      if (e.date >= today && !e.cancelled) f.upcoming ||= e;
      else if (e.date < today) f.last = e;
    }
    if (e.present?.name && presentSorted(e)) f.presents.unshift({ date: e.date, name: e.present.name });
  }
  for (const f of out) f.key = `${slug(f.name)}--${f.child || 'x'}`;
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
// The age a friend turns on a day, counting on from the last age we were told.
export const turningOn = (f, day) => (f?.turned && isDay(day) ? f.turned.age + Math.max(0, Number(day.slice(0, 4)) - Number(f.turned.on.slice(0, 4))) : null);

// Friends whose birthday is probably coming round again: their party was about
// this time in an earlier year, and there's nothing in the calendar for them
// yet. `snoozed` is { friend key: year } for "Not this year".
export function birthdaysDue(friends, today, snoozed = {}, { before = 45, after = 14 } = {}) {
  const out = [];
  for (const f of friends) {
    const latest = f.events.find(e => isDay(e.date));
    if (!latest || f.upcoming || latest.date >= today) continue;
    for (const year of [-1, 0, 1].map(n => Number(today.slice(0, 4)) + n)) {
      const day = inYear(latest.date, year);
      const d = daysBetween(today, day);
      if (d < -after || d > before || daysBetween(latest.date, day) < 200 || snoozed?.[f.key] === year) continue;
      out.push({ friend: f, day, year, age: turningOn(f, day), likeId: latest.id });
      break;
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
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

// ---------- joint parties ----------
// A party for more than one birthday child (twins, friends sharing a party) is
// one event per birthday child, each with its own present, ideas and bought
// state, tied together by the same groupId. The party's own details (date,
// place, reply, who's invited) are kept the same on each of them.
export function siblingsOf(e, events) {
  if (!e) return [];
  if (!e.groupId) return [e];
  return events.filter(x => x.groupId === e.groupId).sort((a, b) => (a.groupOrder ?? 0) - (b.groupOrder ?? 0) || String(a.id).localeCompare(String(b.id)));
}
// The events as parties: [[event], [event, event], ...], in the order given.
export function groupEvents(events) {
  const seen = new Set(); const out = [];
  for (const e of events) {
    const k = e.groupId || e.id;
    if (seen.has(k)) continue;
    seen.add(k); out.push(siblingsOf(e, events));
  }
  return out;
}
export const joinNames = names => (names.length <= 1 ? (names[0] || '') : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`);

// The morning-of reminder for a joint party: one message, every present.
export function jointDayOf(sibs) {
  const e = sibs[0];
  const parts = sibs.map(s => `${s.friend || 'a friend'}: ${s.present?.name && presentSorted(s) ? s.present.name : needsPresent(s) ? 'nothing bought yet' : 'no present needed'}`);
  return { kind: 'dayOf', title: `${joinNames(sibs.map(s => s.friend || 'a friend'))}'s party is today${e.start ? ` at ${fmt12(e.start)}` : ''}`, body: `Presents to take. ${parts.join('; ')}. Don't forget the cards.${e.venue ? ` ${e.venue}.` : ''}` };
}

// An invite for a joint party: one event per birthday child on it.
export function eventsFromInvite(r, children = [], today = '') {
  const first = eventFromInvite(r, children, today);
  const others = (Array.isArray(r.other_birthday_children) ? r.other_birthday_children : [])
    .map(o => ({ name: typeof o?.name === 'string' ? o.name.trim().slice(0, 80) : '', age: Number(o?.turning_age) > 0 ? Number(o.turning_age) : null, gender: ['boy', 'girl'].includes(o?.gender) ? o.gender : '' }))
    .filter((o, i, all) => o.name && !sameFriend(o.name, first.friend) && all.findIndex(x => sameFriend(x.name, o.name)) === i).slice(0, 5);
  return [first, ...others.map(o => ({ ...first, friend: o.name, friendAge: o.age, friendGender: o.gender }))];
}
