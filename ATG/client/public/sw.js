// ATG Traders service worker: web push + installable offline shell.
//
// Strategies:
//   - /api, /socket.io  -> network only (never cache money/notification data)
//   - /assets/* (hashed) -> cache first (immutable filenames)
//   - navigations       -> network first, fall back to the cached app shell
//   - same-origin GET   -> network first with cache fallback

const CACHE = 'atg-v1';
const SHELL = ['/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io')) return; // network only
  if (url.origin !== self.location.origin) return; // cross-origin (fonts) -> browser default

  // Hashed build assets: cache-first (filename changes on every deploy).
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
            return res;
          }),
      ),
    );
    return;
  }

  // Navigations + everything else: network first, cached shell as offline fallback.
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('/') : undefined))),
  );
});

// ---- Web push (used by Settings → notifications) ----

self.addEventListener('push', (event) => {
  let data = { title: 'ATG Traders', body: 'You have a new notification', link: '/' };
  try {
    data = event.data ? event.data.json() : data;
  } catch (e) {
    /* ignore */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { link: data.link },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/';
  event.waitUntil(self.clients.openWindow(link));
});
