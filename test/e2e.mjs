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
// The starter ideas are written in batches after the family is made: wait for them.
const ideaCount = async () => (await H.collection('ideas').count().get()).data().count;
for (let i = 0; i < 40 && (await ideaCount()) < 100; i++) await a.waitForTimeout(250);
assert.ok((await ideaCount()) >= 100, 'starter ideas loaded');

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
  const S = await import('/js/store.js?v=12');
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
// The app's write can take a moment to reach the database: wait for one.
const asks = async kind => { for (let i = 0; ; i++) { const got = (await H.collection('asks').get()).docs.filter(d => d.data().kind === kind); if (got.length || i > 50) return got; await new Promise(r => setTimeout(r, 100)); } };
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

// 9e. Wish lists for our own children: both add ideas, drag them into order (by touch), tick off what's ordered.
step('Wish lists: add, drag into order by touch, mark as ordered');
await a.goto(`${SITE}?emulator#/wishes/charlie-christmas`);
await a.waitForSelector('text=Charlie\'s Christmas list');
await a.waitForSelector('text=Nothing on this list yet');
for (const w of ['Lego Millennium Falcon', 'Nerf blaster']) { await a.fill('input[name=what]', w); await a.click('.wish-add button'); await a.waitForSelector(`.wish:has-text("${w}")`); }
await a.fill('input[name=what]', 'https://www.argos.co.uk/product/1234567');
await a.click('.wish-add button');
await a.waitForSelector('.wish:has-text("Reading the link")');
let wishAsk;
for (let i = 0; i < 50 && !wishAsk; i++) { wishAsk = (await asks('link')).find(d => d.data().url === 'https://www.argos.co.uk/product/1234567'); if (!wishAsk) await a.waitForTimeout(100); }
await processAsk(await H.get(), wishAsk.ref);
await a.waitForSelector('.wish:has-text("LEGO City Police Car 60312")');
await a.waitForSelector('.wish:has-text("£8.99")');
await b.goto(`${SITE}?emulator#/wishes/charlie-christmas`);
await b.waitForSelector('.wish:has-text("LEGO City Police Car 60312")');
const order = async p => p.$$eval('.wishes > li .name', els => els.map(e => e.textContent.trim()));
assert.deepEqual(await order(b), ['Lego Millennium Falcon', 'Nerf blaster', 'LEGO City Police Car 60312']);
await shot(b, '11i-wishes');
// Sarah drags the police car to the top with her finger.
const touch = await b.context().newCDPSession(b);
// The whole list on screen (the spend total and add box sit above it).
await b.evaluate(() => window.scrollTo(0, document.querySelector('.wishes').getBoundingClientRect().top + scrollY - 120));
const grip = await (await b.$('.wishes > li:nth-child(3) .grip')).boundingBox();
const top = await (await b.$('.wishes > li:nth-child(1)')).boundingBox();
const x = grip.x + grip.width / 2; let y = grip.y + grip.height / 2;
await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
for (; y > top.y + 10; y -= 12) { await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await b.waitForTimeout(16); }
await shot(b, '11j-wishes-dragging');
await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await b.waitForTimeout(500);
assert.deepEqual(await order(b), ['LEGO City Police Car 60312', 'Lego Millennium Falcon', 'Nerf blaster']);
await a.waitForFunction(() => document.querySelector('.wishes > li .name')?.textContent.includes('Police Car'));
assert.deepEqual(await order(a), ['LEGO City Police Car 60312', 'Lego Millennium Falcon', 'Nerf blaster'], 'Andrew sees the new order');
// Sarah orders the Nerf blaster; Andrew sees it's done.
await b.click('.wish:has-text("Nerf blaster") >> text=Ordered it');
await a.waitForSelector('.wish-done:has-text("Nerf blaster") >> text=ordered by Sarah');
assert.deepEqual(await order(a), ['LEGO City Police Car 60312', 'Lego Millennium Falcon']);
// Prices and the estimated spend: Sarah plans to buy the police car, Andrew
// types the Falcon's price straight onto its card and plans to buy that too.
const total = p => p.$eval('.spend-total', e => e.textContent.trim());
await a.waitForSelector('.spend:has-text("no price yet")');
assert.equal(await total(a), '£0');
await b.click('.wish:has-text("Police Car") button[data-act=wishPlanned]');
await a.waitForSelector('.wish:has-text("Police Car") >> text=Sarah is getting this');
await a.waitForFunction(() => document.querySelector('.spend-total')?.textContent.trim() === '£8.99');
await a.click('.wish:has-text("Millennium Falcon") .wish-price');
await a.fill('.wish-price-edit input[name=price]', '64.5');
await a.click('.wish-price-edit button:has-text("Save")');
await b.waitForSelector('.wish:has-text("Millennium Falcon") .wish-price:has-text("£64.50")');
await a.click('.wish:has-text("Millennium Falcon") button[data-act=wishPlanned]');
await b.waitForFunction(() => document.querySelector('.spend-total')?.textContent.trim() === '£73.49');
await a.waitForSelector('.wish:has-text("Millennium Falcon") >> text=You\'re getting this');
assert.match(await b.$eval('.spend', e => e.textContent), /£0 ordered · £73.49 planning to buy/);
assert.match(await b.$eval('.spend', e => e.textContent), /1 present has no price yet/, 'the ordered Nerf blaster has no price');
await shot(b, '11k1-wishes-spend');
// Taking the plan off takes it out of the total.
await a.click('.wish:has-text("Millennium Falcon") button[data-act=wishPlanned]');
await b.waitForFunction(() => document.querySelector('.spend-total')?.textContent.trim() === '£8.99');
// An Amazon link: the name comes from the address, then the price is looked up.
await a.fill('input[name=what]', 'https://www.amazon.co.uk/Harry-Potter-Potions-Classroom/dp/B0CXYZ1234/ref=sr_1_1');
await a.click('.wish-add button');
let amz;
for (let i = 0; i < 50 && !amz; i++) { amz = (await asks('link')).find(d => d.data().url.includes('B0CXYZ1234')); if (!amz) await a.waitForTimeout(100); }
await processAsk(await H.get(), amz.ref);
assert.equal((await amz.ref.get()).data().named.title, 'Harry Potter Potions Classroom', 'the name was passed on before the price');
await a.waitForSelector('.wish:has-text("Harry Potter Potions Classroom") .wish-price:has-text("£24.99")');
// Amazon hid the price, so it came from another UK shop: shown as roughly, and where from.
const askFor = async part => { for (let i = 0; i < 50; i++) { const d = (await asks('link')).find(x => x.data().url.includes(part) && x.data().state === 'requested'); if (d) return d; await a.waitForTimeout(100); } };
await a.fill('input[name=what]', 'https://www.amazon.co.uk/Lego-Ninjago-Green-Dragon/dp/B0ARGOS123');
await a.click('.wish-add button');
await processAsk(await H.get(), (await askFor('B0ARGOS123')).ref);
await a.waitForSelector('.wish:has-text("Lego Ninjago Green Dragon") .wish-price:has-text("~£24.99")');
await a.waitForSelector('.wish:has-text("Lego Ninjago Green Dragon") >> text=price from Argos');
// Looking the price up again, from the price box.
await a.click('.wish:has-text("Lego Ninjago Green Dragon") .wish-price');
await a.click('text=Look the price up for me');
await a.waitForSelector('.wish:has-text("Lego Ninjago Green Dragon") .wish-price.finding');
await processAsk(await H.get(), (await askFor('B0ARGOS123')).ref);
await a.waitForSelector('.wish:has-text("Lego Ninjago Green Dragon") .wish-price:has-text("~£24.99")');
// Typing a price over it makes it a plain price.
await a.click('.wish:has-text("Lego Ninjago Green Dragon") .wish-price');
await a.fill('.wish-price-edit input[name=price]', '20');
await a.click('.wish-price-edit button:has-text("Save")');
await a.waitForSelector('.wish:has-text("Lego Ninjago Green Dragon") .wish-price:text-is("£20")');
assert.equal(await a.locator('.wish:has-text("Lego Ninjago Green Dragon") >> text=price from Argos').count(), 0);
for (const n of ['Harry Potter', 'Lego Ninjago Green Dragon']) {
  await a.click(`.wish:has-text("${n}") >> text=Change`);
  await a.click('.wish-edit >> text=Delete');
  await a.waitForSelector(`.wish:has-text("${n}")`, { state: 'detached' });
}
// Andrew moves the Falcon to Charlie's birthday list instead.
await a.click('.wish:has-text("Millennium Falcon") >> text=Change');
await a.fill('.wish-edit input[name=price]', '79.99');
await a.selectOption('.wish-edit select[name=list]', 'charlie-birthday');
await a.click('.wish-edit button:has-text("Save")');
await a.waitForSelector('.wish:has-text("Millennium Falcon")', { state: 'detached' });
await shot(a, '11k-wishes-ordered');
await a.goto(`${SITE}?emulator#/wishes/charlie-birthday`);
await a.waitForSelector('.wish:has-text("Millennium Falcon") >> text=£79.99');
// A link shared from a shop's app offers the lists.
await a.evaluate(async () => (await import('/js/views/wishes.js?v=12')).offerSharedLink('LEGO Friends Heartlake Cafe https://amzn.eu/d/abc123'));
await a.waitForSelector('text=Add this to a wish list?');
await shot(a, '11l-shared-link');
await a.click('button:has-text("Sophie\'s Christmas list")');
await a.waitForSelector('text=Sophie\'s Christmas list');
await a.waitForSelector('.wish:has-text("LEGO Friends Heartlake Cafe")');
const wishes = (await H.collection('wishes').get()).docs.map(d => d.data());
assert.equal(wishes.length, 4, "the Amazon one was deleted");
assert.equal(wishes.find(w => w.name === 'Nerf blaster').ordered.name, 'Sarah');
// After Christmas: the leftovers from before it are offered a move to the birthday list.
step('Wish lists after the day: leftovers move to the birthday list');
const yr = Number(today.slice(0, 4)); const xmas = today > `${yr}-12-25` ? `${yr}-12-25` : `${yr - 1}-12-25`;
const xmasBefore = new Date(`${addDays(xmas, -10)}T12:00:00Z`);
for (const [name, ordered] of [['Scooter', null], ['Roller skates', null], ['Board game', { uid: 'x', name: 'Andrew', at: xmasBefore.toISOString() }]])
  await H.collection('wishes').add({ child: 'sophie', occasion: 'christmas', name, rank: 0, ordered, by: { uid: 'x', name: 'Andrew' }, createdAt: xmasBefore });
