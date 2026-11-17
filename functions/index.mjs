// Firebase functions for Party Presents. They run in London (europe-west2),
// next to the database.
//   readInvite      an invite (picture or message) is saved -> Claude reads it -> the party is added
//   suggestIdeas    "Ask Claude": ideas saved to the household's ideas, or real products found in the shops for a party
//   dailyReminders  8am every day: phone notifications for presents still needed
//   calendar        the calendar feed (served at /calendar.ics by Firebase Hosting)
//   newHousehold    the first household made: lock sign-up (access.mjs)
//   calendarConnect, calendarDisconnect, calendarSync
//                   parties as Google Calendar invites to both of you (gcal.mjs)
//
// First deploy (from Google Cloud Shell):
//   firebase functions:secrets:set ANTHROPIC_API_KEY
//   firebase functions:secrets:set GOOGLE_CLIENT_SECRET
//   firebase deploy --only functions
// After that the Deploy functions workflow redeploys them when they change.
// The shared rules (js/gifts.js) are copied into ./shared by tools/copy-shared.mjs first.

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten, onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { isAllowed, allowedHouseholds } from './access.mjs';
import { processScan, processAsk, sendReminders, buildCalendar } from './tasks.mjs';
import { connect, disconnect, syncParty } from './gcal.mjs';

initializeApp();
const db = getFirestore();
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const GOOGLE_CLIENT_SECRET = defineSecret('GOOGLE_CLIENT_SECRET');
const region = 'europe-west2';
const opts = { region, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 180, memory: '512MiB', maxInstances: 2 };

// A request to work on: newly 'requested', or asked again (Try again).
const isNewRequest = event => {
  const before = event.data?.before?.data(), after = event.data?.after?.data();
  return after?.state === 'requested' && (before?.state !== 'requested' || before?.retry !== after?.retry);
};
// Every trigger first checks the household is one this app is for, so a
// stranger who signed in can't spend the API key.
const guarded = fn => async event => {
  if (!isNewRequest(event)) return;
  if (!(await isAllowed(db, event.params.hid))) {
    await event.data.after.ref.update({ state: 'failed', message: 'This family isn\'t set up for Claude.' });
    return;
  }
  process.env.ANTHROPIC_API_KEY = ANTHROPIC_API_KEY.value();
  const h = await db.collection('households').doc(event.params.hid).get();
  return fn(h, event.data.after.ref);
};

export const readInvite = onDocumentWritten({ ...opts, document: 'households/{hid}/scans/{sid}' }, guarded((h, ref) => processScan(h, ref)));
// Searching the shops for real products takes a minute or two, so this one gets longer.
export const suggestIdeas = onDocumentWritten({ ...opts, timeoutSeconds: 300, document: 'households/{hid}/asks/{aid}' }, guarded((h, ref) => processAsk(h, ref)));

export const dailyReminders = onSchedule({ region, schedule: '0 8 * * *', timeZone: 'Europe/London', maxInstances: 1 }, async () => {
  console.log(`Sent ${await sendReminders(db)} reminders`);
});

// The first household made writes the access list, which closes sign-up (firestore.rules).
export const newHousehold = onDocumentCreated({ region, document: 'households/{hid}', maxInstances: 1 }, async () => {
  await allowedHouseholds(db);
});

// GET /calendar.ics?h=<household id>&k=<its feedKey>: the parties as a calendar feed.
export const calendar = onRequest({ region, maxInstances: 2, cors: false }, async (req, res) => {
  const hid = String(req.query.h || ''), key = String(req.query.k || '');
  const h = hid && /^[A-Za-z0-9]{10,40}$/.test(hid) ? await db.collection('households').doc(hid).get() : null;
  if (!h?.exists || !key || h.data().feedKey !== key || !(await isAllowed(db, hid))) { res.status(404).send('Not found'); return; }
  const events = (await h.ref.collection('events').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  res.set('Content-Type', 'text/calendar; charset=utf-8').set('Cache-Control', 'private, max-age=900').send(buildCalendar(h.data(), events));
});

// ---------- Google Calendar (gcal.mjs) ----------
const gopts = { region, secrets: [GOOGLE_CLIENT_SECRET], maxInstances: 2, timeoutSeconds: 120 };
// The caller's household, if this app serves it.
async function callerHousehold(req) {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const hid = (await db.collection('presentUsers').doc(uid).get()).data()?.householdId;
  const h = hid ? await db.collection('households').doc(hid).get() : null;
  if (!h?.exists || !(h.data().members || []).includes(uid) || !(await isAllowed(db, hid))) throw new HttpsError('permission-denied', 'This family isn\'t set up for that.');
  process.env.GOOGLE_CLIENT_SECRET = GOOGLE_CLIENT_SECRET.value();
  return { uid, hid, h };
}
const plain = fn => async req => {
  try { return await fn(req); } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.error(e);
    throw new HttpsError('failed-precondition', String(e?.message || e).slice(0, 200));
  }
};
export const calendarConnect = onCall(gopts, plain(async req => {
  const { uid, hid, h } = await callerHousehold(req);
  const code = String(req.data?.code || '');
  if (!code) throw new HttpsError('invalid-argument', 'No code from Google.');
  return connect(db, hid, uid, code, h.data().memberNames?.[uid] || '');
}));
export const calendarDisconnect = onCall(gopts, plain(async req => {
  const { hid } = await callerHousehold(req);
  await disconnect(db, hid);
  return { ok: true };
}));
// A party added, changed or deleted: its Google Calendar event follows.
export const calendarSync = onDocumentWritten({ ...gopts, document: 'households/{hid}/events/{eid}' }, async event => {
  const { hid, eid } = event.params;
  if (!(await db.collection('calendarLinks').doc(hid).get()).exists) return;
  process.env.GOOGLE_CLIENT_SECRET = GOOGLE_CLIENT_SECRET.value();
  const keys = new Set([event.data?.before?.data()?.groupId || eid, event.data?.after?.data()?.groupId || eid]);
  for (const key of keys) {
    try { console.log(key, await syncParty(db, hid, key)); } catch (e) { console.error(`Calendar sync for ${key} failed:`, e.message); }
  }
});
