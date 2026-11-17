// Data layer: Firebase Auth (Google) and Firestore, with live updates so both
// of you see every change straight away.
//
// Firestore layout (see firestore.rules):
//   presentUsers/{uid}                 { householdId, name }
//   invites/{code}                     { hid, name }
//   households/{hid}                   { name, members[], memberNames{uid:name}, inviteCode, children[{id,name,gender,birthday?,age?,ageOn?}],
//                                        budget, reminders{first,second,dayOf}, feedKey, friendSnooze{key:year}, createdAt,
//                                        calendar{email, name, uid, at, problem} Google Calendar invites, written by functions/gcal.mjs }
//   households/{hid}/events/{id}       a party or a birthday: { kind, child, friend, friendAge, friendGender, interests, date, start, end,
//                                        venue, address, rsvpBy, rsvp, contact, theme, notes, budget, card, cancelled, needsCheck, scanId,
//                                        present{state: chosen|bought|wrapped, name, ideaId, price, where, url, shop, image, cupboardId, by{uid,name}, at}, reminded{},
//                                        products{at, items[{title, price, shop, url, why}]} real products Claude found in the shops }
//                                      a joint party is one event per birthday child, sharing groupId (+ groupOrder): js/gifts.js
//   households/{hid}/ideas/{id}        present ideas: { name, description, price, ageMin, ageMax, for, interests[], category, search, source: starter|claude|us|bought, url, shop, image, given, liked, hidden }
//   households/{hid}/cupboard/{id}     presents bought ahead: { name, price, ageMin, ageMax, for, notes, by, usedFor, createdAt }
//   households/{hid}/scans/{id}        an invite for Claude to read: { text?, state: requested|done|failed, by, eventId, duplicate, message }
//   households/{hid}/scanImages/{id}   the invite's picture, same id as its scan: { image (data URL) }
//   households/{hid}/asks/{id}         "Ask Claude": { kind: ideas|products|link, budget, gender, age, interests, hint, url, eventId, state, ideas[] | products[] | product{}, by }
//   households/{hid}/wishes/{id}       our own children's wish lists: { child, occasion: christmas|birthday, name, price, url, shop, image, notes, rank, ordered{uid,name,at}, by } (js/views/wishes.js)
//   households/{hid}/devices/{id}      phones that get notifications: { token, uid, name, ua, createdAt }

import {
  initializeApp, getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signOut as fbSignOut, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, collection, query, orderBy, limit, onSnapshot, serverTimestamp, runTransaction,
  arrayUnion, deleteField, writeBatch, connectFirestoreEmulator, getMessaging, getToken, deleteToken, messagingSupported,
} from '../vendor/firebase.js';
import { FIREBASE_CONFIG, VAPID_KEY, GOOGLE_CLIENT_ID } from './config.js';

