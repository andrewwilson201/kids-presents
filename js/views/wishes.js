// Wish lists: what our own children would like, for Christmas and for their
// birthday. Either of you adds to a list (paste a shop link and the name, price
// and picture fill in, or just type it), drags the cards into order, and ticks
// off what's been ordered. Everything syncs live between you.
//
// households/{hid}/wishes/{id}: { child, occasion: christmas|birthday, name, price, url, shop, image, notes,
//   rank (lower is higher up), autoName (name still the placeholder), pending (a link being read),
//   ordered {uid, name, at} | null, by {uid, name}, createdAt }
import * as S from '../store.js?v=6';
import { daysBetween, isDay } from '../gifts.js?v=6';
import { icon, thumb } from '../ui.js?v=6';
import { st, esc, head, run, toast, money, today, fmtDay, routes, actions, arg, route, hooks, render, busy, failed, keep, hostOf, empty, plural, hold, toMillis, section } from '../core.js?v=6';
import { children, firstName } from '../events.js?v=6';
import { startTextScan } from './scan.js?v=6';

const OCCASIONS = { christmas: 'Christmas', birthday: 'Birthday' };
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
    const i = String(s || '').lastIndexOf('-');
    const kid = kids.find(c => c.id === String(s).slice(0, i)); const occ = String(s).slice(i + 1);
    return kid && OCCASIONS[occ] ? { kid, occ } : null;
  };
  let last = null; try { last = localStorage.getItem(LAST); } catch {}
  const got = parse(arg) || parse(last);
  if (got) return got;
  const kid = kids[0];
  const bday = nextBirthday(kid, today());
  return { kid, occ: bday && bday < nextChristmas(today()) ? 'birthday' : 'christmas' };
}
const listKey = ({ kid, occ }) => `${kid.id}-${occ}`;
const itemsOf = (kidId, occ) => st.wishes.filter(w => w.child === kidId && w.occasion === occ);
const sortOpen = list => list.filter(w => !w.ordered).sort((a, b) => rank(a) - rank(b) || toMillis(a.createdAt) - toMillis(b.createdAt));
const listName = (kid, occ) => `${firstName(kid.name)}'s ${occ === 'christmas' ? 'Christmas' : 'birthday'} list`;

