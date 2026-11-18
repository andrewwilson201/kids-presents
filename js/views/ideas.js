// Ideas: the present ideas database. Filter by budget, boy or girl, age and
// interests; ask Claude for fresh ones (they're saved here too); like the good
// ones, hide the duds, add your own. The present cupboard sits beside it (js/views/cupboard.js). From a party (#/ideas/{eventId}) the
// filters start from that party and picking an idea sets it as the present.
import * as S from '../store.js?v=11';
import { matchIdeas, shopLinks, searchFor, pastPresents } from '../gifts.js?v=11';
import { icon, thumb } from '../ui.js?v=11';
import { st, esc, head, section, run, toast, money, empty, plural, routes, actions, arg, render, keep, hooks, busy, failed } from '../core.js?v=11';
import { eventTitle, firstName, children, priceText } from '../events.js?v=11';
import { queryFor, findProducts } from './event.js?v=11';

const BUDGETS = [5, 10, 15, 20, 25, 30];
let filters = null, filtersFor = null, showAll = false;
const current = () => {
  const e = arg ? st.events.find(x => x.id === arg) : null;
  if (filtersFor !== (arg || '') || !filters) {
    filtersFor = arg || '';
    const kid = children()[0];
    filters = e ? queryFor(e) : { budget: st.household?.budget || 15, gender: '', age: null, interests: '' };
    if (!e && kid) filters.age = null;
  }
  return { e, f: filters };
};
hooks.leave.push(() => { filtersFor = null; showAll = false; });