export const emulator = new URLSearchParams(location.search).has('emulator') || !FIREBASE_CONFIG.apiKey;
const app = initializeApp(FIREBASE_CONFIG.apiKey ? FIREBASE_CONFIG : { apiKey: 'demo', projectId: 'demo-presents', authDomain: 'localhost', appId: 'demo' });
export const auth = getAuth(app);
export const db = initializeFirestore(app, emulator ? {} : { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
if (emulator) {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, 'localhost', 8081);
}

export { serverTimestamp, deleteField };

const blank = () => ({ household: null, events: [], ideas: [], cupboard: [], scans: [], asks: [], wishes: [] });
const state = { user: null, profile: null, ready: false, ...blank() };
const listeners = new Set();
let unsubs = [];
const emit = () => listeners.forEach(fn => fn(state));
export const onChange = fn => { listeners.add(fn); fn(state); return () => listeners.delete(fn); };
export const getState = () => state;

const hpath = (...p) => ['households', state.household.id, ...p].join('/');
const randomCode = (n = 12) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');

export async function signIn() {
  const provider = new GoogleAuthProvider();
  try { await signInWithPopup(auth, provider); }
  catch (e) { if (/popup/.test(e.code || '')) await signInWithRedirect(auth, provider); else throw e; }
}
export const signOut = () => fbSignOut(auth);

// Emulator only: Google sign-in needs Google's servers, so tests sign in with a made-up email.
export async function testSignIn(name, email) {
  if (!emulator) throw new Error('Only for the emulator');
  const cred = await createUserWithEmailAndPassword(auth, email, 'password').catch(() => signInWithEmailAndPassword(auth, email, 'password'));
  if (!cred.user.displayName) { await updateProfile(cred.user, { displayName: name }); await cred.user.reload(); }
}

getRedirectResult(auth).catch(() => {});
onAuthStateChanged(auth, async (u) => {
  unsubs.forEach(f => f()); unsubs = [];
  Object.assign(state, { user: u, profile: null, ready: !u, ...blank() });
  emit();
  if (!u) return;
  unsubs.push(onSnapshot(doc(db, 'presentUsers', u.uid), snap => {
    state.profile = snap.exists() ? snap.data() : {};
    const hid = state.profile.householdId;
    if (hid && hid !== state.household?.id) watchHousehold(hid);
    if (!hid) { state.ready = true; emit(); }
  }, err => { state.error = err.message; state.ready = true; emit(); }));
});

function watchHousehold(hid) {
  unsubs.slice(1).forEach(f => f()); unsubs = unsubs.slice(0, 1);
  state.household = { id: hid };
  const h = (...p) => ['households', hid, ...p].join('/');
  const coll = (name, key, ...q) => onSnapshot(query(collection(db, h(name)), ...q), snap => {
    state[key] = snap.docs.map(d => ({ id: d.id, ...d.data() })); emit();
  }, err => { state.error = err.message; emit(); });
  unsubs.push(onSnapshot(doc(db, h()), snap => {
    if (!snap.exists()) { state.household = null; state.ready = true; emit(); return; }
    state.household = { id: hid, ...snap.data() }; state.ready = true; emit();
  }, err => { state.error = err.message; state.ready = true; emit(); }));
  unsubs.push(coll('events', 'events', orderBy('date', 'asc')));
  unsubs.push(coll('ideas', 'ideas'));
  unsubs.push(coll('cupboard', 'cupboard'));
  unsubs.push(coll('wishes', 'wishes'));
  unsubs.push(coll('scans', 'scans', orderBy('createdAt', 'desc'), limit(5)));
  unsubs.push(coll('asks', 'asks', orderBy('createdAt', 'desc'), limit(12)));
}

export const myName = () => state.user?.displayName?.split(' ')[0] || state.user?.email || 'Someone';
export const me = () => ({ uid: state.user.uid, name: myName() });

export const DEFAULT_CHILDREN = [
  { id: 'charlie', name: 'Charlie', gender: 'boy', age: 7 },
  { id: 'sophie', name: 'Sophie', gender: 'girl', age: 5 },
];

export async function createHousehold(name, starterIdeas = []) {
  const u = state.user;
  const inviteCode = randomCode();
  const ref = doc(collection(db, 'households'));
  const on = new Date().toISOString().slice(0, 10);
  await setDoc(ref, {
    name, members: [u.uid], memberNames: { [u.uid]: myName() }, inviteCode, feedKey: randomCode(20),
    children: DEFAULT_CHILDREN.map(c => ({ ...c, ageOn: on })), budget: 15, createdAt: serverTimestamp(),
  });
  await setDoc(doc(db, 'invites', inviteCode), { hid: ref.id, name });
  await setDoc(doc(db, 'presentUsers', u.uid), { householdId: ref.id, name: myName() }, { merge: true });
  if (starterIdeas.length) await batchAt(ref.id, starterIdeas.map(i => ['set', ['ideas', i.id], { ...i, source: 'starter' }]));
}

export async function lookupInvite(code) {
  const snap = await getDoc(doc(db, 'invites', code));
  return snap.exists() ? snap.data() : null;
}

export async function joinHousehold(code) {
  const inv = await lookupInvite(code);
  if (!inv) throw new Error('That invite link has expired. Ask for a new one.');
  const u = state.user;
  await updateDoc(doc(db, 'households', inv.hid), { members: arrayUnion(u.uid), [`memberNames.${u.uid}`]: myName(), joinCode: code });
  await setDoc(doc(db, 'presentUsers', u.uid), { householdId: inv.hid, name: myName() }, { merge: true });
}

export async function newInviteCode() {
  const old = state.household.inviteCode;
  const code = randomCode();
  await updateDoc(doc(db, hpath()), { inviteCode: code });
  await setDoc(doc(db, 'invites', code), { hid: state.household.id, name: state.household.name });
  if (old) await deleteDoc(doc(db, 'invites', old)).catch(() => {});
  return code;
}

// ---------- Google Calendar invites (functions/gcal.mjs) ----------
export const calendarReady = Boolean(GOOGLE_CLIENT_ID) && !emulator;
const CAL_SCOPE = 'openid email https://www.googleapis.com/auth/calendar.events';
let gis = null;
// Google's sign-in script, loaded ahead so the popup opens straight from the tap.
export function loadGoogle() {
  gis ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = resolve; s.onerror = () => { gis = null; reject(new Error('Couldn\'t reach Google. Check you\'re online.')); };
    document.head.appendChild(s);
  });
  return gis;
}
async function callFunction(name, data) {
  const token = await auth.currentUser.getIdToken();
  const r = await fetch(`https://europe-west2-${FIREBASE_CONFIG.projectId}.cloudfunctions.net/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ data }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.message || 'Something went wrong. Try again.');
  return j.result;
}
// Google's popup: pick your account and allow calendar access. Then the function keeps the connection.
export function connectCalendar() {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) { reject(new Error('Google is still loading. Try again in a moment.')); return; }
    const client = window.google.accounts.oauth2.initCodeClient({
      client_id: GOOGLE_CLIENT_ID, scope: CAL_SCOPE, ux_mode: 'popup', login_hint: auth.currentUser?.email || '',
      callback: r => (r.error ? reject(new Error(r.error === 'access_denied' ? 'Calendar access wasn\'t allowed.' : r.error_description || r.error)) : callFunction('calendarConnect', { code: r.code }).then(resolve, reject)),
      error_callback: e => reject(new Error(e?.type === 'popup_closed' ? 'The Google window was closed.' : 'Google\'s window couldn\'t open. Allow pop-ups and try again.')),
    });
    client.requestCode();
  });
}
export const disconnectCalendar = () => callFunction('calendarDisconnect', {});

// Generic writes under the household.
export const setH = (path, data, merge = true) => setDoc(doc(db, hpath(...path)), data, { merge });
export const updateH = (path, data) => updateDoc(doc(db, hpath(...path)), data);
export const addH = (path, data) => addDoc(collection(db, hpath(...path)), data);
export const deleteH = (path) => deleteDoc(doc(db, hpath(...path)));
export const newId = (name) => doc(collection(db, hpath(name))).id;
async function batchAt(hid, ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    for (const [kind, path, data] of ops.slice(i, i + 400)) {
      const ref = kind === 'add' ? doc(collection(db, ['households', hid, ...path.slice(0, 1)].join('/'))) : doc(db, ['households', hid, ...path].join('/'));
      if (kind === 'delete') b.delete(ref); else if (kind === 'update') b.update(ref, data); else b.set(ref, data, { merge: true });
    }
    await b.commit();
  }
}
export const batchH = ops => batchAt(state.household.id, ops);

// "I'll get it" / "Bought it": done in a transaction, so if you both tap at
// once only one wins, and the other is told who already has it.
export async function claimPresent(eventId, present) {
  const ref = doc(db, hpath('events', eventId));
  return runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    const cur = snap.data()?.present;
    const mine = me();
    if (cur?.state && cur.by?.uid && cur.by.uid !== mine.uid && present.state !== 'wrapped' && !(cur.state === 'chosen' && present.takeOver)) {
      const err = new Error(`${cur.by.name} has already ${cur.state === 'chosen' ? 'said they\'ll get' : 'bought'} ${cur.name || 'a present'}.`);
      err.code = 'claimed'; throw err;
    }
    const { takeOver, ...p } = present;
    tx.update(ref, { present: { ...(cur || {}), ...p, by: p.state === 'wrapped' && cur?.by ? cur.by : mine, at: new Date().toISOString() } });
  });
}

// An invite's picture is kept apart from its scan (scanImages/{scan id}), so
// the app doesn't download every recent picture each time it opens.
export async function getScanImage(id) {
  const pic = await getDoc(doc(db, hpath('scanImages', id)));
  if (pic.exists()) return pic.data().image || '';
  const old = await getDoc(doc(db, hpath('scans', id))); // scans from before the pictures moved
  return old.exists() ? old.data().image || '' : '';
}

// ---------- phone notifications ----------
// Web push through Firebase Cloud Messaging. Needs the service worker (sw.js),
// so it works on the real site, not localhost; on iPhone only once the app is
// on the home screen. The daily reminders function sends them.
const DEVICE_KEY = 'presentsDevice';
export function notificationsOn() {
  try { return typeof Notification !== 'undefined' && Notification.permission === 'granted' && !!localStorage.getItem(DEVICE_KEY); } catch { return false; }
}
export async function notificationsSupported() {
  return 'serviceWorker' in navigator && typeof Notification !== 'undefined' && await messagingSupported().catch(() => false);
}
export async function enableNotifications() {
  if (!(await notificationsSupported())) throw new Error(/iPhone|iPad/.test(navigator.userAgent) ? 'On iPhone, add Party Presents to your home screen first (Share › Add to Home Screen), then turn this on from there.' : 'This browser can\'t show notifications.');
  if (!VAPID_KEY) throw new Error('Notifications aren\'t set up yet (js/config.js needs the web push key).');
  if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications are blocked for this site. Allow them in the browser or phone settings, then try again.');
  const reg = await navigator.serviceWorker.register('sw.js');
  await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  const id = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))).slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
  await setH(['devices', id], { token, uid: state.user.uid, name: state.user.displayName || '', ua: navigator.userAgent.slice(0, 200), createdAt: serverTimestamp() });
  try { localStorage.setItem(DEVICE_KEY, id); } catch {}
}
export async function disableNotifications() {
  let id = null; try { id = localStorage.getItem(DEVICE_KEY); localStorage.removeItem(DEVICE_KEY); } catch {}
  if (id) await deleteH(['devices', id]).catch(() => {});
  await deleteToken(getMessaging(app)).catch(() => {});
}
