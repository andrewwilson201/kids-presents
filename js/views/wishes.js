// Wish lists: what our own children would like, for Christmas and for their
// birthday. Either of you adds to a list (paste a shop link and the name, price
// and picture fill in, or just type it), drags the cards into order, and ticks
// off what's been ordered. Everything syncs live between you.
//
// households/{hid}/wishes/{id}: { child, occasion: christmas|birthday, name, price, url, shop, image, notes,
//   priceAt (the shop an estimated price came from, when it isn't the link's own shop),
//   rank (lower is higher up), autoName (name still the placeholder), pending (a link being read),
//   planned {uid, name, at} | null (one of you is planning to buy it), ordered {uid, name, at} | null,
//   by {uid, name}, createdAt }
//
// Family: ideas for the grown-ups (grandparents, uncles, aunts). The people are
// households/{hid}.family [{ id, name }], added, renamed and removed on the
// Family tab. Their ideas are wishes too, with child = the person's id and
// occasion 'ideas' (one list each, no birthday or countdown).
import * as S from '../store.js?v=13';
import { daysBetween, isDay, iso } from '../gifts.js?v=13';
import { icon, thumb } from '../ui.js?v=13';
import { st, esc, head, run, toast, money, today, fmtDay, routes, actions, arg, route, hooks, render, busy, failed, keep, hostOf, empty, plural, hold, toMillis, section } from '../core.js?v=13';
import { children, firstName } from '../events.js?v=13';
import { startTextScan } from './scan.js?v=13';

