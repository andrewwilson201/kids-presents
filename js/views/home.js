// Parties: what's coming up, what still needs a present, and the ways to add one.
import { icon } from '../ui.js?v=2';
import { st, esc, head, section, empty, plural, routes } from '../core.js?v=2';
import { eventRow, upcoming, past, undated, needing, children, rows } from '../events.js?v=2';
import { pickButton } from './scan.js?v=2';

routes.home = () => {
  const reading = st.scans.filter(s => s.state === 'requested');
  const failed = st.scans.filter(s => s.state === 'failed' && !s.dismissed);
  const check = rows(st.events.filter(e => e.needsCheck));
  const need = needing();
  const soon = rows(upcoming());
  const later = rows(past());
  const rest = soon.filter(e => !check.includes(e));
  const noDate = rows(undated());
  const sub = !soon.length ? 'No parties coming up.' : need.length
    ? `${plural(need.length, 'present')} still to sort.`
    : 'Every party coming up has a present sorted.';
  return `${head('Parties', { eyebrow: esc(children().map(c => c.name).join(' & ')), sub })}
    <div class="row add-row">${pickButton('From invite')}<a class="btn tonal" href="#/edit">${icon('plus')} Add a party</a></div>
    ${reading.length ? `<a class="notice info" href="#/scan"><span class="spinner"></span><span class="grow"><b>Reading ${plural(reading.length, 'invite')}…</b><br>The party will appear here in a moment.</span></a>` : ''}
    ${failed.length ? `<a class="notice danger" href="#/scan">${icon('alert')}<span class="grow"><b>An invite couldn't be read</b><br>${esc(failed[0].message || 'Tap to try again or type it in.')}</span></a>` : ''}
    ${check.length ? `${section('Read from an invite: check these', { count: check.length })}<ul class="list card flush">${check.map(e => eventRow(e)).join('')}</ul>` : ''}
    ${rest.length ? `${section('Coming up', { count: rest.length })}<ul class="list card flush">${rest.map(e => eventRow(e)).join('')}</ul>`
      : !check.length ? empty('cake', 'No parties yet', 'Share an invite picture from WhatsApp to Party Presents, or add one here. You\'ll both see it straight away.') : ''}
    ${noDate.length ? `${section('No date yet', { count: noDate.length })}<ul class="list card flush">${noDate.map(e => eventRow(e)).join('')}</ul>` : ''}
    ${later.length ? `<details class="disclosure card flush past" data-toggle="past"><summary>Earlier parties <span class="count">${later.length}</span></summary><ul class="list">${later.slice(0, 40).map(e => eventRow(e)).join('')}</ul></details>` : ''}`;
};
