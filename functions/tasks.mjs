// The functions' work, kept apart from index.mjs (which only declares the
// Firebase triggers) so the tests can call it directly against the emulator.
import { readInvite, suggestIdeas, findProducts } from './claude.mjs';
import { notify } from './notify.mjs';
import { readProductLink } from './link.mjs';
import { households } from './access.mjs';
import { iso, addDays, eventsFromInvite, dueReminders, pastPresents, DEFAULT_REMINDERS, isDay, daysBetween, groupEvents, jointDayOf, joinNames, findDuplicate, friendsFrom, samePerson, turningOn } from './shared/gifts.js';

// Only one run works on a request: 'requested' -> 'working'.
async function claim(ref) {
  return ref.firestore.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.data()?.state !== 'requested') return false;
    tx.update(ref, { state: 'working', startedAt: new Date() });
    return true;
  });
}
const plainError = e => (e?.status === 401 ? 'The Claude API key isn\'t working. Set it again (see the README).' : e?.status === 429 ? 'Claude is busy. Try again in a minute.' : String(e?.message || e).slice(0, 200));

// An invite (a picture, or the words of a message): Claude reads it, and the
// party is added for you to check. If the same birthday child's party is
// already in the calendar for that day, nothing is added twice: the scan
// points at the one that's there, and any gaps in it are filled in.
const PARTY_FIELDS = ['start', 'end', 'venue', 'address', 'rsvpBy', 'contact', 'theme', 'notes'];
export async function processScan(h, ref, now = new Date()) {
  if (!(await claim(ref))) return null;
  const scan = (await ref.get()).data();
  try {
    const children = h.data().children || [];
    const today = iso(now);
    const image = scan.text ? '' : (await h.ref.collection('scanImages').doc(ref.id).get()).data()?.image || scan.image || '';
    const r = await readInvite(scan.text ? { text: scan.text } : { image }, { today, children });
    if (!r.is_invite) {
      await ref.update({ state: 'failed', message: 'That doesn\'t look like a party invite.' });
      return null;
    }
    // A joint party comes back as one event per birthday child.
    const evs = eventsFromInvite(r, children, today);
    if (!evs[0].friend && !evs[0].date) {
      await ref.update({ state: 'failed', message: r.problem || 'Claude couldn\'t make out the details. Try a clearer picture, or type it in.' });
      return null;
    }
    const existing = (await h.ref.collection('events').get()).docs.map(d => ({ id: d.id, ...d.data() }));
    // Friends we know from earlier years: fill in what the invite doesn't say.
    const known = friendsFrom(existing, today);
    for (const ev of evs) {
      const f = known.find(x => samePerson({ friend: x.name, child: x.child }, ev));
      if (!f) continue;
      if (!ev.child && f.child) ev.child = f.child;
      if (!ev.friendGender && f.gender) ev.friendGender = f.gender;
      if (f.interests) ev.interests = f.interests;
      if (!ev.friendAge && isDay(ev.date)) ev.friendAge = turningOn(f, ev.date);
    }
    for (const ev of evs) ev.child ||= evs.find(x => x.child)?.child || '';
    const batch = h.ref.firestore.batch();
    const events = h.ref.collection('events');
    const twins = evs.map(ev => findDuplicate(existing, ev));
    const twin = twins.find(Boolean);
    if (twin) {
      // Already there. Fill its gaps, and add any birthday child the invite has that the party doesn't.
      const groupId = twin.groupId || twin.id;
      const group = existing.filter(x => x.id === twin.id || (twin.groupId && x.groupId === twin.groupId));
      const fresh = evs.filter((_, i) => !twins[i]);
      const gaps = Object.fromEntries(PARTY_FIELDS.filter(k => !twin[k] && evs[0][k]).map(k => [k, evs[0][k]]));
      for (const x of group) {
        const mine = evs[twins.findIndex(t => t?.id === x.id)] || {};
        const fill = { ...gaps, ...(!x.friendAge && mine.friendAge ? { friendAge: mine.friendAge } : {}), ...(!x.friendGender && mine.friendGender ? { friendGender: mine.friendGender } : {}),
          ...(!x.scanId ? { scanId: ref.id } : {}), ...(fresh.length ? { groupId, groupOrder: x.groupOrder ?? 0 } : {}) };
        if (Object.keys(fill).length) batch.update(events.doc(x.id), fill);
      }
      let order = Math.max(0, ...group.map(x => x.groupOrder ?? 0));
      const { present, reminded, products, id, friend, friendAge, friendGender, interests, noPresent, ...party } = twin;
      for (const ev of fresh) batch.set(events.doc(), { ...party, friend: ev.friend, friendAge: ev.friendAge, friendGender: ev.friendGender, interests: ev.interests || '', groupId, groupOrder: ++order, needsCheck: true, scanId: ref.id, createdBy: scan.by || null, createdAt: now });
      batch.update(ref, { state: 'done', eventId: twin.id, duplicate: true, doneAt: now });
      await batch.commit();
      return twin.id;
    }
    const refs = evs.map(() => events.doc());
    const evRef = refs[0];
    refs.forEach((rf, i) => batch.set(rf, { ...evs[i], needsCheck: true, scanId: ref.id, readProblem: r.problem || '', createdBy: scan.by || null, createdAt: now, ...(evs.length > 1 ? { groupId: evRef.id, groupOrder: i } : {}) }));
    batch.update(ref, { state: 'done', eventId: evRef.id, doneAt: now });
    await batch.commit();
    return evRef.id;
  } catch (e) {
    console.error('Reading an invite failed', e);
    await ref.update({ state: 'failed', message: plainError(e) });
    return null;
  }
}

