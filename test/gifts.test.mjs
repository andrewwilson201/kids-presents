// Unit tests for the app's rules (js/gifts.js) and the calendar feed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ageOn, dueReminders, matchIdeas, scoreIdea, eventFromInvite, pastPresents, daysBetween, addDays, shopLinks, fmt12 } from '../js/gifts.js';

const kids = [{ id: 'charlie', name: 'Charlie', gender: 'boy', age: 7, ageOn: '2026-11-16' }, { id: 'sophie', name: 'Sophie', gender: 'girl', birthday: '2021-03-04' }];
const party = (over = {}) => ({ id: 'e1', kind: 'party', child: 'sophie', friend: 'Olivia', date: '2026-11-28', start: '14:00', ...over });

test('dates', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(daysBetween('2026-11-16', '2026-11-28'), 12);
  assert.equal(fmt12('14:30'), '2:30pm');
  assert.equal(fmt12('09:00'), '9am');
});

test('ages from a birthday or a recorded age', () => {
  assert.equal(ageOn(kids[1], '2026-03-03'), 4);
  assert.equal(ageOn(kids[1], '2026-03-04'), 5);
  assert.equal(ageOn(kids[0], '2027-11-17'), 8);
  assert.equal(ageOn(kids[0], '2027-06-01'), 7);
});

test('reminders: first, second, reply-by, on the day, each once', () => {
  assert.deepEqual(dueReminders(party(), '2026-11-17', {}, kids), []); // 11 days: nothing yet
  const first = dueReminders(party(), '2026-11-18', {}, kids);
  assert.equal(first.length, 1); assert.equal(first[0].kind, 'first');
  assert.match(first[0].body, /Sophie is invited/);
  assert.deepEqual(dueReminders(party({ reminded: { first: 1 } }), '2026-11-19', {}, kids), []);
  const second = dueReminders(party({ reminded: { first: 1 } }), '2026-11-25', {}, kids);
  assert.equal(second[0].kind, 'second');
  // Bought: no nagging, but still the morning-of reminder.
  const bought = party({ present: { state: 'bought', name: 'Lego', by: { name: 'Andrew' } } });
  assert.deepEqual(dueReminders(bought, '2026-11-25', {}, kids), []);
  const day = dueReminders(bought, '2026-11-28', {}, kids);
  assert.equal(day.length, 1); assert.equal(day[0].kind, 'dayOf'); assert.match(day[0].body, /Take Lego \(and a card\)/);
  // Late addition: only the second reminder, not both.
  assert.deepEqual(dueReminders(party(), '2026-11-26', {}, kids).map(r => r.kind), ['second']);
  // Reply-by.
  assert.deepEqual(dueReminders(party({ rsvpBy: '2026-11-20', date: '2026-12-20' }), '2026-11-18', {}, kids).map(r => r.kind), ['rsvp']);
  assert.deepEqual(dueReminders(party({ rsvpBy: '2026-11-20', rsvp: 'yes', date: '2026-12-20' }), '2026-11-18', {}, kids), []);
  // Not going or cancelled: nothing.
  assert.deepEqual(dueReminders(party({ rsvp: 'no' }), '2026-11-25', {}, kids), []);
  assert.deepEqual(dueReminders(party({ cancelled: true }), '2026-11-28', {}, kids), []);
  // Someone said they'd get it: still reminded (it isn't bought), and told who.
  assert.match(dueReminders(party({ present: { state: 'chosen', by: { name: 'Sarah' } } }), '2026-11-18', {}, kids)[0].body, /Sarah said/);
  // Settings: first reminder 5 days before.
  assert.deepEqual(dueReminders(party(), '2026-11-18', { first: 5 }, kids), []);
});

test('ideas match budget, age, gender and interests', () => {
  const ideas = JSON.parse(readFileSync(new URL('../data/ideas.json', import.meta.url)));
  assert.ok(ideas.length >= 100);
  assert.equal(new Set(ideas.map(i => i.id)).size, ideas.length);
  const got = matchIdeas(ideas, { budget: 10, age: 7, gender: 'boy', interests: 'dinosaurs' });
  assert.ok(got.length > 3);
  assert.ok(got.every(i => i.price <= 11 && i.ageMin <= 7 && i.ageMax >= 7 && i.for !== 'girl'));
  assert.match(got[0].name + got[0].interests.join(), /dinosaur/i);
  assert.equal(scoreIdea({ name: 'x', price: 40 }, { budget: 15 }), -1);
  assert.equal(scoreIdea({ name: 'x', hidden: true }, {}), -1);
  // Something already given to this friend drops down.
  const a = { id: 'a', name: 'Lego set', price: 10 }, b = { id: 'b', name: 'Lego tub', price: 10 };
  assert.equal(matchIdeas([a, b], { interests: 'lego' }, { given: new Set(['a']) })[0].id, 'b');
});

test('an invite read by Claude becomes a party for the right child', () => {
  const e = eventFromInvite({ birthday_child: 'Olivia', turning_age: 7, birthday_child_gender: 'girl', invited_child: 'Dear Sophie', date: '2025-11-28', start_time: '14:00', end_time: '25:00', venue: 'Jump Zone', address: '', rsvp_by: 'soon', rsvp_contact: 'Sarah', theme: '', other_details: '' }, kids, '2026-11-16');
  assert.equal(e.child, 'sophie');
  assert.equal(e.date, '2026-11-28'); // no year on the invite: the next one
  assert.equal(e.end, ''); assert.equal(e.rsvpBy, '');
  assert.equal(eventFromInvite({ invited_child: 'Charlie and Sophie' }, kids).child, 'both');
  assert.equal(eventFromInvite({ invited_child: '' }, kids).child, '');
});

test('what we gave a friend before', () => {
  const events = [party({ id: 'a', date: '2025-11-20', present: { state: 'bought', name: 'Slime kit', ideaId: 's' } }), party({ id: 'b', friend: 'olivia ', date: '2024-11-20', present: { state: 'wrapped', name: 'Book' } }), party({ id: 'c' })];
  assert.deepEqual(pastPresents(events, 'Olivia', 'c').map(p => p.name), ['Slime kit', 'Book']);
});

test('shop links', () => {
  const l = shopLinks('LEGO City small set');
  assert.equal(l.length, 4);
  assert.ok(l[0].url.startsWith('https://www.amazon.co.uk/s?k=LEGO%20City'));
});

test('calendar feed', async () => {
  process.env.FIRESTORE_EMULATOR_HOST ||= ''; // keep firebase-admin quiet if loaded
  const { execSync } = await import('node:child_process');
  execSync('node tools/copy-shared.mjs', { cwd: new URL('..', import.meta.url) });
  const { buildCalendar } = await import('../functions/tasks.mjs');
  const ics = buildCalendar({ name: 'The Wilsons', children: kids }, [party({ venue: 'Jump Zone; Mill Lane', present: { state: 'chosen', name: 'Lego', by: { name: 'Andrew' } } }), party({ id: 'e2', kind: 'birthday', start: '', date: '2026-12-01' })], new Date('2026-11-16T10:00:00Z'));
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /SUMMARY:Sophie: Olivia's party/);
  assert.match(ics, /DTSTART;TZID=Europe\/London:20261128T140000/);
  assert.match(ics, /DTEND;TZID=Europe\/London:20261128T160000/);
  assert.ok(ics.includes('LOCATION:Jump Zone\\; Mill Lane'));
  assert.match(ics, /DTSTART;VALUE=DATE:20261201/);
  assert.match(ics, /Andrew is getting it/);
  assert.ok(ics.split('\r\n').every(l => l.length <= 75));
});