// ---------- the screen ----------
routes.wishes = () => {
  const kids = children();
  if (!kids.length) return `${head('Wish lists')}${empty('star', 'No children yet', 'Add your children in Settings first.', '<a class="btn primary" href="#/settings">Settings</a>')}`;
  const cur = current();
  const { kid, occ } = cur;
  try { localStorage.setItem(LAST, listKey(cur)); } catch {}
  const all = itemsOf(kid.id, occ);
  const open = sortOpen(all);
  const done = all.filter(w => w.ordered).sort((a, b) => String(b.ordered.at || '').localeCompare(String(a.ordered.at || '')));
  const spent = done.reduce((t, w) => t + (Number(w.price) || 0), 0);
  const sub = [open.length ? `${plural(open.length, 'idea')} to choose from` : '', done.length ? `${done.length} ordered${spent ? ` (${money(Math.round(spent * 100) / 100)})` : ''}` : ''].filter(Boolean).join(' · ');
  const noBirthday = occ === 'birthday' && !isDay(kid.birthday);
  return `${head(esc(listName(kid, occ)), { eyebrow: countdown(kid, occ) || 'Wish lists', sub })}
    ${sharedOffer()}
    ${kids.length > 1 ? `<div class="seg wish-kids">${kids.map(c => `<a class="${c.id === kid.id ? 'on' : ''}" href="#/wishes/${esc(c.id)}-${occ}">${esc(firstName(c.name))}${counter(c.id, occ)}</a>`).join('')}</div>` : ''}
    <div class="seg wish-occ">${Object.entries(OCCASIONS).map(([k, label]) => `<a class="${k === occ ? 'on' : ''}" href="#/wishes/${esc(kid.id)}-${k}">${icon(k === 'christmas' ? 'star' : 'cake')} ${label}${counter(kid.id, k)}</a>`).join('')}</div>
    ${noBirthday ? `<p class="small muted" style="margin:8px 4px 0">Add ${esc(firstName(kid.name))}'s birthday in <a href="#/settings">Settings</a> to see a countdown here.</p>` : ''}
    <form class="card wish-add" data-form="addWish">
      <label class="field">Add an idea<span class="hint">Paste a link from a shop and the name, price and picture fill in. Or just type what it is.</span>
        <div class="row nowrap"><input type="text" name="what" required autocomplete="off" placeholder="Paste a link, or type an idea" aria-label="A link or an idea" data-keep="wish.what">
        <button class="btn primary">${icon('plus')} Add</button></div></label>
    </form>
    ${open.length ? `<ol class="wishes" id="wishRank">${open.map((w, n) => card(w, n, cur)).join('')}</ol>
      ${open.length > 1 ? '<p class="small muted wish-tip">Drag a card by its handle to put the favourites at the top.</p>' : ''}`
      : done.length ? '' : empty('gift', 'Nothing on this list yet', `Add what ${esc(firstName(kid.name))} would love. You'll both see it straight away.`)}
    ${done.length ? `${section('Ordered', { count: done.length })}<ul class="list card wish-done">${done.map(w => orderedRow(w)).join('')}</ul>
      <div class="row end"><button class="btn small ghost" data-act="clearOrdered">${icon('trash')} Clear the ordered ones</button></div>` : ''}`;
};
const counter = (kidId, occ) => { const n = itemsOf(kidId, occ).filter(w => !w.ordered).length; return n ? ` <span class="count">${n}</span>` : ''; };

function meta(w) {
  return [w.price ? money(w.price) : '', w.url ? (w.shop || hostOf(w.url)) : '', w.by?.name ? `added by ${firstName(w.by.name)}` : ''].filter(Boolean).map(esc).join(' · ');
}
function title(w) {
  const reading = w.pending && !w.ordered;
  const name = reading && w.autoName ? '<span class="spinner sm"></span> Reading the link…' : esc(w.name);
  return safeUrl(w.url) ? `<a class="name" href="${esc(w.url)}" target="_blank" rel="noopener">${name} ${icon('external')}</a>` : `<span class="name">${name}</span>`;
}
function card(w, n, cur) {
  const editing = keep.wishEdit === w.id;
  return `<li class="wish card" data-id="${esc(w.id)}">
    <div class="row nowrap wish-top">
      <button type="button" class="grip" data-grip aria-label="Drag to move ${esc(w.name)} up or down">${icon('grip')}</button>
      <span class="rankno" aria-hidden="true">${n + 1}</span>
      ${thumb(w.image)}
      <span class="grow">${title(w)}<span class="meta">${meta(w)}</span>${w.notes ? `<span class="meta note">${esc(w.notes)}</span>` : ''}</span>
    </div>
    ${editing ? editForm(w, cur) : `<div class="row wish-acts">
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
  const lists = children().flatMap(c => Object.keys(OCCASIONS).map(o => ({ key: `${c.id}-${o}`, label: listName(c, o) })));
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
    const a = st.asks.find(x => x.kind === 'link' && x.url === w.pending);
    const lost = !a && Date.now() - toMillis(w.createdAt) > 6 * 60e3; // the ask has gone from the recent ones
    if (a && busy(a)) continue;
    if (!a && !lost) continue;
    filled.add(w.id);
    const p = a?.state === 'done' ? a.product || {} : {};
    const data = { pending: S.deleteField() };
    if (w.autoName) {
      const name = p.title || w.fallback || '';
      if (name) data.name = String(name).slice(0, 120);
      data.autoName = !name;
    }
    if (p.price && !w.price) data.price = Number(p.price) || null;
    if (p.image && !w.image) data.image = p.image;
    if (p.shop) data.shop = p.shop;
    S.updateH(['wishes', w.id], data).catch(() => filled.delete(w.id));
  }
});

// ---------- changing ----------
const byId = id => st.wishes.find(w => w.id === id);
actions.editWish = el => { keep.wishEdit = el.dataset.id || null; render(); };
actions.saveWish = f => {
  const w = byId(f.dataset.id); if (!w) return;
  const name = f.name.value.trim().slice(0, 120); if (!name) return;
  const url = urlIn(f.url.value);
  const [child, occasion] = (() => { const v = f.list.value; const i = v.lastIndexOf('-'); return [v.slice(0, i), v.slice(i + 1)]; })();
  const moved = child !== w.child || occasion !== w.occasion;
  const data = { name, autoName: false, price: f.price.value === '' ? null : Number(f.price.value), notes: f.notes.value.trim().slice(0, 200), url, shop: url ? (url === w.url ? w.shop || hostOf(url) : hostOf(url)) : '' };
  if (url !== (w.url || '')) { data.image = ''; if (url) data.pending = url; }
  if (moved) Object.assign(data, { child, occasion, rank: Math.max(-1, ...sortOpen(itemsOf(child, occasion)).map(rank)) + 1 });
  keep.wishEdit = null;
  filled.delete(w.id);
  run(async () => {
    await S.updateH(['wishes', w.id], data);
    if (data.pending) await askLink(url, `${child}-${occasion}`);
  }, moved ? `Moved to ${listName(children().find(c => c.id === child) || { name: child }, occasion)}` : 'Saved');
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
  drag = { li, ul: li.parentElement, id: li.dataset.id, offset: e.clientY - r.top, y: e.clientY, pid: e.pointerId, from: [...li.parentElement.children].indexOf(li) };
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

// Near the top or bottom of the screen, the page scrolls along.
function scrollTick() {
  if (!drag) return;
  const bottom = window.innerHeight - (document.getElementById('tabs')?.offsetHeight || 0);
  const edge = 80;
  const v = drag.y < edge ? -(edge - drag.y) / 5 : drag.y > bottom - edge ? (drag.y - (bottom - edge)) / 5 : 0;
  if (v) { window.scrollBy(0, Math.max(-16, Math.min(16, v))); place(); }
  drag.raf = requestAnimationFrame(scrollTick);
}
// Swap the card with a neighbour once its middle passes theirs, then keep it under the finger.
function place() {
  const { li, ul } = drag;
  li.style.transform = '';
  for (let guard = 0; guard < 50; guard++) {
    const r = li.getBoundingClientRect();
    const mid = drag.y - drag.offset + r.height / 2;
    const prev = li.previousElementSibling, next = li.nextElementSibling;
    let other = null;
    if (prev && mid < prev.getBoundingClientRect().top + prev.offsetHeight / 2) other = prev;
    else if (next && mid > next.getBoundingClientRect().top + next.offsetHeight / 2) other = next;
    if (!other) break;
    const before = other.getBoundingClientRect().top;
    if (other === prev) ul.insertBefore(li, prev); else ul.insertBefore(next, li);
    // The card that made way slides into its new place.
    const shift = before - other.getBoundingClientRect().top;
    other.style.transition = 'none'; other.style.transform = `translateY(${shift}px)`;
    void other.offsetWidth;
    other.style.transition = ''; other.style.transform = '';
  }
  li.style.transform = `translateY(${drag.y - drag.offset - li.getBoundingClientRect().top}px)`;
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
  const lists = children().flatMap(c => Object.keys(OCCASIONS).map(o => ({ key: `${c.id}-${o}`, kid: c, occ: o })));
  return `<div class="notice info shared-offer">${icon('link')}<span class="grow"><b>Add this to a wish list?</b><br><span class="small">${esc(hostOf(url))}</span>
    <span class="row" style="margin-top:10px">${lists.map(l => `<button class="btn small tonal" data-act="addShared" data-id="${esc(l.key)}">${esc(listName(l.kid, l.occ))}</button>`).join('')}</span>
    <span class="row" style="margin-top:8px"><button class="btn small ghost" data-act="sharedInvite">It's a party invite</button><button class="btn small ghost" data-act="sharedDismiss">Not now</button></span></span></div>`;
}
actions.addShared = el => {
  const text = shared; shared = null;
  const v = el.dataset.id; const i = v.lastIndexOf('-');
  const cur = { kid: children().find(c => c.id === v.slice(0, i)), occ: v.slice(i + 1) };
  if (!cur.kid || !text) return render();
  // Shops share "Name of the thing https://…"; that name is the fallback if the link can't be read.
  const url = urlIn(text);
  const words = text.replace(url, '').replace(/^(check out|have a look at|look at|i found)( this)?( deal| product)?( on [\w.]+)?:?/i, '').replace(/\s+/g, ' ').trim();
  location.hash = `#/wishes/${cur.kid.id}-${cur.occ}`;
  run(() => addWish(cur, url, words.length >= 4 ? words : ''), `Added to ${listName(cur.kid, cur.occ)}`);
};
actions.sharedInvite = () => { const text = shared; shared = null; location.hash = '#/scan'; run(() => startTextScan(text)); };
actions.sharedDismiss = () => { shared = null; render(); };
