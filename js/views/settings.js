// Settings: the family (who's in, the children), budget, reminders,
// notifications and the calendar feed.
import * as S from '../store.js?v=3';
import { ageOn, isDay, DEFAULT_REMINDERS } from '../gifts.js?v=3';
import { icon, avatar, childBadge } from '../ui.js?v=3';
import { st, esc, head, section, run, render, toast, today, routes, actions } from '../core.js?v=3';

routes.settings = () => {
  const h = st.household;
  const link = `${location.origin}${location.pathname}?join=${h.inviteCode}`;
  const feed = `${location.origin}/calendar.ics?h=${h.id}&k=${h.feedKey || ''}`;
  const r = { ...DEFAULT_REMINDERS, ...(h.reminders || {}) };
  const kids = h.children || [];
  return `${head('Settings', { eyebrow: esc(h.name) })}
    ${section('Family')}
    <div class="card"><div class="row nowrap" style="gap:12px;margin-bottom:14px"><span class="who" style="margin:0">${Object.entries(h.memberNames || {}).map(([uid, name]) => avatar({ uid, name })).join('')}</span>
      <span class="grow"><b>${esc(h.name)}</b><br><span class="small muted">${Object.values(h.memberNames || {}).map(esc).join(', ')}</span></span></div>
      <label class="field" style="margin-bottom:10px">Invite link<span class="hint">Send this to whoever shares the present buying. They open it and sign in with Google.</span>
      <input type="text" readonly value="${esc(link)}" onclick="this.select()"></label>
      <div class="row"><button class="btn primary" data-act="share" data-id="${esc(link)}">${icon('users')} Share invite link</button>
      <button class="btn ghost" data-act="newInvite">Make a new link</button></div></div>

    ${section('Children')}
    <div class="card stack">${kids.map((c, i) => `<form data-form="saveChild" data-id="${i}" class="child-form">
      <div class="row nowrap">${childBadge(kids, c.id)}<span class="small muted grow">${ageOn(c, today()) != null ? `${ageOn(c, today())} years old` : ''}</span>${kids.length > 1 ? `<button type="button" class="iconbtn sm" data-act="delChild" data-id="${i}" aria-label="Remove ${esc(c.name)}">${icon('trash')}</button>` : ''}</div>
      <div class="three"><label class="field">Name<input type="text" name="name" value="${esc(c.name)}" required></label>
        <label class="field">Birthday<input type="date" name="birthday" value="${esc(c.birthday || '')}"></label>
        <label class="field">Boy or girl<select name="gender"><option value="boy"${c.gender === 'boy' ? ' selected' : ''}>Boy</option><option value="girl"${c.gender === 'girl' ? ' selected' : ''}>Girl</option></select></label></div>
      <button class="btn small tonal">Save</button></form>`).join('<hr>')}
      <p class="tiny muted">The birthday keeps their age right as they grow (friends are usually the same age, so it's the starting point for present ideas).</p>
      <button class="btn small ghost" data-act="addChild">${icon('plus')} Add a child</button></div>

    ${section('Presents')}
    <form class="card" data-form="saveBudget"><label class="field">Usual budget per present (£)<span class="hint">Each party can have its own. This is where ideas start.</span>
      <div class="row nowrap"><input type="number" name="budget" min="1" inputmode="decimal" value="${esc(h.budget || 15)}" style="max-width:120px"><button class="btn small primary">Save</button></div></label></form>

    ${section('Reminders')}
    <form class="card stack" data-form="saveReminders">
      <p class="small muted" style="margin:0">Sent to every phone with notifications on, at 8am.</p>
      <div class="two"><label class="field">First reminder<span class="hint">Days before, if nothing's bought</span><input type="number" name="first" min="0" max="60" value="${esc(r.first)}"></label>
      <label class="field">Second reminder<span class="hint">Days before, if still nothing</span><input type="number" name="second" min="0" max="30" value="${esc(r.second)}"></label></div>
      <label class="row nowrap"><input type="checkbox" class="check" name="dayOf" ${r.dayOf ? 'checked' : ''}> On the day: remember the present and card</label>
      <p class="tiny muted">You'll also be reminded to reply to an invite two days before its reply-by date.</p>
      <button class="btn small primary">Save</button></form>

    ${section('Notifications')}
    <div class="card"><div class="row nowrap" style="gap:12px;align-items:flex-start"><span class="tile sm other">${icon('bell')}</span><span class="grow">
      <b>Notifications on this phone</b><p class="small muted" style="margin:2px 0 0">The reminders above. Each of you turns it on on your own phone.</p></span></div>
      <div style="margin-top:12px">${S.notificationsOn() ? `<div class="row"><span class="chip ok">${icon('check')} On for this phone</span><span class="spacer"></span><button class="btn small outline" data-act="notifyOff">Turn off</button></div>` : `<button class="btn tonal block" data-act="notifyOn">${icon('bell')} Turn on notifications</button>`}</div></div>

    ${section('Phone calendar')}
    <div class="card"><p class="small muted" style="margin-top:0">Every party, kept up to date in Google Calendar (or any calendar app). In Google Calendar on a computer: Other calendars › + › From URL, and paste this link. It shows on your phones after that. Anyone with the link can see the parties, so keep it to yourselves.</p>
      <input type="text" readonly value="${esc(feed)}" onclick="this.select()">
      <div class="row" style="margin-top:10px"><button class="btn small tonal" data-act="copy" data-id="${esc(feed)}">${icon('link')} Copy link</button><a class="btn small ghost" href="${esc(feed.replace(/^https?:/, 'webcal:'))}">Open in calendar app</a></div></div>

    ${section('Account')}
    <div class="card"><div class="row nowrap"><span class="grow small"><span class="muted">Signed in as</span><br><b>${esc(st.user.email)}</b></span><button class="btn outline" data-act="signOut">${icon('logout')} Sign out</button></div></div>`;
};