const ageLabel = i => (i.ageMin != null || i.ageMax != null ? `${i.ageMin ?? 3}–${i.ageMax ?? 12} yrs` : '');
function ideaRow(i, e, why = '') {
  return `<li class="idea" data-name="${esc(`${i.name} ${(i.interests || []).join(' ')} ${i.category || ''}`.toLowerCase())}">
    ${thumb(i.image, 'sm')}<span class="grow"><span class="name">${esc(i.name)}${i.liked ? ` <span class="liked">${icon('heart')}</span>` : ''}${i.source === 'claude' ? ' <span class="chip new tiny-chip">Claude</span>' : ''}${i.source === 'bought' ? ' <span class="chip ok tiny-chip">Bought before</span>' : ''}</span>
      <span class="meta">${esc([priceText(i), ageLabel(i), i.for && i.for !== 'any' ? `${i.for}s` : ''].filter(Boolean).join(' · '))}</span>
      ${why || i.description ? `<span class="meta desc">${esc(why || i.description)}</span>` : ''}
      <details class="mini shops"><summary>Shops, like, hide</summary>
        <div class="row">${/^https:\/\//.test(i.url || '') ? `<a class="chip link" href="${esc(i.url)}" target="_blank" rel="noopener">The one you bought${i.shop ? `, at ${esc(i.shop)}` : ''} ${icon('external')}</a>` : ''}${shopLinks(searchFor(i)).map(l => `<a class="chip link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)} ${icon('external')}</a>`).join('')}</div>
        <div class="row" style="margin-top:8px">${e ? `<button class="btn small tonal" data-act="findLike" data-id="${esc(i.id)}">${icon('search')} Find real ones in the shops</button>` : ''}<button class="btn small ghost" data-act="likeIdea" data-id="${esc(i.id)}">${icon('heart')} ${i.liked ? 'Unlike' : 'Like'}</button>
        <button class="btn small ghost" data-act="toCupboard" data-id="${esc(i.id)}">${icon('box')} Bought one for the cupboard</button>
        <button class="btn small ghost danger" data-act="hideIdea" data-id="${esc(i.id)}">Hide</button></div></details></span>
    ${e ? `<button class="btn small tonal" data-act="pickForEvent" data-id="${esc(i.id)}">I'll get this</button>` : ''}</li>`;
}

routes.ideas = () => {
  const { e, f } = current();
  const sorted = e && ['chosen', 'bought', 'wrapped'].includes(e.present?.state);
  const given = new Set(e ? pastPresents(st.events, e.friend, e.id, null, e.child).map(p => p.ideaId).filter(Boolean) : []);
  const list = matchIdeas(st.ideas, f, { limit: 60, given });
  const ask = st.asks.find(a => (a.kind || 'ideas') === 'ideas' && (e ? a.eventId === e.id : !a.eventId));
  const budgets = [...new Set([...BUDGETS, Number(f.budget) || 15])].sort((x, y) => x - y);
  const free = st.cupboard.filter(c => !c.usedFor).length;
  const byId = new Map(st.ideas.map(i => [i.id, i]));
  const claude = ask?.state === 'done' ? (ask.ideas || []).map(x => ({ idea: byId.get(x.ideaId), why: x.why })).filter(x => x.idea) : [];
  const hidden = st.ideas.filter(i => i.hidden).length;
  return `${head(e ? `Ideas for ${esc(firstName(e.friend) || 'the party')}` : 'Present ideas', { eyebrow: e ? `<a href="#/event/${esc(e.id)}">${icon('back')} ${esc(eventTitle(e))}</a>` : `${plural(st.ideas.filter(i => !i.hidden).length, 'idea')} saved`,
    sub: sorted ? `${esc(e.present.name || 'A present')} is already sorted for this one.` : '' })}
    ${e ? '' : `<div class="seg"><a class="on" href="#/ideas">Ideas</a><a href="#/cupboard">Cupboard${free ? ` (${free})` : ''}</a></div>`}
    <form class="card filters" data-form="filter">
      <div class="seg budgets" role="group" aria-label="Budget">${budgets.map(b => `<button type="button" class="${Number(f.budget) === b ? 'on' : ''}" data-act="budget" data-id="${b}">${money(b)}</button>`).join('')}</div>
      <div class="two"><label class="field">For<select name="gender" data-change="filterNow"><option value="">Anyone</option><option value="girl"${f.gender === 'girl' ? ' selected' : ''}>A girl</option><option value="boy"${f.gender === 'boy' ? ' selected' : ''}>A boy</option></select></label>
        <label class="field">Age<input type="number" name="age" min="1" max="16" inputmode="numeric" value="${esc(f.age ?? '')}" placeholder="Any" data-change="filterNow"></label></div>
      <label class="field">Into<input type="text" name="interests" value="${esc(f.interests || '')}" placeholder="dinosaurs, art, football" data-change="filterNow"></label>
      <div class="row">${busy(ask) ? '<span class="btn outline" aria-busy="true"><span class="spinner"></span> Claude is thinking…</span>' : `<button type="button" class="btn primary" data-act="askIdeas">${icon('sparkle')} Ask Claude for ideas</button>`}
      <span class="small muted grow">Claude's ideas are saved here for next time.${e ? ' For real products with prices, open an idea and tap Find real ones.' : ''}</span></div>
    </form>
    ${failed(ask) ? `<div class="notice danger">${icon('alert')}<span class="grow">Claude couldn't come up with ideas: ${esc(ask.message || 'something went wrong')}.</span></div>` : ''}
    ${claude.length ? `${section('From Claude', { count: claude.length })}<ul class="list card ideas">${claude.map(x => ideaRow(x.idea, e && !sorted ? e : null, x.why)).join('')}</ul>` : ''}
    ${section('From your ideas', { count: list.length })}
    ${list.length ? `<ul class="list card ideas">${list.slice(0, showAll ? 999 : 15).map(i => ideaRow(i, e && !sorted ? e : null)).join('')}</ul>
      ${!showAll && list.length > 15 ? `<button class="btn ghost block" data-act="showAllIdeas">Show all ${list.length}</button>` : ''}` : empty('gift', 'Nothing fits', 'Try a bigger budget, fewer interests, or ask Claude.')}
    <details class="disclosure card" data-toggle="addIdea"${keep.addIdea ? ' open' : ''}><summary>${icon('plus')} Add your own idea</summary>
      <form data-form="addIdea" class="stack" style="margin-top:12px"><label class="field">What<input type="text" name="name" required placeholder="Hama beads set" data-keep="idea.name"></label>
        <div class="three"><label class="field">About £<input type="number" name="price" inputmode="decimal" data-keep="idea.price"></label><label class="field">From age<input type="number" name="ageMin" inputmode="numeric" data-keep="idea.ageMin"></label><label class="field">To age<input type="number" name="ageMax" inputmode="numeric" data-keep="idea.ageMax"></label></div>
        <div class="two"><label class="field">For<select name="for"><option value="any">Anyone</option><option value="girl">Girls</option><option value="boy">Boys</option></select></label>
        <label class="field">Interests<input type="text" name="interests" placeholder="crafts, art" data-keep="idea.interests"></label></div>
        <button class="btn primary">Add idea</button></form></details>
    ${hidden ? `<p class="small muted" style="text-align:center"><button class="link" data-act="unhideAll">Show the ${plural(hidden, 'hidden idea')} again</button></p>` : ''}`;
};

const readFilters = () => {
  const f = document.querySelector('form[data-form=filter]'); if (!f) return;
  filters = { ...filters, gender: f.gender.value, age: f.age.value === '' ? null : Number(f.age.value), interests: f.interests.value.trim() };
};
actions.showAllIdeas = () => { showAll = true; render(); };
actions.filterNow = () => { readFilters(); render(); };
actions.filter = () => { readFilters(); render(); };
actions.budget = el => { readFilters(); filters.budget = Number(el.dataset.id); render(); };
actions.askIdeas = () => {
  readFilters();
  const { e, f } = current();
  run(() => S.addH(['asks'], { kind: 'ideas', ...f, friend: e?.friend || '', child: e?.child || '', eventId: e?.id || '', state: 'requested', by: S.me(), createdAt: S.serverTimestamp() }), 'Asked Claude. Ideas in a few seconds.');
};
actions.pickForEvent = el => {
  const i = st.ideas.find(x => x.id === el.dataset.id); if (!i) return;
  run(async () => {
    try { await S.claimPresent(arg, { state: 'chosen', name: i.name, ideaId: i.id, price: i.price || null, ...(i.url ? { url: i.url, shop: i.shop || '', image: i.image || '' } : {}) }); }
    catch (err) { if (err.code === 'claimed') { toast(err.message); return; } throw err; }
    location.hash = `#/event/${arg}`;
  }, 'Noted. You\'re getting it.');
};
// Real products of this kind, for the party: Claude searches the shops and they show on the party's page.
actions.findLike = el => {
  const i = st.ideas.find(x => x.id === el.dataset.id); const { e } = current(); if (!i || !e) return;
  run(async () => { await findProducts(e, i.name); location.hash = `#/event/${e.id}`; }, 'Claude is looking in the shops');
};
actions.likeIdea = el => { const i = st.ideas.find(x => x.id === el.dataset.id); run(() => S.updateH(['ideas', i.id], { liked: !i.liked })); };
actions.hideIdea = el => run(() => S.updateH(['ideas', el.dataset.id], { hidden: true }), 'Hidden');
actions.unhideAll = () => run(() => S.batchH(st.ideas.filter(i => i.hidden).map(i => ['set', ['ideas', i.id], { hidden: false }])));
actions.toCupboard = el => {
  const i = st.ideas.find(x => x.id === el.dataset.id);
  run(() => S.addH(['cupboard'], { name: i.name, price: i.price || null, ageMin: i.ageMin ?? null, ageMax: i.ageMax ?? null, for: i.for || 'any', ideaId: i.id, by: S.me(), usedFor: null, createdAt: S.serverTimestamp() }), 'Added to the cupboard');
};
actions.addIdea = f => {
  const n = v => (v === '' ? null : Number(v));
  const name = f.name.value.trim().slice(0, 120); if (!name) return;
  for (const k of ['idea.name', 'idea.price', 'idea.ageMin', 'idea.ageMax', 'idea.interests']) delete keep[k];
  run(() => S.addH(['ideas'], { name, price: n(f.price.value), ageMin: n(f.ageMin.value), ageMax: n(f.ageMax.value), for: f.for.value, interests: f.interests.value.split(',').map(s => s.trim()).filter(Boolean), source: 'us', by: S.me(), createdAt: S.serverTimestamp() }), 'Idea added');
};