const OCCASIONS = { christmas: 'Christmas', birthday: 'Birthday' };
const family = () => st.household?.family || [];
const isFamily = id => family().some(p => p.id === id);
// Every list a present can go on: each child's two, then one per family member.
const allLists = () => [
  ...children().flatMap(c => Object.keys(OCCASIONS).map(o => ({ key: `${c.id}-${o}`, kid: c, occ: o }))),
  ...family().map(p => ({ key: `${p.id}-ideas`, kid: p, occ: 'ideas' })),
];
const safeUrl = u => (/^https:\/\/[^\s"'<>]+$/.test(u || '') ? u : '');
const urlIn = s => String(s || '').match(/https:\/\/[^\s<>"']+/)?.[0] || '';
const rank = w => (typeof w.rank === 'number' ? w.rank : 0);

// ---------- dates ----------
export function nextChristmas(day) {
  const y = Number(day.slice(0, 4));
  return day > `${y}-12-25` ? `${y + 1}-12-25` : `${y}-12-25`;
}
export function nextBirthday(kid, day) {
  if (!isDay(kid?.birthday)) return null;
  const md = kid.birthday.slice(5);
  const on = y => (md === '02-29' && new Date(Date.UTC(y, 1, 29)).getUTCMonth() !== 1 ? `${y}-02-28` : `${y}-${md}`);
  const y = Number(day.slice(0, 4));
  return on(y) >= day ? on(y) : on(y + 1);
}
// The last time the day came round, before today (or null with no birthday set).
export function lastDay(kid, occ, day) {
  const next = occ === 'christmas' ? nextChristmas(day) : nextBirthday(kid, day);
  if (!next) return null;
  const y = Number(next.slice(0, 4)) - 1;
  return occ === 'christmas' ? `${y}-12-25` : nextBirthday(kid, `${y}-01-01`);
}
const dayOf = (kid, occ) => (occ === 'christmas' ? nextChristmas(today()) : nextBirthday(kid, today()));
function countdown(kid, occ) {
  const d = dayOf(kid, occ);
  if (!d) return '';
  const n = daysBetween(today(), d);
  const when = n === 0 ? 'today' : n === 1 ? 'tomorrow' : n < 70 ? `in ${n} days` : `in ${Math.round(n / 7)} weeks`;
  const what = occ === 'christmas' ? 'Christmas' : `${esc(firstName(kid.name))}'s birthday`;
  return `${what} is ${when}, ${esc(fmtDay(d, { weekday: 'long', day: 'numeric', month: 'long' }))}`;
}

// ---------- which list ----------
// A list is "<child id>-<occasion>". With none named, the last one opened, or
// else the first child's list for whichever is coming soonest.
const LAST = 'presentsWishList';
function current() {
  const kids = children();
  const parse = s => {
    if (s === 'family') return { family: true };
    const i = String(s || '').lastIndexOf('-');
    const id = String(s).slice(0, i), occ = String(s).slice(i + 1);
    if (occ === 'ideas') { const p = family().find(x => x.id === id); return p ? { kid: p, occ } : null; }
    const kid = kids.find(c => c.id === id);
    return kid && OCCASIONS[occ] ? { kid, occ } : null;
  };
  let last = null; try { last = localStorage.getItem(LAST); } catch {}
  const got = parse(arg) || parse(last);
  if (got) return got;
  const kid = kids[0];
  const bday = nextBirthday(kid, today());
  return { kid, occ: bday && bday < nextChristmas(today()) ? 'birthday' : 'christmas' };
}
const listKey = ({ kid, occ, family: fam }) => (fam ? 'family' : `${kid.id}-${occ}`);
const itemsOf = (kidId, occ) => st.wishes.filter(w => w.child === kidId && w.occasion === occ);
const sortOpen = list => list.filter(w => !w.ordered).sort((a, b) => rank(a) - rank(b) || toMillis(a.createdAt) - toMillis(b.createdAt));
const listName = (kid, occ) => (occ === 'ideas' ? `Ideas for ${kid.name}` : `${firstName(kid.name)}'s ${occ === 'christmas' ? 'Christmas' : 'birthday'} list`);

// ---------- the screen ----------
routes.wishes = () => {
  const kids = children();
  if (!kids.length) return `${head('Wish lists')}${empty('star', 'No children yet', 'Add your children in Settings first.', '<a class="btn primary" href="#/settings">Settings</a>')}`;
  const cur = current();
  try { localStorage.setItem(LAST, listKey(cur)); } catch {}
  if (cur.family) return familyScreen(kids);
  const { kid, occ } = cur;
  const fam = occ === 'ideas';
  const all = itemsOf(kid.id, occ);
  const open = sortOpen(all);
  const done = all.filter(w => w.ordered).sort((a, b) => String(b.ordered.at || '').localeCompare(String(a.ordered.at || '')));
  const sub = [open.length ? `${plural(open.length, 'idea')} to choose from` : '', done.length ? `${done.length} ordered` : ''].filter(Boolean).join(' · ');
  const noBirthday = occ === 'birthday' && !isDay(kid.birthday);
  return `${head(esc(listName(kid, occ)), { eyebrow: fam ? 'Family' : countdown(kid, occ) || 'Wish lists', sub })}
    ${sharedOffer()}
    ${fam ? '' : afterTheDay(cur)}
    ${all.length && (!fam || spend(all).counted) ? spendCard(open, done) : ''}
    ${whoTabs(kids, fam ? 'family' : kid.id, fam ? 'christmas' : occ)}
    ${fam ? personBar(kid) : `<div class="seg wish-occ">${Object.entries(OCCASIONS).map(([k, label]) => `<a class="${k === occ ? 'on' : ''}" href="#/wishes/${esc(kid.id)}-${k}">${icon(k === 'christmas' ? 'star' : 'cake')} ${label}${counter(kid.id, k)}</a>`).join('')}</div>`}
    ${noBirthday ? `<p class="small muted" style="margin:8px 4px 0">Add ${esc(firstName(kid.name))}'s birthday in <a href="#/settings">Settings</a> to see a countdown here.</p>` : ''}
    <form class="card wish-add" data-form="addWish">
      <label class="field">Add an idea<span class="hint">Paste a link from a shop and the name, price and picture fill in. Or just type what it is.</span>
        <div class="row nowrap"><input type="text" name="what" required autocomplete="off" placeholder="Paste a link, or type an idea" aria-label="A link or an idea" data-keep="wish.what">
        <button class="btn primary">${icon('plus')} Add</button></div></label>
    </form>
    ${open.length ? `<ol class="wishes" id="wishRank">${open.map((w, n) => card(w, n, cur)).join('')}</ol>
      ${open.length > 1 ? `<p class="small muted wish-tip">Drag a card by its handle to put the ${fam ? 'best ideas' : 'favourites'} at the top.</p>` : ''}`
      : done.length ? '' : fam ? empty('gift', 'No ideas yet', `Whenever one of you thinks of something ${esc(kid.name)} would like, jot it here. You'll both see it straight away.`)
        : empty('gift', 'Nothing on this list yet', `Add what ${esc(firstName(kid.name))} would love. You'll both see it straight away.`)}
    ${done.length ? `${section('Ordered', { count: done.length })}<ul class="list card wish-done">${done.map(w => orderedRow(w)).join('')}</ul>
      <div class="row end"><button class="btn small ghost" data-act="clearOrdered">${icon('trash')} Clear the ordered ones</button></div>` : ''}`;
};
// ---------- what it will cost ----------
// The estimate is what's been ordered plus what one of you is planning to buy.
const pounds = n => money(Math.round(n * 100) / 100) || '£0';
const priceOf = w => (Number(w.price) > 0 ? Number(w.price) : 0);
export function spend(list) {
  const planned = list.filter(w => w.planned && !w.ordered), ordered = list.filter(w => w.ordered);
  const sum = l => l.reduce((t, w) => t + priceOf(w), 0);
  return { planned: sum(planned), ordered: sum(ordered), total: sum(planned) + sum(ordered), counted: planned.length + ordered.length, noPrice: [...planned, ...ordered].filter(w => !priceOf(w)).length };
}
function spendCard(open, done) {
  const s = spend([...open, ...done]);
  const split = [s.ordered || done.length ? `${pounds(s.ordered)} ordered` : '', s.counted > done.length ? `${pounds(s.planned)} planning to buy` : ''].filter(Boolean).join(' · ');
  const note = !s.counted ? 'Tap <b>Planning to buy</b> on the ideas you\'ll get and they add up here.'
    : s.noPrice ? `${plural(s.noPrice, 'present')} ${s.noPrice === 1 ? 'has' : 'have'} no price yet, so ${s.noPrice === 1 ? 'it isn\'t' : 'they aren\'t'} counted.` : '';
  return `<div class="card spend" aria-live="polite">
    <span class="spend-label">Estimated spend</span>
    <span class="spend-total">${pounds(s.total)}</span>
    ${split ? `<span class="spend-split">${esc(split)}</span>` : ''}
    ${note ? `<span class="spend-note">${note}</span>` : ''}
  </div>`;
}

// ---------- whose list ----------
function whoTabs(kids, on, occ) {
  if (kids.length < 2 && !family().length && on !== 'family') return '';
  const famCount = family().reduce((n, p) => n + itemsOf(p.id, 'ideas').filter(w => !w.ordered).length, 0);
  return `<div class="seg wish-kids">${kids.map(c => `<a class="${c.id === on ? 'on' : ''}" href="#/wishes/${esc(c.id)}-${occ}">${esc(firstName(c.name))}${counter(c.id, occ)}</a>`).join('')}
    <a class="${on === 'family' ? 'on' : ''}" href="#/wishes/family">${icon('users')} Family${famCount ? ` <span class="count">${famCount}</span>` : ''}</a></div>`;
}

// ---------- family ----------
// One card per grown-up, with how many ideas are waiting. Add someone with just
// a name; rename or remove them from their own list.
function familyScreen(kids) {
  const people = family();
  const total = people.reduce((n, p) => n + itemsOf(p.id, 'ideas').filter(w => !w.ordered).length, 0);
  return `${head('Family', { eyebrow: 'Wish lists', sub: people.length ? `${plural(people.length, 'person', 'people')} · ${plural(total, 'idea')}` : 'Present ideas for the grown-ups' })}
    ${whoTabs(kids, 'family', 'christmas')}
    ${people.length ? `<ul class="list card family-list">${people.map(p => {
      const items = itemsOf(p.id, 'ideas'); const open = items.filter(w => !w.ordered).length, done = items.length - open;
      const top = sortOpen(items)[0];
      return `<li class="link-row"><a class="grow row nowrap" href="#/wishes/${esc(p.id)}-ideas"><span class="avatar-tile">${esc(String(p.name).trim().charAt(0).toUpperCase())}</span>
        <span class="grow"><span class="name">${esc(p.name)}</span><span class="meta">${esc([open ? plural(open, 'idea') : 'No ideas yet', done ? `${done} ordered` : ''].filter(Boolean).join(' · '))}${top ? ` · <i>${esc(top.name)}</i>` : ''}</span></span>
        ${open ? `<span class="count">${open}</span>` : ''}${icon('chevron', 'chev')}</a></li>`;
    }).join('')}</ul>` : empty('users', 'No one here yet', 'Add the grown-ups you buy for, like Dad or your brothers. Then either of you can jot down an idea the moment you think of it.')}
    <form class="card wish-add" data-form="addPerson">
      <label class="field">Add a person<span class="hint">Just a name. You can rename or remove them later.</span>
        <div class="row nowrap"><input type="text" name="name" required autocomplete="off" maxlength="40" placeholder="Dad, Uncle Tom, Jo" aria-label="Their name" data-keep="family.name">
        <button class="btn primary">${icon('plus')} Add</button></div></label>
    </form>`;
}
function personBar(p) {
  if (keep.renamePerson === p.id) return `<form class="card row nowrap person-rename" data-form="savePersonName" data-id="${esc(p.id)}">
      <input type="text" name="name" required maxlength="40" value="${esc(p.name)}" aria-label="Name" data-keep="rename.${esc(p.id)}">
      <button class="btn small primary">Save</button><button type="button" class="btn small ghost" data-act="renamePerson" data-id="">Cancel</button></form>`;
  return `<div class="row person-bar"><a class="btn small ghost" href="#/wishes/family">${icon('back')} Everyone</a><span class="spacer"></span>
    <button class="btn small ghost" data-act="renamePerson" data-id="${esc(p.id)}">${icon('edit')} Rename</button>
    <button class="btn small ghost danger" data-act="removePerson" data-id="${esc(p.id)}">${icon('trash')} Remove</button></div>`;
}
const slug = s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'person';
actions.addPerson = f => {
  const name = f.name.value.trim().replace(/\s+/g, ' ').slice(0, 40); if (!name) return;
  const taken = new Set([...children(), ...family()].map(x => x.id));
  let id = `f${slug(name)}`; for (let n = 2; taken.has(id); n++) id = `f${slug(name)}${n}`;
  delete keep['family.name']; f.name.value = '';
  location.hash = `#/wishes/${id}-ideas`;
  run(() => S.updateH([], { family: [...family().map(p => ({ ...p })), { id, name }] }), `Added ${name}`);
};
actions.renamePerson = el => { if (keep.renamePerson) delete keep[`rename.${keep.renamePerson}`]; keep.renamePerson = el.dataset.id || null; render(); if (keep.renamePerson) document.querySelector('.person-rename input')?.select(); };
actions.savePersonName = f => {
  const name = f.name.value.trim().replace(/\s+/g, ' ').slice(0, 40); if (!name) return;
  keep.renamePerson = null; delete keep[`rename.${f.dataset.id}`];
  run(() => S.updateH([], { family: family().map(p => (p.id === f.dataset.id ? { ...p, name } : { ...p })) }), 'Renamed');
};
actions.removePerson = el => {
  const p = family().find(x => x.id === el.dataset.id); if (!p) return;
  const items = itemsOf(p.id, 'ideas');
  if (!confirm(`Remove ${p.name}${items.length ? ` and their ${plural(items.length, 'idea')}` : ''}?`)) return;
  location.hash = '#/wishes/family';
  run(() => S.batchH([...items.map(w => ['delete', ['wishes', w.id]]), ['update', [], { family: family().filter(x => x.id !== p.id) }]]), `Removed ${p.name}`);
};

const counter = (kidId, occ) => { const n = itemsOf(kidId, occ).filter(w => !w.ordered).length; return n ? ` <span class="count">${n}</span>` : ''; };

function meta(w) {
  return [w.url ? (w.shop || hostOf(w.url)) : '', w.price && w.priceAt ? `price from ${w.priceAt}` : '', w.by?.name ? `added by ${firstName(w.by.name)}` : ''].filter(Boolean).map(esc).join(' · ');
}
function title(w) {
  const reading = w.pending && !w.ordered;
  const name = reading && w.autoName ? '<span class="spinner sm"></span> Reading the link…' : esc(w.name);
  return safeUrl(w.url) ? `<a class="name" href="${esc(w.url)}" target="_blank" rel="noopener">${name} ${icon('external')}</a>` : `<span class="name">${name}</span>`;
}
function priceBit(w) {
  if (keep.wishPrice === w.id) return '';
  if (!w.price && w.pending) return `<span class="wish-price none finding" title="Looking for the price"><span class="spinner sm"></span> Price</span>`;
  return w.price ? `<button type="button" class="wish-price${w.priceAt ? ' about' : ''}" data-act="editPrice" data-id="${esc(w.id)}" aria-label="Price ${w.priceAt ? 'about ' : ''}${esc(money(w.price))}. Tap to change">${w.priceAt ? '~' : ''}${esc(money(w.price))}</button>`
    : `<button type="button" class="wish-price none" data-act="editPrice" data-id="${esc(w.id)}">${icon('plus')} Price</button>`;
}
function priceForm(w) {
  return `<form class="row nowrap wish-price-edit" data-form="savePrice" data-id="${esc(w.id)}">
    <label class="price-in"><span aria-hidden="true">£</span><input type="number" name="price" inputmode="decimal" step="any" min="0" value="${esc(w.price ?? '')}" placeholder="0.00" aria-label="Price in pounds" data-keep="wishPrice.${esc(w.id)}"></label>
    <button class="btn small primary">Save</button><button type="button" class="btn small ghost" data-act="editPrice" data-id="">Cancel</button>
  </form>
  ${safeUrl(w.url) ? `<div class="row wish-price-find"><button type="button" class="btn small ghost" data-act="findPrice" data-id="${esc(w.id)}">${icon('search')} Look the price up for me</button></div>` : ''}`;
}
const plannedBy = w => (w.planned ? (w.planned.uid === S.me().uid ? 'you' : firstName(w.planned.name)) : '');
function card(w, n, cur) {
  const editing = keep.wishEdit === w.id;
  return `<li class="wish card${w.planned ? ' planned' : ''}" data-id="${esc(w.id)}">
    <div class="row nowrap wish-top">
      <button type="button" class="grip" data-grip aria-label="Drag to move ${esc(w.name)} up or down">${icon('grip')}</button>
      <span class="rankno" aria-hidden="true">${n + 1}</span>
      ${thumb(w.image)}
      <span class="grow">${title(w)}<span class="meta">${meta(w)}</span>${w.notes ? `<span class="meta note">${esc(w.notes)}</span>` : ''}
        ${w.planned ? `<span class="plan-tag">${icon('cart')} ${esc(plannedBy(w) === 'you' ? 'You\'re' : `${plannedBy(w)} is`)} getting this</span>` : ''}</span>
      ${editing ? '' : priceBit(w)}
    </div>
    ${keep.wishPrice === w.id && !editing ? priceForm(w) : ''}
    ${editing ? editForm(w, cur) : `<div class="row wish-acts">
      <button class="btn small ${w.planned ? 'plan-on' : 'ghost plan-off'}" data-act="wishPlanned" data-id="${esc(w.id)}" aria-pressed="${w.planned ? 'true' : 'false'}">${icon(w.planned ? 'check' : 'cart')} Planning to buy</button>
      <button class="btn small tonal" data-act="wishOrdered" data-id="${esc(w.id)}">${icon('check')} Ordered it</button>
      <button class="btn small ghost" data-act="editWish" data-id="${esc(w.id)}">${icon('edit')} Change</button>
      ${n > 0 ? `<button class="btn small ghost" data-act="wishTop" data-id="${esc(w.id)}" aria-label="Move to the top">${icon('top')} Top</button>` : ''}</div>`}
  </li>`;
}
function orderedRow(w) {
  const when = w.ordered.at ? fmtDay(String(w.ordered.at).slice(0, 10), { day: 'numeric', month: 'short' }) : '';
  return `<li data-id="${esc(w.id)}"><span class="tile sm ok-tile">${icon('check')}</span>${thumb(w.image, 'sm')}<span class="grow">${title(w)}
      <span class="meta">${esc([w.price ? money(w.price) : '', `ordered by ${firstName(w.ordered.name)}${when ? ` on ${when}` : ''}`].filter(Boolean).join(' · '))}</span></span>
    <button class="btn small ghost" data-act="wishUnordered" data-id="${esc(w.id)}" aria-label="Not ordered after all">Undo</button></li>`;
}
function editForm(w, cur) {
  const lists = allLists().map(l => ({ key: l.key, label: listName(l.kid, l.occ) }));
  return `<form class="stack wish-edit" data-form="saveWish" data-id="${esc(w.id)}">
    <label class="field">What<input type="text" name="name" required value="${esc(w.autoName ? '' : w.name)}" placeholder="What it is"></label>
    <div class="two"><label class="field">Price £<input type="number" name="price" inputmode="decimal" step="any" value="${esc(w.price ?? '')}"></label>
      <label class="field">On the list<select name="list">${lists.map(l => `<option value="${esc(l.key)}"${l.key === `${w.child}-${w.occasion}` ? ' selected' : ''}>${esc(l.label)}</option>`).join('')}</select></label></div>
    <label class="field">Link<input type="text" name="url" inputmode="url" autocapitalize="off" autocomplete="off" value="${esc(w.url || '')}" placeholder="https://…"></label>
    <label class="field">Notes<input type="text" name="notes" value="${esc(w.notes || '')}" placeholder="Size 7–8, the blue one"></label>
    <div class="row"><button class="btn primary small">Save</button><button type="button" class="btn small ghost" data-act="editWish" data-id="">Cancel</button>
      <span class="spacer"></span><button type="button" class="btn small ghost danger" data-act="delWish" data-id="${esc(w.id)}">${icon('trash')} Delete</button></div>
  </form>`;
}

// ---------- after the day ----------
// Once the birthday or Christmas has been, the list asks what to do with the
// ideas from before it that weren't ordered: move them to the other list, keep
// them for next time, or clear them. The ordered ones are cleared either way.
// The household remembers which day each list was tidied after (wishTidied).
const otherOcc = occ => (occ === 'christmas' ? 'birthday' : 'christmas');
function leftovers(cur) {
  const day = lastDay(cur.kid, cur.occ, today());
  if (!day || (st.household.wishTidied || {})[listKey(cur)] >= day) return null;
  const old = itemsOf(cur.kid.id, cur.occ).filter(w => toMillis(w.createdAt) && iso(toMillis(w.createdAt)) <= day);
  if (!old.length) return null;
  return { day, open: sortOpen(old), done: old.filter(w => w.ordered) };
}
function afterTheDay(cur) {
  const l = leftovers(cur);
  if (!l) return '';
  const what = cur.occ === 'christmas' ? 'Christmas' : `${esc(firstName(cur.kid.name))}'s birthday`;
  const cleared = l.done.length ? ` The ${plural(l.done.length, 'ordered present')} will come off the list.` : '';
  if (!l.open.length) return `<div class="notice info after-day">${icon('gift')}<span class="grow"><b>${what} has been.</b> Everything on the list was ordered.${cleared}
    <span class="row" style="margin-top:10px"><button class="btn small tonal" data-act="tidyWishes" data-id="clear">Clear the list for next time</button></span></span></div>`;
  return `<div class="notice info after-day">${icon('gift')}<span class="grow"><b>${what} has been.</b> ${plural(l.open.length, 'idea')} ${l.open.length === 1 ? 'wasn\'t' : 'weren\'t'} ordered. What should happen to ${l.open.length === 1 ? 'it' : 'them'}?${cleared}
    <span class="row" style="margin-top:10px"><button class="btn small primary" data-act="tidyWishes" data-id="move">Move to ${esc(listName(cur.kid, otherOcc(cur.occ)))}</button>
    <button class="btn small tonal" data-act="tidyWishes" data-id="keep">Keep for next ${cur.occ === 'christmas' ? 'Christmas' : 'birthday'}</button>
    <button class="btn small ghost" data-act="tidyWishes" data-id="clear">Clear ${l.open.length === 1 ? 'it' : 'them'}</button></span></span></div>`;
}
actions.tidyWishes = el => {
  const cur = current(); const l = leftovers(cur); if (!l) return;
  const how = el.dataset.id, to = otherOcc(cur.occ);
  const top = Math.max(-1, ...sortOpen(itemsOf(cur.kid.id, to)).map(rank));
  const ops = [
    ...l.done.map(w => ['delete', ['wishes', w.id]]),
    ...(how === 'clear' ? l.open.map(w => ['delete', ['wishes', w.id]]) : []),
    ...(how === 'move' ? l.open.map((w, n) => ['update', ['wishes', w.id], { occasion: to, rank: top + 1 + n }]) : []),
    ['update', [], { [`wishTidied.${listKey(cur)}`]: l.day }],
  ];
  run(() => S.batchH(ops), how === 'move' ? `Moved to ${listName(cur.kid, to)}` : how === 'keep' ? 'Kept for next time' : 'Cleared');
};

// ---------- adding ----------
// A pasted link is saved straight away and read in the background (an ask of
// kind 'link': functions/link.mjs); the card fills in when the answer comes.
function addWish(cur, what, fallback = '') {
  const url = urlIn(what);
  const typed = url ? what.replace(url, '').trim() : what.trim();
  const top = Math.max(-1, ...sortOpen(itemsOf(cur.kid.id, cur.occ)).map(rank));
  const base = { child: cur.kid.id, occasion: cur.occ, rank: top + 1, ordered: null, by: S.me(), createdAt: S.serverTimestamp(), notes: '' };
  if (!url) return S.addH(['wishes'], { ...base, name: typed.slice(0, 120), price: null });
  const name = (fallback || typed).slice(0, 120);
  return Promise.all([
    S.addH(['wishes'], { ...base, name: name || `Something from ${hostOf(url)}`, autoName: !name, fallback: name ? '' : nameFromUrl(url), price: null, url, shop: hostOf(url), image: '', pending: url }),
    askLink(url, listKey(cur)),
  ]);
}
const askLink = (url, list) => (st.asks.some(a => a.kind === 'link' && a.url === url && !failed(a))
  ? Promise.resolve()
  : S.addH(['asks'], { kind: 'link', url, wish: list, state: 'requested', by: S.me(), createdAt: S.serverTimestamp() }));

// When a shop won't say what's behind a link, its address often does
// (…/LEGO-Classic-Creative-Bricks/dp/B00…).
export function nameFromUrl(url) {
  let path = '';
  try { path = decodeURIComponent(new URL(url).pathname); } catch { return ''; }
  const best = path.split('/').filter(s => /[a-z]{3,}.*[-_+].*[a-z]{3,}/i.test(s) && !/^[a-z0-9]{8,12}$/i.test(s)).sort((a, b) => b.length - a.length)[0];
  if (!best) return '';
  const words = best.replace(/\.(html?|aspx|php)$/i, '').replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words.length < 6 ? '' : words.charAt(0).toUpperCase() + words.slice(1, 120);
}

actions.addWish = f => {
  const what = f.what.value.trim(); if (!what) return;
  delete keep['wish.what']; f.what.value = '';
  run(() => addWish(current(), what), 'Added to the list');
};

// The answers to pasted links, put onto their cards (whichever of your phones sees it first).
const filled = new Set();
hooks.rendered.push(() => {
  for (const w of st.wishes) {
    if (!w.pending || filled.has(w.id)) continue;
    const a = w.pendingAsk ? st.asks.find(x => x.id === w.pendingAsk) : st.asks.find(x => x.kind === 'link' && x.url === w.pending);
    const since = w.pendingAt || toMillis(w.createdAt);
    const lost = !a && !!since && Date.now() - since > 6 * 60e3; // the ask has gone from the recent ones
    // Still looking for the price, but the name is known: put the name on the card now.
    if (a && busy(a)) {
      if (a.named?.title && w.autoName && !filled.has(`${w.id}:name`)) {
        filled.add(`${w.id}:name`);
        S.updateH(['wishes', w.id], { name: String(a.named.title).slice(0, 120), autoName: false, shop: a.named.shop || w.shop || '' }).catch(() => filled.delete(`${w.id}:name`));
      }
      continue;
    }
    if (!a && !lost) continue;
    filled.add(w.id);
    const p = a?.state === 'done' ? a.product || {} : {};
    const data = { pending: S.deleteField(), pendingAsk: S.deleteField(), pendingAt: S.deleteField() };
    if (w.autoName) {
      const name = p.title || w.fallback || '';
      if (name) data.name = String(name).slice(0, 120);
      data.autoName = !name;
    }
    if (p.price && !w.price) { data.price = Number(p.price) || null; data.priceAt = p.priceAt || ''; }
    if (p.image && !w.image) data.image = p.image;
    if (p.shop) data.shop = p.shop;
    S.updateH(['wishes', w.id], data).catch(() => filled.delete(w.id));
  }
});

// ---------- changing ----------
const byId = id => st.wishes.find(w => w.id === id);
actions.editWish = el => { keep.wishEdit = el.dataset.id || null; keep.wishPrice = null; render(); };
// The price, typed straight onto the card (Amazon links can't fill it in).
actions.editPrice = el => {
  keep.wishPrice = el.dataset.id || null;
  if (keep.wishPrice) { keep.wishEdit = null; delete keep[`wishPrice.${keep.wishPrice}`]; }
  render();
  if (keep.wishPrice) { const i = document.querySelector('.wish-price-edit input'); if (i) { i.focus(); try { i.select(); } catch {} } }
};
actions.savePrice = f => {
  const w = byId(f.dataset.id); if (!w) return;
  const v = f.price.value.trim(), n = Number(v);
  if (v !== '' && !(n >= 0)) return;
  keep.wishPrice = null; delete keep[`wishPrice.${w.id}`];
  run(() => S.updateH(['wishes', w.id], { priceAt: '', price: v === '' || n === 0 ? null : Math.round(n * 100) / 100 }), v === '' || n === 0 ? 'Price taken off' : `Price set to ${money(Math.round(n * 100) / 100)}`);
};
// Ask again for a link's price (it goes on the card if found and nothing's been typed meanwhile).
actions.findPrice = el => {
  const w = byId(el.dataset.id); if (!w || !safeUrl(w.url)) return;
  keep.wishPrice = null; delete keep[`wishPrice.${w.id}`];
  filled.delete(w.id);
  // The card waits for this new ask (by its id), not an earlier answer for the same link.
  const ask = S.newId('asks');
  run(() => S.batchH([
    ['set', ['asks', ask], { kind: 'link', url: w.url, wish: `${w.child}-${w.occasion}`, state: 'requested', by: S.me(), createdAt: S.serverTimestamp() }],
    ['update', ['wishes', w.id], { price: null, priceAt: '', pending: w.url, pendingAsk: ask, pendingAt: Date.now() }],
  ]), 'Looking for the price…');
};
actions.wishPlanned = el => {
  const w = byId(el.dataset.id); if (!w) return;
  run(() => S.updateH(['wishes', w.id], { planned: w.planned ? null : { ...S.me(), at: new Date().toISOString() } }), w.planned ? 'No longer planning to buy' : 'Marked as planning to buy');
};
actions.saveWish = f => {
  const w = byId(f.dataset.id); if (!w) return;
  const name = f.name.value.trim().slice(0, 120); if (!name) return;
  const url = urlIn(f.url.value);
  const [child, occasion] = (() => { const v = f.list.value; const i = v.lastIndexOf('-'); return [v.slice(0, i), v.slice(i + 1)]; })();
  const moved = child !== w.child || occasion !== w.occasion;
  const newPrice = f.price.value === '' ? null : Number(f.price.value);
  const data = { name, autoName: false, price: newPrice, ...(newPrice !== (w.price ?? null) ? { priceAt: '' } : {}), notes: f.notes.value.trim().slice(0, 200), url, shop: url ? (url === w.url ? w.shop || hostOf(url) : hostOf(url)) : '' };
  if (url !== (w.url || '')) { data.image = ''; if (url) data.pending = url; }
  if (moved) Object.assign(data, { child, occasion, rank: Math.max(-1, ...sortOpen(itemsOf(child, occasion)).map(rank)) + 1 });
  keep.wishEdit = null;
  filled.delete(w.id);
  run(async () => {
    await S.updateH(['wishes', w.id], data);
    if (data.pending) await askLink(url, `${child}-${occasion}`);
  }, moved ? `Moved to ${listName(allLists().find(l => l.key === `${child}-${occasion}`)?.kid || { name: child }, occasion)}` : 'Saved');
};
actions.delWish = el => { if (confirm('Delete this from the list?')) { keep.wishEdit = null; run(() => S.deleteH(['wishes', el.dataset.id]), 'Deleted'); } };
actions.wishOrdered = el => {
  const w = byId(el.dataset.id); if (!w) return;
  run(() => S.updateH(['wishes', w.id], { ordered: { ...S.me(), at: new Date().toISOString() } }), 'Marked as ordered');
};
actions.wishUnordered = el => run(() => S.updateH(['wishes', el.dataset.id], { ordered: null }));
actions.wishTop = el => {
  const w = byId(el.dataset.id); if (!w) return;
  const first = sortOpen(itemsOf(w.child, w.occasion))[0];
  run(() => S.updateH(['wishes', w.id], { rank: rank(first) - 1 }));
};
actions.clearOrdered = () => {
  const cur = current();
  const done = itemsOf(cur.kid.id, cur.occ).filter(w => w.ordered);
  if (!done.length || !confirm(`Take the ${plural(done.length, 'ordered present')} off ${listName(cur.kid, cur.occ)}?`)) return;
  run(() => S.batchH(done.map(w => ['delete', ['wishes', w.id]])), 'Cleared');
};

// ---------- dragging cards into order ----------
// Works with a finger or a mouse: hold a card's handle and move it. The list
// doesn't redraw from live updates while a card is being dragged (core.js hold).
let drag = null;
document.addEventListener('pointerdown', e => {
  const grip = e.target.closest?.('[data-grip]');
  if (!grip || drag || route !== 'wishes' || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const li = grip.closest('li.wish');
  e.preventDefault();
  try { grip.setPointerCapture(e.pointerId); } catch {}
  hold(true);
  const r = li.getBoundingClientRect();
  drag = { li, ul: li.parentElement, id: li.dataset.id, offset: e.clientY - r.top, y: e.clientY, y0: e.clientY, pid: e.pointerId, from: [...li.parentElement.children].indexOf(li) };
  li.classList.add('dragging');
  drag.ul.classList.add('sorting');
  if (navigator.vibrate) try { navigator.vibrate(8); } catch {}
  drag.raf = requestAnimationFrame(scrollTick);
});
document.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.pid) return;
  e.preventDefault();
  drag.y = e.clientY;
  place();
}, { passive: false });
document.addEventListener('pointerup', e => { if (drag && e.pointerId === drag.pid) drop(); });
document.addEventListener('pointercancel', e => { if (drag && e.pointerId === drag.pid) drop(); });

// Near the top or bottom of the screen, the page scrolls along (only the way the finger is going).
function scrollTick() {
  if (!drag) return;
  const top = document.getElementById('topbar')?.offsetHeight || 0;
  const bottom = window.innerHeight - (document.getElementById('tabs')?.offsetHeight || 0);
  const edge = 60;
  const v = drag.y < drag.y0 - 10 && drag.y < top + edge ? -(top + edge - drag.y) / 4
    : drag.y > drag.y0 + 10 && drag.y > bottom - edge ? (drag.y - (bottom - edge)) / 4 : 0;
  if (v) { window.scrollBy(0, Math.max(-16, Math.min(16, v))); place(); }
  drag.raf = requestAnimationFrame(scrollTick);
}
// Swap the card with a neighbour once its middle passes theirs, then keep it under the finger.
function place() {
  const { li, ul } = drag;
  // Layout positions (offsetTop), which the cards' slide animations don't affect.
  const ulTop = ul.getBoundingClientRect().top;
  const cardTop = drag.y - drag.offset;
  const mid = cardTop + li.offsetHeight / 2;
  for (let guard = 0; guard < 50; guard++) {
    const prev = li.previousElementSibling, next = li.nextElementSibling;
    let other = null;
    if (prev && mid < ulTop + prev.offsetTop + prev.offsetHeight / 2) other = prev;
    else if (next && mid > ulTop + next.offsetTop + next.offsetHeight / 2) other = next;
    if (!other) break;
    const before = other.offsetTop;
    // Move the other card, never the dragged one: moving it would lose hold of the finger.
    if (other === prev) ul.insertBefore(prev, li.nextElementSibling); else ul.insertBefore(next, li);
    // The card that made way slides into its new place.
    other.style.transition = 'none'; other.style.transform = `translateY(${before - other.offsetTop}px)`;
    void other.offsetWidth;
    other.style.transition = ''; other.style.transform = '';
  }
  li.style.transform = `translateY(${cardTop - ulTop - li.offsetTop}px)`;
  [...ul.children].forEach((x, n) => { const no = x.querySelector('.rankno'); if (no) no.textContent = n + 1; });
}
function drop() {
  const { li, ul, id, from, raf } = drag;
  cancelAnimationFrame(raf);
  drag = null;
  li.classList.remove('dragging'); ul.classList.remove('sorting');
  li.style.transform = '';
  const order = [...ul.children].map(x => x.dataset.id);
  const at = order.indexOf(id);
  const w = byId(id);
  if (at === from || !w) { hold(false); return; }
  const prev = byId(order[at - 1]), next = byId(order[at + 1]);
  let r = !prev ? rank(next) - 1 : !next ? rank(prev) + 1 : (rank(prev) + rank(next)) / 2;
  const fits = (!prev || rank(prev) < r) && (!next || r < rank(next)) && (!prev || !next || rank(next) - rank(prev) > 1e-6);
  const write = fits ? S.updateH(['wishes', id], { rank: r })
    // Ranks too close together (or equal): number the whole list again.
    : S.batchH(order.map((x, n) => ['update', ['wishes', x], { rank: n }]));
  hold(false);
  write.catch(err => { console.error(err); toast('That move didn\'t save. Try again.'); render(); });
}

// ---------- a link shared from a shop's app ----------
// The share target (sw.js) sends shared text to the invite reader; a shop link
// comes here instead, to go on one of the lists. It can still be read as an invite.
let shared = null;
export function offerSharedLink(text) {
  shared = text;
  location.hash = '#/wishes';
  render();
}
export const looksLikeShopLink = text => !!urlIn(text) && String(text).length < 500;
function sharedOffer() {
  if (!shared) return '';
  const url = urlIn(shared);
  const lists = allLists();
  return `<div class="notice info shared-offer">${icon('link')}<span class="grow"><b>Add this to a wish list?</b><br><span class="small">${esc(hostOf(url))}</span>
    <span class="row" style="margin-top:10px">${lists.map(l => `<button class="btn small tonal" data-act="addShared" data-id="${esc(l.key)}">${esc(listName(l.kid, l.occ))}</button>`).join('')}</span>
    <span class="row" style="margin-top:8px"><button class="btn small ghost" data-act="sharedInvite">It's a party invite</button><button class="btn small ghost" data-act="sharedDismiss">Not now</button></span></span></div>`;
}
actions.addShared = el => {
  const text = shared; shared = null;
  const v = el.dataset.id; const i = v.lastIndexOf('-');
  const cur = allLists().find(l => l.key === v) || {};
  if (!cur.kid || !text) return render();
  // Shops share "Name of the thing https://…"; that name is the fallback if the link can't be read.
  const url = urlIn(text);
  const words = text.replace(url, '').replace(/^(check out|have a look at|look at|i found)( this)?( deal| product)?( on [\w.]+)?:?/i, '').replace(/\s+/g, ' ').trim();
  location.hash = `#/wishes/${cur.kid.id}-${cur.occ}`;
  run(() => addWish(cur, url, words.length >= 4 ? words : ''), `Added to ${listName(cur.kid, cur.occ)}`);
};
actions.sharedInvite = () => { const text = shared; shared = null; location.hash = '#/scan'; run(() => startTextScan(text)); };
actions.sharedDismiss = () => { shared = null; render(); };