const kids = () => (st.household.children || []).map(c => ({ ...c }));
actions.saveChild = f => {
  const list = kids(); const c = list[Number(f.dataset.id)]; if (!c) return;
  const name = f.name.value.trim().slice(0, 40); if (!name) return;
  Object.assign(c, { name, gender: f.gender.value, birthday: isDay(f.birthday.value) ? f.birthday.value : '' });
  run(() => S.updateH([], { children: list }), 'Saved');
};
actions.addChild = () => {
  const name = prompt('Their name?'); if (!name?.trim()) return;
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'child';
  const list = kids(); let id = base; for (let n = 2; list.some(c => c.id === id); n++) id = `${base}-${n}`;
  run(() => S.updateH([], { children: [...list, { id, name: name.trim(), gender: 'girl', age: null }] }), 'Added. Set their birthday below.');
};
actions.delChild = el => {
  const list = kids(); const c = list[Number(el.dataset.id)];
  if (!c || !confirm(`Remove ${c.name}? Their parties stay, but won't show whose they are.`)) return;
  run(() => S.updateH([], { children: list.filter((_, i) => i !== Number(el.dataset.id)) }));
};
actions.saveBudget = f => { const b = Number(f.budget.value); if (!(b > 0)) return; run(() => S.updateH([], { budget: b }), 'Saved'); };
actions.saveReminders = f => run(() => S.updateH([], { reminders: { first: Math.max(0, Number(f.first.value) || 0), second: Math.max(0, Number(f.second.value) || 0), dayOf: f.dayOf.checked } }), 'Saved');
actions.notifyOn = () => run(async () => { await S.enableNotifications(); render(); }, 'Notifications are on for this phone');
actions.notifyOff = () => run(async () => { await S.disableNotifications(); render(); }, 'Notifications are off for this phone');
actions.share = el => {
  const url = el.dataset.id;
  if (navigator.share) navigator.share({ title: 'Party Presents', text: 'Join us on Party Presents', url }).catch(() => {});
  else navigator.clipboard?.writeText(url).then(() => toast('Link copied'));
};
actions.copy = el => navigator.clipboard?.writeText(el.dataset.id).then(() => toast('Copied'), () => toast('Couldn\'t copy. Select the link and copy it.'));
actions.newInvite = () => run(S.newInviteCode, 'New link made');
actions.signOut = () => run(S.signOut);