await a.goto(`${SITE}?emulator#/wishes/sophie-christmas`);
await a.waitForSelector('text=Christmas has been.');
await a.waitForSelector('text=2 ideas weren\'t ordered');
await shot(a, '11m-after-christmas');
await a.click('button:has-text("Move to Sophie\'s birthday list")');
await a.waitForSelector('text=Christmas has been.', { state: 'detached' });
await a.waitForSelector('.wish:has-text("LEGO Friends Heartlake Cafe")');
assert.equal(await a.locator('.wish:has-text("Scooter")').count(), 0);
await a.goto(`${SITE}?emulator#/wishes/sophie-birthday`);
await a.waitForSelector('.wish:has-text("Scooter")');
await a.waitForSelector('.wish:has-text("Roller skates")');
const after = (await H.collection('wishes').get()).docs.map(d => d.data());
assert.ok(!after.some(w => w.name === 'Board game'), 'the ordered one is cleared');
assert.equal((await H.get()).data().wishTidied['sophie-christmas'], xmas);

// 10. Calendar and home.
step('Calendar, home, settings');
await a.goto(`${SITE}?emulator#/calendar`);
await a.waitForSelector('.cal-grid');
await shot(a, '12-calendar');
await a.goto(`${SITE}?emulator#/home`);
await a.waitForSelector('text=Coming up');
await shot(a, '13-home');
await a.goto(`${SITE}?emulator#/settings`);
await a.waitForSelector('text=Calendar feed link');
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