// "Ask Claude". For a link (kind: 'link'): the product a pasted shop link points
// at (functions/link.mjs). For ideas (kinds of present): new ones join the household's
// ideas, so they're there next time. For products (kind: 'products'): real
// things in the shops today, saved on the party so you both see them.
export async function processAsk(h, ref, now = new Date()) {
  if (!(await claim(ref))) return null;
  const a = (await ref.get()).data();
  try {
    // A pasted shop link: what is it, and what does it cost?
    if (a.kind === 'link') {
      // The name can come before the price (Amazon): the card shows it while the price is looked for.
      const product = await readProductLink(a.url, named => ref.update({ named }));
      await ref.update({ state: 'done', product, doneAt: now });
      return product;
    }
    let given = [];
    if (a.friend) {
      const events = (await h.ref.collection('events').get()).docs.map(d => ({ id: d.id, ...d.data() }));
      given = pastPresents(events, a.friend, a.eventId, null, a.child || '').map(p => p.name);
    }
    if (a.kind === 'products') {
      const products = await findProducts(a, given);
      if (!products.length) {
        await ref.update({ state: 'failed', message: 'nothing suitable turned up' });
        return null;
      }
      const batch = h.ref.firestore.batch();
      const evRef = a.eventId ? h.ref.collection('events').doc(a.eventId) : null;
      if (evRef && (await evRef.get()).exists) batch.update(evRef, { products: { at: now.toISOString(), hint: a.hint || '', items: products } });
      batch.update(ref, { state: 'done', products, doneAt: now });
      await batch.commit();
      return products;
    }
    const ideasSnap = await h.ref.collection('ideas').get();
    const saved = ideasSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const byId = new Map(saved.map(i => [i.id, i]));
    const byName = new Map(saved.map(i => [String(i.name).toLowerCase().trim(), i]));
    const ideas = await suggestIdeas(a, saved, given);
    const out = [];
    const batch = h.ref.firestore.batch();
    for (const i of ideas) {
      if (out.length >= 10) break;
      let id = i.existing_id && byId.has(i.existing_id) ? i.existing_id : byName.get(String(i.name).toLowerCase().trim())?.id;
      if (!id) {
        if (!i.name) continue;
        const r = h.ref.collection('ideas').doc();
        id = r.id;
        const idea = { name: String(i.name).slice(0, 120), description: String(i.description || '').slice(0, 300), price: Number(i.price) || null, ageMin: i.age_min ?? null, ageMax: i.age_max ?? null, for: ['boy', 'girl'].includes(i.for) ? i.for : 'any', category: i.category || '', interests: (i.interests || []).slice(0, 6), search: i.search || i.name, source: 'claude', createdAt: now };
        batch.set(r, idea);
        byName.set(idea.name.toLowerCase(), { id, ...idea });
      }
      if (!out.some(o => o.ideaId === id)) out.push({ ideaId: id, why: String(i.why || '').slice(0, 200) });
    }
    batch.update(ref, { state: 'done', ideas: out, doneAt: now });
    await batch.commit();
    return out;
  } catch (e) {
    console.error('Asking Claude failed', e);
    await ref.update({ state: 'failed', message: plainError(e) });
    return null;
  }
}

