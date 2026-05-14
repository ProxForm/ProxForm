// ProxForm service worker — network-first for HTML/CSS/JS, cache-first for assets.

const CACHE = 'proxform-v5';

const ASSETS = [
  '/',
  '/index.html',
  '/builder.html',
  '/fill.html',
  '/css/style.css?v=5',
  '/js/crypto.js?v=5',
  '/js/p2p.js?v=5',
  '/js/builder.js?v=5',
  '/js/fill.js?v=5',
  '/js/theme.js?v=5',
  '/js/storage.js?v=5',
  '/js/netcheck.js?v=5',
  '/js/render.js?v=5',
  '/js/footer.js?v=5',
  '/js/analytics.js?v=5',
  '/manifest.json',
  '/icons/favicon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isHtml = req.mode === 'navigate' || req.destination === 'document';
  const isAsset = /\.(css|js)$/.test(url.pathname);

  if (isHtml || isAsset) {
    // Network-first so version bumps reach users immediately.
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(req).then(hit => hit || (isHtml ? caches.match('/index.html') : Response.error()))
        )
    );
    return;
  }

  // Other assets: cache-first.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }))
  );
});
