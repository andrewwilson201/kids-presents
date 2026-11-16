// Reading an invite picture. A picture arrives by sharing it to the app (from
// WhatsApp: tap the picture › Share › Party Presents), by picking it from the
// phone's photos, or by pasting it. It's made smaller, saved as a scan, and the
// readInvite function has Claude read it and add the party (needsCheck, so
// you look it over). This screen shows the progress and opens the party.
import * as S from '../store.js?v=1';
import { icon } from '../ui.js?v=1';
import { st, esc, head, run, toast, render, routes, actions, hooks, route } from '../core.js?v=1';

// Make the picture small enough for the database (a document holds up to 1 MB).
export async function compress(file, maxSide = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That picture couldn\'t be opened.')); i.src = url; });
    let side = maxSide, quality = 0.78, out = '';
    for (let tries = 0; tries < 6; tries++) {
      const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale) });
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
      out = c.toDataURL('image/jpeg', quality);
      if (out.length < 700_000) return out;
      side = Math.round(side * 0.8); quality = Math.max(0.5, quality - 0.08);
    }
    return out;
  } finally { URL.revokeObjectURL(url); }
}

let waitingFor = null; // the scan this phone started, to open its party when it's read
export async function startScan(file) {
  if (!file || !/^image\//.test(file.type || 'image/')) { toast('That isn\'t a picture'); return; }
  const image = await compress(file);
  const id = S.newId('scans');
  waitingFor = id;
  await S.setH(['scans', id], { image, state: 'requested', by: S.me(), createdAt: S.serverTimestamp() }, false);
  if (route !== 'scan') location.hash = '#/scan';
  else render();
}

// A picture shared from another app waits in the service worker's cache.
let shared = new URLSearchParams(location.search).has('shared');
async function takeShared() {
  if (!shared || !st.household?.members) return;
  shared = false;
  history.replaceState(null, '', location.pathname + location.hash);
  try {
    const cache = await caches.open('party-presents-share');
    const res = await cache.match('shared-image');
    if (res) {
      const blob = await res.blob();
      await cache.delete('shared-image');
      await startScan(new File([blob], 'invite.jpg', { type: blob.type || 'image/jpeg' }));
      return;
    }
    const text = await cache.match('shared-text');
    if (text) { await cache.delete('shared-text'); toast('Only pictures can be read. Share the invite picture itself.'); }
    else toast('Nothing arrived. Try sharing the picture again.');
  } catch (e) { toast(e.message || 'The shared picture couldn\'t be read'); }
}
hooks.rendered.push(() => { takeShared(); });

// When the scan this phone started has been read, open the party it made.
hooks.rendered.push(() => {
  if (!waitingFor) return;
  const s = st.scans.find(x => x.id === waitingFor);
  if (s?.state === 'done' && s.eventId) { waitingFor = null; location.hash = `#/event/${s.eventId}`; }
});

// Pasting a picture anywhere in the app reads it as an invite.
document.addEventListener('paste', e => {
  if (!st.household?.members || e.target.closest?.('input, textarea')) return;
  const file = [...(e.clipboardData?.files || [])].find(f => /^image\//.test(f.type));
  if (file) { e.preventDefault(); run(() => startScan(file)); }
});

export const pickButton = (label = 'Read an invite picture', cls = 'primary') => `<label class="btn ${cls} filebtn">${icon('camera')} ${label}<input type="file" accept="image/*" data-change="pickInvite" hidden></label>`;
actions.pickInvite = el => { const f = el.files[0]; el.value = ''; if (f) run(() => startScan(f)); };
actions.pasteInvite = () => run(async () => {
  if (!navigator.clipboard?.read) throw new Error('This browser can\'t paste pictures. Pick it from your photos instead.');
  for (const item of await navigator.clipboard.read()) {
    const type = item.types.find(t => t.startsWith('image/'));
    if (type) { const blob = await item.getType(type); await startScan(new File([blob], 'invite', { type })); return; }
  }
  throw new Error('There\'s no picture on the clipboard. In WhatsApp, open the picture and copy it first.');
});
actions.retryScan = el => run(() => S.updateH(['scans', el.dataset.id], { state: 'requested', message: S.deleteField(), retry: Date.now() }));

routes.scan = () => {
  const mine = st.scans.filter(s => s.state !== 'done' || s.id === waitingFor);
  const latest = mine[0];
  const status = !latest ? '' : latest.state === 'failed'
    ? `<div class="notice danger">${icon('alert')}<span class="grow"><b>Couldn't read that invite</b><br>${esc(latest.message || 'Something went wrong.')}</span></div>
       <div class="row"><button class="btn tonal" data-act="retryScan" data-id="${esc(latest.id)}">${icon('repeat')} Try again</button><a class="btn ghost" href="#/edit">Type it in instead</a></div>`
    : latest.state === 'done' ? '' : `<div class="card reading"><img src="${esc(latest.image)}" alt="The invite"><div class="row nowrap" style="gap:12px;margin-top:12px"><span class="spinner"></span><span class="grow"><b>Reading the invite…</b><br><span class="small muted">This takes about ten seconds. The party will open when it's added.</span></span></div></div>`;
  return `${head('Read an invite', { eyebrow: 'Add a party', sub: 'Claude reads the date, time, place and who it\'s for from the picture, and adds the party for you to check.' })}
    ${status}
    ${!latest || latest.state !== 'requested' ? `<div class="card stack">
      ${pickButton('Choose the picture', 'primary lg block')}
      <button class="btn outline block" data-act="pasteInvite">${icon('clipboard')} Paste a copied picture</button>
      <p class="small muted">Quickest from WhatsApp: open the invite picture, tap Share, then pick Party Presents. (Once the app is installed on your home screen.)</p>
      <a class="btn ghost block" href="#/edit">Type it in instead</a></div>` : ''}`;
};