// Every morning: reminders for parties coming up (functions/index.mjs runs it at 8am UK time).
// A reminder only counts as sent once it reached a phone, so if nobody has
// notifications on yet it's tried again the next morning.
export async function sendReminders(db, now = new Date()) {
  const today = iso(now);
  let sent = 0;
  for (const h of await households(db)) {
    const hd = h.data();
    const settings = { ...DEFAULT_REMINDERS, ...(hd.reminders || {}) };
    const snap = await h.ref.collection('events').where('date', '>=', today).get();
    const all = snap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));
    // A joint party is one event per birthday child: each child's present gets
    // its own reminders, but the reply and morning-of reminders are sent once.
    const once = new Map();
    for (const e of all) {
      const due = dueReminders(e, today, settings, hd.children || []);
      if (!due.length) continue;
      const update = {};
      for (let r of due) {
        const key = e.groupId && ['rsvp', 'dayOf'].includes(r.kind) ? `${e.groupId}-${r.kind}` : null;
        let reached;
        if (key && once.has(key)) reached = once.get(key);
        else {
          if (key) {
            const sibs = all.filter(x => x.groupId === e.groupId).sort((a, b) => (a.groupOrder ?? 0) - (b.groupOrder ?? 0));
            if (r.kind === 'dayOf' && sibs.length > 1) r = jointDayOf(sibs);
          }
          reached = await notify(h, { title: r.title, body: r.body, link: `#/event/${e.id}`, tag: `${e.id}-${r.kind}` });
          if (key) once.set(key, reached);
          if (reached) sent++;
        }
        if (reached) update[`reminded.${r.kind}`] = now;
      }
      if (Object.keys(update).length) await e.ref.update(update);
    }
  }
  return sent;
}

// ---------- the calendar feed (calendar.ics) ----------
const icsText = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const fold = line => { const out = []; let s = line; while (s.length > 73) { out.push(s.slice(0, 73)); s = ` ${s.slice(73)}`; } out.push(s); return out.join('\r\n'); };
const stamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
// One calendar entry for a party (a joint party's events together): used by
// the feed below and by the Google Calendar invites (gcal.mjs).
export function partyEntry(hd, group) {
  const kids = hd.children || [];
  const kidName = c => (c === 'both' ? kids.map(k => k.name).join(' & ') : kids.find(k => k.id === c)?.name || '');
  const e = group[0];
  const who = kidName(e.child);
  const name = `${joinNames(group.map(x => x.friend || 'Party'))}'s ${e.kind === 'birthday' ? 'birthday' : 'party'}`;
  const present = group.map(x => {
    const p = x.present || {};
    const label = group.length > 1 ? `Present for ${x.friend}` : 'Present';
    return p.name ? `${label}: ${p.name} (${p.state === 'chosen' ? `${p.by?.name || 'someone'} is getting it` : p.state})` : `${label}: not sorted yet`;
  }).join('\n');
  const timed = Boolean(e.start) && e.kind !== 'birthday';
  const end = timed ? (e.end && e.end > e.start ? e.end : `${String(Math.min(23, Number(e.start.slice(0, 2)) + 2)).padStart(2, '0')}${e.start.slice(2)}`) : '';
  return {
    id: e.groupId || e.id, date: e.date, timed, start: timed ? e.start : '', end, who, name,
    title: `${who ? `${who}: ` : ''}${name}`,
    location: [e.venue, e.address].filter(Boolean).join(', '),
    details: [present, e.rsvpBy ? `Reply by ${e.rsvpBy}${e.contact ? ` to ${e.contact}` : ''}` : '', e.notes].filter(Boolean).join('\n'),
    cancelled: Boolean(e.cancelled), notGoing: e.rsvp === 'no', kind: e.kind || 'party',
  };
}

export function buildCalendar(hd, events, now = new Date()) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Party Presents//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsText(`${hd.name || 'Family'} parties`)}`, 'X-WR-TIMEZONE:Europe/London', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H'];
  // A joint party (one event per birthday child) is one calendar entry.
  for (const group of groupEvents(events)) {
    const e = group[0];
    if (!isDay(e.date) || daysBetween(e.date, iso(now)) > 400) continue;
    const p = partyEntry(hd, group);
    const day = e.date.replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${e.id}@party-presents`, `DTSTAMP:${stamp(now)}`);
    if (p.timed) {
      lines.push(`DTSTART;TZID=Europe/London:${day}T${p.start.replace(':', '')}00`, `DTEND;TZID=Europe/London:${day}T${p.end.replace(':', '')}00`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${addDays(e.date, 1).replace(/-/g, '')}`);
    }
    lines.push(fold(`SUMMARY:${icsText(`${p.title}${p.cancelled ? ' (cancelled)' : p.notGoing ? ' (not going)' : ''}`)}`));
    if (p.location) lines.push(fold(`LOCATION:${icsText(p.location)}`));
    lines.push(fold(`DESCRIPTION:${icsText(p.details)}`));
    if (p.cancelled) lines.push('STATUS:CANCELLED');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
