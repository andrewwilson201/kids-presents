// The functions' work, kept apart from index.mjs (which only declares the
// Firebase triggers) so the tests can call it directly against the emulator.
import { readInvite, suggestIdeas } from './claude.mjs';
import { notify } from './notify.mjs';
import { households } from './access.mjs';
import { iso, addDays, eventFromInvite, dueReminders, pastPresents, DEFAULT_REMINDERS, isDay, daysBetween } from './shared/gifts.js';

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

// An invite picture: Claude reads it, and the party is added for you to check.
export async function processScan(h, ref, now = new Date()) {
  if (!(await claim(ref))) return null;
  const scan = (await ref.get()).data();
  try {
    const children = h.data().children || [];
    const today = iso(now);
    const r = await readInvite(scan.image, { today, children });
    if (!r.is_invite) {
      await ref.update({ state: 'failed', message: 'That doesn\'t look like a party invite.' });
      return null;
    }
    const ev = eventFromInvite(r, children, today);
    if (!ev.friend && !ev.date) {
      await ref.update({ state: 'failed', message: r.problem || 'Claude couldn\'t make out the details. Try a clearer picture, or type it in.' });
      return null;
    }
    const evRef = h.ref.collection('events').doc();
    await evRef.set({ ...ev, needsCheck: true, scanId: ref.id, readProblem: r.problem || '', createdBy: scan.by || null, createdAt: now });
    await ref.update({ state: 'done', eventId: evRef.id, doneAt: now });
    return evRef.id;
  } catch (e) {
    console.error('Reading an invite failed', e);
    await ref.update({ state: 'failed', message: plainError(e) });
    return null;
  }
}

// "Ask Claude for ideas": new ideas join the household's ideas, so they're there next time.
export async function processAsk(h, ref, now = new Date()) {
  if (!(await claim(ref))) return null;
  const a = (await ref.get()).data();
  try {
    const ideasSnap = await h.ref.collection('ideas').get();
    const saved = ideasSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const byId = new Map(saved.map(i => [i.id, i]));
    const byName = new Map(saved.map(i => [String(i.name).toLowerCase().trim(), i]));
    let given = [];
    if (a.friend) {
      const events = (await h.ref.collection('events').get()).docs.map(d => ({ id: d.id, ...d.data() }));
      given = pastPresents(events, a.friend, a.eventId).map(p => p.name);
    }
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
    console.error('Asking for ideas failed', e);
    await ref.update({ state: 'failed', message: plainError(e) });
    return null;
  }
}

// Every morning: reminders for parties coming up (functions/index.mjs runs it at 8am UK time).
export async function sendReminders(db, now = new Date()) {
  const today = iso(now);
  let sent = 0;
  for (const h of await households(db)) {
    const hd = h.data();
    const settings = { ...DEFAULT_REMINDERS, ...(hd.reminders || {}) };
    const until = addDays(today, Math.max(settings.first || 0, settings.second || 0, 2) + 31);
    const snap = await h.ref.collection('events').where('date', '>=', today).where('date', '<=', until).get();
    for (const d of snap.docs) {
      const e = { id: d.id, ...d.data() };
      // Reply-by dates can be weeks before the party, so they're checked on every upcoming event.
      const due = dueReminders(e, today, settings, hd.children || []);
      if (!due.length) continue;
      const update = {};
      for (const r of due) {
        await notify(h, { title: r.title, body: r.body, link: `#/event/${e.id}`, tag: `${e.id}-${r.kind}` });
        update[`reminded.${r.kind}`] = now;
        sent++;
      }
      await d.ref.update(update);
    }
  }
  return sent;
}

// ---------- the calendar feed (calendar.ics) ----------
const icsText = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const fold = line => { const out = []; let s = line; while (s.length > 73) { out.push(s.slice(0, 73)); s = ` ${s.slice(73)}`; } out.push(s); return out.join('\r\n'); };
const stamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
export function buildCalendar(hd, events, now = new Date()) {
  const kids = hd.children || [];
  const kidName = c => (c === 'both' ? kids.map(k => k.name).join(' & ') : kids.find(k => k.id === c)?.name || '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Party Presents//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsText(`${hd.name || 'Family'} parties`)}`, 'X-WR-TIMEZONE:Europe/London', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H'];
  for (const e of events) {
    if (!isDay(e.date) || daysBetween(e.date, iso(now)) > 400) continue;
    const who = kidName(e.child);
    const title = `${who ? `${who}: ` : ''}${e.friend || 'Party'}'s ${e.kind === 'birthday' ? 'birthday' : 'party'}${e.cancelled ? ' (cancelled)' : e.rsvp === 'no' ? ' (not going)' : ''}`;
    const p = e.present || {};
    const present = p.name ? `Present: ${p.name} (${p.state === 'chosen' ? `${p.by?.name || 'someone'} is getting it` : p.state})` : 'Present: not sorted yet';
    const day = e.date.replace(/-/g, '');
    const timed = e.start && e.kind !== 'birthday';
    lines.push('BEGIN:VEVENT', `UID:${e.id}@party-presents`, `DTSTAMP:${stamp(now)}`);
    if (timed) {
      const end = e.end && e.end > e.start ? e.end : `${String(Math.min(23, Number(e.start.slice(0, 2)) + 2)).padStart(2, '0')}${e.start.slice(2)}`;
      lines.push(`DTSTART;TZID=Europe/London:${day}T${e.start.replace(':', '')}00`, `DTEND;TZID=Europe/London:${day}T${end.replace(':', '')}00`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${addDays(e.date, 1).replace(/-/g, '')}`);
    }
    lines.push(fold(`SUMMARY:${icsText(title)}`));
    const loc = [e.venue, e.address].filter(Boolean).join(', ');
    if (loc) lines.push(fold(`LOCATION:${icsText(loc)}`));
    lines.push(fold(`DESCRIPTION:${icsText([present, e.rsvpBy ? `Reply by ${e.rsvpBy}${e.contact ? ` to ${e.contact}` : ''}` : '', e.notes].filter(Boolean).join('\n'))}`));
    if (e.cancelled) lines.push('STATUS:CANCELLED');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
