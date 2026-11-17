// Friends: everyone whose party or birthday has been in the calendar, kept
// from year to year: what they're into, how old they are now, and what we've
// given them. Worked out from the parties (js/gifts.js friendsFrom), so
// there's nothing to keep up to date by hand.
import { turningOn, isDay } from '../gifts.js?v=6';
import { icon, childBadge } from '../ui.js?v=6';
import { esc, head, section, empty, today, fmtDay, plural, routes, keep } from '../core.js?v=6';
import { children, friends, whenWords } from '../events.js?v=6';

const longDay = d => fmtDay(d, { day: 'numeric', month: 'long', year: 'numeric' });
function friendRow(f) {
  const latest = f.events.find(e => isDay(e.date));
  const age = turningOn(f, today());
  const facts = [f.upcoming ? `Party ${whenWords(f.upcoming.date)}` : latest ? `Last party ${longDay(latest.date)}` : 'No date yet',
    age ? `${f.upcoming ? 'turning' : 'about'} ${f.upcoming ? turningOn(f, f.upcoming.date) : age}` : '', f.gender].filter(Boolean).join(' · ');
  const key = `friend.${f.key}`;
  return `<li class="friend"><details class="mini" data-toggle="${esc(key)}"${keep[key] ? ' open' : ''}><summary><span class="grow"><span class="name">${esc(f.name)}</span>
      <span class="meta">${esc(facts)}</span>${f.interests ? `<span class="meta">Into ${esc(f.interests)}</span>` : ''}
      ${f.presents.length ? `<span class="meta">${icon('gift')} ${esc(f.presents[0].name)}${f.presents.length > 1 ? ` and ${f.presents.length - 1} before` : ''}</span>` : ''}</span></summary>
    <ul class="list compact history">${f.events.map(e => `<li><a class="grow" href="#/event/${esc(e.id)}"><span class="name">${isDay(e.date) ? esc(longDay(e.date)) : 'No date'}${e.friendAge ? `, turning ${esc(e.friendAge)}` : ''}</span>
      <span class="meta">${e.present?.name ? `${e.present.state === 'chosen' ? 'Getting' : 'Gave'} ${esc(e.present.name)}` : e.cancelled ? 'Cancelled' : e.rsvp === 'no' ? 'Didn\'t go' : 'No present recorded'}</span></a></li>`).join('')}</ul>
    ${f.upcoming ? '' : `<a class="btn small tonal" href="#/edit/like-${esc(f.events[0].id)}">${icon('plus')} Add this year's party</a>`}</details></li>`;
}

routes.friends = () => {
  const all = friends();
  const kids = children();
  const groups = [...kids.map(c => [c.id, `${c.name}'s friends`]), ...(kids.length > 1 ? [['both', 'Friends of both']] : []), ['', 'Not sure whose']]
    .map(([id, title]) => ({ id, title, list: all.filter(f => (id ? f.child === id : f.child !== 'both' && !kids.some(c => c.id === f.child))) }))
    .filter(g => g.list.length);
  return `${head('Friends', { eyebrow: plural(all.length, 'friend'), sub: all.length ? 'Remembered from their parties: what they like and what you\'ve given them.' : '' })}
    ${groups.map(g => `${section(`${g.id && g.id !== 'both' ? `${childBadge(kids, g.id)} friends` : esc(g.title)}`, { count: g.list.length })}<ul class="list card friends">${g.list.map(friendRow).join('')}</ul>`).join('')
      || empty('users', 'No friends yet', 'Each party you add remembers whose it was, what they\'re into and what you gave. Next year the app reminds you their birthday is coming and starts from there.', `<a class="btn primary" href="#/edit">${icon('plus')} Add a party</a>`)}`;
};
