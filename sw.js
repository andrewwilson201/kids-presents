// Service worker: makes Party Presents installable, keeps the last good copy of
// the app for when you're offline, receives invite pictures shared from other
// apps (WhatsApp › Share › Party Presents), and shows phone notifications.
const CACHE = 'party-presents-v8';
const SHARE = 'party-presents-share';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('party-presents-v') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // A picture shared to the app (manifest.json share_target): keep it for the
  // app to pick up, then open the app on the Read an invite screen.
  if (req.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/share')) {
    event.respondWith((async () => {
      try {
        const form = await req.formData();
        const file = form.getAll('image').find(f => f && f.size);
        const cache = await caches.open(SHARE);
        if (file) await cache.put('shared-image', new Response(file, { headers: { 'content-type': file.type || 'image/jpeg' } }));
        else await cache.put('shared-text', new Response([form.get('title'), form.get('text')].filter(Boolean).join('\n')));
      } catch (e) { /* the app says nothing arrived */ }
      return Response.redirect(new URL('./?shared=1#/scan', self.registration.scope).href, 303);
    })());
    return;
  }
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch (e) {
      const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      throw e;
    }
  })());
});

// Phone notifications (sent by the daily reminders function through Firebase Cloud Messaging as data messages).
self.addEventListener('push', (event) => {
  let msg = {};
  try { msg = event.data.json(); } catch { msg = { body: event.data && event.data.text() }; }
  const d = msg.data || msg.notification || msg;
  event.waitUntil(self.registration.showNotification(d.title || 'Party Presents', {
    body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: d.tag || undefined, data: { link: d.link || './' },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.link || './', self.registration.scope).href;
  event.waitUntil((async () => {
    for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
      if (c.url.startsWith(self.registration.scope)) { await c.navigate(url).catch(() => {}); return c.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
