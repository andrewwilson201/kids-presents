// Before `firebase deploy --only functions` (and the tests): copy the app's
// rules (js/gifts.js) into functions/shared, so the functions use the same
// code as the app. functions/shared isn't committed.
import { mkdirSync, copyFileSync, rmSync } from 'node:fs';
const root = new URL('..', import.meta.url);
const out = new URL('functions/shared/', root);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
copyFileSync(new URL('js/gifts.js', root), new URL('gifts.js', out));
console.log('Copied js/gifts.js into functions/shared');
