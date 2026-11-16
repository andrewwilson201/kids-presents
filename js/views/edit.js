// Adding a party or birthday by hand, and changing one (#/edit, #/edit/{id}).
import * as S from '../store.js?v=1';
import { isDay, isTime } from '../gifts.js?v=1';
import { icon } from '../ui.js?v=1';
import { st, esc, head, run, toast, routes, actions, arg, resetKeep } from '../core.js?v=1';
import { children, eventTitle } from '../events.js?v=1';

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
  return `${head(e ? 'Change details' : 'Add a party', { eyebrow: e ? esc(eventTitle(e)) : 'Parties' })}
    <form class="card stack event-form" data-form="saveEvent" data-id="${esc(e?.id || '')}">
      <div class="two">${select('Who\'s invited', 'child', v.child, [['', 'Choose…'], ...kids.map(c => [c.id, c.name]), ...(kids.length > 1 ? [['both', kids.map(c => c.name).join(' & ')]] : [])])}
      ${select('What is it', 'kind', v.kind, [['party', 'A party'], ['birthday', 'A birthday, no party']])}</div>
      <div class="two">${field('Whose birthday', 'friend', v.friend, { attrs: 'required placeholder="Olivia" autocapitalize="words"' })}
      ${field('Turning', 'friendAge', v.friendAge, { type: 'number', attrs: 'min="1" max="99" inputmode="numeric" placeholder="7"' })}</div>
      <div class="two">${select('Boy or girl', 'friendGender', v.friendGender, [['', 'Not set'], ['girl', 'Girl'], ['boy', 'Boy']])}
      ${field('Budget (£)', 'budget', v.budget, { type: 'number', attrs: `min="1" max="500" inputmode="decimal" placeholder="${esc(st.household?.budget || 15)}"` })}</div>
      ${field('What they\'re into', 'interests', v.interests, { hint: 'For present ideas. Leave blank if you don\'t know.', attrs: 'placeholder="dinosaurs, football, Lego"' })}
      <div class="three">${field('Date', 'date', v.date, { type: 'date' })}${field('Starts', 'start', v.start, { type: 'time' })}${field('Ends', 'end', v.end, { type: 'time' })}</div>
      ${field('Where', 'venue', v.venue, { attrs: 'placeholder="Jump Zone trampoline park"' })}
      ${field('Address', 'address', v.address)}
      <div class="two">${field('Reply by', 'rsvpBy', v.rsvpBy, { type: 'date' })}${field('Reply to', 'contact', v.contact, { attrs: 'placeholder="Olivia\'s mum, 07700 900123"' })}</div>
      ${field('Theme', 'theme', v.theme, { attrs: 'placeholder="Superheroes"' })}
      <label class="field">Notes<textarea name="notes" rows="2" data-keep="ev.notes" placeholder="Bring a swimming costume">${esc(v.notes || '')}</textarea></label>
      <div class="row"><button class="btn primary lg">${icon('check')} ${e ? 'Save' : 'Add party'}</button><a class="btn ghost" href="${e ? `#/event/${esc(e.id)}` : '#/home'}">Cancel</a></div>
    </form>`;
};

actions.saveEvent = f => {
  const g = n => (f[n]?.value ?? '').trim();
  const data = {
    child: g('child'), kind: g('kind') || 'party', friend: g('friend').slice(0, 80), friendAge: g('friendAge') ? Number(g('friendAge')) : null,
    friendGender: g('friendGender'), budget: g('budget') ? Number(g('budget')) : null, interests: g('interests').slice(0, 300),
    date: isDay(g('date')) ? g('date') : '', start: isTime(g('start')) ? g('start') : '', end: isTime(g('end')) ? g('end') : '',
    venue: g('venue').slice(0, 200), address: g('address').slice(0, 300), rsvpBy: isDay(g('rsvpBy')) ? g('rsvpBy') : '', contact: g('contact').slice(0, 200),
    theme: g('theme').slice(0, 100), notes: g('notes').slice(0, 1000),
  };
  if (!data.friend) { toast('Whose birthday is it?'); return; }
  if (!data.child) { toast('Choose who\'s invited'); return; }
  const id = f.dataset.id;
  run(async () => {
    if (id) {
      // Changing the date means the reminders start again.
      const old = st.events.find(x => x.id === id);
      await S.updateH(['events', id], { ...data, needsCheck: false, ...(old?.date !== data.date ? { reminded: {} } : {}) });
      resetKeep(); location.hash = `#/event/${id}`;
    } else {
      const nid = S.newId('events');
      await S.setH(['events', nid], { ...data, createdBy: S.me(), createdAt: S.serverTimestamp() }, false);
      resetKeep(); location.hash = `#/event/${nid}`;
    }
  }, id ? 'Saved' : 'Added. You\'ll both see it.');
};
