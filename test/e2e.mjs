// End to end, against the Firebase emulators: two people (Andrew and Sarah) in
// a real browser, a pretend Claude (CLAUDE_FAKE=1), and the functions' work run
// here directly. Start first:
//   firebase emulators:start --only auth,firestore      (Firestore 8081, Auth 9099)
//   python3 -m http.server 8000
//   node tools/copy-shared.mjs && npm --prefix functions install
// Then: node test/e2e.mjs   (screenshots in test/shots/)
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

process.env.FIRESTORE_EMULATOR_HOST ||= 'localhost:8081';
process.env.GCLOUD_PROJECT ||= 'kids-presents';
process.env.CLAUDE_FAKE = '1';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { chromium } = createRequire(import.meta.url)('playwright');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { processScan, processAsk, sendReminders, buildCalendar } = await import('../functions/tasks.mjs');
const { iso, addDays } = await import('../js/gifts.js');

initializeApp({ projectId: process.env.GCLOUD_PROJECT });
// Start from an empty database and no accounts.
await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
await fetch(`http://localhost:9099/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/accounts`, { method: 'DELETE' });
const db = getFirestore();
const SITE = process.env.SITE || 'http://localhost:8000/';
const shots = new URL('shots/', import.meta.url); mkdirSync(shots, { recursive: true });
const today = iso(new Date());

const browser = await chromium.launch();
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const a = await (await browser.newContext(phone)).newPage();
const b = await (await browser.newContext(phone)).newPage();
for (const [p, who] of [[a, 'A'], [b, 'B']]) {
  p.on('pageerror', e => { console.error(`${who} page error:`, e.message); process.exitCode = 1; });
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_|offline/.test(m.text())) console.error(`${who} console:`, m.text()); });
  p.on('dialog', d => d.accept());
}
const shot = (p, name) => p.screenshot({ path: new URL(`${name}.png`, shots).pathname, fullPage: true });
const step = s => console.log(`- ${s}`);
const run = async (doc, fn) => { const snap = await doc.get(); return fn(snap); };

// 1. Andrew signs in and sets up the family. Starter ideas load.
step('Andrew signs in and creates the family');
await a.goto(`${SITE}?emulator`);
await a.fill('input[name=name]', 'Andrew Wilson');
await a.fill('input[name=email]', `andrew${Date.now()}@example.com`);
await a.click('text=Test sign in');
await a.waitForSelector('text=Set up your family');
await shot(a, '01-setup');
await a.click('button:has-text("Create")');
await a.waitForSelector('text=No parties yet');
await a.waitForTimeout(500);
await shot(a, '02-home-empty');
const hid = (await db.collection('households').get()).docs.map(d => d.id).pop();
const H = db.collection('households').doc(hid);
assert.ok((await H.collection('ideas').count().get()).data().count >= 100, 'starter ideas loaded');

// 2. Sarah joins with the invite link.
step('Sarah joins with the invite link');
const invite = (await H.get()).data().inviteCode;
await b.goto(`${SITE}?emulator&join=${invite}`);
await b.fill('input[name=name]', 'Sarah Wilson');
await b.fill('input[name=email]', `sarah${Date.now()}@example.com`);
await b.click('text=Test sign in');
await b.waitForSelector('text=Join a household');
await b.click('button:has-text("Join")');
await b.waitForSelector('text=No parties yet');

// 3. Andrew adds a party by hand for Sophie.
step('Andrew adds a party by hand');
await a.click('text=Add a party');
await a.selectOption('select[name=child]', 'sophie');
await a.fill('input[name=friend]', 'Olivia');
await a.fill('input[name=friendAge]', '5');
await a.selectOption('select[name=friendGender]', 'girl');
await a.fill('input[name=interests]', 'unicorns, crafts');
await a.fill('input[name=date]', addDays(today, 12));
await a.fill('input[name=start]', '14:00');
await a.fill('input[name=end]', '16:00');
await a.fill('input[name=venue]', 'Jump Zone');
await a.fill('input[name=rsvpBy]', addDays(today, 5));
await shot(a, '03-add-party');
await a.click('button:has-text("Add party")');
await a.waitForSelector('text=Olivia\'s 5th birthday party');
await a.waitForSelector('text=Nobody\'s getting one yet');
await shot(a, '04-party-needs-present');

// 4. Sarah sees it straight away and says she'll get the first idea.
step('Sarah sees it live and picks an idea');
await b.waitForSelector('text=Olivia\'s 5th birthday party');
await shot(b, '05-sarah-home');
await b.click('text=Olivia\'s 5th birthday party');
await b.click('.ideas button:has-text("I\'ll get this") >> nth=0');
await b.waitForSelector('text=You said you\'d get this');

// 5. Andrew sees Sarah is getting it, and can't also claim it.
step('Andrew sees Sarah is getting it');
await a.waitForSelector('text=Sarah is getting this');
await shot(a, '06-andrew-sees-sarah');
const ev = (await H.collection('events').get()).docs[0];
const clash = await a.evaluate(async id => {
  const S = await import('/js/store.js?v=2');
  try { await S.claimPresent(id, { state: 'chosen', name: 'Something else' }); return 'claimed'; } catch (e) { return e.code; }
}, ev.id);
assert.equal(clash, 'claimed', 'a second claim is refused');

// 6. Sarah buys it; Andrew sees it's bought.
step('Sarah marks it bought');
await b.fill('input[name=where]', 'Argos');
await b.click('button:has-text("Bought it")');
await b.waitForSelector('text=Bought by you');
await a.waitForSelector('text=Bought by Sarah');
await a.click('text=Wrapped');
await a.waitForTimeout(300);
await shot(a, '07-bought');
assert.equal((await ev.ref.get()).data().present.state, 'wrapped');

