/* Khatwatna service worker.
 * Kept deliberately small: it only makes the app shell load fast and work offline.
 * - HTML/navigation: network-first, so a new deploy on GitHub Pages reaches users
 *   immediately; the cached copy is only used when offline.
 * - Same-origin static files (icons, manifest): stale-while-revalidate.
 * - Cross-origin requests (Supabase API/auth, map tiles, Google Fonts) and any
 *   non-GET request are never intercepted, so private data is never cached here
 *   and API calls always hit the network.
 * Bump CACHE when the precache list changes; activate deletes older caches.
 */
const CACHE = 'khatwatna-v4';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './privacy.html',
  './terms.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => (k.startsWith('stepcircle-') || k.startsWith('khatwatna-')) && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                 // never touch writes
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // Supabase, tiles, fonts: browser default

  const isHTML = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    // Network-first so updates arrive; fall back to cache (then the app shell) offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true })
          .then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // Stale-while-revalidate for same-origin static assets.
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req).then((hit) => {
        const network = fetch(req)
          .then((res) => {
            if (res.ok && res.type === 'basic') cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        if (hit) { event.waitUntil(network); return hit; }
        return network;
      })
    )
  );
});


// Web Push: reminders, cheers, dares, rallies and the Sunday report arrive even when the app is closed.
// The payload is encrypted by the server for this browser only (RFC 8291).
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Khatwatna', {
    body: data.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || './' },
  }));
});

// Tapping a notification opens (or focuses) Khatwatna on the right screen.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope) && 'focus' in c) { c.navigate(target).catch(() => {}); return c.focus(); }
    }
    return self.clients.openWindow(target);
  }));
});
