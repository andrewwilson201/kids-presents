// Adding a party or birthday by hand, and changing one (#/edit, #/edit/{id}).
// A joint party has more than one birthday child: each is saved as its own
// event with its own present, sharing a groupId and the party's details (js/gifts.js).
import * as S from '../store.js?v=2';
import { isDay, isTime } from '../gifts.js?v=2';
import { icon } from '../ui.js?v=2';
import { st, esc, head, run, toast, render, routes, actions, hooks, arg, resetKeep } from '../core.js?v=2';
import { children, partyTitle, sibs } from '../events.js?v=2';

// How many extra birthday children the form shows (a joint party).
let extraFor = null, extraCount = 0;
hooks.leave.push(() => { extraFor = null; });

const field = (label, name, value, { type = 'text', hint = '', attrs = '' } = {}) =>
  `<label class="field">${label}${hint ? `<span class="hint">${hint}</span>` : ''}<input type="${type}" name="${name}" value="${esc(value ?? '')}" data-keep="ev.${name}" ${attrs}></label>`;
const select = (label, name, value, options) =>
  `<label class="field">${label}<select name="${name}" data-keep="ev.${name}">${options.map(([v, t]) => `<option value="${esc(v)}"${String(value ?? '') === String(v) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;

routes.edit = () => {
  // #/edit/on-2026-11-28 adds a party on that day (from the calendar).
  const on = /^on-\d{4}-\d{2}-\d{2}$/.test(arg || '') ? arg.slice(3) : '';
  const e = arg && !on ? st.events.find(x => x.id === arg) : null;
  if (arg && !on && !e) return `${head('Not found')}<p class="muted">That party has been deleted.</p><a class="btn" href="#/home">Back to parties</a>`;
  const v = e || { kind: 'party', child: children().length === 1 ? children()[0].id : '', budget: '', date: on };
  const kids = children();
  const others = e ? sibs(e).filter(x => x.id !== e.id) : [];
  if (extraFor !== (arg || '')) { extraFor = arg || ''; extraCount = others.length; }
  const extraRows = Array.from({ length: extraCount }, (_, i) => {
    const o = others[i] || {};
    return `<div class="joint-child"><input type="hidden" name="x${i}.id" value="${esc(o.id || '')}">
      <div class="two">${field('Also whose birthday', `x${i}.friend`, o.friend, { attrs: 'placeholder="Max" autocapitalize="words"' })}
      ${field('Turning', `x${i}.friendAge`, o.friendAge, { type: 'number', attrs: 'min="1" max="99" inputmode="numeric"' })}</div>
      <div class="two">${select('Boy or girl', `x${i}.friendGender`, o.friendGender, [['', 'Not set'], ['girl', 'Girl'], ['boy', 'Boy']])}
      ${field('What they\'re into', `x${i}.interests`, o.interests)}</div></div>`;
  }).join('');
  return `${head(e ? 'Change details' : 'Add a party', { eyebrow: e ? esc(partyTitle(e)) : 'Parties' })}
    <form class="card stack event-form" data-form="saveEvent" data-id="${esc(e?.id || '')}">
      <div class="two">${select('Who\'s invited', 'child', v.child, [['', 'Choose…'], ...kids.map(c => [c.id, c.name]), ...(kids.length > 1 ? [['both', kids.map(c => c.name).join(' & ')]] : [])])}
      ${select('What is it', 'kind', v.kind, [['party', 'A party'], ['birthday', 'A birthday, no party']])}</div>
      <div class="two">${field('Whose birthday', 'friend', v.friend, { attrs: 'required placeholder="Olivia" autocapitalize="words"' })}
      ${field('Turning', 'friendAge', v.friendAge, { type: 'number', attrs: 'min="1" max="99" inputmode="numeric" placeholder="7"' })}</div>
      <div class="two">${select('Boy or girl', 'friendGender', v.friendGender, [['', 'Not set'], ['girl', 'Girl'], ['boy', 'Boy']])}
      ${field('Budget (£)', 'budget', v.budget, { type: 'number', attrs: `min="1" max="500" inputmode="decimal" placeholder="${esc(st.household?.budget || 15)}"` })}</div>
      ${field('What they\'re into', 'interests', v.interests, { hint: 'For present ideas. Leave blank if you don\'t know.', attrs: 'placeholder="dinosaurs, football, Lego"' })}
      ${extraRows}
      <div><button type="button" class="btn small ghost" data-act="addBirthdayChild">${icon('plus')} Joint party? Add another birthday child</button>
      ${extraCount ? '<p class="tiny muted" style="margin:6px 0 0">Each birthday child gets their own present. To take one off, clear their name.</p>' : ''}</div>
      <div class="three">${field('Date', 'date', v.date, { type: 'date' })}${field('Starts', 'start', v.start, { type: 'time' })}${field('Ends', 'end', v.end, { type: 'time' })}</div>
      ${field('Where', 'venue', v.venue, { attrs: 'placeholder="Jump Zone trampoline park"' })}
      ${field('Address', 'address', v.address)}
      <div class="two">${field('Reply by', 'rsvpBy', v.rsvpBy, { type: 'date' })}${field('Reply to', 'contact', v.contact, { attrs: 'placeholder="Olivia\'s mum, 07700 900123"' })}</div>
      ${field('Theme', 'theme', v.theme, { attrs: 'placeholder="Superheroes"' })}
      <label class="field">Notes<textarea name="notes" rows="2" data-keep="ev.notes" placeholder="Bring a swimming costume">${esc(v.notes || '')}</textarea></label>
      <div class="row"><button class="btn primary lg">${icon('check')} ${e ? 'Save' : 'Add party'}</button><a class="btn ghost" href="${e ? `#/event/${esc(e.id)}` : '#/home'}">Cancel</a></div>
    </form>`;
};

actions.addBirthdayChild = () => { extraCount = Math.min(6, extraCount + 1); render(); };

actions.saveEvent = f => {
  const g = n => (f.elements[n]?.value ?? '').trim();
  const own = p => ({ friend: g(`${p}friend`).slice(0, 80), friendAge: g(`${p}friendAge`) ? Number(g(`${p}friendAge`)) : null, friendGender: g(`${p}friendGender`), interests: g(`${p}interests`).slice(0, 300) });
  // The party itself: the same for every birthday child.
  const party = {
    child: g('child'), kind: g('kind') || 'party', budget: g('budget') ? Number(g('budget')) : null,
    date: isDay(g('date')) ? g('date') : '', start: isTime(g('start')) ? g('start') : '', end: isTime(g('end')) ? g('end') : '',
    venue: g('venue').slice(0, 200), address: g('address').slice(0, 300), rsvpBy: isDay(g('rsvpBy')) ? g('rsvpBy') : '', contact: g('contact').slice(0, 200),
    theme: g('theme').slice(0, 100), notes: g('notes').slice(0, 1000),
  };
  const main = own('');
  if (!main.friend) { toast('Whose birthday is it?'); return; }
  if (!party.child) { toast('Choose who\'s invited'); return; }
  const extras = Array.from({ length: extraCount }, (_, i) => ({ id: g(`x${i}.id`), ...own(`x${i}.`) }));
  const id = f.dataset.id;
  run(async () => {
    const old = id ? st.events.find(x => x.id === id) : null;
    const mainId = id || S.newId('events');
    const staying = extras.filter(x => x.friend);
    const groupId = staying.length ? (old?.groupId || mainId) : null;
    // Changing the date means the reminders start again.
    const again = old && old.date !== party.date ? { reminded: {} } : {};
    const stamp = { createdBy: S.me(), createdAt: S.serverTimestamp() };
    const ops = [];
    if (old) ops.push(['update', ['events', id], { ...party, ...main, needsCheck: false, groupId: groupId || S.deleteField(), ...(groupId ? { groupOrder: old.groupOrder ?? 0 } : {}), ...again }]);
    else ops.push(['set', ['events', mainId], { ...party, ...main, ...(groupId ? { groupId, groupOrder: 0 } : {}), ...stamp }]);
    let order = Math.max(0, ...(old ? sibs(old) : []).map(x => x.groupOrder ?? 0));
    for (const x of extras) {
      const { id: xid, ...kid } = x;
      const was = xid ? st.events.find(e => e.id === xid) : null;
      if (was && !kid.friend) { // taken off the party
        if (was.present?.cupboardId) ops.push(['update', ['cupboard', was.present.cupboardId], { usedFor: null }]);
        ops.push(['delete', ['events', xid]]);
      } else if (was) ops.push(['update', ['events', xid], { ...party, ...kid, needsCheck: false, groupId, ...again }]);
      else if (kid.friend) ops.push(['set', ['events', S.newId('events')], { ...party, ...kid, groupId, groupOrder: ++order, rsvp: old?.rsvp || '', cancelled: old?.cancelled || false, ...(old?.scanId ? { scanId: old.scanId } : {}), ...stamp }]);
    }
    await S.batchH(ops);
    resetKeep(); extraFor = null;
    location.hash = `#/event/${mainId}`;
  }, id ? 'Saved' : 'Added. You\'ll both see it.');
};
