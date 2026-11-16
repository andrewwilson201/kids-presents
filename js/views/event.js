// One party: the details, whether you're going, and the present: ideas, who's
// getting it, bought, wrapped. Claiming a present is a transaction (store.js
// claimPresent), so you can't both end up buying one.
import * as S from '../store.js?v=2';
import { matchIdeas, pastPresents, ageOn, childrenFor, fmt12, shopLinks, needsPresent, presentSorted, daysBetween, isDay } from '../gifts.js?v=2';
import { icon, childBadge } from '../ui.js?v=2';
import { st, esc, head, section, run, toast, money, fmtLong, today, routes, actions, arg, render } from '../core.js?v=2';
import { children, eventTitle, partyTitle, sibs, whenWords, presentChip, budgetOf, firstName, priceText } from '../events.js?v=2';

const ev = () => st.events.find(x => x.id === arg);

// The ideas question for a party. A friend's age is usually our child's age, if the invite didn't say.
export function queryFor(e) {
  const kid = childrenFor(e, children())[0];
  const age = e.friendAge ? Number(e.friendAge) : kid ? ageOn(kid, isDay(e.date) ? e.date : today()) : null;
  return { budget: budgetOf(e), gender: e.friendGender || '', age, interests: e.interests || '' };
}
const given = e => new Set(pastPresents(st.events, e.friend, e.id).map(p => p.ideaId).filter(Boolean));