// 7. Andrew picks an invite picture; the (pretend) Claude reads it; the party opens.
step('Andrew reads an invite picture');
await a.goto(`${SITE}?emulator#/home`);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVQI12P8z8DAwMDAxMDAwMDAAAANHQEDK+mmyAAAAABJRU5ErkJggg==', 'base64');
await a.setInputFiles('input[data-change=pickInvite] >> nth=0', { name: 'invite.png', mimeType: 'image/png', buffer: png });
await a.waitForSelector('text=Reading the invite');
await shot(a, '08-reading');
const scan = (await H.collection('scans').get()).docs[0];
assert.equal(scan.data().state, 'requested');
const newId = await processScan(await H.get(), scan.ref);
assert.ok(newId, 'scan made a party');
await a.waitForSelector('text=Read from an invite picture');
await shot(a, '09-from-invite');
await a.click('button:has-text("Looks right")');

// 8. Ask Claude for ideas from that party.
step('Ask Claude for ideas');
await a.click('button:has-text("Ask Claude for ideas")');
await a.waitForSelector('text=Claude is thinking');
const ask = (await H.collection('asks').get()).docs[0];
await processAsk(await H.get(), ask.ref);
await a.waitForSelector('text=Fake new idea from Claude');
await shot(a, '10-claude-ideas');

// 9. Cupboard: add a present and use it for the invite's party.
step('Cupboard');
await b.goto(`${SITE}?emulator#/cupboard`);
await b.fill('input[name=name]', 'Unicorn craft box');
await b.fill('input[name=price]', '8');
await b.click('button:has-text("Add to cupboard")');
await b.waitForSelector('select[data-change=useFor]');
await b.selectOption('select[data-change=useFor]', newId);
await b.waitForSelector('text=Given already');
await shot(b, '11-cupboard');
assert.equal((await H.collection('events').doc(newId).get()).data().present.cupboardId != null, true);

// 9b. A joint party: two birthday children, a present each.
step('Joint party for two birthday children');
await a.goto(`${SITE}?emulator#/edit`);
await a.selectOption('select[name=child]', 'both');
await a.fill('input[name=friend]', 'Mia');
await a.fill('input[name=friendAge]', '6');
await a.click('button:has-text("Add another birthday child")');
await a.fill('input[name="x0.friend"]', 'Zac');
await a.fill('input[name="x0.friendAge"]', '6');
await a.selectOption('select[name="x0.friendGender"]', 'boy');
await a.fill('input[name=date]', addDays(today, 20));
await a.fill('input[name=venue]', 'Village hall');
await shot(a, '11b-joint-form');
await a.click('button:has-text("Add party")');
await a.waitForSelector('h1:has-text("Mia & Zac\'s birthday party")');
await a.waitForSelector('text=Mia\'s present');
await a.click('.ideas button:has-text("I\'ll get this") >> nth=0');
await a.waitForSelector('text=You said you\'d get this');
await a.click('.seg.joint a:has-text("Zac")');
await a.waitForSelector('text=Zac\'s present');
await a.waitForSelector('text=Nobody\'s getting one yet');
await shot(a, '11c-joint-party');
await a.click('button:has-text("Going")');
await a.waitForTimeout(400);
const joint = (await H.collection('events').where('venue', '==', 'Village hall').get()).docs.map(d => d.data());
assert.equal(joint.length, 2);
assert.equal(new Set(joint.map(e => e.groupId)).size, 1);
assert.deepEqual(joint.map(e => e.rsvp), ['yes', 'yes'], 'the reply is for the whole party');
assert.deepEqual(joint.map(e => e.present?.state || '').sort(), ['', 'chosen'], 'each child has their own present');
await b.goto(`${SITE}?emulator#/home`);
await b.waitForSelector('text=Mia & Zac\'s birthday party');
assert.equal(await b.locator('.event-row:has-text("Mia & Zac")').count(), 1, 'one row for the joint party');
await shot(b, '11d-joint-home');
// Take Zac off: it becomes an ordinary party again.
await a.click('.seg.joint a:has-text("Mia")');
await a.waitForSelector('text=Mia\'s present');
await a.click('a:has-text("Change")');
await a.waitForSelector('input[name="x0.friend"]');
assert.equal(await a.inputValue('input[name="x0.friend"]'), 'Zac');
await a.fill('input[name="x0.friend"]', '');
await a.click('button:has-text("Save")');
await a.waitForSelector('h1:has-text("Mia\'s 6th birthday party")');
assert.equal((await H.collection('events').where('venue', '==', 'Village hall').get()).size, 1);

// 10. Calendar and home.
step('Calendar, home, settings');
await a.goto(`${SITE}?emulator#/calendar`);
await a.waitForSelector('.cal-grid');
await shot(a, '12-calendar');
await a.goto(`${SITE}?emulator#/home`);
await a.waitForSelector('text=Coming up');
await shot(a, '13-home');
await a.goto(`${SITE}?emulator#/settings`);
await a.waitForSelector('text=Phone calendar');
await shot(a, '14-settings');
await a.goto(`${SITE}?emulator#/ideas`);
await a.waitForSelector('text=From your ideas');
await shot(a, '15-ideas');

// 11. Reminders and the calendar feed, from the functions' side.
step('Reminders and calendar feed');
const sent = await sendReminders(db, new Date(`${addDays(today, 4)}T08:00:00Z`));
console.log(`  reminders that would be sent 4 days on: ${sent}`);
const events = (await H.collection('events').get()).docs.map(d => ({ id: d.id, ...d.data() }));
const ics = buildCalendar((await H.get()).data(), events);
writeFileSync(new URL('calendar.ics', shots), ics);
assert.match(ics, /Olivia/);

await browser.close();
console.log(process.exitCode ? 'Finished with errors' : 'All good');
