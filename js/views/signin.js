// Signing in, and making or joining a household (your family's shared space).
import * as S from '../store.js?v=12';
import { icon } from '../ui.js?v=12';
import { st, esc, head, run, toast, gate, actions, render } from '../core.js?v=12';

const GOOGLE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.1-4 1.1-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8z"/><path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/></svg>';
gate.signIn = () => {
  const f = (ic, kind, title, text) => `<li><span class="tile ${kind}">${icon(ic)}</span><span class="grow"><b>${title}</b><span>${text}</span></span></li>`;
  return `<div class="signin"><img class="logo" src="icon.svg" alt="">
    <h1>Party Presents</h1><p class="lede">Every party the children are invited to, and a present sorted for each one.</p>
    <ul class="list card features">
      ${f('camera', 'other', 'Invites in one tap', 'Share an invite picture from WhatsApp and the party goes in the calendar.')}
      ${f('bell', 'veg', 'Reminded in good time', 'Ten days before, and again if nothing is bought yet.')}
      ${f('users', 'fish', 'Never two presents', 'You both see who\'s getting what, live.')}
    </ul>
    <button class="btn primary lg block gbtn" data-act="signIn" style="background:var(--surface);color:var(--text);box-shadow:var(--shadow-1)">${GOOGLE} Continue with Google</button>
    ${S.emulator ? `<form data-form="testSignIn" class="card" style="margin-top:20px;text-align:left"><p class="tiny muted">Emulator test sign-in</p>
      <input type="text" name="name" placeholder="Name"><input type="text" name="email" placeholder="Email" style="margin-top:8px"><button class="btn block" style="margin-top:8px">Test sign in</button></form>` : ''}</div>`;
};
actions.signIn = () => run(S.signIn);
actions.testSignIn = f => run(async () => { await S.testSignIn(f.name.value, f.email.value); location.reload(); });

const inviteFromUrl = () => new URLSearchParams(location.search).get('join');
let closed = false;
// The invite being joined: checked once, and what happened is shown on the page
// (not only in a passing message), so a problem can be seen and tried again.
let invite = { code: null, state: 'checking', name: '', why: '' };
const whyNot = e => (e?.code === 'timeout' || e?.code === 'unavailable' || /offline/i.test(e?.message || '') ? 'The app couldn\'t reach its database. Check the phone is online, then try again.'
  : e?.code === 'permission-denied' ? 'The database wouldn\'t allow it (permission denied).' : `${e?.message || 'Something went wrong'}${e?.code ? ` (${e.code})` : ''}`);
const withTimeout = (p, ms = 15000) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(Object.assign(new Error('timeout'), { code: 'timeout' })), ms))]);
function checkInvite(code, again = false) {
  if (invite.code === code && !again) return;
  invite = { code, state: 'checking', name: '', why: '' };
  withTimeout(S.lookupInvite(code)).then(
    inv => { invite = { code, state: inv ? 'found' : 'gone', name: inv?.name || '', why: '' }; },
    e => { console.error('Checking the invite failed', e); invite = { code, state: 'failed', name: '', why: whyNot(e) }; },
  ).then(() => { if (!st.household?.members) render(); });
}
gate.setup = () => {
  const code = inviteFromUrl();
  if (code) {
    checkInvite(code);
    const i = invite;
    const title = i.state === 'found' ? `Join “${esc(i.name)}”?` : i.state === 'gone' ? 'This invite link has expired' : i.state === 'failed' ? 'The invite couldn\'t be checked' : i.state === 'joining' ? 'Joining…' : 'Checking the invite…';
    return `${head('Join a household', { eyebrow: 'Invite', sub: 'You\'ve been invited to share the children\'s party presents.' })}
      <div class="card"><div class="row nowrap" style="gap:14px"><span class="tile veg">${i.state === 'checking' || i.state === 'joining' ? '<span class="spinner"></span>' : icon('users')}</span><h3 id="inviteName" class="grow">${title}</h3></div>
      ${i.state === 'gone' ? '<p class="small muted" style="margin:12px 0 0">Ask for a new one: Settings › Share invite link on the other phone.</p>' : ''}
      ${i.why ? `<p class="small danger-text" style="margin:12px 0 0">${esc(i.why)}</p>` : ''}
      ${i.state === 'failed' ? `<button class="btn primary lg block" style="margin-top:16px" data-act="recheckInvite">${icon('repeat')} Try again</button>` : ''}
      ${i.state === 'found' || i.state === 'checking' ? '<button class="btn primary lg block" style="margin-top:16px" data-act="join">Join</button>' : ''}</div>
      <p class="small muted" style="margin:0 4px">Signed in as ${esc(st.user.email)}. <button class="link" data-act="signOut">Not you?</button></p>`;
  }
  // The app is only for the households it was set up for (firestore.rules: config/open).
  if (closed) {
    return `${head('This app is private', { eyebrow: 'Welcome', sub: 'Party Presents is set up for one family. To join it, ask someone in it for the invite link (Settings › Share invite link) and open it on this phone.' })}
      <p class="small muted" style="margin:0 4px">Signed in as ${esc(st.user.email)}. <button class="link" data-act="signOut">Sign out</button></p>`;
  }
  return `${head('Set up your family', { eyebrow: 'Welcome', sub: 'Make your family\'s space, then send the invite link to whoever shares the present buying.' })}
    <form class="card" data-form="create">
      <label class="field">Family name<input type="text" name="name" value="The ${esc((st.user.displayName || '').split(' ').pop() || 'family')}s" required></label>
      <button class="btn primary lg block">Create</button>
    </form>
    <p class="small muted" style="margin:0 4px">Got an invite link? Open it on this phone to join instead.<br>Signed in as ${esc(st.user.email)}. <button class="link" data-act="signOut">Sign out</button></p>`;
};
actions.recheckInvite = () => { checkInvite(inviteFromUrl(), true); render(); };
actions.create = async f => {
  try {
    const starter = await fetch('data/ideas.json').then(r => r.json()).catch(() => []);
    await S.createHousehold(f.name.value.trim() || 'Our family', starter);
  }
  catch (e) {
    if (e?.code === 'permission-denied') { closed = true; document.getElementById('main').innerHTML = gate.setup(); return; }
    toast(e.message || 'Something went wrong');
  }
};
actions.join = async () => {
  const code = inviteFromUrl();
  const name = invite.name;
  invite = { code, state: 'joining', name, why: '' }; render();
  try {
    await withTimeout(S.joinHousehold(code), 20000);
    history.replaceState(null, '', location.pathname + '#/home');
    toast('Joined');
  } catch (e) {
    console.error('Joining failed', e);
    invite = { code, state: /expired/.test(e?.message || '') ? 'gone' : 'failed', name, why: /expired/.test(e?.message || '') ? '' : whyNot(e) };
    render();
  }
};
actions.signOut = () => run(S.signOut);