// 12. Google Calendar invites, against a pretend Google.
step('Parties go to Google Calendar, with the others invited');
const { syncAll, syncParty, useFetch, eventId } = await import('../functions/gcal.mjs');
const calls = [];
const store = new Map();
useFetch(async (url, o = {}) => {
  const u = new URL(url); const body = o.body && o.headers?.['Content-Type'] === 'application/json' ? JSON.parse(o.body) : null;
  calls.push({ method: o.method, path: u.pathname, send: u.searchParams.get('sendUpdates'), body });
  const json = (status, j = {}) => ({ ok: status < 300, status, json: async () => j });
  if (u.hostname === 'oauth2.googleapis.com') return json(200, { access_token: 'at' });
  const id = u.pathname.split('/events/')[1];
  if (o.method === 'POST') { if (store.has(body.id)) return json(409); store.set(body.id, body); return json(200, body); }
  if (o.method === 'PATCH') { if (!store.has(id)) return json(404); store.set(id, { ...store.get(id), ...body }); return json(200, body); }
  if (o.method === 'DELETE') { if (!store.has(id)) return json(410); store.get(id).status = 'cancelled'; return { ok: true, status: 204, json: async () => ({}) }; }
  return json(404);
});
const hd = (await H.get()).data();
const andrewUid = hd.members[0];
await db.collection('calendarLinks').doc(hid).set({ refreshToken: 'rt', uid: andrewUid, email: 'andrew@example.com' });
const added = await syncAll(db, hid);
assert.ok(added > 0, 'upcoming parties added');
const firstPost = calls.find(c => c.method === 'POST' && c.path.includes('/events'));
assert.equal(firstPost.send, 'all', 'the others get an invite');
assert.equal(firstPost.body.attendees.length, 1, 'Sarah invited (not Andrew himself)');
assert.match(firstPost.body.attendees[0].email, /^sarah/);
// Nothing changed: nothing sent again.
calls.length = 0;
assert.equal(await syncAll(db, hid), 0);
assert.ok(!calls.some(c => c.path.includes('/events')), 'no writes when nothing changed');
// A joint party is one event.
const jointEvs = events.filter(e => e.groupId);
if (jointEvs.length) assert.equal([...store.keys()].filter(k => k === eventId(hid, jointEvs[0].groupId)).length, 1);
// The time changes: the others are told. The present moves on: quietly.
const one = events.find(e => !e.groupId && e.date >= today && e.kind !== 'birthday' && !e.cancelled && e.rsvp !== 'no');
calls.length = 0;
await H.collection('events').doc(one.id).update({ start: '10:00', end: '12:00' });
assert.equal(await syncParty(db, hid, one.id), 'sent');
assert.equal(store.get(eventId(hid, one.id)).start.dateTime, `${one.date}T10:00:00`);
await H.collection('events').doc(one.id).update({ 'present.name': 'Something else' });
assert.equal(await syncParty(db, hid, one.id), 'updated');
assert.equal(calls.at(-1).send, 'none');
// Not going: taken out of the calendars.
await H.collection('events').doc(one.id).update({ rsvp: 'no' });
assert.equal(await syncParty(db, hid, one.id), 'removed');
assert.equal(store.get(eventId(hid, one.id)).status, 'cancelled');
// Going after all: back in.
await H.collection('events').doc(one.id).update({ rsvp: 'yes' });
assert.equal(await syncParty(db, hid, one.id), 'sent');
assert.equal(store.get(eventId(hid, one.id)).status, 'confirmed');
await H.update({ calendar: { email: 'andrew@example.com', name: 'Andrew Wilson', uid: andrewUid, at: new Date() } });
await a.goto(`${SITE}?emulator#/settings`);
await a.waitForSelector('text=In your Google Calendars');
await a.locator('text=In your Google Calendars').scrollIntoViewIfNeeded();
await a.screenshot({ path: new URL('16-calendar-connected.png', shots).pathname });

await browser.close();
console.log(process.exitCode ? 'Finished with errors' : 'All good');
