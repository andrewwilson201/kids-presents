// How parties and birthdays look in lists: shared by the Parties, Calendar,
// Ideas, Cupboard and Friends screens.
import { daysBetween, fmt12, presentSorted, needsPresent, isDay, siblingsOf, groupEvents, joinNames, friendsFrom } from './gifts.js?v=5';
import { icon, childBadge } from './ui.js?v=5';
import { st, esc, fmtDay, today, money } from './core.js?v=5';

export const children = () => st.household?.children || [];
const ordinal = n => `${n}${(n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}`;

// "Olivia's 7th birthday party", or "Grandma's birthday".
export function eventTitle(e) {
  const who = e.friend ? `${e.friend}'s` : 'A';
  const age = e.friendAge ? ` ${ordinal(Number(e.friendAge))}` : '';
  if (e.kind === 'birthday') return `${who}${age} birthday`;
  return `${who}${age} birthday party`;
}
// A joint party's other birthday children (each is its own event): all of them, this one included.
export const sibs = e => siblingsOf(e, st.events);
// "Olivia & Max's birthday party" for a joint party.
export function partyTitle(e) {
  const s = sibs(e);
  if (s.length < 2) return eventTitle(e);
  return `${joinNames(s.map(x => x.friend || '?'))}'s ${e.kind === 'birthday' ? 'birthdays' : 'birthday party'}`;
}
// A list of events as one row per party.
export const rows = list => groupEvents(list).map(g => g[0]);
export const firstName = n => String(n || '').split(' ')[0];

// When, in words: "in 3 days", "tomorrow", "today", "2 weeks ago".
export function whenWords(day) {
  const d = daysBetween(today(), day);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  if (d > 0) return d < 14 ? `in ${d} days` : `in ${Math.round(d / 7)} weeks`;
  return -d < 14 ? `${-d} days ago` : `${Math.round(-d / 7)} weeks ago`;
}

// The present's state as a chip.
export function presentChip(e) {
  const p = e.present || {};
  if (e.cancelled) return '<span class="chip">Cancelled</span>';
  if (e.rsvp === 'no') return '<span class="chip">Not going</span>';
  if (e.noPresent) return '<span class="chip">No present needed</span>';
  const by = p.by?.name ? esc(firstName(p.by.name)) : '';
  const mine = p.by?.uid === st.user?.uid;
  if (p.state === 'wrapped') return `<span class="chip ok">${icon('check')} Wrapped</span>`;
  if (p.state === 'bought') return `<span class="chip ok">${icon('gift')} Bought${by ? ` by ${mine ? 'you' : by}` : ''}</span>`;
  if (p.state === 'chosen') return `<span class="chip new">${icon('bag')} ${mine ? 'You\'re' : `${by} is`} getting it</span>`;
  const d = isDay(e.date) ? daysBetween(today(), e.date) : 99;
  const urgent = d <= (st.household?.reminders?.second ?? 3);
  return `<span class="chip ${urgent ? 'danger' : 'fav'}">${icon(urgent ? 'alert' : 'gift')} Needs a present</span>`;
}

// One party in a list.
export function eventRow(e, { showChild = true } = {}) {
  const d = (e.date || '').split('-')[2];
  const joint = sibs(e);
  const month = isDay(e.date) ? fmtDay(e.date, { month: 'short' }) : '';
  const time = e.start ? `${fmt12(e.start)}${e.end ? `–${fmt12(e.end)}` : ''}` : '';
  const where = e.venue || e.address || '';
  return `<li class="event-row${e.cancelled || e.rsvp === 'no' ? ' dim' : ''}"><a class="grow row nowrap" href="#/event/${esc(e.id)}" style="gap:14px">
    <span class="datebox">${isDay(e.date) ? `<small>${esc(fmtDay(e.date, { weekday: 'short' }))}</small><b>${Number(d)}</b><small>${esc(month)}</small>` : '<b>?</b>'}</span>
    <span class="grow"><span class="name">${esc(partyTitle(e))}</span>
      <span class="meta">${showChild ? childBadge(children(), e.child) : ''} ${esc([time, where].filter(Boolean).join(' · '))}</span>
      <span class="meta">${joint.length > 1 ? joint.map(x => `<span class="per-child">${esc(firstName(x.friend))} ${presentChip(x)}</span>`).join('') : presentChip(e)}${joint.some(x => x.needsCheck) ? ` <span class="chip warn">${icon('info')} Check details</span>` : ''}</span></span>
    <span class="chev">${icon('chevron')}</span></a></li>`;
}

export const upcoming = () => st.events.filter(e => isDay(e.date) && e.date >= today());
export const past = () => st.events.filter(e => isDay(e.date) && e.date < today()).reverse();
export const undated = () => st.events.filter(e => !isDay(e.date));
// Parties that still need someone to get a present.
export const needing = () => upcoming().filter(e => needsPresent(e) && !presentSorted(e));
// Everyone whose party has been in the calendar (js/gifts.js friendsFrom).
export const friends = () => friendsFrom(st.events, today());
export const budgetOf = e => Number(e?.budget || st.household?.budget || 15);
export const priceText = i => (i.price ? `about ${money(i.price)}` : '');