let invitePics = {}; // scan id -> image, loaded when asked for
routes.event = () => {
  const e = ev();
  if (!e) return `${head('Not found')}<p class="muted">That party has been deleted.</p><a class="btn" href="#/home">Back to parties</a>`;
  const days = isDay(e.date) ? daysBetween(today(), e.date) : null;
  const time = e.start ? `${fmt12(e.start)}${e.end ? ` to ${fmt12(e.end)}` : ''}` : '';
  const map = e.address || e.venue ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([e.venue, e.address].filter(Boolean).join(', '))}` : '';
  const before = pastPresents(st.events, e.friend, e.id, e.date);
  const joint = sibs(e);
  return `${head(esc(partyTitle(e)), { eyebrow: childBadge(children(), e.child), sub: isDay(e.date) ? `${fmtLong(e.date)}${time ? `, ${time}` : ''} · ${whenWords(e.date)}` : 'No date yet' })}
    ${e.needsCheck ? `<div class="notice warn">${icon('info')}<span class="grow"><b>Read from an invite picture</b><br>Check the details are right${e.child ? '' : ', and say who\'s invited'}.</span></div>
      <div class="row" style="margin:-4px 0 16px">${e.child ? `<button class="btn primary small" data-act="looksRight">${icon('check')} Looks right</button>` : ''}<a class="btn tonal small" href="#/edit/${esc(e.id)}">${icon('edit')} Change details</a></div>` : ''}
    ${!e.child ? `<div class="card"><b>Who's invited?</b><div class="row" style="margin-top:10px">${children().map(c => `<button class="btn tonal" data-act="setChild" data-id="${esc(c.id)}">${esc(c.name)}</button>`).join('')}${children().length > 1 ? '<button class="btn tonal" data-act="setChild" data-id="both">Both</button>' : ''}</div></div>` : ''}

    ${joint.length > 1 ? `<p class="small muted" style="margin:18px 4px 6px">A joint party: each birthday child has their own present.</p>
      <div class="seg joint">${joint.map(x => `<a class="${x.id === e.id ? 'on' : ''}" href="#/event/${esc(x.id)}">${esc(firstName(x.friend) || '?')}${presentSorted(x) ? ` ${icon('check')}` : ''}</a>`).join('')}</div>` : ''}
    ${presentCard(e, days, joint.length > 1 ? `${esc(firstName(e.friend))}'s present` : 'The present')}

    ${section('Details', { right: `<a class="btn small ghost" href="#/edit/${esc(e.id)}">${icon('edit')} Change</a>` })}
    <ul class="list card facts">
      ${isDay(e.date) ? `<li>${icon('calendar')}<span class="grow"><b>${esc(fmtLong(e.date))}</b>${time ? `<br><span class="muted">${esc(time)}</span>` : ''}</span></li>` : ''}
      ${e.venue || e.address ? `<li>${icon('pin')}<span class="grow">${e.venue ? `<b>${esc(e.venue)}</b>` : ''}${e.address ? `<br><span class="muted">${esc(e.address)}</span>` : ''}</span>${map ? `<a class="btn small ghost" href="${esc(map)}" target="_blank" rel="noopener">Map</a>` : ''}</li>` : ''}
      ${e.friendAge || e.friendGender || e.interests ? `<li>${icon('heart')}<span class="grow">${esc([e.friendAge ? `Turning ${e.friendAge}` : '', e.friendGender].filter(Boolean).join(', '))}${e.interests ? `<br><span class="muted">Into ${esc(e.interests)}</span>` : ''}</span></li>` : ''}
      ${e.theme ? `<li>${icon('sparkle')}<span class="grow">Theme: ${esc(e.theme)}</span></li>` : ''}
      ${e.notes ? `<li>${icon('info')}<span class="grow">${esc(e.notes)}</span></li>` : ''}
      ${e.kind !== 'birthday' ? `<li>${icon('message')}<span class="grow"><b>${e.rsvp === 'yes' ? 'Going' : e.rsvp === 'no' ? 'Not going' : 'Not replied yet'}</b>${e.rsvpBy || e.contact ? `<br><span class="muted">${esc([e.rsvpBy ? `Reply by ${fmtLong(e.rsvpBy)}` : '', e.contact].filter(Boolean).join(' · '))}</span>` : ''}</span>
        <span class="seg small"><button class="${e.rsvp === 'yes' ? 'on' : ''}" data-act="rsvp" data-id="yes">Going</button><button class="${e.rsvp === 'no' ? 'on' : ''}" data-act="rsvp" data-id="no">Can't go</button></span></li>` : ''}
    </ul>
    ${e.scanId ? `<details class="disclosure card flush" data-toggle="invite" data-scan="${esc(e.scanId)}"><summary>${icon('image')} The invite picture</summary>
      <div class="invite-pic">${invitePics[e.scanId] ? `<img src="${esc(invitePics[e.scanId])}" alt="The invite">` : '<span class="spinner"></span>'}</div></details>` : ''}

    ${before.length ? `${section(`Given to ${esc(firstName(e.friend))} before`)}<ul class="list card">${before.map(p => `<li>${icon('gift')}<span class="grow">${esc(p.name)}<span class="meta">${esc(fmtLong(p.date))}</span></span></li>`).join('')}</ul>` : ''}

    <div class="row" style="margin-top:28px">
      ${e.cancelled ? '<button class="btn ghost small" data-act="uncancel">It\'s back on</button>' : '<button class="btn ghost small" data-act="cancelEvent">Party cancelled</button>'}
      ${!e.noPresent ? '<button class="btn ghost small" data-act="noPresent">No present needed</button>' : '<button class="btn ghost small" data-act="noPresent">A present is needed</button>'}
      <span class="spacer"></span><button class="btn ghost small danger" data-act="deleteEvent">${icon('trash')} Delete</button></div>`;
};

function presentCard(e, days, title) {
  const p = e.present || {};
  const mine = p.by?.uid === st.user.uid;
  const by = p.by?.name ? firstName(p.by.name) : 'Someone';
  const links = name => `<details class="mini shops"><summary>Find it in a shop</summary><div class="row">${shopLinks(name).map(l => `<a class="chip link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)} ${icon('external')}</a>`).join('')}</div></details>`;
  if (!needsPresent(e)) return `<div class="card soft">${presentChip(e)}</div>`;
  if (p.state === 'bought' || p.state === 'wrapped') {
    return `${section(title)}<div class="card present done"><div class="row nowrap" style="gap:12px"><span class="tile veg">${icon('gift')}</span>
      <span class="grow"><b>${esc(p.name || 'A present')}</b><br><span class="small muted">Bought by ${mine ? 'you' : esc(by)}${p.price ? `, ${money(p.price)}` : ''}${p.where ? ` from ${esc(p.where)}` : ''}${p.cupboardId ? ' (from the cupboard)' : ''}</span></span></div>
      <div class="checks"><label class="row nowrap"><input type="checkbox" class="check" data-change="wrapped" ${p.state === 'wrapped' ? 'checked' : ''}> Wrapped</label>
      <label class="row nowrap"><input type="checkbox" class="check" data-change="card" ${e.card ? 'checked' : ''}> Card written</label></div>
      <button class="btn ghost small" data-act="undoPresent">Undo</button></div>`;
  }
  if (p.state === 'chosen') {
    return `${section(title)}<div class="card present chosen"><div class="row nowrap" style="gap:12px"><span class="tile other">${icon('bag')}</span>
      <span class="grow"><b>${esc(p.name || 'A present')}</b><br><span class="small muted">${mine ? 'You said you\'d get this' : `${esc(by)} is getting this`}${p.price ? `, about ${money(p.price)}` : ''}</span></span></div>
      ${mine ? `<form data-form="bought" class="row bought-form"><input type="text" name="where" placeholder="Where from (optional)" aria-label="Where from" data-keep="where"><input type="number" name="price" placeholder="£" aria-label="Price" inputmode="decimal" style="max-width:90px" value="${esc(p.price || '')}"><button class="btn primary">${icon('check')} Bought it</button></form>
        ${links(p.name || '')}<button class="btn ghost small" data-act="undoPresent">Change my mind</button>`
        : `<div class="row"><button class="btn ghost small" data-act="takeOver">I'll get it instead</button></div>`}</div>`;
  }
  // Nothing yet: ideas that fit, the cupboard, or type your own.
  const q = queryFor(e);
  const ideas = matchIdeas(st.ideas, q, { limit: 5, given: given(e) });
  const inCupboard = st.cupboard.filter(c => !c.usedFor && (!c.for || c.for === 'any' || !q.gender || c.for === q.gender) && (q.age == null || ((c.ageMin ?? 0) <= q.age && (c.ageMax ?? 99) >= q.age)));
  const ask = st.asks.find(a => a.eventId === e.id);
  const urgent = days != null && days <= (st.household?.reminders?.second ?? 3);
  return `${section(title)}<div class="card present">
    <p class="small ${urgent ? 'danger-text' : 'muted'}" style="margin:0 0 12px">${urgent ? `${icon('alert')} ` : ''}Nobody's getting one yet. ${q.age ? `Ideas for a ${q.age}-year-old${q.gender ? ` ${q.gender}` : ''}` : 'Ideas'} up to ${money(q.budget)}${q.interests ? `, into ${esc(q.interests)}` : ''}:</p>
    ${inCupboard.length ? `<p class="small" style="margin:0 0 6px"><b>In the cupboard</b></p><ul class="list compact ideas">${inCupboard.map(c => `<li><span class="grow"><span class="name">${esc(c.name)}</span><span class="meta">${esc(priceText(c))}</span></span><button class="btn small primary" data-act="useCupboard" data-id="${esc(c.id)}">Use this</button></li>`).join('')}</ul>` : ''}
    <ul class="list compact ideas">${ideas.map(i => `<li><span class="grow"><span class="name">${esc(i.name)}</span><span class="meta">${esc([priceText(i), i.description].filter(Boolean).join(' · '))}</span></span><button class="btn small tonal" data-act="chooseIdea" data-id="${esc(i.id)}">I'll get this</button></li>`).join('') || '<li class="muted small">No saved ideas fit. Try Claude, or widen the budget.</li>'}</ul>
    <div class="row" style="margin:10px 0 14px">
      ${ask?.state === 'requested' ? `<a class="btn outline" href="#/ideas/${esc(e.id)}"><span class="spinner"></span> Claude is thinking…</a>` : `<button class="btn outline" data-act="askClaude">${icon('sparkle')} Ask Claude for ideas</button>`}
      <a class="btn ghost" href="#/ideas/${esc(e.id)}">More ideas</a></div>
    <form data-form="ownPresent" class="own"><label class="field">Or something else<span class="hint">Say what you'll get, so the other person knows.</span>
      <div class="row nowrap"><input type="text" name="name" placeholder="A Lego set" required data-keep="own.name"><input type="number" name="price" placeholder="£" inputmode="decimal" style="max-width:80px" data-keep="own.price"></div></label>
      <div class="row"><button class="btn tonal" name="how" value="chosen">I'll get this</button><button class="btn ghost" name="how" value="bought">Already bought it</button></div></form>
  </div>`;
}

// Load the invite picture when its section is opened.
document.addEventListener('toggle', ev2 => {
  const d = ev2.target;
  if (!d.dataset?.scan || !d.open || invitePics[d.dataset.scan]) return;
  S.getScan(d.dataset.scan).then(s => { invitePics[d.dataset.scan] = s?.image || ''; render(); }).catch(() => {});
}, true);

const claim = (present, done) => run(async () => {
  try { await S.claimPresent(arg, present); }
  catch (err) { if (err.code === 'claimed') { toast(err.message); return; } throw err; }
  if (done) toast(done);
});
actions.chooseIdea = el => {
  const i = st.ideas.find(x => x.id === el.dataset.id); if (!i) return;
  claim({ state: 'chosen', name: i.name, ideaId: i.id, price: i.price || null }, 'Noted. You\'re getting it.');
};
actions.ownPresent = (f, e) => {
  const name = f.name.value.trim().slice(0, 120); if (!name) return;
  const how = e.submitter?.value || 'chosen';
  claim({ state: how, name, ideaId: null, price: Number(f.price.value) || null }, how === 'bought' ? 'Marked as bought' : 'Noted. You\'re getting it.');
};
actions.bought = f => {
  const e = ev(); const p = e?.present || {};
  claim({ state: 'bought', where: f.where.value.trim().slice(0, 60), price: Number(f.price.value) || p.price || null }, 'Bought. Nice one.');
  if (p.ideaId) { const i = st.ideas.find(x => x.id === p.ideaId); if (i) S.updateH(['ideas', i.id], { given: (i.given || 0) + 1, lastGiven: today() }).catch(() => {}); }
};
actions.takeOver = () => { if (confirm('Take this over? They\'ll see that you\'re getting it now.')) claim({ state: 'chosen', takeOver: true }, 'You\'re getting it now'); };
actions.wrapped = el => claim({ state: el.checked ? 'wrapped' : 'bought' });
actions.card = el => run(() => S.updateH(['events', arg], { card: el.checked }));
actions.undoPresent = () => run(async () => {
  const e = ev(); const cid = e?.present?.cupboardId;
  await S.updateH(['events', arg], { present: S.deleteField() });
  if (cid) await S.updateH(['cupboard', cid], { usedFor: null });
});
actions.useCupboard = el => {
  const c = st.cupboard.find(x => x.id === el.dataset.id); if (!c) return;
  run(async () => {
    try { await S.claimPresent(arg, { state: 'bought', name: c.name, price: c.price || null, cupboardId: c.id, ideaId: c.ideaId || null }); }
    catch (err) { if (err.code === 'claimed') { toast(err.message); return; } throw err; }
    await S.updateH(['cupboard', c.id], { usedFor: arg });
  }, 'Taken from the cupboard');
};
actions.askClaude = () => {
  const e = ev();
  run(async () => {
    await S.addH(['asks'], { ...queryFor(e), friend: e.friend || '', eventId: e.id, state: 'requested', by: S.me(), createdAt: S.serverTimestamp() });
    location.hash = `#/ideas/${e.id}`;
  });
};
// The party's own details are the same for every birthday child of a joint party.
const updateParty = data => S.batchH(sibs(ev()).map(x => ['update', ['events', x.id], data]));
actions.looksRight = () => run(() => updateParty({ needsCheck: false }), 'Thanks');
actions.setChild = el => run(() => updateParty({ child: el.dataset.id }));
actions.rsvp = el => { const e = ev(); run(() => updateParty({ rsvp: e.rsvp === el.dataset.id ? '' : el.dataset.id })); };
actions.cancelEvent = () => run(() => updateParty({ cancelled: true }), 'Marked as cancelled');
actions.uncancel = () => run(() => updateParty({ cancelled: false }));
actions.noPresent = () => { const e = ev(); run(() => S.updateH(['events', arg], { noPresent: !e.noPresent })); };
actions.deleteEvent = () => {
  const e = ev();
  const all = sibs(e);
  if (!confirm(`Delete ${partyTitle(e)}?${all.length > 1 ? ' That\'s the whole party. To take one child off it, use Change instead.' : ''} This can't be undone.`)) return;
  run(async () => {
    for (const x of all) if (x.present?.cupboardId) await S.updateH(['cupboard', x.present.cupboardId], { usedFor: null }).catch(() => {});
    await S.batchH(all.map(x => ['delete', ['events', x.id]]));
    location.hash = '#/home';
  }, 'Deleted');
};
