// The present cupboard: presents bought ahead (in a sale, a multi-buy) waiting
// for a party. A party's page offers the ones that fit. Used ones are kept for
// the record, folded away. It sits beside Ideas, under the same tab.
import * as S from '../store.js?v=8';
import { icon } from '../ui.js?v=8';
import { st, esc, head, section, run, empty, money, keep, routes, actions } from '../core.js?v=8';
import { eventTitle, firstName, needing } from '../events.js?v=8';

const ages = c => (c.ageMin != null || c.ageMax != null ? `ages ${c.ageMin ?? '?'}–${c.ageMax ?? '?'}` : '');
routes.cupboard = () => {
  const free = st.cupboard.filter(c => !c.usedFor);
  const used = st.cupboard.filter(c => c.usedFor);
  const open = needing();
  const row = c => `<li><span class="tile sm other">${icon('gift')}</span><span class="grow"><span class="name">${esc(c.name)}</span>
    <span class="meta">${esc([c.price ? money(c.price) : '', ages(c), c.for && c.for !== 'any' ? `for a ${c.for}` : '', c.by?.name ? `bought by ${firstName(c.by.name)}` : ''].filter(Boolean).join(' · '))}</span>
    ${c.notes ? `<span class="meta">${esc(c.notes)}</span>` : ''}
    ${!c.usedFor && open.length ? `<label class="field use"><select data-change="useFor" data-id="${esc(c.id)}" aria-label="Use for a party"><option value="">Use it for…</option>${open.map(e => `<option value="${esc(e.id)}">${esc(eventTitle(e))}</option>`).join('')}</select></label>` : ''}
    ${c.usedFor ? `<span class="meta"><a href="#/event/${esc(c.usedFor)}">${esc(eventTitle(st.events.find(e => e.id === c.usedFor) || {}))}</a></span>` : ''}</span>
    ${!c.usedFor ? `<button class="iconbtn sm" data-act="delCupboard" data-id="${esc(c.id)}" aria-label="Remove">${icon('trash')}</button>` : ''}</li>`;
  return `${head('Present ideas', { eyebrow: 'The cupboard: presents in hand' })}
    <div class="seg"><a href="#/ideas">Ideas</a><a class="on" href="#/cupboard">Cupboard${free.length ? ` (${free.length})` : ''}</a></div>
    <p class="small muted" style="margin:10px 4px 14px">Presents bought ahead, ready for the next party. A party's page offers the ones that fit.</p>
    ${free.length ? `<ul class="list card">${free.map(row).join('')}</ul>` : empty('box', 'The cupboard is empty', 'When you see a good deal, buy a couple and add them here. They\'ll be suggested for parties they suit.')}
    ${section('Add a present')}
    <form class="card stack" data-form="addCupboard"><label class="field">What<input type="text" name="name" required placeholder="Lego Friends set" data-keep="cb.name"></label>
      <div class="three"><label class="field">Cost £<input type="number" name="price" inputmode="decimal" data-keep="cb.price"></label><label class="field">From age<input type="number" name="ageMin" inputmode="numeric" data-keep="cb.ageMin"></label><label class="field">To age<input type="number" name="ageMax" inputmode="numeric" data-keep="cb.ageMax"></label></div>
      <div class="two"><label class="field">Suits<select name="for"><option value="any">Anyone</option><option value="girl">A girl</option><option value="boy">A boy</option></select></label>
      <label class="field">Notes<input type="text" name="notes" placeholder="In the loft, gift receipt in the box" data-keep="cb.notes"></label></div>
      <button class="btn primary">${icon('plus')} Add to cupboard</button></form>
    ${used.length ? `<details class="disclosure card flush" data-toggle="used"${keep.used ? ' open' : ''}><summary>Given already <span class="count">${used.length}</span></summary><ul class="list">${used.map(row).join('')}</ul></details>` : ''}`;
};
actions.addCupboard = f => {
  const n = v => (v === '' ? null : Number(v));
  const name = f.name.value.trim().slice(0, 120); if (!name) return;
  for (const k of Object.keys(keep)) if (k.startsWith('cb.')) delete keep[k];
  run(() => S.addH(['cupboard'], { name, price: n(f.price.value), ageMin: n(f.ageMin.value), ageMax: n(f.ageMax.value), for: f.for.value, notes: f.notes.value.trim().slice(0, 200), by: S.me(), usedFor: null, createdAt: S.serverTimestamp() }), 'Added to the cupboard');
};
actions.delCupboard = el => { if (confirm('Remove this from the cupboard?')) run(() => S.deleteH(['cupboard', el.dataset.id])); };
actions.useFor = el => {
  const c = st.cupboard.find(x => x.id === el.dataset.id); const eid = el.value; if (!c || !eid) return;
  run(async () => {
    try { await S.claimPresent(eid, { state: 'bought', name: c.name, price: c.price || null, cupboardId: c.id, ideaId: c.ideaId || null }); }
    catch (err) { if (err.code === 'claimed') { el.value = ''; throw err; } throw err; }
    await S.updateH(['cupboard', c.id], { usedFor: eid });
  }, 'Set as the present');
};
