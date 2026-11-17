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
await b.waitForSelector('text=Join “The Wilsons”?');
await shot(b, '02b-join');
await b.click('button:has-text("Join")');
await b.waitForSelector('text=No parties yet');

// 2b. A link that's no longer good says so, rather than waiting for ever.
const c = await (await browser.newContext(phone)).newPage();
await c.goto(`${SITE}?emulator&join=nosuchcode12`);
await c.fill('input[name=name]', 'Someone Else');
await c.fill('input[name=email]', `else${Date.now()}@example.com`);
await c.click('text=Test sign in');
await c.waitForSelector('text=This invite link has expired');
await c.close();

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
await a.click('summary:has-text("More details")');
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
  const S = await import('/js/store.js?v=6');
  try { await S.claimPresent(id, { state: 'chosen', name: 'Something else' }); return 'claimed'; } catch (e) { return e.code; }
}, ev.id);
assert.equal(clash, 'claimed', 'a second claim is refused');

// 6. Sarah buys it; Andrew sees it's bought.
step('Sarah marks it bought');
await b.fill('input[name=where]', 'Argos');
await b.click('button:has-text("Bought it")');
await b.waitForSelector('text=Bought by you');
await a.waitForSelector('text=Bought by Sarah');
await a.waitForSelector('text=a reminder the day before');
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
await a.waitForSelector('text=Read from an invite');
assert.ok((await H.collection('scanImages').doc(scan.id).get()).data().image.startsWith('data:image/jpeg'), 'the picture is kept apart from the scan');
assert.equal(scan.data().image, undefined);
await shot(a, '09-from-invite');
await a.click('button:has-text("Looks right")');

// 8. Real products from the shops for that party, then more ideas from Claude.
step('Claude finds real products in the shops');
await a.click('button:has-text("Find real presents in the shops")');
await a.waitForSelector('text=Claude is looking in the shops');
const asks = async kind => (await H.collection('asks').get()).docs.filter(d => d.data().kind === kind);
await processAsk(await H.get(), (await asks('products'))[0].ref);
await a.waitForSelector('text=Fake craft set from the shops');
assert.equal(await a.locator('.products li').count(), 2, 'the product without an https link is dropped');
await shot(a, '10-products');
await a.click('.products button:has-text("I\'ll get this") >> nth=0');
await a.waitForSelector('a:has-text("Open at Argos")');
assert.equal((await H.collection('events').doc(newId).get()).data().present.url, 'https://www.argos.co.uk/product/1234567');
await shot(a, '10b-product-chosen');
await a.click('button:has-text("Change my mind")');
await a.waitForSelector('text=Nobody\'s getting one yet');
step('Ask Claude for ideas');
await a.click('a:has-text("More ideas")');
await a.click('button:has-text("Ask Claude for ideas")');
await a.waitForSelector('text=Claude is thinking');
await processAsk(await H.get(), (await asks('ideas'))[0].ref);
await a.waitForSelector('text=Fake new idea from Claude');
await shot(a, '10c-claude-ideas');

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
await b.waitForSelector('.event-row:has-text("Olivia\'s 7th") >> text=Needs wrapping');
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

// 9c. The same invite again, this time as a message: it isn't added twice.
step('The same invite as a message is spotted as a duplicate');
const before = (await H.collection('events').count().get()).data().count;
await b.goto(`${SITE}?emulator#/scan`);
await b.fill('textarea[name=text]', 'Hi all! Olivia is turning 7. Party at Jump Zone, 2 to 4pm. RSVP to Sarah.');
await shot(b, '11e-paste-message');
await b.click('button:has-text("Read the message")');
await b.waitForSelector('text=Reading the invite');
const textScan = (await H.collection('scans').get()).docs.find(d => d.data().text);
assert.equal(await processScan(await H.get(), textScan.ref), newId, 'points at the party that\'s already there');
assert.equal((await textScan.ref.get()).data().duplicate, true);
await b.waitForSelector('h1:has-text("Olivia\'s 7th birthday party")');
assert.equal((await H.collection('events').count().get()).data().count, before, 'no second party');

