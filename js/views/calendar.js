// Calendar: a month at a time, each party a dot in its child's colour. Tap a
// day to see what's on. The phone calendar feed (Settings) is the other way to see it.
import { addDays, isDay } from '../gifts.js?v=7';
import { icon, childColour } from '../ui.js?v=7';
import { st, esc, head, today, fmtDay, fmtLong, empty, routes, actions, render, arg } from '../core.js?v=7';
import { eventRow, children, rows } from '../events.js?v=7';

let picked = null;
const monthOf = () => (/^\d{4}-\d{2}$/.test(arg || '') ? arg : today().slice(0, 7));

routes.calendar = () => {
  const month = monthOf();
  const first = `${month}-01`;
  const startDow = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday first
  const next = addDays(first, 32).slice(0, 7), prev = addDays(first, -1).slice(0, 7);
  const byDay = {};
  for (const e of rows(st.events)) if (isDay(e.date) && e.date.startsWith(month)) (byDay[e.date] ||= []).push(e);
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push('<span class="cal-cell blank"></span>');
  for (let day = first; day.startsWith(month); day = addDays(day, 1)) {
    const evs = byDay[day] || [];
    cells.push(`<button class="cal-cell${day === today() ? ' today' : ''}${day === picked ? ' on' : ''}${day < today() ? ' past' : ''}" data-act="pickDay" data-id="${day}" aria-label="${esc(fmtLong(day))}${evs.length ? `, ${evs.length} on` : ''}">
      <b>${Number(day.slice(8))}</b><span class="dots">${evs.slice(0, 3).map(e => `<i class="dot ${childColour(children(), e.child)}${e.cancelled || e.rsvp === 'no' ? ' off' : ''}"></i>`).join('')}</span></button>`);
  }
  const shown = picked && picked.startsWith(month) ? (byDay[picked] || []) : Object.keys(byDay).sort().flatMap(d => byDay[d]);
  return `${head('Calendar', { eyebrow: 'Parties and birthdays' })}
    <div class="card cal">
      <div class="row nowrap cal-head"><a class="iconbtn sm" href="#/calendar/${prev}" aria-label="Previous month">${icon('back')}</a>
        <h2 class="grow">${esc(fmtDay(first, { month: 'long', year: 'numeric' }))}</h2>
        ${month !== today().slice(0, 7) ? `<a class="btn small ghost" href="#/calendar">Today</a>` : ''}
        <a class="iconbtn sm" href="#/calendar/${next}" aria-label="Next month">${icon('chevron')}</a></div>
      <div class="cal-grid">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<span class="cal-dow">${d}</span>`).join('')}${cells.join('')}</div>
      <div class="row legend">${children().map(c => `<span><i class="dot ${childColour(children(), c.id)}"></i>${esc(c.name)}</span>`).join('')}${children().length > 1 ? `<span><i class="dot both"></i>Both</span>` : ''}</div>
    </div>
    <div class="section-head"><h2>${picked && picked.startsWith(month) ? esc(fmtLong(picked)) : 'This month'}</h2><span class="spacer"></span>${picked ? `<a class="btn small tonal" href="#/edit/on-${picked}">${icon('plus')} Add</a>` : ''}</div>
    ${shown.length ? `<ul class="list card flush">${shown.map(e => eventRow(e)).join('')}</ul>` : empty('calendar', 'Nothing on', picked ? 'No parties that day.' : 'No parties this month.')}`;
};
actions.pickDay = el => { picked = picked === el.dataset.id ? null : el.dataset.id; render(); };
