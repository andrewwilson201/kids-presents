// Parties as real Google Calendar events, so they're in both of your calendars.
//
// One of you connects their Google Calendar once (Settings › Calendar). From then
// on every upcoming party is an event in that calendar, with the rest of the
// family invited, so Google puts it in their calendars too. When a party
// changes, the event changes; when it's cancelled or you're not going, it's
// removed (Google tells the others). Friends' birthdays without a party, and
// parties in the past, are left alone.
//
// The connection (a Google refresh token) is kept in calendarLinks/{hid},
// which the app can't read (no rule matches it in firestore.rules). What the
// app shows is households/{hid}.calendar { email, name, uid, at, problem }.
// Each party's event has an id made from the household and the party, so
// writing it twice changes the same event rather than adding another.
import { createHash } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { groupEvents, isDay, iso, addDays } from './shared/gifts.js';
import { partyEntry } from './tasks.mjs';

// The OAuth client Firebase made for Google sign-in (Google Cloud › Google Auth Platform › Clients).
// Public, like js/config.js; its secret is the GOOGLE_CLIENT_SECRET functions secret.
export const GOOGLE_CLIENT_ID = '61389624990-rfllrs0d82hm6v1ok1fvnrcst7gh0vgc.apps.googleusercontent.com';
export const SCOPE = 'openid email https://www.googleapis.com/auth/calendar.events';
const SITE = process.env.SITE_URL || 'https://kids-presents.web.app/';
const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

// The tests swap in a pretend Google.
let http = (...a) => fetch(...a);
export const useFetch = f => { http = f; };

class CalendarError extends Error {}

const form = o => new URLSearchParams(o).toString();
async function tokenRequest(params) {
  const r = await http('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ client_id: GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET || '', ...params }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new CalendarError(j.error === 'invalid_grant' ? 'invalid_grant' : `Google said: ${j.error_description || j.error || r.status}`);
  return j;
}
const emailFromIdToken = t => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).email || ''; } catch { return ''; } };

// The event id Google stores: lowercase a-v and digits only.
export const eventId = (hid, key) => `pp${createHash('sha1').update(`${hid}:${key}`).digest('hex')}`;

// What Google gets for a party, or null when it shouldn't be in the calendar.
export function googleEvent(hd, group, attendees, today) {
  const e = group[0];
  if (!e || !isDay(e.date) || e.date < today || (e.kind || 'party') === 'birthday' || e.cancelled || e.rsvp === 'no') return null;
  const p = partyEntry(hd, group);
  const link = `${SITE}#/event/${e.id}`;
  return {
    summary: p.title,
    location: p.location,
    description: `${p.details ? `${p.details}\n\n` : ''}Party Presents: ${link}`,
    start: p.timed ? { dateTime: `${p.date}T${p.start}:00`, timeZone: 'Europe/London' } : { date: p.date },
    end: p.timed ? { dateTime: `${p.date}T${p.end}:00`, timeZone: 'Europe/London' } : { date: addDays(p.date, 1) },
    attendees: attendees.map(email => ({ email })),
    source: { title: 'Party Presents', url: link },
    status: 'confirmed',
  };
}

async function accessToken(db, hid, link) {
  try {
    return (await tokenRequest({ grant_type: 'refresh_token', refresh_token: link.refreshToken })).access_token;
  } catch (err) {
    if (err.message === 'invalid_grant') {
      // Access was taken away (or it expired): the app asks for it again.
      await db.collection('households').doc(hid).update({ 'calendar.problem': 'Google Calendar needs connecting again.' }).catch(() => {});
    }
    throw err;
  }
}

async function google(token, method, url, body) {
  const r = await http(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 204 || r.status === 404 || r.status === 410 || r.status === 409) return { status: r.status };
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new CalendarError(`Google Calendar said: ${j.error?.message || r.status}`);
  return { status: r.status, body: j };
}

// Everyone else in the family, by their Google sign-in email.
async function othersOf(hd, link) {
  const out = [];
  for (const uid of hd.members || []) {
    if (uid === link.uid) continue;
    const email = await getAuth().getUser(uid).then(u => u.email || '', () => '');
    if (email && email.toLowerCase() !== String(link.email).toLowerCase()) out.push(email);
  }
  return out;
}

const hash = o => createHash('sha1').update(JSON.stringify(o)).digest('hex');
const material = g => hash([g.summary, g.location, g.start, g.end, g.attendees]);