// 9c2. Your own idea, as the exact thing: paste its link, and it's kept in the ideas.
step('An exact present from a pasted shop link, saved to the ideas');
const ben = await H.collection('events').add({ kind: 'party', child: 'charlie', friend: 'Ben', friendAge: 7, friendGender: 'boy', interests: 'Lego, police', date: addDays(today, 30) });
await a.goto(`${SITE}?emulator#/event/${ben.id}`);
await a.fill('.own input[name=url]', 'Look at this! https://www.argos.co.uk/product/9876543?clickSR=1');
await a.waitForSelector('text=Reading the link');
const linkAsk = (await asks('link'))[0];
assert.equal(linkAsk.data().url, 'https://www.argos.co.uk/product/9876543?clickSR=1');
await processAsk(await H.get(), linkAsk.ref);
await a.waitForSelector('text=Found at Argos');
assert.equal(await a.inputValue('.own input[name=name]'), 'LEGO City Police Car 60312');
assert.equal(await a.inputValue('.own input[name=price]'), '8.99');
await shot(a, '11e2-link-read');
await a.click('button:has-text("Already bought it")');
await a.waitForSelector('text=Bought by you');
await a.waitForSelector('a:has-text("Open at Argos")');
await a.waitForTimeout(400);
const benNow = (await ben.get()).data();
const kept = (await H.collection('ideas').doc(benNow.present.ideaId).get()).data();
assert.deepEqual([kept.name, kept.price, kept.url, kept.source, kept.given, kept.for, kept.ageMin, kept.ageMax], ['LEGO City Police Car 60312', 8.99, 'https://www.argos.co.uk/product/9876543?clickSR=1', 'bought', 1, 'boy', 5, 9]);
await shot(a, '11e3-bought-exact');
await a.goto(`${SITE}?emulator#/ideas`);
await a.fill('input[name=interests]', 'police');
await a.press('input[name=interests]', 'Enter');
await a.waitForSelector('.idea:has-text("LEGO City Police Car 60312") >> text=Bought before');

// 9d. Friends, and a birthday coming round again.
step('Friends remembered, and a birthday coming round again');
await H.collection('events').add({ kind: 'party', child: 'charlie', friend: 'Tom', friendAge: 6, friendGender: 'boy', interests: 'football, Pokemon', date: addDays(today, -360), venue: 'Leisure centre', present: { state: 'bought', name: 'Pokemon cards', by: { uid: 'x', name: 'Andrew' } } });
await a.goto(`${SITE}?emulator#/home`);
await a.waitForSelector('text=Tom turns 7 around');
await shot(a, '11f-birthday-nudge');
await a.click('a:has-text("Add it")');
await a.waitForSelector('text=Add a party');
assert.deepEqual([await a.inputValue('input[name=friend]'), await a.inputValue('input[name=friendAge]'), await a.inputValue('input[name=interests]'), await a.inputValue('select[name=child]')], ['Tom', '7', 'football, Pokemon', 'charlie']);
await shot(a, '11g-add-from-last-year');
await a.goto(`${SITE}?emulator#/friends`);
await a.waitForSelector('.friend:has-text("Tom")');
await a.click('.friend:has-text("Tom") summary');
await a.waitForSelector('text=Gave Pokemon cards');
await shot(a, '11h-friends');
await a.goto(`${SITE}?emulator#/home`);
await a.click('button:has-text("Not this year")');
await a.waitForSelector('text=Tom turns 7 around', { state: 'detached' });

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
// With no phone signed up for notifications nothing counts as sent, so it's tried again the next day.
const soon = new Date(`${addDays(today, 4)}T08:00:00Z`);
assert.equal(await sendReminders(db, soon), 0);
assert.ok((await H.collection('events').get()).docs.every(d => !d.data().reminded), 'nothing marked as reminded yet');
await H.collection('devices').doc('phone').set({ token: 't', uid: 'x' });
const sent = await sendReminders(db, soon);
assert.ok(sent > 0, 'reminders go once a phone is signed up');
assert.equal(await sendReminders(db, soon), 0, 'and only once');
console.log(`  reminders sent 4 days on: ${sent}`);
const events = (await H.collection('events').get()).docs.map(d => ({ id: d.id, ...d.data() }));
const ics = buildCalendar((await H.get()).data(), events);
writeFileSync(new URL('calendar.ics', shots), ics);
assert.match(ics, /Olivia/);

await browser.close();
console.log(process.exitCode ? 'Finished with errors' : 'All good');
