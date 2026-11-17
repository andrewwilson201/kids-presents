// One party: the details, whether you're going, and the present: real products
// Claude found in the shops, ideas, who's getting it, bought, wrapped. Claiming a present is a transaction (store.js
// claimPresent), so you can't both end up buying one. Your own choice can be the
// exact thing: paste its shop link and the name, price and picture fill in. What
// you buy is saved to the ideas, so it's there to suggest next time.
import * as S from '../store.js?v=10';
import { matchIdeas, pastPresents, ageOn, childrenFor, fmt12, shopLinks, needsPresent, presentSorted, daysBetween, isDay, nameKey, shopName } from '../gifts.js?v=10';
import { icon, childBadge, thumb } from '../ui.js?v=10';
import { st, esc, head, section, run, toast, money, fmtLong, fmtDay, today, routes, actions, arg, route, hooks, render, busy, failed, keep, hostOf } from '../core.js?v=10';
import { children, eventTitle, partyTitle, sibs, whenWords, presentChip, budgetOf, firstName, priceText } from '../events.js?v=10';

const ev = () => st.events.find(x => x.id === arg);

// The ideas question for a party. A friend's age is usually our child's age, if the invite didn't say.
export function queryFor(e) {
  const kid = childrenFor(e, children())[0];
  const age = e.friendAge ? Number(e.friendAge) : kid ? ageOn(kid, isDay(e.date) ? e.date : today()) : null;
  return { budget: budgetOf(e), gender: e.friendGender || '', age, interests: e.interests || '' };
}
const given = e => new Set(pastPresents(st.events, e.friend, e.id, null, e.child).map(p => p.ideaId).filter(Boolean));
const safeUrl = u => (/^https:\/\//.test(u || '') ? u : '');

let invitePics = {}; // scan id -> image ('none' for a text invite), loaded when asked for
routes.event = () => {
  const e = ev();
  if (!e) return `${head('Not found')}<p class="muted">That party has been deleted.</p><a class="btn" href="#/home">Back to parties</a>`;
  const days = isDay(e.date) ? daysBetween(today(), e.date) : null;
  const time = e.start ? `${fmt12(e.start)}${e.end ? ` to ${fmt12(e.end)}` : ''}` : '';
  const map = e.address || e.venue ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([e.venue, e.address].filter(Boolean).join(', '))}` : '';
  const before = pastPresents(st.events, e.friend, e.id, e.date, e.child);
  const joint = sibs(e);
  const pic = invitePics[e.scanId];
  return `${head(esc(partyTitle(e)), { eyebrow: childBadge(children(), e.child), sub: isDay(e.date) ? `${fmtLong(e.date)}${time ? `, ${time}` : ''} · ${whenWords(e.date)}` : 'No date yet' })}
    ${e.needsCheck ? `<div class="notice warn">${icon('info')}<span class="grow"><b>Read from an invite</b><br>Check the details are right${e.child ? '' : ', and say who\'s invited'}.${e.readProblem ? ` Claude wasn't sure: ${esc(e.readProblem)}` : ''}</span></div>
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
    ${e.scanId ? `<details class="disclosure card flush" data-toggle="invite" data-scan="${esc(e.scanId)}"${keep.invite ? ' open' : ''}><summary>${icon('image')} The invite</summary>
      <div class="invite-pic">${pic === 'none' ? '<p class="small muted" style="padding:0 16px">This one came as a message, so there\'s no picture.</p>' : pic ? `<img src="${esc(pic)}" alt="The invite">` : '<span class="spinner"></span>'}</div></details>` : ''}

    ${before.length ? `${section(`Given to ${esc(firstName(e.friend))} before`)}<ul class="list card">${before.map(p => `<li>${icon('gift')}<span class="grow">${esc(p.name)}<span class="meta">${esc(fmtDay(p.date, { day: 'numeric', month: 'long', year: 'numeric' }))}</span></span></li>`).join('')}</ul>` : ''}

    <details class="disclosure card flush more" data-toggle="more"${keep.more ? ' open' : ''}><summary>More</summary><div class="stack" style="padding:14px 16px">
      ${e.cancelled ? '<button class="btn outline block" data-act="uncancel">The party is back on</button>' : '<button class="btn outline block" data-act="cancelEvent">The party is cancelled</button>'}
      <button class="btn outline block" data-act="noPresent">${e.noPresent ? 'A present is needed after all' : 'No present needed for this one'}</button>
      <button class="btn outline block danger" data-act="deleteEvent">${icon('trash')} Delete this party</button></div></details>`;
};

// ---------- the exact present, from a shop link ----------
// Pasting a link into a present form asks the functions what it is (an ask of
// kind 'link': functions/link.mjs), and the answer fills in the name and price.
const urlIn = s => String(s || '').match(/https:\/\/[^\s<>"']+/)?.[0] || '';
const linkAsk = e => st.asks.find(a => a.kind === 'link' && a.eventId === e.id && a.url === urlIn(keep['own.url']));
const linkInfo = e => { const a = linkAsk(e); return a?.state === 'done' ? a.product : null; };
const linkBox = () => `<input type="text" name="url" inputmode="url" autocapitalize="off" autocomplete="off" placeholder="Paste a link from a shop (optional)" aria-label="Link to it in a shop" data-keep="own.url">`;
function linkStatus(e) {
  const a = linkAsk(e);
  if (busy(a)) return '<p class="small muted link-status"><span class="spinner"></span> Reading the link…</p>';
  if (failed(a)) return `<p class="small muted link-status">Couldn't read that link (${esc(a.message || 'it took too long')}). Type what it is; the link is still kept.</p>`;
  if (a?.product) return `<p class="small muted link-status row nowrap">${thumb(a.product.image)}<span class="grow">Found at ${esc(a.product.shop)}. Check the name and price are right.</span></p>`;
  return '';
}
let linkTimer = null;
document.addEventListener('input', ev2 => {
  const el = ev2.target;
  if (!el.matches?.('.present input[name=url]')) return;
  clearTimeout(linkTimer);
  const url = urlIn(el.value), id = arg;
  if (!/^https:\/\/[^\s/]+\.[^\s/]+\/\S+/.test(url)) return;
  linkTimer = setTimeout(() => {
    if (route !== 'event' || arg !== id || st.asks.some(a => a.kind === 'link' && a.eventId === id && a.url === url)) return;
    run(() => S.addH(['asks'], { kind: 'link', url, eventId: id, state: 'requested', by: S.me(), createdAt: S.serverTimestamp() }));
  }, 700);
});
// When the answer arrives, put it in the form (once), still editable.
const applied = new Set();
hooks.rendered.push(() => {
  const e = route === 'event' ? ev() : null; const a = e && linkAsk(e);
  if (a?.state !== 'done' || !a.product || applied.has(a.id)) return;
  applied.add(a.id);
  keep['own.name'] = a.product.title;
  if (a.product.price) keep['own.price'] = String(a.product.price);
});
// What a present form says the present is: { name, price, url, shop, image }.
function formPresent(f, e, was = {}) {
  const url = was.url || urlIn(f.url?.value);
  const info = linkInfo(e);
  return { name: (f.name?.value || '').trim().slice(0, 120) || was.name || '', price: Number(f.price.value) || was.price || null,
    ...(url ? { url, shop: info?.shop || (was.shop && was.shop !== hostOf(url) ? was.shop : shopName(url)), image: was.image || info?.image || '' } : {}) };
}
// Bought: claim it, and keep it in the ideas so it's there to suggest another time.
const buy = present => run(async () => {
  const e = ev();
  const idea = present.ideaId ? st.ideas.find(i => i.id === present.ideaId) : st.ideas.find(i => (present.url && i.url === present.url) || nameKey(i.name) === nameKey(present.name));
  const ideaId = idea?.id || S.newId('ideas');
  try { await S.claimPresent(arg, { ...present, state: 'bought', ideaId }); }
  catch (err) { if (err.code === 'claimed') { toast(err.message); return; } throw err; }
  const link = present.url ? { url: present.url, shop: present.shop || '', image: present.image || '' } : {};
  if (idea) await S.updateH(['ideas', idea.id], { given: (idea.given || 0) + 1, lastGiven: today(), ...(idea.url ? {} : link) });
  else {
    const q = queryFor(e);
    await S.setH(['ideas', ideaId], { name: present.name, price: present.price || null, ...link, ageMin: q.age ? Math.max(1, q.age - 2) : null, ageMax: q.age ? q.age + 2 : null, for: q.gender || 'any',
      interests: String(e.interests || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean).slice(0, 6), category: 'Bought before', source: 'bought', given: 1, lastGiven: today(), by: S.me(), createdAt: S.serverTimestamp() }, false);
  }
  toast(idea ? 'Bought. Nice one.' : 'Bought. Saved to your ideas for next time.');
});

const shopChips = name => `<div class="row shops"><span class="small muted">Search for it:</span>${shopLinks(name).map(l => `<a class="chip link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)} ${icon('external')}</a>`).join('')}</div>`;
const productLink = p => (safeUrl(p.url) ? `<a class="btn small tonal" href="${esc(p.url)}" target="_blank" rel="noopener">${icon('external')} Open at ${esc(shopName(p.url) === 'Amazon' ? 'Amazon' : p.shop || shopName(p.url))}</a>` : '');

function presentCard(e, days, title) {
  const p = e.present || {};
  const mine = p.by?.uid === st.user.uid;
  const by = p.by?.name ? firstName(p.by.name) : 'Someone';
  if (!needsPresent(e)) return `<div class="card soft">${presentChip(e)}</div>`;
  if (p.state === 'bought' || p.state === 'wrapped') {
    return `${section(title)}<div class="card present done"><div class="row nowrap" style="gap:12px">${thumb(p.image) || `<span class="tile veg">${icon('gift')}</span>`}
      <span class="grow"><b>${esc(p.name || 'A present')}</b><br><span class="small muted">Bought by ${mine ? 'you' : esc(by)}${p.price ? `, ${money(p.price)}` : ''}${p.where ? ` from ${esc(p.where)}` : ''}${p.cupboardId ? ' (from the cupboard)' : ''}</span></span></div>
      ${safeUrl(p.url) ? `<div class="row shops">${productLink(p)}</div>` : ''}
      <div class="checks"><label class="row nowrap"><input type="checkbox" class="check" data-change="wrapped" ${p.state === 'wrapped' ? 'checked' : ''}> Wrapped, with a card</label></div>
      ${p.state === 'bought' ? `<p class="small ${days != null && days <= 2 ? 'danger-text' : 'muted'}" style="margin:-4px 0 10px">${days != null && days <= 2 ? `${icon('alert')} ` : ''}Tick it once it's wrapped and the card is written. Until then it shows as needing wrapping, and you'll get a reminder the day before.</p>` : ''}
      <button class="btn ghost small" data-act="undoPresent">Undo</button></div>`;
  }
  if (p.state === 'chosen') {
    return `${section(title)}<div class="card present chosen"><div class="row nowrap" style="gap:12px">${thumb(p.image) || `<span class="tile other">${icon('bag')}</span>`}
      <span class="grow"><b>${esc(p.name || 'A present')}</b><br><span class="small muted">${mine ? 'You said you\'d get this' : `${esc(by)} is getting this`}${p.price ? `, about ${money(p.price)}` : ''}</span></span></div>
      ${safeUrl(p.url) ? `<div class="row shops">${productLink(p)}</div>` : mine ? shopChips(p.name || '') : ''}
      ${mine ? `<form data-form="bought" class="stack bought-form">
        <label class="field">When you've bought it<span class="hint">${p.url ? 'Change the name if you got something different.' : 'Make it exact if you like: paste its link and the name and price fill in.'}</span>
        <input type="text" name="name" aria-label="What it is" data-keep="own.name" value="${esc(p.name || '')}"></label>
        ${p.url ? '' : `${linkBox()}${linkStatus(e)}`}
        <div class="row nowrap"><input type="text" name="where" placeholder="Where from" aria-label="Where from" data-keep="where" value="${esc(p.shop || '')}"><input type="number" name="price" placeholder="£" aria-label="Price" inputmode="decimal" step="any" style="max-width:90px" data-keep="own.price" value="${esc(p.price || '')}"></div>
        <button class="btn primary">${icon('check')} Bought it</button></form>
        <button class="btn ghost small" data-act="undoPresent">Change my mind</button>`
        : `<div class="row"><button class="btn ghost small" data-act="takeOver">I'll get it instead</button></div>`}</div>`;
  }
  // Nothing yet: the cupboard, real products from the shops, ideas that fit, or type your own.
  const q = queryFor(e);
  const ideas = matchIdeas(st.ideas, q, { limit: 4, given: given(e) });
  const inCupboard = st.cupboard.filter(c => !c.usedFor && (!c.for || c.for === 'any' || !q.gender || c.for === q.gender) && (q.age == null || ((c.ageMin ?? 0) <= q.age && (c.ageMax ?? 99) >= q.age)));
  const ask = st.asks.find(a => a.eventId === e.id && a.kind === 'products');
  const found = e.products?.items || [];
  const urgent = days != null && days <= (st.household?.reminders?.second ?? 3);
  return `${section(title)}<div class="card present">
    <p class="small ${urgent ? 'danger-text' : 'muted'}" style="margin:0 0 12px">${urgent ? `${icon('alert')} ` : ''}Nobody's getting one yet. ${q.age ? `For a ${q.age}-year-old${q.gender ? ` ${q.gender}` : ''}` : 'Presents'} up to ${money(q.budget)}${q.interests ? `, into ${esc(q.interests)}` : ''}.</p>
    ${inCupboard.length ? `<p class="small" style="margin:0 0 6px"><b>In the cupboard</b></p><ul class="list compact ideas">${inCupboard.map(c => `<li><span class="grow"><span class="name">${esc(c.name)}</span><span class="meta">${esc(priceText(c))}</span></span><button class="btn small primary" data-act="useCupboard" data-id="${esc(c.id)}">Use this</button></li>`).join('')}</ul>` : ''}
    ${found.length ? `<p class="small" style="margin:0 0 6px"><b>In the shops</b> <span class="muted">as found ${esc(whenWords(String(e.products.at || '').slice(0, 10) || today()))}. Check the price before you buy.</span></p>
      <ul class="list compact ideas products">${found.map((x, n) => `<li><span class="grow"><a class="name" href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener">${esc(x.title)} ${icon('external')}</a>
        <span class="meta">${esc([x.price ? money(x.price) : '', x.shop].filter(Boolean).join(' at '))}</span>${x.why ? `<span class="meta desc">${esc(x.why)}</span>` : ''}</span>
        <button class="btn small tonal" data-act="chooseProduct" data-id="${n}">I'll get this</button></li>`).join('')}</ul>` : ''}
    ${busy(ask) ? `<div class="notice info"><span class="spinner"></span><span class="grow"><b>Claude is looking in the shops…</b><br>This takes a minute or two. You can leave this page; they'll be here when you're back.</span></div>`
      : `${failed(ask) ? `<p class="small danger-text">Claude couldn't search the shops: ${esc(ask.message || 'it took too long')}. Try again.</p>` : ''}
      <div class="row" style="margin:4px 0 14px"><button class="btn primary" data-act="findProducts">${icon('search')} ${found.length ? 'Look in the shops again' : 'Find real presents in the shops'}</button></div>`}
    <p class="small" style="margin:0 0 6px"><b>Ideas</b></p>
    <ul class="list compact ideas types">${ideas.map(i => `<li><span class="grow"><span class="name">${esc(i.name)}</span><span class="meta">${esc([priceText(i), i.description].filter(Boolean).join(' · '))}</span></span><button class="btn small tonal" data-act="chooseIdea" data-id="${esc(i.id)}">I'll get this</button></li>`).join('') || '<li class="muted small">No saved ideas fit. Try a bigger budget.</li>'}</ul>
    <div class="row" style="margin:10px 0 14px"><a class="btn outline" href="#/ideas/${esc(e.id)}">${icon('gift')} More ideas</a></div>
    <form data-form="ownPresent" class="own stack"><label class="field">Or something else<span class="hint">Paste a link to the exact thing and its name and price fill in. Or just type what it is.</span>
      ${linkBox()}</label>${linkStatus(e)}
      <div class="row nowrap"><input type="text" name="name" placeholder="A Lego set" aria-label="What it is" required data-keep="own.name"><input type="number" name="price" placeholder="£" aria-label="Price" inputmode="decimal" step="any" style="max-width:80px" data-keep="own.price"></div>
      <div class="row"><button class="btn tonal" name="how" value="chosen">I'll get this</button><button class="btn ghost" name="how" value="bought">Already bought it</button></div></form>
  </div>`;
}

// Load the invite picture when its section is opened.
document.addEventListener('toggle', ev2 => {
  const d = ev2.target;
  if (!d.dataset?.scan || !d.open || invitePics[d.dataset.scan]) return;
  S.getScanImage(d.dataset.scan).then(img => { invitePics[d.dataset.scan] = img || 'none'; render(); }).catch(() => {});
}, true);

const claim = (present, done) => run(async () => {
  try { await S.claimPresent(arg, present); }
  catch (err) { if (err.code === 'claimed') { toast(err.message); return; } throw err; }
  if (done) toast(done);
});
actions.chooseIdea = el => {
  const i = st.ideas.find(x => x.id === el.dataset.id); if (!i) return;
  claim({ state: 'chosen', name: i.name, ideaId: i.id, price: i.price || null, ...(i.url ? { url: i.url, shop: i.shop || '', image: i.image || '' } : {}) }, 'Noted. You\'re getting it.');
};
actions.chooseProduct = el => {
  const x = ev()?.products?.items?.[Number(el.dataset.id)]; if (!x) return;
  claim({ state: 'chosen', name: x.title, ideaId: null, price: x.price || null, url: safeUrl(x.url), shop: x.shop || '' }, 'Noted. You\'re getting it.');
};
actions.ownPresent = (f, e) => {
  const present = formPresent(f, ev()); if (!present.name) return;
  if (e.submitter?.value === 'bought') buy(present);
  else claim({ state: 'chosen', ideaId: null, ...present }, 'Noted. You\'re getting it.');
};
actions.bought = f => {
  const p = ev()?.present || {};
  const present = formPresent(f, ev(), p);
  // A different thing from the idea that was picked is its own entry in the ideas.
  buy({ ...present, where: f.where.value.trim().slice(0, 60), ideaId: p.ideaId && nameKey(present.name) === nameKey(p.name) ? p.ideaId : null });
};
actions.takeOver = () => { if (confirm('Take this over? They\'ll see that you\'re getting it now.')) claim({ state: 'chosen', takeOver: true }, 'You\'re getting it now'); };
actions.wrapped = el => claim({ state: el.checked ? 'wrapped' : 'bought' });
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
// Ask Claude to search the shops for real products for this party (functions/tasks.mjs
// processAsk). `hint` narrows it to one kind of thing, from the Ideas screen.
export const findProducts = (e, hint = '') => S.addH(['asks'], {
  kind: 'products', ...queryFor(e), friend: e.friend || '', child: e.child || '', theme: e.theme || '', hint, eventId: e.id,
  state: 'requested', by: S.me(), createdAt: S.serverTimestamp(),
});
actions.findProducts = () => run(() => findProducts(ev()));
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
    const scans = [...new Set(all.map(x => x.scanId).filter(Boolean))];
    await S.batchH([...all.map(x => ['delete', ['events', x.id]]), ...scans.flatMap(id => [['delete', ['scans', id]], ['delete', ['scanImages', id]]])]);
    location.hash = '#/home';
  }, 'Deleted');
};
