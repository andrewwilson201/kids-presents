// Parties: what's coming up, what still needs a present, the ways to add one,
// and a nudge when a friend's birthday is probably coming round again.
import * as S from '../store.js?v=8';
import { birthdaysDue } from '../gifts.js?v=8';
import { icon } from '../ui.js?v=8';
import { st, esc, head, section, empty, plural, routes, actions, run, today, fmtDay, busy, failed, keep } from '../core.js?v=8';
import { toWrap, eventRow, upcoming, past, undated, needing, children, rows, friends, firstName } from '../events.js?v=8';
import { pickButton } from './scan.js?v=8';

routes.home = () => {
  const reading = st.scans.filter(busy);
  const bad = st.scans.filter(s => failed(s) && !s.dismissed);
  const check = rows(st.events.filter(e => e.needsCheck));
  const need = needing();
  const none = need.filter(e => !e.present?.state).length, being = need.length - none;
  const soon = rows(upcoming());
  const later = rows(past());
  const rest = soon.filter(e => !check.includes(e));
  const noDate = rows(undated());
  const due = birthdaysDue(friends(), today(), st.household.friendSnooze);
  const wrap = toWrap().length;
  const sub = !soon.length ? 'No parties coming up.' : need.length || wrap
    ? [none ? `${none} ${none === 1 ? 'needs' : 'need'} a present` : '', being ? `${being} being bought` : '', wrap ? `${wrap} to wrap` : ''].filter(Boolean).join(' · ')
    : 'Every present coming up is bought and wrapped.';
  return `${head('Parties', { eyebrow: esc(children().map(c => c.name).join(' & ')), sub })}
    <div class="row add-row">${pickButton('From invite')}<a class="btn tonal" href="#/edit">${icon('plus')} Add a party</a></div>
    ${reading.length ? `<a class="notice info" href="#/scan"><span class="spinner"></span><span class="grow"><b>Reading ${plural(reading.length, 'invite')}…</b><br>The party will appear here in a moment.</span></a>` : ''}
    ${bad.length ? `<a class="notice danger" href="#/scan">${icon('alert')}<span class="grow"><b>An invite couldn't be read</b><br>${esc(bad[0].message || 'Tap to try again or type it in.')}</span></a>` : ''}
    ${check.length ? `${section('Read from an invite: check these', { count: check.length })}<ul class="list card flush">${check.map(e => eventRow(e)).join('')}</ul>` : ''}
    ${rest.length ? `${section('Coming up', { count: rest.length })}<ul class="list card flush">${rest.map(e => eventRow(e)).join('')}</ul>`
      : !check.length ? empty('cake', 'No parties yet', 'Share an invite from WhatsApp to Party Presents, or add one here. You\'ll both see it straight away.') : ''}
    ${due.length ? `${section('Birthdays coming round again', { count: due.length })}<ul class="list card nudges">${due.map(d => `<li><span class="tile sm other">${icon('cake')}</span><span class="grow">
        <span class="name">${esc(firstName(d.friend.name))} ${d.age ? `turns ${d.age}` : 'has a birthday'} around ${esc(fmtDay(d.day, { day: 'numeric', month: 'long' }))}</span>
        <span class="meta">Going by last time. Nothing in the calendar yet.</span>
        <span class="row" style="margin-top:8px"><a class="btn small tonal" href="#/edit/like-${esc(d.likeId)}">${icon('plus')} Add it</a><button class="btn small ghost" data-act="notThisYear" data-id="${esc(d.friend.key)}" data-year="${d.year}">Not this year</button></span></span></li>`).join('')}</ul>` : ''}
    ${noDate.length ? `${section('No date yet', { count: noDate.length })}<ul class="list card flush">${noDate.map(e => eventRow(e)).join('')}</ul>` : ''}
    ${later.length ? `<details class="disclosure card flush past" data-toggle="past"${keep.past ? ' open' : ''}><summary>Earlier parties <span class="count">${later.length}</span></summary><ul class="list">${later.slice(0, 40).map(e => eventRow(e)).join('')}</ul></details>` : ''}`;
};
// "Not this year": don't suggest this friend's birthday again until next year.
actions.notThisYear = el => run(() => S.setH([], { friendSnooze: { [el.dataset.id]: Number(el.dataset.year) } }), 'OK, not this year');