// Bring one party's event in line with the party. key: its groupId, or the event id.
export async function syncParty(db, hid, key, { now = new Date(), ctx = null } = {}) {
  const H = db.collection('households').doc(hid);
  const linkRef = db.collection('calendarLinks').doc(hid);
  const c = ctx || {};
  if (!c.link) {
    const [l, h] = await Promise.all([linkRef.get(), H.get()]);
    if (!l.exists || !h.exists) return 'not connected';
    c.link = l.data(); c.hd = h.data();
  }
  const [byGroup, single] = await Promise.all([H.collection('events').where('groupId', '==', key).get(), H.collection('events').doc(key).get()]);
  const events = byGroup.docs.map(d => ({ id: d.id, ...d.data() }));
  if (single.exists && (single.data().groupId || single.id) === key && !events.some(x => x.id === single.id)) events.push({ id: single.id, ...single.data() });
  events.sort((a, b) => (a.groupOrder ?? 0) - (b.groupOrder ?? 0));
  const group = events.length ? groupEvents(events)[0] : [];

  const entryRef = linkRef.collection('entries').doc(key);
  const entry = (await entryRef.get()).data() || {};
  const today = iso(now);
  c.others ||= await othersOf(c.hd, c.link);
  const want = googleEvent(c.hd, group, c.others, today);
  const id = eventId(hid, key);

  if (!want) {
    // Only take it out of the calendar if it's still to come (or gone from the app).
    const gone = !group.length || group[0].cancelled || group[0].rsvp === 'no' || (group[0].kind || 'party') === 'birthday' || !isDay(group[0].date) || group[0].date >= today;
    if (!entry.live || !gone) return 'nothing to do';
    c.token ||= await accessToken(db, hid, c.link);
    await google(c.token, 'DELETE', `${API}/${id}?sendUpdates=all`);
    await entryRef.set({ live: false, at: now });
    return 'removed';
  }
  const h = hash(want);
  if (entry.live && entry.hash === h) return 'up to date';
  // Email the others only when something they'd notice changes (not the present's progress).
  const send = !entry.live || entry.material !== material(want) ? 'all' : 'none';
  c.token ||= await accessToken(db, hid, c.link);
  let r = await google(c.token, 'PATCH', `${API}/${id}?sendUpdates=${send}`, want);
  if (r.status === 404 || r.status === 410) {
    r = await google(c.token, 'POST', `${API}?sendUpdates=${send}`, { id, ...want });
    // Written at the same moment for the other birthday child of a joint party.
    if (r.status === 409) r = await google(c.token, 'PATCH', `${API}/${id}?sendUpdates=none`, want);
  }
  await entryRef.set({ live: true, hash: h, material: material(want), at: now });
  return send === 'all' ? 'sent' : 'updated';
}

// Every party still to come (after connecting).
export async function syncAll(db, hid, now = new Date()) {
  const H = db.collection('households').doc(hid);
  const snap = await H.collection('events').where('date', '>=', iso(now)).get();
  const ctx = {};
  const keys = [...new Set(snap.docs.map(d => d.data().groupId || d.id))];
  let n = 0;
  for (const key of keys) if (['sent', 'updated'].includes(await syncParty(db, hid, key, { now, ctx }))) n++;
  return n;
}

// "Connect Google Calendar": the code from Google's sign-in popup becomes a lasting connection.
export async function connect(db, hid, uid, code, name = '') {
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: 'postmessage' });
  if (!t.refresh_token) throw new CalendarError('Google didn\'t give lasting access. Try again.');
  if (!String(t.scope || '').includes('calendar.events')) throw new CalendarError('Tick the box to let Party Presents add events to your calendar, then try again.');
  const email = emailFromIdToken(t.id_token || '');
  await db.collection('calendarLinks').doc(hid).set({ refreshToken: t.refresh_token, uid, email, at: new Date() });
  await db.collection('households').doc(hid).update({ calendar: { email, name, uid, at: new Date() } });
  return { email, count: await syncAll(db, hid) };
}

// Stop: forget the connection. Events already in the calendars stay.
export async function disconnect(db, hid) {
  const ref = db.collection('calendarLinks').doc(hid);
  const link = (await ref.get()).data();
  if (link?.refreshToken) await http(`https://oauth2.googleapis.com/revoke?${form({ token: link.refreshToken })}`, { method: 'POST' }).catch(() => {});
  await db.recursiveDelete(ref);
  const { FieldValue } = await import('firebase-admin/firestore');
  await db.collection('households').doc(hid).update({ calendar: FieldValue.delete() });
}
